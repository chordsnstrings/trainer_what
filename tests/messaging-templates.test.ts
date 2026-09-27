import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import { registerAdminOperations } from "../apps/api/src/admin-operations.ts";
import { registerMessaging } from "../apps/api/src/messaging-admin.ts";
import {
  MESSAGE_KINDS,
  messageKindForKey,
  renderMessage,
} from "../apps/api/src/message-templates.ts";
import { notifyUser } from "../apps/api/src/notifications.ts";
import { executeEmailDelivery } from "../apps/worker/src/email-delivery.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";

let db: Database;
const app = Fastify();
const owner = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const member = {
  tenantId: owner.tenantId,
  userId: randomUUID(),
  role: "subscriber",
};
const workspace = "Coach <Omar> & Co";
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Owner fixture','unused'),($3,$4,$5,'unused')",
      [
        owner.userId,
        owner.userId + "@example.test",
        member.userId,
        member.userId + "@example.test",
        "Layla <b>",
      ],
    );
    await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
      owner.tenantId,
      "t" + owner.tenantId.slice(0, 8),
      workspace,
    ]);
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'subscriber')",
      [owner.tenantId, owner.userId, member.userId],
    );
  });
  // Tenant data is written through a tenant transaction, as the runtime does.
  await db.tenant(member, (tx) =>
    tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3)",
      [
        member.tenantId,
        member.userId,
        JSON.stringify({ language: "ar", quietStart: 0, quietEnd: 0 }),
      ],
    ),
  );
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  const identity = (req: any) => ({
    ...owner,
    platformRole: String(req.headers["x-role"] ?? "admin"),
    mfaAt: req.headers["x-stale"] ? null : new Date().toISOString(),
  });
  registerAdminOperations(app, db, identity);
  registerMessaging(app, db, identity);
});
after(async () => {
  await app.close();
  await db.close();
});
const req = (url: string, method: any = "GET", payload?: any, headers = {}) =>
  app.inject({ url: "/api/v1" + url, method, payload, headers });
async function publish(key: string, title: string, content: string) {
  const created = await req("/admin/documents", "POST", {
    kind: "notification",
    key,
    title,
    content,
  });
  assert.equal(created.statusCode, 200, created.body);
  const published = await req(
    `/admin/documents/${created.json().id}/publish`,
    "POST",
    {
      revision: 1,
      effectiveAt: new Date(Date.now() - 1000).toISOString(),
      reason: "Reviewed template fixture",
    },
  );
  assert.equal(published.statusCode, 200, published.body);
  return published.json();
}
const notice = (id: string) =>
  db
    .tenant(owner, (tx) =>
      tx.query("SELECT * FROM notifications WHERE id=$1", [id]),
    )
    .then((rows) => rows[0]);
const emailJob = (id: string) =>
  db
    .tenant(owner, (tx) =>
      tx.query(
        "SELECT * FROM jobs WHERE kind='email' AND data->>'notificationId'=$1",
        [id],
      ),
    )
    .then((rows) => rows[0]);

/** Text of a call's arguments, skipping string and template literals. */
function callArguments(source: string, open: number) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < source.length && source[i] !== c; i++)
        if (source[i] === "\\") i++;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    if (c === ")" || c === "}" || c === "]") depth--;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced call");
}
/** The expression after `templateKey:` up to the next top-level comma or brace. */
function templateKeyValues(args: string) {
  const keys: string[] = [];
  for (const m of args.matchAll(/templateKey:/g)) {
    let depth = 0,
      end = m.index! + m[0].length;
    for (; end < args.length; end++) {
      const c = args[end];
      if ((c === "," || c === "}" || c === ")") && depth === 0) break;
      if (c === "(" || c === "[" || c === "{") depth++;
      if (c === ")" || c === "]" || c === "}") depth--;
    }
    const value = args.slice(m.index! + m[0].length, end);
    // Every literal shaped like a key is a candidate (ternaries included).
    for (const literal of value.matchAll(/"([a-z0-9]+(?:-[a-z0-9]+)+)"/g))
      keys.push(literal[1]);
  }
  return keys;
}
// Calls that forward a caller's input unchanged; the caller is checked instead.
const forwarding = new Set([
  "notifications.ts:notifyUser(tx, a, { ...input, userId: trainer.user_id })",
]);
test("every notification sender names a registered template key in its own category", async () => {
  const registered = new Map(MESSAGE_KINDS.map((k) => [k.templateKey, k]));
  const used = new Set<string>();
  const missing: string[] = [],
    wrongCategory: string[] = [];
  for (const folder of ["../apps/api/src/", "../apps/worker/src/"]) {
    const dir = new URL(folder, import.meta.url);
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".ts")) continue;
      const source = await readFile(new URL(name, dir), "utf8");
      for (const m of source.matchAll(
        /(?<!function )\b(notifyUser|notifyCoachingTeam|hooks\.notify)\(/g,
      )) {
        const args = callArguments(source, m.index! + m[0].length - 1);
        const call = `${name}:${m[1]}(${args.replace(/\s+/g, " ").trim()})`;
        if (forwarding.has(call)) continue;
        let keys = templateKeyValues(args);
        let category = /category:\s*"([a-z]+)"/.exec(args)?.[1];
        // A spread notice object defined in the same file carries the key.
        const spread = /\.\.\.([A-Za-z_]\w*)/.exec(args)?.[1];
        if (spread && !/templateKey/.test(args)) {
          const at = source.search(new RegExp(`const ${spread} = \\{`));
          if (at >= 0) {
            const literal = callArguments(source, source.indexOf("{", at));
            keys = templateKeyValues(literal);
            category ??= /category:\s*"([a-z]+)"/.exec(literal)?.[1];
          }
        }
        if (!/templateKey/.test(args) && !keys.length) {
          missing.push(call.slice(0, 120));
          continue;
        }
        for (const key of keys) {
          used.add(key);
          const k = registered.get(key);
          if (k && category && k.category !== category)
            wrongCategory.push(
              `${key}: sender ${category}, registry ${k.category}`,
            );
        }
      }
      // Keys passed through a helper (booking notices) are literal elsewhere.
      for (const m of source.matchAll(/templateKey:\s*"([a-z0-9-]+)"/g))
        used.add(m[1]);
      if (name === "lifecycle-messages.ts") {
        const version = /const VERSION = (\d+);/.exec(source)![1];
        for (const m of source.matchAll(/emit\(\s*"([a-z-]+)"/g))
          used.add(`lifecycle-${m[1]}-v${version}`);
      }
    }
  }
  assert.deepEqual(missing, [], "every sender passes a templateKey");
  assert.deepEqual(wrongCategory, [], "registry categories match senders");
  assert.ok(used.size >= 39, `found ${used.size} template keys`);
  assert.deepEqual(
    [...used].filter((key) => !registered.has(key)),
    [],
    "register new template keys in message-templates.ts",
  );
  assert.deepEqual(
    [...registered.keys()].filter((key) => !used.has(key)),
    [],
    "every registered kind has a sender",
  );
  // Criticality is decided by category at send time; the registry agrees.
  for (const k of MESSAGE_KINDS)
    assert.equal(
      k.critical,
      k.category === "safety" || k.category === "account",
      k.templateKey,
    );
  assert.equal(
    messageKindForKey("website-inquiry--ar")?.kind,
    "website-inquiry",
  );
});

test("rendering substitutes once, escapes every value for email HTML and keeps critical text", () => {
  const rendered = renderMessage({
    template: {
      title: "Hi {{name}}\r\nBcc: x@example.test",
      body: "<b>{{coach}}</b>: {{message}} {{ link }} on {{date}}",
      locale: "en",
    },
    builtIn: { title: "Built in", body: "Stop <now> & rest." },
    values: { name: "{{coach}}", coach: "A&B <i>", date: "2026-09-27" },
    href: "/app/chat",
    appUrl: "https://app.example.test/",
    critical: true,
  });
  // A value is never expanded again, and headers cannot be injected.
  assert.equal(rendered.title, "Hi {{coach}} Bcc: x@example.test");
  assert.match(
    rendered.body,
    /^<b>A&B <i><\/b>: Stop <now> & rest\. \/app\/chat on 2026-09-27/,
  );
  assert.ok(rendered.body.endsWith("\n\nStop <now> & rest."));
  assert.match(
    rendered.emailText,
    /https:\/\/app\.example\.test\/app\/chat on/,
  );
  assert.ok(
    !/<b>|<i>|<now>/.test(
      rendered.emailHtml.replace(/<\/?(div|p|br|a)[^>]*>/g, ""),
    ),
  );
  assert.match(rendered.emailHtml, /&lt;b&gt;A&amp;B &lt;i&gt;&lt;\/b&gt;/);
  const plain = renderMessage({
    template: null,
    builtIn: { title: "Plain", body: "Body <x>" },
    values: { name: "n", coach: "c", date: "d" },
    href: "",
    appUrl: "https://app.example.test",
    critical: false,
  });
  assert.equal(plain.body, "Body <x>");
  assert.equal(plain.emailText, "Body <x>");
  assert.match(plain.emailHtml, /Body &lt;x&gt;/);
});

test("operators can only save registered keys and variables, and preview with sample data", async () => {
  const bad = async (payload: any, code: string) => {
    const r = await req("/admin/documents", "POST", {
      kind: "notification",
      title: "Fixture title",
      content: "Fixture {{message}}",
      ...payload,
    });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().code, code);
  };
  await bad({ key: "coaching-mesage" }, "TEMPLATE_KEY");
  await bad({ key: "coaching-message--en" }, "TEMPLATE_LOCALE");
  await bad({ key: "coaching-message--fr" }, "TEMPLATE_LOCALE");
  await bad(
    { key: "coaching-message", title: "Hi {{password}}" },
    "TEMPLATE_VARIABLE",
  );
  await bad(
    { key: "coaching-message", content: "Unclosed {{name" },
    "TEMPLATE_VARIABLE",
  );
  const preview = await req("/admin/notification-templates/preview", "POST", {
    key: "website-inquiry--ar",
    title: "استفسار جديد إلى {{coach}}",
    content: "مرحبا {{name}}\n{{message}}\n{{link}}",
  });
  assert.equal(preview.statusCode, 200, preview.body);
  const p = preview.json();
  assert.equal(p.kind.templateKey, "website-inquiry");
  assert.equal(p.locale, "ar");
  assert.match(p.inApp.title, /Coach Omar & Co/);
  assert.match(p.email.html, /dir="rtl"/);
  assert.match(p.email.html, /Layla &lt;Sample&gt;/);
  assert.match(p.email.text, /\/trainer\/website/);
  assert.match(p.push.note, /never carry message content/);
  for (const headers of [{ "x-role": "support" }, { "x-stale": "yes" }])
    assert.equal(
      (
        await req(
          "/admin/notification-templates/preview",
          "POST",
          { key: "website-inquiry", title: "Title", content: "{{message}}" },
          headers,
        )
      ).statusCode,
      403,
    );
});

test("published templates drive inbox and email copy with locale fallback and a pinned version", async () => {
  const send = (key: string) =>
    db.tenant(owner, (tx) =>
      notifyUser(tx, owner, {
        userId: member.userId,
        category: "coaching",
        dedupeKey: key,
        title: "You have a new coaching message",
        body: "Open your coaching conversation to read the new message.",
        href: "/app/chat",
        templateKey: "coaching-message",
      }),
    );
  // Nothing published: built-in copy, pinned as such.
  const builtIn = await notice((await send("fixture-built-in"))!.id);
  assert.equal(builtIn.title, "You have a new coaching message");
  assert.deepEqual(builtIn.data.template, {
    kind: "coaching-message",
    key: "coaching-message",
    version: null,
    locale: "en",
    requestedLocale: "ar",
    source: "built_in",
  });
  await publish(
    "coaching-message",
    "Message from {{coach}}",
    "Hello {{ name }}, {{message}} {{link}}",
  );
  // Arabic requested, English published: English fallback.
  const english = await notice((await send("fixture-english"))!.id);
  assert.equal(english.title, `Message from ${workspace}`);
  assert.equal(
    english.body,
    "Hello Layla <b>, Open your coaching conversation to read the new message. /app/chat",
  );
  assert.equal(english.data.template.version, 1);
  assert.equal(english.data.template.locale, "en");
  assert.equal(english.data.template.source, "published");
  await publish(
    "coaching-message--ar",
    "رسالة من {{coach}}",
    "مرحبا {{name}}، لديك رسالة جديدة. {{link}}",
  );
  const arabic = await notice((await send("fixture-arabic"))!.id);
  assert.equal(arabic.title, `رسالة من ${workspace}`);
  assert.deepEqual(arabic.data.template, {
    kind: "coaching-message",
    key: "coaching-message--ar",
    version: 1,
    locale: "ar",
    requestedLocale: "ar",
    source: "published",
  });
  const job = await emailJob(arabic.id);
  assert.equal(job.data.subject, arabic.title);
  assert.deepEqual(job.data.template, arabic.data.template);
  assert.match(job.data.html, /dir="rtl"/);
  assert.match(job.data.html, /Layla &lt;b&gt;/);
  assert.match(job.data.html, /Coach|&lt;Omar&gt;|http/);
  assert.ok(!job.data.html.includes("<b>،"), "values are escaped in HTML");
  assert.match(job.data.text, /http:\/\/localhost:3000\/app\/chat/);
  // The worker hands both parts to the provider.
  const leased = await db.tenant(
    owner,
    async (tx) =>
      (
        await tx.query(
          "UPDATE jobs SET attempts=1,leased_until=now()+interval '2 minutes' WHERE id=$1 RETURNING *",
          [job.id],
        )
      )[0],
  );
  const sent: any[] = [];
  await withRuntimeConfig(
    {
      EMAIL_API_URL: "https://email.example.test/send",
      EMAIL_API_KEY: "fixture",
      EMAIL_FROM: "coach@example.test",
    },
    () =>
      executeEmailDelivery(db, owner.tenantId, leased, async (...args) => {
        sent.push(args);
      }),
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], arabic.title);
  assert.equal(sent[0][3], job.data.html);
  assert.equal((await notice(arabic.id)).email_status, "sent");
  const list = await req("/admin/notification-templates");
  assert.equal(list.statusCode, 200, list.body);
  const kind = list
    .json()
    .kinds.find((k: any) => k.templateKey === "coaching-message");
  assert.equal(kind.published.en.version, 1);
  assert.equal(kind.published.ar.version, 1);
  assert.equal(
    list.json().kinds.find((k: any) => k.templateKey === "website-inquiry")
      .published.en,
    null,
  );
});

test("critical templates keep the built-in safety instruction after template text", async () => {
  await publish(
    "training-paused",
    "Paused for {{name}}",
    "Your coach {{coach}} will review this.",
  );
  const body =
    "Stop this training session. Contact local emergency services if you need urgent help.";
  const created = await db.tenant(owner, (tx) =>
    notifyUser(tx, owner, {
      userId: member.userId,
      category: "safety",
      dedupeKey: "fixture-safety",
      title: "Your training is paused",
      body,
      href: "/app/chat",
      templateKey: "training-paused",
    }),
  );
  const n = await notice(created!.id);
  assert.equal(n.body, `Your coach ${workspace} will review this.\n\n${body}`);
  assert.equal(n.data.template.key, "training-paused");
  assert.equal(n.data.template.locale, "en");
});
