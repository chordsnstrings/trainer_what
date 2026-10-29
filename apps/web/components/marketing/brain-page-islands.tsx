"use client";
// The Trainer Brain page's three sample controls (pages/trainer-brain.tsx;
// docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP5), ported from concept
// A's product.js: the rule card and its ledger (Confirm, Edit, Reject and
// Undo; "Approve all" never takes the flagged rule, as in setup), the
// release timeline (roll back one version, restore it) and "Compare my
// replies" (reveal which blind reply was yours). Sample data, labelled as
// such on the page; nothing leaves the browser. The server renders the
// first state; each control has one polite live region that reads only the
// visitor's own changes. The rule card's stamp is the page's one spring and
// the Live marker its one slide (app/marketing-brain-pages.css).
import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Lock } from "lucide-react";

/**
 * The rule to review: suggested from the sample trainer's edit of a reply
 * (the traces' "You edit a reply"). Their progression rule from the
 * interview is already confirmed and live (the trace chain on the page).
 */
const RULE = "When every set of an upper-body lift is done, add 2.5 kg";
type RuleState = "pending" | "confirmed" | "edited" | "rejected";
const RULE_STATUS: Record<RuleState, string> = {
  pending: "To review",
  confirmed: "Confirmed",
  edited: "Edited · confirmed",
  rejected: "Rejected · not used",
};
/**
 * The trainer's other rules: each with its source and where it stands. Only
 * confirmed rules drive decisions, so the deload rule the traces' "Skip my
 * deload?" cites is confirmed, and the flagged draft is one no sample uses.
 */
const LEDGER: Array<{
  rule: string;
  source: string;
  state: "confirmed" | "flagged" | "locked";
}> = [
  {
    rule: "Missed session → next free day, never stack",
    source: "Quiz · Q4",
    state: "confirmed",
  },
  {
    rule: "Deload every 4th week",
    source: "notes.pdf · reviewed",
    state: "confirmed",
  },
  {
    rule: "Cardio before lifting → swap the order",
    source: "notes.pdf · reviewed",
    state: "flagged",
  },
  {
    rule: "Pain or red flags → training paused, to you",
    source: "Safety rules",
    state: "locked",
  },
];

/** The rule card over the trainer's rule ledger: confirm, edit or reject one rule, or approve all. */
export function RuleLedger() {
  const [state, setState] = useState<RuleState>("pending");
  const [rule, setRule] = useState(RULE);
  const [draft, setDraft] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const undo = useRef<HTMLButtonElement>(null),
    confirm = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  // Where focus goes once the next state has rendered: Undo after a
  // decision, Confirm after Undo, the text box when editing starts.
  const target = useRef<RefObject<HTMLElement | null> | null>(null);
  useEffect(() => {
    target.current?.current?.focus();
    target.current = null;
  });
  const done = state !== "pending";
  const editing = draft !== null;
  const decide = (to: RuleState, message: string) => {
    setState(to);
    setDraft(null);
    setSaid(message);
    target.current = undo;
  };
  const approve = (all: boolean) => {
    const text = draft?.trim() ?? "";
    const edited = !!text && text !== rule;
    if (edited) setRule(text);
    decide(
      edited ? "edited" : "confirmed",
      all
        ? "Approved 1 rule. The flagged rule still needs you."
        : "Rule confirmed.",
    );
  };
  return (
    <>
      <article
        className="mk-tb-box mk-tb-rc"
        data-rc={state}
        data-ok={state === "confirmed" || state === "edited" ? "" : undefined}
        aria-labelledby="mk-tb-rule-h"
      >
        <p className="mk-tb-row mk-tb-mono">
          <span>Your edit · 22 Oct</span>
          <span>{RULE_STATUS[state]}</span>
        </p>
        {/* The card keeps its name (the rule) while the text box is open. */}
        <p className="mk-tb-rc-text" id="mk-tb-rule-h" hidden={editing}>
          {rule}
        </p>
        {editing && (
          <>
            <label className="sr-only" htmlFor="mk-tb-rule-edit">
              Edit the rule
            </label>
            <textarea
              ref={input}
              id="mk-tb-rule-edit"
              rows={2}
              maxLength={120}
              value={draft ?? ""}
              onChange={(event) => setDraft(event.target.value)}
            />
          </>
        )}
        <p className="mk-tb-mono">Applies to · upper-body lifts</p>
        <div className="button-row">
          {done ? (
            <button
              ref={undo}
              type="button"
              className="button secondary"
              onClick={() => {
                setRule(RULE);
                setState("pending");
                setSaid("Back to review.");
                target.current = confirm;
              }}
            >
              Undo
            </button>
          ) : (
            <>
              <button
                ref={confirm}
                type="button"
                className="button"
                onClick={() => approve(false)}
              >
                {editing ? "Save and confirm" : "Confirm"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setDraft(editing ? null : rule);
                  target.current = editing ? confirm : input;
                }}
              >
                {editing ? "Cancel" : "Edit"}
              </button>
              <button
                type="button"
                className="button secondary mk-tb-no"
                onClick={() =>
                  decide("rejected", "Rule rejected. It won’t be used.")
                }
              >
                Reject
              </button>
            </>
          )}
        </div>
        {(state === "confirmed" || state === "edited") && (
          <span className="mk-tb-stamp" aria-hidden="true">
            <Check size={14} />
            {state === "edited" ? "Edited" : "Confirmed"}
          </span>
        )}
        <p className="sr-only" aria-live="polite">
          {said}
        </p>
      </article>
      <div className="mk-tb-box">
        <p className="mk-tb-row">
          <b>Your AI · Rules</b>
          <span className="mk-tb-mono">
            {done ? "1 flagged" : "1 to review · 1 flagged"}
          </span>
        </p>
        <p className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={done}
            onClick={() => approve(true)}
          >
            Approve all (1)
          </button>
          <span className="mk-tb-mono">
            Flagged rules are never in “Approve all”.
          </span>
        </p>
        <ul className="mk-tb-list">
          {LEDGER.map((row) => (
            <li key={row.rule} className="mk-tb-row">
              <code>{row.rule}</code>
              <span>
                <span className="mk-tb-mono">{row.source}</span>{" "}
                {row.state === "confirmed" ? (
                  <span className="mk-pf-chip mk-pf-live">Confirmed</span>
                ) : row.state === "flagged" ? (
                  <span className="mk-pf-chip mk-pf-soon">
                    Flagged · conflicts with case 3
                  </span>
                ) : (
                  <span className="mk-pf-chip mk-pf-estimate">
                    <Lock size={12} aria-hidden="true" />
                    Can’t switch off
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * The sample trainer's versions as the app makes them: the first goes live
 * in "Waits for me" once rules, a practice quiz and 3 own cases are done;
 * 20 own cases and a passing check allow sending on its own; later edits
 * go live once they pass the re-check.
 */
const VERSIONS = [
  { v: "v1", what: "Rules, quiz, 3\u00a0cases", when: "16 Oct" },
  { v: "v2", what: "+ 17 cases", when: "18 Oct" },
  { v: "v3", what: "+ 1 rule", when: "19 Oct" },
  { v: "v4", what: "+ 2 corrections", when: "21 Oct" },
];

/**
 * Four versions of the sample trainer's AI, v4 live. Rolling back moves the
 * Live marker one version back and keeps v4 (archived, as the app does), so
 * it can be restored.
 */
export function ReleaseTimeline() {
  const [back, setBack] = useState(false);
  const [said, setSaid] = useState("");
  const live = back ? 2 : 3;
  return (
    <div className="mk-tb-box mk-tb-rel" data-back={back ? "" : undefined}>
      <div className="mk-tb-row">
        <h3>Releases</h3>
        <span className="mk-tb-mono">Sample</span>
      </div>
      <div className="mk-tb-track">
        <span className="mk-tb-live" aria-hidden="true">
          <b>Live</b>
        </span>
        <ol>
          {VERSIONS.map((version, i) => (
            <li key={version.v} aria-current={i === live ? "true" : undefined}>
              <b>{version.v}</b>
              <small>{version.what}</small>
              <small>{version.when}</small>
            </li>
          ))}
        </ol>
      </div>
      <p className="mk-tb-row">
        <span className="mk-tb-mono">
          {back
            ? "v3 live · v4 kept, not in use"
            : "v4 live · checked against your test cases"}
        </span>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setBack(!back);
            setSaid(
              back
                ? "Version 4 is live again."
                : "Rolled back. Version 3 is live.",
            );
          }}
        >
          {back ? "Restore v4" : "Roll back to v3"}
        </button>
      </p>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/**
 * The five points of "Compare my replies", as the app names them
 * (components/brain-fidelity.tsx), with the sample ratings of reply A and
 * reply B.
 */
export const COMPARE_POINTS: ReadonlyArray<[string, number, number]> = [
  ["Coaching decision", 4, 4],
  ["Tone and wording", 5, 4],
  ["Use of conversation", 4, 4],
  ["Explanation and reasoning", 4, 5],
  ["Knowing when to ask or defer", 5, 5],
];
/** A rating as five dots, filled up to the score; read as "Reply A: 4 of 5". */
function Dots({ value, who }: { value: number; who: string }) {
  return (
    <span role="img" aria-label={`${who}: ${value} of 5`}>
      {"●".repeat(value) + "○".repeat(5 - value)}
    </span>
  );
}

/** Two blind replies to one sample message, rated on the five points; saving reveals which was yours. */
export function CompareReplies() {
  const [shown, setShown] = useState(false);
  const [said, setSaid] = useState("");
  return (
    <div className="mk-tb-box mk-tb-cmp">
      <div className="mk-tb-row">
        <h3>Compare my replies</h3>
        <span className="mk-tb-mono">Blind · sample</span>
      </div>
      <p>
        <small>Subscriber</small>“Week three done. Squats felt easy.”
      </p>
      <div className="mk-tb-replies">
        <p className="mk-tb-box">
          <small>{shown ? "Your reply" : "Reply A"}</small>
          Nice work. Two easy sessions, so Monday’s squat goes up to 62.5 kg.
        </p>
        <p className="mk-tb-box">
          <small>{shown ? "Your AI" : "Reply B"}</small>
          Great week. Squats move to 62.5 kg on Monday after two easy sessions.
        </p>
      </div>
      <dl className="mk-tb-list">
        {COMPARE_POINTS.map(([point, a, b]) => (
          <div key={point} className="mk-tb-row">
            <dt>{point}</dt>
            <dd>
              <Dots value={a} who="Reply A" /> <Dots value={b} who="Reply B" />
            </dd>
          </div>
        ))}
      </dl>
      <p className="button-row">
        <button
          type="button"
          className="button"
          onClick={() => {
            setShown(!shown);
            setSaid(
              shown
                ? "Labels hidden."
                : "Reply A was yours. Reply B was your AI.",
            );
          }}
        >
          {shown ? "Hide labels" : "Save ratings and reveal"}
        </button>
        <span className="mk-tb-mono">
          Labels stay hidden until you save both ratings.
        </span>
      </p>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
