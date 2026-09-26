import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Actor, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { notificationDeliveryDecision } from "../apps/api/src/notifications.ts";
import { notifyImportReview } from "../apps/api/src/source-review-notifications.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
type Fixture = Actor & { token: string };
const settings = {
  MODEL_BASE_URL: "https://source-review.fixture.invalid/v1",
  MODEL_API_KEY: "fixture-only",
  MODEL_NAME: "fixture-model",
};
const previous = Object.fromEntries(
  Object.keys(settings).map((key) => [key, process.env[key]]),
);
const actualFetch = globalThis.fetch;
before(async () => {
  Object.assign(process.env, settings);
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  globalThis.fetch = actualFetch;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await app.close();
  await db.close();
});
async function trainer(): Promise<Fixture> {
  const a = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
    token: randomUUID(),
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Review fixture')",
      [a.tenantId, a.tenantId],
    );
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Review fixture','unused')",
      [a.userId, a.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(a.token), a.userId, a.tenantId],
    );
  });
  return a;
}
function request(a: Fixture, url: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/v1" + url,
    payload: body,
    headers: { origin: "http://localhost:3000", cookie: "session=" + a.token },
  });
}
const uploadBody = () => ({
  title: "Private upload",
  fileName: "private-client-notes.md",
  rights: true,
  contentBase64: Buffer.from(
    "Client: Private Person\nEmail private-person@example.test\nKeep comfortable movement and review progress weekly.",
  ).toString("base64"),
});
async function notices(a: Fixture) {
  return db.tenant(a, (tx) =>
    tx.query(
      "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at,id",
      [a.userId],
    ),
  );
}
async function job(a: Fixture, notificationId: string) {
  return (
    await db.tenant(a, (tx) =>
      tx.query("SELECT * FROM jobs WHERE data->>'notificationId'=$1", [
        notificationId,
      ]),
    )
  )[0];
}
async function source(a: Fixture) {
  const r = await request(a, "/brain/sources", {
    title: "Reviewed progression",
    text: "Keep the weekly schedule stable and increase resistance only with consistent technique.",
    rights: true,
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
function model(sourceId: string, during?: () => Promise<void>) {
  globalThis.fetch = async () => {
    await during?.();
    return Response.json({
      id: "review-fixture",
      usage: { prompt_tokens: 20, completion_tokens: 20 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              rules: [
                {
                  title: "Technique before load",
                  category: "progression",
                  condition: "After consistent technique",
                  directive:
                    "Review progression with the trainer before changing resistance",
                  reason: "Technique determines the next change",
                  sourceIds: [sourceId],
                },
              ],
              conflicts: [
                {
                  description: "Review whether progression changes frequency",
                  sourceIds: [sourceId],
                },
              ],
            }),
          },
        },
      ],
    });
  };
}

test("actual upload queues one private review prompt; redaction/review, preferences and foreign access invalidate delivery", async () => {
  const a = await trainer(),
    foreign = await trainer(),
    body = uploadBody();
  const response = await request(a, "/brain/documents", body);
  assert.equal(response.statusCode, 200, response.body);
  const record = response.json();
  assert.equal(record.status, "needs_review");
  assert.equal(
    (await request(a, "/brain/documents", body)).json().id,
    record.id,
  );
  const rows = await notices(a);
  assert.equal(rows.length, 1);
  assert.equal((await notices(foreign)).length, 0);
  const queued = await job(a, rows[0].id);
  assert.doesNotMatch(
    JSON.stringify([rows, queued]),
    /Private Person|private-person@|private-client-notes|comfortable movement/,
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    true,
  );
  assert.equal(
    (await notificationDeliveryDecision(db, foreign.tenantId, queued)).allowed,
    false,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,'{\"email\":false}')",
      [a.tenantId, a.userId],
    ),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    false,
  );
  await db.tenant(a, (tx) =>
    tx.query("DELETE FROM notification_preferences WHERE user_id=$1", [
      a.userId,
    ]),
  );
  const redacted = await request(a, `/brain/imports/${record.id}/redact`, {
    revision: record.version,
  });
  assert.equal(redacted.statusCode, 200, redacted.body);
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    false,
  );
  const approved = await request(a, `/brain/imports/${record.id}/review`, {
    revision: redacted.json().version,
    title: body.title,
    text: redacted.json().data.text,
    rights: true,
    privacyReviewed: true,
  });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    false,
  );
});

test("actual compilation reports exact proposals/conflicts; review changes and source withdrawal suppress stale mail", async () => {
  const a = await trainer(),
    input = await source(a);
  model(input.id);
  const response = await request(a, "/brain/compile", {
    sourceIds: [input.id],
  });
  assert.equal(response.statusCode, 200, response.body);
  const [notice] = await notices(a),
    queued = await job(a, notice.id);
  assert.match(notice.body, /1 draft rule and 1 potential conflict/);
  assert.equal(notice.href, "/trainer/brain/knowledge");
  assert.equal(notice.data.source.rules.length, 1);
  assert.equal(notice.data.source.conflicts.length, 1);
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    true,
  );
  assert.equal(
    (
      await notificationDeliveryDecision(
        db,
        a.tenantId,
        queued,
        new Date(Date.now() + 49 * 3600000),
      )
    ).allowed,
    false,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE records SET status='confirmed',version=version+1 WHERE id=$1",
      [response.json().rules[0].id],
    ),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    false,
  );
  const again = await request(a, "/brain/compile", { sourceIds: [input.id] });
  assert.equal(again.statusCode, 200, again.body);
  const latest = (await notices(a)).at(-1)!;
  const nextJob = await job(a, latest.id);
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, nextJob)).allowed,
    true,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE records SET data=jsonb_set(data,'{allowedUses}','[]'::jsonb),version=version+1 WHERE id=$1",
      [input.id],
    ),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, nextJob)).allowed,
    false,
  );
});

test("material changed during model work cannot persist proposals or send a misleading completion notice", async () => {
  const a = await trainer(),
    input = await source(a);
  model(input.id, () =>
    db.tenant(a, async (tx) => {
      await tx.query(
        "UPDATE records SET version=version+1,data=jsonb_set(data,'{allowedUses}','[]'::jsonb) WHERE id=$1",
        [input.id],
      );
    }),
  );
  const response = await request(a, "/brain/compile", {
    sourceIds: [input.id],
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.match(response.body, /SOURCE_CHANGED/);
  assert.equal((await notices(a)).length, 0);
  const records = await db.tenant(a, (tx) =>
    tx.query("SELECT id FROM records WHERE kind IN ('rule','conflict')"),
  );
  assert.equal(records.length, 0);
});

test("removal, closed workspaces and lost trainer role block prompts and new enqueue", async () => {
  const a = await trainer();
  const response = await request(a, "/brain/documents", uploadBody());
  assert.equal(response.statusCode, 200, response.body);
  const record = response.json(),
    [notice] = await notices(a),
    queued = await job(a, notice.id);
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE records SET status='discarded',version=version+1,data='{}' WHERE id=$1",
      [record.id],
    ),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    false,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE records SET status='needs_review',version=$2 WHERE id=$1",
      [record.id, record.version],
    ),
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    false,
  );
  await assert.rejects(
    db.tenant(a, (tx) => notifyImportReview(tx, a, record)),
    /Current trainer access/,
  );
  await db.system(async (tx) => {
    await tx.query("UPDATE tenants SET lifecycle_state='active' WHERE id=$1", [
      a.tenantId,
    ]);
    await tx.query(
      "UPDATE memberships SET role='subscriber' WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    );
  });
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued)).allowed,
    false,
  );
  await assert.rejects(
    db.tenant(a, (tx) => notifyImportReview(tx, a, record)),
    /Current trainer access/,
  );
});
