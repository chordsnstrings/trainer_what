// Shared synthetic fixtures for the discovery tests (not a test file itself).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { signHostRequest, HOST_HEADERS } from "../apps/api/src/host-routing.ts";

export const PLATFORM = "http://localhost:3000";
export const SECRET = "synthetic-discovery-proof-key-with-32-bytes";
const saved: Record<string, string | undefined> = {};
const managed = [
  "PUBLIC_APP_URL",
  "INTERNAL_PROXY_SECRET",
  "COACH_DIRECTORY_ENABLED",
];

export type Harness = {
  db: Database;
  app: Awaited<ReturnType<typeof buildApp>>;
};
export async function start(): Promise<Harness> {
  for (const key of managed) saved[key] = process.env[key];
  process.env.PUBLIC_APP_URL = PLATFORM;
  process.env.INTERNAL_PROXY_SECRET = SECRET;
  delete process.env.COACH_DIRECTORY_ENABLED;
  const db = await createDatabase({ memory: true });
  const app = await buildApp({ db, testing: true });
  return { db, app };
}
export async function stop(h: Partial<Harness>) {
  await h.app?.close();
  await h.db?.close();
  for (const key of managed)
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
}

type Options = {
  method?: string;
  body?: unknown;
  cookie?: string;
  /** A connected coach domain; the request carries a signed host proof. */
  host?: string;
  origin?: string;
};
export function call(h: Harness, path: string, options: Options = {}) {
  const url = "/api/v1" + path,
    method = options.method ?? "GET",
    time = String(Date.now());
  return h.app.inject({
    url,
    method: method as any,
    payload: options.body as any,
    headers: {
      origin:
        options.origin ?? (options.host ? "https://" + options.host : PLATFORM),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.host
        ? {
            host: "127.0.0.1:4000",
            [HOST_HEADERS.host]: options.host,
            [HOST_HEADERS.time]: time,
            [HOST_HEADERS.signature]: signHostRequest(
              options.host,
              method,
              url,
              time,
              SECRET,
            ),
          }
        : {}),
    },
  });
}
export async function ok(h: Harness, path: string, options: Options = {}) {
  const r = await call(h, path, options);
  assert.equal(r.statusCode, 200, `${path}: ${r.body}`);
  return r.json();
}

export type Coach = {
  tenantId: string;
  userId: string;
  slug: string;
  cookie: string;
};
export async function coach(
  h: Harness,
  slug: string,
  name = "Coach " + slug,
): Promise<Coach> {
  const r = await call(h, "/auth/register", {
    method: "POST",
    body: {
      name,
      email: slug + "@discovery.test",
      password: "DiscoveryFixture2026!",
      slug,
      accepted: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const user = (await ok(h, "/bootstrap", { cookie })).user;
  // Registration names the workspace after the person; keep the given name.
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET name=$2 WHERE id=$1", [user.tenantId, name]),
  );
  return { tenantId: user.tenantId, userId: user.userId, slug, cookie };
}
/** A member with a live session, created through system tables only. */
export async function member(h: Harness, tenantId: string, role: string) {
  const userId = randomUUID(),
    token = randomUUID() + randomUUID();
  await h.db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,'synthetic')",
      [userId, "Private Follower " + role, userId + "@member.discovery.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(token), userId, tenantId],
    );
  });
  return { userId, tenantId, role, cookie: "session=" + token };
}
export async function launch(h: Harness, c: Coach) {
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [c.tenantId]),
  );
}
/** Save and publish a website through the owner's own routes. */
export async function publishSite(
  h: Harness,
  c: Coach,
  site: Record<string, unknown>,
) {
  await launch(h, c);
  const current = await ok(h, "/tenant/site", { cookie: c.cookie });
  const draft = await ok(h, "/tenant/site", {
    method: "PUT",
    cookie: c.cookie,
    body: { version: current.version, site },
  });
  return ok(h, "/tenant/site/publish", {
    method: "POST",
    cookie: c.cookie,
    body: { version: draft.version },
  });
}
export async function listing(
  h: Harness,
  c: Coach,
  body: {
    listed: boolean;
    specialties: string[];
    languages: string[];
  },
) {
  const current = await ok(h, "/tenant/directory", { cookie: c.cookie });
  return ok(h, "/tenant/directory", {
    method: "PUT",
    cookie: c.cookie,
    body: { version: current.version, ...body },
  });
}
export async function connectDomain(h: Harness, c: Coach, hostname: string) {
  await h.db.system((tx) =>
    tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,active,verified_at) VALUES($1,$2,true,now())",
      [hostname, c.tenantId],
    ),
  );
}
