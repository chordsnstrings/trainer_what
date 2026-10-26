"use client";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, Brain, Check, ChevronRight, Clock, Sparkles } from "lucide-react";
import { api, type State } from "./workspace-ui";
import { WorkspaceScope, useWorkspaceValue } from "./workspace-continuity";
import { todayProgress, useSharedInbox } from "./workspace-inbox-store";
import { InboxCard, KIND_LABEL } from "./workspace-inbox";
import { coachSetupOpen } from "./superadmin-access";
import { setupHref } from "./setup-wizard-model";
import { useLive, type LiveSnapshot } from "./workspace-live";
import { countUp, prefersReducedMotion } from "./motion";
import { formatRelative } from "../lib/format";
import {
  arrivalAhead,
  buildQueue,
  entryTitle,
  focusOf,
  isSafety,
  type QueueEntry,
  type RuleSuggestion,
  type SetupSummary,
} from "./trainer-queue";

/**
 * Today (docs/features/trainer-workspace.md): one queue, one decision at a
 * time. Up next keeps the card the coach is working on until they finish it,
 * move it Later or pick another; anything more urgent that comes in shows
 * beside it instead of replacing it. Then lists the rest. Beside it, what
 * the coach's AI is doing: clients training with it now, what the Brain did,
 * and how it is getting better. The moat is the AI coaching, so sessions are
 * not the headline here. Every number comes from existing endpoints; the
 * decisions finished today come from the server with the inbox.
 */

/** Answers kept between visits (the workspace mounts again on every page),
 * per workspace scope: shown at once, then read again in the background. */
const kept = new Map<string, unknown>();
if (typeof window !== "undefined")
  window.addEventListener("workspace-session-cleared", () => kept.clear());

/** A block of the page that loads when Today opens, and again whenever
 * `refresh` changes. `settled`: it answered (now or on an earlier visit),
 * failed, or was never asked for (path null). */
function useOnce<T>(scope: string, path: string | null, refresh: unknown = 0) {
  const key = path ? `${scope}|${path}` : "";
  const [data, setData] = useState<T | null>(() => (key && kept.has(key) ? (kept.get(key) as T) : null)),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api(path).then(
      (r) => {
        kept.set(key, r);
        if (!live) return;
        setData(r);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [key, path, refresh]);
  // A source no longer asked for (setup finished) drops out of the queue.
  return { data: path ? data : null, failed: failed && data === null, settled: !path || data !== null || failed };
}
/** A rule suggestion the coach decided: gone from the kept answer too. */
function forgetSuggestion(scope: string, id: string) {
  const key = `${scope}|/brain/suggestions`;
  const data = kept.get(key) as { suggestions?: RuleSuggestion[] } | undefined;
  if (data?.suggestions) kept.set(key, { ...data, suggestions: data.suggestions.filter((s) => s.id !== id) });
}

/** Re-renders every half minute while the tab is visible, so "2 min ago"
 * stays true (the live store only publishes when its data changes). */
function useClock() {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") tick((n) => n + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
}
const startOfLocalDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** How long an arrival shows "New" once it is on screen. */
const NEW_MS = 4000;

/**
 * Queue keys that arrived after the page was ready. While `holding()` (the
 * pointer is over Then, or keyboard focus is in it) an arrival waits in
 * `held`, unless `urgent(key)`. `release()` shows the held keys and marks
 * them new from that moment. `known` only grows, so a key is new once and is
 * never held again after it was shown. "New" expires on its own timer, which
 * later changes to the queue do not cancel.
 */
function useArrivals(
  keys: string[],
  ready: boolean,
  holding: () => boolean,
  urgent: (key: string) => boolean,
) {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [held, setHeld] = useState<string[]>([]);
  const signature = keys.join("\n");
  useLayoutEffect(() => {
    if (!ready) return;
    if (!known.current) {
      known.current = new Set(keys);
      return;
    }
    const seen = known.current;
    const added = keys.filter((k) => !seen.has(k));
    if (!added.length) return;
    for (const k of added) seen.add(k);
    const wait = holding() ? added.filter((k) => !urgent(k)) : [];
    const show = added.filter((k) => !wait.includes(k));
    if (wait.length) setHeld((h) => [...h, ...wait]);
    if (show.length) {
      const until = Date.now() + NEW_MS;
      setFresh((m) => new Map([...m, ...show.map((k) => [k, until] as const)]));
    }
    // `signature` stands for `keys`; `holding` and `urgent` are read at arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ready]);
  useEffect(() => {
    if (!fresh.size) return;
    const wait = Math.max(0, Math.min(...fresh.values()) - Date.now()) + 50;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setFresh((m) => {
        const kept = new Map([...m].filter(([, until]) => until > now));
        return kept.size === m.size ? m : kept;
      });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [fresh]);
  // Held keys that were resolved meanwhile are not counted or shown.
  const present = new Set(keys);
  const waiting = held.filter((k) => present.has(k));
  const release = () => {
    if (!held.length) return;
    const until = Date.now() + NEW_MS;
    if (waiting.length) setFresh((m) => new Map([...m, ...waiting.map((k) => [k, until] as const)]));
    setHeld([]);
  };
  return { fresh, held: waiting, release };
}

const today = () =>
  new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

function Ring({ done, total }: { done: number; total: number }) {
  const value = total ? done / total : 0;
  return (
    <svg className="oq-ring" viewBox="0 0 64 64" role="img" aria-label={`${done} of ${total} done today`}>
      <circle cx="32" cy="32" r="26" />
      <circle className="oq-ring-value" cx="32" cy="32" r="26" style={{ strokeDashoffset: (163.4 * (1 - value)).toFixed(1) }} />
    </svg>
  );
}

/** A number that counts up the first time it is shown. */
function Counted({ value, format = String }: { value: number; format?: (v: number) => string }) {
  const el = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (!el.current) return;
    if (first.current) {
      first.current = false;
      return countUp(el.current, 0, value, format);
    }
    el.current.textContent = format(value);
  }, [value, format]);
  return <span ref={el}>{format(value)}</span>;
}

function RuleCard({
  suggestion,
  onDone,
}: {
  suggestion: RuleSuggestion;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const act = async (verb: "confirm" | "dismiss") => {
    setBusy(true);
    setError("");
    try {
      await api(`/brain/suggestions/${suggestion.id}/${verb}`, "POST", { version: suggestion.version });
      onDone(verb === "confirm" ? "Rule added. Your Brain uses it from now on." : "Not a rule. It will not suggest this again.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const rule = suggestion.rule ?? {};
  return (
    <div className="oq-card-body">
      <p className="oq-who">
        <span className="oq-avatar is-brain" aria-hidden="true"><Brain size={18} /></span>
        <span>
          <strong>Your Brain noticed a pattern</strong>
          <small>{suggestion.source === "edits" ? "From your edits this week" : "From a reply you corrected"}</small>
        </span>
      </p>
      <h3 className="oq-title">Make this a rule?</h3>
      <div className="oq-rule" dir="auto">
        {rule.title && <strong>{rule.title}</strong>}
        {rule.condition && <span>When {rule.condition}</span>}
        {rule.directive && <span>{rule.directive}</span>}
      </div>
      {suggestion.why && <p className="muted" dir="auto">{suggestion.why}</p>}
      <div className="inbox-actions">
        <button type="button" className="button" disabled={busy} onClick={() => void act("confirm")}>
          <Check size={16} /> Make it a rule
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void act("dismiss")}>
          Not a rule
        </button>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}

function SetupCard({ setup }: { setup: SetupSummary }) {
  const next = setup.steps.find((s) => s.key === setup.resumeStep) ?? setup.steps.find((s) => s.status !== "done");
  return (
    <div className="oq-card-body">
      <p className="oq-who">
        <span className="oq-avatar is-brain" aria-hidden="true"><Sparkles size={18} /></span>
        <span>
          <strong>Finish setup</strong>
          <small>{setup.progress.done} of {setup.progress.total} steps · about {setup.progress.minutesLeft} min left</small>
        </span>
      </p>
      <h3 className="oq-title">{next ? `Next: ${next.label}` : "Almost there"}</h3>
      <ol className="oq-steps" aria-label="Setup steps">
        {setup.steps.map((s) => (
          <li key={s.key} className={s.status === "done" ? "is-done" : s.key === next?.key ? "is-next" : ""}>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="muted">Your answers are saved. Your AI starts coaching your clients once you go live.</p>
      <div className="inbox-actions">
        <Link className="button" href={next ? setupHref(next.key as never) : "/setup"}>
          Continue setup <ChevronRight size={16} />
        </Link>
      </div>
    </div>
  );
}

function AiNow({ live }: { live: LiveSnapshot }) {
  useClock();
  const n = live.training.length;
  return (
    <section className="oq-panel oq-panel-now" aria-labelledby="oq-now">
      <div className="oq-panel-head">
        <h2 id="oq-now">Your AI right now</h2>
        {n > 0 && <span className="oq-live"><span className="oq-live-dot" aria-hidden="true" />{n} training now</span>}
      </div>
      {n ? (
        <ul className="oq-training">
          {live.training.slice(0, 5).map((t) => (
            <li key={t.workoutId}>
              <span className="oq-avatar" aria-hidden="true">{t.name.slice(0, 1)}</span>
              <span className="oq-training-main">
                <span className="oq-training-top">
                  <Link href={`/trainer/subscribers/${t.clientId}`}>{t.name}</Link>
                  <span className="muted">{t.setsTotal ? `set ${Math.min(t.setsDone + 1, t.setsTotal)} of ${t.setsTotal}` : `started ${formatRelative(t.startedAt)}`}</span>
                </span>
                <span className="muted oq-small" dir="auto">{t.workout}</span>
                {t.setsTotal > 0 && (
                  <span className="oq-bar" aria-hidden="true"><span style={{ transform: `scaleX(${(t.setsDone / t.setsTotal).toFixed(3)})` }} /></span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No one is training with your AI right now. Workouts show here set by set while clients train.</p>
      )}
    </section>
  );
}

function BrainFeed({ live }: { live: LiveSnapshot }) {
  useClock();
  return (
    <section className="oq-panel oq-panel-brain" aria-labelledby="oq-brain">
      <div className="oq-panel-head">
        <h2 id="oq-brain">What your Brain did</h2>
        <Link className="text-button" href="/trainer/brain">My Brain</Link>
      </div>
      {live.writing > 0 && (
        <p className="oq-writing" role="status">
          <span className="oq-dots" aria-hidden="true"><i /><i /><i /></span>
          Writing {live.writing === 1 ? "a plan" : `${live.writing} plans`}…
        </p>
      )}
      {live.feed.length ? (
        <ul className="oq-feed">
          {live.feed.map((f) => (
            <li key={f.id} className={"is-" + f.by}>
              <span>
                <strong>{f.text}</strong>
                <small className="muted">{f.detail}</small>
              </span>
              <time dateTime={f.at}>{formatRelative(f.at)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Its work shows here: replies it sends, plans it writes and what it learns from you.</p>
      )}
    </section>
  );
}

type Week = { week: string; approvedWithoutEdits: number | null };
function GettingBetter({ progress, failed, rules }: { progress: { weeks: Week[] } | null; failed: boolean; rules: number | null }) {
  const weeks = progress?.weeks ?? [];
  const latest = [...weeks].reverse().find((w) => w.approvedWithoutEdits !== null) ?? null;
  const percent = (v: number) => `${v}%`;
  return (
    <section className="oq-panel oq-panel-better" aria-labelledby="oq-better">
      <div className="oq-panel-head">
        <h2 id="oq-better">Getting better</h2>
      </div>
      {failed && <p className="muted">Could not load this right now.</p>}
      {!failed && !progress && <p className="muted" role="status">Loading…</p>}
      {progress && (
        <>
          {latest ? (
            <p className="oq-stat">
              <strong><Counted value={Math.round((latest.approvedWithoutEdits ?? 0) * 100)} format={percent} /></strong>
              <span className="muted">approved without edits, week of {new Date(latest.week + "T12:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
            </p>
          ) : (
            <p className="muted">Approve or edit its drafts and this shows how often it gets them right first time.</p>
          )}
          <span className="oq-spark" aria-hidden="true">
            {weeks.map((w) => (
              <i key={w.week} className={w.approvedWithoutEdits === null ? "is-empty" : ""} style={{ transform: `scaleY(${Math.max(0.06, w.approvedWithoutEdits ?? 0).toFixed(3)})` }} />
            ))}
          </span>
          {rules !== null && (
            <p className="oq-line"><span>Confirmed coaching rules</span><strong>{rules}</strong></p>
          )}
          <Link className="text-button" href="/trainer/brain">See what it learned <ChevronRight size={14} /></Link>
        </>
      )}
    </section>
  );
}

/** Up next's card and what the queue held when it was pinned. */
type Pin = { key: string; seen: string[] };
/** How long a finished card takes to leave (oq-card-out runs 120ms). */
const LEAVE_MS = 140;
const aheadLabel = (e: QueueEntry) =>
  isSafety(e)
    ? `Safety report${e.kind === "inbox" && e.item.clientName ? ` from ${e.item.clientName.split(" ")[0]}` : ""}`
    : `More urgent: ${entryTitle(e)}`;

export function TrainerToday({ state }: { state: State }) {
  const scope = useContext(WorkspaceScope);
  const inbox = useSharedInbox(scope);
  const live = useLive(`${state.user.tenantId}:${state.user.userId}`, state, true);
  const owner = state.user.role === "owner";
  const setupOpen = coachSetupOpen(state);
  // Read again whenever the server's count of waiting suggestions changes,
  // so every suggestion the header counts has its card.
  const rules = useOnce<{ suggestions: RuleSuggestion[] }>(scope, owner ? "/brain/suggestions" : null, inbox.rules);
  const setup = useOnce<SetupSummary>(scope, setupOpen ? "/setup" : null);
  const progress = useOnce<{ weeks: Week[] }>(scope, "/brain/progress");
  const [later, setLater] = useWorkspaceValue<string[]>("today:later", []);
  const [doneHere, setDoneHere] = useWorkspaceValue<{ text: string; at: number }[]>("today:done", []);
  // Up next keeps its card until the coach finishes it, moves it Later or
  // picks another. Kept for the session like Later, so leaving Today and
  // coming back shows the same card. `seen`: the queue when it was pinned;
  // only what arrives after that is surfaced over it.
  const [pin, setPin] = useWorkspaceValue<Pin | null>("today:pin", null);
  const [handled, setHandled] = useState<string[]>([]);
  // The card just finished, shown leaving for LEAVE_MS. Its data is already gone.
  const [leaving, setLeaving] = useState<QueueEntry | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const noticeSeq = useRef(0);
  const leaveTimer = useRef<number | undefined>(undefined);
  const shownKey = useRef<string | null>(null);
  const pointerInThen = useRef(false);
  const focusPanel = useRef<HTMLElement>(null);
  const focusTitle = useRef<HTMLHeadingElement>(null);
  const thenPanel = useRef<HTMLElement>(null);
  const thenTitle = useRef<HTMLHeadingElement>(null);

  const queue = useMemo(
    () =>
      buildQueue(
        inbox.items ?? [],
        (rules.data?.suggestions ?? []).filter((s) => s.target === "rule" && !handled.includes(`rule:${s.id}`)),
        setup.data,
        later,
      ),
    [inbox.items, rules.data, setup.data, later, handled],
  );
  // Ready once every source this page asked for has answered or failed, so
  // rules and setup are part of the first picture, never arrivals.
  const ready = inbox.items !== null && rules.settled && setup.settled;
  const safety = new Set(queue.filter(isSafety).map((e) => e.key));
  const arrivals = useArrivals(
    queue.map((e) => e.key),
    ready,
    () => pointerInThen.current || !!thenPanel.current?.contains(document.activeElement),
    (key) => safety.has(key),
  );
  const visible = queue.filter((e) => !arrivals.held.includes(e.key));
  // The pinned card while it is in the queue, else the first visible one (pinned below).
  const upcoming = ready ? focusOf(visible, pin?.key ?? null) : null;
  const shown = leaving ?? upcoming;
  const rest = ready ? visible.filter((e) => e.key !== upcoming?.key && e.key !== leaving?.key) : [];
  const pinned = !leaving && pin && upcoming && pin.key === upcoming.key ? pin : null;
  const ahead = pinned ? arrivalAhead(visible, upcoming, pinned.seen) : null;
  // Today's decisions: finished (the server's count, with finishes on this
  // tab applied at once) and still waiting. The rail shows the same numbers.
  const { done, waiting, total } = todayProgress(inbox);
  const finishedToday = doneHere.filter((d) => d.at >= startOfLocalDay());
  const first = state.user.name?.split(" ")[0] || "coach";

  // Pin whatever Up next shows when nothing is pinned (first load, after a
  // finish or Later) or the pinned item was resolved elsewhere.
  useLayoutEffect(() => {
    if (ready && !leaving && upcoming && pin?.key !== upcoming.key)
      setPin({ key: upcoming.key, seen: visible.map((e) => e.key) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, leaving, upcoming?.key, pin?.key]);
  useLayoutEffect(() => {
    shownKey.current = shown?.key ?? null;
  });
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const releaseIfAway = () => {
    if (!pointerInThen.current && !thenPanel.current?.contains(document.activeElement)) arrivals.release();
  };
  // After a pick or a finish, focus goes to "Up next", unless the coach has
  // already put it somewhere else (another panel, the Jump to dialog).
  useEffect(() => {
    if (!focusRequest) return;
    // Only when focus was lost (the row or card that had it went away); a
    // reply box the next card opened, or anything elsewhere, keeps it.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    focusTitle.current?.focus();
    releaseIfAway();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const pick = (key: string) => {
    setPin({ key, seen: visible.map((e) => e.key) });
    setFocusRequest((n) => n + 1);
  };
  const moveLater = () => {
    if (!upcoming) return;
    const key = upcoming.key;
    setLater((l) => [...l.filter((k) => k !== key), key]);
    setPin(null);
  };
  /** One decision finished: its data goes now; on screen the card leaves, then the next one rises. */
  const finish = (entry: QueueEntry, message: string, apply: () => void) => {
    noticeSeq.current += 1;
    setNotice({ id: noticeSeq.current, text: message });
    setDoneHere((list) => [{ text: message, at: Date.now() }, ...list].slice(0, 30));
    apply();
    // A card the coach left while it was saving (they picked another) just goes.
    if (shownKey.current !== entry.key) return;
    const settle = () => {
      leaveTimer.current = undefined;
      setLeaving(null);
      setPin((p) => (p?.key === entry.key ? null : p));
      setFocusRequest((n) => n + 1);
    };
    window.clearTimeout(leaveTimer.current);
    if (prefersReducedMotion()) return settle();
    setLeaving(entry);
    leaveTimer.current = window.setTimeout(settle, LEAVE_MS);
  };

  const focusBody = (entry: QueueEntry): ReactNode =>
    entry.kind === "inbox" ? (
      <ul className="oq-inbox-focus">
        <InboxCard
          key={entry.key}
          item={entry.item}
          variant="focus"
          onDone={(id, message) => finish(entry, message, () => inbox.finish({ id }))}
        />
      </ul>
    ) : entry.kind === "rule" ? (
      <RuleCard
        key={entry.key}
        suggestion={entry.suggestion}
        onDone={(message) =>
          finish(entry, message, () => {
            setHandled((h) => [...h, entry.key]);
            forgetSuggestion(scope, entry.suggestion.id);
            inbox.finish({ rule: entry.suggestion.id });
          })
        }
      />
    ) : (
      <SetupCard setup={entry.setup} />
    );

  return (
    <div className="trainer-today oq-today">
      <header className="oq-head">
        <div>
          <p className="eyebrow">{today()}</p>
          <h1>Good to see you, {first}</h1>
          <p className="muted oq-summary">
            {setupOpen
              ? "Finish setup and your AI starts coaching your clients."
              : waiting
                ? `${waiting} ${waiting === 1 ? "decision needs" : "decisions need"} you. Your AI handles the rest within your rules.`
                : "Nothing needs you right now. Your AI keeps coaching."}
          </p>
        </div>
        {ready && total > 0 && (
          <div className="oq-done">
            <Ring done={done} total={total} />
            <span>
              <strong><Counted value={done} /> of {total}</strong>
              <small className="muted">done today</small>
            </span>
          </div>
        )}
      </header>

      {notice && (
        <p key={notice.id} className="notice success oq-notice">
          <Check size={17} aria-hidden="true" /> {notice.text}
        </p>
      )}

      <div className="oq-grid">
        <section className="oq-focus" aria-labelledby="oq-focus-title" ref={focusPanel}>
          <div className="oq-focus-head">
            <h2 id="oq-focus-title" ref={focusTitle} tabIndex={-1}>Up next</h2>
            <div className="oq-focus-tools">
              {ahead && (
                <button
                  type="button"
                  className={"oq-ahead" + (isSafety(ahead) ? " is-safety" : "")}
                  onClick={() => pick(ahead.key)}
                >
                  {isSafety(ahead) && <AlertCircle size={15} aria-hidden="true" />}
                  <span dir="auto">{aheadLabel(ahead)}</span>
                  <span aria-hidden="true">·</span> Open now
                </button>
              )}
              {upcoming && !leaving && rest.length > 0 && (
                <button type="button" className="text-button" onClick={moveLater}>
                  <Clock size={15} /> Later today
                </button>
              )}
            </div>
          </div>
          {inbox.error && !inbox.items && (
            <p className="notice error" role="alert">
              {inbox.error}
              <button className="text-button" onClick={() => void inbox.load()}>Try again</button>
            </p>
          )}
          {!ready && !inbox.error && <p className="muted" role="status">Loading what needs you…</p>}
          {shown && (
            <div key={shown.key} className={"oq-focus-body" + (leaving ? " is-leaving" : "")} inert={!!leaving}>
              {focusBody(shown)}
            </div>
          )}
          {ready && !shown && (
            <div className="oq-clear">
              <span className="oq-clear-mark" aria-hidden="true"><Check size={24} /></span>
              <h3>Nothing waits for you</h3>
              <p className="muted">Your AI keeps coaching. Anything it is not sure about lands here first.</p>
            </div>
          )}
        </section>

        <section
          className="oq-then"
          aria-labelledby="oq-then-title"
          ref={thenPanel}
          onPointerEnter={() => {
            pointerInThen.current = true;
          }}
          onPointerLeave={() => {
            pointerInThen.current = false;
            releaseIfAway();
          }}
          onBlur={(event) => {
            if (!pointerInThen.current && !event.currentTarget.contains(event.relatedTarget as Node | null))
              arrivals.release();
          }}
        >
          <div className="oq-then-head">
            <h2 id="oq-then-title" ref={thenTitle} tabIndex={-1}>Then <span className="muted">· {rest.length}</span></h2>
            <span className="muted oq-small">Safety first, then oldest</span>
          </div>
          {arrivals.held.length > 0 && (
            <button
              type="button"
              className="oq-pending"
              onClick={(event) => {
                // From the keyboard, focus goes to the heading first so it
                // does not go down with the pill (a mouse click needs none).
                if (event.detail === 0) thenTitle.current?.focus();
                arrivals.release();
              }}
            >
              {arrivals.held.length} new · show
            </button>
          )}
          {ready && !rest.length && <p className="muted oq-small">Nothing else waits.</p>}
          <ul className="oq-list">
            {rest.slice(0, 6).map((e) => (
              <li key={e.key} className={arrivals.fresh.has(e.key) ? "is-new" : ""}>
                <button type="button" className="oq-row" onClick={() => pick(e.key)}>
                  <span className={"oq-avatar" + (e.kind === "inbox" ? "" : " is-brain")} aria-hidden="true">
                    {e.kind === "inbox" ? (e.item.clientName ?? "?").slice(0, 1) : <Brain size={16} />}
                  </span>
                  <span className="oq-row-main">
                    <span className="oq-row-title" dir="auto">{entryTitle(e)}</span>
                    <span className="oq-row-meta">
                      <span className={"oq-tag" + (isSafety(e) ? " is-safety" : "")}>
                        {e.kind === "inbox" ? KIND_LABEL[e.item.type as keyof typeof KIND_LABEL] : e.kind === "rule" ? "Learning" : "Setup"}
                      </span>
                      {e.kind === "inbox" && e.item.clientName && <span>{e.item.clientName}</span>}
                    </span>
                  </span>
                  {arrivals.fresh.has(e.key) && <span className="oq-new">New</span>}
                  <ChevronRight className="oq-go" size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {rest.length > 6 && (
            <Link className="text-button" href="/trainer/inbox">
              {rest.length - 6} more in Inbox <ChevronRight size={14} />
            </Link>
          )}
          <details className="oq-done-list">
            <summary>Done today · {done}</summary>
            {finishedToday.length ? (
              <ul>
                {finishedToday.slice(0, 8).map((d) => (
                  <li key={d.at}><Check size={14} aria-hidden="true" /> {d.text}</li>
                ))}
              </ul>
            ) : (
              <p className="muted oq-small">{done ? "Finished earlier today." : "What you finish today shows here."}</p>
            )}
          </details>
        </section>

        <AiNow live={live} />
        <BrainFeed live={live} />
        <GettingBetter progress={progress.data} failed={progress.failed} rules={state.totals?.confirmedRules ?? null} />
      </div>

      {/* Always mounted, out of the grid's flow; only the keyed child changes,
          so each finish and each surfaced arrival is announced once. */}
      <p className="sr-only" role="status">{notice && <span key={notice.id}>{notice.text}</span>}</p>
      <p className="sr-only" aria-live="polite">
        {ahead && (
          <span key={ahead.key}>
            {aheadLabel(ahead)} came in.{ahead.key === visible.find((e) => e.key !== upcoming?.key)?.key ? " It is next after this card." : ""}
          </span>
        )}
      </p>
    </div>
  );
}
