"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BottomSheet } from "./phone-ui";
import { MemberAccessCard } from "./complimentary-access";
import { UpfrontMembership, VoiceAddOnCard } from "./programme-membership";
import { OfferTerms } from "./programme-offers";
import { BillingHistory } from "./finance-completion";
import { formatDate, formatMoney } from "../lib/format";
import { translator, type Locale } from "../lib/i18n/core";
import membershipMessages from "../lib/i18n/messages/membership";
import { useLocale, useT } from "../lib/i18n/react";

/**
 * Membership for the member (/app/membership), phone first
 * (docs/features/member-screens.md): the current plan in plain words, or
 * the coach's plans to choose from (and what to do when there are none),
 * stopping renewal from a confirmation sheet with plain errors, the
 * checkout status only while a checkout is unfinished, and receipts. In
 * the member's language (docs/features/arabic.md); its blocks settle in on
 * the first view (`data-stagger`) and the stop-renewal sheet slides up.
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

const STATUS_KEYS = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "canceled",
  "incomplete_expired",
  "paused",
] as const;
/** A membership status in words ("Free trial"), in the member's language. */
export function membershipStatus(status: string, locale: Locale = "en") {
  const t = translator(membershipMessages, locale);
  return (STATUS_KEYS as readonly string[]).includes(status)
    ? t(`status_${status as (typeof STATUS_KEYS)[number]}`)
    : t("status_incomplete");
}
/** The English words, for callers that read the map. */
export const MEMBERSHIP_STATUS: Record<string, string> = Object.fromEntries(
  STATUS_KEYS.map((key) => [key, membershipStatus(key)]),
);

/** What the member was doing, for "we could not …". */
const DOING = {
  "turn renewal back on": "doRenewOn",
  "stop your renewal": "doStop",
  "open checkout": "doCheckout",
  "check your checkout": "doCheck",
} as const;
type Doing = keyof typeof DOING;

/**
 * A payment or renewal error in plain words with the next step. Provider
 * outages and missing payment set-up never show their technical message;
 * the server's own sentence is shown to English readers only.
 */
export function membershipError(e: any, doing: Doing, locale: Locale = "en") {
  const t = translator(membershipMessages, locale);
  const what = t(DOING[doing]);
  if (e?.status === 503 || e?.code === "PROVIDER_UNAVAILABLE")
    return t("mErrProvider", { doing: what });
  if (e?.status === 429) return t("mErrTooMany");
  if (e?.status === 409) return t("mErrChanged", { doing: what });
  if (!e?.status) return t("mErrOffline", { doing: what });
  return locale === "en" && e?.message && !/^[A-Z_]+$/.test(e.message)
    ? e.message
    : t("mErrOther", { doing: what });
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
  const t = useT("membership"),
    locale = useLocale();
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
    doing: Doing,
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
      setError(membershipError(e, doing, locale));
      return null;
    } finally {
      setBusy("");
    }
  };
  const renewsOn = membership?.period_end
    ? formatDate(membership.period_end, { locale })
    : null;
  const current = offers.find((p) => p.id === membership?.data?.productId);
  return (
    <div className="member-membership" data-stagger>
      <header className="page-heading">
        <h1>{t("mTitle")}</h1>
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
          <h2 id="plan-title">{t("mYourProgramme")}</h2>
          <UpfrontMembership membership={membership} offers={offers} />
        </section>
      ) : membership ? (
        <section className="card member-plan-card" aria-labelledby="plan-title">
          <p className="small-label">{t("mYourPlan")}</p>
          <h2 id="plan-title" dir="auto">
            {current?.data?.name ?? t("mCoachingMembership")}
          </h2>
          <p className="membership-price">
            {t("mPrice", {
              price: formatMoney(membership.price_minor, locale),
            })}
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
              {membershipStatus(membership.status, locale)}
            </span>{" "}
            {membership.data?.modules?.includes("nutrition")
              ? t("mTrainingNutrition")
              : t("mTraining")}
            {membership.data?.premiumVoice === true ? t("mWithVoice") : ""}
          </p>
          <p className="muted">
            {membership.cancel_at_period_end
              ? renewsOn
                ? t("mRenewalOffUntil", { date: renewsOn })
                : t("mRenewalOff")
              : renewsOn
                ? t("mRenewsOn", { date: renewsOn })
                : t("mRenewsMonthly")}
          </p>
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
                  t("mRenewalBack"),
                )
              }
            >
              {busy === "renew" ? t("mTurningOn") : t("mTurnBackOn")}
            </button>
          ) : (
            <button
              type="button"
              className="button secondary"
              disabled={!!busy}
              onClick={() => setStopOpen(true)}
            >
              {t("mStopRenewalEllipsis")}
            </button>
          )}
          <BottomSheet
            open={stopOpen}
            onClose={() => setStopOpen(false)}
            title={t("mStopTitle")}
            description={
              renewsOn
                ? t("mStopKeepUntil", { date: renewsOn })
                : t("mStopNoMore")
            }
            footer={
              <>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setStopOpen(false)}
                >
                  {t("mKeepPlan")}
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
                        ? t("mStoppedUntil", { date: renewsOn })
                        : t("mStopped"),
                    ).then(() => setStopOpen(false))
                  }
                >
                  {busy === "stop" ? t("mStopping") : t("mStopRenewal")}
                </button>
              </>
            }
          >
            <p className="muted">{t("mStopNote")}</p>
          </BottomSheet>
        </section>
      ) : published.length ? (
        <section className="card" aria-labelledby="offers-title" id="offers">
          <h2 id="offers-title">{t("choosePlan")}</h2>
          <p className="muted">{t("mPlansIntro")}</p>
          <ul className="membership-offers">
            {published.map((p) => (
              <li key={p.id}>
                <h3 dir="auto">{p.data.name}</h3>
                {p.data.description && <p dir="auto">{p.data.description}</p>}
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
                    ? t("mOpeningCheckout")
                    : p.data.billing === "upfront"
                      ? t("buyProgramme")
                      : t("joinPlan")}
                </button>
              </li>
            ))}
          </ul>
          <details className="membership-code">
            <summary>{t("mHaveCode")}</summary>
            <label className="field">
              <span>{t("mCode")}</span>
              <input
                value={code}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <small>{t("mCodeNote")}</small>
          </details>
        </section>
      ) : (
        <section className="card" aria-labelledby="offers-title" id="offers">
          <h2 id="offers-title">{t("mNotOpen")}</h2>
          <p className="muted">
            {t("mNotOpenText", { coach: state.tenant?.name ?? t("mYourCoach") })}
          </p>
          <Link className="button" href="/app/chat">
            {t("mMessageCoach")}
          </Link>
        </section>
      )}
      <VoiceAddOnCard />
      {pending && !membership && (
        <section className="card" aria-labelledby="checkout-title">
          <h2 id="checkout-title">{t("mCheckoutTitle")}</h2>
          <p className="muted">{t("mCheckoutText")}</p>
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
            {busy === "checkout" ? t("mChecking") : t("mCheckMine")}
          </button>
          {checkout && (
            <p role="status">
              {checkout.status === "open"
                ? t("mCoOpen")
                : checkout.status === "complete"
                  ? t("mCoComplete")
                  : checkout.status === "expired" ||
                      checkout.status === "resolved"
                    ? t("mCoEnded")
                    : t("mCoPending")}
            </p>
          )}
          {checkout?.status === "open" && checkout.url && (
            <a className="button" href={checkout.url}>
              {t("mFinish")}
            </a>
          )}
        </section>
      )}
      <BillingHistory active={!!membership} />
    </div>
  );
}
