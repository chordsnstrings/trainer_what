import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, type Tx, putRecord, event } from "@trainer/db";
import { OFFERED_DIRECTORY_SPECIALTIES, intakeSchema } from "@trainer/contracts";
import {
  emptyChat, nextChatQuestion, mergeChatFacts, appendChatMessage, chatText,
  profileReady, missingFacts, trainingFields, quickChatReply, type ChatData,
} from "../../../packages/domain/src/onboarding-chat.ts";
import { onboardingReply } from "../../../packages/providers/src/onboarding-chat.ts";
import { modelAccounting } from "./model-accounting.ts";
import { memberAccess } from "./entitlements.ts";
import { HOST_HEADERS } from "./host-routing.ts";
import { privacyMatches } from "./ingestion.ts";
import { lockTraining, openTrainingHold } from "./coaching-completion.ts";
import { openPersonalReview, screenForSafety } from "./safety-policy.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";

const specialties = OFFERED_DIRECTORY_SPECIALTIES.map(({ id, label }) => ({ id, label }));
const prefix = "/api/v1/onboarding-chat";
const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Row = { id: string; version: number; data: ChatData };
const common = { id: z.string().uuid(), version: z.number().int().nonnegative() };
const messageSchema = z.object({
  ...common, text: z.string().trim().min(1).max(4000), retryOf: z.string().uuid().optional(), mode: z.enum(["setup", "teach"]).default("setup"),
}).strict();
const actionSchema = z.object({
  ...common,
  action: z.enum(["pause", "resume", "skip", "profile", "offer", "nutrition", "compile", "approve", "quiz", "quiz-answer", "scenario", "publish"]),
  timezone: z.string().max(100).optional(),
  rules: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict()).min(1).max(100).optional(),
  roundId: z.string().uuid().optional(), caseId: z.string().uuid().optional(),
  verdict: z.enum(["yes", "change"]).optional(), text: z.string().trim().max(4000).optional(),
  ruleId: z.string().uuid().optional(), escalate: z.boolean().optional(),
}).strict();

async function forward(app: FastifyInstance, req: FastifyRequest, method: "GET" | "PUT" | "POST", url: string, payload?: unknown) {
  const headers: Record<string, string> = {};
  for (const key of ["cookie", "authorization", "origin", "host", "user-agent", ...Object.values(HOST_HEADERS)]) {
    const value = req.headers[key];
    if (typeof value === "string") headers[key] = value;
  }
  const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as any }) });
  const body = response.json();
  if (response.statusCode >= 400) throw fail(response.statusCode, body.code ?? "CHAT_ACTION_FAILED", body.message ?? "This could not be saved.");
  return body;
}
async function lock(tx: Tx, a: Actor) {
  await workspaceLock(tx, a.tenantId);
  if (a.role === "subscriber") await lockTraining(tx, a);
  const [current] = await tx.query("SELECT training_actor_is_current($1,$2,$3) AS current", [a.tenantId, a.userId, a.role]);
  if (!current?.current) throw fail(403, "ACCESS_CHANGED", "Your access changed. Sign in again.");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":onboarding-chat:" + a.userId]);
}
async function permissions(tx: Tx, a: Actor) {
  if (a.role === "owner") return { coaching: true, nutrition: false, nutritionIncluded: false, active: true };
  const rows = await tx.query("SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('coaching','nutrition','nutrition_model') ORDER BY document_type,created_at DESC,id DESC", [a.userId]);
  const allowed = (key: string) => rows.some(r => r.document_type === key && r.granted);
  const access = await memberAccess(tx, a.userId);
  return { coaching: allowed("coaching"), nutrition: access.modules.includes("nutrition") && allowed("nutrition") && allowed("nutrition_model"), nutritionIncluded: access.modules.includes("nutrition"), active: access.active };
}
async function load(tx: Tx, a: Actor): Promise<Row | undefined> {
  const [row] = await tx.query("SELECT * FROM records WHERE kind='onboarding_chat' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE", [a.userId]);
  return row as Row | undefined;
}
async function save(tx: Tx, a: Actor, row: Row, data: ChatData): Promise<Row> {
  // Keep the live transcript small; older messages remain available on demand.
  if (data.messages.length > 100) {
    const messages = data.messages.splice(0, 60);
    await putRecord(tx, a, "onboarding_chat_archive", { conversationId: row.id, messages }, { status: "saved" });
    data.archived = (data.archived ?? 0) + messages.length;
  }
  const [saved] = await tx.query("UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 RETURNING *", [row.id, JSON.stringify(data), row.version]);
  if (!saved) throw fail(409, "CHAT_CHANGED", "This conversation changed. Your text is still here; reload to continue.");
  return saved as Row;
}
async function initialize(tx: Tx, a: Actor, mode: "setup" | "teach", p: Awaited<ReturnType<typeof permissions>>) {
  let row = await load(tx, a);
  if (row) return row;
  const data = emptyChat(a.role === "owner" ? "coach" : "member", mode);
  if (a.role === "owner") {
    const rows = await tx.query("SELECT kind,data FROM records WHERE kind IN ('onboarding_step','setup_conversation','product') ORDER BY created_at,id LIMIT 200");
    const identity = rows.find(r => r.kind === "onboarding_step" && r.data.step === "identity")?.data.values ?? {};
    Object.assign(data.facts, Object.fromEntries(["publicName", "businessName", "city", "audience"].filter(k => identity[k]).map(k => [k, identity[k]])));
    for (const r of rows.filter(r => r.kind === "setup_conversation")) Object.assign(data.facts, r.data.draft ?? {});
    const [tenant] = await tx.query("SELECT name,theme FROM tenants WHERE id=$1", [a.tenantId]);
    const theme = tenant?.theme ?? {};
    if (theme.headline) data.facts.headline = theme.headline;
    if (theme.bio) data.facts.bio = theme.bio;
    const spec = specialties.find(s => s.label === (theme.category ?? identity.category));
    if (spec) data.facts.specialty = spec.id;
    const product = rows.find(r => r.kind === "product");
    if (product) Object.assign(data.facts, { name: product.data.name, priceAed: product.data.priceMinor / 100, billing: product.data.billing ?? "monthly", programmeDays: product.data.programmeDays });
    const uncompiled = await tx.query("SELECT id FROM records WHERE kind='interview' AND status='answered' AND owner_user_id=$1 ORDER BY created_at,id LIMIT 100", [a.userId]);
    data.teachingIds = uncompiled.map(r => r.id);
  } else if (p.coaching) {
    const [intake] = await tx.query("SELECT data FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [a.userId]);
    if (intake?.data.allowedUses?.includes("model_prompt")) for (const k of trainingFields) if (intake.data[k] !== undefined) data.facts[k] = intake.data[k];
    if (p.nutrition) {
      const [food] = await tx.query("SELECT data FROM records WHERE kind='nutrition_profile' AND status='current' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [a.userId]);
      if (food?.data.allowedUses?.includes("model_prompt")) {
        const f = food.data.profile;
        Object.assign(data.facts, { diet: f.diet, allergyStatus: f.allergyStatus, allergens: f.allergens, exclusions: f.exclusions, kitchenEquipment: f.equipment, cookingMinutes: f.maxMinutes, foodBudget: f.budget, nutritionScope: f.scopeStatus, nutritionNotes: f.notes });
      }
    }
  }
  const at = new Date().toISOString();
  for (const k of Object.keys(data.facts)) data.memory[k] = { evidence: "Previously saved profile or teaching", messageId: "saved", at };
  appendChatMessage(data, { id: randomUUID(), from: "assistant", text: a.role === "owner" ? (mode === "teach" ? "Let's pick up where you left off. Tell me something you'd like your Brain to handle better." : "Hey. Let's get to know how you coach. Tell me who you help and how you work with them.") : "Hey. Let's make this fit your life. We'll talk through your goals and what works for you.", at });
  data.lastQuestion = nextChatQuestion(data, specialties, p.nutrition);
  appendChatMessage(data, { id: randomUUID(), from: "assistant", text: data.lastQuestion.text, at });
  row = await putRecord(tx, a, "onboarding_chat", data, { status: "active" }) as Row;
  return row;
}
function say(data: ChatData, text: string, id = randomUUID()) {
  appendChatMessage(data, { id, from: "assistant", text, at: new Date().toISOString() });
}
const pick = (facts: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(k => facts[k] !== undefined).map(k => [k, facts[k]]));

export function onboardingChatRoutes(app: FastifyInstance, db: Database, identity: (req: FastifyRequest) => Actor) {
  const actor = (req: FastifyRequest) => {
    const a = identity(req);
    if (!["owner", "subscriber"].includes(a.role)) throw fail(403, "ROLE_REQUIRED", "This conversation belongs to the trainer or client signing in.");
    return a;
  };
  const snapshot = async (req: FastifyRequest, a: Actor, mode: "setup" | "teach" = "setup") => {
    const state = await db.tenant(a, async tx => {
      await lock(tx, a);
      const p = await permissions(tx, a);
      let row = await initialize(tx, a, mode ?? "setup", p);
      if (row.data.pending && Date.now() - Date.parse(row.data.pending.at) > 180000) {
        await tx.query("UPDATE records SET status='interrupted',updated_at=now() WHERE id=$1 AND kind='onboarding_chat_request'", [row.data.pending.id]);
        const data = structuredClone(row.data);
        delete data.pending;
        data.error = "That reply was interrupted. Your message is saved. Check the saved changes before trying again.";
        row = await save(tx, a, row, data);
      }
      const data = p.coaching ? row.data : { ...emptyChat("member"), messages: row.data.messages.filter(m => m.from === "assistant").slice(0, 1) };
      const [program] = a.role === "subscriber" ? await tx.query("SELECT id,status FROM records WHERE owner_user_id=$1 AND kind='program' AND status='assigned' ORDER BY created_at DESC LIMIT 1", [a.userId]) : [];
      return { id: row.id, version: row.version, ...data, permissions: p, ready: profileReady(data), missing: missingFacts(data, p.nutrition), programReady: !!program };
    });
    if (a.role === "owner") {
      const [setup, brain] = await Promise.all([forward(app, req, "GET", "/api/v1/setup"), forward(app, req, "GET", "/api/v1/brain/teach")]);
      return { ...state, setup, brain };
    }
    return state;
  };
  app.get(prefix, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const mode = z.enum(["setup", "teach"]).default("setup").parse((req.query as any)?.mode);
    return snapshot(req, actor(req), mode);
  });
  app.get(prefix + "/history", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const a = actor(req);
    const query = z.object({ before: z.iso.datetime().optional() }).parse(req.query);
    return db.tenant(a, async tx => {
      await lock(tx, a);
      if (!(await permissions(tx, a)).coaching) throw fail(403, "CONSENT_REQUIRED", "Coaching permission is needed.");
      const rows = await tx.query("SELECT data,created_at FROM records WHERE kind='onboarding_chat_archive' AND owner_user_id=$1 AND created_at<$2 ORDER BY created_at DESC LIMIT 1", [a.userId, query.before ?? new Date().toISOString()]);
      return { messages: rows[0]?.data.messages ?? [], before: rows[0] ? new Date(rows[0].created_at).toISOString() : null };
    });
  });
  // The request row makes retries/reloads idempotent, including after a process restart.
  async function claim(a: Actor, b: { id: string; version: number }, type: string, fingerprint: string, mode?: "setup" | "teach") {
    return db.tenant(a, async tx => {
      await lock(tx, a);
      const p = await permissions(tx, a);
      const [request] = await tx.query("SELECT data FROM records WHERE id=$1 AND kind='onboarding_chat_request' AND owner_user_id=$2", [b.id, a.userId]);
      if (request) {
        if (request.data.fingerprint !== fingerprint) throw fail(409, "REQUEST_CHANGED", "Send this as a new message.");
        return null;
      }
      let row = await initialize(tx, a, mode ?? "setup", p);
      if (row.version !== b.version) throw fail(409, "CHAT_CHANGED", "Your conversation changed in another tab. Reload, then send your message.");
      if (row.data.pending) throw fail(409, "CHAT_BUSY", "A reply is still in progress.");
      if (a.role === "subscriber" && !p.coaching) throw fail(403, "CONSENT_REQUIRED", "Choose whether to allow coaching before sharing your profile.");
      await putRecord(tx, a, "onboarding_chat_request", { fingerprint, type, conversationId: row.id }, { id: b.id, status: "processing" });
      const data = structuredClone(row.data);
      data.pending = { id: b.id, at: new Date().toISOString() };
      data.mode = a.role === "owner" ? mode ?? data.mode : "setup";
      delete data.error;
      row = await save(tx, a, row, data);
      return { row, p };
    });
  }
  async function finish(a: Actor, requestId: string, change: (data: ChatData, tx: Tx) => Promise<void> | void, error?: string) {
    await db.tenant(a, async tx => {
      await lock(tx, a);
      const row = await load(tx, a);
      if (!row || row.data.pending?.id !== requestId) return;
      const p = await permissions(tx, a);
      if (!p.coaching) return;
      const data = structuredClone(row.data);
      await change(data, tx);
      delete data.pending;
      if (error) data.error = error;
      await save(tx, a, row, data);
      await tx.query("UPDATE records SET status=$2,updated_at=now() WHERE id=$1 AND kind='onboarding_chat_request'", [requestId, error ? "failed" : "complete"]);
      await event(tx, a, "onboarding_chat." + (error ? "failed" : "saved"), row.id, { requestId });
    });
  }
  app.post(prefix + "/messages", { config: { rateLimit: { max: 40, timeWindow: "10 minutes" } } }, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const a = actor(req), b = messageSchema.parse(req.body);
    const claimed = await claim(a, b, "message", digest({ text: b.text, mode: b.mode, retryOf: b.retryOf }), b.mode);
    if (!claimed) return snapshot(req, a, b.mode);
    try {
      const prepared = await db.tenant(a, async tx => {
        await lock(tx, a);
        const p = await permissions(tx, a);
        if (!p.coaching) throw fail(403, "CONSENT_REQUIRED", "Coaching permission changed.");
        const row = (await load(tx, a))!;
        if (row.data.pending?.id !== b.id) throw fail(409, "CHAT_CHANGED", "The conversation changed.");
        const data = structuredClone(row.data);
        data.paused = false;
        const at = new Date().toISOString(), q = nextChatQuestion(data, specialties, p.nutrition);
        const teaching = a.role === "owner" && (b.mode === "teach" || ["approach", "alwaysDo", "neverDo", "referOut", "teaching"].includes(q.field));
        if (teaching && privacyMatches(b.text).length) throw fail(400, "PERSONAL_DATA_REMAINS", "Leave out client names, emails and phone numbers. Describe the situation in general terms.");
        if (b.retryOf) {
          const [failed] = await tx.query("SELECT status FROM records WHERE id=$1 AND kind='onboarding_chat_request' AND owner_user_id=$2", [b.retryOf, a.userId]);
          const original = data.messages.filter(m => m.from === "person").at(-1);
          if (!failed || !["failed", "interrupted"].includes(failed.status) || original?.id !== b.retryOf || original.text !== b.text)
            throw fail(409, "RETRY_CHANGED", "Send this as a new message.");
        } else appendChatMessage(data, { id: b.id, from: "person", text: b.text, at });
        if (teaching && !b.retryOf && b.text.length >= 10) {
          const source = await putRecord(tx, a, "interview", { question: data.lastQuestion?.text ?? q.text, answer: b.text, origin: "onboarding_chat", allowedUses: ["model_prompt", "trainer_specific_learning"] }, { status: "answered" });
          data.teachingIds.push(source.id);
          await event(tx, a, "brain.interview_answered", source.id);
        }
        let held = false;
        if (a.role === "subscriber") {
          const screen = await screenForSafety(tx, b.text);
          held = screen.hold;
          if (screen.hold) await openTrainingHold(tx, a, a.userId, b.text, undefined, screen);
          else if (screen.review) await openPersonalReview(tx, a, a.userId, b.text, screen);
          if (screen.hold || screen.review) {
            // A health disclosure is never lost if the model fails or rewrites it.
            data.facts.limitations = [data.facts.limitations, b.text].filter(Boolean).join("\n").slice(-2000);
            data.memory.limitations = { evidence: b.text, messageId: b.id, at };
          }
        }
        await save(tx, a, row, data);
        const rules = a.role === "owner" ? await tx.query("SELECT data FROM records WHERE kind='rule' AND status='confirmed' ORDER BY updated_at DESC LIMIT 24") : [];
        return { data, q, p, held, rules: rules.map(r => ({ title: String(r.data.title ?? "").slice(0, 120), condition: String(r.data.condition ?? "").slice(0, 300), directive: String(r.data.directive ?? "").slice(0, 500) })) };
      });
      if (prepared.held) {
        await finish(a, b.id, data => { say(data, "I've flagged this for your coach. Please pause training until it has been reviewed. If you feel seriously unwell or in immediate danger, contact local emergency services."); });
      } else {
        const answer = quickChatReply(prepared.q.field, b.text) ?? await onboardingReply(prepared.data, prepared.q, prepared.rules, specialties, prepared.p.nutrition, modelAccounting(db, a, a.role === "owner" ? "setup_assistant" : "member_onboarding"));
        await finish(a, b.id, async (data, tx) => {
          const p = await permissions(tx, a);
          const merged = mergeChatFacts(data, answer, b.text, b.retryOf ?? b.id, new Date().toISOString(), specialties, p.nutrition);
          Object.assign(data, merged);
          if (a.role === "owner" && !b.retryOf && prepared.data.teachingIds.length === claimed.row.data.teachingIds.length &&
              ["approach", "alwaysDo", "neverDo", "referOut", "maxLoadJumpPct", "maxWeeklyVolumeIncreasePct"].some(k => data.memory[k]?.messageId === b.id)) {
            const source = await putRecord(tx, a, "interview", { question: prepared.q.text, answer: b.text, origin: "onboarding_chat", allowedUses: ["model_prompt", "trainer_specific_learning"] }, { status: "answered" });
            data.teachingIds.push(source.id);
            await event(tx, a, "brain.interview_answered", source.id);
          }
          if (b.retryOf) await tx.query("UPDATE records SET status='complete',updated_at=now() WHERE id=$1 AND kind='onboarding_chat_request'", [b.retryOf]);
          const q = nextChatQuestion(data, specialties, p.nutrition);
          if (answer.questionField === q.field) q.text = chatText(answer.question, q.text);
          data.lastQuestion = q;
          say(data, chatText(answer.reply));
          say(data, q.text);
        });
      }
    } catch (e) {
      const message = (e as Error).message;
      await finish(a, b.id, () => {}, message);
    }
    return snapshot(req, a, b.mode);
  });

  app.post(prefix + "/actions", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const a = actor(req), b = actionSchema.parse(req.body);
    if (a.role !== "owner" && ["offer", "compile", "approve", "quiz", "quiz-answer", "scenario", "publish"].includes(b.action)) throw fail(403, "OWNER_REQUIRED", "Trainer access required.");
    if (a.role === "owner" && b.action === "nutrition") throw fail(403, "MEMBER_REQUIRED", "Client access required.");
    const claimed = await claim(a, b, b.action, digest({ ...b, version: undefined }));
    if (!claimed) return snapshot(req, a);
    let line = "", applied: [string, string] | undefined, compiled: string[] = [];
    try {
      const data = claimed.row.data, f = data.facts;
      if (b.action === "pause") line = "Saved. Come back whenever you're ready.";
      else if (b.action === "resume" || b.action === "skip") { /* code-only controls below */ }
      else if (b.action === "profile") {
        if (!profileReady(data)) throw fail(409, "PROFILE_INCOMPLETE", "A few details are still missing. You can tell me several at once.");
        const hash = digest(pick(f, a.role === "subscriber" ? trainingFields : ["publicName", "businessName", "city", "specialty", "audience", "headline", "bio"]));
        if (data.applied.profile !== hash) {
          if (a.role === "subscriber") {
            const payload = intakeSchema.parse({ ...pick(f, trainingFields), timezone: b.timezone ?? "Asia/Dubai", consent: true });
            const result = await forward(app, req, "POST", "/api/v1/intake", payload);
            line = result.trainingHeld || result.reviewRequired ? "Your profile is saved. Your coach needs to review the health details before you train." : "Your profile is with your coach. Your first workout will appear in Training when it's ready.";
          } else {
            const setup = await forward(app, req, "GET", "/api/v1/setup");
            const city = String(f.city).toLowerCase().replace(/[^a-z]+/g, " ");
            const emirate = setup.about.emirates.find((v: string) => city.includes(v.replaceAll("_", " "))) ?? (city.includes("al ain") ? "abu_dhabi" : undefined);
            await forward(app, req, "PUT", "/api/v1/setup/about", { version: setup.about.version, values: { ...Object.fromEntries(Object.entries(setup.about.values).filter(([, v]) => v != null)), name: f.publicName, specialty: f.specialty, audience: f.audience, ...(emirate ? { emirate } : {}) } });
            const [identity] = await db.tenant(a, tx => tx.query("SELECT version,data FROM records WHERE kind='onboarding_step' AND data->>'step'='identity'"));
            await forward(app, req, "PUT", "/api/v1/onboarding/identity", { version: identity?.version ?? 0, values: { ...(identity?.data.values ?? {}), publicName: f.publicName, businessName: f.businessName ?? f.publicName, city: f.city, audience: f.audience, category: specialties.find(s => s.id === f.specialty)?.label, country: "AE" }, defer: false });
            const draft = await forward(app, req, "GET", "/api/v1/tenant/design-draft");
            const [tenant] = await db.tenant(a, tx => tx.query("SELECT name,theme FROM tenants WHERE id=$1", [a.tenantId]));
            const theme = tenant?.theme ?? {};
            const base = draft?.data ?? { name: f.publicName, bio: theme.bio ?? "", category: theme.category ?? "", accent: theme.accent ?? "#0F766E", headline: theme.headline ?? "", ...(theme.design ? { design: theme.design } : {}) };
            const { expectedVersion: _drop, ...rest } = base;
            await forward(app, req, "PUT", "/api/v1/tenant/design-draft", { version: draft?.version ?? 0, data: { ...rest, name: f.publicName, headline: f.headline, bio: f.bio, category: specialties.find(s => s.id === f.specialty)?.label ?? "" } });
            line = "Your profile and page draft are saved. You can preview and publish from Page details.";
          }
          applied = ["profile", hash];
        } else line = "This profile is already saved.";
      } else if (b.action === "offer") {
        if (!f.name || !f.priceAed || !f.billing || (f.billing === "upfront" && !f.programmeDays))
          throw fail(409, "OFFER_INCOMPLETE", "Tell me the offer name, price and billing first.");
        const payload = { name: f.name, description: f.description ?? "", priceMinor: Math.round(f.priceAed * 100), billing: f.billing, programmeDays: f.billing === "upfront" ? f.programmeDays : null };
        const hash = digest(payload);
        const products = await db.tenant(a, tx => tx.query("SELECT id,data FROM records WHERE kind='product' AND status<>'archived'"));
        if (data.applied.offer !== hash && !products.some(r => Object.entries(payload).every(([k, v]) => (r.data[k] ?? null) === v)))
          await forward(app, req, "POST", "/api/v1/products", payload);
        applied = ["offer", hash];
        line = "Your offer draft is saved. Offer details has the remaining activation checks.";
      } else if (b.action === "nutrition") {
        if (!claimed.p.nutrition) throw fail(403, "CONSENT_REQUIRED", "Allow nutrition processing and AI planning before saving food preferences.");
        if (missingFacts(data, true).length) throw fail(409, "PROFILE_INCOMPLETE", "Let's finish the missing food and training details first.");
        const [old] = await db.tenant(a, tx => tx.query("SELECT version FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 AND status='current' ORDER BY created_at DESC,id DESC LIMIT 1", [a.userId]));
        const hash = digest(pick(f, ["age", "goal", "diet", "allergyStatus", "allergens", "exclusions", "kitchenEquipment", "cookingMinutes", "foodBudget", "nutritionScope", "nutritionNotes"]));
        if (data.applied.nutrition !== hash) {
          await forward(app, req, "POST", "/api/v1/nutrition/profile", { version: old?.version ?? 0, processingConsent: true, modelConsent: true, profile: { age: f.age, goal: f.goal.slice(0, 100), diet: f.diet, allergyStatus: f.allergyStatus, allergens: f.allergens ?? [], exclusions: f.exclusions, equipment: f.kitchenEquipment, maxMinutes: f.cookingMinutes, budget: f.foodBudget, scopeStatus: f.nutritionScope, timezone: b.timezone ?? "Asia/Dubai", notes: [f.limitations, f.nutritionNotes].filter(Boolean).join("\n").slice(0, 2000) } });
          applied = ["nutrition", hash];
        }
        line = "Your food preferences are saved. Open Nutrition to see your plan's status.";
      } else if (b.action === "compile") {
        compiled = data.teachingIds.filter(id => !data.compiledIds.includes(id)).slice(0, 20);
        if (!compiled.length) throw fail(409, "NO_NEW_TEACHING", "Tell me something about how you coach first.");
        await forward(app, req, "POST", "/api/v1/brain/compile", { sourceIds: compiled });
        line = "I've drafted rules from what you taught me. Review them below before approving.";
      } else if (b.action === "approve") {
        if (!b.rules?.length) throw fail(400, "RULES_REQUIRED", "Choose the rules you reviewed.");
        const result = await forward(app, req, "POST", "/api/v1/brain/rules/approve-all", { rules: b.rules });
        line = result.skipped?.length ? "Some rules changed or need individual review. I've kept those as drafts." : "Those rules are approved. Let's try them in a client situation.";
      } else if (b.action === "quiz") {
        await forward(app, req, "POST", "/api/v1/brain/quiz/rounds", {});
        line = "Here's a client situation. Does this sound like how you'd reply?";
      } else if (b.action === "quiz-answer") {
        if (!b.roundId || !b.caseId || !b.verdict) throw fail(400, "ANSWER_REQUIRED", "Choose an answer.");
        await forward(app, req, "POST", "/api/v1/brain/quiz/rounds/" + b.roundId + "/answers", { caseId: b.caseId, verdict: b.verdict, ...(b.verdict === "change" ? { reply: b.text } : {}) });
        line = b.verdict === "yes" ? "Saved. Let's try the next one." : "Thanks. Your correction is saved for the next teaching review.";
      } else if (b.action === "scenario") {
        if (!b.ruleId || !b.text || b.escalate === undefined) throw fail(400, "SCENARIO_REQUIRED", "Add your situation, rule and whether it needs a referral.");
        await forward(app, req, "POST", "/api/v1/brain/scenarios", { prompt: b.text, expectedEvidenceId: b.ruleId, expectEscalation: b.escalate, heldOut: true });
        line = "Saved as one of your practice situations.";
      } else if (b.action === "publish") {
        await forward(app, req, "POST", "/api/v1/brain/releases/supervised", {});
        line = "Your Brain is ready in review mode. It waits for your approval before sending.";
      }
      await finish(a, b.id, async c => {
        if (b.action === "pause") c.paused = true;
        if (b.action === "resume") { c.paused = false; c.skipped = []; }
        if (b.action === "skip") {
          const q = c.lastQuestion ?? nextChatQuestion(c, specialties, claimed.p.nutrition);
          if (!["review", "teaching", "paused"].includes(q.field)) c.skipped.push(q.field);
        }
        if (applied) c.applied[applied[0]] = applied[1];
        c.compiledIds = [...new Set([...c.compiledIds, ...compiled])];
        if (b.text && ["quiz-answer", "scenario"].includes(b.action)) appendChatMessage(c, { id: b.id, from: "person", text: b.text, at: new Date().toISOString() });
        if (line) say(c, line);
        if (["resume", "skip"].includes(b.action)) {
          c.lastQuestion = nextChatQuestion(c, specialties, claimed.p.nutrition);
          say(c, c.lastQuestion.text);
        }
      });
    } catch (e) {
      await finish(a, b.id, () => {}, (e as Error).message);
    }
    return snapshot(req, a);
  });
}
