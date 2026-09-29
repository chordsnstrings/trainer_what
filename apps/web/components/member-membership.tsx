"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@trainer/domain";
import { BottomSheet } from "./phone-ui";
import { MemberAccessCard } from "./complimentary-access";
import { UpfrontMembership, VoiceAddOnCard } from "./programme-membership";
import { OfferTerms } from "./programme-offers";
import { BillingHistory } from "./finance-completion";
import { formatDate, labelFor } from "../lib/format";

/**
 * Membership for the member (/app/membership), phone first
 * (docs/features/member-screens.md): the current plan in plain words, or
 * the coach's plans to choose from (and what to do when there are none),
 * stopping renewal from a confirmation sheet with plain errors, the
 * checkout status only while a checkout is unfinished, and receipts.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(d.message ?? "Something went wrong"), {
      status: r.status,
      code: d.code,
    });
  return d;
}

export const MEMBERSHIP_STATUS: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment due",
  unpaid: "Payment due",
  incomplete: "Payment not finished",
  canceled: "Ended",
  incomplete_expired: "Ended",
  paused: "Paused",
};

/**
 * A payment or renewal error in plain words with the next step. Provider
 * outages and missing payment set-up never show their technical message.
 */
export function membershipError(e: any, doing: string) {
  if (e?.status === 503 || e?.code === "PROVIDER_UNAVAILABLE")
    return `Payments are not available in the app right now, so we could not ${doing}. Message your coach or contact support and we will do it for you.`;
  if (e?.status === 429)
    return "Too many tries in a short time. Wait a minute, then try again.";
  if (e?.status === 409)
    return `Your membership changed while you were looking. The page now shows the latest; try again if you still want to ${doing}.`;
  if (!e?.status)
    return `We could not ${doing}. Check your connection and try again.`;
  return e?.message && !/^[A-Z_]+$/.test(e.message)
    ? e.message
    : `We could not ${doing}. Try again, or message your coach.`;
}

export function MemberMembership({
  state,
  offers,
  onChanged,
}: {
  state: any;
  offers: any[];
  onChanged: () => Promise<void> | void;
}) {
  const subscription = state.subscriptions?.[0];
  const membership =
    subscription &&
    !["canceled", "incomplete_expired"].includes(subscription.status)
      ? subscription
      : null;
  const published = offers.filter((p) => p.status === "published");
  const [code, setCode] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [stopOpen, setStopOpen] = useState(false),
    [pending, setPending] = useState(false),
    [checkout, setCheckout] = useState<{ status: string; url?: string } | null>(
      null,
    );
  useEffect(() => {
    let live = true;
    api("/payments/checkout/pending").then(
      (r) => live && setPending(!!r.pending),
      () => live && setPending(false),
    );
    return () => {
      live = false;
    };
  }, [membership?.id, membership?.status]);
  const run = async (
    key: string,
    fn: () => Promise<any>,
    doing: string,
    success?: string,
  ) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const r = await fn();
      if (success) setNotice(success);
      await onChanged();
      return r;
    } catch (e) {
      setError(membershipError(e, doing));
      return null;
    } finally {
      setBusy("");
    }
  };
  const renewsOn = membership?.period_end
    ? formatDate(membership.period_end)
    : null;
  const current = offers.find((p) => p.id === membership?.data?.productId);
  return (
    <div className="member-membership">
      <header className="page-heading">
        <h1>Membership</h1>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      <MemberAccessCard />
      {membership?.data?.billing === "upfront" ? (
        <section className="card" aria-labelledby="plan-title">
          <h2 id="plan-title">Your programme</h2>
          <UpfrontMembership membership={membership} offers={offers} />
        </section>
      ) : membership ? (
        <section className="card member-plan-card" aria-labelledby="plan-title">
          <p className="small-label">Your plan</p>
          <h2 id="plan-title">
            {current?.data?.name ?? "Coaching membership"}
          </h2>
          <p className="membership-price">
            <span dir="ltr">{money(membership.price_minor)}</span>
            <span> a month</span>
          </p>
          <p>
            <span
              className={
                "badge" +
                (["active", "trialing"].includes(membership.status)
                  ? " green"
                  : " amber")
              }
            >
              {labelFor(MEMBERSHIP_STATUS, membership.status)}
            </span>{" "}
            {membership.data?.modules?.includes("nutrition")
              ? "Training and nutrition coaching"
              : "Training coaching"}
            {membership.data?.premiumVoice === true
              ? ", with voice-led sessions"
              : ""}
          </p>
          <p className="muted">
            {membership.cancel_at_period_end
              ? renewsOn
                ? `Renewal is off. Your access continues until ${renewsOn}.`
                : "Renewal is off."
              : renewsOn
                ? `Renews on ${renewsOn}. You can stop renewal at any time.`
                : "Renews every month. You can stop renewal at any time."}
          </p>
          {published
            .filter(
              (p) =>
                p.id !== membership.data?.productId &&
                (p.data.baseProductId === membership.data?.productId ||
                  current?.data?.baseProductId === p.id),
            )
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  void run(
                    "change",
                    () =>
                      api("/membership/change-plan", "POST", {
                        productId: p.id,
                      }),
                    "open the plan change",
                  ).then((r) => {
                    if (r?.url) window.location.assign(r.url);
                  })
                }
              >
                Switch to {p.data.name}
              </button>
            ))}
          {membership.cancel_at_period_end ? (
            <button
              type="button"
              className="button secondary"
              disabled={!!busy}
              onClick={() =>
                void run(
                  "renew",
                  () => api("/membership/reactivate", "POST", {}),
                  "turn renewal back on",
                  "Renewal is back on.",
                )
              }
            >
              {busy === "renew"
                ? "Turning renewal on…"
                : "Turn renewal back on"}
            </button>
          ) : (
            <button
              type="button"
              className="button secondary"
              disabled={!!busy}
              onClick={() => setStopOpen(true)}
            >
              Stop renewal…
            </button>
          )}
          <BottomSheet
            open={stopOpen}
            onClose={() => setStopOpen(false)}
            title="Stop renewing your membership?"
            description={
              renewsOn
                ? `You keep full access until ${renewsOn}. No further payments are taken after that.`
                : "No further payments are taken. You keep access until the end of the period you paid for."
            }
            footer={
              <>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setStopOpen(false)}
                >
                  Keep my plan
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    void run(
                      "stop",
                      () => api("/membership/cancel", "POST", {}),
                      "stop your renewal",
                      renewsOn
                        ? `Renewal stopped. Your access continues until ${renewsOn}.`
                        : "Renewal stopped.",
                    ).then(() => setStopOpen(false))
                  }
                >
                  {busy === "stop" ? "Stopping…" : "Stop renewal"}
                </button>
              </>
            }
          >
            <p className="muted">
              You can turn renewal back on here before then. Refunds for earlier
              payments are under Receipts and refunds below.
            </p>
          </BottomSheet>
        </section>
      ) : published.length ? (
        <section className="card" aria-labelledby="offers-title" id="offers">
          <h2 id="offers-title">Choose your coaching membership</h2>
          <p className="muted">
            Your coach&apos;s plans. You pay securely on the next screen.
          </p>
          <ul className="membership-offers">
            {published.map((p) => (
              <li key={p.id}>
                <h3>{p.data.name}</h3>
                {p.data.description && <p>{p.data.description}</p>}
                <OfferTerms data={p.data} />
                <button
                  type="button"
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    void run(
                      "join:" + p.id,
                      () =>
                        api("/payments/checkout", "POST", {
                          productId: p.id,
                          ...(code.trim()
                            ? { promotionCode: code.trim() }
                            : {}),
                        }),
                      "open checkout",
                    ).then((r) => {
                      if (r?.url) window.location.assign(r.url);
                    })
                  }
                >
                  {busy === "join:" + p.id
                    ? "Opening checkout…"
                    : p.data.billing === "upfront"
                      ? "Buy this programme"
                      : "Join this plan"}
                </button>
              </li>
            ))}
          </ul>
          <details className="membership-code">
            <summary>Have a discount code?</summary>
            <label className="field">
              <span>Discount code</span>
              <input
                value={code}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <small>It is applied when you choose a plan above.</small>
          </details>
        </section>
      ) : (
        <section className="card" aria-labelledby="offers-title" id="offers">
          <h2 id="offers-title">Memberships are not open yet</h2>
          <p className="muted">
            {state.tenant?.name ?? "Your coach"} has not opened a paid
            membership in the app yet. Message them to ask how to start, or
            check back soon.
          </p>
          <Link className="button" href="/app/chat">
            Message your coach
          </Link>
        </section>
      )}
      <VoiceAddOnCard />
      {pending && !membership && (
        <section className="card" aria-labelledby="checkout-title">
          <h2 id="checkout-title">Your checkout was not finished</h2>
          <p className="muted">
            You started paying for a plan but did not finish. Check it before
            you try again, so you are not charged twice.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={!!busy}
            onClick={() =>
              void run(
                "checkout",
                async () => {
                  const r = await api(
                    "/payments/checkout/reconcile",
                    "POST",
                    {},
                  );
                  setCheckout(r);
                  return r;
                },
                "check your checkout",
              )
            }
          >
            {busy === "checkout" ? "Checking…" : "Check my checkout"}
          </button>
          {checkout && (
            <p role="status">
              {checkout.status === "open"
                ? "Your checkout is still open. You can finish it now."
                : checkout.status === "complete"
                  ? "Your payment went through. Your membership is shown above."
                  : checkout.status === "expired" ||
                      checkout.status === "resolved"
                    ? "That checkout has ended without a payment. You can choose a plan again."
                    : "Your payment is still being confirmed. Check again in a few minutes before paying again."}
            </p>
          )}
          {checkout?.status === "open" && checkout.url && (
            <a className="button" href={checkout.url}>
              Finish paying
            </a>
          )}
        </section>
      )}
      <BillingHistory active={!!membership} />
    </div>
  );
}
