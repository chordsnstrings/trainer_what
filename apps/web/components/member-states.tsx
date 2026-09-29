"use client";
import Link from "next/link";
import { AlertCircle, RefreshCw, LogOut, Compass } from "lucide-react";

/**
 * Whole-screen states of the member app (docs/features/member-screens.md):
 * an address that is not a member screen, and the workspace failing to
 * load. The offline screen belongs to the installed-app (PWA) work.
 */
export function MemberNotFound() {
  return (
    <section className="card member-state" aria-labelledby="not-found-title">
      <Compass size={28} aria-hidden="true" />
      <h1 id="not-found-title">This page does not exist</h1>
      <p className="muted">
        The link may be old or mistyped. Everything in your coaching space is
        one tap away from Today or More.
      </p>
      <div className="member-state-actions">
        <Link className="button" href="/app">
          Go to Today
        </Link>
        <Link className="button secondary" href="/app/more">
          See everything in More
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
  return (
    <main className="loading-screen workspace-unavailable">
      <section
        className="card member-state"
        aria-labelledby="unavailable-title"
      >
        <AlertCircle size={28} aria-hidden="true" />
        <h1 id="unavailable-title">Your workspace could not be opened</h1>
        <p className="muted" role="alert">
          {message}
        </p>
        <p className="muted">
          Your saved workouts and meals are safe. If this keeps happening,
          contact your coach or try again in a few minutes.
        </p>
        <div className="member-state-actions">
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={onRetry}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {busy ? "Trying again…" : "Try again"}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={onSignOut}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
