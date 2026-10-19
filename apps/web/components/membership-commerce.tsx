"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MEMBERSHIP_PRICING_VERSION,
  minimumOfferPrice,
  prepayQuote,
  type ModulePass,
} from "@trainer/contracts";
import { useLocale, useT } from "../lib/i18n/react";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import { OfferTerms } from "./programme-offers";

export function MembershipPurchase({
  offer,
  busy,
  onPurchase,
  onlyPrepaid = false,
}: {
  offer: any;
  busy: boolean;
  onPurchase: (input: any) => void;
  onlyPrepaid?: boolean;
}) {
  const t = useT("commerce"),
    locale = useLocale();
  const [months, setMonths] = useState<0 | 6 | 12>(onlyPrepaid ? 6 : 0),
    [accepted, setAccepted] = useState(false);
  const monthly = offer.data.billing !== "upfront";
  const valid =
    Number.isSafeInteger(offer.data.priceMinor) &&
    offer.data.priceMinor >= minimumOfferPrice(offer.data);
  const quote =
    valid && monthly && months
      ? prepayQuote(offer.data.priceMinor, months)
      : null;
  return (
    <div className="offer-terms membership-purchase">
      {quote ? <div className="selected-purchase-terms" aria-live="polite">
        <strong>{t("total", { price: formatMoney(quote.amountMinor, locale), months: quote.months })}</strong>
        <p>{locale === "ar" ? "دفعة واحدة. لا يتجدد تلقائياً." : "One payment. Does not renew automatically."}</p>
      </div> : <OfferTerms data={offer.data} />}
      {!valid && <p className="notice">{t("floor")}</p>}
      {monthly && (
        <label className="field">
          <span>{t("payment")}</span>
          <select
            aria-label={t("payment")}
            value={months}
            onChange={(e) => {
              setMonths(Number(e.target.value) as 0 | 6 | 12);
              setAccepted(false);
            }}
          >
            {!onlyPrepaid && <option value={0}>{t("monthly")}</option>}
            <option value={6}>{t("six")}</option>
            <option value={12}>{t("twelve")}</option>
          </select>
        </label>
      )}
      {quote && (
        <div className="notice prepaid-terms">
          <p>
            {t("refund", {
              price: formatMoney(quote.monthlyPriceMinor, locale),
            })}
          </p>
          <p>
            {t("example", {
              price: formatMoney(
                quote.amountMinor - quote.monthlyPriceMinor,
                locale,
              ),
            })}
          </p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />{" "}
            {t("accept")}
          </label>
          <p>
            <Link href="/terms" target="_blank">
              {t("terms")}
            </Link>
          </p>
        </div>
      )}
      <button
        type="button"
        className="button"
        disabled={busy || !valid || (!!quote && !accepted)}
        onClick={() =>
          onPurchase({
            productId: offer.id,
            ...(quote
              ? {
                  prepayMonths: quote.months,
                  acceptedPolicyVersion: MEMBERSHIP_PRICING_VERSION,
                }
              : {}),
          })
        }
      >
        {busy ? t("opening") : t("checkout")}
      </button>
    </div>
  );
}

async function api(path: string, body?: unknown) {
  const r = await fetch("/api/v1/membership/passes" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(result.message), { code: result.code });
  return result;
}
export function ModulePassCards() {
  const t = useT("commerce"),
    locale = useLocale();
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const load = () => api("").then(setData);
  useEffect(() => {
    void load().catch(() => setError(t("error")));
  }, [t]);
  async function purchase(module: ModulePass, reconcile = false) {
    setBusy(true);
    setError("");
    try {
      const r = await api(
        reconcile ? `/${module}/reconcile` : "",
        reconcile
          ? {}
          : { module, acceptedPolicyVersion: MEMBERSHIP_PRICING_VERSION },
      );
      if (r.url && !reconcile) window.location.assign(r.url);
      await load();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" aria-labelledby="module-passes-title">
      <h2 id="module-passes-title">{t("passes")}</h2>
      <p>{t("passTerms")}</p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {data && !data.paidTraining && <p className="notice">{t("required")}</p>}
      {data?.paidTraining && (
        <>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />{" "}
            {t("acceptPass")}
          </label>
          {(["nutrition", "voice"] as const).map((module) => {
            const p = data.passes[module];
            return (
              <article className="list-row" key={module}>
                <div>
                  <h3>{t(module)}</h3>
                  <p>
                    {t("passPrice", {
                      price: formatMoney(p.priceMinor, locale),
                    })}
                  </p>
                  {p.included ? (
                    <p>{t("included")}</p>
                  ) : p.active ? (
                    <p>
                      {t("expires", { date: formatDate(p.endsAt, { locale }) })}
                    </p>
                  ) : !p.ready ? (
                    <p>{t("unavailable")}</p>
                  ) : null}
                </div>
                <div className="button-row">
                  {p.available && !p.pending && (
                    <button
                      className="button"
                      disabled={busy || !accepted}
                      onClick={() => void purchase(module)}
                    >
                      {t("buyPass")}
                    </button>
                  )}
                  {p.pending?.url && (
                    <a className="button" href={p.pending.url}>
                      {t("resume")}
                    </a>
                  )}
                  {p.pending && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void purchase(module, true)}
                    >
                      {t("check")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}

export function PrepaidRefundDetails({ charge }: { charge: any }) {
  const t = useT("commerce"),
    locale = useLocale(),
    c = charge.refundCalculation;
  return c ? (
    <p className="notice">
      {!c.eligible
        ? t("refundClosed", { date: formatDateTime(c.deadline, { locale }) })
        : t("refundDetail", {
            amount: formatMoney(c.amountMinor, locale),
            retained: formatMoney(c.retainedMinor, locale),
            date: formatDateTime(c.deadline, { locale }),
          })}
    </p>
  ) : null;
}
