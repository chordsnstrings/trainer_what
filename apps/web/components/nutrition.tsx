"use client";
import { queuedLabel, queuedSummary } from "./pwa";
import {
  formatDate,
  formatDateRange,
  formatDuration,
  humanize,
} from "../lib/format";
import { Rich, useErrorText, useLocale, useT } from "../lib/i18n/react";
import { ScrollTabs, Skeleton, tabPanelProps } from "./phone-ui";
import { useArrivals } from "./motion";
import { Field } from "./field";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  nutritionPrinciples,
  principleForCategory,
} from "../../../packages/domain/src/nutrition-learning";
import { scaleCapturedPortion } from "../../../packages/domain/src/nutrition-completion";
import {
  nutritionQuestions,
  nutritionCategories,
  localDate,
} from "../../../packages/domain/src/nutrition";
import {
  discardRejected,
  drainNutritionQueue,
  entryOutcome,
  offlineQueueKeys,
  readList,
  retryRejected,
  type NutritionQueueItem,
  type RejectedEntry,
} from "./offline-queue";

async function api(
  path: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined
        ? headers
        : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
// Commas, Arabic commas included, separate the items.
const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,،]/)
    .map((s) => s.trim())
    .filter(Boolean);
const num = (f: FormData, key: string) => Number(f.get(key));

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice" role="status">
      {children}
    </p>
  );
}
function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card nutrition-card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
function useNutrition(path: string) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const t = useT("nutrition"),
    toError = useErrorText();
  const load = useCallback(async () => {
    const d = await api(path);
    setData(d);
    return d;
  }, [path]);
  useEffect(() => {
    void load().catch((e) => setError(toError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  async function action(fn: () => Promise<any>, success = t("saved")) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      await load();
      setMessage(result?.status === "exception" ? result.message : success);
      return result;
    } catch (e) {
      setError(toError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return {
    data,
    setData,
    error,
    setError,
    busy,
    message,
    setMessage,
    action,
    load,
    toError,
  };
}
const sections = [
  ["overview", "Overview"],
  ["cases", "Teach through cases"],
  ["learning", "Next teaching questions"],
  ["recipes", "Ingredients & recipes"],
  ["policy", "Diet & rules"],
  ["scenarios", "Case checks"],
  ["preview", "Sample week"],
  ["readiness", "Activation"],
  ["exceptions", "Exceptions"],
  ["recovery", "Week recovery"],
  ["versions", "Catalog versions"],
  ["methods", "Calorie methods"],
  ["clients", "Client plans"],
  ["purchases", "Grocery conversions"],
];
export function NutritionCoach({
  initialSection = "overview",
  role = "owner",
}: {
  initialSection?: string;
  role?: string;
}) {
  const r = useNutrition("/nutrition/coach"),
    [section, setSection] = useState(initialSection),
    [draftRecipe, setDraftRecipe] = useState<any>(null);
  const d = r.data;
  const submit = (url: string, body: any, message?: string) =>
    r.action(() => api("/nutrition" + url, "POST", body), message);
  if (!d) return <Notice>{r.error || "Loading nutrition workspace…"}</Notice>;
  const preview = d.records.find((x: any) => x.kind === "nutrition_preview"),
    evaluation = d.records.find((x: any) => x.kind === "nutrition_evaluation");
  const policyDraft = d.records.find(
      (x: any) => x.kind === "nutrition_policy" && x.status === "draft",
    ),
    canWrite = role === "owner";
  return (
    <div className="nutrition">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR APPROACH, EVERY DAY</p>
          <h1>Nutrition coaching</h1>
          <p>
            Teach your decisions once. Deliver useful meals, with your attention
            on the exceptions.
          </p>
        </div>
        <span className="badge">
          {d.ready
            ? "Ready for automatic delivery"
            : d.enabled
              ? "Setup in progress"
              : "Optional combined tier"}
        </span>
      </div>
      <nav className="tabs nutrition-tabs" aria-label="Nutrition workspace">
        {sections.map(([key, label]) => (
          <button
            key={key}
            className={section === key ? "selected" : ""}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {r.error && (
        <p className="notice error" role="alert">
          {r.error}
        </p>
      )}
      {r.message && <Notice>{r.message}</Notice>}
      {r.busy && (
        <Notice>Working… Your current saved data stays available.</Notice>
      )}
      {!canWrite && (
        <Notice>
          You can inspect nutrition and client exceptions. The coach owner
          manages teaching and release changes.
        </Notice>
      )}
      <fieldset disabled={r.busy || !canWrite} className="nutrition-fieldset">
        {section === "overview" && (
          <>
            <div className="two-columns">
              <Card title="Workout + nutrition">
                <p>
                  Offer daily meals, recipes, portions and cooking options, with
                  a consolidated grocery list each week. Workout-only
                  subscribers keep their existing access.
                </p>
                <button
                  className="button"
                  onClick={() =>
                    void r.action(
                      () =>
                        api("/nutrition/setup", "PUT", {
                          enabled: !d.enabled,
                          version: d.setup?.version ?? 0,
                        }),
                      d.enabled
                        ? "Nutrition disabled for new activity"
                        : "Nutrition setup enabled",
                    )
                  }
                >
                  {d.enabled
                    ? "Pause nutrition capability"
                    : "Add nutrition to my coaching"}
                </button>
                <p>
                  <Link href="/trainer/products">
                    Set the two subscription prices{" "}
                    <span className="bidi-mirror" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </p>
              </Card>
              <Card title="What still needs your input">
                {d.gaps.length ? (
                  <ul>
                    {d.gaps.map((g: string) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Your current teaching, ingredient facts, sample week and
                    case checks qualify automatic delivery.
                  </p>
                )}
                <p className="muted">
                  Readiness applies to the cases and limits you have taught. New
                  decisions outside them reach your exception queue.
                </p>
              </Card>
            </div>
            <div className="nutrition-coverage">
              {d.coverage.map((c: any) => (
                <button key={c.category} onClick={() => setSection("cases")}>
                  <span>{c.covered ? "✓" : "○"}</span>
                  {c.category}
                </button>
              ))}
            </div>
          </>
        )}
        {section === "learning" && <NutritionLearningView />}
        {section === "cases" && (
          <>
            <div className="two-columns">
              <Card title="How would you coach this client?">
                <CaseForm
                  next={d.coverage.find((c: any) => !c.covered)?.category}
                  onSubmit={(b) =>
                    submit(
                      "/cases",
                      b,
                      "Case saved. The next question targets a remaining gap.",
                    )
                  }
                />
              </Card>
              <Card title="Your teaching evidence">
                <p>
                  Explain the decision and what would change it. Similar
                  examples alone do not establish coverage of a new situation.
                </p>
                {d.cases.map((c: any) => (
                  <details key={c.id}>
                    <summary>
                      {c.data.category} · {c.data.scenario.slice(0, 100)}
                    </summary>
                    <p>{c.data.recommendation}</p>
                    <p>
                      <strong>Why:</strong> {c.data.reason}
                    </p>
                    <p>
                      <strong>Change when:</strong> {c.data.changeWhen}
                    </p>
                    <p>
                      <strong>Refer when:</strong> {c.data.referWhen}
                    </p>
                    <details>
                      <summary>Correct this case</summary>
                      <CaseForm
                        key={c.id}
                        initial={c.data}
                        onSubmit={(b) =>
                          r.action(
                            () =>
                              api("/nutrition/cases/" + c.id, "PATCH", {
                                version: c.version,
                                answer: b,
                              }),
                            "Correction saved; recheck the nutrition release before new automatic delivery.",
                          )
                        }
                      />
                    </details>
                  </details>
                ))}
              </Card>
            </div>
            <SourceForm
              sources={[
                ...d.sources,
                ...d.records.filter(
                  (x: any) =>
                    x.kind === "nutrition_source" && x.status === "extracted",
                ),
              ]}
              submit={submit}
            />
          </>
        )}
        {section === "recipes" && (
          <>
            <div className="two-columns">
              <Card title="Ingredient facts">
                <FoodForm submit={submit} />
              </Card>
              <Card title="Your ingredient library">
                {!d.foods.length && (
                  <p>
                    Add the food facts your recipes will use. Values may be
                    approximate; their source stays visible.
                  </p>
                )}
                {d.foods.map((f: any) => (
                  <details key={f.id}>
                    <summary>
                      {f.name} · {f.preparation.replaceAll("_", " ")}
                    </summary>
                    <p>
                      {f.nutrientsPer100g.kcal ?? "Unknown"} kcal per 100 g ·{" "}
                      {f.source}
                    </p>
                    <p>
                      Reported allergens:{" "}
                      {f.allergens.join(", ") || "None listed"}.{" "}
                      {f.allergenReviewComplete
                        ? "Ingredient review recorded."
                        : "Review incomplete."}
                    </p>
                  </details>
                ))}
              </Card>
            </div>
            <Card title="Draft a recipe from my ingredients">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void submit(
                    "/recipes/draft",
                    { request: f.get("request") },
                    "Recipe draft ready. Inspect ingredients and preparation before adding it to your library.",
                  ).then((x) => {
                    if (x?.recipe) setDraftRecipe(x.recipe);
                  });
                }}
              >
                <Field label="What would you like to cook?">
                  <textarea
                    name="request"
                    minLength={10}
                    maxLength={2000}
                    required
                    placeholder="A quick lunch using these ingredients, suitable for my usual diet…"
                  />
                </Field>
                <button className="button secondary">Draft with AI</button>
              </form>
            </Card>
            <RecipeForm
              key={JSON.stringify(draftRecipe)}
              initial={draftRecipe}
              foods={d.foods}
              submit={submit}
            />
            <Card title="Recipe library">
              {d.recipes.map((recipe: any) => (
                <details key={recipe.id}>
                  <summary>
                    {recipe.name} · {recipe.variants.length} cooking option(s)
                  </summary>
                  <p>{recipe.description}</p>
                  <p>
                    {recipe.dietTags.join(", ")} · {recipe.yieldServings}{" "}
                    servings
                  </p>
                  {recipe.variants.map((v: any) => (
                    <div key={v.key}>
                      <h3>
                        {v.name} · {v.minutes} min
                      </h3>
                      <ol>
                        {v.steps.map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </details>
              ))}
            </Card>
          </>
        )}
        {section === "policy" && (
          <>
            <Card title="Turn your cases into consistent rules">
              <p>
                AI extracts your approach and asks about missing information.
                You confirm these reusable rules during setup; routine client
                plans do not need individual approval.
              </p>
              <button
                className="button"
                onClick={() =>
                  void submit(
                    "/policy/compile",
                    {},
                    "Teaching compiled. Review the draft and its gaps.",
                  )
                }
              >
                Extract my diet and decision rules
              </button>
              {policyDraft && (
                <>
                  <h3>Latest draft</h3>
                  {[
                    ...(policyDraft.data.gaps ?? []),
                    ...(policyDraft.data.conflicts ?? []),
                  ].map((g: string, i: number) => (
                    <Notice key={i}>{g}</Notice>
                  ))}
                  {policyDraft.data.policy && (
                    <button
                      className="button secondary"
                      disabled={
                        !!policyDraft.data.gaps?.length ||
                        !!policyDraft.data.conflicts?.length
                      }
                      onClick={() =>
                        void submit(
                          "/policy/" + policyDraft.id + "/confirm",
                          {},
                          "Policy confirmed",
                        )
                      }
                    >
                      Confirm this draft
                    </button>
                  )}
                </>
              )}
            </Card>
            <PolicyForm
              key={policyDraft?.id ?? d.policy?.id ?? "new"}
              initial={policyDraft?.data.policy ?? d.policy?.data.policy}
              sourceIds={[...d.cases, ...d.sources].map((c: any) => c.id)}
              submit={submit}
            />
          </>
        )}
        {section === "scenarios" && (
          <>
            <Card title="Check unfamiliar client cases">
              <p>
                Use at least twenty different cases across the eight teaching
                categories. Specify the answer you expect before evaluation.
                Include at least eight worked meals across portions,
                substitutions, cooking and budget. Ingredient quantities,
                nutrient arithmetic, cited reasoning and independent safety
                cases are checked; expected answers are withheld from the model.
              </p>
              <ScenarioForm
                cases={d.cases}
                policy={d.policy?.data.policy}
                recipes={d.recipes}
                submit={submit}
              />
            </Card>
            <Card title="Held-out cases">
              <p>
                {
                  d.records.filter(
                    (x: any) =>
                      x.kind === "nutrition_scenario" &&
                      x.status === "held_out",
                  ).length
                }{" "}
                of {d.heldOutLimit ?? 40} cases saved. Every saved case is
                evaluated.
              </p>
              {d.staleScenarios?.length > 0 && (
                <p className="notice error" role="alert">
                  {d.staleScenarios.length} case(s) can no longer pass after
                  teaching, policy or recipe changes. Archive or replace them
                  before running the checks.
                </p>
              )}
              {d.records
                .filter(
                  (x: any) =>
                    x.kind === "nutrition_scenario" && x.status === "held_out",
                )
                .map((x: any) => (
                  <details key={x.id}>
                    <summary>
                      {x.data.category} · {x.data.prompt.slice(0, 100)}
                    </summary>
                    <p>
                      Expected: {x.data.expect} ·{" "}
                      {x.data.expectedTargetKcal ?? "No target"} kcal
                    </p>
                    <p>
                      Principle:{" "}
                      {(
                        x.data.expectedPrinciple ??
                        principleForCategory[x.data.category]
                      ).replaceAll("_", " ")}
                      .{" "}
                      {x.data.expectedMeal
                        ? `${x.data.expectedMeal.slot}, ${x.data.expectedMeal.minServings}–${x.data.expectedMeal.maxServings} servings; ${x.data.expectedMeal.recipeIds.length} acceptable recipe(s).`
                        : "No worked meal expectation saved."}
                    </p>
                    {d.staleScenarios
                      ?.find((s: any) => s.scenarioId === x.id)
                      ?.reasons.map((reason: string) => (
                        <p key={reason} className="notice error">
                          Needs replacing: {reason}
                        </p>
                      ))}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void r.action(
                          () =>
                            api(
                              `/nutrition/scenarios/${x.id}/archive`,
                              "POST",
                              { version: x.version, reason: f.get("reason") },
                            ),
                          "Held-out case archived. Re-evaluate before resuming automatic nutrition.",
                        );
                      }}
                    >
                      <Field label="Reason for retiring this check">
                        <input
                          name="reason"
                          minLength={10}
                          maxLength={1000}
                          required
                        />
                      </Field>
                      <button className="button secondary">
                        Archive this check
                      </button>
                    </form>
                  </details>
                ))}
              <button
                className="button"
                onClick={() =>
                  void submit("/evaluate", {}, "Evaluation recorded")
                }
              >
                Run nutrition case checks
              </button>
              {evaluation && (
                <p>
                  {evaluation.data.passed} / {evaluation.data.total} passed ·{" "}
                  {evaluation.status} · {evaluation.data.verificationMode}{" "}
                  evaluation
                </p>
              )}
              {evaluation?.data.outcomes
                ?.filter((o: any) => !o.passed)
                .map((o: any) => (
                  <p key={o.scenarioId} className="muted">
                    {o.system
                      ? "Safety check"
                      : (d.records
                          .find((x: any) => x.id === o.scenarioId)
                          ?.data.prompt.slice(0, 80) ?? o.scenarioId)}
                    : {o.meal?.passed ? "" : o.meal?.reason + ". "}
                    {o.rationale ? "" : "Cited rationale did not match. "}
                    {o.meal?.passed && o.rationale
                      ? "Action, calorie target or cited cases did not match."
                      : ""}
                  </p>
                ))}
            </Card>
          </>
        )}
        {section === "preview" && (
          <>
            <Card title="See a whole week before activation">
              <ProfileForm
                policy={d.policy?.data.policy}
                mode="preview"
                onSubmit={(b) =>
                  submit(
                    "/preview",
                    { profile: b.profile, weekStart: localDate("Asia/Dubai") },
                    "Sample week prepared",
                  )
                }
              />
            </Card>
            {preview && (
              <WeekView
                plan={{
                  id: preview.id,
                  status: "preview",
                  data: { view: preview.data.view },
                }}
              />
            )}
          </>
        )}
        {section === "readiness" && (
          <Card title="Activate your nutrition approach">
            <p>
              Activation allows routine plans and permitted swaps to be
              delivered automatically. Your teaching, configured model, sample
              week and case checks must match.
            </p>
            {d.gaps.map((g: string) => (
              <Notice key={g}>{g}</Notice>
            ))}
            <p>
              Latest case check:{" "}
              {evaluation
                ? `${evaluation.data.passed}/${evaluation.data.total} passed`
                : "Not run"}
              . Sample week: {preview ? "Available" : "Not generated"}.
            </p>
            <button
              className="button"
              disabled={!evaluation || !preview}
              onClick={() =>
                void submit(
                  "/releases",
                  {
                    evaluationId: evaluation.id,
                    previewId: preview.id,
                    confirmed: true,
                  },
                  "Nutrition release activated",
                )
              }
            >
              I have checked the sample week — activate
            </button>
            {d.release && (
              <p>
                <button
                  className="button secondary"
                  onClick={() =>
                    void submit(
                      "/releases/" + d.release.id + "/pause",
                      {},
                      "Automatic nutrition paused",
                    )
                  }
                >
                  Pause this nutrition release
                </button>
              </p>
            )}
            <p>
              <Link href="/trainer/onboarding/offer">
                Continue to subscription offers{" "}
                <span className="bidi-mirror" aria-hidden="true">
                  →
                </span>
              </Link>
            </p>
          </Card>
        )}
        {section === "purchases" && <NutritionPurchaseSpecs />}
        {section === "methods" && <NutritionMethods cases={d.cases} />}
        {section === "clients" && (
          <Card title="Individual nutrition plans">
            {d.members.map((m: any) => (
              <p key={m.id}>
                <Link href={"/trainer/nutrition/clients/" + m.id}>
                  {m.name}{" "}
                  <span className="bidi-mirror" aria-hidden="true">
                    →
                  </span>
                </Link>
              </p>
            ))}
          </Card>
        )}
        {section === "recovery" && <NutritionRecovery />}
        {section === "versions" && <NutritionVersions />}
        {section === "exceptions" && (
          <Card title="Decisions needing your attention">
            {!d.records.some(
              (x: any) =>
                x.kind === "nutrition_exception" && x.status === "open",
            ) && <p>No open nutrition exceptions.</p>}
            {d.records
              .filter((x: any) => x.kind === "nutrition_exception")
              .map((x: any) => (
                <details key={x.id} open={x.status === "open"}>
                  <summary>
                    {d.members.find((m: any) => m.id === x.owner_user_id)
                      ?.name ?? "Client"}{" "}
                    · {x.data.code.replaceAll("_", " ").toLowerCase()} ·{" "}
                    {x.status}
                  </summary>
                  <p>{x.data.message}</p>
                  <Link href={"/trainer/nutrition/clients/" + x.owner_user_id}>
                    Inspect client nutrition{" "}
                    <span className="bidi-mirror" aria-hidden="true">
                      →
                    </span>
                  </Link>
                  {x.status === "open" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void submit(
                          "/exceptions/" + x.id + "/resolve",
                          { resolution: f.get("resolution") },
                          "Exception resolved. Add a teaching case and re-evaluate to extend automatic coverage.",
                        );
                      }}
                    >
                      <Field label="Your decision and next action">
                        <textarea name="resolution" required minLength={10} />
                      </Field>
                      <button className="button secondary">
                        Record resolution
                      </button>
                    </form>
                  )}
                </details>
              ))}
          </Card>
        )}
      </fieldset>
    </div>
  );
}

function CaseForm({
  initial,
  next,
  onSubmit,
}: {
  initial?: any;
  next?: string;
  onSubmit: (b: any) => Promise<any>;
}) {
  const [category, setCategory] = useState(initial?.category ?? next ?? "diet");
  return (
    <form
      key={category}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSubmit({
          category,
          scenario: f.get("scenario"),
          recommendation: f.get("recommendation"),
          reason: f.get("reason"),
          alternatives: f.get("alternatives"),
          avoid: f.get("avoid"),
          changeWhen: f.get("changeWhen"),
          referWhen: f.get("referWhen"),
          rights: true,
          decision: {
            conditions: {
              goal: String(f.get("conditionGoal")).trim() || null,
              diet: String(f.get("conditionDiet")).trim() || null,
              budget: f.get("conditionBudget") || null,
              scope: f.get("conditionScope"),
              allergy: f.get("conditionAllergy"),
            },
            action: f.get("decisionAction"),
            targetKcal:
              f.get("decisionAction") === "plan" && f.get("decisionKcal") !== ""
                ? num(f, "decisionKcal")
                : null,
            minServings:
              f.get("decisionAction") === "plan" && f.get("minPortion") !== ""
                ? num(f, "minPortion")
                : null,
            maxServings:
              f.get("decisionAction") === "plan" && f.get("maxPortion") !== ""
                ? num(f, "maxPortion")
                : null,
            principle: f.get("principle"),
          },
        });
      }}
    >
      <Field label="Decision area">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {nutritionCategories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Client situation">
        <textarea
          name="scenario"
          rows={4}
          defaultValue={
            initial?.scenario ??
            nutritionQuestions[category as keyof typeof nutritionQuestions]
          }
          required
        />
      </Field>
      {[
        ["recommendation", "What would you recommend?", 4],
        ["reason", "Why this recommendation?", 2],
        ["alternatives", "Acceptable alternatives", 2],
        ["avoid", "What would you avoid?", 2],
        ["changeWhen", "What would change your answer?", 2],
        ["referWhen", "When should the system ask you or refer?", 2],
      ].map(([name, label, rows]) => (
        <Field key={name} label={String(label)}>
          <textarea
            name={String(name)}
            rows={Number(rows)}
            defaultValue={initial?.[name]}
            required={name !== "alternatives"}
          />
        </Field>
      ))}
      <details open>
        <summary>When this recommendation applies</summary>
        <div className="nutrition-form-grid">
          <Field label="Goal (blank means any goal)">
            <input
              name="conditionGoal"
              maxLength={100}
              defaultValue={initial?.decision?.conditions.goal ?? ""}
            />
          </Field>
          <Field label="Diet (blank means any diet)">
            <input
              name="conditionDiet"
              maxLength={80}
              defaultValue={initial?.decision?.conditions.diet ?? ""}
            />
          </Field>
          <Field label="Budget">
            <select
              name="conditionBudget"
              defaultValue={initial?.decision?.conditions.budget ?? ""}
            >
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="flexible">Flexible</option>
            </select>
          </Field>
          <Field label="Scope">
            <select
              name="conditionScope"
              defaultValue={
                initial?.decision?.conditions.scope ?? "general_wellness"
              }
            >
              <option value="general_wellness">General wellness</option>
              <option value="specialist_needed">Specialist needed</option>
              <option value="unknown">Needs clarification</option>
            </select>
          </Field>
          <Field label="Allergy information">
            <select
              name="conditionAllergy"
              defaultValue={initial?.decision?.conditions.allergy ?? "known"}
            >
              <option value="known">Confirmed information</option>
              <option value="unknown">Missing or uncertain</option>
            </select>
          </Field>
          <Field label="What the assistant should do">
            <select
              name="decisionAction"
              defaultValue={initial?.decision?.action ?? ""}
              required
            >
              <option value="">Choose an action</option>
              <option value="plan">Provide an in-scope plan</option>
              <option value="clarify">Ask for clarification</option>
              <option value="refer">Refer to the coach or specialist</option>
            </select>
          </Field>
          <Field label="Calorie value for this worked example (optional)">
            <input
              name="decisionKcal"
              type="number"
              min={1}
              max={10000}
              defaultValue={initial?.decision?.targetKcal ?? ""}
            />
          </Field>
          <Field label="Minimum example servings (optional)">
            <input
              name="minPortion"
              type="number"
              min={0.25}
              max={10}
              step={0.25}
              defaultValue={initial?.decision?.minServings ?? ""}
            />
          </Field>
          <Field label="Maximum example servings (optional)">
            <input
              name="maxPortion"
              type="number"
              min={0.25}
              max={10}
              step={0.25}
              defaultValue={initial?.decision?.maxServings ?? ""}
            />
          </Field>
          <Field label="Principle behind the decision">
            <select
              name="principle"
              defaultValue={
                initial?.decision?.principle ?? principleForCategory[category]
              }
            >
              {nutritionPrinciples.map((p) => (
                <option key={p} value={p}>
                  {p.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </details>
      <label className="check">
        <input type="checkbox" required /> This is my teaching material and
        contains no identifying client information.
      </label>
      <button className="button">Save my answer</button>
    </form>
  );
}
function SourceForm({
  sources,
  submit,
}: {
  sources: any[];
  submit: (p: string, b: any, m?: string) => Promise<any>;
}) {
  return (
    <Card title="Supporting diet material">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit("/sources", {
            title: f.get("title"),
            text: f.get("text"),
            rights: true,
          });
        }}
      >
        <Field label="Title">
          <input name="title" required minLength={2} />
        </Field>
        <Field label="Diet instructions or source notes">
          <textarea name="text" rows={5} minLength={10} required />
        </Field>
        <label className="check">
          <input type="checkbox" required /> I have permission to use this
          material.
        </label>
        <button className="button secondary">Save source text</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            file = f.get("document") as File;
          void file.arrayBuffer().then((buffer) => {
            let binary = "";
            for (const byte of new Uint8Array(buffer))
              binary += String.fromCharCode(byte);
            return submit(
              "/documents",
              {
                title: file.name,
                fileName: file.name,
                contentBase64: btoa(binary),
                rights: true,
              },
              "Document extracted. Read and confirm the extracted text.",
            );
          });
        }}
      >
        <Field label="Or upload a diet document (PDF, DOCX, text, CSV)">
          <input
            type="file"
            name="document"
            accept=".pdf,.docx,.txt,.md,.csv"
            required
          />
        </Field>
        <label className="check">
          <input type="checkbox" required /> I have permission to use this
          document.
        </label>
        <button className="button secondary">Extract document</button>
      </form>
      {sources.map((s) => (
        <details key={s.id}>
          <summary>
            {s.data.title} · {s.status}
          </summary>
          <p className="nutrition-source">{s.data.text}</p>
          {s.status === "extracted" && (
            <button
              className="button secondary"
              onClick={() =>
                void submit(
                  "/sources/" + s.id + "/confirm",
                  {},
                  "Source confirmed",
                )
              }
            >
              Confirm extracted material
            </button>
          )}
        </details>
      ))}
    </Card>
  );
}
function FoodForm({
  submit,
  initial,
}: {
  initial?: any;
  submit: (p: string, b: any, m?: string) => Promise<any>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const value = (n: string) => (f.get(n) === "" ? null : num(f, n));
        void submit(
          "/foods",
          {
            food: {
              name: f.get("name"),
              preparation: f.get("preparation"),
              nutrientsPer100g: {
                kcal: value("kcal"),
                protein: value("protein"),
                carbohydrate: value("carbohydrate"),
                fat: value("fat"),
              },
              allergens: list(f.get("allergens")),
              ingredientTags: list(f.get("tags")),
              allergenReviewComplete: f.get("reviewed") === "on",
              estimated: f.get("estimated") === "on",
              source: f.get("source"),
            },
          },
          "Ingredient version saved",
        );
      }}
    >
      <Field label="Ingredient name">
        <input name="name" defaultValue={initial?.name} required />
      </Field>
      <Field label="Weight basis">
        <select name="preparation" defaultValue={initial?.preparation}>
          <option value="raw">Raw edible weight</option>
          <option value="cooked">Cooked edible weight</option>
          <option value="ready_to_eat">Ready to eat</option>
        </select>
      </Field>
      <div className="nutrition-form-grid">
        {[
          ["kcal", "Calories per 100 g"],
          ["protein", "Protein g / 100 g"],
          ["carbohydrate", "Carbohydrate g / 100 g"],
          ["fat", "Fat g / 100 g"],
        ].map(([n, l]) => (
          <Field key={n} label={l}>
            <input
              type="number"
              name={n}
              defaultValue={initial?.nutrientsPer100g?.[n] ?? ""}
              min={0}
              step={0.01}
            />
          </Field>
        ))}
      </div>
      <p className="muted">
        Leave an unknown value blank. A recipe needs calorie estimates before
        automatic delivery.
      </p>
      <Field label="Allergens, separated by commas">
        <input
          name="allergens"
          defaultValue={initial?.allergens?.join(", ")}
          placeholder="milk, wheat, peanuts…"
        />
      </Field>
      <Field label="Ingredient names and families, separated by commas">
        <input
          name="tags"
          defaultValue={initial?.ingredientTags?.join(", ")}
          placeholder="rice, grain…"
        />
      </Field>
      <Field label="Label, reference or source of these facts">
        <input name="source" defaultValue={initial?.source} required />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          name="estimated"
          defaultChecked={initial?.estimated ?? true}
        />{" "}
        Values are approximate
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="reviewed"
          defaultChecked={initial?.allergenReviewComplete ?? false}
        />{" "}
        I have reviewed ingredient and allergen information
      </label>
      <button className="button">Save ingredient</button>
    </form>
  );
}
const blankOption = () => ({
  key: "standard",
  name: "Standard preparation",
  equipment: [],
  minutes: 20,
  steps: [""],
  ingredients: [{ foodId: "", grams: 100 }],
  storageNote: "",
});
function RecipeForm({
  initial,
  foods,
  submit,
}: {
  initial?: any;
  foods: any[];
  submit: (p: string, b: any, m?: string) => Promise<any>;
}) {
  const [options, setOptions] = useState<any[]>(
    initial?.variants ?? [blankOption()],
  );
  const change = (index: number, key: string, value: any) =>
    setOptions((v) =>
      v.map((o, i) => (i === index ? { ...o, [key]: value } : o)),
    );
  return (
    <Card
      title={initial ? "Review the recipe draft" : "Create a reusable recipe"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit(
            "/recipes",
            {
              recipe: {
                name: f.get("name"),
                description: f.get("description"),
                dietTags: list(f.get("diets")),
                slots: list(f.get("slots")),
                budget: f.get("budget"),
                yieldServings: num(f, "yield"),
                variants: options,
                source: f.get("source"),
              },
            },
            "Recipe saved with ingredient and cooking versions",
          );
        }}
      >
        <div className="nutrition-form-grid">
          <Field label="Recipe name">
            <input name="name" defaultValue={initial?.name} required />
          </Field>
          <Field label="Servings produced">
            <input
              type="number"
              name="yield"
              defaultValue={initial?.yieldServings ?? 1}
              min={0.25}
              step={0.25}
              required
            />
          </Field>
          <Field label="Suitable diets (comma separated)">
            <input
              name="diets"
              defaultValue={initial?.dietTags?.join(", ")}
              placeholder="balanced, vegetarian"
              required
            />
          </Field>
          <Field label="Meal slots (match your policy)">
            <input
              name="slots"
              defaultValue={initial?.slots?.join(", ")}
              placeholder="Breakfast, Lunch, Dinner"
              required
            />
          </Field>
          <Field label="Budget">
            <select name="budget" defaultValue={initial?.budget ?? "moderate"}>
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="flexible">Flexible</option>
            </select>
          </Field>
          <Field label="Recipe source">
            <input name="source" defaultValue={initial?.source} required />
          </Field>
        </div>
        <Field label="Description">
          <textarea name="description" defaultValue={initial?.description} />
        </Field>
        {options.map((v, i) => (
          <fieldset key={i} className="nutrition-option">
            <legend>Cooking option {i + 1}</legend>
            <div className="nutrition-form-grid">
              <Field label="Name">
                <input
                  value={v.name}
                  onChange={(e) => change(i, "name", e.target.value)}
                  required
                />
              </Field>
              <Field label="Minutes">
                <input
                  type="number"
                  min={1}
                  value={v.minutes}
                  onChange={(e) => change(i, "minutes", Number(e.target.value))}
                />
              </Field>
              <Field label="Equipment (comma separated)">
                <input
                  value={v.equipment.join(", ")}
                  onChange={(e) =>
                    change(
                      i,
                      "equipment",
                      e.target.value
                        .split(",")
                        .map((s) => s.trim().toLowerCase())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
            </div>
            {v.ingredients.map((ingredient: any, j: number) => (
              <div className="nutrition-ingredient" key={j}>
                <Field label="Ingredient">
                  <select
                    value={ingredient.foodId}
                    required
                    onChange={(e) =>
                      change(
                        i,
                        "ingredients",
                        v.ingredients.map((x: any, k: number) =>
                          j === k ? { ...x, foodId: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <option value="">Choose ingredient</option>
                    {foods.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.preparation})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Grams for full recipe">
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={ingredient.grams}
                    onChange={(e) =>
                      change(
                        i,
                        "ingredients",
                        v.ingredients.map((x: any, k: number) =>
                          j === k ? { ...x, grams: Number(e.target.value) } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="button secondary"
                  disabled={v.ingredients.length === 1}
                  onClick={() =>
                    change(
                      i,
                      "ingredients",
                      v.ingredients.filter((_: any, k: number) => j !== k),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                change(i, "ingredients", [
                  ...v.ingredients,
                  { foodId: "", grams: 100 },
                ])
              }
            >
              Add ingredient
            </button>
            <Field label="Preparation steps — one per line">
              <textarea
                rows={5}
                value={v.steps.join("\n")}
                onChange={(e) => change(i, "steps", e.target.value.split("\n"))}
                required
              />
            </Field>
            <Field label="Storage and batch preparation instructions">
              <textarea
                value={v.storageNote}
                onChange={(e) => change(i, "storageNote", e.target.value)}
              />
            </Field>
          </fieldset>
        ))}
        <p>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setOptions((v) => [
                ...v,
                {
                  ...blankOption(),
                  key: "option-" + (v.length + 1),
                  name: "Alternative preparation",
                },
              ])
            }
          >
            Add cooking option
          </button>
        </p>
        <label className="check">
          <input type="checkbox" required /> I have checked the ingredients,
          portions and preparation instructions.
        </label>
        <button className="button">Save recipe to my library</button>
      </form>
    </Card>
  );
}

function PolicyForm({
  initial,
  sourceIds,
  submit,
}: {
  initial?: any;
  sourceIds: string[];
  submit: (p: string, b: any, m?: string) => Promise<any>;
}) {
  const [targets, setTargets] = useState<any[]>(
    initial?.targets ?? [{ goal: "", kcal: "", reason: "" }],
  );
  return (
    <Card title="Review or enter your nutrition policy">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const policy = {
            title: f.get("title"),
            approach: f.get("approach"),
            supportedDiets: list(f.get("diets")),
            minAge: num(f, "minAge"),
            maxAge: num(f, "maxAge"),
            targets: targets.map((t) => ({ ...t, kcal: Number(t.kcal) })),
            minKcal: num(f, "minKcal"),
            maxKcal: num(f, "maxKcal"),
            tolerancePercent: num(f, "tolerance"),
            slots: list(f.get("slots")),
            minServings: num(f, "minServings"),
            maxServings: num(f, "maxServings"),
            maxRecipeRepeats: num(f, "repeats"),
            allowSwaps: f.get("swaps") === "on",
            forbiddenIngredients: list(f.get("forbidden")),
            adjustment: {
              enabled: f.get("adjust") === "on",
              trigger: f.get("trigger"),
              requiredCheckins: num(f, "checkins"),
              minimumDays: num(f, "days"),
              deltaKcal: num(f, "delta"),
              reason: f.get("adjustReason"),
            },
            boundaries: f.get("boundaries"),
            sourceIds,
          };
          void submit(
            "/policy",
            { policy, reason: f.get("reason") },
            "Policy draft saved. Confirm it above after review.",
          );
        }}
      >
        <Field label="Name of your approach">
          <input name="title" defaultValue={initial?.title} required />
        </Field>
        <Field label="Your diet approach and decision rules">
          <textarea
            name="approach"
            rows={4}
            defaultValue={initial?.approach}
            required
          />
        </Field>
        <div className="nutrition-form-grid">
          <Field label="Supported diets">
            <input
              name="diets"
              defaultValue={initial?.supportedDiets?.join(", ")}
              required
            />
          </Field>
          <Field label="Daily meal slots">
            <input
              name="slots"
              defaultValue={initial?.slots?.join(", ")}
              placeholder="Breakfast, Lunch, Dinner"
              required
            />
          </Field>
          {[
            ["minAge", "Minimum client age", initial?.minAge ?? 18],
            ["maxAge", "Maximum client age", initial?.maxAge ?? 100],
            ["minKcal", "Lowest permitted daily kcal", initial?.minKcal],
            ["maxKcal", "Highest permitted daily kcal", initial?.maxKcal],
            [
              "tolerance",
              "Daily calorie tolerance (%)",
              initial?.tolerancePercent,
            ],
            [
              "minServings",
              "Smallest allowed recipe serving",
              initial?.minServings,
            ],
            [
              "maxServings",
              "Largest allowed recipe serving",
              initial?.maxServings,
            ],
            [
              "repeats",
              "Maximum uses of one recipe per week",
              initial?.maxRecipeRepeats,
            ],
          ].map(([n, l, v]) => (
            <Field key={String(n)} label={String(l)}>
              <input
                name={String(n)}
                type="number"
                step={n === "minServings" || n === "maxServings" ? 0.25 : 1}
                min={0}
                defaultValue={v ?? ""}
                required
              />
            </Field>
          ))}
        </div>
        <h3>Explicit calorie targets by client goal</h3>
        <p className="muted">
          These targets apply only inside the audience and limits you define. A
          new goal needs a new rule.
        </p>
        {targets.map((t, i) => (
          <div className="nutrition-form-grid" key={i}>
            {[
              ["goal", "Client goal"],
              ["kcal", "Approximate daily kcal"],
              ["reason", "Why this target applies"],
            ].map(([k, l]) => (
              <Field key={k} label={l}>
                <input
                  type={k === "kcal" ? "number" : "text"}
                  value={t[k]}
                  required
                  onChange={(e) =>
                    setTargets((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, [k]: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
            ))}
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            setTargets((v) => [...v, { goal: "", kcal: "", reason: "" }])
          }
        >
          Add goal
        </button>
        <Field label="Forbidden ingredients or ingredient families">
          <input
            name="forbidden"
            defaultValue={initial?.forbiddenIngredients?.join(", ")}
          />
        </Field>
        <label className="check">
          <input
            name="swaps"
            type="checkbox"
            defaultChecked={initial?.allowSwaps}
          />{" "}
          Permit automatic swaps that pass all my rules
        </label>
        <details>
          <summary>Progress-based changes</summary>
          <label className="check">
            <input
              name="adjust"
              type="checkbox"
              defaultChecked={initial?.adjustment?.enabled}
            />{" "}
            Allow the following automatic adjustment
          </label>
          <Field label="Trigger">
            <select
              name="trigger"
              defaultValue={initial?.adjustment?.trigger ?? "hunger_high"}
            >
              <option value="hunger_high">Hunger rated 4–5 out of 5</option>
              <option value="difficulty_low">
                Difficulty rated 1–2 out of 5
              </option>
            </select>
          </Field>
          <div className="nutrition-form-grid">
            {[
              [
                "checkins",
                "Different-day check-ins required",
                initial?.adjustment?.requiredCheckins ?? 2,
              ],
              [
                "days",
                "Minimum days between adjustments and across check-ins",
                initial?.adjustment?.minimumDays ?? 7,
              ],
              [
                "delta",
                "Calorie change (negative reduces target)",
                initial?.adjustment?.deltaKcal ?? 0,
              ],
            ].map(([n, l, v]) => (
              <Field key={n} label={String(l)}>
                <input name={String(n)} type="number" defaultValue={v} />
              </Field>
            ))}
          </div>
          <Field label="Why this adjustment is permitted">
            <textarea
              name="adjustReason"
              defaultValue={
                initial?.adjustment?.reason ??
                "Automatic target adjustment is disabled unless expressly enabled above."
              }
              required
            />
          </Field>
        </details>
        <Field label="Limits and situations that need you">
          <textarea
            name="boundaries"
            defaultValue={initial?.boundaries}
            required
          />
        </Field>
        <Field label="Reason for this policy or correction">
          <input name="reason" required minLength={5} />
        </Field>
        <button className="button">Save policy draft</button>
      </form>
    </Card>
  );
}

export function ProfileForm({
  initial,
  policy,
  mode = "client",
  onSubmit,
}: {
  initial?: any;
  policy?: any;
  mode?: "client" | "preview" | "scenario";
  onSubmit: (b: any) => Promise<any>;
}) {
  const t = useT("nutrition");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSubmit({
          profile: {
            age: num(f, "age"),
            goal: f.get("goal"),
            diet: f.get("diet"),
            allergyStatus: f.get("allergyStatus"),
            allergens: list(f.get("allergens")),
            exclusions: list(f.get("exclusions")),
            equipment: list(f.get("equipment")),
            maxMinutes: num(f, "minutes"),
            budget: f.get("budget"),
            scopeStatus: f.get("scope"),
            timezone: f.get("timezone"),
            notes: f.get("notes"),
          },
          processingConsent: true,
          modelConsent: f.get("ai") === "on",
        });
      }}
    >
      <div className="nutrition-form-grid">
        <Field label={t("age")}>
          <input
            name="age"
            type="number"
            min={18}
            max={100}
            defaultValue={initial?.age}
            required
          />
        </Field>
        <Field label={t("goal")}>
          <input
            name="goal"
            defaultValue={initial?.goal}
            list="nutrition-goals"
            required
          />
          <datalist id="nutrition-goals">
            {policy?.targets?.map((t: any) => (
              <option value={t.goal} key={t.goal} />
            ))}
          </datalist>
        </Field>
        <Field label={t("diet")}>
          <input
            name="diet"
            defaultValue={initial?.diet}
            required
            placeholder={t("dietPlaceholder")}
          />
        </Field>
        <Field label={t("allergy")}>
          <select
            name="allergyStatus"
            defaultValue={initial?.allergyStatus ?? "unknown"}
          >
            <option value="unknown">{t("allergy_unknown")}</option>
            <option value="none_reported">{t("allergy_none")}</option>
            <option value="reported">{t("allergy_reported")}</option>
            <option value="declined">{t("allergy_declined")}</option>
          </select>
        </Field>
        <Field label={t("allergensField")}>
          <input
            name="allergens"
            defaultValue={initial?.allergens?.join(", ")}
          />
        </Field>
        <Field label={t("exclusions")}>
          <input
            name="exclusions"
            defaultValue={initial?.exclusions?.join(", ")}
          />
        </Field>
        <Field label={t("equipment")}>
          <input
            name="equipment"
            defaultValue={initial?.equipment?.join(", ")}
            placeholder={t("equipmentPlaceholder")}
          />
        </Field>
        <Field label={t("maxMinutes")}>
          <input
            name="minutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={initial?.maxMinutes ?? 30}
            required
          />
        </Field>
        <Field label={t("budget")}>
          <select name="budget" defaultValue={initial?.budget ?? "moderate"}>
            <option value="low">{t("budget_low")}</option>
            <option value="moderate">{t("budget_moderate")}</option>
            <option value="flexible">{t("budget_flexible")}</option>
          </select>
        </Field>
        <Field label={t("scope")}>
          <select name="scope" defaultValue={initial?.scopeStatus ?? "unknown"}>
            <option value="unknown">{t("scope_unknown")}</option>
            <option value="general_wellness">{t("scope_general")}</option>
            <option value="specialist_needed">{t("scope_specialist")}</option>
          </select>
        </Field>
        <Field label={t("timezone")}>
          <input
            name="timezone"
            defaultValue={initial?.timezone ?? "Asia/Dubai"}
            required
          />
        </Field>
      </div>
      <Field label={t("notes")}>
        <textarea name="notes" defaultValue={initial?.notes} />
      </Field>
      {mode === "client" && (
        <>
          <label className="check">
            <input type="checkbox" required /> {t("processingConsent")}
          </label>
          <label className="check">
            <input type="checkbox" name="ai" /> {t("aiConsent")}
          </label>
        </>
      )}
      <button className="button">
        {mode === "preview"
          ? t("prepareSample")
          : mode === "scenario"
            ? t("saveHeldOut")
            : t("saveProfile")}
      </button>
    </form>
  );
}
function ScenarioForm({
  cases,
  policy,
  recipes,
  submit,
}: {
  cases: any[];
  policy: any;
  recipes: any[];
  submit: (p: string, b: any, m?: string) => Promise<any>;
}) {
  const [prompt, setPrompt] = useState(""),
    [category, setCategory] = useState("diet"),
    [expect, setExpect] = useState("plan"),
    [target, setTarget] = useState(""),
    [caseId, setCaseId] = useState(cases[0]?.id ?? ""),
    [mealSlot, setMealSlot] = useState(policy?.slots?.[0] ?? "Breakfast"),
    [recipeIds, setRecipeIds] = useState<string[]>([]),
    [minServings, setMinServings] = useState(1),
    [maxServings, setMaxServings] = useState(1),
    [principle, setPrinciple] = useState<string>("diet_match");
  return (
    <>
      <div className="nutrition-form-grid">
        <Field label="Decision area">
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPrinciple(principleForCategory[e.target.value]);
            }}
          >
            {nutritionCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Teaching case it should apply">
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.data.category} · {c.data.scenario.slice(0, 55)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected action">
          <select value={expect} onChange={(e) => setExpect(e.target.value)}>
            <option value="plan">Apply the coach's plan</option>
            <option value="exception">Ask or escalate</option>
          </select>
        </Field>
        <Field label="Expected daily kcal (blank for exception)">
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
      </div>
      <Field label="A new client situation">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field label="Expected reasoning principle">
        <select
          value={principle}
          onChange={(e) => setPrinciple(e.target.value)}
        >
          {nutritionPrinciples.map((p) => (
            <option key={p} value={p}>
              {p.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </Field>
      {expect === "plan" && (
        <fieldset>
          <legend>Held-out worked meal expectation</legend>
          <p>
            The model sees the requested meal slot. Your acceptable recipes and
            portion range remain hidden during evaluation.
          </p>
          <Field label="Meal slot">
            <select
              value={mealSlot}
              onChange={(e) => {
                setMealSlot(e.target.value);
                setRecipeIds([]);
              }}
            >
              {policy?.slots.map((slot: string) => (
                <option key={slot}>{slot}</option>
              ))}
            </select>
          </Field>
          {recipes
            .filter((r) => r.slots.includes(mealSlot))
            .map((r) => (
              <label className="check" key={r.id}>
                <input
                  type="checkbox"
                  checked={recipeIds.includes(r.id)}
                  onChange={(e) =>
                    setRecipeIds((old) =>
                      e.target.checked
                        ? [...old, r.id]
                        : old.filter((id) => id !== r.id),
                    )
                  }
                />
                {r.name}
              </label>
            ))}
          <div className="nutrition-form-grid">
            <Field label="Minimum acceptable servings">
              <input
                type="number"
                min={0.25}
                max={10}
                step={0.25}
                value={minServings}
                onChange={(e) => setMinServings(Number(e.target.value))}
              />
            </Field>
            <Field label="Maximum acceptable servings">
              <input
                type="number"
                min={0.25}
                max={10}
                step={0.25}
                value={maxServings}
                onChange={(e) => setMaxServings(Number(e.target.value))}
              />
            </Field>
          </div>
        </fieldset>
      )}
      <ProfileForm
        policy={policy}
        mode="scenario"
        onSubmit={(b) =>
          submit(
            "/scenarios",
            {
              category,
              prompt,
              profile: b.profile,
              expect,
              expectedTargetKcal: target ? Number(target) : null,
              expectedCaseId: caseId,
              heldOut: true,
              expectedPrinciple: principle,
              ...(expect === "plan"
                ? {
                    expectedMeal: {
                      slot: mealSlot,
                      recipeIds,
                      minServings,
                      maxServings,
                    },
                  }
                : {}),
            },
            "Held-out case saved",
          )
        }
      />
    </>
  );
}

export function WeekView({
  plan,
  onLog,
  onSwap,
}: {
  plan: any;
  onLog?: (day: any, meal: any) => void;
  onSwap?: (day: any, meal: any) => void;
}) {
  const view = plan.data.view;
  const [date, setDate] = useState(view.days[0]?.date);
  const day = view.days.find((d: any) => d.date === date) ?? view.days[0];
  const t = useT("nutrition"),
    locale = useLocale();
  const unknown = t("unknownValue");
  return (
    <Card title={t("weekTitle")}>
      <div className="nutrition-week-heading">
        <p>{formatDateRange(view.weekStart, view.weekEnd, { locale })}</p>
        <span className="badge">
          {t("approxDay", { kcal: view.targetKcal })}
        </span>
      </div>
      <p>{view.explanation}</p>
      <nav className="nutrition-days" aria-label={t("daysLabel")}>
        {view.days.map((d: any) => (
          <button
            key={d.date}
            className={date === d.date ? "selected" : ""}
            onClick={() => setDate(d.date)}
          >
            <span>{weekdayShort(d.date, locale)}</span>
            {formatDate(d.date, { locale, year: false })}
          </button>
        ))}
      </nav>
      {day && (
        <>
          <div className="nutrition-day-total">
            <strong>{formatDate(day.date, { locale, weekday: true })}</strong>
            <span>
              {t("dayTotals", {
                kcal: day.totals.kcal,
                protein: day.totals.protein ?? unknown,
                carbohydrate: day.totals.carbohydrate ?? unknown,
                fat: day.totals.fat ?? unknown,
              })}
            </span>
          </div>
          <div className="nutrition-meals">
            {day.meals.map((m: any) => (
              <article className="nutrition-meal" key={m.slot}>
                <p className="eyebrow">
                  {t.dynamic(`slot_${String(m.slot).toLowerCase()}`, m.slot)}
                </p>
                <h3>{m.name}</h3>
                <p>
                  {t("servingsLine", {
                    count: Number(m.servings),
                    kcal: m.nutrients.kcal,
                  })}
                </p>
                <p className="muted">
                  {m.cookingName} · {formatDuration(m.minutes, locale)} ·{" "}
                  {m.equipment.join(locale === "ar" ? "، " : ", ") ||
                    t("noEquipment")}
                </p>
                <details>
                  <summary>{t("ingredientsTitle")}</summary>
                  <ul>
                    {m.ingredients.map((i: any) => (
                      <li key={i.food.id}>
                        {t("ingredientLine", {
                          grams: i.grams,
                          food: i.food.name,
                          preparation: t.dynamic(
                            `prep_${i.food.preparation}`,
                            humanize(i.food.preparation).toLowerCase(),
                          ),
                        })}
                      </li>
                    ))}
                  </ul>
                  <ol>
                    {m.steps.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {m.storageNote && <p>{m.storageNote}</p>}
                  {m.batchKey && (
                    <p>{t("batch", { batch: m.batchKey })}</p>
                  )}
                  <p className="muted">
                    {t("recipeSource", { source: m.source })}
                  </p>
                </details>
                <div className="nutrition-actions">
                  {onLog && (
                    <button
                      className="button secondary"
                      onClick={() => onLog(day, m)}
                    >
                      {t("logMeal")}
                    </button>
                  )}
                  {onSwap && (
                    <button
                      className="button secondary"
                      onClick={() => onSwap(day, m)}
                    >
                      {t("changeMeal")}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <p className="muted">{t("estimates")}</p>
    </Card>
  );
}
/** "Mon" / "الاثنين" for a calendar date. */
function weekdayShort(date: string, locale: "en" | "ar") {
  return new Date(date + "T12:00:00Z").toLocaleDateString(
    locale === "ar" ? "ar-AE" : "en",
    { weekday: locale === "ar" ? "long" : "short", timeZone: "UTC" },
  );
}

export function NutritionSubscriber({
  userId,
  tenantId,
  coachView = false,
}: {
  userId: string;
  tenantId: string;
  coachView?: boolean;
}) {
  const r = useNutrition(
      coachView ? "/nutrition?userId=" + userId : "/nutrition",
    ),
    [tab, setTab] = useState("today"),
    [selectedPlan, setSelectedPlan] = useState(""),
    [swap, setSwap] = useState<any>(null),
    [options, setOptions] = useState<any>(null),
    [offline, setOffline] = useState(false),
    [queued, setQueued] = useState<any[]>([]),
    [rejected, setRejected] = useState<RejectedEntry<NutritionQueueItem>[]>([]),
    [cache, setCache] = useState(false);
  const t = useT("nutrition"),
    locale = useLocale();
  const toError = r.toError;
  const key = "trainer:nutrition:" + tenantId + ":" + userId,
    keys = offlineQueueKeys("nutrition", tenantId, userId),
    queueKey = keys.pending;
  const refreshQueue = () => {
    setQueued(readList(localStorage, queueKey));
    setRejected(readList(localStorage, keys.rejected));
  };
  // Consent withdrawal or lost access removes local nutrition data, and says
  // how many unsynced entries that discarded.
  const clearDevice = () => {
    const removed =
      readList(localStorage, queueKey).length +
      readList(localStorage, keys.rejected).length;
    localStorage.removeItem(key);
    localStorage.removeItem(queueKey);
    localStorage.removeItem(keys.rejected);
    setQueued([]);
    setRejected([]);
    setCache(false);
    return removed;
  };
  const removedText = (removed: number) =>
    removed ? t("removedEntries", { count: removed }) : "";
  useEffect(() => {
    setOffline(!navigator.onLine);
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    try {
      refreshQueue();
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      setCache(!!saved);
      if (!navigator.onLine && saved?.expires > Date.now())
        r.setData(saved.data);
    } catch {}
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [key, queueKey]);
  useEffect(() => {
    if (!r.data) return;
    if (!r.data.processingConsent) {
      const removed = clearDevice();
      if (removed)
        r.setError(t("permissionOff") + removedText(removed));
    } else if (cache && !coachView && !offline && navigator.onLine) {
      const data = {
        ...r.data,
        profile: r.data.profile
          ? {
              ...r.data.profile,
              data: {
                profile: { timezone: r.data.profile.data.profile.timezone },
              },
            }
          : null,
        records: r.data.records
          .filter((x: any) => x.kind === "nutrition_plan")
          .slice(0, 1),
        exceptions: [],
      };
      localStorage.setItem(
        key,
        JSON.stringify({ expires: Date.now() + 12 * 3600000, data }),
      );
    }
  }, [r.data, cache, key, queueKey, coachView, offline]);
  async function sync() {
    r.setError("");
    if (!navigator.onLine) return null;
    if (coachView) {
      // A coach views the member's diary; only the member's device replays it.
      await r.load();
      return null;
    }
    const result = await drainNutritionQueue(
      localStorage,
      tenantId,
      userId,
      (path, body, headers) => api(path, "POST", body, headers),
    );
    refreshQueue();
    const stop = result.stopped?.reason;
    if (stop === "blocked") {
      const removed = clearDevice();
      r.setError(t("syncBlocked") + removedText(removed));
    } else if (stop === "session") r.setError(t("sessionEnded"));
    else if (stop) r.setError(toError(result.stopped!.failure));
    else if (result.rejected.length) r.setError(t("entryRejected"));
    // A failed reload must not hide what the replay did to the queue.
    if (stop !== "session")
      await r.load().catch((e) => {
        if (!stop) r.setError(toError(e));
      });
    return result;
  }
  useEffect(() => {
    if (!offline && navigator.onLine)
      void sync().catch((e) => r.setError(toError(e)));
  }, [offline, queueKey]);
  async function queue(body: any) {
    const entries = readList<NutritionQueueItem>(localStorage, queueKey);
    if (
      body.correctsId &&
      entries.some((e) => e.correctsId === body.correctsId)
    ) {
      r.setError(t("correctionWaiting"));
      return;
    }
    localStorage.setItem(queueKey, JSON.stringify([...entries, body]));
    refreshQueue();
    r.setMessage("");
    const result = navigator.onLine
      ? await sync().catch((e) => {
          r.setError(toError(e));
          return null;
        })
      : null;
    // Only an accepted entry is reported as recorded. An entry removed because
    // access changed is reported by the error that sync set.
    const outcome = entryOutcome<NutritionQueueItem>(
      localStorage,
      keys,
      body.eventKey,
      (e) => e.eventKey,
      result,
    );
    if (outcome === "pending")
      r.setMessage(t("queuedOnline", { queued: queuedLabel(locale) }));
    else if (outcome === "accepted") r.setMessage(t("mealRecorded"));
  }
  async function syncNow() {
    r.setMessage("");
    const result = await sync().catch((e) => {
      r.setError(toError(e));
      return null;
    });
    if (result && !result.stopped && !result.rejected.length)
      r.setMessage(t("diarySynced"));
  }
  function retryEntry(entry: RejectedEntry<NutritionQueueItem>, zone: string) {
    // A diary date is checked in the profile time zone; a retry after a zone
    // change is a new diary event in the current zone.
    retryRejected<NutritionQueueItem>(
      localStorage,
      keys,
      entry.item.eventKey,
      (item) => item.eventKey,
      (item) =>
        entry.failure.code === "LOG_DATE" && item.timezone !== zone
          ? { ...item, eventKey: crypto.randomUUID(), timezone: zone }
          : item,
    );
    refreshQueue();
    void sync().catch((e) => r.setError(toError(e)));
  }
  function discardEntry(entry: RejectedEntry<NutritionQueueItem>) {
    if (!window.confirm(t("discardConfirm"))) return;
    discardRejected<NutritionQueueItem>(
      localStorage,
      keys,
      entry.item.eventKey,
      (item) => item.eventKey,
    );
    refreshQueue();
  }
  // A meal logged while this screen is open slides into the diary.
  const freshLogs = useArrivals(
    (r.data?.records ?? [])
      .filter((x: any) => x.kind === "nutrition_log")
      .map((x: any) => x.id),
    !!r.data,
  );
  const d = r.data;
  if (!d)
    return r.error ? (
      <Notice>{r.error}</Notice>
    ) : (
      <Skeleton label={t("loading")} lines={4} block />
    );
  const plan =
      d.records.find(
        (x: any) => x.kind === "nutrition_plan" && x.id === selectedPlan,
      ) ??
      d.records.find(
        (x: any) =>
          x.kind === "nutrition_plan" &&
          x.status === "delivered" &&
          x.data.view.days.some((day: any) => day.date === d.today),
      ) ??
      d.records.find(
        (x: any) => x.kind === "nutrition_plan" && x.status === "delivered",
      ) ??
      d.records.find((x: any) => x.kind === "nutrition_plan"),
    profile = d.profile?.data.profile;
  // A withdrawn food or recipe pauses current weeks until they are rechecked.
  const catalogRecheck =
    plan?.status === "needs_recheck" &&
    d.exceptions.some((e: any) => e.code === "CATALOG_RETIRED");
  const permitted = d.entitled && d.processingConsent && !coachView && !offline;
  const addMeal = (day: any, m: any) =>
    void queue({
      eventKey: crypto.randomUUID(),
      date: day.date,
      timezone: profile?.timezone ?? "Asia/Dubai",
      name: m.name,
      notes: "",
      kcal: m.nutrients.kcal,
      planId: plan.id,
      slot: m.slot,
      deleted: false,
    });
  return (
    <div className="nutrition">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
        </div>
        <span className="badge">
          {d.entitled ? t("badgeEntitled") : t("badgeRequired")}
        </span>
      </div>
      {/* One row that scrolls sideways on phones instead of wrapping. */}
      <ScrollTabs
        label={t("tabsLabel")}
        idPrefix="nutrition"
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: "today", label: t("tab_today") },
          { id: "groceries", label: t("tab_groceries") },
          { id: "profile", label: t("tab_profile") },
          { id: "diary", label: t("tab_diary") },
          { id: "checkin", label: t("tab_checkin") },
        ]}
      />
      {r.error && (
        <p className="notice error" role="alert">
          {r.error}
        </p>
      )}
      {r.message && <Notice>{r.message}</Notice>}
      {offline && (
        <Notice>{t("offline")}</Notice>
      )}
      {queued.length > 0 && (
        <Notice>
          {queuedSummary(queued.length, "meal", locale)}.{" "}
          {!offline && (
            <button className="button secondary" onClick={() => void syncNow()}>
              {t("syncNow")}
            </button>
          )}
        </Notice>
      )}
      {rejected.length > 0 && !coachView && (
        <div className="notice error" role="alert">
          <strong>{t("needAttention", { count: rejected.length })}</strong>{" "}
          {t("notAccepted", { count: rejected.length })}
          <ul>
            {rejected.map((entry) => (
              <li key={entry.item.eventKey}>
                {formatDate(entry.item.date, {
                  locale,
                  fallback: entry.item.date,
                })}{" "}
                · <bdi>{entry.item.name}</bdi>
                {entry.item.correctsId ? t("correction") : ""} —{" "}
                {toError(entry.failure)}{" "}
                <button
                  type="button"
                  className="button secondary"
                  disabled={offline}
                  onClick={() =>
                    retryEntry(entry, profile?.timezone ?? entry.item.timezone)
                  }
                >
                  {t("tryAgain")}
                </button>{" "}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => discardEntry(entry)}
                >
                  {t("discard")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!d.entitled && (
        <Notice>
          {t("notEntitled")}{" "}
          <Link href="/app/membership">
            {t("membershipOptions")}{" "}
            <span className="bidi-mirror" aria-hidden="true">
              →
            </span>
          </Link>
        </Notice>
      )}
      {d.exceptions.map((e: any) => (
        <Notice key={e.id}>{e.message}</Notice>
      ))}
      {coachView && (
        <NutritionClientControl userId={userId} onChange={r.load} />
      )}
      {!coachView && d.targets?.find((t: any) => t.status === "active") && (
        <ClientTargetSummary
          target={d.targets.find((t: any) => t.status === "active")}
        />
      )}
      <fieldset
        className="nutrition-fieldset"
        disabled={r.busy}
        {...tabPanelProps("nutrition", tab)}
      >
        {d.records.filter((x: any) => x.kind === "nutrition_plan").length >
          1 && (
          <Field label={t("mealWeek")}>
            <select
              value={plan?.id ?? ""}
              onChange={(e) => setSelectedPlan(e.target.value)}
            >
              {d.records
                .filter((x: any) => x.kind === "nutrition_plan")
                .map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {formatDateRange(x.data.view.weekStart, x.data.view.weekEnd, {
                      locale,
                    })}{" "}
                    ·{" "}
                    {t.dynamic(`planStatus_${x.status}`, humanize(x.status))}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {tab === "today" && (
          <>
            {!coachView && (
              <Card title={plan ? t("planNext") : t("firstWeek")}>
                {!d.profile ? (
                  <p>
                    <Rich
                      t={t}
                      k="startWith"
                      tags={{
                        link: (text) => (
                          <button
                            className="nutrition-text-button"
                            onClick={() => setTab("profile")}
                          >
                            {text}
                          </button>
                        ),
                      }}
                    />
                  </p>
                ) : (
                  <form
                    className="nutrition-inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void r.action(
                        () =>
                          api("/nutrition/generate", "POST", {
                            requestKey: crypto.randomUUID(),
                            weekStart: f.get("weekStart"),
                          }),
                        t("weekReady"),
                      );
                    }}
                  >
                    <Field label={t("weekStarts")}>
                      <input
                        type="date"
                        name="weekStart"
                        min={d.today}
                        defaultValue={d.today}
                        required
                      />
                    </Field>
                    <button
                      className="button"
                      disabled={!permitted || !d.modelConsent || !d.ready}
                    >
                      {t("prepareWeek")}
                    </button>
                  </form>
                )}
                {!d.ready && <p>{t("notReady")}</p>}
                {d.profile && !d.modelConsent && <p>{t("enableAi")}</p>}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={cache}
                    onChange={(e) => {
                      setCache(e.target.checked);
                      if (!e.target.checked) localStorage.removeItem(key);
                    }}
                  />{" "}
                  {t("keepCopy")}
                </label>
              </Card>
            )}
            {plan ? (
              <>
                <Notice>
                  {plan.data.synthetic ||
                  plan.data.origin === "synthetic_fixture"
                    ? t("synthetic")
                    : plan.status === "delivered"
                      ? t("qualified")
                      : catalogRecheck
                        ? t("recheck")
                        : t("historical")}
                </Notice>
                <WeekView
                  key={plan.id}
                  plan={plan}
                  onLog={
                    !coachView &&
                    d.entitled &&
                    d.processingConsent &&
                    plan.status === "delivered"
                      ? addMeal
                      : undefined
                  }
                  onSwap={
                    permitted && plan.status === "delivered"
                      ? (day, m) => {
                          setSwap({
                            date: day.date,
                            slot: m.slot,
                            recipeId: m.recipeId,
                            variantKey: m.variantKey,
                            servings: m.servings,
                          });
                          void r
                            .action(
                              () =>
                                api("/nutrition/plans/" + plan.id + "/options"),
                              "",
                            )
                            .then((x) => {
                              if (x) setOptions(x);
                            });
                        }
                      : undefined
                  }
                />
              </>
            ) : (
              <Card title={t("mealsAppear")}>
                <p>{t("mealsAppearText")}</p>
              </Card>
            )}
            {swap && options && (
              <Card title={t("chooseAlternative")}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void r
                      .action(
                        () =>
                          api("/nutrition/plans/" + plan.id + "/swap", "POST", {
                            ...swap,
                            expectedVersion: plan.version,
                          }),
                        t("swapped"),
                      )
                      .then((x) => {
                        if (x?.plan) {
                          setSelectedPlan(x.plan.id);
                          setSwap(null);
                          setOptions(null);
                        }
                      });
                  }}
                >
                  <Field label={t("recipe")}>
                    <select
                      value={swap.recipeId}
                      onChange={(e) => {
                        const recipe = options.recipes.find(
                          (x: any) => x.id === e.target.value,
                        );
                        setSwap({
                          ...swap,
                          recipeId: recipe.id,
                          variantKey: recipe.variants[0].key,
                        });
                      }}
                    >
                      {options.recipes.map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("cookingOption")}>
                    <select
                      value={swap.variantKey}
                      onChange={(e) =>
                        setSwap({ ...swap, variantKey: e.target.value })
                      }
                    >
                      {options.recipes
                        .find((x: any) => x.id === swap.recipeId)
                        ?.variants.map((v: any) => (
                          <option value={v.key} key={v.key}>
                            {v.name} · {formatDuration(v.minutes, locale)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label={t("servings")}>
                    <input
                      type="number"
                      step={0.25}
                      min={options.policy.minServings}
                      max={options.policy.maxServings}
                      value={swap.servings}
                      onChange={(e) =>
                        setSwap({ ...swap, servings: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <p>{t("recheckedNote")}</p>
                  <button className="button">{t("applyChange")}</button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setSwap(null)}
                  >
                    {t("cancel")}
                  </button>
                </form>
              </Card>
            )}
          </>
        )}
        {tab === "groceries" && (
          <Card title={t("oneList")}>
            {plan ? (
              <>
                {plan.status !== "delivered" && (
                  <Notice>
                    {catalogRecheck ? t("listRecheck") : t("listOld")}
                  </Notice>
                )}
                <p>
                  {t("listIntro", {
                    range: formatDateRange(
                      plan.data.view.weekStart,
                      plan.data.view.weekEnd,
                      { locale },
                    ),
                  })}
                </p>
                <GroceryList
                  plan={plan}
                  pantry={d.records.find(
                    (x: any) =>
                      x.kind === "nutrition_pantry" &&
                      x.data.planId === plan.id,
                  )}
                  disabled={
                    coachView || offline || !d.processingConsent || !d.entitled
                  }
                  onSave={(foodIds) =>
                    r.action(
                      () =>
                        api("/nutrition/pantry", "PUT", {
                          planId: plan.id,
                          foodIds,
                        }),
                      t("pantrySaved"),
                    )
                  }
                />
                {!coachView && (
                  <a
                    className="button secondary"
                    href={"/api/v1/nutrition/groceries/" + plan.id}
                  >
                    {t("downloadList")}
                  </a>
                )}
                {plan.data.groceryChanges && (
                  <p className="muted">{t("groceryChanges")}</p>
                )}
              </>
            ) : (
              <p>{t("noList")}</p>
            )}
          </Card>
        )}
        {tab === "profile" && (
          <Card title={t("preferencesTitle")}>
            {coachView ? (
              <p>
                {profile
                  ? t("profileSummary", {
                      goal: profile.goal,
                      diet: profile.diet,
                      time: formatDuration(profile.maxMinutes, locale),
                    })
                  : t("noProfile")}
              </p>
            ) : (
              <>
                <fieldset
                  className="nutrition-fieldset"
                  disabled={!d.entitled || offline}
                >
                  <ProfileForm
                    key={d.profile?.id ?? "profile"}
                    initial={offline ? undefined : profile}
                    onSubmit={(b) =>
                      r.action(
                        () =>
                          api("/nutrition/profile", "POST", {
                            ...b,
                            version: d.profile?.version ?? 0,
                          }),
                        t("prefsSaved"),
                      )
                    }
                  />
                </fieldset>
                <div className="nutrition-actions">
                  <button
                    className="button secondary"
                    disabled={offline}
                    onClick={() =>
                      void r.action(
                        () =>
                          api("/privacy/consent", "POST", {
                            type: "nutrition_model",
                            granted: false,
                          }),
                        t("aiRevoked"),
                      )
                    }
                  >
                    {t("revokeAi")}
                  </button>
                  <button
                    className="button secondary"
                    disabled={offline}
                    onClick={() =>
                      void r.action(
                        () =>
                          api("/privacy/consent", "POST", {
                            type: "nutrition",
                            granted: false,
                          }),
                        t("processingRevoked"),
                      )
                    }
                  >
                    {t("revokeProcessing")}
                  </button>
                </div>
              </>
            )}
          </Card>
        )}
        {tab === "diary" && (
          <>
            <NutritionConsumed
              userId={userId}
              coachView={coachView}
              refreshKey={d.records[0]?.id}
            />
            {!coachView && (
              <NutritionSavedMeals today={d.today} onChange={r.load} />
            )}
            <Card title={t("recorded")}>
              <p>
                {t("recordedSummary", {
                  meals: t("meals", { count: d.twin.loggedMeals ?? 0 }),
                  days: t("days", { count: d.twin.loggedDays ?? 0 }),
                })}
              </p>
              {d.records
                .filter(
                  (x: any) =>
                    x.kind === "nutrition_log" &&
                    !x.data.deleted &&
                    !d.records.some(
                      (y: any) =>
                        y.kind === "nutrition_log" &&
                        y.data.correctsId === x.id,
                    ),
                )
                .map((x: any) => (
                  <details
                    key={x.id}
                    className={freshLogs.has(x.id) ? "motion-arrive" : undefined}
                  >
                    <summary>
                      {formatDate(x.data.date, { locale, fallback: x.data.date })}{" "}
                      · <bdi>{x.data.name}</bdi> ·{" "}
                      {t("kcal", { kcal: x.data.kcal ?? t("unknown") })}
                    </summary>
                    <p>{x.data.notes}</p>
                    {!coachView && (
                      <>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() =>
                            void r.action(
                              () =>
                                api("/nutrition/favorites", "POST", {
                                  logId: x.id,
                                }),
                              t("favSaved"),
                            )
                          }
                        >
                          {t("saveFav")}
                        </button>
                        <NutritionCopyMeal
                          sourceId={x.id}
                          today={d.today}
                          onChange={r.load}
                        />
                      </>
                    )}
                    {!coachView && (
                      <DiaryForm
                        initial={x.data}
                        timezone={profile?.timezone ?? "Asia/Dubai"}
                        today={d.today}
                        onSave={(b) => queue({ ...b, correctsId: x.id })}
                      />
                    )}
                  </details>
                ))}
            </Card>
            {!coachView && (
              <Card title={t("addMeal")}>
                <fieldset
                  className="nutrition-fieldset"
                  disabled={!d.entitled || !d.processingConsent}
                >
                  <DiaryForm
                    timezone={profile?.timezone ?? "Asia/Dubai"}
                    today={d.today}
                    onSave={queue}
                  />
                </fieldset>
              </Card>
            )}
          </>
        )}
        {tab === "checkin" && (
          <Card title={t("checkinTitle")}>
            {!coachView && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void r.action(
                    () =>
                      api("/nutrition/checkins", "POST", {
                        eventKey: crypto.randomUUID(),
                        date: d.today,
                        hunger: num(f, "hunger"),
                        difficulty: num(f, "difficulty"),
                        weightKg:
                          f.get("weight") === "" ? null : num(f, "weight"),
                        notes: f.get("notes"),
                      }),
                    t("checkinSaved"),
                  );
                }}
              >
                <div className="nutrition-form-grid">
                  <Field label={t("hunger")}>
                    <input
                      name="hunger"
                      type="number"
                      min={1}
                      max={5}
                      defaultValue={3}
                      required
                    />
                  </Field>
                  <Field label={t("difficulty")}>
                    <input
                      name="difficulty"
                      type="number"
                      min={1}
                      max={5}
                      defaultValue={3}
                      required
                    />
                  </Field>
                  <Field label={t("weightOptional")}>
                    <input
                      name="weight"
                      type="number"
                      min={1}
                      max={500}
                      step={0.1}
                    />
                  </Field>
                </div>
                <Field label={t("helped")}>
                  <textarea name="notes" />
                </Field>
                <button className="button" disabled={!permitted}>
                  {t("saveCheckin")}
                </button>
              </form>
            )}
            {d.records
              .filter((x: any) => x.kind === "nutrition_checkin")
              .map((x: any) => (
                <p key={x.id}>
                  {t("checkinLine", {
                    date: formatDate(x.data.date, {
                      locale,
                      fallback: x.data.date,
                    }),
                    hunger: `${x.data.hunger}/5`,
                    difficulty: `${x.data.difficulty}/5`,
                  })}
                </p>
              ))}
          </Card>
        )}
      </fieldset>
    </div>
  );
}
function GroceryList({
  plan,
  pantry,
  disabled,
  onSave,
}: {
  plan: any;
  pantry: any;
  disabled: boolean;
  onSave: (ids: string[]) => Promise<any>;
}) {
  const [selected, setSelected] = useState<string[]>(
    pantry?.data.foodIds ?? [],
  );
  const t = useT("nutrition"),
    locale = useLocale();
  useEffect(
    () => setSelected(pantry?.data.foodIds ?? []),
    [plan.id, pantry?.id],
  );
  return (
    <>
      <NutritionShopping plan={plan} readOnly={disabled} />
      <div className="nutrition-groceries">
        {plan.data.view.groceries.map((g: any) => (
          <label className="nutrition-grocery" key={g.food.id}>
            <input
              type="checkbox"
              checked={selected.includes(g.food.id)}
              disabled={disabled}
              onChange={(e) =>
                setSelected((s) =>
                  e.target.checked
                    ? [...s, g.food.id]
                    : s.filter((i) => i !== g.food.id),
                )
              }
            />
            <span>
              <strong>{g.food.name}</strong>
              <small>
                {t.dynamic(
                  `prep_${g.food.preparation}`,
                  humanize(g.food.preparation).toLowerCase(),
                )}{" "}
                ·{" "}
                {g.food.allergens.length
                  ? t("allergens", {
                      list: g.food.allergens.join(locale === "ar" ? "، " : ", "),
                    })
                  : t("checkLabel")}
              </small>
            </span>
            <b>{t("grams", { grams: g.grams })}</b>
          </label>
        ))}
      </div>
      <p>{t("pantryHelp")}</p>
      <button
        className="button secondary"
        disabled={disabled}
        onClick={() => void onSave(selected)}
      >
        {t("saveShopping")}
      </button>
    </>
  );
}
function DiaryForm({
  initial,
  timezone,
  today,
  onSave,
}: {
  initial?: any;
  timezone: string;
  today: string;
  onSave: (b: any) => Promise<any>;
}) {
  const [items, setItems] = useState<any[]>(initial?.items ?? []),
    [manualKcal, setManualKcal] = useState(String(initial?.kcal ?? ""));
  const t = useT("nutrition");
  const sum = (key: string) =>
    items.length && items.every((i) => i[key] !== null)
      ? Math.round(items.reduce((n, i) => n + i[key], 0) * 100) / 100
      : null;
  const edit = (index: number, patch: any) =>
    setItems((old) =>
      old.map((i, n) => (n === index ? { ...i, ...patch } : i)),
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSave({
          eventKey: crypto.randomUUID(),
          date: f.get("date"),
          timezone,
          name: f.get("name"),
          notes: f.get("notes"),
          kcal: items.length
            ? sum("kcal")
            : f.get("kcal") === ""
              ? null
              : num(f, "kcal"),
          ...(items.length
            ? { items }
            : {
                nutrients: {
                  kcal: f.get("kcal") === "" ? null : num(f, "kcal"),
                  protein: f.get("protein") === "" ? null : num(f, "protein"),
                  carbohydrate:
                    f.get("carbohydrate") === ""
                      ? null
                      : num(f, "carbohydrate"),
                  fat: f.get("fat") === "" ? null : num(f, "fat"),
                },
              }),
          portionLabel: f.get("portionLabel"),
          deleted: f.get("deleted") === "on",
        });
      }}
    >
      <div className="nutrition-form-grid">
        <Field label={t("date")}>
          <input
            type="date"
            name="date"
            max={today}
            defaultValue={initial?.date ?? today}
            required
          />
        </Field>
        <Field label={t("meal")}>
          <input name="name" defaultValue={initial?.name} required />
        </Field>
        <Field label={t("kcalOptional")}>
          <input
            name="kcal"
            type="number"
            min={0}
            step={0.1}
            value={items.length ? (sum("kcal") ?? "") : manualKcal}
            onChange={(e) => setManualKcal(e.target.value)}
            readOnly={items.length > 0}
          />
        </Field>
      </div>
      <Field label={t("portionDescription")}>
        <input
          name="portionLabel"
          maxLength={200}
          defaultValue={initial?.portionLabel ?? ""}
        />
      </Field>
      {!items.length && (
        <div className="nutrition-form-grid">
          {(
            [
              ["protein", t("proteinOptional")],
              ["carbohydrate", t("carbohydrateOptional")],
              ["fat", t("fatOptional")],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                name={key}
                type="number"
                min={0}
                max={10000}
                step={0.1}
                defaultValue={
                  initial?.nutrients?.[key] ??
                  initial?.mealSnapshot?.nutrients?.[key] ??
                  ""
                }
              />
            </Field>
          ))}
        </div>
      )}
      {items.map((item, index) => (
        <details key={index}>
          <summary>
            <bdi>{item.name}</bdi> · {item.amount ?? t("unknown")}{" "}
            {item.unit ? t.dynamic(`unitShort_${item.unit}`, item.unit) : ""}
          </summary>
          <div className="nutrition-form-grid">
            <Field label={t("foodName")}>
              <input
                value={item.name}
                onChange={(e) => edit(index, { name: e.target.value })}
                required
              />
            </Field>
            <Field label={t("portion")}>
              <input
                value={item.portion}
                onChange={(e) => edit(index, { portion: e.target.value })}
                required
              />
            </Field>
            <Field label={t("amount")}>
              <input
                type="number"
                min={0.01}
                max={10000}
                step={0.01}
                value={item.amount ?? ""}
                onChange={(e) =>
                  edit(
                    index,
                    scaleCapturedPortion(
                      item,
                      e.target.value ? Number(e.target.value) : null,
                    ),
                  )
                }
              />
            </Field>
            <Field label={t("unit")}>
              <select
                value={item.unit ?? ""}
                onChange={(e) =>
                  edit(
                    index,
                    scaleCapturedPortion(
                      item,
                      item.amount,
                      e.target.value || null,
                    ),
                  )
                }
              >
                <option value="">{t("unit_unknown")}</option>
                <option value="g">{t("unit_g")}</option>
                <option value="ml">{t("unit_ml")}</option>
                <option value="portion">{t("unit_portion")}</option>
              </select>
            </Field>
            {(["kcal", "protein", "carbohydrate", "fat"] as const).map((key) => (
              <Field key={key} label={t(`nutrient_${key}`)}>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={0.01}
                  value={item[key] ?? ""}
                  onChange={(e) =>
                    edit(index, {
                      [key]: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => setItems((old) => old.filter((_, i) => i !== index))}
          >
            {t("removeFood")}
          </button>
        </details>
      ))}
      {items.length > 0 && (
        <p>{t("correctedTotal", { kcal: sum("kcal") ?? t("unknown") })}</p>
      )}
      <Field label={t("diaryNotes")}>
        <textarea name="notes" defaultValue={initial?.notes} />
      </Field>
      {initial && (
        <label className="check">
          <input name="deleted" type="checkbox" /> {t("removeEntry")}
        </label>
      )}
      <button className="button secondary">
        {initial ? t("saveCorrection") : t("recordMeal")}
      </button>
    </form>
  );
}

function NutritionRecovery() {
  const r = useNutrition("/nutrition/recovery");
  return (
    <Card title="Recover a blocked meal week">
      <p>
        Unsent jobs can retry. Requests that may have reached the model need a
        provider trace confirming they were not processed. Close obsolete weeks
        so the scheduler can prepare a current week.
      </p>
      {r.error && <Notice>{r.error}</Notice>}
      {r.message && <Notice>{r.message}</Notice>}
      {r.data?.length === 0 && <p>No blocked weeks.</p>}
      {r.data?.map((j: any) => (
        <form
          key={j.id}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void r.action(
              () =>
                api("/nutrition/recovery/" + j.id, "POST", {
                  attempts: j.attempts,
                  action: f.get("action"),
                  reason: f.get("reason"),
                  providerReference: f.get("providerReference"),
                }),
              "Recovery recorded",
            );
          }}
        >
          <h3>Week starting {j.data.weekStart}</h3>
          <p>
            {j.last_error} · Provider state:{" "}
            {j.provider_state ?? (j.request_id ? "uncertain" : "not sent")}
          </p>
          <Field label="Recovery action">
            <select name="action">
              <option value="retry_unsent">Retry only if never sent</option>
              <option value="retry_responded">
                Retry known response (another paid model call)
              </option>
              <option value="provider_confirmed_not_processed">
                Provider confirmed not processed
              </option>
              <option value="provider_confirmed_not_processed_close">
                Provider confirmed not processed; close obsolete week
              </option>
              <option value="provider_confirmed_processed_close">
                Provider confirmed processed; close without retry
              </option>
              <option value="close">
                Close without retry (uncertainty remains held)
              </option>
            </select>
          </Field>
          <Field label="Reason">
            <textarea name="reason" minLength={10} maxLength={2000} required />
          </Field>
          <Field label="Provider trace or support reference">
            <input name="providerReference" maxLength={500} />
          </Field>
          <button className="button secondary" disabled={r.busy}>
            Record recovery
          </button>
        </form>
      ))}
    </Card>
  );
}
function NutritionVersions() {
  const r = useNutrition("/nutrition/catalog-history");
  return (
    <Card title="Food and recipe versions">
      <p>
        New plans use only the latest available facts. Replacing an ingredient
        also withholds recipes that still use its older facts. Previous
        delivered plans retain their original snapshots.
      </p>
      {r.error && <Notice>{r.error}</Notice>}
      {r.message && <Notice>{r.message}</Notice>}
      {r.data &&
        [
          ...r.data.foods.map((x: any) => ({ ...x, kind: "food" })),
          ...r.data.recipes.map((x: any) => ({ ...x, kind: "recipe" })),
        ].map((x: any) => {
          const active = r.data.active[
              x.kind === "food" ? "foods" : "recipes"
            ].some((a: any) => a.id === x.id),
            archived = r.data.archives.some(
              (a: any) => a.data.entityId === x.id,
            );
          return (
            <details key={x.id}>
              <summary>
                {x.name} · {active ? "Current" : "Unavailable for new plans"}
              </summary>
              <p>{x.source}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void r.action(
                    () =>
                      api(
                        `/nutrition/catalog/${x.kind}/${x.id}/archive`,
                        "POST",
                        { archived: !archived, reason: f.get("reason") },
                      ),
                    "Availability updated; requalify changed teaching before automatic delivery.",
                  );
                }}
              >
                <Field label="Reason">
                  <input
                    name="reason"
                    required
                    minLength={10}
                    maxLength={1000}
                  />
                </Field>
                <button className="button secondary" disabled={r.busy}>
                  {archived
                    ? "Remove archive restriction"
                    : "Archive this version"}
                </button>
              </form>
              <details>
                <summary>Create a replacement version</summary>
                {x.kind === "food" ? (
                  <FoodForm
                    initial={x}
                    submit={(path, body) =>
                      r.action(
                        () =>
                          api("/nutrition" + path, "POST", {
                            ...body,
                            supersedesId: x.id,
                          }),
                        "Replacement saved",
                      )
                    }
                  />
                ) : (
                  <RecipeForm
                    initial={x}
                    foods={r.data.active.foods}
                    submit={(path, body) =>
                      r.action(
                        () =>
                          api("/nutrition" + path, "POST", {
                            ...body,
                            supersedesId: x.id,
                          }),
                        "Replacement saved",
                      )
                    }
                  />
                )}
              </details>
            </details>
          );
        })}
    </Card>
  );
}

function ClientTargetSummary({ target }: { target: any }) {
  const goal = target.data.target;
  const t = useT("nutrition"),
    locale = useLocale();
  return (
    <Card title={t("targetsTitle")}>
      <p>
        {t("targetLine", {
          kcal: goal.kcal,
          date: formatDate(goal.reviewOn, { locale, fallback: goal.reviewOn }),
        })}
      </p>
      <p>
        {[
          goal.protein !== null ? t("proteinG", { value: goal.protein }) : null,
          goal.carbohydrate !== null
            ? t("carbohydrateG", { value: goal.carbohydrate })
            : null,
          goal.fat !== null ? t("fatG", { value: goal.fat }) : null,
          goal.hydrationMl !== null
            ? t("fluidsMl", { value: goal.hydrationMl })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p>{goal.reason}</p>
      <ul>
        {goal.habits.map((h: string) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </Card>
  );
}
function NutritionMethods({ cases }: { cases: any[] }) {
  const r = useNutrition("/nutrition/methods"),
    [kind, setKind] = useState("fixed");
  return (
    <Card title="Teach your calorie method">
      <p>
        Record the calculation you use and the teaching evidence behind it.
        Coefficients are chosen by you; individual results must remain within
        your confirmed policy limits.
      </p>
      {r.error && <Notice>{r.error}</Notice>}
      {r.message && <Notice>{r.message}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void r.action(
            () =>
              api("/nutrition/methods", "POST", {
                name: f.get("name"),
                kind,
                fixedKcal: kind === "fixed" ? num(f, "fixed") : null,
                kcalPerKg:
                  kind === "weight_activity" ? num(f, "coefficient") : null,
                activityFactor:
                  kind === "weight_activity" ? num(f, "activity") : 1,
                adjustmentKcal: num(f, "adjustment"),
                reason: f.get("reason"),
                sourceIds: f.getAll("sourceIds"),
              }),
            "Coach method confirmed",
          );
        }}
      >
        <Field label="Method name">
          <input name="name" required maxLength={160} />
        </Field>
        <Field label="Calculation">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="fixed">Fixed calorie value</option>
            <option value="weight_activity">
              Body weight × coach coefficient × activity factor
            </option>
          </select>
        </Field>
        {kind === "fixed" ? (
          <Field label="Calories">
            <input name="fixed" type="number" min={1} max={10000} required />
          </Field>
        ) : (
          <div className="nutrition-form-grid">
            <Field label="Coach coefficient (kcal per kg)">
              <input
                name="coefficient"
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                required
              />
            </Field>
            <Field label="Activity factor">
              <input
                name="activity"
                type="number"
                min={1}
                max={3}
                step={0.01}
                defaultValue={1}
                required
              />
            </Field>
          </div>
        )}
        <Field label="Calorie adjustment after calculation">
          <input
            name="adjustment"
            type="number"
            min={-1000}
            max={1000}
            defaultValue={0}
            required
          />
        </Field>
        <Field label="Why and when you use this method">
          <textarea name="reason" required maxLength={2000} />
        </Field>
        <fieldset>
          <legend>Confirmed teaching cases</legend>
          {cases.map((c) => (
            <label className="check" key={c.id}>
              <input type="checkbox" name="sourceIds" value={c.id} />
              {c.data.category}: {c.data.scenario.slice(0, 100)}
            </label>
          ))}
        </fieldset>
        <button className="button" disabled={r.busy}>
          Confirm method
        </button>
      </form>
      {r.data?.map((m: any) => (
        <details key={m.id}>
          <summary>{m.data.name}</summary>
          <p>
            {m.data.kind === "fixed"
              ? m.data.fixedKcal
              : `Weight × ${m.data.kcalPerKg} × ${m.data.activityFactor}`}{" "}
            + {m.data.adjustmentKcal} kcal
          </p>
          <p>{m.data.reason}</p>
        </details>
      ))}
    </Card>
  );
}
function NutritionClientControl({
  userId,
  onChange,
}: {
  userId: string;
  onChange: () => Promise<any>;
}) {
  const r = useNutrition("/nutrition/clients/" + userId + "/control");
  if (r.error && !r.data) return <Notice>{r.error}</Notice>;
  if (!r.data) return <p>Loading client controls…</p>;
  const d = r.data,
    target = d.targets.find((t: any) => t.status === "active");
  return (
    <>
      {r.error && <Notice>{r.error}</Notice>}
      {r.message && <Notice>{r.message}</Notice>}
      <details>
        <summary>Set individual targets</summary>
        <NutritionTargetForm
          key={target?.id ?? d.profile.id}
          data={d}
          target={target}
          submit={async (body: any) => {
            const result = await r.action(
              () => api(`/nutrition/clients/${userId}/target`, "POST", body),
              "Individual targets saved for the next assigned or generated week",
            );
            if (result) await onChange();
            return result;
          }}
        />
      </details>
      <details>
        <summary>Assign or amend this client's meal week</summary>
        <NutritionWeekEditor
          key={d.plans.map((p: any) => p.id + p.status).join("")}
          data={d}
          submit={async (body: any) => {
            const result = await r.action(
              () => api(`/nutrition/clients/${userId}/plan`, "POST", body),
              "Validated meal week delivered",
            );
            if (result) await onChange();
            return result;
          }}
          archive={async (plan: any, reason: string) => {
            const result = await r.action(
              () =>
                api(`/nutrition/plans/${plan.id}/archive`, "POST", {
                  version: plan.version,
                  reason,
                }),
              "Meal week archived",
            );
            if (result) await onChange();
          }}
        />
      </details>
    </>
  );
}
function NutritionTargetForm({
  data,
  target,
  submit,
}: {
  data: any;
  target: any;
  submit: (body: any) => Promise<any>;
}) {
  const [methodId, setMethodId] = useState(""),
    [weight, setWeight] = useState(""),
    [kcal, setKcal] = useState(
      String(
        target?.data.target.kcal ??
          data.policy?.data.policy.targets.find(
            (t: any) =>
              t.goal.toLowerCase() ===
              data.profile.data.profile.goal.toLowerCase(),
          )?.kcal ??
          "",
      ),
    );
  const t = target?.data.target,
    method = data.methods.find((m: any) => m.id === methodId);
  const computed = method
    ? Math.round(
        (method.data.kind === "fixed"
          ? method.data.fixedKcal
          : Number(weight) *
            method.data.kcalPerKg *
            method.data.activityFactor) + method.data.adjustmentKcal,
      )
    : Number(kcal);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          optional = (k: string) => (f.get(k) === "" ? null : num(f, k));
        void submit({
          previousId: target?.id ?? null,
          profileId: data.profile.id,
          methodId: methodId || null,
          ...(weight ? { weightKg: Number(weight) } : {}),
          target: {
            kcal: computed,
            protein: optional("protein"),
            carbohydrate: optional("carbohydrate"),
            fat: optional("fat"),
            macroTolerancePercent: num(f, "tolerance"),
            hydrationMl: optional("hydration"),
            habits: String(f.get("habits"))
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            reviewOn: f.get("review"),
            reason: f.get("reason"),
            allowAutomaticAdjustment: f.get("adjustment") === "on",
          },
        });
      }}
    >
      <Field label="Calorie method">
        <select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
          <option value="">Coach's individual fixed target</option>
          {data.methods.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.data.name}
            </option>
          ))}
        </select>
      </Field>
      {method?.data.kind === "weight_activity" && (
        <Field label="Confirmed body weight in kg">
          <input
            type="number"
            min={20}
            max={500}
            step={0.1}
            required
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </Field>
      )}
      <Field label="Approximate daily calories">
        <input
          type="number"
          min={1}
          max={10000}
          value={method ? computed : kcal}
          readOnly={!!method}
          onChange={(e) => setKcal(e.target.value)}
          required
        />
      </Field>
      <div className="nutrition-form-grid">
        {[
          ["protein", "Protein g"],
          ["carbohydrate", "Carbohydrate g"],
          ["fat", "Fat g"],
        ].map(([key, label]) => (
          <Field key={key} label={label + " (optional)"}>
            <input
              name={key}
              type="number"
              min={0}
              max={key === "carbohydrate" ? 1500 : 1000}
              step={0.1}
              defaultValue={t?.[key] ?? ""}
            />
          </Field>
        ))}
        <Field label="Macro tolerance %">
          <input
            name="tolerance"
            type="number"
            min={5}
            max={40}
            defaultValue={t?.macroTolerancePercent ?? 20}
          />
        </Field>
        <Field label="Daily fluids in ml (optional)">
          <input
            name="hydration"
            type="number"
            min={0}
            max={10000}
            defaultValue={t?.hydrationMl ?? ""}
          />
        </Field>
      </div>
      <Field label="Daily habits, one per line">
        <textarea name="habits" defaultValue={t?.habits.join("\n") ?? ""} />
      </Field>
      <Field label="Review on">
        <input
          name="review"
          type="date"
          defaultValue={t?.reviewOn ?? data.today}
          min={data.today}
          required
        />
      </Field>
      <Field label="Reason and client context">
        <textarea
          name="reason"
          minLength={1}
          maxLength={2000}
          defaultValue={t?.reason ?? ""}
          required
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          name="adjustment"
          defaultChecked={t?.allowAutomaticAdjustment ?? false}
        />
        Allow automatic calorie adjustments within the confirmed coach policy
      </label>
      <button className="button">Save individual targets</button>
    </form>
  );
}
function NutritionWeekEditor({
  data,
  submit,
  archive,
}: {
  data: any;
  submit: (b: any) => Promise<any>;
  archive: (p: any, reason: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(""),
    [start, setStart] = useState(data.today),
    [reason, setReason] = useState(""),
    [days, setDays] = useState<any[]>([]);
  const policy = data.policy?.data.policy,
    existing = data.plans.find((p: any) => p.id === selected);
  const seed = (plan?: any) => {
    setSelected(plan?.id ?? "");
    setStart(plan?.data.weekStart ?? data.today);
    setDays(
      plan
        ? structuredClone(plan.data.choices.days)
        : Array.from({ length: 7 }, (_, offset) => ({
            offset,
            meals: (policy?.slots ?? []).map((slot: string) => {
              const recipe = data.recipes.find((r: any) =>
                r.slots.includes(slot),
              );
              return {
                slot,
                recipeId: recipe?.id ?? "",
                variantKey: recipe?.variants[0]?.key ?? "",
                servings: 1,
                batchKey: null,
              };
            }),
          })),
    );
  };
  useEffect(() => {
    seed(data.plans.find((p: any) => p.status === "delivered"));
  }, []);
  if (!policy) return <p>Confirm a diet policy before assigning a week.</p>;
  const change = (day: number, meal: number, patch: any) =>
    setDays((old) =>
      old.map((d, i) =>
        i === day
          ? {
              ...d,
              meals: d.meals.map((m: any, j: number) =>
                j === meal ? { ...m, ...patch } : m,
              ),
            }
          : d,
      ),
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          weekStart: start,
          profileId: data.profile.id,
          previousId: existing?.status === "delivered" ? existing.id : null,
          previousVersion:
            existing?.status === "delivered" ? existing.version : null,
          reason,
          week: {
            days,
            caseIds: data.cases.map((c: any) => c.id),
            explanation: reason,
          },
        });
      }}
    >
      <Field label="Meal week to edit">
        <select
          value={selected}
          onChange={(e) =>
            seed(data.plans.find((p: any) => p.id === e.target.value))
          }
        >
          <option value="">Create a new week</option>
          {data.plans.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.data.weekStart} · {p.status}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Week starts">
        <input
          type="date"
          value={start}
          readOnly={!!existing}
          onChange={(e) => setStart(e.target.value)}
          required
        />
      </Field>
      {days.map((d, i) => (
        <details key={d.offset}>
          <summary>Day {d.offset + 1}</summary>
          {d.meals.map((m: any, j: number) => {
            const recipe = data.recipes.find((r: any) => r.id === m.recipeId);
            return (
              <div className="nutrition-form-grid" key={m.slot}>
                <Field label={m.slot + " recipe"}>
                  <select
                    value={m.recipeId}
                    onChange={(e) => {
                      const r = data.recipes.find(
                        (r: any) => r.id === e.target.value,
                      );
                      change(i, j, {
                        recipeId: e.target.value,
                        variantKey: r?.variants[0]?.key ?? "",
                      });
                    }}
                    required
                  >
                    <option value="">Choose recipe</option>
                    {data.recipes
                      .filter((r: any) => r.slots.includes(m.slot))
                      .map((r: any) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Cooking option">
                  <select
                    value={m.variantKey}
                    onChange={(e) =>
                      change(i, j, { variantKey: e.target.value })
                    }
                    required
                  >
                    {recipe?.variants.map((v: any) => (
                      <option key={v.key} value={v.key}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Portions">
                  <input
                    type="number"
                    min={policy.minServings}
                    max={policy.maxServings}
                    step={0.25}
                    value={m.servings}
                    onChange={(e) =>
                      change(i, j, { servings: Number(e.target.value) })
                    }
                    required
                  />
                </Field>
                <Field label="Shared batch name (optional)">
                  <input
                    value={m.batchKey ?? ""}
                    maxLength={50}
                    pattern="[a-zA-Z0-9-]*"
                    onChange={(e) =>
                      change(i, j, { batchKey: e.target.value || null })
                    }
                  />
                </Field>
              </div>
            );
          })}
        </details>
      ))}
      <Field label="Reason and guidance for this week">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={10}
          maxLength={2000}
          required
        />
      </Field>
      <button className="button">Validate and deliver week</button>
      {existing?.status === "delivered" && (
        <button
          type="button"
          className="button secondary"
          disabled={reason.trim().length < 10}
          onClick={() => void archive(existing, reason)}
        >
          Archive delivered week
        </button>
      )}
      <p>
        Delivery checks all seven days, portions, ingredients, client
        restrictions, calorie limits and any individual macro goals.
      </p>
    </form>
  );
}

function NutritionConsumed({
  userId,
  coachView,
  refreshKey,
}: {
  userId: string;
  coachView: boolean;
  refreshKey: string;
}) {
  const r = useNutrition(
    "/nutrition/tracker" + (coachView ? "?userId=" + userId : ""),
  );
  const t = useT("nutrition"),
    locale = useLocale();
  const day = (value: string) => formatDate(value, { locale, fallback: value });
  useEffect(() => {
    void r.load().catch((e) => r.setError(r.toError(e)));
  }, [refreshKey]);
  return (
    <Card title={t("trendsTitle")}>
      {r.error && <Notice>{r.error}</Notice>}
      {r.data && (
        <>
          <p>{r.data.coverage}</p>
          <p>
            {t("trendsLine", {
              meals: t("recordedMeals", { count: r.data.loggedMeals ?? 0 }),
              days: t("days", { count: r.data.loggedDays ?? 0 }),
            })}{" "}
            {r.data.partialInput ? t("partial") : ""}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>{t("th_date")}</th>
                  <th>{t("th_recorded")}</th>
                  <th>{t("th_planned")}</th>
                  <th>{t("th_protein")}</th>
                  <th>{t("th_carbohydrate")}</th>
                  <th>{t("th_fat")}</th>
                </tr>
              </thead>
              <tbody>
                {r.data.days
                  .slice(-7)
                  .reverse()
                  .map((d: any) => (
                    <tr key={d.date}>
                      <td>{day(d.date)}</td>
                      <td>
                        {d.meals
                          ? (d.totals.kcal ??
                            t("knownPlus", { value: d.knownTotals.kcal }))
                          : t("noEntry")}
                      </td>
                      <td>{d.planned?.kcal ?? "—"}</td>
                      {["protein", "carbohydrate", "fat"].map((k) => (
                        <td key={k}>
                          {d.meals
                            ? (d.totals[k] ??
                              t("knownPlus", { value: d.knownTotals[k] }))
                            : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>{t("allDays")}</summary>
            {r.data.days.map((d: any) => (
              <p key={d.date}>
                {t("dayLine", {
                  date: day(d.date),
                  meals: t("meals", { count: d.meals ?? 0 }),
                  kcal:
                    d.totals.kcal === null || d.totals.kcal === undefined
                      ? t("incomplete")
                      : t("kcal", { kcal: d.totals.kcal }),
                })}
              </p>
            ))}
            <p>
              {t("weightChange", {
                value:
                  r.data.weightChangeKg === null ||
                  r.data.weightChangeKg === undefined
                    ? t("notEnough")
                    : t("kg", { value: r.data.weightChangeKg }),
              })}
            </p>
            {r.data.weights.map((w: any) => (
              <p key={w.sourceId}>
                {t("weightLine", {
                  date: day(w.date),
                  kg: t("kg", { value: w.kg }),
                })}
              </p>
            ))}
          </details>
        </>
      )}
    </Card>
  );
}
function NutritionCopyMeal({
  sourceId,
  today,
  favorite = false,
  onChange,
}: {
  sourceId: string;
  today: string;
  favorite?: boolean;
  onChange: () => Promise<any>;
}) {
  const [date, setDate] = useState(today),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const t = useT("nutrition"),
    locale = useLocale(),
    toError = useErrorText();
  return (
    <form
      className="nutrition-inline"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        void api(
          `/nutrition/${favorite ? "favorites" : "logs"}/${sourceId}/${favorite ? "log" : "copy"}`,
          "POST",
          { date, eventKey: crypto.randomUUID() },
        )
          .then(async () => {
            setMessage(
              t("recordedFor", {
                date: formatDate(date, { locale, fallback: date }),
              }),
            );
            await onChange();
          })
          .catch((e) => setMessage(toError(e)))
          .finally(() => setBusy(false));
      }}
    >
      <Field label={t("dateEaten")}>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </Field>
      <button className="button secondary" disabled={busy}>
        {t("recordAgain")}
      </button>
      {message && <Notice>{message}</Notice>}
    </form>
  );
}
function NutritionSavedMeals({
  today,
  onChange,
}: {
  today: string;
  onChange: () => Promise<any>;
}) {
  const r = useNutrition("/nutrition/favorites");
  const t = useT("nutrition");
  return (
    <Card title={t("savedMeals")}>
      <button
        className="button secondary"
        onClick={() => void r.action(r.load, t("savedRefreshed"))}
      >
        {t("refreshSaved")}
      </button>
      {r.error && <Notice>{r.error}</Notice>}
      {r.data?.length === 0 && <p>{t("saveHint")}</p>}
      {r.data?.map((f: any) => (
        <details key={f.id}>
          <summary>
            <bdi>{f.data.snapshot.name}</bdi> ·{" "}
            {t("kcal", { kcal: f.data.snapshot.kcal ?? t("unknown") })}
          </summary>
          <NutritionCopyMeal
            sourceId={f.id}
            favorite
            today={today}
            onChange={onChange}
          />
          <button
            className="button secondary"
            onClick={() =>
              void r.action(
                () => api("/nutrition/favorites/" + f.id, "DELETE"),
                t("favRemoved"),
              )
            }
          >
            {t("removeFav")}
          </button>
        </details>
      ))}
    </Card>
  );
}
function NutritionPurchaseSpecs() {
  const r = useNutrition("/nutrition/purchase-specs");
  return (
    <Card title="Turn ingredients into a shopping list">
      <p>
        Specify the grams you buy for each gram required in a recipe, accounting
        for preparation or edible yield. The system rounds up to whole packs
        only when you provide a pack size.
      </p>
      {r.error && <Notice>{r.error}</Notice>}
      {r.message && <Notice>{r.message}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void r.action(
            () =>
              api("/nutrition/purchase-specs", "POST", {
                foodId: f.get("food"),
                purchaseGramsPerEdibleGram: num(f, "ratio"),
                packGrams: f.get("pack") === "" ? null : num(f, "pack"),
                label: f.get("label"),
                source: f.get("source"),
              }),
            "Purchase conversion saved",
          );
        }}
      >
        <Field label="Ingredient">
          <select name="food" required>
            {r.data?.foods.map((f: any) => (
              <option key={f.id} value={f.id}>
                {f.name} · {f.preparation}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Purchased grams per recipe gram">
          <input
            name="ratio"
            type="number"
            min={0.01}
            max={30}
            step={0.01}
            defaultValue={1}
            required
          />
        </Field>
        <Field label="Pack weight in purchased grams (optional)">
          <input
            name="pack"
            type="number"
            min={0.01}
            max={100000}
            step={0.01}
          />
        </Field>
        <Field label="Shopping label">
          <input
            name="label"
            maxLength={120}
            placeholder="500 g uncooked pack"
            required
          />
        </Field>
        <Field label="Label or tested preparation source">
          <textarea name="source" minLength={5} maxLength={1000} required />
        </Field>
        <button className="button">Save conversion</button>
      </form>
      {r.data?.specs.map((x: any) => (
        <p key={x.id}>
          {r.data.foods.find((f: any) => f.id === x.data.foodId)?.name ??
            "Historical ingredient"}
          : × {x.data.purchaseGramsPerEdibleGram}, {x.data.packGrams ?? "loose"}{" "}
          g · {x.data.source}
        </p>
      ))}
    </Card>
  );
}
function NutritionShopping({
  plan,
  readOnly,
}: {
  plan: any;
  readOnly: boolean;
}) {
  const r = useNutrition("/nutrition/shopping/" + plan.id);
  const t = useT("nutrition"),
    locale = useLocale();
  const grams = (value: number) => t("grams", { grams: value });
  return (
    <Card title={t("purchaseTitle")}>
      {r.error && <Notice>{r.error}</Notice>}
      {r.message && <Notice>{r.message}</Notice>}
      {r.data?.items.map((g: any) => (
        <details key={g.food.id}>
          <summary>
            {t("stillNeeded", {
              food: g.food.name,
              grams: grams(g.remainingGrams),
              state: t.dynamic(
                `prep_${g.food.preparation}`,
                humanize(g.food.preparation).toLowerCase(),
              ),
            })}
          </summary>
          <p>
            {t("availableGrams", { grams: grams(g.availableGrams) })}{" "}
            {g.purchaseGrams === null
              ? t("noConversion")
              : `${
                  g.packs === null
                    ? t("purchased", { grams: grams(g.purchaseGrams) })
                    : t("purchasedPacks", {
                        grams: grams(g.purchaseGrams),
                        packs: t("packs", { count: g.packs }),
                        total: grams(g.purchasedGrams),
                      })
                } ${g.purchaseLabel ?? ""}`}
          </p>
          {g.conversionSource && (
            <p>{t("conversionSource", { source: g.conversionSource })}</p>
          )}
          {!readOnly && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void r.action(
                  () =>
                    api("/nutrition/leftovers", "POST", {
                      eventKey: crypto.randomUUID(),
                      foodId: g.food.id,
                      grams: num(f, "grams"),
                      useBy: f.get("useBy"),
                      notes: f.get("notes"),
                      confirmedStorage: true,
                    }),
                  t("portionRecorded"),
                );
              }}
            >
              <Field label={t("gramsAvailable")}>
                <input
                  name="grams"
                  type="number"
                  min={0.01}
                  max={100000}
                  step={0.01}
                  required
                />
              </Field>
              <Field label={t("useBy")}>
                <input name="useBy" type="date" min={r.data.today} required />
              </Field>
              <Field label={t("batchNote")}>
                <input name="notes" maxLength={1000} />
              </Field>
              <label className="check">
                <input type="checkbox" required /> {t("checkedStorage")}
              </label>
              <button className="button secondary">{t("addPortion")}</button>
            </form>
          )}
        </details>
      ))}
      {r.data?.inventory
        .filter((i: any) => i.status === "available")
        .map((i: any) => (
          <p key={i.id}>
            {t("inventoryLine", {
              food: i.data.food.name,
              grams: grams(i.data.grams),
              date: formatDate(i.data.useBy, {
                locale,
                fallback: i.data.useBy,
              }),
            })}{" "}
            {i.data.useBy < r.data.today ? t("excluded") : ""}
            {!readOnly && (
              <button
                className="button secondary"
                onClick={() =>
                  void r.action(
                    () =>
                      api(
                        "/nutrition/leftovers/" + i.id + "/remove",
                        "POST",
                        {},
                      ),
                    t("portionRemoved"),
                  )
                }
              >
                {t("markUsed")}
              </button>
            )}
          </p>
        ))}
      <p>{t("portionsNote")}</p>
    </Card>
  );
}

function NutritionLearningView() {
  const r = useNutrition("/nutrition/learning"),
    [selected, setSelected] = useState<string>("");
  const question =
    r.data?.questions.find((q: any) => q.key === selected) ??
    r.data?.questions[0];
  return (
    <>
      <Card title="What should your assistant learn next?">
        <p>
          Questions follow missing decision details, contrasting examples and
          the exceptions your clients encounter.
        </p>
        {r.error && <Notice>{r.error}</Notice>}
        {r.message && <Notice>{r.message}</Notice>}
        {r.data?.conflicts.map((c: any, i: number) => (
          <Notice key={i}>
            {c.message} Cases:{" "}
            {c.caseIds
              .map((id: string) =>
                r.data.cases
                  .find((x: any) => x.id === id)
                  ?.data.scenario.slice(0, 80),
              )
              .join(" / ")}
            . Correct them in Teach through cases before activating a release.
          </Notice>
        ))}
        {r.data?.questions.map((q: any) => (
          <button
            key={q.key}
            className="button secondary"
            onClick={() => setSelected(q.key)}
          >
            {q.category}: {q.reason}
          </button>
        ))}
        {question && (
          <CaseForm
            key={question.key}
            initial={{ category: question.category, scenario: question.prompt }}
            onSubmit={(b) =>
              r.action(
                () => api("/nutrition/cases", "POST", b),
                "Case saved. Next questions and conflict checks updated.",
              )
            }
          />
        )}
      </Card>
      <Card title="Teaching and held-out coverage">
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Area</th>
                <th>Taught</th>
                <th>Conditions captured</th>
                <th>Held-out</th>
                <th>Worked meals</th>
              </tr>
            </thead>
            <tbody>
              {r.data?.coverage.map((c: any) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td>{c.taught}</td>
                  <td>{c.structured}</td>
                  <td>{c.heldOut}</td>
                  <td>{c.mealChecks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Conflicts flag matching conditions and inconsistent decisions. The
          coach resolves ambiguous wording; this screen does not claim to
          understand every possible contradiction.
        </p>
        <Link href="/trainer/nutrition/scenarios">
          Check unseen client cases{" "}
          <span className="bidi-mirror" aria-hidden="true">
            →
          </span>
        </Link>
      </Card>
    </>
  );
}
