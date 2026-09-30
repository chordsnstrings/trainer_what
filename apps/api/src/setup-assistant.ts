import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, type Tx, putRecord, event } from "@trainer/db";
import { OFFERED_DIRECTORY_SPECIALTIES } from "@trainer/contracts";
import { ModelOutputInvalid } from "@trainer/providers";
import {
  ConfigurationError,
  providerRequest,
} from "../../../packages/providers/src/configuration.ts";
import {
  SPEECH_AUDIO_TYPES,
  speechToTextContract,
  transcribeSpeech,
  type SpeechAudioType,
} from "../../../packages/providers/src/integrations.ts";
import { setupAssistantModel } from "../../../packages/providers/src/setup-assistant.ts";
import {
  SETUP_ASSISTANT_PROMPT_VERSION,
  SETUP_MESSAGE_MAX,
  SETUP_OPENING_QUESTIONS,
  SETUP_STEPS,
  SETUP_MORE_QUESTION,
  SETUP_TURN_LIMIT,
  addAssistantTurn,
  addCoachTurn,
  emptyConversation,
  nextSetupQuestion,
  setupTurnInput,
  type SetupConversation,
  type SetupReply,
  type SetupStep,
} from "../../../packages/domain/src/setup-assistant.ts";
import { modelAccounting } from "./model-accounting.ts";
import { privacyMatches } from "./ingestion.ts";
import {
  lockBrainReviewActor,
  notifyImportReview,
} from "./source-review-notifications.ts";
import { loadPlanSettings } from "./brain-plans.ts";
import { HOST_HEADERS } from "./host-routing.ts";
import { billableSpeechMs, decodeSpeech } from "./voice-session.ts";
import {
  costEstimated,
  costNotSent,
  reserveVoiceCost,
} from "./cost-accounting.ts";

/**
 * The setup assistant (docs/features/setup-assistant.md): a short chat per
 * wizard step that turns the coach's own words into drafts. Drafts are
 * applied only when the coach asks, through the existing endpoints
 * (onboarding identity, design draft, rule compile, plan settings,
 * products), so each keeps its own validation and review; nothing here
 * reaches a member.
 */
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const KIND = "setup_conversation";
const specialties = OFFERED_DIRECTORY_SPECIALTIES.map((s) => ({
  id: s.id,
  label: s.label,
}));
const label = (id: unknown) =>
  specialties.find((s) => s.id === id)?.label ?? null;
const stepParam = z.enum(SETUP_STEPS);
/** What each step's drafts can be applied to. */
export const SETUP_TARGETS: Record<SetupStep, string[]> = {
  about: ["identity"],
  page: ["brand"],
  brain: ["compile", "limits"],
  plan: ["product"],
};
/** Coach answers from earlier steps each step reads (for context and number checks). */
const EARLIER: Record<SetupStep, SetupStep[]> = {
  about: [],
  page: ["about"],
  brain: ["about"],
  plan: ["about", "page"],
};
const MATERIAL_LIMIT = 12000;

type Stored = SetupConversation & {
  applied?: Record<string, { at: string; resultId: string | null }>;
};
type Row = { id: string; version: number; data: Stored } | null;

async function loadStep(tx: Tx, step: SetupStep, lock = false): Promise<Row> {
  const [row] = await tx.query(
    `SELECT id,version,data FROM records WHERE kind='${KIND}' AND data->>'step'=$1 ORDER BY created_at LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [step],
  );
  return (row as Row) ?? null;
}
async function saveStep(tx: Tx, a: Actor, row: Row, data: Stored) {
  if (row) {
    const [r] = await tx.query(
      "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING id,version,data",
      [row.id, JSON.stringify(data)],
    );
    return r as NonNullable<Row>;
  }
  const r = await putRecord(tx, a, KIND, data, { status: "active" });
  return { id: r.id, version: r.version, data: r.data } as NonNullable<Row>;
}
function view(step: SetupStep, row: Row) {
  const c: Stored = row?.data ?? emptyConversation(step);
  const next = nextSetupQuestion(c, specialties);
  const opening = SETUP_OPENING_QUESTIONS[step].length;
  return {
    step,
    version: row?.version ?? 0,
    turns: c.turns,
    nextQuestion: next ?? { key: `${step}.more`, text: SETUP_MORE_QUESTION },
    /** True once the opening questions and follow-ups are done: the drafts are ready to review. */
    done: !next,
    draft: c.draft,
    missing: c.missing,
    dropped: c.dropped,
    progress: { opened: Math.min(c.opened, opening), opening, followUps: c.followUps },
    targets: SETUP_TARGETS[step],
    applied: c.applied ?? {},
    sourceIds: c.sourceIds,
    interviewIds: c.turns.flatMap((t) => (t.interviewId ? [t.interviewId] : [])),
    invalidReplies: c.invalidReplies,
  };
}
async function material(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx.query(
    "SELECT id,data FROM records WHERE kind='source' AND status='ready' AND id=ANY($1::uuid[]) ORDER BY created_at",
    [ids],
  );
  let left = MATERIAL_LIMIT;
  const out: Array<{ title: string; text: string }> = [];
  for (const r of rows) {
    if (left <= 0) break;
    const text = String(r.data.text ?? "").slice(0, left);
    left -= text.length;
    out.push({ title: String(r.data.title ?? ""), text });
  }
  return out;
}

/** Runs an existing endpoint as the same signed-in coach, so it keeps its own checks. */
async function forward(
  app: FastifyInstance,
  req: FastifyRequest,
  method: "GET" | "PUT" | "POST",
  url: string,
  payload?: unknown,
) {
  const pass = [
    "cookie",
    "authorization",
    "origin",
    "host",
    "user-agent",
    ...Object.values(HOST_HEADERS),
  ];
  const headers: Record<string, string> = {};
  for (const h of pass) {
    const v = req.headers[h];
    if (typeof v === "string") headers[h] = v;
  }
  const res = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as any }),
  });
  let body: any = null;
  try {
    body = res.json();
  } catch {
    body = null;
  }
  if (res.statusCode >= 400)
    throw fail(
      res.statusCode,
      body?.code ?? "APPLY_FAILED",
      body?.message ?? "This draft could not be saved.",
    );
  return body;
}

// --------------------------------------------------------------- website text
const SOCIAL =
  /(?:^|\.)(?:instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|snapchat\.com|threads\.net|linktr\.ee|youtube\.com|youtu\.be|wa\.me|whatsapp\.com)$/i;
export function websiteAddress(value: string) {
  let text = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw fail(400, "WEBSITE_ADDRESS", "Enter your website address, for example yourname.com.");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password)
    throw fail(400, "WEBSITE_ADDRESS", "Enter your website address, for example yourname.com.");
  url.hash = "";
  if (SOCIAL.test(url.hostname))
    throw fail(
      400,
      "SOCIAL_NOT_SUPPORTED",
      "Social media pages can't be imported. Paste the text you want to use instead, or add your own website.",
    );
  return url;
}
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};
/** Readable text of a web page: title, description and body text, without scripts, styles or markup. */
export function htmlText(html: string) {
  const decode = (s: string) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 && n !== 0 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ??
    "";
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|form|nav|footer)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(?:p|div|section|article|header|main|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = [title, description, body]
    .map((s) => decode(s))
    .join("\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
  return text.slice(0, 60000);
}

export function setupAssistantRoutes(
  app: FastifyInstance,
  db: Database,
  owner: (r: FastifyRequest) => Actor,
) {
  app.get("/api/v1/setup-assistant", async (req) => {
    const a = owner(req);
    const rows = await db.tenant(a, async (tx) =>
      Promise.all(SETUP_STEPS.map((s) => loadStep(tx, s))),
    );
    return {
      promptVersion: SETUP_ASSISTANT_PROMPT_VERSION,
      specialties,
      steps: Object.fromEntries(SETUP_STEPS.map((s, i) => [s, view(s, rows[i]!)])),
    };
  });

  app.post(
    "/api/v1/setup-assistant/:step/messages",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const a = owner(req),
        step = stepParam.parse((req.params as any).step),
        b = z
          .object({
            text: z.string().trim().min(1).max(SETUP_MESSAGE_MAX),
            version: z.number().int().min(0),
            voice: z.boolean().default(false),
          })
          .strict()
          .parse(req.body);
      // Brain answers become teaching material, which never carries a
      // client's identifying details (the same screen as /brain/sources).
      if (step === "brain" && privacyMatches(b.text).length)
        throw fail(
          400,
          "PERSONAL_DATA_REMAINS",
          "Remove identifying details (names, phone numbers, emails) before sending this. Describe clients in general terms.",
        );
      // 1. The coach's turn (and, for the Brain step, a teaching answer) is
      // stored before any model call, so nothing the coach wrote is lost.
      const saved = await db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":setup-assistant"]);
        const row = await loadStep(tx, step, true);
        if ((row?.version ?? 0) !== b.version)
          throw fail(409, "SETUP_CHANGED", "This step changed in another window. Reload it first.");
        const prior: Stored = row?.data ?? emptyConversation(step);
        if (prior.turns.length + 3 > SETUP_TURN_LIMIT)
          throw fail(409, "SETUP_TURN_LIMIT", "This conversation is full. Review your drafts or use the short form.");
        const { conversation, question, skipped } = addCoachTurn(
          prior,
          b.text,
          specialties,
          new Date().toISOString(),
          randomUUID,
          { voice: b.voice },
        );
        const c: Stored = { ...conversation, applied: prior.applied ?? {} };
        if (step === "brain" && !skipped && b.text.length >= 3) {
          const r = await putRecord(
            tx,
            a,
            "interview",
            {
              question: question.text.slice(0, 1000),
              answer: b.text,
              origin: "setup_assistant",
              allowedUses: ["model_prompt", "trainer_specific_learning"],
            },
            { status: "answered" },
          );
          await event(tx, a, "brain.interview_answered", r.id, { origin: "setup_assistant" });
          c.turns[c.turns.length - 1]!.interviewId = r.id;
        }
        const stored = await saveStep(tx, a, row, c);
        const earlier = (await Promise.all(EARLIER[step].map((s) => loadStep(tx, s)))).map((r) => r?.data);
        return {
          row: stored,
          skipped,
          earlier,
          material: await material(tx, [...c.sourceIds, ...earlier.flatMap((e) => e?.sourceIds ?? [])]),
        };
      });
      if (saved.skipped) return view(step, saved.row);
      // 2. The model drafts from the coach's words; code checks every value.
      const { input, grounding } = setupTurnInput(saved.row.data, saved.earlier, saved.material);
      let reply: SetupReply | null = null;
      try {
        reply = await setupAssistantModel(input, specialties, modelAccounting(db, a, "setup_assistant"));
      } catch (error) {
        if (!(error instanceof ModelOutputInvalid)) throw error;
      }
      // 3. Stored only if nothing else changed the step meanwhile.
      const done = await db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":setup-assistant"]);
        const row = await loadStep(tx, step, true);
        if (!row || row.version !== saved.row.version)
          throw fail(409, "SETUP_CHANGED", "This step changed while the assistant was drafting. Reload it first.");
        const { conversation, grounded } = addAssistantTurn(
          row.data,
          reply,
          grounding,
          specialties,
          new Date().toISOString(),
          randomUUID,
        );
        const r = await saveStep(tx, a, row, { ...conversation, applied: row.data.applied ?? {} });
        if (grounded?.dropped.length)
          await event(tx, a, "setup_assistant.values_removed", r.id, {
            step,
            fields: grounded.dropped.map((d) => d.field),
            reasons: grounded.dropped.map((d) => d.reason),
          });
        return r;
      });
      return view(step, done);
    },
  );

  // A reviewed teaching source (programme file or website text) the
  // assistant may read for this step.
  app.post("/api/v1/setup-assistant/:step/sources", async (req) => {
    const a = owner(req),
      step = stepParam.parse((req.params as any).step),
      b = z.object({ sourceId: z.string().uuid(), version: z.number().int().min(0) }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":setup-assistant"]);
      const [source] = await tx.query("SELECT id FROM records WHERE id=$1 AND kind='source' AND status='ready'", [b.sourceId]);
      if (!source)
        throw fail(404, "SOURCE_UNAVAILABLE", "Review this file or page first; it becomes available once you approve its text.");
      const row = await loadStep(tx, step, true);
      if ((row?.version ?? 0) !== b.version)
        throw fail(409, "SETUP_CHANGED", "This step changed in another window. Reload it first.");
      const c: Stored = structuredClone(row?.data ?? emptyConversation(step));
      if (!c.sourceIds.includes(b.sourceId)) c.sourceIds = [...c.sourceIds, b.sourceId].slice(-5);
      return view(step, await saveStep(tx, a, row, c));
    });
  });

  // Starts a step's chat again. Teaching answers already stored stay in My
  // Brain (the coach manages them there); drafts already applied stay applied.
  app.post("/api/v1/setup-assistant/:step/restart", async (req) => {
    const a = owner(req),
      step = stepParam.parse((req.params as any).step),
      b = z.object({ version: z.number().int().min(0) }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      const row = await loadStep(tx, step, true);
      if ((row?.version ?? 0) !== b.version)
        throw fail(409, "SETUP_CHANGED", "This step changed in another window. Reload it first.");
      if (!row) return view(step, null);
      const fresh: Stored = { ...emptyConversation(step), applied: row.data.applied ?? {} };
      await event(tx, a, "setup_assistant.restarted", row.id, { step });
      return view(step, await saveStep(tx, a, row, fresh));
    });
  });

  // The coach deletes every setup chat (their own choice; account erasure
  // removes them too, as records the coach owns).
  app.delete("/api/v1/setup-assistant", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      const rows = await tx.query(`DELETE FROM records WHERE kind='${KIND}' RETURNING id`);
      await event(tx, a, "setup_assistant.deleted", undefined, { conversations: rows.length });
      return { deleted: rows.length };
    });
  });

  // Applies a step's draft through the existing endpoint. Everything stays a
  // draft there: identity and design drafts are private until the coach
  // publishes, compiled rules await confirmation, and the plan is created
  // as a draft product that is not on sale until the coach activates it.
  app.post("/api/v1/setup-assistant/:step/apply", async (req) => {
    const a = owner(req),
      step = stepParam.parse((req.params as any).step),
      b = z
        .object({ target: z.string(), version: z.number().int().min(1) })
        .strict()
        .parse(req.body);
    if (!SETUP_TARGETS[step].includes(b.target))
      throw fail(400, "SETUP_TARGET", "This draft can't be applied there.");
    const { row, about } = await db.tenant(a, async (tx) => ({
      row: await loadStep(tx, step),
      about: step === "page" ? await loadStep(tx, "about") : null,
    }));
    if (!row || row.version !== b.version)
      throw fail(409, "SETUP_CHANGED", "This step changed. Reload it before applying.");
    const d = row.data.draft;
    const incomplete = (fields: string[]) => {
      const missing = fields.filter((f) => d[f] === undefined || d[f] === null);
      if (missing.length)
        throw fail(409, "SETUP_DRAFT_INCOMPLETE", "Answer these first, or fill them in on the form: " + missing.join(", ") + ".");
    };
    let result: any;
    if (b.target === "identity") {
      const [prior] = await db.tenant(a, (tx) =>
        tx.query("SELECT version,data FROM records WHERE kind='onboarding_step' AND data->>'step'='identity'"),
      );
      const values: Record<string, unknown> = { ...(prior?.data?.values ?? {}), country: "AE" };
      if (d.publicName) values.publicName = d.publicName;
      if (d.businessName || (d.publicName && !values.businessName))
        values.businessName = d.businessName ?? d.publicName;
      if (d.city) values.city = d.city;
      if (d.specialty) values.category = label(d.specialty);
      if (d.audience) values.audience = d.audience;
      result = await forward(app, req, "PUT", "/api/v1/onboarding/identity", {
        version: prior?.version ?? 0,
        values,
        defer: false,
      });
    } else if (b.target === "brand") {
      incomplete(["headline", "bio"]);
      const current = await forward(app, req, "GET", "/api/v1/tenant/design-draft");
      const [tenant] = await db.system((tx) =>
        tx.query("SELECT name,theme FROM tenants WHERE id=$1", [a.tenantId]),
      );
      const theme = tenant?.theme ?? {};
      const base = current?.data ?? {
        name: about?.data.draft.publicName ?? tenant?.name,
        bio: theme.bio ?? "",
        category: theme.category ?? "",
        accent: /^#[0-9a-fA-F]{6}$/.test(theme.accent ?? "") ? theme.accent : "#0F766E",
        headline: theme.headline ?? "",
      };
      const { expectedVersion: _drop, ...rest } = base;
      const category = label(about?.data.draft.specialty) ?? rest.category ?? "";
      result = await forward(app, req, "PUT", "/api/v1/tenant/design-draft", {
        version: current?.version ?? 0,
        data: { ...rest, headline: d.headline, bio: d.bio, category },
      });
    } else if (b.target === "compile") {
      const ids = [
        ...row.data.turns.flatMap((t) => (t.interviewId ? [t.interviewId] : [])),
        ...row.data.sourceIds,
      ].slice(-20);
      if (!ids.length)
        throw fail(409, "SETUP_DRAFT_INCOMPLETE", "Answer at least one question about how you coach first.");
      result = await forward(app, req, "POST", "/api/v1/brain/compile", { sourceIds: ids });
    } else if (b.target === "limits") {
      const limits = Object.fromEntries(
        ["maxSessionMinutes", "maxLoadJumpPct", "maxWeeklyVolumeIncreasePct"]
          .filter((k) => typeof d[k] === "number")
          .map((k) => [k, d[k]]),
      );
      if (!Object.keys(limits).length)
        throw fail(409, "SETUP_DRAFT_INCOMPLETE", "You haven't given any limits; the safe defaults stay in place.");
      const { row: settingsRow, settings } = await db.tenant(a, loadPlanSettings);
      result = await forward(app, req, "PUT", "/api/v1/brain/plans/settings", {
        version: settingsRow?.version ?? null,
        settings: { ...settings, bounds: { ...settings.bounds, ...limits } },
      });
    } else {
      incomplete(["name", "priceAed", "billing"]);
      if (d.billing === "upfront") incomplete(["programmeDays"]);
      result = await forward(app, req, "POST", "/api/v1/products", {
        name: d.name,
        description: typeof d.description === "string" ? d.description : "",
        priceMinor: Math.round(Number(d.priceAed) * 100),
        billing: d.billing,
        programmeDays: d.billing === "upfront" ? d.programmeDays : null,
      });
    }
    const resultId = typeof result?.id === "string" ? result.id : null;
    const updated = await db.tenant(a, async (tx) => {
      const current = await loadStep(tx, step, true);
      if (!current) return null;
      const next: Stored = structuredClone(current.data);
      next.applied = { ...(next.applied ?? {}), [b.target]: { at: new Date().toISOString(), resultId } };
      const r = await saveStep(tx, a, current, next);
      await event(tx, a, "setup_assistant.applied", r.id, { step, target: b.target, resultId });
      return r;
    });
    return { applied: b.target, result, step: view(step, updated) };
  });

  // Website link import: the page text goes into the same private review as
  // an uploaded document (privacy screen, redaction, approval), then becomes
  // teaching material the assistant can read. Social media pages are refused.
  app.post(
    "/api/v1/setup-assistant/website",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req),
        b = z
          .object({
            url: z.string().trim().min(4).max(500),
            title: z.string().trim().min(2).max(120).optional(),
            rights: z.literal(true),
          })
          .strict()
          .parse(req.body);
      const url = websiteAddress(b.url);
      let response: Response;
      try {
        response = await providerRequest(url.href, {
          method: "GET",
          headers: { accept: "text/html,text/plain;q=0.9", "user-agent": "trainsyou-setup/1.0" },
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        const moved = error instanceof ConfigurationError && /redirect/i.test(error.message);
        throw fail(
          422,
          moved ? "WEBSITE_REDIRECT" : "WEBSITE_UNREADABLE",
          moved
            ? "This address forwards to another page. Open it in your browser and paste the address it ends on."
            : "We couldn't read this page. Check the address, or paste the text instead.",
        );
      }
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !/text\/html|text\/plain|application\/xhtml/i.test(type))
        throw fail(422, "WEBSITE_UNREADABLE", "We couldn't read this page. Check the address, or paste the text instead.");
      const raw = await response.text();
      const text = /text\/plain/i.test(type) ? raw.replace(/\r\n/g, "\n").trim().slice(0, 60000) : htmlText(raw);
      if (text.length < 10)
        throw fail(422, "WEBSITE_EMPTY", "This page has almost no text we can read. Paste the text instead.");
      const fileHash = createHash("sha256").update(text).digest("hex");
      return db.tenant(a, async (tx) => {
        await lockBrainReviewActor(tx, a);
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":import:" + fileHash]);
        const [prior] = await tx.query(
          "SELECT * FROM records WHERE kind IN ('source_import','source') AND data->>'fileHash'=$1 AND status<>'discarded' ORDER BY created_at DESC LIMIT 1",
          [fileHash],
        );
        if (prior) return prior;
        const r = await putRecord(
          tx,
          a,
          "source_import",
          {
            title: b.title ?? url.hostname.slice(0, 120),
            fileHash,
            fileName: url.hostname,
            url: url.origin + url.pathname,
            byteLength: Buffer.byteLength(raw),
            origin: "website_import",
            allowedUses: [],
            rightsAttestedAt: new Date().toISOString(),
            text,
            privacyMatches: privacyMatches(text),
            extraction: { method: "html_text", characters: text.length },
            rawDeletedAt: new Date().toISOString(),
            leaseUntil: null,
          },
          { status: "needs_review" },
        );
        await event(tx, a, "brain.website_imported", r.id, { host: url.hostname, characters: text.length });
        await notifyImportReview(tx, a, r);
        return r;
      });
    },
  );

  // Voice note: transcribed through the configured speech-to-text provider
  // and returned for the coach to check and send. The audio is held in memory
  // for this request only and the transcript is not stored until sent.
  app.post(
    "/api/v1/setup-assistant/:step/voice",
    { bodyLimit: 3 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      stepParam.parse((req.params as any).step);
      const b = z
        .object({
          audio: z.string().min(16).max(2_900_000),
          type: z.enum(Object.keys(SPEECH_AUDIO_TYPES) as [SpeechAudioType, ...SpeechAudioType[]]),
          durationMs: z.number().int().min(200).max(180000),
          language: z.enum(["en", "ar"]).default("en"),
          consent: z.literal(true),
        })
        .strict()
        .parse(req.body);
      let speech: ReturnType<typeof speechToTextContract>;
      try {
        speech = speechToTextContract();
      } catch {
        throw fail(503, "SPEECH_UNAVAILABLE", "Voice notes aren't switched on yet. Type your answer instead.");
      }
      const audio = decodeSpeech(b.audio, b.type, 2 * 1024 * 1024);
      const billableMs = billableSpeechMs(audio, b.type, b.durationMs);
      const usageId = randomUUID();
      await db.tenant(a, (tx) =>
        reserveVoiceCost(tx, {
          id: usageId,
          tenantId: a.tenantId,
          userId: a.userId,
          memberId: null,
          task: "setup.transcription",
          provider: speech.provider,
          model: speech.model,
          priceVersion: speech.priceVersion,
          pricing: {
            basis: "audio_seconds",
            seconds: Math.round(billableMs / 100) / 10,
            declaredSeconds: Math.round(b.durationMs / 100) / 10,
            bytes: audio.length,
            usdPerHour: speech.pricePerHour,
            reservedCostUsd: (billableMs / 3600000) * speech.pricePerHour,
            language: b.language,
          },
          traceId: null,
        }),
      );
      let text: string;
      try {
        const result = await transcribeSpeech(
          audio,
          b.type,
          async () => {
            await db.tenant(a, (tx) =>
              tx.query("UPDATE cost_events SET status='unknown' WHERE id=$1 AND status='reserved'", [usageId]),
            );
          },
          { language: b.language, maxCharacters: SETUP_MESSAGE_MAX },
        );
        text = result.text.trim();
      } catch {
        await db.tenant(a, (tx) => costNotSent(tx, usageId));
        throw fail(502, "TRANSCRIPTION_FAILED", "We couldn't hear that clearly. Try again, or type your answer.");
      } finally {
        audio.fill(0);
      }
      await db.tenant(a, (tx) => costEstimated(tx, usageId)).catch(() => {});
      if (!text)
        throw fail(422, "TRANSCRIPTION_EMPTY", "We couldn't hear any words. Try again, or type your answer.");
      return { transcript: text };
    },
  );
}
