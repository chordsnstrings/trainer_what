"use client";
import { clearPersonalCaches } from "./pwa";
import { useEffect, useState, type FormEvent } from "react";
import {
  accountRequest,
  formatDate,
  type AccountError,
} from "./account-request";
import { BottomSheet } from "./phone-ui";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatDate as formatDay } from "../lib/format";

type Preview = {
  subscription: {
    status: string;
    renewing: boolean;
    accessUntil: string | null;
    providerBilled: boolean;
  } | null;
  action: "renewal_cancelled" | "already_cancelled" | "none";
  blockers: Array<{ kind: string; count: number; message: string }>;
  openDeletionRequests?: number;
};
function Consequences({
  preview,
  follower,
}: {
  preview: Preview;
  follower: boolean;
}) {
  const you = follower ? "your" : "their";
  const t = useT("prefs"),
    locale = useLocale();
  // A member reads this in their language; the trainer's view is unchanged.
  if (follower)
    return (
      <ul className="acct-points">
        <li>{t("accessEndsFollower")}</li>
        {preview.action === "renewal_cancelled" && (
          <li>
            {t("renewalCancelledFirst", {
              date:
                locale === "en"
                  ? formatDate(preview.subscription?.accessUntil)
                  : formatDay(preview.subscription?.accessUntil, { locale }),
            })}
          </li>
        )}
        {preview.action === "already_cancelled" && (
          <li>{t("alreadyCancelled")}</li>
        )}
        <li>
          {t("recordsStay")}
          {preview.openDeletionRequests ? t("deletionStaysOpen") : t("toErase")}
        </li>
        <li>{t("notAffected")}</li>
      </ul>
    );
  return (
    <ul className="acct-points">
      <li>
        {follower
          ? "Your access to this coaching ends immediately and you are signed out here."
          : `Access to this coaching workspace ends immediately and ${you} sessions here are signed out.`}
      </li>
      {preview.action === "renewal_cancelled" && (
        <li>
          The membership renewal is cancelled first, so no further payments are
          taken. Paid time until {formatDate(preview.subscription?.accessUntil)}{" "}
          ends now and is not refunded automatically.
          {follower
            ? " If you want a refund, request it under Membership before leaving."
            : " Use the refund controls if a refund is due."}
        </li>
      )}
      {preview.action === "already_cancelled" && (
        <li>
          The renewal is already cancelled; no further payments are taken.
        </li>
      )}
      <li>
        Coaching records stay with this {follower ? "coach" : "trainer"} under
        the retention policy.
        {preview.openDeletionRequests
          ? follower
            ? " Your deletion request stays open; the platform privacy team still processes it after you leave."
            : " Their open deletion request stays open and is still processed after the membership ends."
          : follower
            ? " To have them erased instead, submit a deletion request in Privacy and download your data export before leaving; the request is still processed after you leave, but you cannot sign in here to file one afterwards."
            : " Erasure remains a separate privacy request, which is still processed after the membership ends."}
      </li>
      <li>
        {follower ? "Your" : "Their"} account and any other coaches are not
        affected.
      </li>
    </ul>
  );
}
function Blockers({ preview }: { preview: Preview }) {
  const t = useT("prefs");
  if (!preview.blockers.length) return null;
  return (
    <div className="notice error" role="alert">
      <span>
        {t("cannotEnd", {
          reasons: preview.blockers.map((b) => b.message).join(" "),
        })}
      </span>
    </div>
  );
}

/**
 * Where a member lands after leaving with no other coach: the sign-in page
 * shows "You left <coach>" from this note (components/public-pages.tsx).
 */
export function rememberLeftCoach(
  storage: Pick<Storage, "setItem">,
  coach: string,
  renewalCancelled: boolean,
  now = Date.now(),
) {
  try {
    storage.setItem(
      "account:left-coach",
      JSON.stringify({ coach, renewalCancelled, at: now }),
    );
  } catch {}
}

/**
 * A follower ends their own membership with the current coach. The card
 * says what leaving means in one line; "Leave <coach>" opens an in-app
 * bottom sheet with the full consequences, an optional note for the coach
 * and the confirmation, never the browser's own "Please check this box"
 * tooltip.
 */
export function LeaveTrainer() {
  const [preview, setPreview] = useState<
      | (Preview & { workspace: { name: string }; otherWorkspaces: number })
      | null
    >(null),
    [message, setMessage] = useState(""),
    [sheetError, setSheetError] = useState(""),
    [done, setDone] = useState(false),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const t = useT("prefs"),
    toError = useErrorText();
  useEffect(() => {
    accountRequest("/membership/leave")
      .then(setPreview)
      .catch((e) => setMessage(toError(e)));
  }, [toError]);
  if (!preview && !message) return null;
  const name = preview?.workspace.name ?? t("thisCoach");
  const blocked = (preview?.blockers.length ?? 0) > 0;
  async function leave(form: HTMLFormElement) {
    const f = new FormData(form);
    setBusy(true);
    setSheetError("");
    try {
      const r = await accountRequest("/membership/leave", "POST", {
        confirm: true,
        ...(String(f.get("reason") ?? "").trim()
          ? { reason: String(f.get("reason")).trim() }
          : {}),
      });
      const renewalCancelled = r.subscriptionAction === "renewal_cancelled";
      setOpen(false);
      setDone(true);
      // This coach's pages must not stay on a shared phone.
      void clearPersonalCaches();
      if (r.nextWorkspace) {
        setMessage(
          t(renewalCancelled ? "leftRenewal" : "leftOpening", { name }),
        );
        window.setTimeout(() => window.location.assign("/app"), 1500);
      } else {
        // Signed out: the sign-in page confirms it (?left=1).
        rememberLeftCoach(window.sessionStorage, name, renewalCancelled);
        setMessage(t("left", { name }));
        window.location.assign("/login?left=1");
      }
    } catch (error) {
      setSheetError(toError(error as AccountError));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card acct-danger" aria-labelledby="acct-leave">
      <h2 id="acct-leave">{t("leave", { name })}</h2>
      {message && (
        <p className={`notice ${done ? "success" : "error"}`} role="status">
          {message}
        </p>
      )}
      {preview && !done && (
        <>
          {/* One line here; the full consequences are in the sheet. */}
          <p className="muted">{t("leaveSummary", { name })}</p>
          <Blockers preview={preview} />
          <button
            type="button"
            className="button secondary acct-leave-open"
            disabled={blocked}
            aria-haspopup="dialog"
            onClick={() => {
              setSheetError("");
              setOpen(true);
            }}
          >
            {t("leave", { name })}
          </button>
          {blocked && <p className="control-reason">{t("settleFirst")}</p>}
          <BottomSheet
            open={open}
            onClose={() => !busy && setOpen(false)}
            title={t("leaveQuestion", { name })}
            description={
              <p>
                {t("sheetText")}
                {preview.action === "renewal_cancelled"
                  ? t("sheetRenewal")
                  : ""}
                {t("sheetAccount")}
              </p>
            }
            footer={
              <>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  {t("stay", { name })}
                </button>
                <button
                  type="submit"
                  form="leave-coach-form"
                  className="button acct-leave-confirm"
                  disabled={busy}
                >
                  {busy ? t("leaving") : t("leave", { name })}
                </button>
              </>
            }
          >
            <Consequences preview={preview} follower />
            <form
              id="leave-coach-form"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                void leave(e.currentTarget);
              }}
            >
              {sheetError && (
                <p className="notice error" role="alert">
                  {sheetError}
                </p>
              )}
              <label className="field">
                <span>{t("noteFor", { name })}</span>
                <textarea
                  name="reason"
                  maxLength={500}
                  rows={3}
                  enterKeyHint="done"
                  aria-describedby="leave-note-hint"
                />
              </label>
              <small className="muted" id="leave-note-hint">
                {t("noteHint", { name })}
              </small>
            </form>
          </BottomSheet>
        </>
      )}
    </section>
  );
}

/** The trainer owner ends a follower's membership, with a reason. */
export function FollowerRemoval({
  userId,
  name,
}: {
  userId: string;
  name?: string;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || preview) return;
    accountRequest(`/trainer/followers/${userId}/exit`)
      .then(setPreview)
      .catch((e) => setMessage((e as Error).message));
  }, [open, preview, userId]);
  return (
    <section className="card acct-danger" aria-labelledby="acct-remove">
      <div className="acct-row">
        <h2 id="acct-remove">End {name ?? "this follower"}’s membership</h2>
        {!done && (
          <button
            type="button"
            className="button secondary"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Close" : "Review"}
          </button>
        )}
      </div>
      {message && (
        <p className={`notice ${done ? "success" : "error"}`} role="status">
          {message}
        </p>
      )}
      {open && preview && !done && (
        <>
          <Consequences preview={preview} follower={false} />
          <Blockers preview={preview} />
          <form
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setMessage("");
              try {
                await accountRequest(
                  `/trainer/followers/${userId}/remove`,
                  "POST",
                  {
                    reason: String(f.get("reason") ?? "").trim(),
                  },
                );
                setDone(true);
                setMessage(
                  "The membership ended. The follower was notified in the app and by email when email is configured.",
                );
              } catch (error) {
                const err = error as AccountError;
                setMessage(
                  err.code === "MFA_STEP_UP"
                    ? "Verify your authenticator in Settings, then return here within ten minutes."
                    : err.message,
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Reason</span>
              <textarea
                name="reason"
                minLength={5}
                maxLength={1000}
                rows={3}
                required
              />
              <small className="muted">
                Shared with the follower and kept in the workspace audit log.
                Leave out health details.
              </small>
            </label>
            <label className="check-field">
              <input type="checkbox" required />I understand their access to
              this workspace ends now.
            </label>
            <button
              className="button"
              disabled={busy || preview.blockers.length > 0}
            >
              End membership
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/** Recent follower exits for the trainer team. */
export function FormerFollowers() {
  const [exits, setExits] = useState<any[]>([]);
  useEffect(() => {
    accountRequest("/trainer/follower-exits")
      .then((r) => setExits(r.exits))
      .catch(() => setExits([]));
  }, []);
  if (!exits.length) return null;
  return (
    <section className="card" aria-labelledby="acct-former">
      <h2 id="acct-former">Former followers</h2>
      <ul className="acct-list">
        {exits.map((e) => (
          <li key={e.id}>
            <div className="acct-row">
              <strong className="acct-break">{e.name}</strong>
              <span className="badge">
                {e.kind === "left" ? "Left" : "Removed"}
              </span>
            </div>
            <small className="muted">
              {formatDate(e.createdAt)}
              {e.subscriptionAction === "renewal_cancelled"
                ? " · renewal cancelled"
                : ""}
            </small>
            {e.reason && <p className="acct-break">{e.reason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
