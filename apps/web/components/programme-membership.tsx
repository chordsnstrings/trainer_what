"use client";
import { useCallback, useEffect, useState } from "react";
import { OfferTerms } from "./programme-offers";
import { formatDate, formatMoney } from "../lib/format";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";

/**
 * Membership page parts for programmes (docs/features/programme.md): an
 * upfront programme's access window, and the premium voice add-on the member
 * adds to or removes from the membership.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "The request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
const day = (value: string | null | undefined, locale: "en" | "ar") =>
  formatDate(value, { locale, fallback: "—" });

/** Days before an upfront programme ends when the next one may be bought (the API's RENEWAL_WINDOW_DAYS). */
const RENEWAL_WINDOW_DAYS = 7;

/**
 * What an upfront member may buy now, mirroring the API's admission
 * (upfrontAdmission): any offer once the programme has ended, another upfront
 * programme in its final week (queued after it), nothing otherwise.
 */
export function upfrontPurchase(
  membership: any,
  now = Date.now(),
): "any" | "upfront" | "none" {
  const end = membership?.period_end ? Date.parse(membership.period_end) : 0;
  if (membership?.status === "canceled" || end <= now) return "any";
  if (membership?.data?.nextProgramme) return "none";
  return end - now <= RENEWAL_WINDOW_DAYS * 86400000 ? "upfront" : "none";
}

/** An upfront programme: paid once, access until its end, nothing renews. */
export function UpfrontMembership({
  membership,
  offers = [],
}: {
  membership: any;
  /** The workspace's published offers. */
  offers?: any[];
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = useT("membership"),
    locale = useLocale(),
    toError = useErrorText();
  const purchase = upfrontPurchase(membership);
  const ended = purchase === "any";
  const next = membership.data?.nextProgramme;
  const current = membership.data?.upfront;
  const available = offers.filter(
    (p) =>
      p.status === "published" &&
      (purchase === "any" ||
        (purchase === "upfront" && p.data?.billing === "upfront")),
  );
  const buy = async (productId: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/payments/checkout", "POST", { productId });
      if (r?.url) window.location.assign(r.url);
    } catch (e: any) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  };
  const days = Number(membership.data?.programmeDays);
  return (
    <>
      <div className="membership-price">
        <span>{formatMoney(membership.price_minor, locale)}</span>
        {days > 0 && <span> {t("forDays", { count: days })}</span>}
      </div>
      <span className={"badge" + (ended ? "" : " green")}>
        {ended ? t("programmeEnded") : t("paidInFull")}
      </span>
      <p>
        {membership.data?.modules?.includes("nutrition")
          ? t("workoutNutrition")
          : t("workoutOnly")}
      </p>
      <p className="muted">
        {ended
          ? t("accessEnded", { date: day(membership.period_end, locale) })
          : next
            ? t("nextProgramme", {
                count: Number(next.programmeDays) || 0,
                end: day(current?.endsAt ?? next.startsAt, locale),
                date: day(next.endsAt, locale),
              })
            : t("accessUntil", { date: day(membership.period_end, locale) })}
      </p>
      {available.length > 0 && (
        <div id="offers" className="programme-offer-list">
          <h3>{ended ? t("chooseNext") : t("startNext")}</h3>
          {available.map((p) => (
            <div className="list-row" key={p.id}>
              <div>
                <strong>{p.data.name}</strong>
                <OfferTerms data={p.data} />
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => void buy(p.id)}
              >
                {p.data.billing === "upfront"
                  ? t("buyProgramme")
                  : t("joinPlan")}
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Add premium guided voice to the membership, or remove it at period end. */
export function VoiceAddOnCard() {
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const t = useT("membership"),
    locale = useLocale(),
    toError = useErrorText();
  const load = useCallback(
    () => api("/membership/voice-addon").then(setData, () => setData(null)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (
    !data ||
    (!data.included && !data.available && !data.active && !data.status)
  )
    return null;
  const act = async (fn: () => Promise<any>, done: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fn();
      if (r?.url) {
        window.location.assign(r.url);
        return;
      }
      setMessage(done);
      await load();
    } catch (e: any) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card voice-addon" aria-labelledby="voice-addon-title">
      <p className="eyebrow">{t("voiceEyebrow")}</p>
      <h2 id="voice-addon-title">{t("voiceTitle")}</h2>
      {data.included ? (
        <p>{t("voiceInMembership")}</p>
      ) : data.active ? (
        <>
          <p>
            <span className="badge green">{t("onMembership")}</span>{" "}
            {data.cancelAtPeriodEnd
              ? t("voiceEnds", { date: day(data.periodEnd, locale) })
              : t("voiceRenews", {
                  price: data.priceMinor
                    ? formatMoney(data.priceMinor, locale)
                    : t("itsPrice"),
                })}
          </p>
          <div className="button-row">
            {data.cancelAtPeriodEnd ? (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/membership/voice-addon", "POST", {}),
                    t("voiceContinues"),
                  )
                }
              >
                {t("keepVoice")}
              </button>
            ) : (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/membership/voice-addon/cancel", "POST", {}),
                    t("voiceWillEnd"),
                  )
                }
              >
                {t("removeVoice")}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>
            {t("voiceOffer", {
              price: formatMoney(data.priceMinor ?? 0, locale),
            })}
          </p>
          {data.pending?.status === "confirming" && (
            <p className="muted" role="status">
              {t("voiceConfirming")}
            </p>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={busy || !data.available}
              onClick={() =>
                void act(
                  () => api("/membership/voice-addon", "POST", {}),
                  t("voiceAdded"),
                )
              }
            >
              {data.pending?.url ? t("continueVoice") : t("addVoice")}
            </button>
            {data.pending && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/membership/voice-addon/reconcile", "POST", {}),
                    t("voiceChecked"),
                  )
                }
              >
                {t("checkVoice")}
              </button>
            )}
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
