// Right-to-left (Arabic-ready) layout: document language resolution, the
// proxy's ?lang= handling, the coach website language and component markup.
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { z } from "zod";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDatabase, type Database } from "@trainer/db";
import { registerCoachSite } from "../apps/api/src/coach-site.ts";
import {
  LANGUAGE_COOKIE,
  MEMBER_LANGUAGE_COOKIE,
  coachSiteSlug,
  directionOf,
  isWorkspacePath,
  languageCookie,
  languageFromCookieHeader,
  pageLanguage,
  parseLanguage,
  resolveDocumentLanguage,
} from "../apps/web/document-language.ts";
import { rememberMemberLanguage } from "../apps/web/components/document-direction.tsx";
import { proxy } from "../apps/web/proxy.ts";
import { CoachWebsite } from "../apps/web/components/coach-site.tsx";

test("document language: explicit query, then cookie, then the coach website, then the member, then English", () => {
  assert.deepEqual(resolveDocumentLanguage({}), {
    lang: "en",
    dir: "ltr",
    source: "default",
  });
  assert.deepEqual(resolveDocumentLanguage({ site: "ar" }), {
    lang: "ar",
    dir: "rtl",
    source: "site",
  });
  assert.deepEqual(resolveDocumentLanguage({ cookie: "ar", site: "en" }), {
    lang: "ar",
    dir: "rtl",
    source: "cookie",
  });
  assert.deepEqual(
    resolveDocumentLanguage({ query: "en", cookie: "ar", site: "ar" }),
    { lang: "en", dir: "ltr", source: "query" },
  );
  // A member's mirrored language is a preference, not a choice: it never
  // overrides a coach website's own language on public pages.
  assert.deepEqual(resolveDocumentLanguage({ site: "ar", member: "en" }), {
    lang: "ar",
    dir: "rtl",
    source: "site",
  });
  assert.deepEqual(resolveDocumentLanguage({ cookie: "en", member: "ar" }), {
    lang: "en",
    dir: "ltr",
    source: "cookie",
  });
  assert.deepEqual(resolveDocumentLanguage({ member: "ar" }), {
    lang: "ar",
    dir: "rtl",
    source: "member",
  });
  // In the workspace the member's saved language decides.
  assert.deepEqual(
    resolveDocumentLanguage({
      query: "en",
      cookie: "en",
      member: "ar",
      workspace: true,
    }),
    { lang: "ar", dir: "rtl", source: "member" },
  );
  assert.deepEqual(
    resolveDocumentLanguage({ cookie: "ar", site: "en", workspace: true }),
    { lang: "ar", dir: "rtl", source: "cookie" },
  );
  // Anything but the two supported values is ignored at every step.
  for (const bad of ["fr", "AR", "ar-AE", "", " ar", "<rtl>", 1, null, {}])
    assert.equal(parseLanguage(bad), null, String(bad));
  assert.deepEqual(
    resolveDocumentLanguage({ query: "he", cookie: "x", site: "ar" }),
    { lang: "ar", dir: "rtl", source: "site" },
  );
  assert.equal(directionOf("ar"), "rtl");
  assert.equal(directionOf("en"), "ltr");
});

test("page language: a signed-in member's default language never hides an Arabic coach website", async () => {
  const lookups: string[] = [];
  const site =
    (language: unknown) =>
    async (slug: string): Promise<unknown> => {
      lookups.push(slug);
      return language;
    };
  // The website lookup answers `language` (undefined: not available).
  const page = (input: Record<string, unknown>, language?: unknown) =>
    pageLanguage({ path: "/", siteLanguage: site(language), ...input } as any);
  // The reviewed defect: a member who never chose a language has "en"
  // mirrored on this device; the coach's Arabic website stays Arabic, for the
  // coach viewing their own live site too.
  assert.deepEqual(
    await page({ path: "/coach/alex-morgan", member: "en" }, "ar"),
    { lang: "ar", dir: "rtl", source: "site" },
  );
  assert.deepEqual(lookups, ["alex-morgan"]);
  assert.deepEqual(
    await page({ path: "/coach/alex-morgan/about", member: "ar" }, "en"),
    { lang: "en", dir: "ltr", source: "site" },
  );
  // An explicit choice wins without a website lookup.
  lookups.length = 0;
  assert.deepEqual(
    await page(
      { path: "/coach/alex-morgan", cookie: "en", member: "ar" },
      "ar",
    ),
    { lang: "en", dir: "ltr", source: "cookie" },
  );
  assert.deepEqual(
    await page({ path: "/coach/alex-morgan", query: "en", cookie: "ar" }, "ar"),
    { lang: "en", dir: "ltr", source: "query" },
  );
  assert.deepEqual(lookups, []);
  // A website that cannot be loaded falls back to the member, then English.
  assert.deepEqual(await page({ path: "/coach/missing", member: "ar" }), {
    lang: "ar",
    dir: "rtl",
    source: "member",
  });
  assert.deepEqual(
    await pageLanguage({
      path: "/coach/broken",
      siteLanguage: async () => {
        throw new Error("unavailable");
      },
    }),
    { lang: "en", dir: "ltr", source: "default" },
  );
  // Other public pages: the device choice, then the member's language, and
  // no website lookup.
  lookups.length = 0;
  assert.deepEqual(
    await page({ path: "/pricing", cookie: "en", member: "ar" }),
    {
      lang: "en",
      dir: "ltr",
      source: "cookie",
    },
  );
  assert.deepEqual(await page({ path: "/login", member: "ar" }), {
    lang: "ar",
    dir: "rtl",
    source: "member",
  });
  // Workspace pages start in the member's saved language.
  for (const path of ["/trainer", "/app/program", "/admin/settings"])
    assert.deepEqual(
      await page({ path, query: "en", cookie: "en", member: "ar" }),
      { lang: "ar", dir: "rtl", source: "member" },
      path,
    );
  for (const path of ["/trainers", "/apply", "/administrator", "/", null])
    assert.equal(isWorkspacePath(path), false, String(path));
  assert.deepEqual(lookups, []);
});

test("the workspace mirrors the member's language into its own cookie, never the device choice", () => {
  const written: string[] = [];
  const root = { lang: "en", dir: "ltr" };
  const saved = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    location: Object.getOwnPropertyDescriptor(globalThis, "location"),
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: root,
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        written.push(value);
      },
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:" },
  });
  try {
    rememberMemberLanguage("ar");
    assert.deepEqual(written, [
      `${MEMBER_LANGUAGE_COOKIE}=ar; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    ]);
    assert.deepEqual(root, { lang: "ar", dir: "rtl" });
    assert.ok(written.every((c) => !c.startsWith(LANGUAGE_COOKIE + "=")));
  } finally {
    for (const [name, descriptor] of Object.entries(saved))
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  }
});

test("coach website paths, and the language cookies", () => {
  assert.equal(coachSiteSlug("/coach/alex-morgan"), "alex-morgan");
  assert.equal(coachSiteSlug("/coach/alex-morgan/about"), "alex-morgan");
  for (const path of [
    "/coach",
    "/coach/",
    "/coaches",
    "/join-coach/alex",
    "/coach/Alex",
    "/coach/-bad",
    "/app/coach/alex",
    null,
  ])
    assert.equal(coachSiteSlug(path), null, String(path));
  assert.equal(
    languageCookie("ar", true),
    `${LANGUAGE_COOKIE}=ar; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
  );
  assert.doesNotMatch(languageCookie("en", false), /Secure/);
  assert.equal(
    languageCookie("en", false, MEMBER_LANGUAGE_COOKIE),
    "trainer_member_lang=en; Path=/; Max-Age=31536000; SameSite=Lax",
  );
  assert.equal(languageFromCookieHeader("a=1; trainer_lang=ar; b=2"), "ar");
  assert.equal(languageFromCookieHeader("trainer_lang=fr"), null);
  assert.equal(languageFromCookieHeader("xtrainer_lang=ar"), null);
  assert.equal(languageFromCookieHeader(""), null);
  assert.equal(languageFromCookieHeader(undefined), null);
  // The two cookies are read separately.
  const both = "trainer_member_lang=en; trainer_lang=ar";
  assert.equal(languageFromCookieHeader(both), "ar");
  assert.equal(languageFromCookieHeader(both, MEMBER_LANGUAGE_COOKIE), "en");
  assert.equal(
    languageFromCookieHeader("trainer_lang=ar", MEMBER_LANGUAGE_COOKIE),
    null,
  );
});

const secret = "synthetic-rtl-proxy-signing-key-with-32-bytes";
const envKeys = [
  "PUBLIC_APP_URL",
  "INTERNAL_PROXY_SECRET",
  "API_INTERNAL_URL",
] as const;
function withEnv(values: Record<string, string>) {
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Object.assign(process.env, { [key]: value });
  };
}
function forwarded(response: Response) {
  const headers: Record<string, string> = {};
  for (const name of (
    response.headers.get("x-middleware-override-headers") ?? ""
  )
    .split(",")
    .filter(Boolean))
    headers[name] = response.headers.get("x-middleware-request-" + name)!;
  return headers;
}

test("the proxy turns an explicit ?lang= into the language cookie and a server-set header", async () => {
  const restore = withEnv({
    PUBLIC_APP_URL: "https://platform.example.test",
    INTERNAL_PROXY_SECRET: secret,
  });
  try {
    const visit = (path: string, headers: Record<string, string> = {}) =>
      proxy(
        new NextRequest("https://platform.example.test" + path, {
          headers: { host: "platform.example.test", ...headers },
        }),
      );
    const arabic = await visit("/coaches?lang=ar");
    const cookie = arabic.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^trainer_lang=ar;/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=31536000/);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Secure/);
    assert.doesNotMatch(
      cookie,
      /HttpOnly/i,
      "the page restores it after leaving a coach website",
    );
    assert.equal(forwarded(arabic)["x-trainer-lang"], "ar");
    assert.equal(forwarded(arabic)["x-trainer-path"], "/coaches");

    // Unsupported values change nothing; client copies of the server-set
    // headers never reach the layout.
    const spoofed = await visit("/pricing?lang=fr", {
      "x-trainer-lang": "ar",
      "x-trainer-path": "/coach/someone-else",
    });
    assert.equal(spoofed.headers.get("set-cookie"), null);
    assert.equal(forwarded(spoofed)["x-trainer-lang"], undefined);
    assert.equal(forwarded(spoofed)["x-trainer-path"], "/pricing");

    // API requests are forwarded unchanged: no language cookie or header.
    const api = await visit("/api/v1/ready?lang=ar");
    assert.ok(api.headers.get("x-middleware-rewrite"));
    assert.equal(api.headers.get("set-cookie"), null);
    assert.equal(forwarded(api)["x-trainer-lang"], undefined);
    assert.equal(forwarded(api)["x-trainer-path"], undefined);
  } finally {
    restore();
  }
});

test("a coach's own domain reaches the layout with its rewritten website path", async () => {
  const restore = withEnv({
    PUBLIC_APP_URL: "https://platform.example.test",
    INTERNAL_PROXY_SECRET: secret,
    API_INTERNAL_URL: "http://127.0.0.1:4999",
  });
  const lookup = mock.method(globalThis, "fetch", async () =>
    Response.json({
      custom: true,
      tenantSlug: "amal-fitness",
      tenantId: randomUUID(),
    }),
  );
  try {
    const response = await proxy(
      new NextRequest("https://amal.example.test/about?lang=ar", {
        headers: { host: "amal.example.test" },
      }),
    );
    assert.equal(
      new URL(response.headers.get("x-middleware-rewrite")!).pathname,
      "/coach/amal-fitness/about",
    );
    const headers = forwarded(response);
    assert.equal(headers["x-trainer-path"], "/coach/amal-fitness/about");
    assert.equal(headers["x-trainer-lang"], "ar");
    assert.match(
      response.headers.get("set-cookie") ?? "",
      /trainer_lang=ar;.*Secure/,
    );
    assert.equal(lookup.mock.callCount(), 1);
  } finally {
    lookup.mock.restore();
    restore();
  }
});

let db: Database, app: ReturnType<typeof Fastify>;
const actors = new Map<string, any>();
before(async () => {
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.addHook("onRequest", async (req: any) => {
    req.identity = actors.get(req.headers["x-test-user"]);
  });
  app.setErrorHandler((error: Error, _r: any, reply: any) => {
    const e = error as any;
    reply
      .code(error instanceof z.ZodError ? 400 : (e.statusCode ?? 500))
      .send({ code: e.code, message: e.message });
  });
  registerCoachSite(app, db);
  await app.ready();
});
after(async () => {
  await app?.close();
  await db?.close();
});
async function owner() {
  const tenantId = randomUUID(),
    userId = randomUUID(),
    slug = "rtl-" + tenantId.slice(0, 8);
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published)VALUES($1,$2,'مدربة أمل',true)",
      [tenantId, slug],
    );
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash)VALUES($1,'أمل',$2,'synthetic')",
      [userId, userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role)VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
  });
  const actor = {
    tenantId,
    userId,
    role: "owner",
    name: "أمل",
    email: userId + "@example.test",
    platformRole: "none",
    emailVerified: true,
  };
  actors.set(userId, actor);
  return { ...actor, slug };
}
const call = (a: any, path: string, method: any = "GET", payload?: unknown) =>
  app.inject({
    url: "/api/v1" + path,
    method,
    headers: a ? { "x-test-user": a.userId } : {},
    payload,
  });

// The keys the previous release's strict site schema accepts. A website that
// stays English must be stored with these only, so an operator rollback
// (rollback_release) can still read and edit it.
const PREVIOUS_RELEASE_SITE_KEYS = [
  "about",
  "contactEmail",
  "cta",
  "headline",
  "instagram",
  "introduction",
  "pages",
  "seoDescription",
  "seoTitle",
  "whatsapp",
  "youtube",
];
async function storedSite(a: { tenantId: string; userId: string }) {
  const [row] = await db.tenant(
    { tenantId: a.tenantId, userId: a.userId, role: "owner" },
    (tx) =>
      tx.query("SELECT draft,published FROM coach_sites WHERE tenant_id=$1", [
        a.tenantId,
      ]),
  );
  return row as { draft: any; published: any };
}

test("a coach website stores only an Arabic language; English and older sites store no key", async () => {
  const a = await owner();
  const initial = (await call(a, "/tenant/site")).json();
  assert.equal("language" in initial.draft, false);
  assert.deepEqual(
    Object.keys(initial.draft).sort(),
    PREVIOUS_RELEASE_SITE_KEYS,
  );
  // An explicit English choice is the default and is not stored.
  const english = await call(a, "/tenant/site", "PUT", {
    version: initial.version,
    site: { ...initial.draft, language: "en" },
  });
  assert.equal(english.statusCode, 200, english.body);
  assert.equal("language" in english.json().draft, false);
  assert.deepEqual(
    Object.keys((await storedSite(a)).draft).sort(),
    PREVIOUS_RELEASE_SITE_KEYS,
  );
  const invalid = await call(a, "/tenant/site", "PUT", {
    version: english.json().version,
    site: { ...initial.draft, language: "fr" },
  });
  assert.equal(invalid.statusCode, 400);
  const arabic = await call(a, "/tenant/site", "PUT", {
    version: english.json().version,
    site: {
      ...initial.draft,
      language: "ar",
      headline: "تدريب يناسب حياتك",
      whatsapp: "+971501234567",
    },
  });
  assert.equal(arabic.statusCode, 200, arabic.body);
  assert.equal(arabic.json().draft.language, "ar");
  const published = await call(a, "/tenant/site/publish", "POST", {
    version: arabic.json().version,
  });
  assert.equal(published.statusCode, 200, published.body);
  const site = (await call(null, "/public/sites/" + a.slug)).json();
  assert.equal(site.site.language, "ar");
  assert.equal(site.site.headline, "تدريب يناسب حياتك");
  const preview = (await call(a, "/tenant/site/preview")).json();
  assert.equal(preview.site.language, "ar");
  // Switching back to English removes the key again, draft and published.
  const back = await call(a, "/tenant/site", "PUT", {
    version: published.json().version,
    site: { ...arabic.json().draft, language: "en" },
  });
  assert.equal(back.statusCode, 200, back.body);
  const republished = await call(a, "/tenant/site/publish", "POST", {
    version: back.json().version,
  });
  assert.equal(republished.statusCode, 200, republished.body);
  const stored = await storedSite(a);
  assert.deepEqual(
    Object.keys(stored.draft).sort(),
    PREVIOUS_RELEASE_SITE_KEYS,
  );
  assert.deepEqual(
    Object.keys(stored.published).sort(),
    PREVIOUS_RELEASE_SITE_KEYS,
  );
  const english2 = (await call(null, "/public/sites/" + a.slug)).json();
  assert.equal("language" in english2.site, false);
  assert.equal(english2.site.headline, "تدريب يناسب حياتك");
  // Published JSON written by an earlier build with "language":"en" still
  // reads (as English, with no key). The owner's scoped transaction, as the
  // website routes use (the restricted runtime role cannot write coach_sites
  // outside tenant scope).
  await db.tenant(
    { tenantId: a.tenantId, userId: a.userId, role: "owner" },
    (tx) =>
      tx.query(
        `UPDATE coach_sites SET published=published||'{"language":"en"}'::jsonb WHERE tenant_id=$1`,
        [a.tenantId],
      ),
  );
  const legacy = (await call(null, "/public/sites/" + a.slug)).json();
  assert.equal(legacy.site.headline, "تدريب يناسب حياتك");
  assert.equal("language" in legacy.site, false);
});

test("the coach website root carries the page language and direction; Arabic text renders", () => {
  const data = {
    tenant: {
      slug: "amal-fitness",
      name: "مدربة أمل",
      theme: {},
      published: true,
    },
    site: {
      headline: "تدريب يناسب حياتك",
      introduction: "أهلاً بك",
      about: "",
      contactEmail: "amal@example.test",
      whatsapp: "+971501234567",
      instagram: "",
      youtube: "",
      cta: "ابدأ الآن",
      seoTitle: "",
      seoDescription: "",
      language: "ar",
      pages: [],
    },
    galleries: [],
    products: [],
  };
  const render = (props: object) =>
    renderToStaticMarkup(createElement(CoachWebsite, props as any));
  const arabic = render({ initialData: data, language: "ar" });
  assert.match(
    arabic,
    /^<div class="trainer-theme coach-website" lang="ar" dir="rtl"/,
  );
  assert.match(arabic, /تدريب يناسب حياتك/);
  assert.match(arabic, /<div class="site-prose site-lead" dir="auto">أهلاً بك<\/div>/);
  // Coach-written headings follow their own direction too.
  assert.match(arabic, /<h1 dir="auto">تدريب يناسب حياتك<\/h1>/);
  // The visitor's explicit English choice wins over the website's language.
  assert.match(
    render({ initialData: data, language: "en" }),
    /^<div class="trainer-theme coach-website" lang="en" dir="ltr"/,
  );
  // Contact details stay left to right.
  const contact = render({
    initialData: data,
    language: "ar",
    path: "contact",
  });
  assert.match(
    contact,
    /<a href="mailto:amal@example.test">[\s\S]*?<span dir="ltr">amal@example.test<\/span>/,
  );
  // The trainer's private preview follows the draft's own language.
  assert.match(
    render({ initialData: data, preview: true }),
    /^<div class="trainer-theme coach-website" lang="ar" dir="rtl"/,
  );
});

test("the root layout renders <html lang dir> from the resolved document language", async () => {
  const layout = await readFile(
    new URL("../apps/web/app/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /const \{ lang, dir \} = await documentLanguage\(\);/);
  // The brand typeface adds its CSS variable class (next/font).
  // (The member's "Reduce motion" choice may add data-reduce-motion.)
  assert.match(layout, /<html\s+lang=\{lang\}\s+dir=\{dir\}(\s+className=\{[^}]+\})?(\s+data-reduce-motion=\{[^}]+\})?(\s+suppressHydrationWarning)?\s*>/);
  const server = await readFile(
    new URL("../apps/web/components/public-website.ts", import.meta.url),
    "utf8",
  );
  // The layout and the page share one cached website request.
  assert.match(server, /export const publicWebsite = cache\(/);
  const page = await readFile(
    new URL("../apps/web/app/[[...path]]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /publicWebsite as website/);
  assert.doesNotMatch(page, /const website = cache\(/);
});

test("the Arabic member shell: translated tabs in the same order, mirrored by direction only", async () => {
  const { MemberShell } = await import("../apps/web/components/member-shell.tsx");
  const { LocaleProvider } = await import("../apps/web/lib/i18n/react.tsx");
  const { default: navMessages } = await import("../apps/web/lib/i18n/messages/nav.ts");
  const shell = (locale: "en" | "ar") =>
    renderToStaticMarkup(
      createElement(LocaleProvider, {
        locale,
        children: createElement(MemberShell, {
          path: "/app",
          tenant: { id: "t1", name: "مدربة أمل", theme: {} },
          user: { name: "Sam", tenantId: "t1", userId: "u1" },
          nav: { programLabel: "My program", nutrition: true, locale },
          messages: [],
          onSignOut: () => {},
          children: createElement("h1", null, "—"),
        } as any),
      }),
    );
  const tabs = (html: string) =>
    [
      ...html
        .slice(html.indexOf('class="member-tabbar"'))
        .matchAll(/<a [^>]*class="member-tab[^"]*"[^>]*href="([^"]+)"/g),
    ].map((m) => m[1]);
  const arabic = shell("ar"),
    english = shell("en");
  // The document direction mirrors the bar; the markup order never changes.
  assert.deepEqual(tabs(arabic), tabs(english));
  assert.ok(tabs(arabic).length >= 4);
  for (const key of ["today", "chatTab", "more"] as const)
    assert.ok(arabic.includes(navMessages.ar[key]), `tab ${key} in Arabic`);
  assert.ok(!arabic.includes(">Today<"));
  // The coach's own name keeps its own direction inside the chrome.
  assert.match(arabic, /مدربة أمل/);
  // Mirroring comes from logical properties, not a separate RTL stylesheet.
  const css = await readFile(
    new URL("../apps/web/app/phone-first.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /\[dir="rtl"\]\s*\.member-tabbar/);
});
