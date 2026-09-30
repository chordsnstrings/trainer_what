"use client";
import Link from "next/link";
import { AlertCircle, RefreshCw, LogOut, Compass } from "lucide-react";
import { useT } from "../lib/i18n/react";

/**
 * Whole-screen states of the member app (docs/features/member-screens.md):
 * an address that is not a member screen, and the workspace failing to
 * load. The offline screen belongs to the installed-app (PWA) work. In the
 * member's language (docs/features/arabic.md).
 */
export function MemberNotFound() {
  const t = useT("shell");
  return (
    <section className="card member-state" aria-labelledby="not-found-title">
      <Compass size={28} aria-hidden="true" />
      <h1 id="not-found-title">{t("nfTitle")}</h1>
      <p className="muted">{t("nfText")}</p>
      <div className="member-state-actions">
        <Link className="button" href="/app">
          {t("nfToday")}
        </Link>
        <Link className="button secondary" href="/app/more">
          {t("nfMore")}
        </Link>
      </div>
    </section>
  );
}

/**
 * The workspace could not load at all: clearly an error, with a retry, a way
 * to sign out and plain next steps.
 */
export function WorkspaceUnavailable({
  message,
  busy,
  onRetry,
  onSignOut,
}: {
  message: string;
  busy?: boolean;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const t = useT("shell");
  return (
    <main className="loading-screen workspace-unavailable">
      <section
        className="card member-state"
        aria-labelledby="unavailable-title"
      >
        <AlertCircle size={28} aria-hidden="true" />
        <h1 id="unavailable-title">{t("unTitle")}</h1>
        <p className="muted" role="alert">
          {message}
        </p>
        <p className="muted">{t("unText")}</p>
        <div className="member-state-actions">
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={onRetry}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {busy ? t("unTrying") : t("unTryAgain")}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={onSignOut}
          >
            <LogOut size={16} aria-hidden="true" />
            {t("unSignOut")}
          </button>
        </div>
      </section>
    </main>
  );
}
