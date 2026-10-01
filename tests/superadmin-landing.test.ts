import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { passwordHash } from "../apps/api/src/auth.ts";
import { totpAt } from "../apps/api/src/security.ts";
import { runAdminAccess } from "../apps/api/src/admin-access.ts";
import {
  SuperadminAuthenticatorBanner,
  coachSetupOpen,
  needsAuthenticator,
  signInLanding,
} from "../apps/web/components/superadmin-access.tsx";

// Owner report, 1 October 2026: a Superadmin created with
// `admin-access.sh create` signed in to the coach setup of its platform
// administration workspace and was never shown the authenticator setup.

const password = "SyntheticSuperadminOnly2026!";
const saved = process.env.SECURITY_ENCRYPTION_KEY;
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let address = 0;

function call(path: string, cookie?: string, body?: unknown) {
  address++;
  return app.inject({
    method: body === undefined ? "GET" : "POST",
    url: "/api/v1" + path,
    payload: body as any,
    remoteAddress: `10.61.${(address >> 8) & 255}.${address & 255}`,
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
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
  if (saved === undefined) delete process.env.SECURITY_ENCRYPTION_KEY;
  else process.env.SECURITY_ENCRYPTION_KEY = saved;
});

test("a Superadmin signs in to Super admin, not the coach setup", () => {
  assert.equal(
    signInLanding({ user: { role: "owner", platformRole: "admin" } }, "/login"),
    "/admin/settings",
  );
  // Coaches and subscribers keep their landing.
  assert.equal(
    signInLanding({ user: { role: "owner", platformRole: "none" } }, "/login"),
    "/trainer",
  );
  assert.equal(
    signInLanding({ user: { role: "owner", platformRole: "none" } }, "/signup"),
    "/setup",
  );
  assert.equal(
    signInLanding(
      { user: { role: "staff", platformRole: "support" } },
      "/login",
    ),
    "/trainer",
  );
  assert.equal(
    signInLanding(
      { user: { role: "subscriber", platformRole: "none" } },
      "/login",
    ),
    "/app",
  );
  // The platform administration workspace never offers the coach setup.
  const owner = { role: "owner" };
  assert.equal(coachSetupOpen({ user: owner, tenant: {} }), true);
  assert.equal(
    coachSetupOpen({ user: owner, tenant: {}, platformWorkspace: true }),
    false,
  );
  assert.equal(
    coachSetupOpen({ user: owner, tenant: { published: true } }),
    false,
  );
  assert.equal(coachSetupOpen({ user: { role: "staff" }, tenant: {} }), false);
});

test("a Superadmin without an authenticator sees the setup banner", () => {
  const admin = (mfaEnabled: boolean) => ({
    user: { platformRole: "admin" },
    superadmin: { mfaEnabled },
  });
  const banner = (state: any, path: string) =>
    renderToStaticMarkup(
      createElement(SuperadminAuthenticatorBanner, { state, path }),
    );
  const shown = banner(admin(false), "/admin/settings");
  assert.match(shown, /Set up your authenticator app to use Super admin/);
  assert.match(shown, /href="\/admin\/account-security"/);
  assert.match(banner(admin(false), "/trainer"), /Set up your authenticator/);
  // Not on the page that holds the form, not once enrolled, never for others.
  assert.equal(banner(admin(false), "/admin/account-security"), "");
  assert.equal(banner(admin(true), "/admin/settings"), "");
  assert.equal(banner({ user: { platformRole: "none" } }, "/trainer"), "");
  assert.equal(
    needsAuthenticator({ user: { platformRole: "support" } }),
    false,
  );
});

test("an admin-access Superadmin can enroll an authenticator after signing in", async () => {
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
  assert.ok(cookie);

  const boot = await call("/bootstrap", cookie);
  assert.equal(boot.statusCode, 200, boot.body);
  assert.equal(boot.json().user.platformRole, "admin");
  assert.equal(boot.json().tenant.name, "Platform administration");
  assert.equal(boot.json().platformWorkspace, true);
  assert.deepEqual(boot.json().superadmin, { mfaEnabled: false });

  const status = await call("/auth/security", cookie);
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().mfaConfigured, true);
  assert.equal(status.json().mfaEnabled, false);
  assert.equal(status.json().hasPassword, true);
  assert.equal(status.json().emailVerified, true);

  const enrolled = await call("/auth/mfa/enroll", cookie, { password });
  assert.equal(enrolled.statusCode, 200, enrolled.body);
  const confirmed = await call("/auth/mfa/confirm", cookie, {
    code: totpAt(enrolled.json().secret, Math.floor(Date.now() / 30000)),
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().recoveryCodes.length, 10);

  assert.equal((await call("/auth/security", cookie)).json().mfaEnabled, true);
  assert.deepEqual((await call("/bootstrap", cookie)).json().superadmin, {
    mfaEnabled: true,
  });
});

test("a coach workspace is not a platform workspace and gets no Superadmin status", async () => {
  const userId = randomUUID(),
    tenantId = randomUUID(),
    email = `coach-${userId}@example.test`;
  const hash = await passwordHash(password);
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,'Synthetic Coach',$2,$3,true)",
      [userId, email, hash],
    );
    await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Coach')", [
      tenantId,
      "coach-" + tenantId.slice(0, 8),
    ]);
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
  });
  const login = await call("/auth/login", undefined, { email, password });
  assert.equal(login.statusCode, 200, login.body);
  const boot = (await call("/bootstrap", sessionCookie(login))).json();
  assert.equal(boot.platformWorkspace, false);
  assert.equal(boot.superadmin, undefined);
  assert.equal(coachSetupOpen(boot), true);
});
