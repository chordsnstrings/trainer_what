"use client";
import { useCallback, useEffect, useState } from "react";
import { aed, governanceApi, when } from "./governance-shared";

type Billing = {
  membership: {
    status: string;
    cancel_at_period_end: boolean;
    period_end: string | null;
    price_minor: number;
    renewable: boolean;
  } | null;
  transitions: any[];
  requests: any[];
  charges: Array<{
    id: string;
    chargeId: string;
    chargedAt: string;
    remainingMinor: number;
    eligible: boolean;
  }>;
};
const ENDED = ["canceled", "unpaid", "incomplete_expired"];

/**
 * Billing continues while a workspace is suspended, so a follower keeps the
 * self-service actions that matter for money and privacy: stop renewal,
 * confirm a pending renewal change, request a refund of an eligible charge and
 * request account deletion. Everything else waits for reinstatement.
 */
export function SuspendedMemberBilling({
  initial = null,
}: {
  initial?: Billing | null;
}) {
  const [data, setData] = useState<Billing | null>(initial),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDeletion, setConfirmDeletion] = useState(false);
  const refresh = useCallback(
    () =>
      governanceApi("/membership/billing").then((next) => setData(next)),
    [],
  );
  useEffect(() => {
    if (!initial) refresh().catch((e) => setError(e.message));
  }, [initial, refresh]);
  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await governanceApi(path, "POST", body);
      setMessage(done);
      await refresh().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const membership = data?.membership ?? null;
  const renewing =
    !!membership &&
    membership.renewable &&
    !membership.cancel_at_period_end &&
    !ENDED.includes(membership.status);
  const eligible = data?.charges.filter((c) => c.eligible) ?? [];
  return (
    <section
      className="governance-member-billing"
      aria-labelledby="suspended-billing-title"
    >
      <h2 id="suspended-billing-title">Membership and billing</h2>
      <p className="muted">
        Your membership is not cancelled automatically while this workspace is
        suspended. You can stop renewal or ask for a refund here.
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading billing…</p>}
      {data && (
        <>
          {membership ? (
            <p>
              <strong>{aed(membership.price_minor)} / month</strong> ·{" "}
              {membership.status}
              {membership.period_end && (
                <>
                  {" "}
                  ·{" "}
                  {membership.cancel_at_period_end
                    ? "renewal stopped; ends"
                    : "renews"}{" "}
                  {when(membership.period_end)}
                </>
              )}
            </p>
          ) : (
            <p>You have no membership in this workspace.</p>
          )}
          <div className="button-row">
            {renewing && (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    "/membership/cancel",
                    {},
                    "Renewal stopped. You will not be charged again for this membership.",
                  )
                }
              >
                Cancel membership renewal
              </button>
            )}
            {data.transitions.length > 0 && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    "/membership/renewal/reconcile",
                    {},
                    "Renewal status checked.",
                  )
                }
              >
                Check renewal status
              </button>
            )}
          </div>
          {eligible.length > 0 && (
            <form
              className="governance-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(
                  "/refund-requests",
                  { chargeId: f.get("chargeId"), reason: f.get("reason") },
                  "Refund request sent for review.",
                );
              }}
            >
              <h3>Request a refund</h3>
              <label className="field">
                <span>Payment</span>
                <select required name="chargeId">
                  {eligible.map((c) => (
                    <option key={c.id} value={c.chargeId}>
                      {when(c.chargedAt)} — {aed(c.remainingMinor)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Reason</span>
                <textarea name="reason" minLength={5} maxLength={2000} required />
              </label>
              <button className="button secondary" disabled={busy}>
                Send refund request
              </button>
            </form>
          )}
          {data.requests.length > 0 && (
            <>
              <h3>Your refund requests</h3>
              <ul className="governance-history">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    {aed(r.data?.amountMinor)} · {r.status}{" "}
                    <span className="muted">{when(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <h3>Your account</h3>
      {confirmDeletion ? (
        <div className="notice">
          <span>
            Ask the platform to delete your account and coaching data? Required
            financial records follow the retention policy.
          </span>
          <div className="button-row">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmDeletion(false);
                void act(
                  "/privacy/delete-request",
                  {},
                  "Deletion request recorded for review.",
                );
              }}
            >
              Confirm deletion request
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDeletion(false)}
            >
              Keep my account
            </button>
          </div>
        </div>
      ) : (
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => setConfirmDeletion(true)}
        >
          Request account deletion
        </button>
      )}
    </section>
  );
}
