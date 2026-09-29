"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate, formatDateRange, plural } from "../lib/format";

/**
 * What happens when the programme ends, and the programme timeline
 * (docs/features/programme.md). The Today screen itself is
 * components/member-today.tsx.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "The request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}
const zoneQuery = () => {
  const zone = deviceTimeZone();
  return zone ? `?timezone=${encodeURIComponent(zone)}` : "";
};
/** A calendar day: "Tue 29 Sep". */
const calendarDay = (date: string) =>
  formatDate(date, { weekday: true, year: false });

export function EndOfProgramme({ data }: { data: any }) {
  const end = data.endOfProgramme;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!end || end.state === "none") return null;
  // A monthly block rolling into the next one is routine: said once on the
  // timeline, not on Today.
  if (end.state === "next_block" || end.state === "renews") return null;
  const renew = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/payments/checkout", "POST", {
        productId: end.renewProductId,
      });
      if (r?.url) window.location.assign(r.url);
    } catch {
      setError(
        "Checkout could not be opened. Try again, or open Membership to choose a plan.",
      );
    } finally {
      setBusy(false);
    }
  };
  const renewControl =
    end.canRenew &&
    (end.renewProductId ? (
      <button className="button" disabled={busy} onClick={() => void renew()}>
        {busy ? "Opening checkout…" : "Start the next programme"}
      </button>
    ) : (
      <Link className="button secondary" href="/app/membership#offers">
        Choose your next plan
      </Link>
    ));
  return (
    <div
      className={
        "programme-end" +
        (end.state === "ends" || end.state === "ended" ? " ending" : "")
      }
      role="status"
    >
      {end.state === "ends" && (
        <p>
          Your access ends on {formatDate(end.at)}.
          {data.programme?.billing === "upfront"
            ? " Your programme was paid in full; nothing renews automatically."
            : " Your membership will not renew."}
        </p>
      )}
      {end.state === "ended" && (
        <p>
          {data.programme?.billing === "upfront"
            ? "You completed this programme. Your access has ended."
            : "Your membership has ended."}
        </p>
      )}
      {renewControl}
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  done: "Done",
  missed: "Missed",
  today: "Today",
  upcoming: "Planned",
  rest: "Rest",
  canceled: "Cancelled",
};

/** The block's days in weeks of seven, for the phone list. */
export function timelineWeeks<T extends { date: string }>(days: T[]) {
  const weeks: Array<{ index: number; from: string; to: string; days: T[] }> =
    [];
  days.forEach((d, i) => {
    const w = Math.floor(i / 7);
    if (!weeks[w])
      weeks[w] = { index: w + 1, from: d.date, to: d.date, days: [] };
    weeks[w].days.push(d);
    weeks[w].to = d.date;
  });
  return weeks;
}

/** Every day of the current programme (upfront) or block (monthly), with its session and status. */
export function ProgrammeTimeline({ programLabel }: { programLabel?: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(false);
  const load = () =>
    api("/programme/timeline" + zoneQuery()).then(
      (d) => {
        setData(d);
        setError(false);
      },
      () => setError(true),
    );
  useEffect(() => {
    void load();
  }, []);
  if (error)
    return (
      <section className="card" role="alert">
        <h1>Timeline</h1>
        <p className="muted">
          Your timeline could not be loaded. Check your connection, then try
          again.
        </p>
        <button className="button secondary" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="card" aria-busy="true">
        <p className="muted">Loading your timeline…</p>
      </section>
    );
  const p = data.programme;
  if (!p)
    return (
      <section className="card">
        <h1>No programme yet</h1>
        <p className="muted">
          Your timeline shows every day of your programme once your membership
          starts.
        </p>
        <Link className="button" href="/app/membership">
          See membership options
        </Link>
      </section>
    );
  const days: any[] = data.days ?? [];
  const done = days.filter((d) => d.status === "done").length,
    sessions = days.filter((d) => d.kind === "session").length;
  const range = formatDateRange(p.blockStartDate, p.blockEndDate);
  return (
    <div className="programme-timeline-page">
      <header className="page-heading">
        <p className="eyebrow">
          {p.billing === "upfront" ? "Your programme" : `Block ${p.block}`} ·{" "}
          {range}
        </p>
        <h1>
          {p.state === "not_started"
            ? `Starts ${calendarDay(p.startDate)}`
            : p.state === "complete"
              ? "Programme complete"
              : `Day ${p.day} of ${p.of}`}
        </h1>
        {data.planState === "ready" && (
          <p className="muted">
            {/* Isolated, so a leading number stays in place right to left. */}
            <bdi>
              {done} of {plural(sessions, "session")} done
            </bdi>
            {p.rolling
              ? `. A new ${p.of}-day block starts on ${calendarDay(nextDay(p.blockEndDate))}.`
              : ""}
          </p>
        )}
      </header>
      {data.planState === "awaiting_coach" && (
        <section className="card" role="status">
          <h2>Your coach is preparing your plan</h2>
          <p className="muted">
            Your sessions appear here day by day as soon as it is ready.
          </p>
          <Link className="button secondary" href="/app/chat">
            Message your coach
          </Link>
        </section>
      )}
      {data.planState === "self_paced" && data.plan && (
        <section className="card" aria-labelledby="self-paced-title">
          <p className="small-label">At your own pace</p>
          <h2 id="self-paced-title">{data.plan.title || programLabel}</h2>
          <p className="muted">
            {data.plan.daysPerWeek
              ? `${plural(data.plan.daysPerWeek, "session")} a week, on the days that suit you. `
              : "Train on the days that suit you. "}
            <bdi>{data.plan.completedThisWeek} done in the last 7 days.</bdi>
          </p>
          <ul className="timeline-plan-sessions">
            {data.plan.sessions.map((s: any, i: number) => (
              <li key={i}>
                <strong>{s.label || `Session ${i + 1}`}</strong>
                <span className="muted">{plural(s.exercises, "exercise")}</span>
              </li>
            ))}
          </ul>
          <Link className="button" href="/app/program">
            Open {programLabel || "your plan"}
          </Link>
        </section>
      )}
      {data.planState === "ended" && (
        <section className="card" role="status">
          <h2>
            {p.billing === "upfront"
              ? "You completed this programme"
              : "Your membership has ended"}
          </h2>
          <Link className="button" href="/app/membership#offers">
            Choose your next plan
          </Link>
        </section>
      )}
      {data.planState === "ready" &&
        timelineWeeks(days).map((week) => {
          const current = week.days.some((d: any) => d.date === p.today);
          const planned = week.days.filter(
            (d: any) => d.kind === "session",
          ).length;
          return (
            // The current week is open; the others fold to one line each.
            <details
              className="card timeline-week"
              key={week.index}
              open={current || undefined}
            >
              <summary>
                <strong>Week {week.index}</strong>
                <span className="muted">
                  {formatDateRange(week.from, week.to)} ·{" "}
                  {plural(planned, "session")}
                </span>
              </summary>
              <ol className="programme-timeline">
                {week.days.map((d: any) => (
                  <li
                    key={d.date}
                    className={
                      d.status + (d.date === p.today ? " is-today" : "")
                    }
                    aria-current={d.date === p.today ? "date" : undefined}
                  >
                    <span className="timeline-date">{calendarDay(d.date)}</span>
                    <strong className="timeline-label">
                      {d.kind === "session"
                        ? d.label || "Training session"
                        : "Rest"}
                    </strong>
                    {d.kind === "session" && (
                      <span
                        className={
                          "badge" +
                          (d.status === "done"
                            ? " green"
                            : d.status === "missed"
                              ? " amber"
                              : "")
                        }
                      >
                        {STATUS_LABEL[d.status] ?? "Planned"}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          );
        })}
    </div>
  );
}
function nextDay(date: string) {
  return new Date(Date.parse(date + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
