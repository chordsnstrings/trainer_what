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
  coachSiteSlug,
  directionOf,
  languageCookie,
  languageFromCookieHeader,
  parseLanguage,
  resolveDocumentLanguage,
} from "../apps/web/document-language.ts";
import { proxy } from "../apps/web/proxy.ts";
import { CoachWebsite } from "../apps/web/components/coach-site.tsx";

test("document language: explicit query, then cookie, then the coach website, then English", () => {
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

test("coach website paths, and the device language cookie", () => {
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
  assert.equal(languageFromCookieHeader("a=1; trainer_lang=ar; b=2"), "ar");
  assert.equal(languageFromCookieHeader("trainer_lang=fr"), null);
  assert.equal(languageFromCookieHeader("xtrainer_lang=ar"), null);
  assert.equal(languageFromCookieHeader(""), null);
  assert.equal(languageFromCookieHeader(undefined), null);
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
    assert.doesNotMatch(cookie, /HttpOnly/i, "the workspace mirrors it too");
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

test("a coach website stores its language; older sites read as English", async () => {
  const a = await owner();
  const initial = (await call(a, "/tenant/site")).json();
  assert.equal(initial.draft.language, "en");
  // A draft saved by an older editor (no language) still saves as English.
  const { language: _omitted, ...older } = initial.draft;
  const saved = await call(a, "/tenant/site", "PUT", {
    version: initial.version,
    site: older,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().draft.language, "en");
  const invalid = await call(a, "/tenant/site", "PUT", {
    version: saved.json().version,
    site: { ...older, language: "fr" },
  });
  assert.equal(invalid.statusCode, 400);
  const arabic = await call(a, "/tenant/site", "PUT", {
    version: saved.json().version,
    site: {
      ...older,
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
  // Published JSON from before this change has no language: English. The
  // owner's scoped transaction, as the website routes use (the restricted
  // runtime role cannot write coach_sites outside tenant scope).
  await db.tenant(
    { tenantId: a.tenantId, userId: a.userId, role: "owner" },
    (tx) =>
      tx.query(
        "UPDATE coach_sites SET published=published-'language' WHERE tenant_id=$1",
        [a.tenantId],
      ),
  );
  assert.equal(
    (await call(null, "/public/sites/" + a.slug)).json().site.language,
    "en",
  );
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
  assert.match(arabic, /<div class="site-prose" dir="auto">أهلاً بك<\/div>/);
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
  assert.match(contact, /<a href="mailto:amal@example.test" dir="ltr">/);
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
  assert.match(layout, /<html lang=\{lang\} dir=\{dir\}>/);
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
