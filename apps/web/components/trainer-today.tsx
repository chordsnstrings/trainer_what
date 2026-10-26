"use client";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Brain, Check, ChevronRight, Clock, Sparkles } from "lucide-react";
import { api, type State } from "./workspace-ui";
import { WorkspaceScope, useWorkspaceValue } from "./workspace-continuity";
import { useSharedInbox } from "./workspace-inbox-store";
import { InboxCard, KIND_LABEL } from "./workspace-inbox";
import { coachSetupOpen } from "./superadmin-access";
import { INBOX_CHANGED } from "./workspace-nav";
import { setupHref } from "./setup-wizard-model";
import { useLive, type LiveSnapshot } from "./workspace-live";
import { countUp, prefersReducedMotion } from "./motion";
import { formatRelative } from "../lib/format";
import {
  buildQueue,
  decisionsWaiting,
  entryTitle,
  focusOf,
  type QueueEntry,
  type RuleSuggestion,
  type SetupSummary,
} from "./trainer-queue";

/**
 * Today (docs/features/trainer-workspace.md): one queue, one decision at a
 * time. Up next shows the most urgent thing that needs the coach, with its
 * actions right there; Then lists the rest. Beside it, what the coach's AI is
 * doing: clients training with it now, what the Brain did, and how it is
 * getting better. The moat is the AI coaching, so sessions are not the
 * headline here. Every number comes from existing endpoints.
 */

/** A block of the page that loads once when Today opens. */
function useOnce<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api(path).then(
      (r) => live && setData(r),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return { data, failed };
}

/** Item keys that arrived after the queue first loaded, for a few seconds. */
function useNewKeys(keys: string[], ready: boolean) {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const signature = keys.join("\n");
  useLayoutEffect(() => {
    if (!ready) return;
    if (!known.current) {
      known.current = new Set(keys);
      return;
    }
    const added = keys.filter((k) => !known.current!.has(k));
    for (const k of added) known.current.add(k);
    if (!added.length) return;
    const until = Date.now() + 4000;
    setFresh((m) => new Map([...m, ...added.map((k) => [k, until] as const)]));
    const timer = window.setTimeout(() => setFresh((m) => new Map([...m].filter(([, t]) => t > Date.now()))), 4100);
    return () => window.clearTimeout(timer);
    // `signature` stands for `keys`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ready]);
  return fresh;
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

export function TrainerToday({ state }: { state: State }) {
  const scope = useContext(WorkspaceScope);
  const inbox = useSharedInbox(scope);
  const live = useLive(`${state.user.tenantId}:${state.user.userId}`, state, true);
  const owner = state.user.role === "owner";
  const setupOpen = coachSetupOpen(state);
  const rules = useOnce<{ suggestions: RuleSuggestion[] }>(owner ? "/brain/suggestions" : null);
  const setup = useOnce<SetupSummary>(setupOpen ? "/setup" : null);
  const progress = useOnce<{ weeks: Week[] }>("/brain/progress");
  const [later, setLater] = useWorkspaceValue<string[]>("today:later", []);
  const [doneHere, setDoneHere] = useWorkspaceValue<{ text: string; at: number }[]>("today:done", []);
  const [handled, setHandled] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [held, setHeld] = useState<string[]>([]);
  const hovering = useRef(false);

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
  const ready = inbox.items !== null;
  const fresh = useNewKeys(queue.map((e) => e.key), ready);
  // Arrivals while the pointer is over the list wait in a pill.
  useEffect(() => {
    if (!hovering.current) return;
    const added = [...fresh.keys()].filter((k) => !held.includes(k));
    if (added.length) setHeld((h) => [...h, ...added]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);
  const visible = queue.filter((e) => !held.includes(e.key));
  const focus = focusOf(visible, picked);
  const rest = visible.filter((e) => e !== focus);
  const waiting = decisionsWaiting(queue);
  // Today's finished decisions: the server's count, plus any finished here
  // since that count was taken.
  const done = live.doneToday + doneHere.filter((d) => d.at > live.updatedAt).length;
  const first = state.user.name?.split(" ")[0] || "coach";

  /** One decision finished: the card leaves, the next one rises from the queue. */
  const finish = (message: string, apply: () => void) => {
    setDoneHere((list) => [{ text: message, at: Date.now() }, ...list].slice(0, 30));
    setNotice(message);
    setPicked(null);
    const run = () => {
      apply();
      setLeaving(false);
    };
    if (prefersReducedMotion()) return run();
    setLeaving(true);
    window.setTimeout(run, 140);
  };
  const onInboxDone = (id: string, message: string) =>
    finish(message, () => {
      inbox.setItems((list) => list?.filter((i) => i.id !== id) ?? list);
      window.dispatchEvent(new Event(INBOX_CHANGED));
    });
  const releaseHeld = () => setHeld([]);

  const focusBody = (entry: QueueEntry): ReactNode =>
    entry.kind === "inbox" ? (
      <ul className="oq-inbox-focus">
        <InboxCard key={entry.key} item={entry.item} onDone={onInboxDone} variant="focus" />
      </ul>
    ) : entry.kind === "rule" ? (
      <RuleCard suggestion={entry.suggestion} onDone={(m) => finish(m, () => setHandled((h) => [...h, entry.key]))} />
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
        {ready && done + waiting > 0 && (
          <div className="oq-done">
            <Ring done={done} total={done + waiting} />
            <span>
              <strong><Counted value={done} /> of {done + waiting}</strong>
              <small className="muted">done today</small>
            </span>
          </div>
        )}
      </header>

      {notice && (
        <p className="notice success oq-notice" role="status" key={notice + done}>
          <Check size={17} /> {notice}
        </p>
      )}

      <div className="oq-grid">
        <section className="oq-focus" aria-labelledby="oq-focus-title">
          <div className="oq-focus-head">
            <h2 id="oq-focus-title">Up next</h2>
            {focus && rest.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setLater((l) => [...l.filter((k) => k !== focus.key), focus.key]);
                  setPicked(null);
                }}
              >
                <Clock size={15} /> Later today
              </button>
            )}
          </div>
          {inbox.error && !inbox.items && (
            <p className="notice error" role="alert">
              {inbox.error}
              <button className="text-button" onClick={() => void inbox.load()}>Try again</button>
            </p>
          )}
          {!ready && !inbox.error && <p className="muted" role="status">Loading what needs you…</p>}
          {ready && focus && (
            <div key={focus.key} className={"oq-focus-body" + (leaving ? " is-leaving" : "")}>
              {focusBody(focus)}
            </div>
          )}
          {ready && !focus && (
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
          onPointerEnter={() => (hovering.current = true)}
          onPointerLeave={() => {
            hovering.current = false;
            releaseHeld();
          }}
        >
          <div className="oq-then-head">
            <h2 id="oq-then-title">Then <span className="muted">· {rest.length}</span></h2>
            <span className="muted oq-small">Safety first, then oldest</span>
          </div>
          {held.length > 0 && (
            <button type="button" className="oq-pending" onClick={releaseHeld}>
              {held.length} new · show
            </button>
          )}
          {ready && !rest.length && <p className="muted oq-small">Nothing else waits.</p>}
          <ul className="oq-list">
            {rest.slice(0, 6).map((e) => (
              <li key={e.key} className={fresh.has(e.key) ? "is-new" : ""}>
                <button type="button" className="oq-row" onClick={() => setPicked(e.key)}>
                  <span className={"oq-avatar" + (e.kind === "inbox" ? "" : " is-brain")} aria-hidden="true">
                    {e.kind === "inbox" ? (e.item.clientName ?? "?").slice(0, 1) : <Brain size={16} />}
                  </span>
                  <span className="oq-row-main">
                    <span className="oq-row-title" dir="auto">{entryTitle(e)}</span>
                    <span className="oq-row-meta">
                      <span className={"oq-tag" + (e.kind === "inbox" && e.item.type === "safety" ? " is-safety" : "")}>
                        {e.kind === "inbox" ? KIND_LABEL[e.item.type as keyof typeof KIND_LABEL] : e.kind === "rule" ? "Learning" : "Setup"}
                      </span>
                      {e.kind === "inbox" && e.item.clientName && <span>{e.item.clientName}</span>}
                    </span>
                  </span>
                  {fresh.has(e.key) && <span className="oq-new">New</span>}
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
            {doneHere.length ? (
              <ul>
                {doneHere.slice(0, 8).map((d) => (
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
    </div>
  );
}
