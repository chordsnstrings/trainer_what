"use client";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import Link from "next/link";
import { scaleCapturedPortion } from "../../../packages/domain/src/nutrition-completion";
import {
  nutritionQuestions,
  nutritionCategories,
  localDate,
} from "../../../packages/domain/src/nutrition";

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Request failed"), {
      status: r.status,
    });
  return data;
}
const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const num = (f: FormData, key: string) => Number(f.get(key));
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
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
  const load = useCallback(async () => {
    const d = await api(path);
    setData(d);
    return d;
  }, [path]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function action(fn: () => Promise<any>, success = "Saved") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      await load();
      setMessage(result?.status === "exception" ? result.message : success);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { data, setData, error, setError, busy, message, action, load };
}
const sections = [
  ["overview", "Overview"],
  ["cases", "Teach through cases"],
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
                    Set the two subscription prices →
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
                Expected answers are withheld from the model.
              </p>
              <ScenarioForm
                cases={d.cases}
                policy={d.policy?.data.policy}
                submit={submit}
              />
            </Card>
            <Card title="Held-out cases">
              <p>
                {
                  d.records.filter((x: any) => x.kind === "nutrition_scenario")
                    .length
                }{" "}
                cases saved.
              </p>
              {d.records
                .filter((x: any) => x.kind === "nutrition_scenario")
                .map((x: any) => (
                  <details key={x.id}>
                    <summary>
                      {x.data.category} · {x.data.prompt.slice(0, 100)}
                    </summary>
                    <p>
                      Expected: {x.data.expect} ·{" "}
                      {x.data.expectedTargetKcal ?? "No target"} kcal
                    </p>
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
                Continue to subscription offers →
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
                  {m.name} →
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
                    Inspect client nutrition →
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
        <Field label="Age">
          <input
            name="age"
            type="number"
            min={18}
            max={100}
            defaultValue={initial?.age}
            required
          />
        </Field>
        <Field label="Goal (as agreed with your coach)">
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
        <Field label="Diet preference">
          <input
            name="diet"
            defaultValue={initial?.diet}
            required
            placeholder="balanced, vegetarian…"
          />
        </Field>
        <Field label="Allergy information">
          <select
            name="allergyStatus"
            defaultValue={initial?.allergyStatus ?? "unknown"}
          >
            <option value="unknown">Not supplied yet</option>
            <option value="none_reported">No allergies reported</option>
            <option value="reported">Allergies reported below</option>
            <option value="declined">Prefer not to supply</option>
          </select>
        </Field>
        <Field label="Reported allergens (comma separated)">
          <input
            name="allergens"
            defaultValue={initial?.allergens?.join(", ")}
          />
        </Field>
        <Field label="Other excluded foods">
          <input
            name="exclusions"
            defaultValue={initial?.exclusions?.join(", ")}
          />
        </Field>
        <Field label="Available equipment">
          <input
            name="equipment"
            defaultValue={initial?.equipment?.join(", ")}
            placeholder="hob, oven, air fryer…"
          />
        </Field>
        <Field label="Maximum preparation time (minutes)">
          <input
            name="minutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={initial?.maxMinutes ?? 30}
            required
          />
        </Field>
        <Field label="Food budget">
          <select name="budget" defaultValue={initial?.budget ?? "moderate"}>
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="flexible">Flexible</option>
          </select>
        </Field>
        <Field label="Nutrition scope">
          <select name="scope" defaultValue={initial?.scopeStatus ?? "unknown"}>
            <option value="unknown">Needs clarification</option>
            <option value="general_wellness">General wellness coaching</option>
            <option value="specialist_needed">
              I need specialist dietary guidance
            </option>
          </select>
        </Field>
        <Field label="Timezone">
          <input
            name="timezone"
            defaultValue={initial?.timezone ?? "Asia/Dubai"}
            required
          />
        </Field>
      </div>
      <Field label="Practical preferences or questions">
        <textarea name="notes" defaultValue={initial?.notes} />
      </Field>
      {mode === "client" && (
        <>
          <label className="check">
            <input type="checkbox" required /> Allow this coach and platform to
            process this nutrition profile for my coaching.
          </label>
          <label className="check">
            <input type="checkbox" name="ai" /> Allow my nutrition information
            to be sent to the configured AI service for nutrition coaching. I
            can revoke this separately.
          </label>
        </>
      )}
      <button className="button">
        {mode === "preview"
          ? "Prepare sample week"
          : mode === "scenario"
            ? "Save this held-out case"
            : "Save nutrition profile"}
      </button>
    </form>
  );
}
function ScenarioForm({
  cases,
  policy,
  submit,
}: {
  cases: any[];
  policy: any;
  submit: (p: string, b: any, m?: string) => Promise<any>;
}) {
  const [prompt, setPrompt] = useState(""),
    [category, setCategory] = useState("diet"),
    [expect, setExpect] = useState("plan"),
    [target, setTarget] = useState(""),
    [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  return (
    <>
      <div className="nutrition-form-grid">
        <Field label="Decision area">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
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
  return (
    <Card title="Your week of meals">
      <div className="nutrition-week-heading">
        <p>
          {view.weekStart} — {view.weekEnd}
        </p>
        <span className="badge">Approx. {view.targetKcal} kcal / day</span>
      </div>
      <p>{view.explanation}</p>
      <nav className="nutrition-days" aria-label="Meal plan days">
        {view.days.map((d: any) => (
          <button
            key={d.date}
            className={date === d.date ? "selected" : ""}
            onClick={() => setDate(d.date)}
          >
            <span>
              {new Date(d.date + "T12:00:00Z").toLocaleDateString("en", {
                weekday: "short",
              })}
            </span>
            {d.date.slice(5)}
          </button>
        ))}
      </nav>
      {day && (
        <>
          <div className="nutrition-day-total">
            <strong>{day.date}</strong>
            <span>
              Approx. {day.totals.kcal} kcal · protein{" "}
              {day.totals.protein ?? "unknown"} g · carbohydrate{" "}
              {day.totals.carbohydrate ?? "unknown"} g · fat{" "}
              {day.totals.fat ?? "unknown"} g
            </span>
          </div>
          <div className="nutrition-meals">
            {day.meals.map((m: any) => (
              <article className="nutrition-meal" key={m.slot}>
                <p className="eyebrow">{m.slot}</p>
                <h3>{m.name}</h3>
                <p>
                  {m.servings} serving(s) · approx. {m.nutrients.kcal} kcal
                </p>
                <p className="muted">
                  {m.cookingName} · {m.minutes} min ·{" "}
                  {m.equipment.join(", ") || "No cooking equipment"}
                </p>
                <details>
                  <summary>Ingredients & cooking instructions</summary>
                  <ul>
                    {m.ingredients.map((i: any) => (
                      <li key={i.food.id}>
                        {i.grams} g {i.food.name} (
                        {i.food.preparation.replaceAll("_", " ")})
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
                    <p>
                      Shared preparation batch: {m.batchKey}. The grocery list
                      includes each allocated portion once.
                    </p>
                  )}
                  <p className="muted">
                    Recipe source: {m.source}. Ingredient estimates are saved
                    with this plan.
                  </p>
                </details>
                <div className="nutrition-actions">
                  {onLog && (
                    <button
                      className="button secondary"
                      onClick={() => onLog(day, m)}
                    >
                      Log this meal
                    </button>
                  )}
                  {onSwap && (
                    <button
                      className="button secondary"
                      onClick={() => onSwap(day, m)}
                    >
                      Change meal or cooking option
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <p className="muted">
        Calories are estimates. Ingredient amounts state whether the food is
        weighed raw, cooked or ready to eat.
      </p>
    </Card>
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
    [cache, setCache] = useState(false);
  const key = "trainer:nutrition:" + tenantId + ":" + userId,
    queueKey = key + ":queue";
  useEffect(() => {
    setOffline(!navigator.onLine);
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    try {
      setQueued(JSON.parse(localStorage.getItem(queueKey) ?? "[]"));
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
      localStorage.removeItem(key);
      localStorage.removeItem(queueKey);
      setQueued([]);
      setCache(false);
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
    let pending: any[];
    try {
      pending = JSON.parse(localStorage.getItem(queueKey) ?? "[]");
    } catch {
      return;
    }
    for (const entry of pending) {
      try {
        await api("/nutrition/logs", "POST", entry);
        const rest = JSON.parse(localStorage.getItem(queueKey) ?? "[]").filter(
          (e: any) => e.eventKey !== entry.eventKey,
        );
        localStorage.setItem(queueKey, JSON.stringify(rest));
        setQueued(rest);
      } catch (e) {
        if ([401, 402, 403].includes((e as any).status)) {
          localStorage.removeItem(key);
          localStorage.removeItem(queueKey);
          setQueued([]);
          r.setError(
            "Nutrition syncing stopped because access or permission changed. Local nutrition data was cleared.",
          );
        } else r.setError((e as Error).message);
        break;
      }
    }
    if (navigator.onLine) await r.load();
  }
  useEffect(() => {
    if (!offline && navigator.onLine)
      void sync().catch((e) => r.setError((e as Error).message));
  }, [offline, queueKey]);
  async function queue(body: any) {
    const entries = JSON.parse(localStorage.getItem(queueKey) ?? "[]");
    entries.push(body);
    localStorage.setItem(queueKey, JSON.stringify(entries));
    setQueued(entries);
    if (navigator.onLine) await r.action(sync, "Meal recorded");
  }
  const d = r.data;
  if (!d) return <Notice>{r.error || "Loading your nutrition…"}</Notice>;
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
          <p className="eyebrow">EAT WELL, WITH YOUR COACH</p>
          <h1>Nutrition</h1>
          <p>Your meals, preparation and shopping, connected.</p>
        </div>
        <span className="badge">
          {d.entitled ? "Workout + nutrition" : "Nutrition membership required"}
        </span>
      </div>
      <nav className="tabs nutrition-tabs" aria-label="Your nutrition">
        {[
          ["today", "Meal plan"],
          ["groceries", "Weekly groceries"],
          ["profile", "Food preferences"],
          ["diary", "Meal diary"],
          ["checkin", "Check in"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={tab === k ? "selected" : ""}
          >
            {l}
          </button>
        ))}
      </nav>
      {r.error && (
        <p className="notice error" role="alert">
          {r.error}
        </p>
      )}
      {r.message && <Notice>{r.message}</Notice>}
      {offline && (
        <Notice>
          Offline. Saved plans are a reference copy. Meal entries stay on this
          device until access and permission can be checked again.
        </Notice>
      )}
      {queued.length > 0 && (
        <Notice>
          {queued.length} meal entry/entries waiting to sync.{" "}
          {!offline && (
            <button
              className="button secondary"
              onClick={() => void r.action(sync, "Diary synced")}
            >
              Sync now
            </button>
          )}
        </Notice>
      )}
      {!d.entitled && (
        <Notice>
          Choose your coach's workout + nutrition membership for new nutrition
          plans. Your previous records remain available.{" "}
          <Link href="/app/membership">Membership options →</Link>
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
      <fieldset className="nutrition-fieldset" disabled={r.busy}>
        {d.records.filter((x: any) => x.kind === "nutrition_plan").length >
          1 && (
          <Field label="Meal week">
            <select
              value={plan?.id ?? ""}
              onChange={(e) => setSelectedPlan(e.target.value)}
            >
              {d.records
                .filter((x: any) => x.kind === "nutrition_plan")
                .map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {x.data.view.weekStart} — {x.data.view.weekEnd} ·{" "}
                    {x.status.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {tab === "today" && (
          <>
            {!coachView && (
              <Card title={plan ? "Plan your next week" : "Your first week"}>
                {!d.profile ? (
                  <p>
                    Start with{" "}
                    <button
                      className="nutrition-text-button"
                      onClick={() => setTab("profile")}
                    >
                      your food preferences and permissions
                    </button>
                    .
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
                        "Your meal week is ready",
                      );
                    }}
                  >
                    <Field label="Week starts">
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
                      Prepare my week
                    </button>
                  </form>
                )}
                {!d.ready && (
                  <p>
                    Your coach's nutrition setup is not ready for new automatic
                    plans yet.
                  </p>
                )}
                {d.profile && !d.modelConsent && (
                  <p>
                    Enable AI nutrition permission in Food preferences to
                    request an automatic plan.
                  </p>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={cache}
                    onChange={(e) => {
                      setCache(e.target.checked);
                      if (!e.target.checked) localStorage.removeItem(key);
                    }}
                  />{" "}
                  Keep a private copy of the latest plan on this device for up
                  to 12 hours.
                </label>
              </Card>
            )}
            {plan ? (
              <>
                <Notice>
                  {plan.data.synthetic ||
                  plan.data.origin === "synthetic_fixture"
                    ? "Demonstration plan with synthetic food and coach data. It has not been qualified for personal use."
                    : plan.status === "delivered"
                      ? "This plan follows your coach's qualified nutrition rules."
                      : "Historical plan — your preferences, permission or coach context may have changed. Prepare a new week before following it."}
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
              <Card title="Your meals will appear here">
                <p>
                  Complete your profile and prepare a week. You will receive
                  recipes, portions, cooking instructions and a grocery list
                  together.
                </p>
              </Card>
            )}
            {swap && options && (
              <Card title="Choose a permitted alternative">
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
                        "Meal and grocery quantities updated",
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
                  <Field label="Recipe">
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
                  <Field label="Cooking option">
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
                            {v.name} · {v.minutes} min
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Servings">
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
                  <p>
                    Diet, ingredient restrictions, calories and portions are
                    rechecked before the change is delivered.
                  </p>
                  <button className="button">Apply change</button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setSwap(null)}
                  >
                    Cancel
                  </button>
                </form>
              </Card>
            )}
          </>
        )}
        {tab === "groceries" && (
          <Card title="One list for the week">
            {plan ? (
              <>
                <p>
                  {plan.data.view.weekStart} — {plan.data.view.weekEnd}.
                  Quantities are the ingredients used by the planned portions;
                  shop pack sizes separately.
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
                      "Pantry checklist saved",
                    )
                  }
                />
                {!coachView && (
                  <a
                    className="button secondary"
                    href={"/api/v1/nutrition/groceries/" + plan.id}
                  >
                    Download grocery list
                  </a>
                )}
                {plan.data.groceryChanges && (
                  <p className="muted">
                    This list includes your latest meal changes. Previously
                    purchased ingredients may remain in your pantry.
                  </p>
                )}
              </>
            ) : (
              <p>Prepare a meal week to generate its grocery list.</p>
            )}
          </Card>
        )}
        {tab === "profile" && (
          <Card title="Your food preferences and permissions">
            {coachView ? (
              <p>
                {profile
                  ? `${profile.goal} · ${profile.diet} · ${profile.maxMinutes} minutes to prepare a meal`
                  : "No profile supplied."}
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
                        "Preferences saved. Prepare a new week using the updated information.",
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
                        "AI nutrition permission revoked",
                      )
                    }
                  >
                    Revoke AI nutrition permission
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
                        "Nutrition processing permission revoked",
                      )
                    }
                  >
                    Revoke nutrition processing
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
            <Card title="What you recorded">
              <p>
                {d.twin.loggedMeals ?? 0} meals across {d.twin.loggedDays ?? 0}{" "}
                days in the last 28 days. Missing entries do not mean missed
                meals.
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
                  <details key={x.id}>
                    <summary>
                      {x.data.date} · {x.data.name} · {x.data.kcal ?? "Unknown"}{" "}
                      kcal
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
                              "Meal saved to favorites; refresh the favorites list to see it",
                            )
                          }
                        >
                          Save to favorites
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
              <Card title="Add a meal">
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
          <Card title="How is the plan working for you?">
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
                    "Check-in saved. Changes follow your coach's explicit rules and review limits.",
                  );
                }}
              >
                <div className="nutrition-form-grid">
                  <Field label="Hunger: 1 (low) to 5 (high)">
                    <input
                      name="hunger"
                      type="number"
                      min={1}
                      max={5}
                      defaultValue={3}
                      required
                    />
                  </Field>
                  <Field label="Difficulty following the plan: 1 (easy) to 5 (hard)">
                    <input
                      name="difficulty"
                      type="number"
                      min={1}
                      max={5}
                      defaultValue={3}
                      required
                    />
                  </Field>
                  <Field label="Weight in kg (optional)">
                    <input
                      name="weight"
                      type="number"
                      min={1}
                      max={500}
                      step={0.1}
                    />
                  </Field>
                </div>
                <Field label="What helped or got in the way?">
                  <textarea name="notes" />
                </Field>
                <button className="button" disabled={!permitted}>
                  Save check-in
                </button>
              </form>
            )}
            {d.records
              .filter((x: any) => x.kind === "nutrition_checkin")
              .map((x: any) => (
                <p key={x.id}>
                  {x.data.date} · hunger {x.data.hunger}/5 · difficulty{" "}
                  {x.data.difficulty}/5
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
                {g.food.preparation.replaceAll("_", " ")} ·{" "}
                {g.food.allergens.length
                  ? "Allergens: " + g.food.allergens.join(", ")
                  : "Check the product label"}
              </small>
            </span>
            <b>{g.grams} g</b>
          </label>
        ))}
      </div>
      <p>
        Check ingredients already in your pantry or purchased. This does not
        change your meal quantities.
      </p>
      <button
        className="button secondary"
        disabled={disabled}
        onClick={() => void onSave(selected)}
      >
        Save shopping progress
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
        <Field label="Date">
          <input
            type="date"
            name="date"
            max={today}
            defaultValue={initial?.date ?? today}
            required
          />
        </Field>
        <Field label="Meal">
          <input name="name" defaultValue={initial?.name} required />
        </Field>
        <Field label="Approximate kcal (optional)">
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
      <Field label="Portion description">
        <input
          name="portionLabel"
          maxLength={200}
          defaultValue={initial?.portionLabel ?? ""}
        />
      </Field>
      {!items.length && (
        <div className="nutrition-form-grid">
          {[
            ["protein", "Protein"],
            ["carbohydrate", "Carbohydrate"],
            ["fat", "Fat"],
          ].map(([key, label]) => (
            <Field key={key} label={label + " grams (optional)"}>
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
            {item.name} · {item.amount ?? "Unknown"} {item.unit ?? ""}
          </summary>
          <div className="nutrition-form-grid">
            <Field label="Food name">
              <input
                value={item.name}
                onChange={(e) => edit(index, { name: e.target.value })}
                required
              />
            </Field>
            <Field label="Portion">
              <input
                value={item.portion}
                onChange={(e) => edit(index, { portion: e.target.value })}
                required
              />
            </Field>
            <Field label="Amount">
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
            <Field label="Unit">
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
                <option value="">Unknown</option>
                <option value="g">Grams</option>
                <option value="ml">Millilitres</option>
                <option value="portion">Portion</option>
              </select>
            </Field>
            {["kcal", "protein", "carbohydrate", "fat"].map((key) => (
              <Field key={key} label={key}>
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
            Remove food from this entry
          </button>
        </details>
      ))}
      {items.length > 0 && (
        <p>
          Corrected meal total: {sum("kcal") ?? "Unknown"} kcal. Quantities
          rescale nutrients only within the same unit; changing units requires
          checked values.
        </p>
      )}
      <Field label="Notes">
        <textarea name="notes" defaultValue={initial?.notes} />
      </Field>
      {initial && (
        <label className="check">
          <input name="deleted" type="checkbox" /> Remove this entry from my
          totals, retaining its correction history
        </label>
      )}
      <button className="button secondary">
        {initial ? "Save correction" : "Record meal"}
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
              <option value="provider_confirmed_not_processed">
                Provider confirmed not processed
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
  const t = target.data.target;
  return (
    <Card title="Your coach's individual targets">
      <p>
        {t.kcal} kcal · review by {t.reviewOn}
      </p>
      <p>
        {[
          t.protein !== null ? `${t.protein} g protein` : null,
          t.carbohydrate !== null ? `${t.carbohydrate} g carbohydrate` : null,
          t.fat !== null ? `${t.fat} g fat` : null,
          t.hydrationMl !== null ? `${t.hydrationMl} ml fluids` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p>{t.reason}</p>
      <ul>
        {t.habits.map((h: string) => (
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
  useEffect(() => {
    void r.load().catch((e) => r.setError(e.message));
  }, [refreshKey]);
  return (
    <Card title="Recorded nutrition and trends">
      {r.error && <Notice>{r.error}</Notice>}
      {r.data && (
        <>
          <p>{r.data.coverage}</p>
          <p>
            {r.data.loggedMeals} recorded meals across {r.data.loggedDays} days.{" "}
            {r.data.partialInput
              ? "This report reached its input limit; older entries may be omitted."
              : ""}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Recorded kcal</th>
                  <th>Planned kcal</th>
                  <th>Protein g</th>
                  <th>Carbohydrate g</th>
                  <th>Fat g</th>
                </tr>
              </thead>
              <tbody>
                {r.data.days
                  .slice(-7)
                  .reverse()
                  .map((d: any) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>
                        {d.meals
                          ? (d.totals.kcal ??
                            `${d.knownTotals.kcal} known + unknown`)
                          : "No entry"}
                      </td>
                      <td>{d.planned?.kcal ?? "—"}</td>
                      {["protein", "carbohydrate", "fat"].map((k) => (
                        <td key={k}>
                          {d.meals
                            ? (d.totals[k] ??
                              `${d.knownTotals[k]} known + unknown`)
                            : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>All 28 days and weight entries</summary>
            {r.data.days.map((d: any) => (
              <p key={d.date}>
                {d.date}: {d.meals} meals ·{" "}
                {d.totals.kcal ?? "Incomplete or unknown"} kcal
              </p>
            ))}
            <p>
              Recorded weight change:{" "}
              {r.data.weightChangeKg ?? "Not enough recorded measurements"}
              {r.data.weightChangeKg !== null ? " kg" : ""}
            </p>
            {r.data.weights.map((w: any) => (
              <p key={w.sourceId}>
                {w.date}: {w.kg} kg
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
            setMessage("Meal recorded for " + date);
            await onChange();
          })
          .catch((e) => setMessage(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <Field label="Date eaten">
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </Field>
      <button className="button secondary" disabled={busy}>
        Confirm and record again
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
  return (
    <Card title="Saved meals">
      <button
        className="button secondary"
        onClick={() => void r.action(r.load, "Saved meals refreshed")}
      >
        Refresh saved meals
      </button>
      {r.error && <Notice>{r.error}</Notice>}
      {r.data?.length === 0 && (
        <p>Save a recorded meal below to use it again.</p>
      )}
      {r.data?.map((f: any) => (
        <details key={f.id}>
          <summary>
            {f.data.snapshot.name} · {f.data.snapshot.kcal ?? "Unknown"} kcal
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
                "Saved meal removed",
              )
            }
          >
            Remove favorite
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
  return (
    <Card title="Purchase quantities and available portions">
      {r.error && <Notice>{r.error}</Notice>}
      {r.message && <Notice>{r.message}</Notice>}
      {r.data?.items.map((g: any) => (
        <details key={g.food.id}>
          <summary>
            {g.food.name}: {g.remainingGrams} g still needed in the recipe's{" "}
            {g.food.preparation.replaceAll("_", " ")} state
          </summary>
          <p>
            {g.availableGrams} g available.{" "}
            {g.purchaseGrams === null
              ? "No purchase conversion has been provided by your coach."
              : `${g.purchaseGrams} g purchased weight${g.packs === null ? "" : ` → ${g.packs} packs (${g.purchasedGrams} g)`}. ${g.purchaseLabel}`}
          </p>
          {g.conversionSource && <p>Conversion source: {g.conversionSource}</p>}
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
                  "Available portion recorded",
                );
              }}
            >
              <Field label="Grams already available in this preparation state">
                <input
                  name="grams"
                  type="number"
                  min={0.01}
                  max={100000}
                  step={0.01}
                  required
                />
              </Field>
              <Field label="Use by, following actual storage instructions">
                <input name="useBy" type="date" min={r.data.today} required />
              </Field>
              <Field label="Portion or batch note">
                <input name="notes" maxLength={1000} />
              </Field>
              <label className="check">
                <input type="checkbox" required />I checked preparation and
                storage instructions for this food.
              </label>
              <button className="button secondary">
                Add available portion
              </button>
            </form>
          )}
        </details>
      ))}
      {r.data?.inventory
        .filter((i: any) => i.status === "available")
        .map((i: any) => (
          <p key={i.id}>
            {i.data.food.name}: {i.data.grams} g · use by {i.data.useBy}{" "}
            {i.data.useBy < r.data.today
              ? "(excluded from available quantities)"
              : ""}
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
                    "Portion removed from available quantities",
                  )
                }
              >
                Mark used or discard
              </button>
            )}
          </p>
        ))}
      <p>
        Available portions reduce shopping quantities only. They do not change
        prescribed meal portions or count as eaten.
      </p>
    </Card>
  );
}
