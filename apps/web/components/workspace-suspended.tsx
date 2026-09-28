"use client";
import { useCallback, useEffect, useState } from "react";
import { governanceApi, when } from "./governance-shared";
import { SuspendedMemberBilling } from "./suspended-member-billing";

/**
 * Shown instead of the workspace when the platform suspended it. Account
 * actions stay available: the suspension notice, notifications, switching to
 * another workspace, personal data export and signing out. Followers also keep
 * membership billing (stop renewal, refund request) and deletion requests.
 */
export function WorkspaceSuspended({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [status, setStatus] = useState<any>(null),
    [workspaces, setWorkspaces] = useState<any[]>([]),
    [notices, setNotices] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const next = await governanceApi("/workspace/status");
    if (next.state === "active") {
      window.location.assign(next.role === "subscriber" ? "/app" : "/trainer");
      return;
    }
    setStatus(next);
    const [list, inbox] = await Promise.all([
      governanceApi("/auth/workspaces").catch(() => ({ workspaces: [] })),
      governanceApi("/notifications").catch(() => []),
    ]);
    setWorkspaces(list.workspaces.filter((w: any) => !w.current));
    setNotices(Array.isArray(inbox) ? inbox.slice(0, 10) : []);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  return (
    <main className="loading-screen governance-suspended">
      <section className="card" aria-labelledby="suspended-title">
        <p className="eyebrow">WORKSPACE UNAVAILABLE</p>
        <h1 id="suspended-title">
          {status?.workspace?.name
            ? `${status.workspace.name} is suspended.`
            : "This workspace is suspended."}
        </h1>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <>
            <p role="status">{status.message}</p>
            {status.notice && (
              <p className="notice">
                <span>
                  <strong>Message from the platform team:</strong> {status.notice}
                </span>
              </p>
            )}
            {status.suspendedAt && (
              <p className="muted">Suspended {when(status.suspendedAt)}.</p>
            )}
          </>
        )}
        {status?.role === "subscriber" && <SuspendedMemberBilling />}
        {workspaces.length > 0 && (
          <div>
            <h2>Your other workspaces</h2>
            <ul className="governance-history">
              {workspaces.map((w) => (
                <li key={w.tenantId}>
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy || w.state === "suspended"}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await governanceApi("/auth/workspace", "POST", {
                          tenantId: w.tenantId,
                        });
                        window.location.assign(
                          w.role === "subscriber" ? "/app" : "/trainer",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                        setBusy(false);
                      }
                    }}
                  >
                    Open {w.name}
                  </button>
                  {w.state === "suspended" && <span className="muted"> (also suspended)</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {notices.length > 0 && (
          <div>
            <h2>Recent notifications</h2>
            <ul className="governance-history">
              {notices.map((n) => (
                <li key={n.id}>
                  <strong>{n.title}</strong> <span className="muted">{when(n.created_at)}</span>
                  <p className="governance-notice-body">{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="button-row">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Check again
          </button>
          <a className="button secondary" href="/api/v1/privacy/export" download>
            Download my data
          </a>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSignOut().catch(() => {});
              setBusy(false);
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
