# Nutrition model calls after the September 2026 trial (work package `core/fix-nutrition`, track F4)

Status: implemented on branch `core/fix-nutrition` (from `core/fix-refs`, which adds the
prompt-refs helper). Engineering work with fake model transports and the trial's recorded
replies; no model, provider or live server was called, nothing was pushed or deployed. No
migration was needed (081 stays unused).

## Why

The end-to-end model trial (3 trainers, 24 members; Seed 2.0 Pro through ModelArk, Claude
Opus 5.5, Sonnet 5 and Haiku 4.5) found app problems in every nutrition workflow that cut every
model's score. Evidence: `brain-full/summary-*.md`, `results-*.json`, `calls-seed.jsonl` and the
Claude answer files in the trial scratchpad; the replies used here are copied into
`tests/nutrition-trial-fixtures.ts`.

- **Timeouts.** Every nutrition call had `max_tokens` 12,000 but the default 30 s abort. Seed
  needed up to 49 s for a week (9 of 24 weeks aborted) and 36 s for a six-scenario evaluation
  (2 of 3 aborted). The web forwards API calls through Next's proxy, whose own default timeout is
  also 30 s, and the worker leased a weekly job for two minutes.
- **Weeks missed the numbers.** Seed's weeks were 20 to 35 percent under the daily target (it
  kept one serving everywhere) and put breakfast recipes at dinner. The prompt said "respect daily
  calorie tolerance" but never gave the range, the recipes' calories, or each recipe's slots.
- **Weeks that could not exist.** For T1S01, T1S04, T1S08, T3S05 (no dinner recipe fits the
  member's equipment and time), T3S01 and T3S04 (one usable dinner or breakfast recipe, at most
  5 uses a week) and T2S04 (three usable lunch/dinner recipes, at most 4 uses each, 14 meals
  needed) no valid week exists. Opus and Sonnet said so with `{"days":[]}`, which the schema
  rejected as broken output; Seed and Haiku bent a rule instead.
- **Miscopied IDs.** Seed miscopied T1's boundaries case ID (`caseIds.7`) in every T1 week, and
  IDs in the T1 evaluation and policy.
- **Policy compilation.** No trainer taught a daily calorie tolerance. Seed left
  `tolerancePercent` (and some ages) `null` inside the policy; Opus and Sonnet returned
  `policy: null` with questions but wrote conflicts as `{description, sourceIds}` objects. The
  strict schema rejected all of them as invalid output, so the coach saw an error instead of the
  questions. Haiku invented a 10% tolerance and a maximum age of 70.
- **Evaluation.** Every model's worked meal failed "nutrient claims disagree" by rounding alone
  (572 kcal stated for 571.8, 33.1 g for 33.09 g; the check allowed 0.01). Every model cited the
  diet or calories teaching for the unsupported-diet and unsupported-goal safety checks, which
  only accepted the boundaries case, so no release could ever pass. Scenarios were sent without
  their category although the category-to-principle map was.

## What changed

### 1. Budgets, timeouts and leases

- `nutritionBudget(task, { scenarios })` (`packages/providers/src/nutrition.ts`), like
  `planGenerationBudget`: weeks, policies and recipe drafts keep 12,000 tokens and get
  30 s + 10 ms per budgeted token = **150 s**; an evaluation gets
  `min(27000, max(12000, 4000 + 550 × scenarios))` tokens and the matching time, **at most 300 s**
  (the cap `modelCompletion` applies). `nutritionModel` passes both to `modelCompletion`.
- `NUTRITION_WEEK_LEASE_SECONDS` = week timeout + 90 s = **240 s**. The worker's claim of a
  `nutrition_week` job (`apps/worker/src/dispatch.ts`), the manual job a member's request
  creates, the request's "running" window (`GENERATION_PENDING`), the "interrupted before dispatch"
  window and the scheduler's automatic not-sent recovery all use it, so no second attempt starts
  while one is in flight. Other job kinds keep two minutes.
- A request that is still inside its lease is reported as `GENERATION_PENDING`, not as
  `PROVIDER_RECONCILIATION`; only after the lease does an unanswered dispatch need the coach.
- `apps/web/next.config.ts` sets `experimental.proxyTimeout` to 330 s, so the web's API
  forwarding no longer cuts interactive calls (a member's "Prepare my week", the coach's
  evaluation, preview, compilation and recipe draft) at 30 s.

### 2. Meal weeks state their numbers, and are checked with the same numbers

- The week instructions are built per request by `nutritionWeekInstruction(nutritionWeekLimits(…))`
  (`packages/domain/src/nutrition-planning.ts`): the seven days, the exact slots, servings from
  min to max in 0.25 steps, the daily kcal **range as whole numbers** (target ± tolerance,
  rounded inward), the macro ranges of an individual target, the repeat limit counted across
  slots, "use a recipe only in a slot listed in its slots", the reply shape, and the self-check:
  "add up each day's kcal (and macros) from servings × perServing and change servings until every
  day is inside its range".
- Every cooking option in a week prompt carries `perServing` nutrients computed from the coach's
  ingredient facts (`recipesWithServingFacts`), so the model scales known numbers instead of
  re-deriving them from grams.
- The validators are kept. `dailyKcalRange(target, tolerancePercent)` is the one range both the
  prompt and `validateNutritionWeek` use: a day passes when its total, rounded to whole kcal as
  clients see it, is inside the range. Before, the check was `|total − target| ≤ target × tol +
  0.01` on unrounded totals, so a day the model kept at the stated bound could fail by a fraction
  of a kcal; the new rule differs from the old by at most 0.5 kcal at each end. Macro goals use
  `macroRange` (goal ± max(1 g, tolerance), rounded inward to 0.1 g) in both places the same way.
- The explanation shown to the client is also refused (and replaced by the neutral one) when it
  names a record identifier.

### 3. Impossible weeks go to the coach, before any model call

- `nutritionWeekFeasibility` runs before the request record, job and model call. It finds: a
  meal slot with no recipe option that fits the member (diet, allergies, exclusions, equipment,
  time, budget); too few fitting recipes for seven days under the repeat limit (an exact
  max-flow condition over every group of slots: each group needs 7 meals per slot, a recipe gives
  at most its repeat limit in total and 7 per slot); a daily range no allowed portion can reach.
  Any of these opens a `CATALOG_GAP` exception: the client reads a general message, the coach's
  exception list also shows the detail (which slot, which recipes, the member's constraints).
  No model is paid for. The coach's preview answers 409 with the detail.
- A model may still decline a week: `{"days":[],"caseIds":[…],"explanation":"…"}` is accepted as
  a reply shape. It opens a `PLAN_NOT_POSSIBLE` exception with the model's reason kept as the
  coach-only `coachDetail`; the client's view and the request record carry only the general
  message. The daily scheduler does not pay for the same request again (existing rule for
  provider-answered failures).

### 4. Short identifier references in every nutrition call

`nutritionModel` builds one `createPromptRefs` table per request over `{task, promptVersion,
input}` and sends the encoded payload: recipes `M…`, ingredient facts `G…`, teaching cases `X…`,
sources `S…`, held-out scenarios `Q…`, anything else `ID…`. The system prompt adds
`promptRefsInstruction`. The reply is decoded with the task's `idKeys` (`nutritionIdKeys`):

| Task | `idKeys` |
| --- | --- |
| `nutrition_week` | `recipeId`, `caseIds` |
| `nutrition_recipe` | `foodId` |
| `nutrition_policy` | `sourceIds` |
| `nutrition_evaluation` | `scenarioId`, `caseIds`, `caseId`, `recipeId`, `foodId` |

Any issue (unknown reference, unknown or malformed UUID) is invalid model output
(`ModelOutputInvalid`, routed to the coach as before), never a near match; a recipe draft keeps
its `422 UNKNOWN_FOOD`. Prose is decoded too, so a reference in text becomes the real ID (never
stored as a reference); the client-facing explanation is then replaced as above.

### 5. Policy compilation: blanks become questions for the coach

`nutritionPolicyDraft` (`packages/domain/src/nutrition-policy-draft.ts`) turns the reply into the
stored draft instead of rejecting it:

- The reply schema accepts a policy with blank fields, gaps and conflicts as text or as objects
  carrying the text (`{description, sourceIds}`); anything else (Haiku's `{"policies":…}`) is still
  invalid output and nothing is saved.
- Each blank or unusable field becomes one precise question (unless the model already asked about
  it); the draft is saved with `policy: null` and `partialPolicy` (the usable fields), which
  prefills the coach's policy form. Boundaries written as a list are joined; a switched-off
  adjustment with blank numbers gets inert values (no calorie change); a missing title gets a
  neutral name; source references are limited to the supplied cases and sources.
- A number that no teaching text states (for example Haiku's 10% tolerance and age 70) is
  flagged: "Your teaching does not state the daily calorie tolerance of 10% in this draft…".
- A draft with gaps, conflicts or no complete policy cannot be confirmed (`409 POLICY_GAPS`,
  checked before parsing). The coach answers through the existing form, which saves a new draft
  without gaps.

### 6. Recipe drafts and evaluation

- Recipe drafts: references for foods, the reply shape spelled out, slots and diet tags limited
  to the policy's when one exists, 150 s.
- Evaluation: each scenario carries its `category`; the prompt says which case fields a quote
  may come from (recommendation, reason, avoid, changeWhen or referWhen, not the scenario) and the
  precision to state (kcal to a whole number, grams to one decimal place, ingredient grams to two
  decimals). `checkNutritionSample` accepts exactly that rounding (0.51 kcal, 0.051 g); a claim a
  whole kcal off still fails. The system safety checks accept the boundaries teaching and the
  teaching that sets the violated limit (`acceptedCaseIds`: substitutions for an unknown
  allergy, diet for an unsupported diet, calories for an unsupported goal); the action must still
  be an exception with no meal, and the principle `scope_referral`.

### Prompt version and readiness

`NUTRITION_PROMPT_VERSION` is now **`nutrition-cases-v3`**. Releases pin it through
`nutritionModelIdentity()`, so after this change existing nutrition releases need a new
evaluation and activation; readiness says "The nutrition assistant's instructions were updated
after activation…" (instead of "The model connection changed") when only the version differs.

### Web

The coach's policy form is prefilled from an incomplete draft (blank values stay empty) and the
coach's exception list shows `coachDetail`. Marketing text is unchanged.

## Tests

- `tests/fix-nutrition-trial.test.ts` (20 tests, no database), on the trial's own catalog,
  teaching, member profiles and replies (`tests/nutrition-trial-fixtures.ts`): budgets above the
  slowest trial replies and leases and proxy timeout above the budgets; the stated range, portions,
  slots and repeats; rounding at the range bounds (days inside the stated range pass, 0.51 kcal
  outside fails) for several targets and tolerances; macro ranges; Seed's under-target weeks still
  rejected (validators not weakened); a week planned only from the prompt's numbers passes the
  validator for all nine plannable trial members; per-serving facts equal the app's arithmetic;
  the seven impossible trial weeks are `CATALOG_GAP` with the right slot (and the nine plannable
  ones are not); every trial reply that broke a rule for those members is still refused by the
  validator; the Opus declines parse as declines; the request carries no full UUID, references
  decode to the real IDs, the trial's miscopied case ID and an unknown reference are refused;
  recipe references and the 422 path; all twelve trial policy replies (Seed's blanks become
  questions, Opus/Sonnet conflict objects are saved, Haiku's invented values are flagged, Haiku's
  broken replies stay invalid); the seven trial worked meals pass and a 1 kcal error fails; the
  trial's safety-check citations (36 decisions) pass except the five that quote a scenario or use
  another principle; identifiers in the client explanation are refused; a draft field that cannot be used always
  comes with a question.
- `tests/fix-nutrition-model.test.ts` (8 tests, PGlite or PostgreSQL): evaluation request
  (categories, budget, precision and quote wording, references) passes with rounded meals and a
  diet-case citation; the week request (numbers, 150 s, 12,000 tokens, references, perServing)
  delivers a decoded plan; a miscopied, one-character-off or unknown ID becomes
  `GENERATION_UNAVAILABLE` with no plan; a declined week opens `PLAN_NOT_POSSIBLE` with the
  coach-only detail; a catalog gap opens `CATALOG_GAP` with no model call and no request, and the
  preview explains it; an in-flight week's manual job lease, `GENERATION_PENDING` three minutes
  into a dispatch and `PROVIDER_RECONCILIATION` after the lease; the worker's claim lease for
  weeks and for other jobs; policy compilation of Seed's, Opus's and Haiku's replies.
- `tests/fix-nutrition-ops.test.ts`: the compile test now recognises the sent sources by title
  (IDs are references) and checks that no full ID is sent.
- `tests/e2e/mocks/model-rules.ts`: the evaluation double reads the scenario's `category`.

Mutation checks (each applied, run, then restored): the old tolerance rule (2 tests fail), the old
0.01 sample tolerance (1), rationale without `acceptedCaseIds` (1), no numeric grounding (1),
feasibility without the repeat limit (2), no feasibility pre-check (1), the uncertain check
without the lease exclusion (1), a two-minute claim for weeks (1), declines treated as invalid
(1).

## Checks actually run (29 September 2026, worktree `.claude/worktrees/fix-nutrition`)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: both pass on the final tree.
- PGlite, every test file that mentions nutrition, the worker dispatcher, the Next config, the
  e2e model rules or prompt-refs (35 files, `node --import tsx --test --test-concurrency=1`):
  386 tests, 385 pass, 1 skipped (the retirement race needs PostgreSQL), 0 fail. This run began
  before three small final edits (blank ages stay blank in the web form, a one-kcal margin in the
  feasibility energy bound, a fallback question for an unusable draft field); the six files those
  edits reach were run again on the final tree: `fix-nutrition-trial`, `fix-nutrition-model`,
  `fix-nutrition-ops`, `nutrition`, `nutrition-completion`, `prompt-refs`: 81 tests, 81 pass.
- PostgreSQL sandbox (`/opt/tools/pg-sandbox.sh 56540`, 68 migrations, restricted runtime role
  verified) with `fix-nutrition-model`, `nutrition`, `fix-nutrition-ops`, `fix-nutrition-safety`,
  `fix2-safety`, `nutrition-completion`, `isolation-follower`, `governance-suspension`,
  `meal-capture`, `privacy-lifecycle`, `platform-finance`, `onboarding-completion`: 107 tests,
  107 pass, 0 failed files (the retirement race ran here and passed). This run began before the
  three final edits above.
- E2E harness, suites `trainer,follower` (`node scripts/e2e/run.mjs --suites=trainer,follower`,
  on the final code, including `next build`, which lists the `proxyTimeout: 330000` experiment,
  and the TLS edge → web → API path): 213 passed, 0 failed, 0 skipped, including recipe draft and
  policy compilation, evaluation and preview, release, a model-generated week delivered through
  references, a meal swap, the grocery CSV and the calorie-policy guardrail.
- Mutation checks as listed under Tests.
- Not run: the whole test suite, the other e2e suites, a live model call or a new trial run.

## Limits and follow-ups

- No model was called. The week prompt's effect on Seed's calorie accuracy is argued from the
  trial (Seed kept one serving everywhere; the numbers it now receives are enough to pass the
  validator, as the planning test shows) but is not measured; a new trial run is the check.
- The trial harness copies the old instruction strings verbatim (`brain-full/lib/tasks.mts`
  `verbatim(…)`); it must be refreshed for v3 (the week instruction is now
  `nutritionWeekInstruction(nutritionWeekLimits(…))`, and requests are encoded by `nutritionModel`).
- `expected.json` in the trial marks T1S01, T1S08, T2S04, T3S01, T3S04 and T3S05 as "plan"; the
  catalog cannot fill those weeks (see above), so a re-run should expect `CATALOG_GAP`.
- The `brain_plan` job (plan generation up to 240 s) still gets the generic two-minute worker
  lease; that belongs to the plans track.
- The proxy timeout is global for API forwarding (330 s).
- The feasibility energy check is necessary, not sufficient (it ignores the repeat limit when
  bounding a day's kcal); a week it lets through can still be declined or rejected, as before.
