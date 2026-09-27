"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { accountRequest, formatDate, type AccountError } from "./account-request";

type Grant = {
  id: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  targetEmail: string;
  targetName: string;
  issuedBy: string;
  status: "active" | "used" | "revoked" | "expired";
};

/**
 * Superadmin and support operators: a one-time password recovery link for a
 * member who cannot use email. Shown once; the member's authenticator still
 * applies. Trainers never see this panel.
 */
export function OperatorRecovery() {
  const [issued, setIssued] = useState<{
      url: string;
      expiresAt: string;
      name: string;
      message: string;
    } | null>(null),
    [grants, setGrants] = useState<Grant[] | null>(null),
    [listMessage, setListMessage] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setGrants((await accountRequest<{ grants: Grant[] }>("/admin/account-recovery")).grants);
      setListMessage("");
    } catch (e) {
      setGrants(null);
      setListMessage((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="card" aria-labelledby="acct-operator-recovery">
      <h2 id="acct-operator-recovery">Account recovery without email</h2>
      <p className="muted">
        For a member who cannot receive email. Verify their identity through
        your support process first. The link is shown once, expires in 30
        minutes, signs out every device when used and still requires the
        member&apos;s own authenticator if they have one.
      </p>
      {message && (
        <p className="notice error" role="alert">
          {message}
        </p>
      )}
      {issued ? (
        <div className="notice success acct-once" role="status">
          <div className="acct-stack">
            <strong>
              Recovery link for {issued.name} — shown once, expires{" "}
              {formatDate(issued.expiresAt)}
            </strong>
            <input
              readOnly
              value={issued.url}
              aria-label="One-time recovery link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <span>{issued.message}</span>
            <div className="acct-row">
              <button
                type="button"
                className="button secondary"
                onClick={() => void navigator.clipboard?.writeText(issued.url)}
              >
                Copy link
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setIssued(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            setBusy(true);
            setMessage("");
            try {
              const r = await accountRequest("/admin/account-recovery", "POST", {
                email: String(f.get("email") ?? "").trim(),
                reason: String(f.get("reason") ?? "").trim(),
                code: String(f.get("code") ?? "").trim(),
              });
              setIssued(r);
              form.reset();
              await load();
            } catch (error) {
              setMessage((error as AccountError).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Member&apos;s account email</span>
            <input name="email" type="email" autoComplete="off" required />
          </label>
          <label className="field">
            <span>Reason and how identity was verified</span>
            <textarea name="reason" minLength={10} maxLength={500} rows={3} required />
            <small className="muted">Recorded in the operator audit log.</small>
          </label>
          <label className="field">
            <span>Your authenticator code</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <button className="button" disabled={busy}>
            Create recovery link
          </button>
        </form>
      )}
      <h3>Recent recovery links</h3>
      {listMessage && <p className="notice">{listMessage}</p>}
      {grants && grants.length === 0 && <p className="muted">None yet.</p>}
      {grants && grants.length > 0 && (
        <ul className="acct-list">
          {grants.map((g) => (
            <li key={g.id}>
              <div className="acct-row">
                <span className="acct-break">
                  <strong>{g.targetName}</strong> · {g.targetEmail}
                </span>
                <span className={`badge ${g.status === "active" ? "amber" : ""}`}>
                  {g.status}
                </span>
              </div>
              <small className="muted">
                {formatDate(g.createdAt)} by {g.issuedBy}
              </small>
              <p className="acct-break">{g.reason}</p>
              {g.status === "active" && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await accountRequest(`/admin/account-recovery/${g.id}/revoke`, "POST", {});
                      await load();
                    } catch (e) {
                      setListMessage((e as Error).message);
                    }
                  }}
                >
                  Revoke link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
