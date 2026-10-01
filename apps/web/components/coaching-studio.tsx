"use client";
import { Field } from "./field";
import { useEffect, useState } from "react";
import { coachingActions } from "../../../packages/domain/src/coaching-completion";

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Request failed");
  return d;
}

const label = (value: string) => value.replaceAll("_", " ");
// Phrases are separated by a Latin or an Arabic comma.
const list = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[,\u060C]/)
    .map((s) => s.trim())
    .filter(Boolean);
const number = (f: FormData, key: string, fallback = 0) =>
  f.get(key) === null || f.get(key) === "" ? fallback : Number(f.get(key));
export function CoachingStudio({ path }: { path: string }) {
  const [data, setData] = useState<any>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [category, setCategory] = useState("message"),
    [type, setType] = useState("message"),
    [scenarioCategory, setScenarioCategory] = useState("routine"),
    [contextAction, setContextAction] = useState("");
  const mode = path.endsWith("/teaching")
    ? "teaching"
    : path.endsWith("/actions")
      ? "actions"
      : path.endsWith("/checks")
        ? "checks"
        : "autonomy";
  const load = async () => {
    const result = await api("/brain/coaching-workspace");
    setData(result);
    return result;
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(fn: () => Promise<any>, success: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const r = await fn();
      await load();
      setMessage(success);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const selected = data?.actions.find((a: any) => a.id === contextAction),
    evaluations =
      data?.rows.filter((r: any) => r.kind === "coaching_evaluation") ?? [],
    scenarios =
      data?.rows.filter((r: any) => r.kind === "coaching_scenario") ?? [],
    passing = evaluations.find(
      (e: any) =>
        e.status === "passed" && e.data.contractDigest === data?.digest,
    );
  const active = data?.active,
    qualified = active?.data.contractDigest === data?.digest;
  return (
    <>
      <div className="page-heading">
        <h1>Teach your coaching judgment</h1>
        <p className="muted">
          Explain how you handle real situations, then qualify the routine
          decisions your digital coach may make.
        </p>
      </div>
      <nav className="button-row" aria-label="Coaching knowledge sections">
        <a className="button secondary" href="/trainer/brain">
          Brain overview
        </a>
        {[
          ["teaching", "Teach with examples"],
          ["actions", "Routine actions"],
          ["checks", "Practice quiz"],
          ["autonomy", "How much my Brain does alone"],
          ["plans", "Plans"],
        ].map(([key, name]) => (
          <a
            className={mode === key ? "button" : "button secondary"}
            key={key}
            href={`/trainer/brain/${key}`}
          >
            {name}
          </a>
        ))}
      </nav>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!data && !error && <p>Loading your coaching workspace…</p>}
      {data && mode === "teaching" && (
        <>
          <section className="card">
            <h2>Your next teaching question</h2>
            <p>
              {data.questions.find((q: any) => q.type === category)?.question}
            </p>
            <p className="muted">
              Your answers become private, versioned examples for your coach.
              They do not train model weights. Add contrasting cases to teach
              when your judgment changes.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                void action(
                  () =>
                    api("/brain/teaching-cases", "POST", {
                      category,
                      scenario: f.get("scenario"),
                      recommendation: f.get("recommendation"),
                      reason: f.get("reason"),
                      alternatives: f.get("alternatives"),
                      changeWhen: f.get("changeWhen"),
                      escalateWhen: f.get("escalateWhen"),
                    }),
                  "Teaching case saved",
                );
              }}
            >
              <Field label="Coaching area">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {coachingActions.map((a) => (
                    <option key={a} value={a}>
                      {label(a)} (
                      {
                        data.cases.filter((c: any) => c.data.category === a)
                          .length
                      }{" "}
                      cases)
                    </option>
                  ))}
                </select>
              </Field>
              {[
                ["scenario", "Describe the situation", 10],
                ["recommendation", "What would you recommend?", 10],
                ["reason", "Why would you choose that approach?", 10],
                ["alternatives", "What alternatives would you offer?", 0],
                [
                  "changeWhen",
                  "What would make you change the recommendation?",
                  10,
                ],
                [
                  "escalateWhen",
                  "When should the digital coach refer the client to you?",
                  10,
                ],
              ].map(([key, title, min]) => (
                <Field key={String(key)} label={String(title)}>
                  <textarea
                    name={String(key)}
                    required={Number(min) > 0}
                    minLength={Number(min)}
                    maxLength={
                      key === "changeWhen" ||
                      key === "escalateWhen" ||
                      key === "alternatives"
                        ? 2000
                        : 3000
                    }
                    rows={3}
                  />
                </Field>
              ))}
              <button className="button" type="submit" disabled={busy}>
                Teach this case
              </button>
            </form>
          </section>
          <section className="card">
            <h2>Your teaching library</h2>
            <p className="muted">
              {data.cases.length} of 100 active teaching cases. Archive a case
              when you replace its guidance.
            </p>
            {!data.cases.length && <p>Answer your first case above.</p>}
            {data.cases.map((c: any) => (
              <details key={c.id} style={{ marginBlock: 16 }}>
                <summary>
                  {label(c.data.category)} · {c.data.scenario}
                </summary>
                <p>{c.data.recommendation}</p>
                <p className="muted">Because: {c.data.reason}</p>
                <p>Change when: {c.data.changeWhen}</p>
                <p>Escalate when: {c.data.escalateWhen}</p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      "Why is this teaching case being replaced?",
                    );
                    if (reason)
                      void action(
                        () =>
                          api(`/brain/teaching-cases/${c.id}/archive`, "POST", {
                            version: c.version,
                            reason,
                          }),
                        "Case archived; qualify again after updating your teaching",
                      );
                  }}
                >
                  Archive or replace this case
                </button>
              </details>
            ))}
          </section>
        </>
      )}
      {data && mode === "actions" && (
        <>
          <section className="card">
            <h2>Define a routine action</h2>
            <p className="muted">
              Use your own wording and your published rules. Automatic load
              changes require recent completed sets, recorded repetitions in
              reserve and the percentage limit you set. Uncertain or unsupported
              requests go to personal review.
            </p>
            {!data.brain && (
              <p className="notice">
                Go live from “Check my Brain” on the My Brain page first.
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                const body: any = {
                  title: f.get("title"),
                  type,
                  requestTerms: list(f.get("requestTerms")),
                  response: f.get("response"),
                  ...(String(f.get("responseAr") ?? "").trim()
                    ? { responseAr: f.get("responseAr") }
                    : {}),
                  rationale: f.get("rationale"),
                  evidenceIds: f.getAll("evidenceIds"),
                  experience: f.getAll("experience"),
                  requiredEquipment: list(f.get("equipment")),
                };
                if (["progression", "substitution"].includes(type))
                  body.exercise = f.get("exercise");
                if (type === "progression")
                  Object.assign(body, {
                    increaseKg: number(f, "increaseKg"),
                    maxIncreasePercent: number(f, "maxIncreasePercent"),
                    minimumRir: number(f, "minimumRir"),
                    minimumCompletedSets: number(f, "minimumCompletedSets"),
                  });
                if (type === "substitution")
                  body.replacement = {
                    name: f.get("replacement"),
                    sets: number(f, "sets"),
                    reps: number(f, "reps"),
                    loadKg: number(f, "loadKg"),
                    rir: number(f, "rir"),
                    restSeconds: number(f, "restSeconds"),
                    cue: f.get("cue"),
                    alternatives: [],
                  };
                if (type === "program_build")
                  body.templateId = f.get("templateId");
                if (type === "schedule")
                  body.daysOffset = number(f, "daysOffset");
                void action(
                  () => api("/brain/coaching-actions", "POST", body),
                  "Routine action confirmed; evaluate before automatic delivery",
                );
              }}
            >
              <div className="form-grid">
                <Field label="Action name">
                  <input name="title" required minLength={3} maxLength={150} />
                </Field>
                <Field label="Action type">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    {coachingActions.map((a) => (
                      <option value={a} key={a}>
                        {label(a)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Request phrases, separated by commas">
                <input
                  name="requestTerms"
                  required
                  placeholder="progress my squat, increase squat load"
                />
                <small>
                  The request must contain one of these phrases. The model must
                  still understand and match the client's intent. Add Arabic
                  phrases too if your clients write in Arabic.
                </small>
              </Field>
              <Field label="Your approved response">
                <textarea
                  name="response"
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={3}
                />
              </Field>
              <Field label="Arabic reply (optional)">
                <textarea
                  name="responseAr"
                  dir="rtl"
                  lang="ar"
                  minLength={10}
                  maxLength={4000}
                  rows={3}
                />
                <small>
                  Clients who write in Arabic receive this wording. Without it,
                  their requests become drafts in Arabic for your review.
                </small>
              </Field>
              <Field label="Why this action fits">
                <textarea
                  name="rationale"
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={2}
                />
              </Field>
              <fieldset>
                <legend>Appropriate experience levels</legend>
                {["beginner", "intermediate", "advanced"].map((v) => (
                  <label className="check-field" key={v}>
                    <input
                      type="checkbox"
                      name="experience"
                      value={v}
                      defaultChecked={v === "beginner"}
                    />
                    {v}
                  </label>
                ))}
              </fieldset>
              <Field label="Required equipment, separated by commas">
                <input name="equipment" placeholder="Dumbbells, bench" />
              </Field>
              <fieldset>
                <legend>Evidence from your published rules</legend>
                {data.rules.map((r: any) => (
                  <label className="check-field" key={r.id}>
                    <input type="checkbox" name="evidenceIds" value={r.id} />
                    {r.data.title}: {r.data.directive}
                  </label>
                ))}
              </fieldset>
              {["progression", "substitution"].includes(type) && (
                <Field label="Exact exercise name in the client's program">
                  <input name="exercise" minLength={2} required />
                </Field>
              )}
              {type === "progression" && (
                <div className="form-grid">
                  {[
                    ["increaseKg", "Load increment (kg)", 0.5, 10, 1],
                    ["maxIncreasePercent", "Maximum increase (%)", 1, 10, 5],
                    [
                      "minimumRir",
                      "Minimum recorded repetitions in reserve",
                      1,
                      10,
                      2,
                    ],
                    [
                      "minimumCompletedSets",
                      "Required recent completed sets",
                      2,
                      12,
                      3,
                    ],
                  ].map(([key, name, min, max, value]) => (
                    <Field key={String(key)} label={String(name)}>
                      <input
                        name={String(key)}
                        type="number"
                        min={Number(min)}
                        max={Number(max)}
                        defaultValue={Number(value)}
                        step={key === "increaseKg" ? 0.5 : 1}
                        required
                      />
                    </Field>
                  ))}
                </div>
              )}
              {type === "substitution" && (
                <>
                  <Field label="Approved replacement exercise">
                    <input name="replacement" minLength={2} required />
                  </Field>
                  <div className="form-grid">
                    {[
                      ["sets", "Sets", 3, 1, 10],
                      ["reps", "Repetitions", 10, 1, 100],
                      ["loadKg", "Load (kg)", 0, 0, 500],
                      ["rir", "Repetitions in reserve", 2, 0, 10],
                      ["restSeconds", "Rest (seconds)", 90, 0, 600],
                    ].map(([key, name, value, min, max]) => (
                      <Field key={String(key)} label={String(name)}>
                        <input
                          name={String(key)}
                          type="number"
                          min={Number(min)}
                          max={Number(max)}
                          defaultValue={Number(value)}
                          required
                        />
                      </Field>
                    ))}
                  </div>
                  <Field label="Replacement coaching cue">
                    <input name="cue" maxLength={1000} />
                  </Field>
                </>
              )}
              {type === "program_build" && (
                <Field label="Approved program template">
                  <select name="templateId" required>
                    <option value="">Choose a template</option>
                    {data.templates.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.data.title}
                      </option>
                    ))}
                  </select>
                  <small>
                    This action can start a plan only when the client has no
                    assigned program.
                  </small>
                </Field>
              )}
              {type === "schedule" && (
                <Field label="Postpone next session by">
                  <select name="daysOffset">
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n} day(s)
                      </option>
                    ))}
                  </select>
                  <small>
                    Existing sessions and the client's weekly training limit are
                    checked.
                  </small>
                </Field>
              )}
              <button
                className="button"
                disabled={busy || !data.brain}
                type="submit"
              >
                Confirm this routine action
              </button>
            </form>
          </section>
          <section className="card">
            <h2>Your confirmed actions</h2>
            {!data.actions.length && (
              <p>No automatic actions are defined yet.</p>
            )}
            {data.actions.map((a: any) => (
              <details key={a.id} style={{ marginBlock: 16 }}>
                <summary>
                  {a.data.title} · {label(a.data.type)}
                </summary>
                <p dir="auto">{a.data.response}</p>
                {a.data.responseAr && (
                  <p dir="rtl" lang="ar">
                    {a.data.responseAr}
                  </p>
                )}
                <p className="muted" dir="auto">
                  Request phrases: {a.data.requestTerms.join(", ")}
                </p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      "Why are you removing this action?",
                    );
                    if (reason)
                      void action(
                        () =>
                          api(
                            `/brain/coaching-actions/${a.id}/archive`,
                            "POST",
                            { version: a.version, reason },
                          ),
                        "Action archived; re-checking your changes before replies send automatically again",
                      );
                  }}
                >
                  Archive this action
                </button>
              </details>
            ))}
          </section>
        </>
      )}
      {data && mode === "checks" && (
        <>
          <section className="card">
            <h2>Independent coaching checks</h2>
            <p>
              Use at least 20 distinct situations that were not used as teaching
              examples: two routine cases for every enabled action, two closely
              related requests that should be refused, and one each for pain,
              urgent symptoms, pregnancy and self-harm. Numbered copies of the
              same question do not count.
            </p>
            <p className="muted">
              These are synthetic client cases for evaluating your digital
              coach. They remain separate from its teaching examples.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const f = new FormData(event.currentTarget),
                  actionData = selected?.data,
                  scenarioFacts: any = {
                    profile: {
                      experience: f.get("experience"),
                      daysPerWeek: number(f, "daysPerWeek", 3),
                      equipment: f.get("equipment"),
                      limitations: f.get("limitations"),
                    },
                    program: null,
                    sets: [],
                    nextSession: null,
                    occupiedDates: list(f.get("occupiedDates")),
                    currentDate: f.get("currentDate"),
                    activeWorkout: f.get("activeWorkout") === "on",
                    assignedProgramCount: 0,
                  };
                if (
                  ["progression", "substitution"].includes(actionData?.type)
                ) {
                  const exercise = {
                    name: actionData.exercise,
                    sets: number(f, "sets", 3),
                    reps: number(f, "reps", 10),
                    loadKg: number(f, "loadKg", 20),
                    restSeconds: 90,
                    rir: 2,
                  };
                  scenarioFacts.program = {
                    id: crypto.randomUUID(),
                    version: 1,
                    title: "Synthetic evaluation program",
                    daysPerWeek: scenarioFacts.profile.daysPerWeek,
                    exercises: [exercise],
                  };
                  scenarioFacts.assignedProgramCount = 1;
                  scenarioFacts.sets = Array.from(
                    { length: number(f, "loggedSets", 3) },
                    () => ({
                      id: crypto.randomUUID(),
                      exercise: exercise.name,
                      reps: number(f, "actualReps", 10),
                      loadKg: number(f, "actualLoad", 20),
                      rir: number(f, "actualRir", 2),
                      completed: true,
                    }),
                  );
                }
                if (actionData?.type === "schedule")
                  scenarioFacts.nextSession = {
                    id: crypto.randomUUID(),
                    version: 1,
                    date: f.get("nextDate"),
                  };
                void action(
                  () =>
                    api("/brain/coaching-scenarios", "POST", {
                      prompt: f.get("prompt"),
                      category: scenarioCategory,
                      expectedActionId:
                        scenarioCategory === "routine" ? contextAction : null,
                      facts: scenarioFacts,
                      heldOut: true,
                    }),
                  "Independent evaluation case saved",
                );
              }}
            >
              <div className="form-grid">
                <Field label="Case category">
                  <select
                    value={scenarioCategory}
                    onChange={(e) => setScenarioCategory(e.target.value)}
                  >
                    {[
                      "routine",
                      "unsupported",
                      "pain",
                      "urgent",
                      "pregnancy",
                      "self_harm",
                    ].map((c) => (
                      <option value={c} key={c}>
                        {label(c)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={
                    scenarioCategory === "routine"
                      ? "Expected routine action"
                      : "Related action for context (optional)"
                  }
                >
                  <select
                    value={contextAction}
                    required={scenarioCategory === "routine"}
                    onChange={(e) => setContextAction(e.target.value)}
                  >
                    <option value="">Personal review / no action</option>
                    {data.actions.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.data.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="What the client asks">
                <textarea
                  name="prompt"
                  required
                  minLength={10}
                  maxLength={3000}
                  rows={3}
                />
              </Field>
              <div className="form-grid">
                <Field label="Experience">
                  <select name="experience">
                    <option>beginner</option>
                    <option>intermediate</option>
                    <option>advanced</option>
                  </select>
                </Field>
                <Field label="Available training days each week">
                  <input
                    type="number"
                    name="daysPerWeek"
                    min={1}
                    max={7}
                    defaultValue={3}
                    required
                  />
                </Field>
                <Field label="Available equipment (comma separated)">
                  <input name="equipment" defaultValue="Dumbbells" />
                </Field>
                <Field label="Reported limitations">
                  <input
                    name="limitations"
                    defaultValue="None reported"
                    required
                  />
                </Field>
                <Field label="Current date in this case">
                  <input
                    type="date"
                    name="currentDate"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </Field>
              </div>
              <label className="check-field">
                <input type="checkbox" name="activeWorkout" />
                The client is in an active workout
              </label>
              {["progression", "substitution"].includes(
                selected?.data.type,
              ) && (
                <fieldset>
                  <legend>
                    Synthetic {selected.data.exercise} prescription and recent
                    performance
                  </legend>
                  <div className="form-grid">
                    {[
                      ["sets", "Prescribed sets", 3],
                      ["reps", "Prescribed repetitions", 10],
                      ["loadKg", "Prescribed load (kg)", 20],
                      ["loggedSets", "Recorded completed sets", 3],
                      ["actualReps", "Actual repetitions", 10],
                      ["actualLoad", "Actual load (kg)", 20],
                      ["actualRir", "Actual repetitions in reserve", 2],
                    ].map(([key, name, value]) => (
                      <Field key={String(key)} label={String(name)}>
                        <input
                          name={String(key)}
                          type="number"
                          min={0}
                          max={
                            key === "actualRir"
                              ? 10
                              : key === "loggedSets"
                                ? 50
                                : 500
                          }
                          defaultValue={Number(value)}
                          required
                        />
                      </Field>
                    ))}
                  </div>
                </fieldset>
              )}
              {selected?.data.type === "schedule" && (
                <Field label="Next planned session date">
                  <input type="date" name="nextDate" required />
                </Field>
              )}
              <Field label="Other planned dates, comma separated (YYYY-MM-DD)">
                <input name="occupiedDates" />
              </Field>
              <button className="button" type="submit" disabled={busy}>
                Save practice question
              </button>
            </form>
          </section>
          <section className="card">
            <h2>{scenarios.length} practice questions</h2>
            <p className="muted">
              Keep up to 100 active checks. Archive an obsolete case before
              adding a replacement; evaluate the current set before activating
              it.
            </p>
            {scenarios.map((s: any) => (
              <details key={s.id} style={{ marginBlock: 12 }}>
                <summary>
                  {label(s.data.category)} · {s.data.prompt}
                </summary>
                <p>
                  Expected:{" "}
                  {data.actions.find(
                    (a: any) => a.id === s.data.expectedActionId,
                  )?.data.title ?? "Human review"}
                </p>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      "Why are you replacing this practice question?",
                    );
                    if (reason)
                      void action(
                        () =>
                          api(
                            `/brain/coaching-scenarios/${s.id}/archive`,
                            "POST",
                            { version: s.version, reason },
                          ),
                        "Question archived. Run the practice quiz again before letting your Brain reply alone.",
                      );
                  }}
                >
                  Archive this practice question
                </button>
              </details>
            ))}
          </section>
        </>
      )}
      {data && mode === "autonomy" && (
        <>
          <section className="card">
            <h2>How much my Brain does alone</h2>
            <p className="notice">
              Current mode:{" "}
              {qualified
                ? label(active.data.mode)
                : active
                  ? "Re-checking your changes — replies wait for you"
                  : "Waits for me"}
            </p>
            {!qualified &&
              active?.data.pin?.promptVersion &&
              active.data.pin.promptVersion !== data.modelPin.promptVersion && (
                <p className="muted">
                  Your Brain was updated since its last practice quiz. Run the
                  quiz again, then choose how much it does alone.
                </p>
              )}
            <p>
              Your Brain picks among the actions you confirmed. Routine replies
              use your approved wording, and automatic checks cover plan
              changes, safety, consent, recent training and chats you are
              handling yourself. Anything else waits for you.
            </p>
            <p className="muted">
              The quiz result covers your current rules, examples, actions and
              programmes. After a change, your Brain is re-checked before it
              replies alone again.
            </p>
            <dl>
              <dt>Brain service</dt>
              {/* The model profile's label (for example Frontier model), never the model ID. */}
              <dd>
                {data.modelPin.model
                  ? (data.modelLabel ?? "Ready")
                  : "Being set up by us"}
              </dd>
              <dt>Teaching examples</dt>
              <dd>{data.cases.length}</dd>
              <dt>Confirmed actions</dt>
              <dd>{data.actions.length}</dd>
              <dt>Practice questions</dt>
              <dd>{scenarios.length}</dd>
            </dl>
            <button
              className="button"
              disabled={busy || !data.actions.length}
              onClick={() =>
                void action(
                  () => api("/brain/coaching-evaluate", "POST", {}),
                  "Quiz finished; check the results before you change anything",
                )
              }
            >
              {busy ? "Working…" : "Run the practice quiz"}
            </button>
            <p className="muted">
              Each quiz run counts toward your workspace&rsquo;s monthly usage.
            </p>
          </section>
          <section className="card">
            <h2>Quiz history</h2>
            {!evaluations.length && (
              <p>
                No quiz runs yet. Teach with examples, confirm actions and add
                practice questions.
              </p>
            )}
            {evaluations.map((e: any) => (
              <details key={e.id} style={{ marginBlock: 16 }}>
                <summary>
                  {new Date(e.created_at).toLocaleString()} · {e.data.passed}/
                  {e.data.total} passed · {e.status}
                </summary>
                {e.data.outcomes.map((o: any) => (
                  <p key={o.scenarioId} dir="auto">
                    {o.passed
                      ? "Passed"
                      : o.gate === "reply_language"
                        ? "Needs an Arabic reply on the matching action"
                        : "Needs work"}
                    :{" "}
                    {scenarios.find((s: any) => s.id === o.scenarioId)?.data
                      .prompt ?? "Stored scenario"}
                  </p>
                ))}
              </details>
            ))}
          </section>
          <section className="card">
            <h2>Choose how much it does alone</h2>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy || !passing}
                onClick={() =>
                  void action(
                    () =>
                      api("/brain/coaching-activate", "POST", {
                        evaluationId: passing.id,
                        mode: "shadow",
                        expectedReleaseId: active?.id ?? null,
                      }),
                    "Practice mode on: your Brain suggests, you decide every reply",
                  )
                }
              >
                Practice mode (it suggests, I decide)
              </button>
              <button
                className="button"
                disabled={busy || !passing}
                onClick={() =>
                  void action(
                    () =>
                      api("/brain/coaching-activate", "POST", {
                        evaluationId: passing.id,
                        mode: "automatic",
                        expectedReleaseId: active?.id ?? null,
                      }),
                    "Routine replies now send automatically",
                  )
                }
              >
                Sends automatically (routine replies)
              </button>
              {active && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () => api("/brain/coaching-disable", "POST", {}),
                      "Back to “Waits for me”: every reply waits for you",
                    )
                  }
                >
                  Waits for me
                </button>
              )}
            </div>
            <p className="muted">
              Safety reports and unsupported requests always go to personal
              review. You can take over an individual conversation at any time.
            </p>
          </section>
        </>
      )}
    </>
  );
}
