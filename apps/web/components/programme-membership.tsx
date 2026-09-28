"use client";
import { useCallback, useEffect, useState } from "react";
import { money } from "@trainer/domain";
import { OfferTerms } from "./programme-offers";

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
const day = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

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
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="membership-price">
        <span dir="ltr">{money(membership.price_minor)}</span>
        <span> for {membership.data?.programmeDays ?? "—"} days</span>
      </div>
      <span className={"badge" + (ended ? "" : " green")}>
        {ended ? "Programme ended" : "Paid in full"}
      </span>
      <p>
        {membership.data?.modules?.includes("nutrition")
          ? "Workout + nutrition"
          : "Workout only"}
      </p>
      <p className="muted">
        {ended
          ? `Access ended ${day(membership.period_end)}.`
          : next
            ? `This programme ends ${day(current?.endsAt ?? next.startsAt)}. Your next ${next.programmeDays}-day programme starts then and runs until ${day(next.endsAt)}.`
            : `Access until ${day(membership.period_end)}. An upfront programme does not renew; you can buy the next one in its final week and it starts when this one ends.`}
      </p>
      {available.length > 0 && (
        <div id="offers" className="programme-offer-list">
          <h3>
            {ended ? "Choose your next plan" : "Start your next programme"}
          </h3>
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
                  ? "Buy this programme"
                  : "Join this plan"}
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
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card voice-addon" aria-labelledby="voice-addon-title">
      <p className="eyebrow">PREMIUM VOICE</p>
      <h2 id="voice-addon-title">Your coach&apos;s voice runs your session</h2>
      {data.included ? (
        <p>Premium guided voice is included in your membership.</p>
      ) : data.active ? (
        <>
          <p>
            <span className="badge green">On your membership</span>{" "}
            {data.cancelAtPeriodEnd
              ? `Voice ends on ${day(data.periodEnd)}.`
              : `Renews with ${data.priceMinor ? money(data.priceMinor) : "its price"} / month.`}
          </p>
          <div className="button-row">
            {data.cancelAtPeriodEnd ? (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/membership/voice-addon", "POST", {}),
                    "Premium voice continues",
                  )
                }
              >
                Keep premium voice
              </button>
            ) : (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/membership/voice-addon/cancel", "POST", {}),
                    "Premium voice will end at the close of this period",
                  )
                }
              >
                Remove premium voice
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>
            A guided voice session in your coach&apos;s style, for{" "}
            <span dir="ltr">{money(data.priceMinor ?? 0)}</span> a month. It
            ends with your membership.
          </p>
          {data.pending?.status === "confirming" && (
            <p className="muted" role="status">
              Your premium voice purchase is being confirmed.
            </p>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={busy || !data.available}
              onClick={() =>
                void act(
                  () => api("/membership/voice-addon", "POST", {}),
                  "Premium voice added",
                )
              }
            >
              {data.pending?.url
                ? "Continue voice checkout"
                : "Add premium voice"}
            </button>
            {data.pending && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/membership/voice-addon/reconcile", "POST", {}),
                    "Voice purchase checked",
                  )
                }
              >
                Check voice purchase
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
