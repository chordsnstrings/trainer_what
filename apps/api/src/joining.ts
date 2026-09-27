import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { newToken, tokenHash } from "./auth.ts";
import { lockActiveInvitation } from "./team.ts";
import { notifyCoachingTeam } from "./notifications.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import {
  runtimeConfig,
  strictSecurity,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";

/**
 * Follower invitations and joining. Invitations remain single-use
 * `one_time_tokens` rows holding only the link's hash; the outcome (accepted,
 * cancelled, replaced) is recorded in the row's payload so an owner can see
 * every invitation's status. The plain link exists only in the creation or
 * resend response and, when requested, in one queued email job that the worker
 * sends only while that exact link is still current.
 */
type JoinIdentity = Actor & {
  name?: string;
  email?: string;
  platformRole?: string;
  mfaAt?: string | null;
};
type StartSession = (
  reply: FastifyReply,
  userId: string,
  tenantId: string,
  mfa?: boolean,
) => Promise<void>;
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const uuid = z.string().uuid();
export const INVITATION_DAYS = 7;
/** Minimum gap between two emails for the same invitation. */
export const INVITATION_RESEND_COOLDOWN_MINUTES = 5;

/** Superadmin-configurable joining limits (application settings). */
export function joiningLimits(config: RuntimeConfig = runtimeConfig()) {
  const int = (key: string, fallback: number, min: number, max: number) => {
    const raw = config[key]?.trim();
    const n = raw ? Number(raw) : fallback;
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    invitationEmailsPerDay: int("FOLLOWER_INVITE_EMAILS_PER_DAY", 50, 0, 10000),
    invitationEmailsPerAddress: int(
      "FOLLOWER_INVITE_EMAILS_PER_ADDRESS",
      3,
      1,
      20,
    ),
    complimentaryMaxDays: int("COMPLIMENTARY_ACCESS_MAX_DAYS", 365, 1, 3650),
    complimentaryMaxActive: int(
      "COMPLIMENTARY_ACCESS_MAX_ACTIVE",
      25,
      0,
      100000,
    ),
    complimentaryOpenEnded:
      (config.COMPLIMENTARY_ACCESS_OPEN_ENDED?.trim() || "true") !== "false",
  };
}
export function invitationEmailConfigured(
  config: RuntimeConfig = runtimeConfig(),
) {
  return !!(config.EMAIL_API_KEY && config.EMAIL_API_URL && config.EMAIL_FROM);
}
export function legalOpen() {
  return !(strictSecurity() && runtimeConfig().LEGAL_APPROVED !== "true");
}
function maskEmail(email: string) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(local.length - 1, 6)))}@${domain}`;
}
async function lockInvitations(tx: Tx, tenantId: string) {
  // Same order as lockActiveInvitation: workspace, then team, then the token.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":workspace",
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":team",
  ]);
}
/** Confirms current ownership of an active workspace; returns its name. */
async function currentOwner(tx: Tx, a: Actor): Promise<string> {
  const [current] = await tx.query(
    "SELECT t.name FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='owner' AND t.lifecycle_state='active'",
    [a.tenantId, a.userId],
  );
  if (!current)
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Current workspace owner access is required",
    );
  return current.name;
}
async function asTenant(tx: Tx, a: Actor, role = "owner") {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
    [a.tenantId, a.userId, role],
  );
}
/** Derived status for owners and the invitee. */
export function invitationStatus(row: any, now = Date.now()) {
  if (row.consumed_at) {
    const outcome = row.payload?.outcome;
    if (outcome === "cancelled" || outcome === "replaced") return "cancelled";
    return "accepted";
  }
  return new Date(row.expires_at).getTime() <= now ? "expired" : "pending";
}
function deliveryStatus(job: any) {
  if (!job) return null;
  if (job.status === "pending")
    return /configuration/i.test(job.last_error ?? "")
      ? "waiting_for_email_setup"
      : "queued";
  if (job.status === "completed")
    return job.data?.deliveryState === "delivered" ? "sent" : "not_sent";
  if (job.status === "failed") return "failed";
  return "unknown";
}
async function emailBudget(tx: Tx, to: string) {
  const [used] = await tx.query(
    "SELECT count(*)::int AS workspace,count(*) FILTER (WHERE lower(data->>'to')=$1)::int AS address FROM jobs WHERE kind='email' AND intent_key LIKE 'invite-email:%' AND created_at>now()-interval '1 day'",
    [to],
  );
  const limits = joiningLimits();
  if (used.workspace >= limits.invitationEmailsPerDay)
    return {
      ok: false,
      message: `This workspace reached its limit of ${limits.invitationEmailsPerDay} invitation emails in 24 hours. Copy the link and share it yourself.`,
    };
  if (used.address >= limits.invitationEmailsPerAddress)
    return {
      ok: false,
      message: `This address already received ${limits.invitationEmailsPerAddress} invitation emails in 24 hours. Copy the link and share it yourself.`,
    };
  return { ok: true, message: "" };
}
/** Stops unsent emails for an invitation (all sends, or all but `keep`). */
async function suppressInvitationEmails(
  tx: Tx,
  invitationId: string,
  reason: string,
  keep?: number,
) {
  await tx.query(
    "UPDATE jobs SET status='completed',leased_until=NULL,last_error=$2,data=data-'text' WHERE kind='email' AND intent_key LIKE $1 AND status='pending' AND ($3::int IS NULL OR (data->>'send')::int<>$3)",
    [`invite-email:${invitationId}:%`, reason, keep ?? null],
  );
}
async function queueInvitationEmail(
  tx: Tx,
  input: {
    tenantId: string;
    coach: string;
    invitationId: string;
    send: number;
    to: string;
    url: string;
    expiresAt: string;
  },
) {
  const coach = input.coach || "Your coach";
  const platform = runtimeConfig().APP_NAME || "Trainer Brain";
  const expires = new Date(input.expiresAt).toISOString().slice(0, 10);
  await tx.query(
    "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'email',$3,$4) ON CONFLICT DO NOTHING",
    [
      randomUUID(),
      input.tenantId,
      `invite-email:${input.invitationId}:${input.send}`,
      JSON.stringify({
        invitationId: input.invitationId,
        send: input.send,
        to: input.to,
        category: "account",
        // The join link is a bearer credential: the worker removes the text
        // after a terminal outcome and never sends after the link expires.
        sensitive: true,
        expiresAt: input.expiresAt,
        subject: `${coach} invited you to join their coaching space`,
        text: `${coach} has invited you to join their coaching space on ${platform}.\n\nAccept your invitation: ${input.url}\n\nThis invitation expires on ${expires}. If you already have an account, sign in first and open the link to join without creating a new account. If you did not expect this invitation, you can ignore this email.`,
      }),
    ],
  );
}
/** Worker check: send only while this exact link is the pending, current one. */
export async function invitationEmailCurrent(
  db: Database,
  tenantId: string,
  job: any,
  now = new Date(),
) {
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT o.consumed_at,o.expires_at,o.payload,t.lifecycle_state FROM one_time_tokens o JOIN tenants t ON t.id=o.tenant_id WHERE o.id=$1 AND o.tenant_id=$2 AND o.purpose='invite'",
      [job.data.invitationId, tenantId],
    ),
  );
  return (
    !!row &&
    row.lifecycle_state === "active" &&
    !row.consumed_at &&
    new Date(row.expires_at).getTime() > now.getTime() &&
    Number(row.payload?.sends ?? 0) === Number(job.data.send)
  );
}

const createInput = z
  .object({
    email: z
      .email()
      .max(320)
      .transform((v) => v.toLowerCase()),
    role: z.literal("subscriber"),
    sendEmail: z.boolean().default(false),
  })
  .strict();
export async function createFollowerInvitation(
  db: Database,
  a: Actor,
  input: unknown,
  origin: string,
) {
  const b = createInput.parse(input);
  const token = newToken(),
    url = `${origin.replace(/\/$/, "")}/join/${token}`;
  const emailReady = invitationEmailConfigured();
  return db.system(async (tx) => {
    await lockInvitations(tx, a.tenantId);
    const coach = await currentOwner(tx, a);
    const [member] = await tx.query(
      "SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND lower(u.email)=$2",
      [a.tenantId, b.email],
    );
    if (member)
      throw fail(
        409,
        "ALREADY_MEMBER",
        "This person already belongs to your coaching space.",
      );
    // One pending invitation per address: a new one replaces the earlier link.
    const replaced = await tx.query(
      "UPDATE one_time_tokens SET consumed_at=now(),payload=payload||jsonb_build_object('outcome','replaced','outcomeAt',now()) WHERE tenant_id=$1 AND purpose='invite' AND consumed_at IS NULL AND payload->>'role'='subscriber' AND lower(payload->>'email')=$2 RETURNING id",
      [a.tenantId, b.email],
    );
    const [row] = await tx.query(
      "INSERT INTO one_time_tokens(token_hash,purpose,tenant_id,payload,expires_at) VALUES($1,'invite',$2,$3,now()+make_interval(days=>$4)) RETURNING id,expires_at,created_at",
      [
        tokenHash(token),
        a.tenantId,
        JSON.stringify({
          email: b.email,
          role: "subscriber",
          invitedBy: a.userId,
          emailRequested: b.sendEmail,
          sends: 0,
        }),
        INVITATION_DAYS,
      ],
    );
    const expiresAt = new Date(row.expires_at).toISOString();
    await asTenant(tx, a);
    for (const old of replaced)
      await suppressInvitationEmails(
        tx,
        old.id,
        "Replaced by a newer invitation before delivery",
      );
    let email: { status: string; message: string } = {
      status: "not_requested",
      message: "",
    };
    if (b.sendEmail) {
      const budget = emailReady ? await emailBudget(tx, b.email) : null;
      if (!emailReady)
        email = {
          status: "unavailable",
          message:
            "Email delivery is not configured. Copy the link and share it yourself.",
        };
      else if (!budget!.ok)
        email = { status: "rate_limited", message: budget!.message };
      else {
        await queueInvitationEmail(tx, {
          tenantId: a.tenantId,
          coach,
          invitationId: row.id,
          send: 1,
          to: b.email,
          url,
          expiresAt,
        });
        email = { status: "queued", message: "The invitation email is queued." };
      }
    }
    await event(tx, a, "follower.invited", row.id, {
      emailRequested: b.sendEmail,
      emailStatus: email.status,
      replaced: replaced.length,
    });
    await tx.query("RESET ROLE");
    await tx.query(
      "UPDATE one_time_tokens SET payload=payload||$2::jsonb WHERE id=$1",
      [
        row.id,
        JSON.stringify(
          email.status === "queued"
            ? { sends: 1, lastSentAt: new Date().toISOString() }
            : { emailNote: email.status },
        ),
      ],
    );
    return {
      id: row.id,
      url,
      expiresInDays: INVITATION_DAYS,
      expiresAt,
      email,
    };
  });
}

/** Records acceptance and alerts the coaching team. Call after lockActiveInvitation. */
export async function completeInvitationAcceptance(
  tx: Tx,
  input: { invite: any; userId: string; registrationVersion: string },
) {
  const { invite, userId } = input;
  const [membership] = await tx.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id",
    [invite.tenant_id, userId, invite.payload.role],
  );
  await tx.query(
    "UPDATE one_time_tokens SET consumed_at=now(),payload=payload||jsonb_build_object('outcome','accepted','outcomeAt',now(),'acceptedUserId',$2::text) WHERE token_hash=$1",
    [invite.token_hash, userId],
  );
  if (membership) {
    const a = {
      tenantId: invite.tenant_id,
      userId,
      role: invite.payload.role,
    };
    await asTenant(tx, a, a.role);
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'registration',$4,true)",
      [randomUUID(), invite.tenant_id, userId, input.registrationVersion],
    );
    if (invite.payload.role === "subscriber") {
      // Unsent copies of this link are withdrawn (jobs are staff-scoped).
      await tx.query("SELECT set_config('app.role','owner',true)");
      await suppressInvitationEmails(
        tx,
        invite.id,
        "Accepted before delivery",
      );
      await tx.query("SELECT set_config('app.role',$1,true)", [a.role]);
      await event(tx, a, "follower.joined", userId, {
        source: "invitation",
        invitationId: invite.id,
      });
      await announceFollowerJoined(tx, a, "invitation", invite.id);
    }
    await tx.query("RESET ROLE");
  }
  return !!membership;
}
/**
 * In-app alert to the owner and coaching staff (email and push follow each
 * person's notification preferences). Run as the joining member inside the
 * joining transaction so the alert commits with the membership.
 */
export async function announceFollowerJoined(
  tx: Tx,
  follower: Actor,
  source: "invitation" | "website",
  reference?: string,
) {
  const [person] = await tx.query("SELECT name FROM users WHERE id=$1", [
    follower.userId,
  ]);
  await notifyCoachingTeam(tx, follower, {
    category: "coaching",
    dedupeKey: `follower-joined:${follower.userId}:${source}:${reference ?? "site"}`,
    title: "A new follower joined",
    body: `${person?.name ?? "A new follower"} joined your coaching space ${source === "invitation" ? "through your invitation" : "from your coaching website"}. Open their profile to welcome them and assign a program.`,
    href: `/trainer/subscribers/${follower.userId}`,
    templateKey: "follower-joined",
    source: { type: "follower_joined", userId: follower.userId, via: source },
  });
}

export function registerJoiningRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => JoinIdentity,
  startSession: StartSession,
  options: {
    publicUrl: () => string;
    afterJoin?: (req: FastifyRequest, actor: Actor) => Promise<unknown>;
  },
) {
  const owner = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(403, "OWNER_REQUIRED", "Only the trainer owner can do this");
    return a;
  };
  const invitationRow = async (tx: Tx, a: Actor, id: string) => {
    const [row] = await tx.query(
      "SELECT * FROM one_time_tokens WHERE id=$1 AND tenant_id=$2 AND purpose='invite' AND payload->>'role'='subscriber' FOR UPDATE",
      [id, a.tenantId],
    );
    if (!row) throw fail(404, "INVITE_NOT_FOUND", "Invitation unavailable.");
    return row;
  };
  app.get("/api/v1/invitations/followers", async (req) => {
    const a = owner(req);
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT id,payload,created_at,expires_at,consumed_at FROM one_time_tokens WHERE tenant_id=$1 AND purpose='invite' AND payload->>'role'='subscriber' ORDER BY created_at DESC LIMIT 100",
        [a.tenantId],
      ),
    );
    const jobs = rows.length
      ? await db.tenant({ ...a, role: "owner" }, (tx) =>
          tx.query(
            "SELECT DISTINCT ON (data->>'invitationId') data->>'invitationId' AS invitation_id,status,last_error,created_at,jsonb_build_object('deliveryState',data->'deliveryState','send',data->'send') AS data FROM jobs WHERE kind='email' AND intent_key LIKE 'invite-email:%' AND data->>'invitationId'=ANY($1::text[]) ORDER BY data->>'invitationId',(data->>'send')::int DESC,created_at DESC",
            [rows.map((r) => r.id)],
          ),
        )
      : [];
    const now = Date.now();
    return {
      emailConfigured: invitationEmailConfigured(),
      limits: {
        emailsPerDay: joiningLimits().invitationEmailsPerDay,
        emailsPerAddress: joiningLimits().invitationEmailsPerAddress,
        resendCooldownMinutes: INVITATION_RESEND_COOLDOWN_MINUTES,
        validDays: INVITATION_DAYS,
      },
      invitations: rows.map((r) => {
        const job = jobs.find((j) => j.invitation_id === r.id);
        const status = invitationStatus(r, now);
        return {
          id: r.id,
          email: r.payload.email,
          status,
          replaced: r.payload.outcome === "replaced",
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          acceptedAt:
            status === "accepted"
              ? (r.payload.outcomeAt ?? r.consumed_at)
              : null,
          cancelledAt:
            status === "cancelled"
              ? (r.payload.outcomeAt ?? r.consumed_at)
              : null,
          sends: Number(r.payload.sends ?? 0),
          lastSentAt: r.payload.lastSentAt ?? null,
          delivery: {
            requested: r.payload.emailRequested === true,
            status:
              deliveryStatus(job) ??
              (r.payload.emailNote ??
                (r.payload.emailRequested ? "not_sent" : "not_requested")),
            detail:
              job?.status === "failed" || job?.status === "blocked"
                ? (job.last_error ?? null)
                : null,
          },
        };
      }),
    };
  });
  app.post(
    "/api/v1/invitations/followers/:id/cancel",
    { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req),
        id = uuid.parse((req.params as any).id);
      z.object({ reason: z.string().trim().max(500).optional() })
        .strict()
        .parse(req.body ?? {});
      return db.system(async (tx) => {
        await lockInvitations(tx, a.tenantId);
        await currentOwner(tx, a);
        await invitationRow(tx, a, id);
        const [r] = await tx.query(
          "UPDATE one_time_tokens SET consumed_at=now(),payload=payload||jsonb_build_object('outcome','cancelled','outcomeAt',now(),'cancelledBy',$3::text) WHERE id=$1 AND tenant_id=$2 AND purpose='invite' AND consumed_at IS NULL RETURNING id,payload,created_at,expires_at,consumed_at",
          [id, a.tenantId, a.userId],
        );
        if (!r)
          throw fail(
            409,
            "INVITE_CHANGED",
            "This invitation was already accepted or cancelled.",
          );
        await asTenant(tx, a);
        await suppressInvitationEmails(
          tx,
          id,
          "Invitation cancelled before delivery",
        );
        await event(tx, a, "follower.invitation_cancelled", id);
        await tx.query("RESET ROLE");
        return { id, status: invitationStatus(r) };
      });
    },
  );
  app.post(
    "/api/v1/invitations/followers/:id/resend",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req),
        id = uuid.parse((req.params as any).id);
      z.object({}).strict().parse(req.body ?? {});
      if (!invitationEmailConfigured())
        throw fail(
          409,
          "EMAIL_UNAVAILABLE",
          "Email delivery is not configured. Create a new invitation and copy its link instead.",
        );
      const token = newToken(),
        url = `${(req.hostContext?.origin ?? options.publicUrl()).replace(/\/$/, "")}/join/${token}`;
      return db.system(async (tx) => {
        await lockInvitations(tx, a.tenantId);
        const coach = await currentOwner(tx, a);
        const row = await invitationRow(tx, a, id);
        if (invitationStatus(row) !== "pending")
          throw fail(
            409,
            "INVITE_CHANGED",
            "Only a pending invitation can be sent again.",
          );
        const last = Date.parse(row.payload.lastSentAt ?? "");
        if (
          Number.isFinite(last) &&
          Date.now() - last < INVITATION_RESEND_COOLDOWN_MINUTES * 60000
        )
          throw fail(
            429,
            "INVITE_RESEND_COOLDOWN",
            `This invitation was emailed in the last ${INVITATION_RESEND_COOLDOWN_MINUTES} minutes. Wait before sending it again.`,
          );
        await asTenant(tx, a);
        const budget = await emailBudget(tx, row.payload.email);
        if (!budget.ok) throw fail(429, "INVITE_EMAIL_LIMIT", budget.message);
        await tx.query("RESET ROLE");
        // The plain link is never stored, so a resend issues a fresh link and
        // retires the previous one; the 7-day window restarts.
        const send = Number(row.payload.sends ?? 0) + 1;
        const [updated] = await tx.query(
          "UPDATE one_time_tokens SET token_hash=$2,expires_at=now()+make_interval(days=>$3),payload=payload||$4::jsonb WHERE id=$1 AND consumed_at IS NULL RETURNING expires_at",
          [
            id,
            tokenHash(token),
            INVITATION_DAYS,
            JSON.stringify({
              sends: send,
              lastSentAt: new Date().toISOString(),
              emailRequested: true,
              emailNote: null,
            }),
          ],
        );
        const expiresAt = new Date(updated.expires_at).toISOString();
        await asTenant(tx, a);
        await suppressInvitationEmails(
          tx,
          id,
          "Superseded by a newer invitation email",
          send,
        );
        await queueInvitationEmail(tx, {
          tenantId: a.tenantId,
          coach,
          invitationId: id,
          send,
          to: row.payload.email,
          url,
          expiresAt,
        });
        await event(tx, a, "follower.invitation_resent", id, { send });
        await tx.query("RESET ROLE");
        return {
          id,
          url,
          expiresAt,
          email: { status: "queued", message: "A fresh invitation email is queued." },
        };
      });
    },
  );
  /** What the invitee sees before joining. The token itself is the credential. */
  app.post(
    "/api/v1/invitations/preview",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req) => {
      const b = z
        .object({ token: z.string().min(20).max(200) })
        .strict()
        .parse(req.body);
      const [row] = await db.system((tx) =>
        tx.query(
          "SELECT o.id,o.tenant_id,o.payload,o.expires_at,o.consumed_at,t.name,t.slug,t.lifecycle_state FROM one_time_tokens o JOIN tenants t ON t.id=o.tenant_id WHERE o.token_hash=$1 AND o.purpose='invite'",
          [tokenHash(b.token)],
        ),
      );
      if (!row || row.lifecycle_state !== "active")
        throw fail(404, "INVALID_INVITE", "Invitation is invalid or expired");
      if (req.hostContext?.custom && row.tenant_id !== req.hostContext.tenantId)
        throw fail(
          403,
          "HOST_TENANT_MISMATCH",
          "This invitation must be accepted at its own coaching or platform address.",
        );
      const viewer = req.identity as JoinIdentity | undefined;
      let alreadyMember = false;
      if (viewer)
        alreadyMember = !!(
          await db.system((tx) =>
            tx.query(
              "SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2",
              [row.tenant_id, viewer.userId],
            ),
          )
        ).length;
      const matches =
        !!viewer?.email &&
        viewer.email.toLowerCase() === String(row.payload.email).toLowerCase();
      return {
        coach: { name: row.name, slug: row.slug },
        role: row.payload.role,
        status: invitationStatus(row),
        replaced: row.payload.outcome === "replaced",
        expiresAt: row.expires_at,
        invitedEmail: matches ? row.payload.email : maskEmail(row.payload.email),
        legalOpen: legalOpen(),
        viewer: viewer
          ? {
              signedIn: true,
              name: viewer.name ?? "",
              email: viewer.email ?? "",
              emailMatches: matches,
              alreadyMember,
              currentWorkspace: viewer.tenantId === row.tenant_id,
            }
          : { signedIn: false },
      };
    },
  );
  /** One-click acceptance for a signed-in account invited by its own address. */
  app.post(
    "/api/v1/invitations/accept-signed-in",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const a = identity(req);
      const b = z
        .object({
          token: z.string().min(20).max(200),
          accepted: z.literal(true),
        })
        .strict()
        .parse(req.body);
      if (!legalOpen())
        throw fail(
          503,
          "LEGAL_PENDING",
          "Invitations are waiting for the published legal documents",
        );
      const registrationVersion = await legalAcceptanceVersion(
        db,
        "registration",
      );
      const result = await db.system(async (tx) => {
        const invite = await lockActiveInvitation(tx, tokenHash(b.token));
        if (!invite)
          throw fail(400, "INVALID_INVITE", "Invitation is invalid or expired");
        if (invite.payload.role !== "subscriber")
          throw fail(
            409,
            "TEAM_INVITE_PASSWORD",
            "Team invitations are accepted with your password on the invitation form.",
          );
        if (
          req.hostContext?.custom &&
          invite.tenant_id !== req.hostContext.tenantId
        )
          throw fail(
            403,
            "HOST_TENANT_MISMATCH",
            "This invitation must be accepted at its own coaching or platform address.",
          );
        const [user] = await tx.query(
          "SELECT id,email,platform_role FROM users WHERE id=$1 FOR UPDATE",
          [a.userId],
        );
        if (
          !user ||
          user.email.toLowerCase() !==
            String(invite.payload.email).toLowerCase()
        )
          throw fail(
            403,
            "INVITE_EMAIL_MISMATCH",
            "This invitation was sent to a different email address. Sign out and use the invited address.",
          );
        if (req.hostContext?.custom && user.platform_role !== "none")
          throw fail(
            403,
            "PLATFORM_HOST_REQUIRED",
            "Platform accounts sign in at the platform address.",
          );
        const joined = await completeInvitationAcceptance(tx, {
          invite,
          userId: user.id,
          registrationVersion,
        });
        return { tenantId: invite.tenant_id, joined };
      });
      // Move this browser into the coach just joined; the account keeps every
      // other coaching membership and can switch back at any time.
      if (req.cookies.session)
        await db.system((tx) =>
          tx.query("DELETE FROM sessions WHERE token_hash=$1", [
            tokenHash(req.cookies.session!),
          ]),
        );
      await startSession(reply, a.userId, result.tenantId);
      if (result.joined && options.afterJoin)
        await options
          .afterJoin(req, {
            tenantId: result.tenantId,
            userId: a.userId,
            role: "subscriber",
          })
          .catch(() => {
            req.log.warn("Enrollment acquisition conversion could not be recorded");
          });
      return { ok: true, joined: result.joined, tenantId: result.tenantId };
    },
  );
}
