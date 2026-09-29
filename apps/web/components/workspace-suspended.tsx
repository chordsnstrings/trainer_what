"use client";
import { useCallback, useEffect, useState } from "react";
import { governanceApi, when } from "./governance-shared";
import { SuspendedMemberBilling } from "./suspended-member-billing";
import { Rich, useErrorText, useLocale, useT } from "../lib/i18n/react";
import { translator, type Locale } from "../lib/i18n/core";
import publicMessages from "../lib/i18n/messages/public";
import { formatDateTime } from "../lib/format";

/**
 * The title and first lines of the suspension screen. The workspace name is
 * often the coach's own name, so members read about the coach's coaching
 * workspace being paused, never "<name> is suspended" (as if the person
 * were).
 */
export function suspensionCopy(
  status: {
    role?: string;
    workspace?: { name?: string };
    message?: string;
  },
  locale: Locale = "en",
) {
  const name = status.workspace?.name?.trim() ?? "";
  const t = translator(publicMessages, locale);
  if (status.role === "subscriber")
    return {
      title: name ? t("pausedTitle", { name }) : t("pausedTitlePlain"),
      body: name ? t("pausedBody", { name }) : t("pausedBodyPlain"),
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
  const t = useT("public"),
    locale = useLocale(),
    toError = useErrorText();
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
    load().catch((e) => setError(toError(e)));
  }, [load, toError]);
  const member = status?.role === "subscriber";
  const copy = status ? suspensionCopy(status, member ? locale : "en") : null;
  // Members read dates in their language; the trainer view is unchanged.
  const at = (value: string) =>
    member ? formatDateTime(value, { locale, zone: "Asia/Dubai" }) : when(value);
  const support: string | null = status?.supportEmail ?? null;
  return (
    <main className="suspended-page governance-suspended" id="main">
      <section className="card" aria-labelledby="suspended-title">
        <p className="eyebrow">
          {member ? t("coachingPaused") : "WORKSPACE UNAVAILABLE"}
        </p>
        <h1 id="suspended-title">
          {copy?.title ?? (member ? t("unavailable") : "This workspace is unavailable")}
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
                  <strong>
                    {member ? t("platformMessage") : "Message from the platform team:"}
                  </strong>{" "}
                  <span dir="auto">{status.notice}</span>
                </span>
              </p>
            )}
            {status.suspendedAt && (
              <p className="muted">
                {member
                  ? t("pausedOn", { date: at(status.suspendedAt) })
                  : `Paused on ${when(status.suspendedAt)}.`}
              </p>
            )}
            <p className="suspended-support">
              {support ? (
                <Rich
                  t={t}
                  k="questionsEmail"
                  tags={{
                    email: () => (
                      <a
                        className="text-link ltr-data"
                        href={`mailto:${support}`}
                      >
                        {support}
                      </a>
                    ),
                  }}
                />
              ) : (
                <>
                  {t("questions")}{" "}
                  <a className="text-link" href="/about#company">
                    {t("howToContact")}
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
            onClick={() => load().catch((e) => setError(toError(e)))}
          >
            {t("checkAgain")}
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
            {t("signOut")}
          </button>
        </div>
        {workspaces.length > 0 && (
          <div>
            <h2>{member ? t("otherCoaches") : "Your other workspaces"}</h2>
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
                        setError(toError(e));
                        setBusy(false);
                      }
                    }}
                  >
                    {t("open", { name: w.name })}
                  </button>
                  {w.state === "suspended" && (
                    <span className="control-reason">{t("alsoPaused")}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {member && <SuspendedMemberBilling coach={status?.workspace?.name} />}
        {notices.length > 0 && (
          <div>
            <h2>{member ? t("recentNotifications") : "Recent notifications"}</h2>
            <ul className="governance-history">
              {notices.map((n) => (
                <li key={n.id}>
                  <strong dir="auto">{n.title}</strong>{" "}
                  <span className="muted">{at(n.created_at)}</span>
                  <p className="governance-notice-body" dir="auto">
                    {n.body}
                  </p>
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
