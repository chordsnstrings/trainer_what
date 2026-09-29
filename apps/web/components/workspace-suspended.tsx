"use client";
import { useCallback, useEffect, useState } from "react";
import { governanceApi, when } from "./governance-shared";
import { SuspendedMemberBilling } from "./suspended-member-billing";

/**
 * The title and first lines of the suspension screen. The workspace name is
 * often the coach's own name, so members read about the coach's coaching
 * workspace being paused, never "<name> is suspended" (as if the person
 * were).
 */
export function suspensionCopy(status: {
  role?: string;
  workspace?: { name?: string };
  message?: string;
}) {
  const name = status.workspace?.name?.trim() ?? "";
  if (status.role === "subscriber")
    return {
      title: name
        ? `Coaching with ${name} is paused`
        : "Your coaching is paused",
      body: `The platform team has paused ${name ? `${name}’s` : "this"} coaching workspace for now. Workouts, plans, chat and bookings there are on hold until it reopens. Your account and any other coaches are not affected.`,
    };
  return {
    title: name
      ? `The ${name} workspace is suspended`
      : "This workspace is suspended",
    body: status.message ?? "",
  };
}

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
  const member = status?.role === "subscriber";
  const copy = status ? suspensionCopy(status) : null;
  const support: string | null = status?.supportEmail ?? null;
  return (
    <main className="suspended-page governance-suspended" id="main">
      <section className="card" aria-labelledby="suspended-title">
        <p className="eyebrow">
          {member ? "COACHING PAUSED" : "WORKSPACE UNAVAILABLE"}
        </p>
        <h1 id="suspended-title">
          {copy?.title ?? "This workspace is unavailable"}
        </h1>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <>
            <p role="status">{copy?.body}</p>
            {status.notice && (
              <p className="notice">
                <span>
                  <strong>Message from the platform team:</strong> {status.notice}
                </span>
              </p>
            )}
            {status.suspendedAt && (
              <p className="muted">Paused on {when(status.suspendedAt)}.</p>
            )}
            <p className="suspended-support">
              {support ? (
                <>
                  Questions? Email platform support at{" "}
                  <a className="text-link ltr-data" href={`mailto:${support}`}>
                    {support}
                  </a>
                  .
                </>
              ) : (
                <>
                  Questions?{" "}
                  <a className="text-link" href="/about#company">
                    How to contact the platform
                  </a>
                </>
              )}
            </p>
          </>
        )}
        <div className="suspended-actions">
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Check again
          </button>
          <button
            className="button secondary"
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
        {workspaces.length > 0 && (
          <div>
            <h2>{member ? "Your other coaches" : "Your other workspaces"}</h2>
            <ul className="suspended-list">
              {workspaces.map((w) => (
                <li key={w.tenantId}>
                  <button
                    className="button secondary"
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
                  {w.state === "suspended" && (
                    <span className="control-reason">Also paused for now.</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {member && <SuspendedMemberBilling coach={status?.workspace?.name} />}
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
        {!member && (
          <p>
            <a className="button secondary" href="/api/v1/privacy/export" download>
              Download my data
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
