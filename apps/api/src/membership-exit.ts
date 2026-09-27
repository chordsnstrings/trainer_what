import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { ProviderUnavailable, stripeClient } from "@trainer/providers";
import { tokenHash } from "./auth.ts";
import { changeRenewal, subscriptionHasAccess } from "./finance-billing.ts";
import { notifyCoachingTeam } from "./notifications.ts";
import { disableUserIntegrations } from "./integrations-completion.ts";
import { requireRecentMfa } from "./security.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import { openSignInSession } from "./sign-in.ts";
import {
  accountHost,
  queueAccountEmail,
  setAccountCookie,
} from "./account-completion.ts";
import {
  addAccountNotice,
  emailDeliveryConfigured,
  latestMembership,
} from "./account-self-service.ts";

/**
 * A follower leaves a trainer, or the trainer owner removes a follower. Only
 * the membership in that workspace ends: the global account and any other
 * trainer memberships stay. Records remain in the workspace under the
 * existing retention and privacy rules (erasure stays a separate request),
 * and a membership_exits row keeps the relationship evidence that retained
 * billing records and late provider events refer to.
 */
type ExitIdentity = Actor & { mfaAt?: string | null; name?: string };
type StripeProvider = () => ReturnType<typeof stripeClient>;
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const renewable = ["active", "trialing", "past_due", "incomplete"];
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v), "Use plain text")
    .optional();

async function asTenant(tx: Tx, a: Actor) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
    [a.tenantId, a.userId, a.role],
  );
}
export type ExitBlocker = { kind: string; count: number; message: string };
/** What ending this membership would do, read as the workspace owner. */
export async function exitPreview(
  db: Database,
  tenantId: string,
  followerId: string,
) {
  return db.tenant({ tenantId, userId: followerId, role: "owner" }, async (tx) => {
    const [s] = await tx.query(
      "SELECT provider_id,status,cancel_at_period_end,period_end,data FROM subscriptions WHERE user_id=$1",
      [followerId],
    );
    const blockers: ExitBlocker[] = [];
    const check = async (
      kind: string,
      message: string,
      sql: string,
    ) => {
      const [row] = await tx.query(sql, [followerId]);
      if (Number(row.n) > 0)
        blockers.push({ kind, count: Number(row.n), message });
    };
    await check(
      "renewal",
      "A membership renewal change is still being confirmed with the payment provider.",
      "SELECT count(*)::int n FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 AND status IN ('submitting','unknown')",
    );
    await check(
      "checkout",
      "A checkout is still open. Finish it or wait for it to expire.",
      "SELECT count(*)::int n FROM records WHERE kind IN ('checkout','booking_payment') AND owner_user_id=$1 AND status IN ('creating','open','unknown')",
    );
    await check(
      "payment",
      "A payment or refund instruction is still being confirmed.",
      "SELECT count(*)::int n FROM records WHERE (owner_user_id=$1 OR data->>'userId'=$1::text) AND ((kind IN ('refund','booking_refund') AND status IN ('submitting','unknown','refund_submitting','refund_unknown','refunding')) OR (kind IN ('financial_intent','finance_intent','billing_intent','subscription_intent') AND status IN ('creating','submitting','unknown')))",
    );
    await check(
      "booking",
      "Upcoming bookings must be cancelled first.",
      "SELECT count(*)::int n FROM bookings b JOIN booking_slots s ON s.tenant_id=b.tenant_id AND s.id=b.slot_id WHERE b.user_id=$1 AND b.status IN ('confirmed','payment_pending') AND s.ends_at>now()",
    );
    const renewing =
      !!s?.provider_id &&
      renewable.includes(s.status) &&
      !s.cancel_at_period_end;
    const access = subscriptionHasAccess(s);
    return {
      subscription: s
        ? {
            status: s.status as string,
            renewing,
            accessUntil: access ? s.period_end : null,
            providerBilled: !!s.provider_id,
          }
        : null,
      action: (renewing
        ? "renewal_cancelled"
        : access && s.cancel_at_period_end
          ? "already_cancelled"
          : "none") as "renewal_cancelled" | "already_cancelled" | "none",
      blockers,
    };
  });
}

export async function endFollowerMembership(
  db: Database,
  input: {
    tenantId: string;
    followerId: string;
    actorId: string;
    kind: "left" | "removed";
    reason?: string;
    stripe?: StripeProvider;
    /** The follower's own session hash, when the follower is leaving. */
    followerSession?: string;
  },
) {
  const preview = await exitPreview(db, input.tenantId, input.followerId);
  if (preview.blockers.length)
    throw Object.assign(
      fail(
        409,
        "EXIT_BLOCKED",
        preview.blockers.map((b) => b.message).join(" "),
      ),
      { blockers: preview.blockers },
    );
  if (preview.action === "renewal_cancelled") {
    // The existing cancellation flow: renewal stops at the end of the paid
    // period with a stable intent, and an uncertain outcome is held for
    // reconciliation instead of being retried.
    let stripe: ReturnType<typeof stripeClient>;
    try {
      stripe = input.stripe?.() ?? stripeClient();
    } catch (error) {
      if (error instanceof ProviderUnavailable)
        throw new ProviderUnavailable(
          "stripe",
          "Payments are unavailable, so the membership renewal cannot be cancelled yet. Nothing was changed.",
        );
      throw error;
    }
    await changeRenewal(
      db,
      {
        tenantId: input.tenantId,
        userId: input.followerId,
        role: "subscriber",
      },
      true,
      stripe,
    );
  }
  return db.system(async (tx) => {
    await workspaceLock(tx, input.tenantId);
    if (input.kind === "removed") {
      const [owner] = await tx.query(
        "SELECT m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND t.lifecycle_state='active' FOR UPDATE OF m",
        [input.tenantId, input.actorId],
      );
      if (owner?.role !== "owner")
        throw fail(403, "OWNER_REQUIRED", "Ownership changed. Sign in again.");
    }
    const [follower] = await tx.query(
      "SELECT id,name,email FROM users WHERE id=$1 FOR UPDATE",
      [input.followerId],
    );
    const [membership] = await tx.query(
      "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
      [input.tenantId, input.followerId],
    );
    if (!follower || membership?.role !== "subscriber")
      throw fail(
        404,
        "FOLLOWER_NOT_FOUND",
        "This person is not a follower in this workspace.",
      );
    const [tenant] = await tx.query("SELECT name FROM tenants WHERE id=$1", [
      input.tenantId,
    ]);
    const actor = {
      tenantId: input.tenantId,
      userId: input.actorId,
      role: "owner",
    };
    await asTenant(tx, actor);
    const [s] = await tx.query(
      "SELECT provider_id,status,cancel_at_period_end,period_end,data FROM subscriptions WHERE user_id=$1",
      [input.followerId],
    );
    // A renewal switched back on between the preview and this lock would
    // restart billing for someone without access; stop instead.
    if (s?.provider_id && renewable.includes(s.status) && !s.cancel_at_period_end)
      throw fail(
        409,
        "RENEWAL_ACTIVE",
        "The membership renewal is active again. Review it and try again.",
      );
    const accessUntil = subscriptionHasAccess(s) ? s.period_end : null,
      exitId = randomUUID(),
      reason = input.reason?.trim() || null;
    await tx.query(
      "INSERT INTO membership_exits(id,tenant_id,user_id,kind,actor_id,reason,subscription_action,access_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        exitId,
        input.tenantId,
        input.followerId,
        input.kind,
        input.actorId,
        reason,
        preview.action,
        accessUntil,
      ],
    );
    await disableUserIntegrations(tx, input.followerId, "wearable");
    await event(
      tx,
      actor,
      input.kind === "left" ? "membership.left" : "membership.removed",
      input.followerId,
      { exitId, subscription: preview.action, reasonGiven: !!reason },
    );
    if (input.kind === "left")
      await notifyCoachingTeam(tx, actor, {
        category: "coaching",
        dedupeKey: "membership-exit:" + exitId,
        title: "A subscriber left",
        body: `${follower.name} ended their membership.${reason ? ` Their note: “${reason}”` : ""}`,
        href: "/trainer/subscribers",
        email: false,
        push: false,
      });
    await tx.query("RESET ROLE");
    await tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      input.tenantId,
      input.followerId,
    ]);
    await tx.query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2", [
      input.tenantId,
      input.followerId,
    ]);
    // Workspace links and an unused invitation to this address stop working.
    await tx.query(
      "UPDATE one_time_tokens SET consumed_at=now() WHERE tenant_id=$1 AND consumed_at IS NULL AND (user_id=$2 OR (purpose='invite' AND lower(payload->>'email')=lower($3)))",
      [input.tenantId, input.followerId, follower.email],
    );
    // Passkeys created on this trainer's own web address only sign in there.
    await tx.query(
      "UPDATE auth_passkeys SET revoked_at=now() WHERE user_id=$1 AND host_tenant_id=$2 AND revoked_at IS NULL",
      [input.followerId, input.tenantId],
    );
    await tx.query(
      "DELETE FROM oidc_sign_in_requests WHERE user_id=$1 AND tenant_id=$2",
      [input.followerId, input.tenantId],
    );
    const until = accessUntil
      ? ` Renewal is cancelled; no further payments will be taken.`
      : "";
    await addAccountNotice(
      tx,
      input.followerId,
      input.kind === "left" ? "membership_left" : "membership_removed",
      input.kind === "left"
        ? `You left ${tenant.name}`
        : `${tenant.name} ended your membership`,
      input.kind === "left"
        ? `Your membership with ${tenant.name} has ended.${until} Your account and any other coaches stay as they are.`
        : `${tenant.name} ended your coaching membership.${reason ? ` Reason given: “${reason}”.` : ""}${until} Your account and any other coaches stay as they are.`,
    );
    if (input.kind === "removed" && emailDeliveryConfigured())
      await queueAccountEmail(
        tx,
        { tenantId: input.tenantId, userId: input.followerId, role: "owner" },
        follower.email,
        "Your coaching membership ended",
        `${tenant.name} ended your coaching membership.${reason ? ` Reason given: ${reason}.` : ""}${until} Your account and any other coaches are unaffected.`,
        "membership-removed:" + exitId,
      );
    let next: { tenantId: string; token: string } | null = null;
    if (input.kind === "left" && input.followerSession) {
      const other = await latestMembership(tx, input.followerId);
      if (other)
        next = {
          tenantId: other.tenant_id,
          token: await openSignInSession(tx, {
            userId: input.followerId,
            tenantId: other.tenant_id,
            mfa: false,
            method: "membership_exit",
          }),
        };
    }
    return {
      exitId,
      subscriptionAction: preview.action,
      accessUntil,
      next,
    };
  });
}

export function registerMembershipExit(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => ExitIdentity,
  providers: { stripe?: StripeProvider } = {},
) {
  const rate = { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } };
  const follower = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "subscriber")
      throw fail(
        403,
        "FOLLOWERS_ONLY",
        "Only a follower can leave a trainer. Team roles change through team controls.",
      );
    return a;
  };
  const owner = (req: FastifyRequest, fresh = false) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(
        403,
        "OWNER_REQUIRED",
        "Only the trainer owner can end a follower's membership.",
      );
    if (fresh) requireRecentMfa(a, true);
    return a;
  };
  const workspaceName = async (tenantId: string) =>
    (
      await db.system((tx) =>
        tx.query("SELECT name FROM tenants WHERE id=$1", [tenantId]),
      )
    )[0]?.name as string;

  app.get("/api/v1/membership/leave", async (req) => {
    const a = follower(req);
    const [preview, name, others] = await Promise.all([
      exitPreview(db, a.tenantId, a.userId),
      workspaceName(a.tenantId),
      db.system((tx) =>
        tx.query(
          "SELECT count(*)::int n FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id<>$2 AND t.lifecycle_state='active'",
          [a.userId, a.tenantId],
        ),
      ),
    ]);
    return {
      ...preview,
      workspace: { name },
      otherWorkspaces: Number(others[0]?.n ?? 0),
    };
  });
  app.post("/api/v1/membership/leave", rate, async (req, reply) => {
    const a = follower(req);
    const b = z
      .object({ confirm: z.literal(true), reason: optionalText(500) })
      .strict()
      .parse(req.body);
    const result = await endFollowerMembership(db, {
      tenantId: a.tenantId,
      followerId: a.userId,
      actorId: a.userId,
      kind: "left",
      reason: b.reason,
      stripe: providers.stripe,
      // A trainer's own web address serves only that trainer, so the
      // follow-on workspace session is opened on the platform address only.
      followerSession: accountHost(req).custom
        ? undefined
        : tokenHash(req.cookies.session ?? ""),
    });
    if (result.next) setAccountCookie(reply, result.next.token);
    else reply.clearCookie("session", { path: "/" });
    return {
      ok: true,
      subscriptionAction: result.subscriptionAction,
      accessUntil: result.accessUntil,
      nextWorkspace: result.next ? { tenantId: result.next.tenantId } : null,
    };
  });
  const followerParam = (req: FastifyRequest) =>
    z
      .string()
      .uuid()
      .parse((req.params as any).userId);
  app.get("/api/v1/trainer/followers/:userId/exit", async (req) => {
    const a = owner(req),
      userId = followerParam(req);
    const [m] = await db.system((tx) =>
      tx.query(
        "SELECT m.role,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2",
        [a.tenantId, userId],
      ),
    );
    if (m?.role !== "subscriber")
      throw fail(
        404,
        "FOLLOWER_NOT_FOUND",
        "This person is not a follower in this workspace.",
      );
    return {
      ...(await exitPreview(db, a.tenantId, userId)),
      follower: { name: m.name },
    };
  });
  app.post("/api/v1/trainer/followers/:userId/remove", rate, async (req) => {
    const a = owner(req, true),
      userId = followerParam(req);
    const b = z
      .object({
        reason: z
          .string()
          .trim()
          .min(5)
          .max(1000)
          .refine(
            (v) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v),
            "Use plain text",
          ),
      })
      .strict()
      .parse(req.body);
    if (userId === a.userId)
      throw fail(
        400,
        "OWNER_PROTECTED",
        "Ownership changes use the verified transfer workflow.",
      );
    const result = await endFollowerMembership(db, {
      tenantId: a.tenantId,
      followerId: userId,
      actorId: a.userId,
      kind: "removed",
      reason: b.reason,
      stripe: providers.stripe,
    });
    return {
      ok: true,
      subscriptionAction: result.subscriptionAction,
      accessUntil: result.accessUntil,
    };
  });
  app.get("/api/v1/trainer/follower-exits", async (req) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "ROLE_REQUIRED", "Trainer access required");
    const exits = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT id,user_id,kind,reason,subscription_action,access_until,created_at FROM membership_exits ORDER BY created_at DESC LIMIT 100",
      ),
    );
    const ids = [...new Set(exits.map((e) => e.user_id))];
    // Former followers are outside the tenant directory; their retained names
    // are read for this workspace's own exit rows only.
    const names = ids.length
      ? await db.system((tx) =>
          tx.query("SELECT id,name FROM users WHERE id=ANY($1::uuid[])", [ids]),
        )
      : [];
    return {
      exits: exits.map((e) => ({
        id: e.id,
        userId: e.user_id,
        name: names.find((n) => n.id === e.user_id)?.name ?? "Former follower",
        kind: e.kind,
        reason: e.reason,
        subscriptionAction: e.subscription_action,
        accessUntil: e.access_until,
        createdAt: e.created_at,
      })),
    };
  });
}
