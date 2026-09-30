"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ShieldCheck } from "lucide-react";
import { Meter } from "./phone-ui";
import { setupApi } from "./setup-wizard-api";
import {
  brainChecklist,
  flagWords,
  meterText,
  quizPosition,
  ruleGroups,
  type QuizCase,
  type RuleCard,
} from "./setup-wizard-model";

/**
 * Step 4 "Teach your Brain" and the "Keep training" hub
 * (docs/features/setup-wizard.md, docs/features/brain-teach.md). The Brain
 * only drafts: approving rules, answering the practice quiz and writing
 * client questions teach it; nothing here sends anything to a client.
 */
type Round = {
  id: string;
  status: "open" | "completed";
  answered: number;
  total: number;
  cases: QuizCase[];
};
export type Teach = {
  rules: RuleCard[];
  approveAll: Array<{ id: string; version: number }>;
  flaggedDrafts: number;
  quiz: { open: Round | null; completedRounds: number };
  ownCases: { count: number; forWaitsForMe: number; forSendsAutomatically: number };
  meter: {
    score: number;
    level: number;
    name: string;
    summary: string;
    automaticActions: number;
    next: string[];
  };
  levels: Array<{ level: number; name: string; summary: string; automaticActions: number }>;
  launch: {
    live: boolean;
    liveMode: "waits_for_me" | "checked" | null;
    supervised: { ready: boolean; missing: string[] };
    automatic: { ready: boolean; missing: string[] };
  };
  suggestions: { drafts: number; teaching: number; replyCorrections: number };
};

export function useTeach() {
  const [teach, setTeach] = useState<Teach | null>(null),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setTeach(await setupApi("/brain/teach"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { teach, error, reload };
}

function Problem({ text }: { text: string }) {
  return text ? (
    <p className="notice error" role="alert">
      {text}
    </p>
  ) : null;
}

/** Draft rules as cards: "Approve all" for the clean ones, flagged one by one. */
export function RuleCards({
  teach,
  onChanged,
}: {
  teach: Teach;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [ack, setAck] = useState<Record<string, boolean>>({});
  const { approved, clean, flagged } = ruleGroups(teach.rules);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const message = await fn();
      if (message) setNote(message);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setup-rules">
      {clean.length > 0 && (
        <>
          <div className="setup-rules-head">
            <p>
              <strong>{clean.length}</strong> draft rule
              {clean.length === 1 ? "" : "s"} with no warnings.
            </p>
            <button
              type="button"
              className="button"
              disabled={busy || !teach.approveAll.length}
              onClick={() =>
                void run(async () => {
                  const out = await setupApi("/brain/rules/approve-all", "POST", {
                    rules: teach.approveAll,
                  });
                  const skipped = out.skipped?.length ?? 0;
                  return `${out.approved.length} approved.${
                    skipped
                      ? ` ${skipped} changed or need a closer look and stay below.`
                      : ""
                  }`;
                })
              }
            >
              <Check size={16} /> Approve all {clean.length}
            </button>
          </div>
          <ul className="setup-cards">
            {clean.map((r) => (
              <li key={r.id} className="setup-card">
                <RuleText rule={r} />
              </li>
            ))}
          </ul>
        </>
      )}
      {flagged.length > 0 && (
        <>
          <h3 className="setup-subhead">
            <AlertTriangle size={16} /> Check these one by one
          </h3>
          <ul className="setup-cards">
            {flagged.map((r) => (
              <li key={r.id} className="setup-card is-flagged">
                <RuleText rule={r} />
                <p className="setup-flag">
                  This rule {flagWords(r.flags).join(", ")}. Edit it in My
                  Brain, or approve it if it is really what you want.
                </p>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={!!ack[r.id]}
                    onChange={(e) => setAck({ ...ack, [r.id]: e.target.checked })}
                  />
                  I read the warning
                </label>
                <div className="button-row">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || !ack[r.id]}
                    onClick={() =>
                      void run(async () => {
                        await setupApi(`/brain/rules/${r.id}/confirm`, "POST", {
                          acknowledgeFlags: true,
                        });
                        return "Approved.";
                      })
                    }
                  >
                    Approve this rule
                  </button>
                  <Link className="button secondary" href="/trainer/brain/teaching">
                    Edit in My Brain
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {approved.length > 0 && (
        <details className="setup-approved">
          <summary>
            {approved.length} approved rule{approved.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {approved.map((r) => (
              <li key={r.id}>
                <strong>{r.title}</strong>
                {r.directive ? ` · ${r.directive}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Problem text={error} />
      {note && (
        <p className="notice success" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
function RuleText({ rule }: { rule: RuleCard }) {
  return (
    <>
      <strong>{rule.title}</strong>
      {rule.condition && (
        <p>
          <span className="muted">When </span>
          {rule.condition}
        </p>
      )}
      {rule.directive && <p>{rule.directive}</p>}
    </>
  );
}

/** A rule in the coach's own words, drafted into rule cards. */
export function TeachByText({
  onChanged,
  label = "Tell your Brain a rule in your own words",
}: {
  onChanged: () => Promise<void> | void;
  label?: string;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  return (
    <form
      className="setup-teach-text"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setNote("");
        try {
          const out = await setupApi("/brain/teach/chat", "POST", { text });
          const n = Array.isArray(out.rules) ? out.rules.length : 0;
          setNote(
            n
              ? `${n} draft rule${n === 1 ? "" : "s"} added. Approve ${n === 1 ? "it" : "them"} below.`
              : "Saved as teaching. No new rule came out of it; try saying what you do and when.",
          );
          setText("");
          await onChanged();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>{label}</span>
        <textarea
          rows={3}
          value={text}
          minLength={10}
          maxLength={12000}
          placeholder="For example: When a beginner misses a week, I restart them at their last easy week, never where they stopped."
          onChange={(e) => setText(e.target.value)}
        />
        <small>Describe clients in general terms, without names or contact details.</small>
      </label>
      <button className="button secondary" disabled={busy || text.trim().length < 10}>
        {busy ? "Drafting rules…" : "Draft rules from this"}
      </button>
      <Problem text={error} />
      {note && (
        <p className="notice success" role="status">
          {note}
        </p>
      )}
    </form>
  );
}

/** The "Would you reply like this?" practice quiz. */
export function PracticeQuiz({
  teach,
  onChanged,
  again = false,
}: {
  teach: Teach;
  onChanged: () => Promise<void> | void;
  /** Keep training: offer another round after a finished one. */
  again?: boolean;
}) {
  const [round, setRound] = useState<Round | null>(teach.quiz.open),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [changing, setChanging] = useState(false),
    [reply, setReply] = useState("");
  useEffect(() => setRound(teach.quiz.open), [teach.quiz.open]);
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      setRound(await setupApi("/brain/quiz/rounds", "POST", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const answer = async (c: QuizCase, verdict: "yes" | "change") => {
    if (!round) return;
    setBusy(true);
    setError("");
    try {
      const next: Round = await setupApi(
        `/brain/quiz/rounds/${round.id}/answers`,
        "POST",
        verdict === "yes" ? { caseId: c.id, verdict } : { caseId: c.id, verdict, reply },
      );
      setRound(next);
      setChanging(false);
      setReply("");
      if (next.status === "completed") await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!round || round.status === "completed") {
    const finished = teach.quiz.completedRounds;
    return (
      <div className="setup-quiz">
        {finished > 0 && (
          <p className="setup-done-line">
            <Check size={16} /> {finished} quiz round{finished === 1 ? "" : "s"} finished.
          </p>
        )}
        {(!finished || again) && (
          <>
            <p className="muted">
              8 to 10 client messages with the reply your Brain would draft. Say
              Yes, or change it. trainsyou adds a few safety questions.
            </p>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void start()}
            >
              {busy
                ? "Writing your questions… this can take up to a minute"
                : finished
                  ? "Take another round"
                  : "Start the practice quiz"}
            </button>
          </>
        )}
        <Problem text={error} />
      </div>
    );
  }
  const { current, number, total } = quizPosition(round.cases);
  if (!current) return null;
  return (
    <div className="setup-quiz" aria-live="polite">
      <div className="setup-quiz-head">
        <span>
          Question {number} of {total}
        </span>
        <Meter
          value={round.answered}
          max={total}
          label="Practice quiz progress"
          className="setup-meter is-small"
        />
      </div>
      {current.source === "platform" && (
        <p className="setup-safety">
          <ShieldCheck size={16} /> A safety question from trainsyou. These always
          come to you.
        </p>
      )}
      <p className="eyebrow">A client writes</p>
      <blockquote className="setup-client">{current.message}</blockquote>
      <p className="eyebrow">
        {current.route === "escalate"
          ? "Your Brain passes it to you and replies"
          : "Your Brain drafts"}
      </p>
      <blockquote className="setup-draft-reply">{current.reply}</blockquote>
      <p>
        <strong>Would you reply like this?</strong>
      </p>
      {changing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void answer(current, "change");
          }}
        >
          <label className="field">
            <span>How would you reply?</span>
            <textarea
              rows={3}
              value={reply}
              minLength={3}
              maxLength={4000}
              onChange={(e) => setReply(e.target.value)}
              autoFocus
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              onClick={() => setChanging(false)}
              disabled={busy}
            >
              Back
            </button>
            <button className="button" disabled={busy || reply.trim().length < 3}>
              Save my reply
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void answer(current, "yes")}
          >
            Yes
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setChanging(true)}
          >
            Change
          </button>
        </div>
      )}
      <Problem text={error} />
    </div>
  );
}

/** The coach's own client questions (held out from the quiz). */
export function OwnCases({
  teach,
  onChanged,
}: {
  teach: Teach;
  onChanged: () => Promise<void> | void;
}) {
  const approved = teach.rules.filter((r) => r.status === "confirmed");
  const [prompt, setPrompt] = useState(""),
    [rule, setRule] = useState(""),
    [comesToMe, setComesToMe] = useState<"" | "yes" | "no">(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { count, forWaitsForMe } = teach.ownCases;
  return (
    <form
      className="setup-own-cases"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await setupApi("/brain/scenarios", "POST", {
            prompt,
            expectedEvidenceId: rule,
            expectEscalation: comesToMe === "yes",
            heldOut: true,
          });
          setPrompt("");
          setComesToMe("");
          await onChanged();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        <strong>
          {Math.min(count, forWaitsForMe)} of {forWaitsForMe}
        </strong>{" "}
        written{count > forWaitsForMe ? ` (${count} in all)` : ""}. Write a real
        kind of question your clients ask. Your Brain never sees these while
        practising, so they check it fairly.
      </p>
      {!approved.length ? (
        <p className="muted">Approve at least one rule first.</p>
      ) : (
        <>
          <label className="field">
            <span>What a client might write</span>
            <textarea
              rows={2}
              value={prompt}
              minLength={10}
              maxLength={3000}
              placeholder="For example: I only slept 4 hours, should I still do today's session?"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Which of your rules answers it</span>
            <select value={rule} onChange={(e) => setRule(e.target.value)} required>
              <option value="">Choose a rule</option>
              {approved.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="setup-choice">
            <legend>Should this come to you instead of a drafted reply?</legend>
            {(
              [
                ["no", "No, the Brain can draft a reply"],
                ["yes", "Yes, pass it to me"],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className="check-field">
                <input
                  type="radio"
                  name="comes-to-me"
                  checked={comesToMe === value}
                  onChange={() => setComesToMe(value)}
                />
                {text}
              </label>
            ))}
          </fieldset>
          <button
            className="button secondary"
            disabled={busy || prompt.trim().length < 10 || !rule || !comesToMe}
          >
            Add this question
          </button>
        </>
      )}
      <Problem text={error} />
    </form>
  );
}

/** The step body: rules, quiz, own questions, then "Waits for me". */
export function BrainStep({
  onDone,
  teachState,
}: {
  onDone: () => Promise<void> | void;
  teachState: ReturnType<typeof useTeach>;
}) {
  const { teach, error, reload } = teachState;
  const [busy, setBusy] = useState(false),
    [launchError, setLaunchError] = useState("");
  if (!teach) return error ? <Problem text={error} /> : <p className="muted">Loading your Brain…</p>;
  const groups = ruleGroups(teach.rules);
  const list = brainChecklist({
    approvedRules: groups.approved.length,
    flaggedDrafts: groups.flagged.length,
    quizDone: teach.quiz.completedRounds > 0,
    ownCases: teach.ownCases.count,
    ownNeeded: teach.ownCases.forWaitsForMe,
  });
  const changed = async () => {
    await reload();
    await onDone();
  };
  return (
    <div className="setup-brain">
      <ol className="setup-checklist">
        {list.map((item, i) => (
          <li key={item.key} className={item.done ? "is-done" : ""}>
            <span className="setup-check-mark" aria-hidden="true">
              {item.done ? <Check size={14} /> : i + 1}
            </span>
            <span>
              {item.label}
              <small>{item.detail}</small>
            </span>
          </li>
        ))}
      </ol>
      <section className="setup-section" aria-labelledby="brain-rules">
        <h3 id="brain-rules">1. Your rules</h3>
        {!teach.rules.length && (
          <p className="muted">
            No rules yet. Chat with the assistant about how you coach, or write
            one below; your Brain turns it into draft rules for you to approve.
          </p>
        )}
        <RuleCards teach={teach} onChanged={changed} />
        <TeachByText onChanged={changed} />
      </section>
      <section className="setup-section" aria-labelledby="brain-quiz">
        <h3 id="brain-quiz">2. Practice quiz</h3>
        {groups.approved.length ? (
          <PracticeQuiz teach={teach} onChanged={changed} />
        ) : (
          <p className="muted">Approve at least one rule to start the quiz.</p>
        )}
      </section>
      <section className="setup-section" aria-labelledby="brain-cases">
        <h3 id="brain-cases">3. Your own client questions</h3>
        <OwnCases teach={teach} onChanged={changed} />
      </section>
      <section className="setup-section" aria-labelledby="brain-launch">
        <h3 id="brain-launch">4. Start in "Waits for me"</h3>
        {teach.launch.live ? (
          <p className="setup-done-line">
            <Check size={16} /> Your Brain drafts replies. Nothing reaches a
            client until you approve it.
          </p>
        ) : (
          <>
            {teach.launch.supervised.missing.length > 0 && (
              <ul className="setup-missing">
                {teach.launch.supervised.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="button"
              disabled={busy || !teach.launch.supervised.ready}
              onClick={async () => {
                setBusy(true);
                setLaunchError("");
                try {
                  await setupApi("/brain/releases/supervised", "POST", {});
                  await changed();
                } catch (e) {
                  setLaunchError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Finish teaching my Brain
            </button>
            <Problem text={launchError} />
          </>
        )}
      </section>
    </div>
  );
}

/** After go-live: the "Brain trained" meter, training and the Grow list. */
export function KeepTraining({
  grow,
}: {
  grow: Array<{ key: string; label: string; done: boolean; href: string; note?: string; optional?: boolean }>;
}) {
  const teachState = useTeach();
  const { teach, error, reload } = teachState;
  const [suggestions, setSuggestions] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [problem, setProblem] = useState("");
  const loadSuggestions = useCallback(async () => {
    try {
      setSuggestions(await setupApi("/brain/teach/suggestions"));
    } catch {
      setSuggestions(null);
    }
  }, []);
  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);
  const changed = async () => {
    await reload();
    await loadSuggestions();
  };
  if (!teach) return error ? <Problem text={error} /> : <p className="muted">Loading…</p>;
  const pending =
    (suggestions?.teaching?.length ?? 0) + (suggestions?.replyCorrections?.length ?? 0);
  return (
    <div className="setup-keep">
      <section className="setup-panel setup-meter-panel" aria-labelledby="meter-h">
        <div className="setup-meter-top">
          <div>
            <p className="eyebrow">Brain trained</p>
            <h2 id="meter-h">{meterText(teach.meter.score)}</h2>
          </div>
          <span className="setup-level">Level {teach.meter.level}: {teach.meter.name}</span>
        </div>
        <Meter
          value={teach.meter.score}
          max={100}
          label="Brain trained"
          className="setup-meter"
          memoryKey="brain-trained"
        />
        <p>{teach.meter.summary}</p>
        {teach.meter.next.length > 0 && (
          <ul className="setup-missing">
            {teach.meter.next.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <ol className="setup-levels">
          {teach.levels.map((l) => (
            <li key={l.level} className={l.level === teach.meter.level ? "is-current" : l.level < teach.meter.level ? "is-done" : ""}>
              <strong>{l.name}</strong>
              <small>
                {l.automaticActions
                  ? `Up to ${l.automaticActions} routine replies send automatically`
                  : "Every reply waits for you"}
              </small>
            </li>
          ))}
        </ol>
        <p className="muted">
          Health and safety questions always come to you, at every level.
        </p>
      </section>
      <section className="setup-panel" aria-labelledby="train-h">
        <h2 id="train-h">Train more</h2>
        <RuleCards teach={teach} onChanged={changed} />
        <TeachByText onChanged={changed} label="Teach a new rule" />
        <h3 className="setup-subhead">Practice quiz</h3>
        <PracticeQuiz teach={teach} onChanged={changed} again />
        {pending > 0 && (
          <>
            <h3 className="setup-subhead">From your corrections</h3>
            <p>
              {pending} of your changed replies can become rules. Your
              corrected wording is used, never the client's message.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setProblem("");
                try {
                  const out = await setupApi("/brain/teach/suggestions/compile", "POST", {
                    teachingIds: (suggestions.teaching ?? []).slice(0, 20).map((t: any) => t.id),
                    correctionIds: (suggestions.replyCorrections ?? [])
                      .slice(0, Math.max(0, 20 - (suggestions.teaching?.length ?? 0)))
                      .map((c: any) => c.id),
                  });
                  setNote(`${out.rules?.length ?? 0} draft rules suggested. Approve them above.`);
                  await changed();
                } catch (e) {
                  setProblem((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Suggest rules from my corrections
            </button>
          </>
        )}
        <Problem text={problem} />
        {note && (
          <p className="notice success" role="status">
            {note}
          </p>
        )}
        <p>
          <Link className="text-link" href="/trainer/brain">
            Everything in My Brain
          </Link>
        </p>
      </section>
      <section className="setup-panel" aria-labelledby="grow-h">
        <h2 id="grow-h">Grow</h2>
        <ul className="setup-grow">
          {grow.map((g) => (
            <li key={g.key} className={g.done ? "is-done" : ""}>
              <Link href={g.href}>
                <strong>{g.label}</strong>
                {g.optional && <small>Optional</small>}
                {g.note && <small>{g.note}</small>}
              </Link>
              {g.done && (
                <span className="setup-done-line">
                  <Check size={14} /> Done
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
