"use client";
import { useContext, useEffect, useState } from "react";
import Link from "next/link";
import { api, type State } from "./workspace-ui";
import { WorkspaceScope } from "./workspace-continuity";
import { useSharedInbox } from "./workspace-inbox-store";
import { Inbox } from "./workspace-inbox";
import { coachSetupOpen } from "./superadmin-access";
import { SETUP_HREF } from "./workspace-nav";
import { formatDateTime } from "../lib/format";
import { ReadRetry } from "./read-retry";

/** A daily working view; counts come from the same tenant-scoped inbox as navigation. */
export function TrainerToday({ state }: { state: State }) {
  const inbox = useSharedInbox(useContext(WorkspaceScope));
  const [agenda, setAgenda] = useState<any>(null),
    [error, setError] = useState("");
  const load = async () => {
    try {
      setAgenda(await api("/bookings"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const slots =
    agenda?.slots
      ?.filter(
        (s: any) =>
          s.status === "open" && new Date(s.starts_at).getTime() >= Date.now(),
      )
      .sort((a: any, b: any) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 3) ?? [];
  return (
    <div className="trainer-today stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">YOUR COACHING DAY</p>
          <h1>Good to see you, {state.user.name?.split(" ")[0] || "coach"}</h1>
          <p className="muted">
            See what needs you, handle the next decision, then get back to
            coaching.
          </p>
        </div>
        <Link className="button secondary" href="/trainer/subscribers">
          Find a client
        </Link>
      </header>
      {coachSetupOpen(state) && (
        <section className="card daily-next-step">
          <div>
            <h2>Your next step: finish setup</h2>
            <p>
              Your answers are saved. Continue from where you left off, then try
              your coaching in a private preview.
            </p>
          </div>
          <Link className="button" href={SETUP_HREF}>
            Continue setup
          </Link>
        </section>
      )}
      <div className="daily-work-grid">
        <section className="daily-queue">
          <div className="card-heading">
            <div>
              <h2>
                Needs your attention{inbox.items ? ` · ${inbox.count}` : ""}
              </h2>
              <p className="muted">
                Safety and urgent client decisions come first.
              </p>
              {inbox.updatedAt > 0 && (
                <small className="muted">
                  Updated{" "}
                  {new Date(inbox.updatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {inbox.error ? " · refresh needed" : ""}
                </small>
              )}
            </div>
            <Link href="/trainer/inbox" className="text-button">
              Full inbox
            </Link>
          </div>
          <Inbox state={state} compact />
        </section>
        <aside className="stack">
          <section className="card">
            <div className="card-heading">
              <h2>Upcoming sessions</h2>
              <Link href="/trainer/bookings">Schedule</Link>
            </div>
            {error && (
              <div className="notice error" role="alert">
                {error}
                <ReadRetry onRetry={load} />
              </div>
            )}
            {!agenda && !error && <p role="status">Loading sessions…</p>}
            {agenda && !slots.length && (
              <p className="muted">
                No upcoming sessions. Add availability when you’re ready.
              </p>
            )}
            <ul className="daily-agenda">
              {slots.map((s: any) => (
                <li key={s.id}>
                  <Link href="/trainer/bookings">
                    <strong dir="auto">{s.title}</strong>
                    <span>
                      {formatDateTime(s.starts_at, {
                        zone: agenda.timezone,
                        weekday: true,
                      })}
                    </span>
                    <small>
                      {s.booked} booked · {s.capacity} places
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>Your coaching Brain</h2>
            <p className="muted">
              Teach a decision, review its work or check what it can handle.
            </p>
            <Link className="button secondary" href="/trainer/brain">
              Open My Brain
            </Link>
            <Link className="text-button" href="/trainer/brain/actions">
              Review activity
            </Link>
          </section>
          {state.user.role === "owner" && (
            <section className="card">
              <h2>Your business</h2>
              <p className="muted">
                Review earnings, offers and renewals in one place.
              </p>
              <Link href="/trainer/finance" className="text-button">
                Earnings and plans
              </Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
