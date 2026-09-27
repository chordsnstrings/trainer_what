"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  accountRequest,
  formatDate,
  type AccountError,
} from "./account-request";

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
  return (
    <ul className="acct-points">
      <li>
        Access to this coaching workspace ends immediately and {you} sessions
        here are signed out.
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
        Coaching records stay with this trainer under the retention policy.
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
  if (!preview.blockers.length) return null;
  return (
    <div className="notice error" role="alert">
      <span>
        This membership cannot end yet:{" "}
        {preview.blockers.map((b) => b.message).join(" ")}
      </span>
    </div>
  );
}

/** A follower ends their own membership with the current trainer. */
export function LeaveTrainer() {
  const [preview, setPreview] = useState<
      | (Preview & { workspace: { name: string }; otherWorkspaces: number })
      | null
    >(null),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    accountRequest("/membership/leave")
      .then(setPreview)
      .catch((e) => setMessage((e as Error).message));
  }, []);
  if (!preview && !message) return null;
  return (
    <section className="card acct-danger" aria-labelledby="acct-leave">
      <h2 id="acct-leave">Leave {preview?.workspace.name ?? "this trainer"}</h2>
      {message && (
        <p className={`notice ${done ? "success" : "error"}`} role="status">
          {message}
        </p>
      )}
      {preview && !done && (
        <>
          <Consequences preview={preview} follower />
          <Blockers preview={preview} />
          <form
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setMessage("");
              try {
                const r = await accountRequest("/membership/leave", "POST", {
                  confirm: true,
                  ...(String(f.get("reason") ?? "").trim()
                    ? { reason: String(f.get("reason")).trim() }
                    : {}),
                });
                setDone(true);
                setMessage(
                  r.nextWorkspace
                    ? "You left this trainer. Opening your other coaching space…"
                    : "You left this trainer. Your account remains; join another coach any time.",
                );
                window.setTimeout(
                  () => window.location.assign(r.nextWorkspace ? "/app" : "/"),
                  1500,
                );
              } catch (error) {
                setMessage((error as AccountError).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Note for your trainer (optional)</span>
              <textarea name="reason" maxLength={500} rows={3} />
              <small className="muted">
                Shared with your trainer. Leave out health details.
              </small>
            </label>
            <label className="check-field">
              <input type="checkbox" required />I understand my access to this
              trainer ends now.
            </label>
            <button
              className="button"
              disabled={busy || preview.blockers.length > 0}
            >
              Leave this trainer
            </button>
          </form>
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
