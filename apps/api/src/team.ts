import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, type Tx, event } from "@trainer/db";
import { newToken, tokenHash } from "./auth.ts";
import { requireRecentMfa } from "./security.ts";
type TeamActor = Actor & { mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const inviteInput = z
  .object({
    email: z
      .email()
      .max(320)
      .transform((v) => v.toLowerCase()),
    role: z.enum(["staff", "finance"]),
  })
  .strict();
function owner(a: TeamActor) {
  if (a.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the workspace owner can manage the team.",
    );
  requireRecentMfa(a, true);
  return a;
}
async function lock(tx: Tx, tenantId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":workspace",
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":team",
  ]);
}
async function activeWorkspace(tx: Tx, tenantId: string) {
  const [t] = await tx.query(
    "SELECT coalesce(to_jsonb(t)->>'lifecycle_state','active') AS state FROM tenants t WHERE id=$1",
    [tenantId],
  );
  return t?.state === "active";
}
async function currentOwner(tx: Tx, a: TeamActor) {
  await lock(tx, a.tenantId);
  if (!(await activeWorkspace(tx, a.tenantId)))
    throw fail(409, "WORKSPACE_CLOSED", "This workspace is closed.");
  const [m] = await tx.query(
    "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
    [a.tenantId, a.userId],
  );
  if (m?.role !== "owner")
    throw fail(403, "OWNER_REQUIRED", "Ownership changed. Sign in again.");
}
async function teamEvent(
  tx: Tx,
  a: Actor,
  name: string,
  subject: string,
  data: unknown,
) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
    [a.tenantId, a.userId],
  );
  await event(tx, a, name, subject, data);
  await tx.query("RESET ROLE");
}
/** Read token tenant first, then lock workspace/team before token; avoids acceptance/revocation deadlock. */
export async function lockActiveInvitation(tx: Tx, hash: string) {
  const [lookup] = await tx.query(
    "SELECT tenant_id FROM one_time_tokens WHERE token_hash=$1 AND purpose='invite'",
    [hash],
  );
  if (!lookup) return null;
  await lock(tx, lookup.tenant_id);
  if (!(await activeWorkspace(tx, lookup.tenant_id))) return null;
  const [invite] = await tx.query(
    "SELECT * FROM one_time_tokens WHERE token_hash=$1 AND purpose='invite' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
    [hash],
  );
  if (!invite) return null;
  if (["staff", "finance"].includes(invite.payload.role)) {
    if (!invite.payload.invitedBy) return null;
    const [issuer] = await tx.query(
      "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [invite.tenant_id, invite.payload.invitedBy],
    );
    if (issuer?.role !== "owner") return null;
  }
  return invite;
}
export async function createTeamInvitation(
  db: Database,
  a: TeamActor,
  input: unknown,
  publicUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
) {
  owner(a);
  const b = inviteInput.parse(input),
    token = newToken();
  return db.system(async (tx) => {
    await currentOwner(tx, a);
    const existing = await tx.query(
      "SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND u.email=$2",
      [a.tenantId, b.email],
    );
    if (existing.length)
      throw fail(
        409,
        "ALREADY_MEMBER",
        "This person is already a workspace member. Use role controls for team changes.",
      );
    await tx.query(
      "UPDATE one_time_tokens SET consumed_at=now() WHERE tenant_id=$1 AND purpose='invite' AND consumed_at IS NULL AND lower(payload->>'email')=$2 AND payload->>'role' IN ('staff','finance')",
      [a.tenantId, b.email],
    );
    const [r] = await tx.query(
      "INSERT INTO one_time_tokens(token_hash,purpose,tenant_id,payload,expires_at) VALUES($1,'invite',$2,$3,now()+interval '7 days') RETURNING id,expires_at",
      [
        tokenHash(token),
        a.tenantId,
        JSON.stringify({ ...b, invitedBy: a.userId }),
      ],
    );
    await teamEvent(tx, a, "team.invited", r.id, {
      email: b.email,
      role: b.role,
    });
    return {
      id: r.id,
      url: `${publicUrl.replace(/\/$/, "")}/join/${token}`,
      expiresInDays: 7,
      expiresAt: r.expires_at,
    };
  });
}
export async function touchTeamSession(db: Database, hash: string) {
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now() AND last_seen_at<now()-interval '5 minutes'",
      [hash],
    ),
  );
}
export function registerTeamRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => TeamActor,
) {
  app.get("/api/v1/team", async (req) => {
    const a = owner(identity(req));
    const result = await db.system(async (tx) => {
      await currentOwner(tx, a);
      const members = await tx.query(
        "SELECT m.user_id AS id,m.role,m.version,u.name,u.email,coalesce(sec.enabled,false) AS mfa_enabled,max(s.last_seen_at) AS last_active,max(s.created_at) AS last_sign_in FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN user_security sec ON sec.user_id=u.id LEFT JOIN sessions s ON s.user_id=u.id AND s.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.role IN ('owner','staff','finance') GROUP BY m.user_id,m.role,m.version,u.name,u.email,sec.enabled ORDER BY m.role,u.name",
        [a.tenantId],
      );
      const [passkeys] = await tx.query(
        "SELECT to_regclass('public.auth_passkeys') AS name",
      );
      const counts = passkeys.name
        ? await tx.query(
            "SELECT p.user_id,count(*)::int AS count FROM auth_passkeys p JOIN memberships m ON m.user_id=p.user_id WHERE m.tenant_id=$1 AND p.revoked_at IS NULL GROUP BY p.user_id",
            [a.tenantId],
          )
        : [];
      for (const member of members)
        member.passkeys = passkeys.name
          ? (counts.find((row) => row.user_id === member.id)?.count ?? 0)
          : null;
      const invitations = await tx.query(
        "SELECT id,payload->>'email' AS email,payload->>'role' AS role,created_at,expires_at FROM one_time_tokens WHERE tenant_id=$1 AND purpose='invite' AND payload->>'role' IN ('staff','finance') AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC",
        [a.tenantId],
      );
      return { members, invitations, currentUserId: a.userId };
    });
    const audit = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT id,name,subject_id,data,created_at FROM events WHERE name LIKE 'team.%' ORDER BY created_at DESC LIMIT 100",
      ),
    );
    return { ...result, audit };
  });
  app.post("/api/v1/team/invitations", async (req) =>
    createTeamInvitation(db, identity(req), req.body),
  );
  app.post("/api/v1/team/invitations/:id/revoke", async (req) => {
    const a = owner(identity(req)),
      invitationId = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    const b = z
      .object({ reason: z.string().trim().min(5).max(1000) })
      .strict()
      .parse(req.body);
    return db.system(async (tx) => {
      await currentOwner(tx, a);
      const [r] = await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE id=$1 AND tenant_id=$2 AND purpose='invite' AND consumed_at IS NULL AND payload->>'role' IN ('staff','finance') RETURNING id",
        [invitationId, a.tenantId],
      );
      if (!r)
        throw fail(
          409,
          "INVITE_CHANGED",
          "This invitation is unavailable or already used.",
        );
      await teamEvent(tx, a, "team.invitation_revoked", r.id, {
        reason: b.reason,
      });
      return { ok: true };
    });
  });
  app.patch("/api/v1/team/:userId", async (req) => {
    const a = owner(identity(req)),
      userId = z
        .string()
        .uuid()
        .parse((req.params as any).userId),
      b = z
        .object({
          revision: z.number().int().min(1),
          role: z.enum(["staff", "finance"]),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
    if (userId === a.userId)
      throw fail(
        400,
        "OWNER_PROTECTED",
        "Ownership changes use the verified transfer workflow.",
      );
    return db.system(async (tx) => {
      await currentOwner(tx, a);
      const [prior] = await tx.query(
        "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
        [a.tenantId, userId],
      );
      if (!prior || !["staff", "finance"].includes(prior.role))
        throw fail(404, "TEAM_MEMBER_NOT_FOUND", "Team member unavailable.");
      if (prior.version !== b.revision)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "This role changed. Reload first.",
        );
      if (prior.role === b.role)
        return { id: userId, role: prior.role, version: prior.version };
      const [updated] = await tx.query(
        "UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id AS id,role,version",
        [a.tenantId, userId, b.role],
      );
      await tx.query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2", [
        a.tenantId,
        userId,
      ]);
      await teamEvent(tx, a, "team.role_changed", userId, {
        from: prior.role,
        to: b.role,
        reason: b.reason,
      });
      return updated;
    });
  });
  app.delete("/api/v1/team/:userId", async (req) => {
    const a = owner(identity(req)),
      userId = z
        .string()
        .uuid()
        .parse((req.params as any).userId),
      b = z
        .object({
          revision: z.number().int().min(1),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
    if (userId === a.userId)
      throw fail(
        400,
        "OWNER_PROTECTED",
        "Ownership changes use the verified transfer workflow.",
      );
    return db.system(async (tx) => {
      await currentOwner(tx, a);
      const [m] = await tx.query(
        "DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role IN ('staff','finance') AND version=$3 RETURNING role",
        [a.tenantId, userId, b.revision],
      );
      if (!m)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "This membership changed or is protected. Reload first.",
        );
      await tx.query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2", [
        a.tenantId,
        userId,
      ]);
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE tenant_id=$1 AND purpose='invite' AND consumed_at IS NULL AND payload->>'role' IN ('staff','finance') AND lower(payload->>'email')=(SELECT email FROM users WHERE id=$2)",
        [a.tenantId, userId],
      );
      await teamEvent(tx, a, "team.revoked", userId, {
        role: m.role,
        reason: b.reason,
      });
      return { ok: true };
    });
  });
}
