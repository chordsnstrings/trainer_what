import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { runAdminAccess } from "../apps/api/src/admin-access.ts";
import { SuperadminAuthenticatorBanner } from "../apps/web/components/superadmin-access.tsx";

// Owner, 1 October 2026: "remove authentication for now, we can put it back
// later". AUTHENTICATOR_REQUIRED="false" (set only in compose.yaml) turns the
// authenticator requirement off; without it every step-up stays enforced.

const password = "SyntheticSuperadminOnly2026!";
const saved = {
  key: process.env.SECURITY_ENCRYPTION_KEY,
  switch: process.env.AUTHENTICATOR_REQUIRED,
};
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let address = 0;

function call(path: string, cookie?: string, body?: unknown, method?: string) {
  address++;
  return app.inject({
    method: (method ?? (body === undefined ? "GET" : "POST")) as any,
    url: "/api/v1" + path,
    payload: body as any,
    remoteAddress: `10.62.${(address >> 8) & 255}.${address & 255}`,
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      ...(cookie ? { cookie } : {}),
    },
  });
}
const sessionCookie = (r: any) =>
  ([] as string[])
    .concat(r.headers["set-cookie"] ?? [])
    .find((c) => c.startsWith("session="))
    ?.split(";")[0] ?? "";

before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  delete process.env.AUTHENTICATOR_REQUIRED;
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
  for (const [name, value] of [
    ["SECURITY_ENCRYPTION_KEY", saved.key],
    ["AUTHENTICATOR_REQUIRED", saved.switch],
  ] as const)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});

async function saveEmailSettings(cookie: string) {
  // Reading Superadmin settings is itself a step-up action.
  const listed = await call("/admin/settings", cookie);
  if (listed.statusCode !== 200) return listed;
  const email = listed
    .json()
    .integrations.find((item: any) => item.id === "email");
  return call(
    "/admin/settings/email",
    cookie,
    { revision: email.revision, enabled: false, values: {} },
    "PUT",
  );
}

test("a Superadmin without an authenticator saves platform settings only while the switch is off", async () => {
  const email = `superadmin-${randomUUID()}@example.test`;
  await runAdminAccess(
    db,
    "create",
    { ADMIN_ACCESS_EMAIL: email },
    async () => password,
    () => {},
  );
  const login = await call("/auth/login", undefined, { email, password });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = sessionCookie(login);

  // Unset: required, so the save needs a fresh authenticator check.
  let boot = (await call("/bootstrap", cookie)).json();
  assert.equal(boot.authenticatorRequired, true);
  assert.deepEqual(boot.superadmin, { mfaEnabled: false });
  const refused = await saveEmailSettings(cookie);
  assert.equal(refused.statusCode, 403, refused.body);
  assert.equal(refused.json().code, "MFA_STEP_UP");

  // Any value other than exactly "false" keeps it required.
  process.env.AUTHENTICATOR_REQUIRED = "no";
  assert.equal((await saveEmailSettings(cookie)).statusCode, 403);

  process.env.AUTHENTICATOR_REQUIRED = "false";
  try {
    boot = (await call("/bootstrap", cookie)).json();
    assert.equal(boot.authenticatorRequired, false);
    const security = (await call("/auth/security", cookie)).json();
    assert.equal(security.authenticatorRequired, false);
    assert.equal(security.mfaEnabled, false);
    const saved = await saveEmailSettings(cookie);
    assert.equal(saved.statusCode, 200, saved.body);
    // The banner and its nag disappear; the optional form stays reachable.
    assert.equal(
      renderToStaticMarkup(
        createElement(SuperadminAuthenticatorBanner, {
          state: boot,
          path: "/admin/settings",
        }),
      ),
      "",
    );
    // Passwords are untouched: a wrong one is still refused.
    const wrong = await call("/auth/login", undefined, {
      email,
      password: password + "x",
    });
    assert.equal(wrong.statusCode, 401);
  } finally {
    delete process.env.AUTHENTICATOR_REQUIRED;
  }
  assert.equal((await saveEmailSettings(cookie)).statusCode, 403);
});
