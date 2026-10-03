import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture } from "./governance-fixtures.ts";
import { notificationPreferencesSchema } from "../apps/api/src/notifications.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
let member: Awaited<ReturnType<typeof f.person>>;
const previousEnvironment = process.env.NODE_ENV;
const kinds = ["coaching", "wearable", "voice", "marketing", "nutrition", "nutrition_model", "nutrition_photo"];
before(async () => {
  Reflect.set(process.env, "NODE_ENV", "test");
  f = await governanceFixture();
  member = await f.person({ role: "subscriber" });
  await f.db.system(async (tx) => {
    for (const key of ["privacy", "ai-disclosure"])
      await tx.query("INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at) VALUES($1,'legal',$2,1,'Privacy (test placeholder)','TEST ENVIRONMENT PLACEHOLDER. Not a legal document.','published',now()-interval '1 day',$3,$3,now())", [randomUUID(), key, member.userId]);
  });
  await f.db.tenant(f.scoped(member.tenantId), async (tx) => {
    for (const kind of kinds)
      await tx.query("INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted,created_at) VALUES($1,$2,$3,$4,'historical-fixture',true,now()-interval '1 day')", [randomUUID(), member.tenantId, member.userId, kind]);
  });
  Reflect.set(process.env, "NODE_ENV", "production");
});
after(async () => {
  if (previousEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", previousEnvironment);
  await f?.close();
});

test("published placeholders never prevent consent withdrawal or allow a new grant", async () => {
  for (const type of kinds) {
    const withdrawal = await f.call("/privacy/consent", { cookie: member.cookie, body: { type, granted: false } });
    assert.equal(withdrawal.statusCode, 200, `${type}: ${withdrawal.body}`);
    const [latest] = await f.db.tenant(f.scoped(member.tenantId), (tx) => tx.query("SELECT granted,document_version FROM consent_records WHERE user_id=$1 AND document_type=$2 ORDER BY created_at DESC,id DESC LIMIT 1", [member.userId, type]));
    assert.equal(latest.granted, false);
    assert.equal(latest.document_version, "consent:v1:withdrawal");
    const grant = await f.call("/privacy/consent", { cookie: member.cookie, body: { type, granted: true } });
    assert.equal(grant.statusCode, 409, `${type}: ${grant.body}`);
    assert.equal(grant.json().code, "LEGAL_PUBLICATION_REQUIRED");
  }
});

test("notification preferences can withdraw existing marketing permission without a published policy", async () => {
  const other = await f.person({ role: "subscriber" });
  await f.db.tenant(f.scoped(other.tenantId), (tx) => tx.query("INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'marketing','historical-fixture',true)", [randomUUID(), other.tenantId, other.userId]));
  const preferences = notificationPreferencesSchema.parse({ marketing: false });
  const result = await f.call("/notifications/preferences", { method: "PUT", cookie: other.cookie, body: { version: 0, data: preferences } });
  assert.equal(result.statusCode, 200, result.body);
  const [latest] = await f.db.tenant(f.scoped(other.tenantId), (tx) => tx.query("SELECT granted,document_version FROM consent_records WHERE user_id=$1 AND document_type='marketing' ORDER BY created_at DESC,id DESC LIMIT 1", [other.userId]));
  assert.equal(latest.granted, false);
  assert.equal(latest.document_version, "consent:v1:withdrawal");
  const grant = await f.call("/notifications/preferences", { method: "PUT", cookie: other.cookie, body: { version: result.json().version, data: { ...preferences, marketing: true } } });
  assert.equal(grant.statusCode, 409, grant.body);
  assert.equal(grant.json().code, "LEGAL_PUBLICATION_REQUIRED");
});
