"use client";
import { VoiceOneOnOne } from "./voice-one-on-one";
import { TryMyAI } from "./trainer-preview";
import { BrainFidelity } from "./brain-fidelity";
import { Field } from "./field";
import { KnowledgeImportReview } from "./ingestion-review";
import { SourceCompilation } from "./source-compilation";
import { OnboardingChat } from "./onboarding-chat";
import { useWorkspaceValue } from "./workspace-continuity";
import { useState } from "react";
import Link from "next/link";
import { KEEP_TRAINING, setupHref } from "./setup-wizard-model";
import {
  ArrowRight,
  Plus,
  Check,
  Activity,
  Brain,
  CheckCircle,
} from "lucide-react";
import {
  LoadMore,
  api,
  Button,
  Empty,
  RULE_FLAG_TEXT,
  Badge,
  Card,
  Heading,
  type ViewProps,
  total,
  kindTotal,
} from "./workspace-ui";
export const questions = [
  "Who do you coach best, and what outcomes do you prioritize?",
  "How do you progress a beginner?",
  "How does progression change for experienced clients?",
  "How do you choose exercises?",
  "How do you replace an exercise when equipment is missing?",
  "How do you prescribe sets, reps, RIR and RPE?",
  "When do you change weekly volume or frequency?",
  "What do you change when fatigue rises?",
  "How do you handle a missed workout?",
  "What is your sequence for resolving a plateau?",
  "What triggers a deload?",
  "What equipment constraints matter most?",
  "How do you shorten a session?",
  "How do you program conditioning?",
  "What do you refuse to program?",
  "When must a human review a decision?",
  "How do you motivate a client with low adherence?",
  "How do you give difficult feedback?",
  "How much explanation do your clients need?",
  "What distinguishes your method from generic coaching?",
];
export function BrainView(props: ViewProps) {
  const [details, setDetails] = useWorkspaceValue("brain:onboarding-details", false, true);
  const conversation = ["/trainer/brain", "/trainer/brain/interview"].includes(props.path) && props.state.user.role === "owner";
  if (conversation && !details) return <><TryMyAI /><OnboardingChat audience="coach" mode="teach" onSaved={props.onSaved} onDetails={() => setDetails(true)} /></>;
  return <>{props.state.user.role === "owner" && <TryMyAI />}{conversation && <button className="button secondary" onClick={() => setDetails(false)}>Back to conversation</button>}<BrainDetails {...props} /></>;
}
function BrainDetails({
  state,
  records,
  action,
  busy,
  path,
  onSaved,
  more,
}: ViewProps) {
  const [tab, setTab] = useState(
    path.includes("constitution")
      ? "rules"
      : path.includes("knowledge")
        ? "sources"
        : path.includes("scenarios")
          ? "scenarios"
          : path.includes("releases")
            ? "releases"
            : "interview",
  );
  const sources = records("source").filter(
      (source) => source.status === "ready",
    ),
    rules = records("rule"),
    answers = records("interview");
  const question =
    questions.find((q) => !answers.some((a) => a.data.question === q)) ??
    questions[0];
  return (
    <>
      <Heading
        eyebrow="YOUR MOST VALUABLE ASSET"
        title="Your coaching mind, made clear."
        detail="Teach it how you coach, check it with a practice quiz, and decide how much it does on its own."
      />
      {state.user.role === "owner" && (
        <p className="brain-keep-training">
          <Link className="text-link" href={setupHref(KEEP_TRAINING)}>
            Keep training: see how trained your Brain is and teach it more
          </Link>
        </p>
      )}
      <nav className="button-row" aria-label="My Brain sections">
        {[
          ["teaching", "Teach with examples"],
          ["actions", "Routine actions"],
          ["checks", "Practice quiz"],
          ["autonomy", "How much my Brain does alone"],
          ["plans", "Plans"],
        ].map(([key, label]) => (
          <Link
            key={key}
            className="button secondary"
            href={`/trainer/brain/${key}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="tabs">
        {[
          ["interview", "Questions"],
          ["sources", "Knowledge"],
          ["rules", "My rules"],
          ["communication", "Communication style"],
          ["fidelity", "Compare my replies"],
          ["scenarios", "Quiz questions"],
          ["releases", "Check my Brain"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "communication" && <VoiceOneOnOne />}
      {tab === "fidelity" && <BrainFidelity />}
      {tab === "interview" && (
        <div className="two-columns wide-left">
          <Card>
            <p className="eyebrow">
              CONVERSATION{" "}
              {Math.min(kindTotal(state, "interview", answers.length) + 1, 20)}{" "}
              OF 20
            </p>
            <h2>{question}</h2>
            <p className="muted">
              Use a real example. The reasoning matters more than the perfect
              wording.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const answer = String(new FormData(form).get("answer"));
                void action(
                  () => api("/brain/interviews", "POST", { question, answer }),
                  "Answer saved",
                ).then((r) => {
                  if (r) form.reset();
                });
              }}
            >
              <Field label="Your approach">
                <textarea
                  name="answer"
                  required
                  minLength={3}
                  rows={8}
                  placeholder="When I work with a client like this…"
                />
              </Field>
              <Button type="submit" disabled={busy}>
                Save and continue <ArrowRight size={16} />
              </Button>
            </form>
          </Card>
          <Card>
            <h2>A little context goes a long way.</h2>
            <p className="muted">
              Describe the situation, the choice you made, and the reason. Your
              confirmed rules stay separate from draft answers.
            </p>
            <div className="large-number">
              {answers.length}
              <span>/ 20</span>
            </div>
            <p className="small-label">METHOD TOPICS CAPTURED</p>
            <div className="progress-track">
              <span
                style={{ width: `${Math.min(100, answers.length * 5)}%` }}
              />
            </div>
            <div className="divider" />
            {answers.slice(0, 3).map((a) => (
              <div key={a.id} className="answer-preview">
                <CheckCircle size={16} />
                <p>{a.data.question}</p>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "sources" && (
        <div className="two-columns">
          <Card>
            <h2>Your knowledge library</h2>
            <p className="muted">
              Add your own notes, programs and coaching explanations as text.
              Source ownership stays with your workspace.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void action(
                  () =>
                    api("/brain/sources", "POST", {
                      title: f.get("title"),
                      text: f.get("text"),
                      rights: true,
                    }),
                  "Source added",
                ).then((r) => {
                  if (r) form.reset();
                });
              }}
            >
              <Field label="Source title">
                <input
                  name="title"
                  required
                  placeholder="My approach to beginner progression"
                />
              </Field>
              <Field label="Coaching material">
                <textarea name="text" required minLength={10} rows={10} />
              </Field>
              <label className="check-field">
                <input type="checkbox" required />I have the right to use this
                material and have removed unnecessary personal information.
              </label>
              <Button type="submit" disabled={busy}>
                Add to knowledge <Plus size={16} />
              </Button>
            </form>
            <KnowledgeImportReview onApproved={onSaved} />
          </Card>
          <Card>
            <div className="card-heading">
              <h2>Sources</h2>
              <Badge>
                {more.has("records", "source")
                  ? `${sources.length} loaded`
                  : sources.length}
              </Badge>
            </div>
            <SourceCompilation
              sources={sources}
              busy={busy}
              previous={
                rules.find((rule) => rule.data.compilationCoverage)?.data
                  .compilationCoverage
              }
              onCompile={(sourceIds) =>
                action(
                  () =>
                    api("/brain/compile", "POST", {
                      sourceIds,
                    }),
                  "Draft rules compiled for your review",
                )
              }
            />
            {records("conflict")
              .filter((c) => c.status === "open")
              .map((c) => (
                <div className="notice" key={c.id}>
                  <p>{c.data.description}</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void action(
                        () =>
                          api("/brain/conflicts/" + c.id + "/resolve", "POST", {
                            resolution: f.get("resolution"),
                          }),
                        "Conflict resolution recorded",
                      );
                    }}
                  >
                    <Field label="Your resolution">
                      <textarea name="resolution" minLength={10} required />
                    </Field>
                    <Button type="submit" secondary disabled={busy}>
                      Resolve conflict
                    </Button>
                  </form>
                </div>
              ))}
            <LoadMore
              more={more}
              collection="records"
              kind="source"
              label="Load older sources"
            />
            <LoadMore
              more={more}
              collection="records"
              kind="conflict"
              label="Load older conflicts"
            />
            {!sources.length && (
              <Empty
                title="Your knowledge starts here"
                detail="Add a piece of your coaching experience. Every source remains traceable."
              />
            )}
          </Card>
        </div>
      )}
      {tab === "rules" && (
        <div className="two-columns">
          <Card>
            <h2>Write a coaching rule</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = new FormData(form);
                void action(
                  () =>
                    api("/brain/rules", "POST", {
                      ...Object.fromEntries(f),
                      sourceIds: [],
                    }),
                  "Rule drafted",
                ).then((r) => {
                  if (r) form.reset();
                });
              }}
            >
              <Field label="Rule name">
                <input
                  name="title"
                  required
                  placeholder="Progress only when technique is consistent"
                />
              </Field>
              <Field label="Category">
                <select name="category">
                  {[
                    "progression",
                    "substitution",
                    "schedule",
                    "recovery",
                    "communication",
                    "safety",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="When this applies">
                <textarea
                  name="condition"
                  required
                  rows={2}
                  placeholder="A beginner completes all sets with stable technique…"
                />
              </Field>
              <Field label="What I do">
                <textarea
                  name="directive"
                  required
                  rows={3}
                  placeholder="Increase the load by the smallest available increment."
                />
              </Field>
              <Field label="Why">
                <textarea name="reason" rows={2} />
              </Field>
              <Button type="submit" disabled={busy}>
                Save draft rule <Plus size={16} />
              </Button>
            </form>
          </Card>
          <div className="card-stack">
            {rules.length ? (
              rules.map((r) => (
                <Card key={r.id}>
                  <div className="card-heading">
                    <Badge>{r.data.category}</Badge>
                    <Badge tone={r.status === "confirmed" ? "green" : "amber"}>
                      {r.status}
                    </Badge>
                  </div>
                  <h3>{r.data.title}</h3>
                  <p className="muted">
                    <strong>When </strong>
                    {r.data.condition}
                  </p>
                  <p>{r.data.directive}</p>
                  {r.data.reason && <p className="muted">{r.data.reason}</p>}
                  {r.status !== "confirmed" && r.data.flags?.length > 0 && (
                    <p role="alert">
                      <Badge tone="amber">Check before confirming</Badge>{" "}
                      The compiler flagged this draft:{" "}
                      {(r.data.flags as string[])
                        .map((f) => RULE_FLAG_TEXT[f] ?? f.replaceAll("_", " "))
                        .join("; ")}
                      . Correct it, or confirm it only if it is your method.
                    </p>
                  )}
                  {r.status !== "confirmed" && (
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () =>
                            api(`/brain/rules/${r.id}/confirm`, "POST", {
                              acknowledgeFlags: r.data.flags?.length > 0,
                            }),
                          "Rule confirmed",
                        )
                      }
                    >
                      {r.data.flags?.length > 0
                        ? "Confirm despite the warning"
                        : "Confirm this rule"}{" "}
                      <Check size={16} />
                    </Button>
                  )}
                </Card>
              ))
            ) : (
              <Card>
                <Empty
                  title="Your rules are taking shape"
                  detail="These are the rules you explicitly stand behind. Confirm a draft when it represents your judgment."
                />
              </Card>
            )}
            <LoadMore
              more={more}
              collection="records"
              kind="rule"
              label="Load older rules"
            />
          </div>
        </div>
      )}
      {tab === "scenarios" && (
        <div className="two-columns">
          <Card>
            <h2>Test the reasoning, not the wording.</h2>
            <p className="muted">
              Write practice questions your Brain has never seen. They are kept
              apart from what it learns from, so the quiz stays fair.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  () =>
                    api("/brain/scenarios", "POST", {
                      prompt: f.get("prompt"),
                      expectedEvidenceId: f.get("expectedEvidenceId"),
                      expectEscalation: f.get("escalation") === "on",
                      heldOut: true,
                    }),
                  "Question saved",
                );
              }}
            >
              <Field label="Client situation">
                <textarea name="prompt" required minLength={10} rows={5} />
              </Field>
              <Field label="Expected coaching rule">
                <select name="expectedEvidenceId" required>
                  <option value="">Select a confirmed rule</option>
                  {rules
                    .filter((r) => r.status === "confirmed")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.data.title}
                      </option>
                    ))}
                </select>
              </Field>
              <label className="check-field">
                <input type="checkbox" name="escalation" />
                This case must be escalated
              </label>
              <Button type="submit" disabled={busy}>
                Save practice question
              </Button>
            </form>
          </Card>
          <Card>
            <h2>Evaluation set</h2>
            {records("scenario").map((r) => (
              <div className="list-row" key={r.id}>
                <p>{r.data.prompt}</p>
                <Badge>Held out</Badge>
              </div>
            ))}
            <LoadMore
              more={more}
              collection="records"
              kind="scenario"
              label="Load older questions"
            />
            {!records("scenario").length && (
              <Empty
                title="No practice questions yet"
                detail="Vary experience, equipment, schedule and safety conditions to test where your method holds up."
              />
            )}
          </Card>
        </div>
      )}
      {tab === "releases" && (
        <div className="two-columns">
          <Card>
            <h2>Check your Brain before it goes live.</h2>
            <div className="readiness-row">
              <span>Confirmed coaching rules</span>
              <strong>
                {total(
                  state,
                  "confirmedRules",
                  rules.filter((r) => r.status === "confirmed").length,
                )}
              </strong>
            </div>
            <div className="readiness-row">
              <span>Practice questions</span>
              <strong>
                {kindTotal(state, "scenario", records("scenario").length)} / 20
                minimum
              </strong>
            </div>
            <div className="readiness-row">
              <span>Brain service (set up by us)</span>
              <Badge>
                {state.integrations.find((x) => x.id === "model")?.configured
                  ? "Configured"
                  : "Required"}
              </Badge>
            </div>
            <p className="muted">
              Passing the check lets your Brain start in “Waits for me” mode:
              you approve every reply before a client sees it.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void action(
                  () => api("/brain/evaluate", "POST", {}),
                  "Evaluation recorded",
                )
              }
            >
              Run evaluation <Activity size={16} />
            </Button>
          </Card>
          <div className="card-stack">
            {records("evaluation").map((e) => (
              <Card key={e.id}>
                <div className="card-heading">
                  <h3>
                    {e.data.passed} / {e.data.total} passed
                  </h3>
                  <Badge>{e.status}</Badge>
                </div>
                <p className="muted">
                  {new Date(e.created_at).toLocaleString()}
                </p>
                {e.status === "passed" && (
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          api("/brain/releases", "POST", {
                            evaluationId: e.id,
                            notes: "Trainer-approved supervised release",
                          }),
                        "Your Brain is live and waits for you",
                      )
                    }
                  >
                    Go live in “Waits for me” mode
                  </Button>
                )}
              </Card>
            ))}
            {records("brain_release").map((r) => (
              <Card key={r.id}>
                <h3>Brain version</h3>
                <Badge>{r.status}</Badge>
                <p>{r.data.notes}</p>
                <p className="muted">
                  Waits for me · {new Date(r.created_at).toLocaleString()}
                </p>
                {r.status === "archived" && (
                  <Button
                    secondary
                    onClick={() =>
                      void action(
                        () =>
                          api(`/brain/releases/${r.id}/rollback`, "POST", {}),
                        "Earlier version restored",
                      )
                    }
                  >
                    Go back to this version
                  </Button>
                )}
              </Card>
            ))}
            <LoadMore
              more={more}
              collection="records"
              kind="evaluation"
              label="Load older evaluations"
            />
            <LoadMore
              more={more}
              collection="records"
              kind="brain_release"
              label="Load older versions"
            />
          </div>
        </div>
      )}
    </>
  );
}
