"use client";
import { useCallback, useEffect, useState } from "react";
import { aed, governanceApi, when } from "./governance-shared";
import { BottomSheet } from "./phone-ui";

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
 * confirm a pending renewal change, request a refund of an eligible charge,
 * download their data and request account deletion. Everything else waits
 * for reinstatement. The wording follows what the member actually has: no
 * renewal or refund talk without a membership, and deletion is a quiet
 * link that asks again in a bottom sheet, never the most prominent action.
 */
export function SuspendedMemberBilling({
  initial = null,
  coach,
}: {
  initial?: Billing | null;
  /** The paused coaching workspace's name. */
  coach?: string;
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
  const ended = !!membership && ENDED.includes(membership.status);
  const renewing =
    !!membership &&
    membership.renewable &&
    !membership.cancel_at_period_end &&
    !ended;
  const eligible = data?.charges.filter((c) => c.eligible) ?? [];
  const withCoach = coach ? ` with ${coach}` : "";
  return (
    <section
      className="governance-member-billing"
      aria-labelledby="suspended-billing-title"
    >
      <h2 id="suspended-billing-title">Membership and payments</h2>
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
      {!data && !error && <p role="status">Loading your membership…</p>}
      {data && (
        <>
          {membership && !ended ? (
            <>
              <p>
                <strong>{aed(membership.price_minor)} a month</strong>
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
              <p className="muted">
                {renewing
                  ? "Your membership is not cancelled automatically while coaching is paused, so it keeps renewing. You can stop the renewal or ask for a refund here."
                  : "Your membership will not renew. You can still ask for a refund of an eligible payment here."}
              </p>
            </>
          ) : (
            <p>
              You have no paid membership{withCoach}, so nothing is charged
              while coaching is paused.
            </p>
          )}
          {(renewing || data.transitions.length > 0) && (
            <div className="button-row">
              {renewing && (
                <button
                  className="button secondary"
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
          )}
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
                    {aed(r.data?.amountMinor)} · {refundStatus(r.status)}{" "}
                    <span className="muted">{when(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <h3>Your account</h3>
      <p>
        <a className="button secondary" href="/api/v1/privacy/export" download>
          Download my data
        </a>
      </p>
      <p>
        <button
          className="text-button suspended-delete"
          type="button"
          disabled={busy}
          aria-haspopup="dialog"
          onClick={() => setConfirmDeletion(true)}
        >
          Request account deletion
        </button>
      </p>
      <BottomSheet
        open={confirmDeletion}
        onClose={() => setConfirmDeletion(false)}
        title="Delete your account?"
        description={
          <p>
            The platform team deletes your account and coaching data after
            reviewing the request. Required financial records are kept as the
            retention policy says. Download your data first if you want a copy.
          </p>
        }
        footer={
          <>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDeletion(false)}
            >
              Keep my account
            </button>
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
          </>
        }
      >
        <p className="muted">You can keep using any other coaches until then.</p>
      </BottomSheet>
    </section>
  );
}

/** Refund request states in plain words. */
function refundStatus(status: string) {
  return (
    (
      {
        requested: "waiting for review",
        submitting: "being processed",
        submitted: "being processed",
        unknown: "being checked",
        declined: "declined",
        succeeded: "refunded",
        failed: "could not be refunded",
      } as Record<string, string>
    )[status] ?? status.replaceAll("_", " ")
  );
}
