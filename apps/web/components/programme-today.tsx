"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/** The subscriber's day-by-day programme view and its timeline (docs/features/programme.md). */
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
const calendarDay = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const instantDay = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
const round = (n: number | null | undefined) =>
  typeof n === "number" ? Math.round(n) : null;

function EndOfProgramme({ data }: { data: any }) {
  const end = data.endOfProgramme;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!end || end.state === "none") return null;
  const renew = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/payments/checkout", "POST", {
        productId: end.renewProductId,
      });
      if (r?.url) window.location.assign(r.url);
    } catch (e: any) {
      setError(e.message);
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
      <Link className="button secondary" href="/app/membership">
        Choose your next plan
      </Link>
    ));
  return (
    <div
      className={
        "programme-end" + (end.state === "ends" || end.state === "ended" ? " ending" : "")
      }
      role="status"
    >
      {end.state === "next_block" && (
        <p>
          This block ends on {calendarDay(data.programme.blockEndDate)}. Your
          next block starts {calendarDay(end.at)} and your coach plans it
          from how this one went.
        </p>
      )}
      {end.state === "renews" && (
        <p>Your membership renews {end.at ? instantDay(end.at) : "monthly"}.</p>
      )}
      {end.state === "ends" && (
        <p>
          Your access ends on {instantDay(end.at)}.
          {data.programme?.billing === "upfront"
            ? " Your programme was paid in full; nothing renews automatically."
            : " Renewal is off."}
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

function Nutrition({ n }: { n: any }) {
  if (!n) return null;
  if (n.state === "permission")
    return (
      <div className="programme-tile">
        <p className="small-label">Nutrition today</p>
        <p>Allow nutrition coaching to see today&apos;s targets.</p>
        <Link className="text-link" href="/app/nutrition">
          Open nutrition
        </Link>
      </div>
    );
  if (n.state === "setup")
    return (
      <div className="programme-tile">
        <p className="small-label">Nutrition today</p>
        <p>Add your food preferences so your coach can set your targets.</p>
        <Link className="text-link" href="/app/nutrition">
          Set up nutrition
        </Link>
      </div>
    );
  const t = n.target;
  const kcal = round(n.consumed?.kcal) ?? 0;
  const goal = t?.kcal ?? round(n.planned?.kcal);
  const macros = [
    ["Protein", "protein"],
    ["Carbohydrate", "carbohydrate"],
    ["Fat", "fat"],
  ] as const;
  return (
    <div className="programme-tile programme-nutrition">
      <p className="small-label">Nutrition today</p>
      <h3>
        <span dir="ltr">
          {kcal}
          {goal ? ` / ${goal}` : ""} kcal
        </span>
      </h3>
      {goal ? (
        <div
          className="programme-meter"
          role="progressbar"
          aria-label="Calories logged against today's target"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(kcal, goal)}
        >
          <span style={{ inlineSize: `${Math.min(100, (kcal / goal) * 100)}%` }} />
        </div>
      ) : (
        <p className="muted">Your coach has not set today&apos;s target yet.</p>
      )}
      {macros.map(([label, key]) =>
        t?.[key] != null ? (
          <div className="programme-macro" key={key}>
            <span>{label}</span>
            <span dir="ltr">
              {round(n.consumed?.[key]) ?? 0} / {round(t[key])} g
            </span>
          </div>
        ) : null,
      )}
      <p className="muted">
        {n.meals} {n.meals === 1 ? "meal" : "meals"} logged
        {t?.reviewDue ? " · target review due with your coach" : ""}
      </p>
      <Link className="text-link" href="/app/nutrition/log">
        Log a meal
      </Link>
    </div>
  );
}

/** Today: Day N of M, today's session or rest, what's next, streak, nutrition and the programme end. */
export function ProgrammeToday() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api("/programme/today" + zoneQuery()).then(
        (d) => {
          setData(d);
          setError("");
        },
        (e) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <section className="card programme-today" aria-live="polite">
        <p className="muted">Today&apos;s programme could not be loaded.</p>
        <button className="button secondary" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="card programme-today" aria-busy="true">
        <p className="muted">Loading today&apos;s programme…</p>
      </section>
    );
  const p = data.programme;
  if (!p)
    return (
      <section className="card programme-today">
        <p className="eyebrow">YOUR PROGRAMME</p>
        <h2>Start your coaching programme</h2>
        <p className="muted">
          Choose a membership and your coach&apos;s plan appears here day by day.
        </p>
        <Link className="button" href="/app/membership">
          See membership options
        </Link>
      </section>
    );
  const s = data.session;
  const progress = data.progress;
  return (
    <section
      className="card programme-today"
      aria-labelledby="programme-today-title"
    >
      <div className="programme-day">
        <p className="eyebrow" id="programme-today-title">
          {p.state === "not_started"
            ? "YOUR PROGRAMME STARTS SOON"
            : p.state === "complete"
              ? "PROGRAMME COMPLETE"
              : p.billing === "upfront"
                ? "YOUR PROGRAMME"
                : `BLOCK ${p.block}`}
        </p>
        <strong>
          {p.state === "not_started"
            ? `Starts ${calendarDay(p.startDate)}`
            : `Day ${p.day} of ${p.of}`}
        </strong>
        {p.rolling && p.state !== "not_started" && (
          <span className="badge">Rolling {p.of}-day blocks</span>
        )}
      </div>
      <div
        className="programme-meter"
        role="progressbar"
        aria-label="Progress through the programme"
        aria-valuemin={0}
        aria-valuemax={p.of}
        aria-valuenow={p.day}
      >
        <span style={{ inlineSize: `${Math.min(100, (p.day / p.of) * 100)}%` }} />
      </div>
      <div className="programme-columns">
        <div className="programme-tile">
          <p className="small-label">Today · {calendarDay(data.today)}</p>
          {s ? (
            <>
              <h3>{s.label ?? "Training session"}</h3>
              <p className="muted">
                {s.status === "completed"
                  ? "Done. Nice work."
                  : s.status === "canceled"
                    ? "Your coach canceled today's session."
                    : `${s.exercises} ${s.exercises === 1 ? "exercise" : "exercises"}${s.week ? ` · week ${s.week}` : ""}`}
              </p>
              {!["completed", "canceled"].includes(s.status) && (
                <Link className="button" href="/app/program">
                  {s.status === "started" ? "Continue session" : "Start session"}
                </Link>
              )}
            </>
          ) : (
            <>
              <h3>Rest day</h3>
              <p className="muted">
                Recovery is part of the plan. Move gently and sleep well.
              </p>
            </>
          )}
        </div>
        <div className="programme-tile">
          <p className="small-label">What&apos;s next</p>
          {data.next ? (
            <>
              <h3>{data.next.label ?? "Training session"}</h3>
              <p className="muted">
                {data.next.inDays === 1
                  ? "Tomorrow"
                  : `${calendarDay(data.next.date)} · in ${data.next.inDays} days`}
              </p>
            </>
          ) : (
            <p className="muted">
              Your coach has not scheduled the next session yet.
            </p>
          )}
          <div className="programme-stats">
            <div>
              <span className="small-label">Streak</span>
              <strong>{progress.streak}</strong>
            </div>
            <div>
              <span className="small-label">Adherence</span>
              <strong>
                {progress.percent === null ? "—" : `${progress.percent}%`}
              </strong>
            </div>
            <div>
              <span className="small-label">Last {progress.windowDays} days</span>
              <strong>
                {progress.completed}/{progress.scheduled}
              </strong>
            </div>
          </div>
        </div>
        <Nutrition n={data.nutrition} />
      </div>
      <EndOfProgramme data={data} />
      <p>
        <Link className="text-link" href="/app/timeline">
          See the whole {p.billing === "upfront" ? "programme" : "block"}
        </Link>
      </p>
    </section>
  );
}

const STATUS_LABEL: Record<string, string> = {
  done: "Done",
  missed: "Missed",
  today: "Today",
  upcoming: "Planned",
  rest: "Rest",
  canceled: "Canceled",
};
/** Every day of the current programme (upfront) or block (monthly), with its session and status. */
export function ProgrammeTimeline() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/programme/timeline" + zoneQuery()).then(setData, (e) =>
      setError(e.message),
    );
  }, []);
  if (error)
    return (
      <section className="card">
        <p className="muted" role="alert">
          The programme timeline could not be loaded.
        </p>
      </section>
    );
  if (!data)
    return (
      <section className="card" aria-busy="true">
        <p className="muted">Loading your programme…</p>
      </section>
    );
  const p = data.programme;
  if (!p)
    return (
      <section className="card">
        <h2>No programme yet</h2>
        <p className="muted">Your timeline appears once your membership starts.</p>
        <Link className="button" href="/app/membership">
          See membership options
        </Link>
      </section>
    );
  const done = data.days.filter((d: any) => d.status === "done").length,
    sessions = data.days.filter((d: any) => d.kind === "session").length;
  return (
    <section className="card" aria-labelledby="programme-timeline-title">
      <p className="eyebrow">
        {p.billing === "upfront" ? "PROGRAMME" : `BLOCK ${p.block}`} ·{" "}
        {calendarDay(p.blockStartDate)} – {calendarDay(p.blockEndDate)}
      </p>
      <h2 id="programme-timeline-title">
        {p.state === "not_started" ? "Starting soon" : `Day ${p.day} of ${p.of}`}
      </h2>
      <p className="muted">
        {done} of {sessions} sessions done
        {p.rolling ? ` · rolling ${p.of}-day blocks` : ""}
      </p>
      <ol className="programme-timeline">
        {data.days.map((d: any) => (
          <li
            key={d.date}
            className={d.status}
            aria-current={d.status === "today" ? "date" : undefined}
          >
            <span className="small-label">Day {d.day}</span>
            <span>{calendarDay(d.date)}</span>
            <strong>{d.kind === "session" ? (d.label ?? "Session") : "Rest"}</strong>
            <span className={"badge" + (d.status === "done" ? " green" : d.status === "missed" ? " amber" : "")}>
              {STATUS_LABEL[d.status] ?? d.status}
            </span>
          </li>
        ))}
      </ol>
      <p>
        <Link className="text-link" href="/app">
          Back to today
        </Link>
      </p>
    </section>
  );
}
