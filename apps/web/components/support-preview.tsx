"use client";
import { useEffect, useRef, useState } from "react";

type Grant = {
  id: string;
  caseId: string;
  scopes: string[];
  reason: string;
  expiresAt: string;
  revision: number;
  status: string;
};
type Preview = {
  grant: Grant;
  serverTime: string;
  operator: { id: string; name: string };
  workspace: { name: string; slug: string; published: boolean };
  target: { name: string; role: string };
  case: { id: string; category: string };
  projection: {
    account?: { emailVerified: boolean; role: string };
    access?: {
      workspaceMembership: string;
      subscriptionStatus: string;
      accessUntil: string | null;
      renewalCancelled: boolean;
    };
    connections?: { provider: string; status: string; updated_at: string }[];
  };
  limitations: string;
};
async function request(path: string, body?: unknown) {
  const response = await fetch("/api/v1/admin/support-previews" + path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "Support preview unavailable.");
  return data;
}
export function SupportPreviewLaunch({
  tenantId,
  caseId,
  caseRevision,
  open,
}: {
  tenantId: string;
  caseId: string;
  caseRevision: number;
  open: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const intent = useRef({ fingerprint: "", key: "" });
  if (!open)
    return (
      <p className="muted">
        Support previews are available for open cases only.
      </p>
    );
  return (
    <details>
      <summary>Open a read-only support preview</summary>
      <p>
        This opens the case author’s account, access and connection status for
        up to 15 minutes. Verify your authenticator in your own account settings
        first.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const form = new FormData(event.currentTarget);
          const body = {
            tenantId,
            caseId,
            caseRevision,
            reason: String(form.get("reason") ?? ""),
            minutes: Number(form.get("minutes")),
            scopes: form.getAll("scopes").map(String).sort(),
          };
          const fingerprint = JSON.stringify(body);
          if (intent.current.fingerprint !== fingerprint)
            intent.current = { fingerprint, key: crypto.randomUUID() };
          setBusy(true);
          setError("");
          void request("", { ...body, requestKey: intent.current.key })
            .then(({ grant }) =>
              window.location.assign("/admin/support/preview/" + grant.id),
            )
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>Reason for access</span>
          <textarea
            name="reason"
            minLength={10}
            maxLength={500}
            required
            placeholder="Describe the problem you are investigating."
          />
        </label>
        <p className="muted">
          Keep passwords, payment details and medical information out of this
          reason.
        </p>
        <fieldset>
          <legend>Information needed for this case</legend>
          <label>
            <input
              type="checkbox"
              name="scopes"
              value="account"
              defaultChecked
            />{" "}
            Account role and verification
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              name="scopes"
              value="access"
              defaultChecked
            />{" "}
            Membership and subscription access status
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              name="scopes"
              value="connections"
              defaultChecked
            />{" "}
            Connection status only
          </label>
        </fieldset>
        <label className="field">
          <span>Expires after</span>
          <select name="minutes" defaultValue="15">
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
          </select>
        </label>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Opening preview…" : "Start read-only preview"}
        </button>
      </form>
    </details>
  );
}
export function SupportPreview({ grantId }: { grantId: string }) {
  const [data, setData] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [ended, setEnded] = useState(false),
    [busy, setBusy] = useState(false),
    [seconds, setSeconds] = useState(0);
  const grant = useRef<Grant | null>(null),
    halted = useRef(false),
    deadline = useRef(0);
  useEffect(() => {
    let active = true,
      running = false;
    halted.current = false;
    grant.current = null;
    setData(null);
    setError("");
    setEnded(false);
    const load = async () => {
      if (!active || halted.current || running) return;
      running = true;
      try {
        const result: Preview = await request("/" + grantId);
        if (active && !halted.current) {
          grant.current = result.grant;
          deadline.current =
            performance.now() +
            Math.max(
              0,
              Date.parse(result.grant.expiresAt) -
                Date.parse(result.serverTime),
            );
          setSeconds(
            Math.ceil(Math.max(0, deadline.current - performance.now()) / 1000),
          );
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active) {
          setData(null);
          setError((e as Error).message);
        }
      } finally {
        running = false;
      }
    };
    void load();
    const poll = setInterval(() => void load(), 15000);
    const tick = setInterval(() => {
      if (!grant.current || halted.current) return;
      const remaining = Math.ceil(
        Math.max(0, deadline.current - performance.now()) / 1000,
      );
      setSeconds(remaining);
      if (!remaining) {
        halted.current = true;
        setData(null);
        setEnded(true);
        void request("/" + grantId + "/end", {
          revision: grant.current.revision,
        }).catch(() => {});
      }
    }, 1000);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", focus);
    };
  }, [grantId]);
  async function stop() {
    if (!grant.current || busy) return;
    halted.current = true;
    setData(null);
    setBusy(true);
    setError("");
    try {
      await request("/" + grantId + "/end", {
        revision: grant.current.revision,
      });
      setEnded(true);
    } catch (e) {
      setError(
        "The preview is hidden. " +
          (e as Error).message +
          " You can retry stopping it; server access expires automatically.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="notice"
        style={{ position: "sticky", top: 0, zIndex: 3, borderWidth: 2 }}
      >
        <strong>Read-only support preview</strong>
        {data && (
          <p>
            Viewing {data.target.name} in {data.workspace.name}. You remain
            signed in as {data.operator.name}.
          </p>
        )}
        {data && (
          <p aria-live="off">
            Expires in {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, "0")} ·{" "}
            {new Date(data.grant.expiresAt).toLocaleTimeString()}
          </p>
        )}
        {!ended && grant.current && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void stop()}
          >
            {busy ? "Stopping…" : "Stop preview"}
          </button>
        )}
        <a href="/admin/support">Return to support cases</a>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {ended ? (
        <section className="card">
          <h1>Preview ended</h1>
          <p>
            Request a new preview from the open support case if further
            investigation is needed.
          </p>
        </section>
      ) : !data ? (
        <p role="status">
          {error
            ? "Preview information is hidden."
            : "Loading scoped support preview…"}
        </p>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {data.workspace.name} · {data.target.role}
              </p>
              <h1>{data.target.name}</h1>
              <p>
                Case {data.case.id} · {data.case.category}
              </p>
            </div>
          </div>
          <section className="card">
            <h2>Purpose and limits</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{data.grant.reason}</p>
            <p>{data.limitations}</p>
            <p className="muted">
              Access is checked again on every refresh and automatically ends
              when the case, membership or sign-in session is no longer valid.
            </p>
          </section>
          {data.projection.account && (
            <section className="card">
              <h2>Account</h2>
              <p>Role: {data.projection.account.role}</p>
              <p>
                Email:{" "}
                {data.projection.account.emailVerified
                  ? "Verified"
                  : "Verification pending"}
              </p>
            </section>
          )}
          {data.projection.access && (
            <section className="card">
              <h2>Access</h2>
              <p>
                Workspace membership:{" "}
                {data.projection.access.workspaceMembership}
              </p>
              <p>
                Subscription:{" "}
                {data.projection.access.subscriptionStatus.replaceAll("_", " ")}
              </p>
              {data.projection.access.accessUntil && (
                <p>
                  Current period ends:{" "}
                  {new Date(
                    data.projection.access.accessUntil,
                  ).toLocaleString()}
                </p>
              )}
              <p>
                Renewal cancellation:{" "}
                {data.projection.access.renewalCancelled
                  ? "Scheduled"
                  : "Not scheduled"}
              </p>
            </section>
          )}
          {data.projection.connections && (
            <section className="card">
              <h2>Connections</h2>
              {data.projection.connections.length ? (
                data.projection.connections.map((c, i) => (
                  <article className="list-row" key={i}>
                    <div>
                      <strong>{c.provider.replaceAll("_", " ")}</strong>
                      <p>
                        {c.status} · updated{" "}
                        {new Date(c.updated_at).toLocaleString()}
                      </p>
                    </div>
                  </article>
                ))
              ) : (
                <p>No connection status is recorded.</p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
