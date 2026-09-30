import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { OFFERED_DIRECTORY_SPECIALTIES } from "@trainer/contracts";
import { buildApp } from "../apps/api/src/app.ts";
import { htmlText, websiteAddress } from "../apps/api/src/setup-assistant.ts";
import {
  SETUP_FOLLOW_UP_LIMIT,
  SETUP_NEUTRAL_REPLY,
  SETUP_OPENING_QUESTIONS,
  SETUP_STEPS,
  addAssistantTurn,
  addCoachTurn,
  emptyConversation,
  groundSetupDraft,
  isSkip,
  mentionsModelVendor,
  nextSetupQuestion,
  screenedGaps,
  screenedReply,
  setupAssistantInstruction,
} from "../packages/domain/src/setup-assistant.ts";

const specialties = OFFERED_DIRECTORY_SPECIALTIES.map((s) => ({ id: s.id, label: s.label }));
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
async function request(url: string, method: any = "GET", body?: any, actor?: any) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: { origin: "http://localhost:3000", ...(actor ? { cookie: actor.cookie } : {}) },
    payload: body,
  });
}
async function register(slug: string) {
  const r = await request("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password: "TrainingOnly2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await request("/bootstrap", "GET", undefined, { cookie });
  return { ...boot.json().user, cookie };
}
const modelConfig = {
  MODEL_BASE_URL: "https://setup-assistant.invalid/v1",
  MODEL_API_KEY: "fixture-only",
  MODEL_NAME: "fixture-setup",
  MODEL_MAX_DAILY_CALLS: "1000",
};
type Sent = { system: string; user: any };
/** A synthetic model: `answer` sees the system prompt and the parsed request. */
async function withModel<T>(answer: (s: Sent) => unknown, fn: (sent: Sent[]) => Promise<T>) {
  const previous = Object.fromEntries(Object.keys(modelConfig).map((k) => [k, process.env[k]]));
  const originalFetch = globalThis.fetch,
    sent: Sent[] = [];
  Object.assign(process.env, modelConfig);
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith(modelConfig.MODEL_BASE_URL)) return originalFetch(url, init);
    const body = JSON.parse(String(init?.body));
    const s = { system: body.messages[0].content, user: JSON.parse(body.messages[1].content) };
    sent.push(s);
    const content = answer(s);
    return Response.json({
      id: "setup-fixture",
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    });
  };
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(previous))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
});

// ------------------------------------------------------------ pure checks
test("about six opening questions, then follow-ups only for missing required fields, at most three", () => {
  const total = SETUP_STEPS.reduce((n, s) => n + SETUP_OPENING_QUESTIONS[s].length, 0);
  assert.equal(total, 6);
  let c = emptyConversation("plan");
  assert.equal(nextSetupQuestion(c, specialties)?.key, "plan.price");
  c = addCoachTurn(c, "Monthly please", specialties, "t", randomUUID).conversation;
  c = addAssistantTurn(c, { reply: "Noted.", draft: { billing: "monthly" }, gaps: [{ field: "priceAed", question: "What price in AED?" }] }, ["Monthly please"], specialties, "t", randomUUID).conversation;
  assert.deepEqual(c.missing, ["name", "priceAed"]);
  // The model's own wording for a field it asked about comes first.
  const q = nextSetupQuestion(c, specialties)!;
  assert.equal(q.field, "priceAed");
  assert.equal(q.text, "What price in AED?");
  // A skip declines that field: it is never asked again in this step.
  const skipped = addCoachTurn(c, "skip", specialties, "t", randomUUID);
  assert.equal(skipped.skipped, true);
  c = skipped.conversation;
  assert.deepEqual(c.declined, ["priceAed"]);
  assert.equal(nextSetupQuestion(c, specialties)?.field, "name");
  c.followUps = SETUP_FOLLOW_UP_LIMIT;
  assert.equal(nextSetupQuestion(c, specialties), null);
  assert.ok(isSkip("Later.") && isSkip("not sure") && !isSkip("Later I want 400 AED"));
});

test("drafts keep only what the coach wrote: invented numbers, claims, hidden specialties and technology names are removed", () => {
  const coach = ["I'm Sara, strength coach in Dubai. I charge 1,500 dirhams for a 12 week programme."];
  const plan = groundSetupDraft(
    "plan",
    { name: "Strong 12", priceAed: 1500, billing: "upfront", programmeDays: 84, description: "Twelve weeks, 3 sessions a week." },
    coach,
    specialties,
  );
  assert.equal(plan.fields.priceAed, 1500);
  assert.equal(plan.fields.programmeDays, 84, "weeks the coach gave become days");
  assert.equal(plan.fields.name, "Strong 12");
  // "3 sessions" was never said.
  assert.deepEqual(plan.dropped, [{ field: "description", reason: "number_not_stated" }]);
  const invented = groundSetupDraft("plan", { priceAed: 499, billing: "monthly" }, ["Monthly, around 400-500"], specialties);
  assert.equal(invented.fields.priceAed, undefined);
  assert.deepEqual(invented.missing, ["name", "priceAed"]);
  assert.deepEqual(invented.dropped, [{ field: "priceAed", reason: "number_not_stated" }]);
  const upfront = groundSetupDraft("plan", { name: "Block", priceAed: 900, billing: "upfront" }, ["900 AED upfront"], specialties);
  assert.deepEqual(upfront.missing, ["programmeDays"]);
  const page = groundSetupDraft(
    "page",
    {
      headline: "Strength coaching in Dubai, results guaranteed",
      bio: "I am REPs level 3 certified and have coached for years. Call me on +971 50 123 4567.",
    },
    ["Strength coach in Dubai"],
    specialties,
  );
  assert.deepEqual(page.fields, {});
  assert.deepEqual(page.dropped.map((d) => d.field), ["headline", "bio"]);
  const about = groundSetupDraft(
    "about",
    { publicName: "Sara", specialty: "yoga", city: "Dubai", audience: "Built with ChatGPT for busy mums" },
    ["Sara, yoga, Dubai, busy mums"],
    specialties,
  );
  assert.equal(about.fields.specialty, undefined, "hidden specialties are not offered");
  assert.equal(about.fields.audience, undefined);
  assert.deepEqual(about.dropped.map((d) => d.reason), ["not_offered", "names_technology"]);
  // A specialty written as its label is its id; values already drafted stay.
  const label = groundSetupDraft("about", { specialty: "Weight loss" }, ["weight loss"], specialties, { city: "Dubai" });
  assert.deepEqual(label.fields, { city: "Dubai", specialty: "weight_loss" });
  // A limit number must be written for that limit.
  const brain = groundSetupDraft(
    "brain",
    { alwaysDo: ["Film the first three sessions"], referOut: ["Sharp pain: stop and see a physio"], maxLoadJumpPct: 5, maxSessionMinutes: 60 },
    ["I film the first three sessions. Never add more than 5% to the weight in one go. Sharp pain: stop and see a physio."],
    specialties,
  );
  assert.equal(brain.fields.maxLoadJumpPct, 5);
  assert.equal(brain.fields.maxSessionMinutes, undefined);
  assert.deepEqual(brain.missing, []);
});

test("replies and follow-up questions never give medical advice or name the technology", () => {
  assert.equal(screenedReply("Noted your price of 450 AED.", ["450 a month"]), "Noted your price of 450 AED.");
  assert.equal(screenedReply("I'm ChatGPT, happy to help!", ["hi"]), SETUP_NEUTRAL_REPLY);
  assert.equal(screenedReply("Take ibuprofen 400 mg for that knee.", ["knee pain"]), SETUP_NEUTRAL_REPLY);
  assert.equal(screenedReply("Noted your 600 AED price.", ["monthly"]), SETUP_NEUTRAL_REPLY, "a number the coach never wrote");
  for (const vendor of ["GPT-4o", "Claude", "Anthropic", "Seed 2.0", "seed-2-0-pro", "ModelArk", "BytePlus", "an AI model"])
    assert.ok(mentionsModelVendor(`Powered by ${vendor}`), vendor);
  assert.ok(!mentionsModelVendor("Seed oils and sunflower seeds"));
  assert.deepEqual(
    screenedGaps(
      "plan",
      [
        { field: "priceAed", question: "What price in AED?" },
        { field: "priceAed", question: "And the price again?" },
        { field: "unknown", question: "What colour?" },
        { field: "name", question: "Name it" },
        "What name?",
      ],
      specialties,
    ),
    [{ field: "priceAed", question: "What price in AED?" }],
  );
  const instruction = setupAssistantInstruction("plan", specialties);
  assert.match(instruction, /setup-assistant-v\d/);
  assert.match(instruction, /Never suggest a price/);
  assert.ok(!mentionsModelVendor(instruction.replace(/AI, model/, "")));
});

test("website links: https only, no social media, readable text without scripts", () => {
  assert.equal(websiteAddress("coachsara.ae").href, "https://coachsara.ae/");
  assert.equal(websiteAddress("http://coachsara.ae/about#top").href, "https://coachsara.ae/about");
  for (const social of ["instagram.com/coachsara", "https://www.instagram.com/x", "tiktok.com/@x", "linktr.ee/x"])
    assert.throws(() => websiteAddress(social), (e: any) => e.code === "SOCIAL_NOT_SUPPORTED", social);
  assert.throws(() => websiteAddress("ftp://x.ae"), (e: any) => e.code === "WEBSITE_ADDRESS");
  const text = htmlText(
    `<html><head><title>Coach Sara &amp; Co</title><meta name="description" content="Strength in Dubai"><script>steal()</script></head>
     <body><nav>Home | About</nav><h1>Get strong</h1><p>I coach&nbsp;busy people &#8211; 3 days a week.</p><style>p{}</style><footer>© 2026</footer></body></html>`,
  );
  assert.equal(text, "Coach Sara & Co\nStrength in Dubai\nGet strong\nI coach busy people – 3 days a week.");
});

// ------------------------------------------------------------ endpoints
const setupReply = (draft: Record<string, unknown>, gaps: unknown[] = [], reply = "Noted.") => ({ reply, draft, gaps });

test("a step's chat stores turns, drafts from the coach's words and applies drafts through the existing endpoints", async () => {
  const coach = await register("setup-assist-coach");
  const empty = await request("/setup-assistant", "GET", undefined, coach);
  assert.equal(empty.statusCode, 200, empty.body);
  assert.equal(empty.json().steps.about.nextQuestion.key, "about.who");
  assert.ok(!empty.json().specialties.some((s: any) => ["yoga", "pilates", "combat", "endurance"].includes(s.id)));
  await withModel(
    (s) =>
      /Step 'about'/.test(s.system)
        ? setupReply(
            { publicName: "Sara Ali", specialty: "strength", city: "Dubai", audience: "Busy parents who want 5 sessions a week" },
            [{ field: "audience", question: "Who do you coach?" }],
            "Noted your name, Sara.",
          )
        : setupReply({}),
    async (sent) => {
      const turn = await request(
        "/setup-assistant/about/messages",
        "POST",
        { text: "I'm Sara Ali, strength coach in Dubai, I coach busy parents.", version: 0 },
        coach,
      );
      assert.equal(turn.statusCode, 200, turn.body);
      const view = turn.json();
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.user.step, "about");
      assert.ok(!JSON.stringify(sent[0]).includes(coach.email), "no account details are sent");
      assert.deepEqual(view.draft, { publicName: "Sara Ali", specialty: "strength", city: "Dubai" });
      assert.deepEqual(view.dropped, [{ field: "audience", reason: "number_not_stated" }]);
      assert.deepEqual(view.turns.map((t: any) => t.from), ["assistant", "coach", "assistant"]);
      assert.equal(view.turns[2].text, "Noted your name, Sara.");
      assert.equal(view.nextQuestion.key, "about.clients");
      // A stale version is refused and nothing is sent.
      const stale = await request("/setup-assistant/about/messages", "POST", { text: "Busy parents", version: 0 }, coach);
      assert.equal(stale.statusCode, 409);
      assert.equal(stale.json().code, "SETUP_CHANGED");
      assert.equal(sent.length, 1);
      // Applying the identity draft saves the existing onboarding step.
      const applied = await request("/setup-assistant/about/apply", "POST", { target: "identity", version: view.version }, coach);
      assert.equal(applied.statusCode, 200, applied.body);
      const onboarding = await request("/onboarding", "GET", undefined, coach);
      const identity = await db.tenant(coach, (tx) =>
        tx.query("SELECT data FROM records WHERE kind='onboarding_step' AND data->>'step'='identity'"),
      );
      assert.equal(onboarding.statusCode, 200);
      assert.deepEqual(
        { ...identity[0].data.values },
        { country: "AE", publicName: "Sara Ali", businessName: "Sara Ali", city: "Dubai", category: "Strength training" },
      );
      const after = (await request("/setup-assistant", "GET", undefined, coach)).json().steps.about;
      assert.ok(after.applied.identity.at);
    },
  );
  // The page draft goes into the private design draft, with the specialty from About.
  await withModel(
    () => setupReply({ headline: "Get strong without living in the gym", bio: "I help busy parents get strong with simple, steady training." }),
    async (sent) => {
      const page = await request(
        "/setup-assistant/page/messages",
        "POST",
        { text: "I help busy parents get strong without living in the gym, with simple steady training.", version: 0 },
        coach,
      );
      assert.equal(page.statusCode, 200, page.body);
      assert.equal(sent[0]!.user.earlierAnswers[0].answer, "I'm Sara Ali, strength coach in Dubai, I coach busy parents.");
      assert.equal(page.json().done, true);
      const brand = await request("/setup-assistant/page/apply", "POST", { target: "brand", version: page.json().version }, coach);
      assert.equal(brand.statusCode, 200, brand.body);
      const draft = await request("/tenant/design-draft", "GET", undefined, coach);
      assert.equal(draft.json().data.headline, "Get strong without living in the gym");
      assert.equal(draft.json().data.category, "Strength training");
      assert.equal(draft.json().data.name, "Sara Ali");
      const wrong = await request("/setup-assistant/page/apply", "POST", { target: "product", version: brand.json().step.version }, coach);
      assert.equal(wrong.statusCode, 400);
      assert.equal(wrong.json().code, "SETUP_TARGET");
    },
  );
});

test("Brain answers become teaching material (screened for personal details) and compile into draft rules", async () => {
  const coach = await register("setup-assist-brain");
  const blocked = await request(
    "/setup-assistant/brain/messages",
    "POST",
    { text: "My client Maryam (maryam@example.com) always films her lifts.", version: 0 },
    coach,
  );
  assert.equal(blocked.statusCode, 400);
  assert.equal(blocked.json().code, "PERSONAL_DATA_REMAINS");
  await withModel(
    (s) => {
      if (/Step 'brain'/.test(s.system))
        return setupReply({
          alwaysDo: ["Every new client films their first 3 sessions."],
          referOut: ["Sharp pain means stop and see a physio."],
          maxLoadJumpPct: 5,
        });
      // The existing rule compiler, reached through /brain/compile.
      return {
        rules: [
          {
            title: "Film early sessions",
            category: "communication",
            condition: "A client starts",
            directive: "Ask them to film their first 3 sessions for a technique check.",
            reason: "Coach interview",
            sourceIds: [s.user.sources?.[0]?.id ?? "S1"],
          },
        ],
        conflicts: [],
      };
    },
    async () => {
      const turn = await request(
        "/setup-assistant/brain/messages",
        "POST",
        {
          text: "Every new client films their first 3 sessions. I never add more than 5% to the weight in one go. Sharp pain means stop and see a physio.",
          version: 0,
        },
        coach,
      );
      assert.equal(turn.statusCode, 200, turn.body);
      const view = turn.json();
      assert.equal(view.interviewIds.length, 1);
      const [interview] = await db.tenant(coach, (tx) =>
        tx.query("SELECT status,data FROM records WHERE id=$1 AND kind='interview'", [view.interviewIds[0]]),
      );
      assert.equal(interview.status, "answered");
      assert.equal(interview.data.origin, "setup_assistant");
      assert.match(interview.data.question, /always do with a new client/);
      assert.equal(view.draft.maxLoadJumpPct, 5);
      const limits = await request("/setup-assistant/brain/apply", "POST", { target: "limits", version: view.version }, coach);
      assert.equal(limits.statusCode, 200, limits.body);
      assert.equal(limits.json().result.settings.bounds.maxLoadJumpPct, 5);
      assert.equal(limits.json().result.settings.bounds.maxSessionMinutes, 75, "other limits keep their safe defaults");
      const compiled = await request(
        "/setup-assistant/brain/apply",
        "POST",
        { target: "compile", version: limits.json().step.version },
        coach,
      );
      assert.equal(compiled.statusCode, 200, compiled.body);
      assert.equal(compiled.json().result.rules.length, 1);
      assert.equal(compiled.json().result.rules[0].status, "draft", "compiled rules still await the coach's confirmation");
    },
  );
});

test("the plan draft becomes a draft product, never a price the coach did not give", async () => {
  const coach = await register("setup-assist-plan");
  await withModel(
    () => setupReply({ name: "Strong Start", billing: "monthly", priceAed: 499 }, [{ field: "priceAed", question: "What price in AED?" }]),
    async () => {
      const first = await request(
        "/setup-assistant/plan/messages",
        "POST",
        { text: "Monthly, call it Strong Start. Not sure on price, maybe 400-500.", version: 0 },
        coach,
      );
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().draft.priceAed, undefined);
      assert.deepEqual(first.json().missing, ["priceAed"]);
      assert.equal(first.json().nextQuestion.text, "What price in AED?");
      const refused = await request("/setup-assistant/plan/apply", "POST", { target: "product", version: first.json().version }, coach);
      assert.equal(refused.statusCode, 409);
      assert.equal(refused.json().code, "SETUP_DRAFT_INCOMPLETE");
    },
  );
  await withModel(
    () => setupReply({ name: "Strong Start", billing: "monthly", priceAed: 450 }),
    async () => {
      const state = (await request("/setup-assistant", "GET", undefined, coach)).json().steps.plan;
      const second = await request("/setup-assistant/plan/messages", "POST", { text: "450", version: state.version }, coach);
      assert.equal(second.statusCode, 200, second.body);
      assert.equal(second.json().draft.priceAed, 450);
      assert.equal(second.json().done, true);
      const product = await request("/setup-assistant/plan/apply", "POST", { target: "product", version: second.json().version }, coach);
      assert.equal(product.statusCode, 200, product.body);
      assert.equal(product.json().result.status, "draft");
      assert.equal(product.json().result.data.priceMinor, 45000);
      assert.equal(product.json().result.data.billing, "monthly");
    },
  );
});

test("an unreadable model reply keeps the conversation going without a draft; skips need no model call", async () => {
  const coach = await register("setup-assist-invalid");
  await withModel(
    () => "not json at all",
    async (sent) => {
      const turn = await request("/setup-assistant/page/messages", "POST", { text: "I help people get strong.", version: 0 }, coach);
      assert.equal(turn.statusCode, 200, turn.body);
      assert.equal(turn.json().invalidReplies, 1);
      assert.match(turn.json().turns.at(-1).text, /couldn't turn that into a draft/);
      assert.deepEqual(turn.json().draft, {});
      assert.equal(sent.length, 1);
      const skip = await request("/setup-assistant/page/messages", "POST", { text: "skip", version: turn.json().version }, coach);
      assert.equal(skip.statusCode, 200, skip.body);
      assert.equal(sent.length, 1);
      assert.equal(skip.json().turns.at(-1).skipped, true);
      assert.equal(skip.json().version, 3);
    },
  );
  const restart = await request("/setup-assistant/page/restart", "POST", { version: 3 }, coach);
  assert.equal(restart.statusCode, 200, restart.body);
  assert.deepEqual(restart.json().turns, []);
  const erased = await request("/setup-assistant", "DELETE", undefined, coach);
  assert.equal(erased.statusCode, 200, erased.body);
  assert.equal(erased.json().deleted, 1);
  const rows = await db.tenant(coach, (tx) => tx.query("SELECT id FROM records WHERE kind='setup_conversation'"));
  assert.equal(rows.length, 0);
});

test("website text goes through the private import review before the assistant reads it; voice notes need speech-to-text", async () => {
  const coach = await register("setup-assist-site");
  const social = await request("/setup-assistant/website", "POST", { url: "instagram.com/coach", rights: true }, coach);
  assert.equal(social.statusCode, 400);
  assert.equal(social.json().code, "SOCIAL_NOT_SUPPORTED");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    String(url).startsWith("https://coach-site.test/")
      ? new Response(
          "<html><head><title>Coach Sara</title></head><body><h1>Strength coaching</h1><p>Monthly coaching for 450 AED. Email sara@coach-site.test</p></body></html>",
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        )
      : originalFetch(url, init);
  let imported: any;
  try {
    const r = await request("/setup-assistant/website", "POST", { url: "https://coach-site.test/about", rights: true }, coach);
    assert.equal(r.statusCode, 200, r.body);
    imported = r.json();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(imported.status, "needs_review");
  assert.equal(imported.data.origin, "website_import");
  assert.equal(imported.data.url, "https://coach-site.test/about");
  assert.deepEqual(imported.data.privacyMatches.map((m: any) => m.type), ["email"]);
  // Unreviewed text cannot be given to the assistant.
  const early = await request("/setup-assistant/about/sources", "POST", { sourceId: imported.id, version: 0 }, coach);
  assert.equal(early.statusCode, 404);
  const reviewed = await request(
    `/brain/imports/${imported.id}/review`,
    "POST",
    {
      revision: imported.version,
      title: "My website",
      text: "Coach Sara\nStrength coaching\nMonthly coaching for 450 AED.",
      rights: true,
      privacyReviewed: true,
    },
    coach,
  );
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  const attached = await request("/setup-assistant/plan/sources", "POST", { sourceId: reviewed.json().id, version: 0 }, coach);
  assert.equal(attached.statusCode, 200, attached.body);
  await withModel(
    () => setupReply({ name: "Monthly coaching", priceAed: 450, billing: "monthly" }),
    async (sent) => {
      const turn = await request("/setup-assistant/plan/messages", "POST", { text: "Same as on my website.", version: attached.json().version }, coach);
      assert.equal(turn.statusCode, 200, turn.body);
      assert.equal(sent[0]!.user.ownMaterial[0].text, "Coach Sara\nStrength coaching\nMonthly coaching for 450 AED.");
      assert.equal(turn.json().draft.priceAed, 450, "a number from the coach's own reviewed material");
    },
  );
  const voice = await request(
    "/setup-assistant/about/voice",
    "POST",
    { audio: Buffer.from("OggS" + "x".repeat(64)).toString("base64"), type: "audio/ogg", durationMs: 4000, consent: true },
    coach,
  );
  assert.equal(voice.statusCode, 503);
  assert.equal(voice.json().code, "SPEECH_UNAVAILABLE");
  const anonymous = await request("/setup-assistant");
  assert.equal(anonymous.statusCode, 401);
});
