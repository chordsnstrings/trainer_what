// Synthetic fixtures for the governance tests. Every account, workspace and
// amount here is invented test data; no provider is contacted.
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  elevated,
  type Actor,
  type Database,
} from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { passwordHash, newToken, tokenHash } from "../apps/api/src/auth.ts";

export const password = "GovernanceFixture2026!";
export type Person = {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  cookie: string;
};

export async function governanceFixture(
  options: {
    providers?: NonNullable<Parameters<typeof buildApp>[0]>["providers"];
  } = {},
) {
  const saved = {
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
  };
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  Reflect.deleteProperty(process.env, "SUPPORT_EMAIL");
  const encoded = await passwordHash(password);
  const db: Database = await createDatabase({ memory: true });
  // Provider fixtures (such as a fake Stripe client) never contact a provider.
  const app = await buildApp({
    db,
    testing: true,
    ...(options.providers ? { providers: options.providers } : {}),
  });
  let address = 0;
  const call = (
    path: string,
    options: { body?: unknown; cookie?: string; method?: string } = {},
  ) => {
    address++;
    return app.inject({
      method: (options.method ??
        (options.body === undefined ? "GET" : "POST")) as any,
      url: "/api/v1" + path,
      payload: options.body as any,
      // Distinct client addresses keep per-address auth budgets independent.
      remoteAddress: `10.91.${(address >> 8) & 255}.${address & 255}`,
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
    });
  };
  async function workspace(
    name = "Workspace " + randomUUID().slice(0, 8),
    options: { published?: boolean } = {},
  ) {
    const id = randomUUID();
    await db.system((tx) =>
      tx.query(
        "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,$4)",
        [id, "gov-" + id.slice(0, 12), name, options.published ?? true],
      ),
    );
    return id;
  }
  async function session(userId: string, tenantId: string, fresh = true) {
    const token = newToken();
    await db.system((tx) =>
      tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',CASE WHEN $4 THEN now() ELSE NULL END)",
        [tokenHash(token), userId, tenantId, fresh],
      ),
    );
    return "session=" + token;
  }
  async function person(
    options: {
      tenantId?: string;
      role?: string;
      platformRole?: string;
      fresh?: boolean;
      name?: string;
    } = {},
  ): Promise<Person> {
    const userId = randomUUID(),
      tenantId = options.tenantId ?? (await workspace()),
      role = options.role ?? "owner",
      email = `gov-${userId}@example.test`;
    await db.system(async (tx) => {
      await tx.query(
        "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,$2,$3,$4,true)",
        [userId, options.name ?? "Synthetic Person", email, encoded],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [tenantId, userId, role],
      );
      if (options.platformRole)
        await tx.query("UPDATE users SET platform_role=$2 WHERE id=$1", [
          userId,
          options.platformRole,
        ]);
    });
    return {
      userId,
      tenantId,
      email,
      role,
      cookie: await session(userId, tenantId, options.fresh ?? true),
    };
  }
  /** A platform operator in their own administration workspace. */
  const operator = (platformRole: string, fresh = true) =>
    person({ platformRole, fresh, name: "Synthetic " + platformRole });
  /** Seeds and inspects workspace rows the way the worker does. */
  const scoped = (tenantId: string, role = "owner"): Actor =>
    elevated("worker", { tenantId, role });
  const cookieOf = (response: any) =>
    ([] as string[])
      .concat(response.headers["set-cookie"] ?? [])
      .find((c) => c.startsWith("session="))
      ?.split(";")[0] ?? "";
  async function close() {
    await app.close();
    await db.close();
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
  }
  return {
    db,
    app,
    call,
    workspace,
    session,
    person,
    operator,
    scoped,
    cookieOf,
    close,
  };
}
