import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let firstCookie: string, secondCookie: string, firstAlternateCookie: string;
const proxyAddress = "127.0.0.1";

before(async () => {
  db = await createDatabase({ memory: true });
  const tenantId = randomUUID(),
    firstId = randomUUID(),
    secondId = randomUUID();
  const tokens = [newToken(), newToken(), newToken()];
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Rate limit fixture')",
      [tenantId, `rate-limit-${tenantId}`],
    );
    for (const userId of [firstId, secondId]) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Rate limit fixture','unused-fixture-hash',true)",
        [userId, `rate-limit-${userId}@example.test`],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
        [tenantId, userId],
      );
    }
    for (const [index, userId] of [firstId, secondId, firstId].entries()) {
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [tokenHash(tokens[index]), userId, tenantId],
      );
    }
  });
  [firstCookie, secondCookie, firstAlternateCookie] = tokens.map(
    (token) => `session=${token}`,
  );
  // Use the normal application budget, not testing:true's elevated 10,000 limit.
  app = await buildApp({ db });
  app.log.level = "silent";
});
after(async () => {
  await app?.close();
  await db?.close();
});

function request(cookie?: string, headers: Record<string, string> = {}) {
  return app.inject({
    url: "/api/v1/health",
    remoteAddress: proxyAddress,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}

test("one authenticated user's normal budget does not block another behind the same proxy", async () => {
  for (let index = 0; index < 120; index++) {
    const response = await request(firstCookie);
    assert.equal(
      response.statusCode,
      200,
      `Request ${index + 1}: ${response.body}`,
    );
  }
  const limited = await request(firstCookie);
  assert.equal(limited.statusCode, 429);
  assert.equal(Number(limited.headers["x-ratelimit-limit"]), 120);
  assert.equal(
    (await request(firstAlternateCookie)).statusCode,
    429,
    "Rotating valid sessions for the same user must not reset their budget",
  );
  assert.equal(
    (await request(secondCookie)).statusCode,
    200,
    "A second verified user behind the same proxy has an independent budget",
  );
  assert.equal(
    (await request()).statusCode,
    200,
    "Authenticated traffic does not consume the anonymous IP budget",
  );
});

test("changing invalid cookies or spoofed proxy headers cannot evade the anonymous IP budget", async () => {
  // The previous test used one anonymous request from this same socket address.
  for (let index = 0; index < 119; index++) {
    const response = await request(`session=${newToken()}`, {
      "x-forwarded-for": `198.51.100.${(index % 200) + 1}`,
      "x-real-ip": `203.0.113.${(index % 200) + 1}`,
      "x-user-id": randomUUID(),
    });
    assert.equal(
      response.statusCode,
      200,
      `Anonymous request ${index + 2}: ${response.body}`,
    );
  }
  assert.equal((await request(`session=${newToken()}`)).statusCode, 429);
  assert.equal((await request()).statusCode, 429);
  assert.equal(
    (await request(secondCookie)).statusCode,
    200,
    "An exhausted anonymous proxy budget must not lock out a verified user",
  );
});

test("route-specific security limits remain lower than the global budget", async () => {
  const origin = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  for (let index = 0; index < 8; index++) {
    const response = await app.inject({
      url: "/api/v1/auth/forgot-password",
      method: "POST",
      remoteAddress: proxyAddress,
      headers: { origin, cookie: secondCookie },
      payload: { email: `missing-rate-limit-${randomUUID()}@example.test` },
    });
    assert.equal(response.statusCode, 200, response.body);
  }
  const response = await app.inject({
    url: "/api/v1/auth/forgot-password",
    method: "POST",
    remoteAddress: proxyAddress,
    headers: { origin, cookie: secondCookie },
    payload: { email: `missing-rate-limit-${randomUUID()}@example.test` },
  });
  assert.equal(response.statusCode, 429);
  assert.equal(Number(response.headers["x-ratelimit-limit"]), 8);
  assert.equal(
    (await request(secondCookie)).statusCode,
    200,
    "The lower route budget must not replace the remaining global budget",
  );
});
