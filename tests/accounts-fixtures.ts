// Shared synthetic fixtures for the accounts-* test files. Not a test file.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase, elevated, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { passwordHash, newToken, tokenHash } from "../apps/api/src/auth.ts";
import { totpAt } from "../apps/api/src/security.ts";
import { sealContexts, sealValue } from "../apps/api/src/sealing.ts";

export const password = "SyntheticAccountsOnly2026!";
export const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const origin = "http://localhost:3000";
export type Person = {
  userId: string;
  tenantId: string;
  email: string;
  cookie: string;
  token: string;
};
const envKeys = [
  "NODE_ENV",
  "PUBLIC_APP_URL",
  "SECURITY_ENCRYPTION_KEY",
  "SECURITY_ENCRYPTION_PREVIOUS_KEYS",
  "LEGAL_APPROVED",
  "EMAIL_API_URL",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
];
export function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values))
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Object.assign(process.env, { [key]: value });
}
export async function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T>,
) {
  const prior = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  setEnv(values);
  try {
    return await fn();
  } finally {
    setEnv(prior);
  }
}
export const code = (offset = 0) =>
  totpAt(secret, Math.floor(Date.now() / 30000) + offset);
export const sessionCookie = (r: any) =>
  ([] as string[])
    .concat(r.headers["set-cookie"] ?? [])
    .find((c) => c.startsWith("session=") && !c.startsWith("session=;"))
    ?.split(";")[0] ?? "";
export const cookieValue = (r: any, name: string) =>
  ([] as string[])
    .concat(r.headers["set-cookie"] ?? [])
    .find((c) => c.startsWith(name + "="))
    ?.split(";")[0] ?? "";

export async function accountsContext(
  options: Parameters<typeof buildApp>[0] = {},
) {
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  setEnv({
    NODE_ENV: undefined,
    PUBLIC_APP_URL: origin,
    SECURITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    SECURITY_ENCRYPTION_PREVIOUS_KEYS: undefined,
    LEGAL_APPROVED: undefined,
    EMAIL_API_URL: undefined,
    EMAIL_API_KEY: undefined,
    EMAIL_FROM: undefined,
  });
  const encoded = await passwordHash(password);
  const db: Database = await createDatabase({ memory: true });
  const app = await buildApp({ db, testing: true, ...options });
  const author = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,'Legal author',$2,$3,true)",
      [author, `legal-${author}@example.test`, encoded],
    );
    for (const key of ["terms", "privacy", "ai-disclosure"])
      await tx.query(
        "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at) VALUES($1,'legal',$2,1,$3,'Synthetic fixture text.','published',now()-interval '1 day',$4,$4,now()) ON CONFLICT(kind,key,version) DO NOTHING",
        [randomUUID(), key, "Fixture " + key, author],
      );
  });
  let address = 0;
  function call(
    path: string,
    options: {
      body?: unknown;
      cookie?: string;
      method?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    address++;
    const method =
      options.method ?? (options.body === undefined ? "GET" : "POST");
    return app.inject({
      method: method as any,
      url: "/api/v1" + path,
      payload: options.body as any,
      remoteAddress: `10.54.${(address >> 8) & 255}.${address & 255}`,
      headers: {
        host: "localhost:3000",
        origin,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...options.headers,
      },
    });
  }
  async function person(
    o: {
      role?: string;
      tenantId?: string;
      mfa?: boolean;
      platformRole?: string;
      verified?: boolean;
      name?: string;
      mfaFresh?: boolean;
      passwordHash?: string;
    } = {},
  ): Promise<Person> {
    const userId = randomUUID(),
      tenantId = o.tenantId ?? randomUUID(),
      token = newToken(),
      email = `acct-${userId}@example.test`;
    await db.system(async (tx) => {
      await tx.query(
        "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,$2,$3,$4,$5)",
        [
          userId,
          o.name ?? "Synthetic Member",
          email,
          o.passwordHash ?? encoded,
          o.verified ?? true,
        ],
      );
      if (!o.tenantId)
        await tx.query(
          "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
          [
            tenantId,
            "acct-" + tenantId.slice(0, 8),
            "Studio " + tenantId.slice(0, 6),
          ],
        );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [tenantId, userId, o.role ?? "owner"],
      );
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',CASE WHEN $4 THEN now() ELSE NULL END)",
        [tokenHash(token), userId, tenantId, o.mfaFresh ?? false],
      );
      if (o.mfa)
        await tx.query(
          "INSERT INTO user_security(user_id,totp_secret,enabled,last_counter) VALUES($1,$2,true,-1)",
          [userId, sealValue(sealContexts.authenticator(userId), secret)],
        );
      if (o.platformRole)
        await tx.query("UPDATE users SET platform_role=$2 WHERE id=$1", [
          userId,
          o.platformRole,
        ]);
    });
    return { userId, tenantId, email, cookie: "session=" + token, token };
  }
  async function join(p: Person, tenantId: string, role = "subscriber") {
    await db.system((tx) =>
      tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [tenantId, p.userId, role],
      ),
    );
  }
  async function freshCode(userId: string, offset = 0) {
    await db.system((tx) =>
      tx.query("UPDATE user_security SET last_counter=-1 WHERE user_id=$1", [
        userId,
      ]),
    );
    return code(offset);
  }
  async function emailJobs(tenantId: string, to: string, prefix: string) {
    return db.tenant(elevated("worker", { tenantId, role: "owner" }), (tx) =>
      tx.query(
        "SELECT intent_key,data FROM jobs WHERE intent_key LIKE $1 AND lower(data->>'to')=lower($2) ORDER BY created_at DESC",
        [prefix + ":%", to],
      ),
    );
  }
  async function events(tenantId: string, name: string, subject?: string) {
    return db.tenant(elevated("worker", { tenantId, role: "owner" }), (tx) =>
      tx.query(
        "SELECT actor_id,subject_id,data FROM events WHERE name=$1 AND ($2::text IS NULL OR subject_id=$2) ORDER BY created_at",
        [name, subject ?? null],
      ),
    );
  }
  async function sessionCount(userId: string, tenantId?: string) {
    const [row] = await db.system((tx) =>
      tx.query(
        "SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND ($2::uuid IS NULL OR tenant_id=$2)",
        [userId, tenantId ?? null],
      ),
    );
    return row.n as number;
  }
  async function close() {
    await app.close();
    await db.close();
    setEnv(saved);
  }
  return {
    db,
    app,
    encoded,
    call,
    person,
    join,
    freshCode,
    emailJobs,
    events,
    sessionCount,
    close,
  };
}
export function ok(r: { statusCode: number; body: string }, status = 200) {
  assert.equal(r.statusCode, status, r.body);
  return JSON.parse(r.body || "{}");
}
