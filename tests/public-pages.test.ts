// Public, joining and sign-in pages as a subscriber sees them, phone first
// (docs/features/phone-first.md, "Public, joining and sign-in pages"): the
// legal status the joining forms follow and how it matches what the API
// records, the coach's join flow, sign-in, the subscriber footer, the coach
// directory and website, the legal pages, leaving a coach and the
// mobile-first stylesheets.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { legalStatus } from "../apps/api/src/legal.ts";
import { passwordHash } from "../apps/api/src/auth.ts";
import {
  LegalAcceptance,
  acceptanceGiven,
  legalPlan,
  listWords,
} from "../apps/web/components/legal-acceptance.tsx";
import { SubscriberFooter } from "../apps/web/components/subscriber-footer.tsx";
import {
  Public,
  readLeftCoach,
  LEFT_COACH_KEY,
} from "../apps/web/components/public-pages.tsx";
import { rememberLeftCoach } from "../apps/web/components/membership-exit.tsx";
import {
  AccountJoinForm,
  JoinAccountChoice,
  joinErrorMessage,
} from "../apps/web/components/joining.tsx";
import {
  PublishedLegal,
  legalDate,
} from "../apps/web/components/published-legal.tsx";
import { CoachDirectory } from "../apps/web/components/coach-directory.tsx";
import { CoachWebsite } from "../apps/web/components/coach-site.tsx";

const html = (type: any, props: any) =>
  renderToStaticMarkup(createElement(type, props));
const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");
const platform = { name: "trainsyou", initials: "T", registrationOpen: true };
const noop = async () => {};

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const password = "SyntheticPublicPages2026!";
const saved = { NODE_ENV: process.env.NODE_ENV, LEGAL_APPROVED: process.env.LEGAL_APPROVED };
before(async () => {
  Reflect.deleteProperty(process.env, "NODE_ENV");
  Reflect.deleteProperty(process.env, "LEGAL_APPROVED");
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
});
let address = 0;
const call = (path: string, body?: unknown) =>
  app.inject({
    method: body === undefined ? "GET" : "POST",
    url: "/api/v1" + path,
    payload: body as any,
    remoteAddress: `10.77.0.${++address}`,
    headers: { host: "localhost:3000", origin: "http://localhost:3000" },
  });
async function publish(key: string) {
  const author = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,'Legal author',$2,'synthetic',true)",
      [author, `legal-${author}@example.test`],
    );
    await tx.query(
      "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at) VALUES($1,'legal',$2,1,$3,'Synthetic fixture text.','published',now()-interval '1 day',$4,$4,now())",
      [randomUUID(), key, "Fixture " + key, author],
    );
  });
}

test("the legal status says which documents a form may ask people to accept", async () => {
  // Nothing published (local development): joining stays open, and the API
  // records each document as a development draft.
  const empty = (await call("/public/legal-status")).json();
  assert.equal(empty.joiningOpen, true);
  assert.deepEqual(
    empty.documents.map((d: any) => [d.key, d.published]),
    [
      ["terms", false],
      ["privacy", false],
      ["ai-disclosure", false],
    ],
  );
  assert.deepEqual(legalPlan(empty), {
    open: true,
    ask: [],
    pending: ["terms", "privacy", "ai-disclosure"],
  });
  // Strict security (production) refuses joining until the documents are
  // approved and published, exactly as /auth/enroll and the invitation
  // routes do.
  assert.equal(
    (await legalStatus(db, { NODE_ENV: "production" })).joiningOpen,
    false,
  );
  await publish("terms");
  const one = (await call("/public/legal-status")).json();
  assert.deepEqual(
    one.documents.filter((d: any) => d.published).map((d: any) => [d.key, d.version]),
    [["terms", 1]],
  );
  assert.deepEqual(legalPlan(one).ask, ["terms"]);
  assert.equal(
    (await legalStatus(db, { NODE_ENV: "production", LEGAL_APPROVED: "true" }))
      .joiningOpen,
    false,
    "an unpublished document keeps strict joining closed",
  );
  await publish("privacy");
  await publish("ai-disclosure");
  assert.equal(
    (await legalStatus(db, { NODE_ENV: "production", LEGAL_APPROVED: "true" }))
      .joiningOpen,
    true,
  );
});

test("a coach's join page takes a name for a new account only", async () => {
  const tenantId = randomUUID(),
    slug = "join-" + tenantId.slice(0, 8);
  const existing = randomUUID(),
    email = `existing-${existing}@example.test`;
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,'Synthetic Coach',true)",
      [tenantId, slug],
    );
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,'Existing Member',$2,$3,true)",
      [existing, email, await passwordHash(password)],
    );
  });
  const missing = await call("/auth/enroll", {
    email: `new-${randomUUID()}@example.test`,
    password,
    coachSlug: slug,
    accepted: true,
  });
  assert.equal(missing.statusCode, 400, missing.body);
  assert.equal(missing.json().code, "NAME_REQUIRED");
  // "I already have an account": no name, the existing password.
  const joined = await call("/auth/enroll", {
    email,
    password,
    coachSlug: slug,
    accepted: true,
  });
  assert.equal(joined.statusCode, 201, joined.body);
  const [membership] = await db.system((tx) =>
    tx.query("SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      tenantId,
      existing,
    ]),
  );
  assert.equal(membership.role, "subscriber");
  const [user] = await db.system((tx) =>
    tx.query("SELECT name FROM users WHERE id=$1", [existing]),
  );
  assert.equal(user.name, "Existing Member", "the account keeps its name");
});

test("joining forms never ask anyone to accept an unpublished document", () => {
  const status = (published: string[], joiningOpen = true) => ({
    joiningOpen,
    documents: (["terms", "privacy", "ai-disclosure"] as const).map((key) => ({
      key,
      published: published.includes(key),
    })),
  });
  const render = (plan: ReturnType<typeof legalPlan>) =>
    html(LegalAcceptance, { plan, checked: false, onChange: () => {} });
  const all = render(legalPlan(status(["terms", "privacy", "ai-disclosure"])));
  assert.match(all, /type="checkbox"[^>]*required/);
  assert.match(all, /href="\/terms"[^>]*>terms of service</);
  assert.match(all, /href="\/privacy"[^>]*>privacy policy</);
  assert.match(all, /href="\/ai-disclosure"[^>]*>digital coaching disclosure</);
  assert.doesNotMatch(all, /published terms|not published/);
  const some = render(legalPlan(status(["privacy"])));
  assert.match(some, /I accept the <span><a target="_blank" rel="noopener" href="\/privacy">privacy policy<\/a><\/span>\./);
  assert.doesNotMatch(some, /href="\/terms"/);
  assert.match(
    some,
    /The platform’s terms of service and digital coaching disclosure are not published yet, so you are not asked to accept them\./,
  );
  const none = render(legalPlan(status([])));
  assert.doesNotMatch(none, /checkbox/);
  assert.match(none, /are not published yet, so you are not asked to accept them/);
  assert.equal(render(legalPlan(status([], false))), "", "closed: the page explains");
  // What the form may send.
  assert.equal(acceptanceGiven(legalPlan(status([])), false), true);
  assert.equal(acceptanceGiven(legalPlan(status(["terms"])), false), false);
  assert.equal(acceptanceGiven(legalPlan(status(["terms"])), true), true);
  assert.equal(acceptanceGiven(legalPlan(status([], false)), true), false);
  // Before the status loads the form asks for all three, as before.
  assert.deepEqual(legalPlan(null).ask, ["terms", "privacy", "ai-disclosure"]);
  assert.equal(listWords(["a", "b", "c"]), "a, b and c");
});

test("the join flow is short: account choice, one column, no authenticator or forgotten password", () => {
  const choice = html(JoinAccountChoice, { mode: "new", onChange: () => {} });
  assert.match(choice, /<fieldset class="join-choice">/);
  assert.match(choice, /class="join-choice-card is-selected"[\s\S]*I’m new here/);
  assert.match(choice, /I already have an account/);
  const form = html(AccountJoinForm, {
    legal: null,
    formId: "join-coach-form",
    coachName: "Alex Morgan",
    newNote: "Use an email address you can open.",
    submit: noop,
    onJoined: noop,
  });
  assert.match(form, /autoComplete="name"|autocomplete="name"/i);
  assert.match(form, /type="email"[^>]*inputMode="email"|inputmode="email"/i);
  assert.match(form, /autocomplete="new-password"/i);
  assert.match(form, /enterkeyhint="next"/i);
  assert.doesNotMatch(form, /Authenticator|one-time-code|Forgot your password/);
  assert.doesNotMatch(form, /Welcome back|Pick up exactly|trainer/i);
  // The main action is in the sticky bar (and inline from 768 px), and says
  // why it waits while the terms are not accepted.
  assert.match(
    form,
    /class="sticky-action-bar"[\s\S]*<button class="button" type="submit" form="join-coach-form" disabled="">Join Alex Morgan<\/button>/,
  );
  assert.match(form, /Tick the box above to accept the terms\./);
  assert.equal(
    joinErrorMessage({ code: "INVALID_LOGIN", message: "x" }, "new"),
    "An account already uses this email address. Choose “I already have an account” and enter its password.",
  );
  assert.match(
    joinErrorMessage({ code: "LEGAL_PENDING", message: "x" }, "existing"),
    /publishes its approved terms/,
  );
});

test("joining and sign-in pages are the subscriber's, not the trainer marketing funnel", () => {
  const render = (path: string, coachSlug: string | null = null) =>
    html(Public, { path, platform, coachSlug, onAuthenticated: noop });
  const join = render("/join-coach/alex-morgan");
  assert.match(join, /<main class="auth-page is-wide" id="main">/);
  assert.match(join, /<h1>Join your coach<\/h1>/, "the coach's name replaces it once loaded");
  assert.match(join, /class="subscriber-header"/);
  assert.doesNotMatch(
    join,
    /Welcome back|Pick up exactly|YOUR KNOWLEDGE|Your judgment|Authenticator|Forgot your password|New to trainsyou|mk-footer|Earnings calculator|For trainers/,
  );
  assert.match(join, /class="subscriber-footer"/);
  assert.match(join, /data-analytics-preferences/);
  const invite = render("/join/" + "t".repeat(43));
  assert.match(invite, /Checking your invitation/);
  assert.doesNotMatch(invite, /mk-footer|Meet your next chapter|Teach your AI/);
  const signIn = render("/login");
  assert.match(signIn, /<h1>Sign in<\/h1>/);
  assert.match(signIn, /autocomplete="email"/i);
  assert.match(signIn, /autocomplete="current-password"/i);
  // The authenticator field appears only once the account asks for it.
  assert.doesNotMatch(signIn, /one-time-code|Authenticator code/);
  // Every other way in is a matching secondary action.
  assert.match(signIn, /class="auth-alternatives"/);
  assert.match(signIn, /<a class="button secondary" href="\/magic-link">Email me a sign-in link<\/a>/);
  assert.match(signIn, /href="\/coaches">Find a coach/);
  assert.doesNotMatch(signIn, /mk-footer|YOUR KNOWLEDGE|Pick up exactly/);
  // On a coach's own address: that coach, never the platform sign-up.
  const host = render("/login", "alex-morgan");
  assert.match(host, /href="\/join-coach\/alex-morgan"/);
  assert.doesNotMatch(host, /href="\/signup"|Teach your AI/);
  for (const path of ["/forgot-password", "/magic-link"]) {
    const page = render(path);
    assert.match(page, /<main class="auth-page" id="main">/, path);
    assert.match(page, /class="auth-return"/, path);
    assert.doesNotMatch(page, /mk-footer|auth-layout/, path);
  }
  // Trainer sign-up stays in the trainer funnel.
  const signup = render("/signup");
  assert.match(signup, /mk-footer/);
  assert.match(signup, /Now build the business/);
});

test("the subscriber footer has help and legal links and the analytics entry, nothing for trainers", () => {
  const footer = html(SubscriberFooter, { name: "trainsyou" });
  assert.match(footer, /href="\/coaches">Find a coach/);
  assert.match(footer, /href="\/terms"/);
  assert.match(footer, /data-analytics-preferences=""/);
  assert.doesNotMatch(footer, /calculator|For trainers|Advertiser|Trainer Brain|Client Twin|signup/i);
  const coach = html(SubscriberFooter, {
    name: "Alex Morgan",
    coach: true,
    directory: false,
    analytics: false,
  });
  assert.match(coach, /© \d{4} Alex Morgan</);
  assert.doesNotMatch(coach, /coaches|data-analytics-preferences|trainsyou/);
});

test("the coach directory's empty state gives a next step", () => {
  const data = {
    coaches: [],
    nextOffset: null,
    query: { q: "", specialty: "", language: "", offset: 0 },
    options: { specialties: [], languages: [] },
  };
  const page = html(CoachDirectory, { data, platformName: "trainsyou" });
  assert.match(page, /No coaches are listed yet\./);
  assert.match(page, /Have a link or an invitation from a coach\?/);
  assert.match(page, /<a class="button" href="\/login">Sign in<\/a>/);
  assert.match(page, /class="subscriber-footer"/);
  assert.doesNotMatch(page, /mk-footer/);
  assert.match(page, /enterkeyhint="search"/i);
  const filtered = html(CoachDirectory, {
    data: { ...data, query: { ...data.query, q: "yoga" } },
    platformName: "trainsyou",
  });
  assert.match(filtered, /No coaches match this search\./);
  assert.match(filtered, /<a class="button" href="\/coaches">Clear filters<\/a>/);
});

const site = (overrides: Record<string, unknown> = {}, products: any[] = []) => ({
  tenant: {
    slug: "alex-morgan",
    name: "Alex Morgan",
    theme: {
      headline: "Strong for life.",
      bio: "I help busy people build lasting strength.",
      category: "Strength",
    },
    published: true,
  },
  site: {
    headline: "",
    introduction: "",
    about: "",
    contactEmail: "alex@example.test",
    whatsapp: "+971501234567",
    instagram: "https://instagram.com/synthetic",
    youtube: "",
    cta: "Start coaching",
    seoTitle: "",
    seoDescription: "",
    pages: [],
    ...overrides,
  },
  galleries: [],
  products,
});

test("a coach's website is phone first: one action in thumb reach, no repeated intro, helpful empty states", () => {
  const render = (path: string, data = site(), preview = false) =>
    html(CoachWebsite, { initialData: data, path, language: "en", preview });
  const home = render("");
  // The intro appears once; "Meet your coach" never repeats it.
  assert.equal(home.match(/I help busy people build lasting strength\./g)?.length, 1);
  assert.match(home, /class="site-portrait is-placeholder/, "an intentional placeholder");
  // No plans listed: the action is a message.
  assert.match(
    home,
    /class="sticky-action-bar"[\s\S]*<a class="button" href="\/coach\/alex-morgan\/contact">Contact Alex Morgan<\/a>/,
  );
  assert.match(home, /<a aria-current="page" dir="auto" href="\/coach\/alex-morgan">Home<\/a>/);
  assert.match(home, /class="subscriber-footer"/);
  const about = render("about");
  assert.doesNotMatch(about, /I help busy people/, "About does not repeat the home introduction");
  assert.match(about, /Send a question and Alex Morgan will reply by email/);
  const plans = render("memberships");
  assert.match(plans, /Plans are not listed yet/);
  assert.match(plans, /Send a message to ask about coaching/);
  const withPlan = render(
    "memberships",
    site({}, [{ id: "p1", data: { name: "Everyday strength", priceMinor: 19900, tier: "workout" } }]),
  );
  assert.match(withPlan, /Everyday strength/);
  assert.match(
    withPlan,
    /class="sticky-action-bar"[\s\S]*<a class="button secondary" href="\/coach\/alex-morgan\/contact">Contact<\/a><a class="button" href="\/join-coach\/alex-morgan">Join Alex Morgan<\/a>/,
  );
  const galleries = render("galleries");
  assert.match(galleries, /No photos yet/);
  const contact = render("contact");
  assert.match(contact, /<form id="coach-contact-form" class="card site-contact-form"/);
  assert.match(contact, /autocomplete="name"/i);
  assert.match(contact, /autocomplete="email"/i);
  assert.match(
    contact,
    /<label class="check-field site-consent"><input (?=[^>]*type="checkbox")(?=[^>]*required="")[^>]*name="consent"[^>]*\/><span>I agree to be contacted/,
  );
  assert.match(contact, /<button class="button" type="submit">Send message<\/button>/);
  assert.match(contact, /<button class="button" type="submit" form="coach-contact-form">Send message<\/button>/);
  // Links to other sites open outside an installed app.
  assert.match(contact, /href="https:\/\/wa\.me\/971501234567" target="_blank" rel="noopener noreferrer"/);
  // The trainer's private preview has no sticky bar and no analytics entry.
  const preview = render("", site(), true);
  assert.doesNotMatch(preview, /sticky-action-bar|data-analytics-preferences/);
});

test("legal pages read well on a phone and never show internal labels", () => {
  const terms = html(PublishedLegal, { documentKey: "terms", platformName: "trainsyou" });
  assert.match(terms, /<main class="legal-page" id="main"><a class="legal-home" href="\/">/);
  assert.match(terms, /<h1 id="legal-title">Terms of service<\/h1>/);
  assert.doesNotMatch(terms, /PLATFORM DOCUMENT/);
  assert.match(html(PublishedLegal, { documentKey: "ai-disclosure" }), /Digital coaching disclosure/);
  assert.equal(legalDate("2026-09-29T14:07:33Z"), "29 Sept 2026");
  assert.equal(legalDate(null), "");
});

test("leaving a coach ends on a confirmation, once", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  rememberLeftCoach(storage, "Alex Morgan", true, 1_000);
  assert.deepEqual(readLeftCoach(storage, 2_000), {
    coach: "Alex Morgan",
    renewalCancelled: true,
    at: 1_000,
  });
  assert.equal(store.has(LEFT_COACH_KEY), false, "read once");
  rememberLeftCoach(storage, "Alex Morgan", false, 1_000);
  assert.equal(readLeftCoach(storage, 1_000 + 11 * 60_000), null, "an old note is never shown");
  store.set(LEFT_COACH_KEY, "not json");
  assert.equal(readLeftCoach(storage), null);
});

test("leaving asks in an in-app bottom sheet, not the browser's checkbox tooltip", async () => {
  const exit = await source("apps/web/components/membership-exit.tsx");
  const leave = exit.slice(
    exit.indexOf("export function LeaveTrainer"),
    exit.indexOf("/** The trainer owner ends a follower"),
  );
  assert.match(leave, /<BottomSheet/);
  assert.doesNotMatch(leave, /type="checkbox"/);
  assert.match(leave, /window\.location\.assign\("\/login\?left=1"\)/);
  assert.match(leave, /Stay with \{name\}/);
});

test("the subscriber stylesheets are mobile first", async () => {
  const css = await source("apps/web/app/subscriber-public.css");
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  assert.match(css, /font-size: 16px;\s*min-block-size: 48px;/);
  const directory = await source("apps/web/app/coach-directory.css");
  assert.doesNotMatch(directory, /@media[^{]*max-width/);
  const coachSite = await source("apps/web/app/coach-site.css");
  // Only the trainer's website editor keeps a max-width rule.
  const maxWidth = [...coachSite.matchAll(/@media[^{]*max-width[^{]*\{([\s\S]*?)\n\}/g)];
  assert.equal(maxWidth.length, 1);
  assert.match(maxWidth[0][1], /^\s*\.photo-edit-list li \{[^}]*\}\s*$/);
  const layout = await source("apps/web/app/layout.tsx");
  assert.match(layout, /import "\.\/phone-first\.css";\nimport "\.\/subscriber-public\.css";/);
});
