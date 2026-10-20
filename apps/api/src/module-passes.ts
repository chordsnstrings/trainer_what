import type { FastifyInstance } from "fastify";
import {
  type Actor,
  type Database,
  type Tx,
  elevated,
  event,
  putRecord,
} from "@trainer/db";
import { z } from "zod";
import {
  MODULE_PASS_PRICES,
  MEMBERSHIP_PRICING_VERSION,
  addMembershipMonths,
  hasPaidTraining,
  modulePassActive,
  type ModulePass,
} from "@trainer/contracts";
import {
  requireCommerce,
  stripeClient,
  stripeRefused,
} from "@trainer/providers";
import { assignCommissionRank, recordCharge } from "./finance.ts";
import { audioReadiness, requireServiceReady } from "./service-readiness.ts";
import { nutritionReadiness, requireNutritionReady } from "./nutrition.ts";
import { voiceIncluded, voiceAddOnEntitled } from "./voice-addon.ts";
import { reconcileProgrammeCheckout } from "./programme-billing.ts";
import { refusalOf, confirmedCardPaymentTime } from "./stripe-outcomes.ts";

type Stripe = ReturnType<typeof stripeClient>;
const moduleSchema = z.enum(["nutrition", "voice"]);
const uuid = z.string().uuid();
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
const subscriber = (a: Actor) => {
  if (a.role !== "subscriber")
    throw Object.assign(new Error("Subscriber access required"), {
      statusCode: 403,
    });
};
async function lock(tx: Tx, tenantId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
}
const pendingSql =
  "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 AND data->>'purpose'='module_pass' AND data->>'module'=$2 AND status IN ('creating','open','unknown') ORDER BY created_at LIMIT 1";
async function pendingRecurringVoice(tx: Tx, userId: string, s: any) {
  const [r] = await tx.query(
    "SELECT id FROM records WHERE kind='checkout' AND owner_user_id=$1 AND data->>'purpose'='voice_addon' AND (status IN ('creating','open','unknown') OR (status='completed' AND NOT data ? 'subscriptionStatus' AND data->>'subscriptionId' IS DISTINCT FROM $2::text)) LIMIT 1",
    [userId, s?.data?.voiceAddOn?.providerId ?? null],
  );
  return !!r;
}
const included = (s: any, module: ModulePass) =>
  module === "nutrition"
    ? s?.data?.modules?.includes("nutrition")
    : voiceIncluded(s?.data) || voiceAddOnEntitled(s?.data?.voiceAddOn);

export async function modulePassStatus(db: Database, a: Actor) {
  subscriber(a);
  return db.tenant(a, async (tx) => {
    const [s] = await tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [
      a.userId,
    ]);
    const paidTraining = hasPaidTraining(s);
    const nutrition = await nutritionReadiness(tx),
      voice = await audioReadiness(tx);
    const voicePending = await pendingRecurringVoice(tx, a.userId, s);
    const result: Record<string, any> = {};
    for (const module of ["nutrition", "voice"] as const) {
      const [pending] = await tx.query(pendingSql, [a.userId, module]);
      const pass = s?.data?.modulePasses?.[module];
      result[module] = {
        priceMinor: MODULE_PASS_PRICES[module],
        included: paidTraining && !!included(s, module),
        active: paidTraining && modulePassActive(pass),
        endsAt: pass?.endsAt ?? null,
        available:
          paidTraining &&
          (module === "nutrition"
            ? nutrition.ready
            : voice.ready && !voicePending) &&
          !included(s, module) &&
          !modulePassActive(pass),
        ready: module === "nutrition" ? nutrition.ready : voice.ready,
        pending: pending
          ? {
              status: pending.status,
              url:
                pending.status === "open" &&
                Date.parse(pending.data.expiresAt) > Date.now()
                  ? pending.data.checkoutUrl
                  : null,
            }
          : null,
      };
    }
    return {
      paidTraining,
      policyVersion: MEMBERSHIP_PRICING_VERSION,
      passes: result,
    };
  });
}

export async function createModulePassCheckout(
  db: Database,
  a: Actor & { email?: string },
  raw: unknown,
  origin: string,
  stripe: Stripe = requireCommerce(),
) {
  subscriber(a);
  const input = z
    .object({
      module: moduleSchema,
      acceptedPolicyVersion: z.literal(MEMBERSHIP_PRICING_VERSION),
    })
    .strict()
    .parse(raw);
  const context = await db.system(async (system) => {
    await system.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":workspace",
    ]);
    await lock(system, a.tenantId);
    const [tenant] = await system.query(
      "SELECT lifecycle_state FROM tenants WHERE id=$1",
      [a.tenantId],
    );
    if (tenant?.lifecycle_state !== "active")
      throw fail(
        "WORKSPACE_CLOSED",
        "This workspace no longer accepts purchases.",
      );
    const [membership] = await system.query(
      "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    );
    if (membership?.role !== "subscriber")
      throw fail("SUBSCRIBER_REQUIRED", "Current subscriber access required.");
    return system.tenant(a, async (tx) => {
      const [s] = await tx.query(
        "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
        [a.userId],
      );
      const [upgrade] = await tx.query("SELECT id FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 AND data->>'purpose'='upgrade' AND status IN ('submitting','unknown') LIMIT 1", [a.userId]);
      if (upgrade) throw fail("UPGRADE_PENDING", "Check your pending package upgrade before buying an add-on.");
      if (!hasPaidTraining(s))
        throw fail(
          "PAID_TRAINING_REQUIRED",
          "A current paid training membership is required before buying a pass.",
        );
      if (
        included(s, input.module) ||
        modulePassActive(s.data?.modulePasses?.[input.module])
      )
        throw fail(
          "MODULE_ALREADY_INCLUDED",
          "This feature is already included or has an active pass.",
        );
      if (
        input.module === "voice" &&
        (await pendingRecurringVoice(tx, a.userId, s))
      )
        throw fail(
          "PASS_CHECKOUT_PENDING",
          "Check your existing voice subscription purchase before buying a pass.",
        );
      const [old] = await tx.query(pendingSql + " FOR UPDATE", [
        a.userId,
        input.module,
      ]);
      if (old) return { intent: old, existing: true };
      if (input.module === "nutrition") await requireNutritionReady(tx);
      else await requireServiceReady(tx, { premiumVoice: true }, true);
      const intent = await putRecord(
        tx,
        a,
        "checkout",
        {
          purpose: "module_pass",
          billing: "upfront",
          module: input.module,
          amountMinor: MODULE_PASS_PRICES[input.module],
          membershipId: s.id,
          membershipProviderId: s.provider_id ?? null,
          membershipIntentId: s.data?.upfront?.intentId ?? null,
          email: a.email,
          policyVersion: MEMBERSHIP_PRICING_VERSION,
          acceptedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 35 * 60000).toISOString(),
        },
        { ownerId: a.userId, status: "creating" },
      );
      await event(tx, a, "module_pass.reserved", intent.id, {
        module: input.module,
      });
      return { intent, existing: false };
    });
  });
  const r = context.intent;
  if (context.existing) {
    if (
      r.status === "open" &&
      r.data.checkoutUrl &&
      Date.parse(r.data.expiresAt) > Date.now()
    )
      return { url: r.data.checkoutUrl, intentId: r.id };
    throw fail(
      "PASS_CHECKOUT_PENDING",
      "Check the existing pass purchase before starting another checkout.",
    );
  }
  try {
    const metadata = {
      tenant_id: a.tenantId,
      user_id: a.userId,
      intent_id: r.id,
      purpose: "module_pass",
      module: input.module,
    };
    const remote = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: r.data.email,
        client_reference_id: r.id,
        metadata,
        payment_intent_data: { metadata },
        expires_at: Math.floor(Date.parse(r.data.expiresAt) / 1000),
        line_items: [
          {
            price_data: {
              currency: "aed",
              unit_amount: r.data.amountMinor,
              product_data: {
                name:
                  input.module === "nutrition"
                    ? "Nutrition pass · one month / تصريح التغذية لشهر"
                    : "Guided voice pass · one month / تصريح التدريب الصوتي لشهر",
                description:
                  "One calendar month from confirmed payment. No automatic renewal. Requires paid training throughout. / شهر تقويمي من تأكيد الدفع دون تجديد تلقائي. يلزم اشتراك تدريب مدفوع طوال المدة.",
              },
            },
            quantity: 1,
          },
        ],
        success_url: origin + "/app/membership?pass=complete",
        cancel_url: origin + "/app/membership",
      },
      { idempotencyKey: `module-pass:${r.id}` },
    );
    if (
      !remote.id ||
      !remote.url ||
      remote.status !== "open" ||
      remote.client_reference_id !== r.id ||
      remote.metadata?.intent_id !== r.id ||
      remote.metadata?.tenant_id !== a.tenantId ||
      remote.metadata?.user_id !== a.userId ||
      remote.mode !== "payment"
    )
      throw fail(
        "CHECKOUT_IDENTITY_MISMATCH",
        "Pass checkout needs reconciliation.",
      );
    await db.tenant(a, async (tx) => {
      await lock(tx, a.tenantId);
      await tx.query(
        "UPDATE records SET status='open',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status='creating'",
        [
          r.id,
          JSON.stringify({ providerId: remote.id, checkoutUrl: remote.url }),
        ],
      );
    });
    return { url: remote.url, intentId: r.id };
  } catch (error) {
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND status='creating'",
        [
          r.id,
          stripeRefused(error) ? "closed" : "unknown",
          JSON.stringify(
            stripeRefused(error) ? { providerRefusal: refusalOf(error) } : {},
          ),
        ],
      ),
    );
    throw error;
  }
}

/** Only signed Stripe events or authenticated provider reconciliation call this. */
export async function processModulePassCheckout(
  db: Database,
  e: any,
  stripe?: Stripe,
) {
  const remote = e.data?.object;
  if (remote?.mode !== "payment" || remote.metadata?.purpose !== "module_pass")
    return false;
  if (
    ![
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ].includes(e.type)
  )
    return false;
  const tenantId = uuid.parse(remote.metadata.tenant_id),
    memberId = uuid.parse(remote.metadata.user_id),
    intentId = uuid.parse(remote.metadata.intent_id);
  const a = elevated("provider-callback", { tenantId, role: "finance" });
  const [r] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1 AND kind='checkout'", [
      intentId,
    ]),
  );
  if (
    !r ||
    r.owner_user_id !== memberId ||
    r.data.purpose !== "module_pass" ||
    r.data.module !== remote.metadata.module ||
    remote.client_reference_id !== r.id ||
    (r.data.providerId && remote.id !== r.data.providerId)
  )
    throw fail(
      "CHECKOUT_IDENTITY_MISMATCH",
      "Pass payment does not match its reserved purchase.",
    );
  if (e.type.endsWith("expired") || e.type.endsWith("async_payment_failed")) {
    if (e.type.endsWith("expired") && remote.status !== "expired")
      throw fail("CHECKOUT_STATE_MISMATCH", "Pass expiry is not confirmed.");
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET status=$2,updated_at=now() WHERE id=$1 AND status<>'completed'",
        [r.id, e.type.endsWith("expired") ? "expired" : "closed"],
      ),
    );
    return true;
  }
  if (remote.status !== "complete")
    throw fail("CHECKOUT_STATE_MISMATCH", "Pass payment is not complete.");
  if (remote.payment_status === "unpaid") return true;
  if (
    remote.payment_status !== "paid" ||
    remote.currency !== "aed" ||
    remote.amount_total !== r.data.amountMinor
  )
    throw fail("PASS_AMOUNT_MISMATCH", "Pass payment amount is not verified.");
  const paymentIntentId =
    typeof remote.payment_intent === "string"
      ? remote.payment_intent
      : remote.payment_intent?.id;
  if (!paymentIntentId)
    throw fail(
      "PAYMENT_IDENTITY_REQUIRED",
      "Pass payment needs reconciliation.",
    );
  const payment = await (stripe ?? stripeClient()).paymentIntents.retrieve(
    paymentIntentId,
  );
  const chargeId =
    typeof payment.latest_charge === "string"
      ? payment.latest_charge
      : payment.latest_charge?.id;
  if (!chargeId)
    throw fail(
      "PAYMENT_IDENTITY_REQUIRED",
      "Pass charge needs reconciliation.",
    );
  const paidAt = await confirmedCardPaymentTime(
    e,
    stripe ?? stripeClient(),
    chargeId,
    paymentIntentId,
  );
  await db.system(async (tx) => {
    for (const [externalId, kind] of [
      [remote.id, "checkout.session"],
      [paymentIntentId, "module_pass_payment_intent"],
      [chargeId, "charge"],
    ]) {
      const [old] = await tx.query(
        "SELECT tenant_id,user_id FROM provider_objects WHERE provider='stripe' AND external_id=$1",
        [externalId],
      );
      if (old && (old.tenant_id !== tenantId || old.user_id !== memberId))
        throw new Error("Conflicting provider object ownership");
      await tx.query(
        "INSERT INTO provider_objects(provider,external_id,tenant_id,user_id,kind) VALUES('stripe',$1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [externalId, tenantId, memberId, kind],
      );
    }
  });
  await db.tenant(a, async (tx) => {
    await lock(tx, tenantId);
    const [current] = await tx.query(
      "SELECT * FROM records WHERE id=$1 FOR UPDATE",
      [r.id],
    );
    if (current.status === "completed") return;
    const [s] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [memberId],
    );
    const endsAt = addMembershipMonths(paidAt, 1);
    const conflict =
      !hasPaidTraining(s) ||
      s.id !== r.data.membershipId ||
      (s.provider_id ?? null) !== r.data.membershipProviderId ||
      (s.data?.upfront?.intentId ?? null) !== r.data.membershipIntentId ||
      included(s, r.data.module) ||
      modulePassActive(s?.data?.modulePasses?.[r.data.module]);
    const rank = await assignCommissionRank(
      tx,
      memberId,
      s,
      s?.data?.firstPaidAt ?? paidAt.toISOString(),
      "stable-first-paid-v2",
    );
    await recordCharge(
      tx,
      a,
      `stripe-programme:pass:${r.id}`,
      r.data.amountMinor,
      rank,
      {
        description: `${r.data.module === "nutrition" ? "Nutrition" : "Voice"} pass payment`,
        purpose: "module_pass",
        module: r.data.module,
        userId: memberId,
        chargeId,
        paymentIntentId,
        checkoutId: remote.id,
        intentId: r.id,
        chargedAt: paidAt.toISOString(),
        accessStartsAt: paidAt.toISOString(),
        accessEndsAt: endsAt.toISOString(),
      },
    );
    if (!conflict)
      await tx.query(
        "UPDATE subscriptions SET data=jsonb_set(data,'{modulePasses}',$2::jsonb) WHERE id=$1",
        [
          s.id,
          JSON.stringify({
            ...s.data.modulePasses,
            [r.data.module]: {
              intentId: r.id,
              chargeId,
              verified: true,
              startsAt: paidAt.toISOString(),
              endsAt: endsAt.toISOString(),
            },
          }),
        ],
      );
    else
      await putRecord(
        tx,
        a,
        "reconciliation",
        {
          reason: "Pass paid after membership or access changed; review refund",
          chargeId,
          userId: memberId,
          intentId: r.id,
        },
        { ownerId: memberId, status: "open" },
      );
    await tx.query(
      "UPDATE records SET status='completed',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
      [
        r.id,
        JSON.stringify({
          providerId: remote.id,
          chargeId,
          paymentIntentId,
          amountPaidMinor: r.data.amountMinor,
          accessStartsAt: paidAt.toISOString(),
          accessEndsAt: endsAt.toISOString(),
          accessConflict: conflict,
        }),
      ],
    );
    await event(tx, a, "module_pass.paid", r.id, {
      module: r.data.module,
      accessConflict: conflict,
    });
  });
  return true;
}

export async function endRefundedPass(
  tx: Tx,
  memberId: string,
  original: any,
  reason: string,
) {
  const module = moduleSchema.parse(original.data.module);
  await tx.query(
    "UPDATE subscriptions SET data=jsonb_set(data,ARRAY['modulePasses',$2,'endedReason'],to_jsonb($3::text)) WHERE user_id=$1 AND data->'modulePasses'->$2->>'intentId'=$4",
    [memberId, module, reason, original.data.intentId],
  );
}

export function registerModulePasses(
  app: FastifyInstance,
  db: Database,
  commerce: () => Stripe,
) {
  const actor = (req: any) => {
    if (!req.identity)
      throw Object.assign(new Error("Please sign in"), { statusCode: 401 });
    return req.identity;
  };
  app.get("/api/v1/membership/passes", (req) =>
    modulePassStatus(db, actor(req)),
  );
  app.post("/api/v1/membership/passes", (req) =>
    createModulePassCheckout(
      db,
      actor(req),
      req.body,
      req.hostContext?.origin ??
        process.env.PUBLIC_APP_URL ??
        "http://localhost:3000",
      commerce(),
    ),
  );
  app.post("/api/v1/membership/passes/:module/reconcile", async (req) => {
    const a = actor(req);
    subscriber(a);
    const module = moduleSchema.parse((req.params as any).module);
    const [r] = await db.tenant(a, (tx) =>
      tx.query(pendingSql, [a.userId, module]),
    );
    return r
      ? reconcileProgrammeCheckout(db, r, stripeClient())
      : { status: "resolved" };
  });
}
