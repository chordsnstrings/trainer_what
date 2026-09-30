// The coach setup wizard's screens (docs/features/setup-wizard.md): the
// address rules, the step decisions, the sign-up screen that leads into the
// wizard and how the workspace routes to it. The API behind it is tested in
// coach-setup.test.ts, brain-teach.test.ts and setup-assistant.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SETUP_STEPS } from "@trainer/contracts";
import {
  CHAT_STEPS,
  SETUP_PATH,
  aboutFromDraft,
  pageFromDraft,
  planFromDraft,
  apiError,
  brainChecklist,
  canSkip,
  checkStep,
  emirateLabel,
  flagWords,
  goLiveGroups,
  hasChat,
  isSetupPath,
  legacySetupRedirect,
  meterText,
  neighbours,
  priceMinor,
  quizPosition,
  ruleGroups,
  setupHref,
  setupView,
  subdomainInput,
  subdomainLine,
  suggestedPlanName,
  timeLeft,
  type QuizCase,
  type RuleCard,
} from "../apps/web/components/setup-wizard-model.ts";
import { Public } from "../apps/web/components/public-pages.tsx";
import { claimCta } from "../apps/web/components/marketing/frame.tsx";

const source = (path: string) =>
  readFile(new URL("../apps/web/" + path, import.meta.url), "utf8");

test("wizard addresses: /setup and the /trainer/setup alias, steps, Keep training and resume", () => {
  assert.equal(SETUP_PATH, "/setup");
  for (const path of ["/setup", "/setup/", "/setup/page", "/trainer/setup", "/trainer/setup/brain"])
    assert.ok(isSetupPath(path), path);
  for (const path of ["/setupx", "/trainer/settings", "/trainer/onboarding/identity", "/app/setup"])
    assert.ok(!isSetupPath(path), path);
  assert.deepEqual(setupView("/setup"), { step: null, keepTraining: false });
  assert.deepEqual(setupView("/setup/plan"), { step: "plan", keepTraining: false });
  assert.deepEqual(setupView("/trainer/setup/live"), { step: "live", keepTraining: false });
  assert.deepEqual(setupView("/setup/keep-training"), { step: null, keepTraining: true });
  // An unknown segment resumes where the coach left off.
  assert.deepEqual(setupView("/setup/nope"), { step: null, keepTraining: false });
  assert.equal(setupHref("brain"), "/setup/brain");
  assert.deepEqual(
    SETUP_STEPS.map((s) => s.key),
    ["account", "about", "page", "brain", "plan", "live"],
  );
  assert.deepEqual(neighbours("account"), { previous: null, next: "about" });
  assert.deepEqual(neighbours("brain"), { previous: "page", next: "plan" });
  assert.deepEqual(neighbours("live"), { previous: "plan", next: null });
  // Every step but account and go-live can be done by chat or skipped.
  assert.deepEqual([...CHAT_STEPS], ["about", "page", "brain", "plan"]);
  assert.ok(!hasChat("account") && !hasChat("live") && hasChat("page"));
  assert.ok(!canSkip("account") && !canSkip("live") && canSkip("plan"));
  assert.equal(timeLeft(9), "About 9 minutes left");
  assert.equal(timeLeft(1), "About 1 minute left");
  assert.equal(timeLeft(0), "All done");
});

test("older checklist addresses open the matching wizard step; the rest keep working", () => {
  assert.equal(legacySetupRedirect("/trainer/onboarding"), "/setup");
  assert.equal(legacySetupRedirect("/trainer/onboarding/identity"), "/setup/about");
  assert.equal(legacySetupRedirect("/trainer/onboarding/identity/"), "/setup/about");
  assert.equal(legacySetupRedirect("/trainer/onboarding/preview"), "/setup/page");
  assert.equal(legacySetupRedirect("/trainer/onboarding/offer"), "/setup/plan");
  assert.equal(legacySetupRedirect("/trainer/onboarding/publish"), "/setup/live");
  for (const kept of ["share", "payout", "interview", "uploads", "scenarios", "nutrition-policy"])
    assert.equal(legacySetupRedirect("/trainer/onboarding/" + kept), null, kept);
});

test("the web address field: typed names become address names; the status line", () => {
  assert.equal(subdomainInput("Alex Morgan"), "alex-morgan");
  assert.equal(subdomainInput("Zoë_Fit.Coach!"), "zoe-fit-coach");
  assert.equal(subdomainInput("a".repeat(60)).length, 40);
  const base = { name: "alex", host: "alex.trainsyou.com", reason: null, message: null };
  assert.deepEqual(subdomainLine(null, true), { tone: "muted", text: "Checking…" });
  assert.equal(subdomainLine(null, false), null);
  assert.deepEqual(
    subdomainLine({ ...base, available: true, current: false }, false),
    { tone: "success", text: "alex.trainsyou.com is free." },
  );
  assert.equal(
    subdomainLine({ ...base, available: true, current: true }, false)?.text,
    "This is your address.",
  );
  assert.deepEqual(
    subdomainLine(
      { ...base, available: false, current: false, reason: "taken", message: "This address is taken. Please choose another." },
      false,
    ),
    { tone: "error", text: "This address is taken. Please choose another." },
  );
});

test("Teach your Brain: Approve all takes only warning-free drafts; flagged ones stay one by one", () => {
  const rule = (id: string, status: "draft" | "confirmed", flags: string[] = []): RuleCard => ({
    id,
    version: 1,
    status,
    title: id,
    flags,
    warning: flags.length > 0,
  });
  const groups = ruleGroups([
    rule("a", "draft"),
    rule("b", "draft", ["medical_advice"]),
    rule("c", "confirmed"),
    rule("d", "draft"),
  ]);
  assert.deepEqual(groups.clean.map((r) => r.id), ["a", "d"]);
  assert.deepEqual(groups.flagged.map((r) => r.id), ["b"]);
  assert.deepEqual(groups.approved.map((r) => r.id), ["c"]);
  assert.deepEqual(flagWords(["medical_advice", "red_flag_not_stopped", "something_new"]), [
    "sounds like medical advice",
    "does not stop for a health warning sign",
    "something new",
  ]);
  const list = brainChecklist({
    approvedRules: 2,
    flaggedDrafts: 1,
    quizDone: false,
    ownCases: 1,
    ownNeeded: 3,
  });
  assert.deepEqual(
    list.map((i) => [i.key, i.done, i.detail]),
    [
      ["rules", false, "1 flagged rule still to check"],
      ["quiz", false, "8 to 10 questions"],
      ["cases", false, "1 of 3"],
    ],
  );
  assert.ok(
    brainChecklist({ approvedRules: 4, flaggedDrafts: 0, quizDone: true, ownCases: 5, ownNeeded: 3 }).every(
      (i) => i.done,
    ),
  );
});

test("the practice quiz shows the first unanswered question and counts answers", () => {
  const c = (id: string, answered: boolean): QuizCase => ({
    id,
    source: id === "s" ? "platform" : "rule",
    message: "m",
    route: id === "s" ? "escalate" : "reply",
    reply: "r",
    answer: answered ? { verdict: "yes", reply: null } : null,
  });
  const mid = quizPosition([c("a", true), c("s", false), c("b", false)]);
  assert.equal(mid.current?.id, "s");
  assert.equal(mid.number, 2);
  assert.equal(mid.answered, 1);
  assert.equal(mid.total, 3);
  const done = quizPosition([c("a", true), c("b", true)]);
  assert.equal(done.current, null);
  assert.equal(done.answered, 2);
});

test("plan and go-live helpers: suggested name, prices the coach types, checks in plain order", () => {
  assert.equal(suggestedPlanName("Alex Morgan", "Strength training"), "Strength training coaching with Alex");
  assert.equal(suggestedPlanName("Sara", "Online coaching"), "Online coaching with Sara");
  assert.equal(suggestedPlanName("", null), "Coaching");
  assert.equal(priceMinor("450"), 45000);
  assert.equal(priceMinor("AED 1,200.50"), 120050);
  assert.equal(priceMinor("12.345"), null);
  assert.equal(priceMinor("free"), null);
  assert.equal(emirateLabel("ras_al_khaimah"), "Ras Al Khaimah");
  const groups = goLiveGroups([
    { key: "real_name", label: "Your real name", owner: "coach", ok: true },
    { key: "brain_minimum", label: "Brain taught", owner: "coach", ok: false, reason: "Finish a quiz" },
    { key: "legal", label: "Legal documents", owner: "trainsyou", ok: false },
    { key: "model", label: "Coaching service", owner: "trainsyou", ok: true },
  ]);
  assert.deepEqual(groups.coach.map((c) => c.key), ["real_name", "brain_minimum"]);
  assert.deepEqual(groups.open.map((c) => c.key), ["brain_minimum"]);
  assert.deepEqual(groups.trainsyou.map((c) => c.key), ["legal"]);
  assert.equal(checkStep("brain_minimum"), "brain");
  assert.equal(checkStep("subdomain"), "page");
  assert.equal(checkStep("priced_plan"), "plan");
  assert.equal(checkStep("authenticator"), null);
  assert.equal(meterText(62.4), "62 of 100");
  assert.equal(meterText(140), "100 of 100");
  const e = apiError(403, { code: "MFA_STEP_UP", message: "Enter your authenticator code" });
  assert.equal(e.code, "MFA_STEP_UP");
  assert.equal(e.status, 403);
  assert.equal(apiError(500, {}).message, "Something went wrong. Please try again.");
});

test("assistant drafts fill the short forms; nothing the checks removed comes back", () => {
  const offered = {
    specialties: [{ id: "strength" }, { id: "weight_loss" }],
    emirates: ["abu_dhabi", "dubai", "ras_al_khaimah"],
  };
  assert.deepEqual(
    aboutFromDraft(
      { publicName: " Alex Morgan ", specialty: "strength", audience: "Busy parents", city: "Ras Al Khaimah" },
      offered,
    ),
    { name: "Alex Morgan", specialty: "strength", audience: "Busy parents", emirate: "ras_al_khaimah" },
  );
  // A hidden or unknown specialty and a city outside the list stay unset.
  assert.deepEqual(aboutFromDraft({ specialty: "yoga", city: "London", audience: null }, offered), {});
  assert.deepEqual(aboutFromDraft({ city: "Dubai" }, offered), { emirate: "dubai" });
  // Live assistant drafts name areas and cities, not only emirates.
  assert.deepEqual(aboutFromDraft({ city: "Dubai Marina and JLT" }, offered), { emirate: "dubai" });
  assert.deepEqual(aboutFromDraft({ city: "Al Ain" }, offered), { emirate: "abu_dhabi" });
  assert.deepEqual(pageFromDraft({ headline: "h".repeat(200), bio: "  ", extra: 1 }), {
    headline: "h".repeat(160),
  });
  assert.deepEqual(
    planFromDraft({ name: "Strong at home", priceAed: 450, billing: "upfront", programmeDays: 84, description: null }),
    { name: "Strong at home", price: "450", billing: "upfront", days: "84" },
  );
  // No price in the draft: the price field stays for the coach to fill.
  assert.deepEqual(planFromDraft({ name: "Plan", priceAed: null, billing: "yearly" }), { name: "Plan" });
});

test("Start coaching leads to sign-up, and sign-up to the wizard, with no address field up front", () => {
  assert.deepEqual(claimCta(true), { label: "Start coaching", href: "/signup" });
  assert.deepEqual(claimCta(false), { label: "Join early access", href: "/get-started#early-access" });
  const signup = renderToStaticMarkup(
    createElement(Public, {
      path: "/signup",
      platform: { name: "trainsyou", initials: "T", registrationOpen: true },
      coachSlug: null,
      colorScheme: "system",
      onAuthenticated: async () => {},
    }),
  );
  assert.match(signup, /<h2>Start coaching<\/h2>/);
  assert.match(signup, /About 15 minutes to your own page/);
  // The web address is chosen in the wizard with a live check, not here.
  assert.doesNotMatch(signup, /Your coaching address|name="slug"|\/coach\//);
  assert.match(signup, /Start my setup/);
});

test("the workspace opens the wizard, redirects the older checklist and lands sign-up there", async () => {
  const workspace = await source("components/workspace.tsx");
  assert.match(workspace, /isSetupPath\(path\) \?/);
  assert.match(workspace, /<SetupWizard path=\{path\} tenant=\{state\.tenant\} onSaved=\{load\} \/>/);
  assert.match(workspace, /legacySetupRedirect\(path\) \?/);
  // One navigation: the four-section menu shows "Finish setup" (the wizard)
  // until the page is live, and every setup link uses the wizard's address.
  assert.match(workspace, /setupOpen && \(\s*<Link\s+href=\{SETUP_HREF\}[\s\S]{0,300}Finish setup/);
  const nav = await source("components/workspace-nav.tsx");
  assert.match(nav, /export const SETUP_HREF = SETUP_PATH;/);
  // After the wizard, My Brain leads to "Keep training".
  const brain = await source("components/workspace-brain.tsx");
  assert.match(brain, /href=\{setupHref\(KEEP_TRAINING\)\}/);
  assert.match(workspace, /path === "\/signup"\s*\?\s*SETUP_PATH/);
  const layout = await source("app/layout.tsx");
  assert.match(layout, /import "\.\/setup-wizard\.css";/);
});

test("wizard fields are named by their label alone, not by their value or selected option", async () => {
  // A select inside its <label> is otherwise announced with the chosen
  // option ("Your specialty Choose one"); an explicit name keeps it exact.
  const wizard = await source("components/setup-wizard.tsx");
  assert.match(wizard, /aria-label="Your specialty"\s+value=\{values\.specialty\}/);
  assert.match(wizard, /aria-label="Where you coach"\s+value=\{values\.emirate\}/);
  const brain = await source("components/setup-brain.tsx");
  assert.match(brain, /aria-label="Which of your rules answers it"/);
  // The same holds for text fields once they have a value ("Who you coach
  // Adults building..."), so every field inside a label carries its own name.
  for (const [file, text] of [["setup-wizard.tsx", wizard], ["setup-brain.tsx", brain]])
    for (const m of text.matchAll(/<label className="field">([\s\S]*?)<\/label>/g)) {
      const control = m[1].match(/<(input|textarea|select)\b[^>]*/);
      if (!control || /type="checkbox"/.test(control[0])) continue;
      assert.match(control[0], /aria-label=/, `${file}: ${m[1].slice(0, 80)}`);
    }
});

test("wizard screens use plain words and never name a model or its maker", async () => {
  const files = [
    "components/setup-wizard.tsx",
    "components/setup-brain.tsx",
    "components/setup-assistant-panel.tsx",
    "components/setup-wizard-model.ts",
  ];
  for (const file of files) {
    const text = await source(file);
    // Only visible strings matter; strip comments first.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(
      code,
      /\b(Claude|Anthropic|OpenAI|GPT|Gemini|Seed|BytePlus|ModelArk|ByteDance|LLM)\b/,
      file,
    );
    // Jargon replaced by plain words (docs/features/setup-wizard.md).
    assert.doesNotMatch(
      code,
      />[^<]*\b(Constitution|Scenario lab|held-out|Qualified automatic|Supervised delivery|Storefront)\b/i,
      file,
    );
  }
  const brain = await source("components/setup-brain.tsx");
  assert.match(brain, /Approve all \{clean\.length\}/);
  assert.match(brain, /Would you reply like this\?/);
  assert.match(brain, /acknowledgeFlags: true/);
  const wizard = await source("components/setup-wizard.tsx");
  for (const words of ["Save and continue later", "Skip for later", "Chat with the assistant", "Waiting on trainsyou", "Go live"])
    assert.ok(wizard.includes(words), words);
});
