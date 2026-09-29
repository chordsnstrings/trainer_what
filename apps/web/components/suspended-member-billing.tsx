"use client";
import { useCallback, useEffect, useState } from "react";
import { aed, governanceApi, when } from "./governance-shared";
import { BottomSheet } from "./phone-ui";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatDateTime, formatMoney } from "../lib/format";

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
  const t = useT("public"),
    locale = useLocale(),
    toError = useErrorText();
  const money = (minor: number | null | undefined) =>
    minor === null || minor === undefined
      ? "—"
      : locale === "en"
        ? aed(minor)
        : formatMoney(minor, locale);
  const at = (value: string | null | undefined) =>
    !value
      ? "—"
      : locale === "en"
        ? when(value)
        : formatDateTime(value, { locale, zone: "Asia/Dubai" });
  const refresh = useCallback(
    () =>
      governanceApi("/membership/billing").then((next) => setData(next)),
    [],
  );
  useEffect(() => {
    if (!initial) refresh().catch((e) => setError(toError(e)));
  }, [initial, refresh, toError]);
  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await governanceApi(path, "POST", body);
      setMessage(done);
      await refresh().catch(() => {});
    } catch (e) {
      setError(toError(e));
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

  return (
    <section
      className="governance-member-billing"
      aria-labelledby="suspended-billing-title"
    >
      <h2 id="suspended-billing-title">{t("membershipPayments")}</h2>
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
      {!data && !error && <p role="status">{t("loadingMembership")}</p>}
      {data && (
        <>
          {membership && !ended ? (
            <>
              <p>
                <strong>
                  {t("perMonth", { price: money(membership.price_minor) })}
                </strong>
                {membership.period_end && (
                  <>
                    {" "}
                    ·{" "}
                    {t(
                      membership.cancel_at_period_end
                        ? "renewalStoppedEnds"
                        : "renews",
                      { date: at(membership.period_end) },
                    )}
                  </>
                )}
              </p>
              <p className="muted">
                {renewing ? t("keepsRenewing") : t("willNotRenew")}
              </p>
            </>
          ) : (
            <p>{coach ? t("noPaidWith", { coach }) : t("noPaid")}</p>
          )}
          {(renewing || data.transitions.length > 0) && (
            <div className="button-row">
              {renewing && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act("/membership/cancel", {}, t("renewalStopped"))
                  }
                >
                  {t("cancelRenewal")}
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
                      t("renewalChecked"),
                    )
                  }
                >
                  {t("checkRenewal")}
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
                  t("refundSent"),
                );
              }}
            >
              <h3>{t("requestRefund")}</h3>
              <label className="field">
                <span>{t("payment")}</span>
                <select required name="chargeId">
                  {eligible.map((c) => (
                    <option key={c.id} value={c.chargeId}>
                      {at(c.chargedAt)} — {money(c.remainingMinor)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("reason")}</span>
                <textarea name="reason" minLength={5} maxLength={2000} required />
              </label>
              <button className="button secondary" disabled={busy}>
                {t("sendRefund")}
              </button>
            </form>
          )}
          {data.requests.length > 0 && (
            <>
              <h3>{t("yourRefunds")}</h3>
              <ul className="governance-history">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    {money(r.data?.amountMinor)} · {refundStatus(r.status, t)}{" "}
                    <span className="muted">{at(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <h3>{t("yourAccount")}</h3>
      <p>
        <a className="button secondary" href="/api/v1/privacy/export" download>
          {t("downloadData")}
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
          {t("requestDeletion")}
        </button>
      </p>
      <BottomSheet
        open={confirmDeletion}
        onClose={() => setConfirmDeletion(false)}
        title={t("deleteTitle")}
        description={<p>{t("deleteText")}</p>}
        footer={
          <>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDeletion(false)}
            >
              {t("keepAccount")}
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
                  t("deletionRecorded"),
                );
              }}
            >
              {t("confirmDeletion")}
            </button>
          </>
        }
      >
        <p className="muted">{t("otherCoachesMeanwhile")}</p>
      </BottomSheet>
    </section>
  );
}

/** Refund request states in plain words. */
function refundStatus(
  status: string,
  t: ReturnType<typeof useT<"public">>,
) {
  const key = (
    {
      requested: "refund_requested",
      submitting: "refund_processing",
      submitted: "refund_processing",
      unknown: "refund_unknown",
      declined: "refund_declined",
      succeeded: "refund_succeeded",
      failed: "refund_failed",
    } as const
  )[status as "requested"];
  return key ? t(key) : status.replaceAll("_", " ");
}
