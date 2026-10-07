import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { passwordMatches } from "../apps/api/src/auth.ts";

let raw: PGlite | undefined, db: Database | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let directory: string;
const saved = { NODE_ENV: process.env.NODE_ENV, PUBLIC_APP_URL: process.env.PUBLIC_APP_URL };
const sql = await readFile(new URL("../packages/db/migrations/090_publish_uae_policies.sql", import.meta.url), "utf8");
const password = "PolicyPublicationFixture2026!";
const adminId = "11111111-2222-4333-8444-555555555555";
const cookie = (response: any) => String(response.headers["set-cookie"]).split(";")[0];
let address = 0;
const call = (path: string, options: { body?: unknown; cookie?: string } = {}) => app!.inject({
  method: options.body === undefined ? "GET" : "POST",
  url: "/api/v1" + path, payload: options.body as any,
  remoteAddress: `10.87.0.${++address}`,
  headers: { host: "localhost:3000", origin: "http://localhost:3000", ...(options.cookie ? { cookie: options.cookie } : {}) },
});

before(async () => {
  Reflect.set(process.env, "NODE_ENV", "test");
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  directory = await mkdtemp(join(tmpdir(), "legal-publication-"));
  raw = new PGlite(directory);
  await applyMigrations({ query: (q, p) => raw!.query(q, p), exec: (q) => raw!.exec(q) });
});
after(async () => {
  await app?.close();
  await db?.close();
  await raw?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

test("publication is limited to an existing operator installation", async () => {
  await raw!.exec(sql);
  assert.deepEqual((await raw!.query("SELECT * FROM admin_documents WHERE kind='legal'")).rows, []);
  assert.deepEqual((await raw!.query("SELECT * FROM platform_settings")).rows, []);
});

test("the release publishes the pack, preserves settings and records its own attribution", async () => {
  await raw!.exec(`BEGIN;
    SELECT set_config('app.operator_reason','Synthetic policy publication fixture',true),set_config('app.operator_source','test',true);
    INSERT INTO users(id,email,name,password_hash,platform_role) VALUES('${adminId}','operator@example.test','Synthetic operator','disabled','admin');
    INSERT INTO platform_settings(integration_id,revision,enabled,settings_values,updated_by) VALUES('application',7,true,'{"LEGAL_APPROVED":"false","NUTRITION_ENABLED":"false","APP_NAME":"trainsyou","SUPPORT_EMAIL":""}','${adminId}');
    COMMIT;`);
  await raw!.exec(sql);
  for (const key of ["terms", "privacy", "ai-disclosure"]) {
    const { rows: [doc] } = await raw!.query<any>("SELECT * FROM admin_documents WHERE kind='legal' AND key=$1", [key]);
    assert.ok(doc);
    assert.equal(doc.status, "published");
    const source = await readFile(new URL(`../docs/legal/uae-2026-10/${key}.en.md`, import.meta.url), "utf8");
    assert.equal(doc.content, source.split("\n").slice(2).join("\n").trim().replace(/^## /gm, ""));
    assert.doesNotMatch(doc.content, /\{\{|TEST ENVIRONMENT PLACEHOLDER|\bIndia\b|\bBangalore\b/);
  }
  const { rows: [settings] } = await raw!.query<any>("SELECT * FROM platform_settings WHERE integration_id='application'");
  assert.equal(settings.revision, 8);
  assert.deepEqual(settings.settings_values, { LEGAL_APPROVED: "true", NUTRITION_ENABLED: "false", APP_NAME: "trainsyou", SUPPORT_EMAIL: "" });
  const { rows: [publisher] } = await raw!.query<any>("SELECT * FROM users WHERE id=$1", [settings.updated_by]);
  assert.notEqual(publisher.id, adminId);
  assert.equal(publisher.platform_role, "none");
  assert.equal(await passwordMatches(password, publisher.password_hash), false);
  assert.deepEqual((await raw!.query("SELECT * FROM memberships WHERE user_id=$1", [publisher.id])).rows, []);
  await raw!.exec(sql);
  const { rows: [unchanged] } = await raw!.query<any>("SELECT revision FROM platform_settings WHERE integration_id='application'");
  assert.equal(unchanged.revision, 8, "repeating the release does not overwrite later operator decisions");
});

test("production trainer and client signup opens with explicit, versioned acceptance", async () => {
  await raw!.close(); raw = undefined;
  db = await createDatabase({ directory, url: "", migrate: false });
  app = await buildApp({ db, testing: true });
  Reflect.set(process.env, "NODE_ENV", "production");
  const options = (await call("/public/signup-options")).json();
  assert.equal(options.registrationOpen, true);
  assert.equal(options.methods.password, true);
  const status = (await call("/public/legal-status")).json();
  assert.equal(status.joiningOpen, true);
  assert.ok(status.documents.every((d: any) => d.published));
  for (const key of ["terms", "privacy", "ai-disclosure"])
    assert.equal((await call(`/public/documents/${key}`)).statusCode, 200);
  const trainerBody = { name: "Publication Coach", email: "publication-coach@example.test", password, accepted: true };
  assert.equal((await call("/auth/register", { body: { ...trainerBody, accepted: false } })).statusCode, 400);
  const trainer = await call("/auth/register", { body: trainerBody });
  assert.equal(trainer.statusCode, 201, trainer.body);
  const owner = (await call("/bootstrap", { cookie: cookie(trainer) })).json().user;
  const [tenant] = await db.system((tx) => tx.query("UPDATE tenants SET published=true WHERE id=$1 RETURNING slug", [owner.tenantId]));
  const client = await call("/auth/enroll", { body: { name: "Publication Client", email: "publication-client@example.test", password, coachSlug: tenant.slug, accepted: true } });
  assert.equal(client.statusCode, 201, client.body);
  const member = (await call("/bootstrap", { cookie: cookie(client) })).json().user;
  assert.equal(member.role, "subscriber");
  for (const user of [owner, member]) {
    const consents: Array<{ document_type: string; document_version: string; granted: boolean }> = await db.tenant(user, (tx) => tx.query("SELECT document_type,document_version,granted FROM consent_records WHERE user_id=$1", [user.userId]));
    assert.deepEqual(consents, [{ document_type: "registration", document_version: "terms:1|privacy:1|ai-disclosure:1", granted: true }]);
  }
});
