"use client";
import { useCallback, useEffect, useState } from "react";
import { money } from "@trainer/domain";

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

/** An upfront programme: paid once, access until its end, nothing renews. */
export function UpfrontMembership({ membership }: { membership: any }) {
  const ended =
    membership.status === "canceled" ||
    (membership.period_end && Date.parse(membership.period_end) <= Date.now());
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
        {ended ? "Access ended" : "Access until"} {day(membership.period_end)}.
        An upfront programme does not renew; you can start the next one in its
        final week.
      </p>
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
    () =>
      api("/membership/voice-addon").then(setData, () => setData(null)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || (!data.included && !data.available && !data.active && !data.status))
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
              {data.pending?.url ? "Continue voice checkout" : "Add premium voice"}
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
