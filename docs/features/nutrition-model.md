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
  only accepted the boundaries case, so no release could ever pass. (Scenarios are sent without
  their category on purpose: working out the category is part of what the check tests; see
  section 6.)

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

### 3a. Coach boundaries come before any week (review round)

The first v3 prompt told the model the supplied options "already fit this client" and allowed a
decline only when "no week can meet every limit". It never mentioned the policy's boundaries or
the client's notes, and the same branch removed the ID and timeout errors that had turned such
weeks into exceptions by accident. In the trial, T2S05 (osteopenia, takes vitamin D; T2 sends
osteoporosis and medication to the coach) and T3S02 (eats only at suhoor and iftar; T3 sends
Ramadan meal timing to the coach) passed every code gate: only the model's decline stopped
their weeks, and Haiku returned full weeks for both. Now two layers stop them:

- **Code screen first.** `nutritionScopeSignals` (`packages/domain/src/nutrition.ts`), which
  `nutritionTarget` runs on the profile's notes, goal, diet, exclusions and allergens before any
  model call, also matches bone density conditions (osteoporosis, osteopenia, low bone density),
  vitamin and mineral supplementation, deficiencies and anaemia, and fasting and Ramadan meal
  timing (fasting, Ramadan, suhoor, iftar), in English and Arabic (هشاشة/ترقق العظام، فيتامين،
  حبوب الحديد، فقر الدم، رمضان، صيام، صائمة، أصوم، سحور، أتسحر). A match opens `SCOPE_REVIEW`
  for the coach and no model is paid for. Words that only look similar stay plannable:
  breakfast, fast food, bone broth, calorie deficit, فطور and إفطار (both also mean breakfast,
  so they are not listed), نقص الوزن (weight loss). Protein powders, creatine and a bare
  "supplement" are not listed. The same list also screens the client explanation.
- **The prompt second.** `nutritionWeekInstruction` now opens with the coach's boundaries: read
  the profile (goal, diet, allergies, exclusions and notes) against the policy's boundaries and
  the boundaries teaching case; if anything falls under a boundary (a medical condition, a
  medication or supplement, pregnancy or breastfeeding, an eating disorder, eating times the
  slots cannot follow such as fasting), or the model is not sure, it declines and cites the
  boundaries case. The recipe sentence now says the options were filtered for diet, allergies,
  exclusions, equipment, time and budget only, and that this filtering does not check the
  coach's boundaries. A decline opens `PLAN_NOT_POSSIBLE` with the model's reason for the coach.

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
- A number the teaching does not state **for that field** (for example Haiku's 10% tolerance and
  age 70) is flagged: "Your teaching does not state the daily calorie tolerance of 10% in this
  draft…". The first v3 check accepted a number written anywhere in the teaching, so an invented
  5% tolerance passed on T1's "at most 5 times a week". Now `statedInTeaching`
  (`packages/domain/src/nutrition-policy-draft.ts`) looks for the number next to the field's own
  wording, sentence by sentence (`teachingSentences` folds the text, removes thousands
  separators, reads decimal commas and English number words): a tolerance written as a percent
  (`%`, "percent", `٪`, بالمئة) in a sentence about the range around the target (within, above or
  below, plus or minus, ±, margin, of the target, نطاق, هامش); an age after under, over, aged,
  at least, from, تحت, فوق, أقل من, or before years, +, "or older", سنة; calories with kcal, a
  limit word (below, above, never, between, add, by, a range dash) or in a sentence about
  calories; portions in a sentence about servings; repeats with times, repeat or per week;
  check-ins before "check-ins"; days as days or weeks (seven days each). A number followed by
  another unit (minutes, grams, servings, days, kcal, %) does not count for a different field.
  A case's `scenario` (the client situation or question the coach answered) is not searched, so
  a client's age in it is not a limit. Every value Seed, Opus and Sonnet took from the trial
  teaching is still found; only invented values are flagged.
- A draft with gaps, conflicts or no complete policy cannot be confirmed (`409 POLICY_GAPS`,
  checked before parsing). The coach answers through the existing form, which saves a new draft
  without gaps.

### 6. Recipe drafts and evaluation

- Recipe drafts: references for foods, the reply shape spelled out, slots and diet tags limited
  to the policy's when one exists, 150 s.
- Evaluation: the scenarios do **not** carry their `category` (the first v3 sent it for every
  held-out check, which turned the principle the model must choose into a lookup in
  `categoryPrinciples` and told it which checks were referrals; before v3 the app never exposed
  a coach-written check's category). The model gets the category map, decides the category
  itself and uses `scope_referral` for the system safety checks, whose prompts already start
  with `[boundaries]`. The prompt says which case fields a quote
  may come from (recommendation, reason, avoid, changeWhen or referWhen, not the scenario) and the
  precision to state (kcal to a whole number, grams to one decimal place, ingredient grams to two
  decimals). `checkNutritionSample` accepts exactly that rounding (0.51 kcal, 0.051 g); a claim a
  whole kcal off still fails. The system safety checks accept the boundaries teaching and the
  teaching that sets the violated limit (`acceptedCaseIds`: substitutions for an unknown
  allergy, diet for an unsupported diet, calories for an unsupported goal); the action must still
  be an exception with no meal, and the principle `scope_referral`.
- Arabic teaching can be quoted. `rationaleMatches` (and the case conflict check in
  `nutritionLearning`) compared text with only `a-z` and `0-9` kept, so every Arabic quote became
  empty and a coach who teaches in Arabic could never pass qualification (pre-existing). Both
  now fold the text like the nutrition screens (`foldNutritionText`: hamza and ta marbuta
  spellings, diacritics, Arabic digits) and keep letters and digits of any script.

### Prompt version and readiness

`NUTRITION_PROMPT_VERSION` is now **`nutrition-cases-v3`**. Releases pin it through
`nutritionModelIdentity()`, so after this change existing nutrition releases need a new
evaluation and activation; readiness says "The nutrition assistant's instructions were updated
after activation…" (instead of "The model connection changed") when only the version differs.

Since 30 September 2026 (branch `fix/brain-prompts`) the version is `nutrition-cases-v4`: the
meal-week self-check also counts recipe repeats and checks slots, and an evaluation quote is 4 to 15
consecutive words from the cited case. Releases need a new evaluation and activation. See
`docs/features/brain-prompt-tuning.md`.

### Web

The coach's policy form is prefilled from an incomplete draft (blank values stay empty) and the
coach's exception list shows `coachDetail`. Marketing text is unchanged.

## Tests

- `tests/fix-nutrition-trial.test.ts` (25 tests, no database), on the trial's own catalog,
  teaching, member profiles and replies (`tests/nutrition-trial-fixtures.ts`): budgets above the
  slowest trial replies and leases and proxy timeout above the budgets; the stated range,
  portions, slots and repeats; rounding at the range bounds (days inside the stated range pass,
  0.51 kcal outside fails) for several targets and tolerances; macro ranges; Seed's under-target
  weeks still rejected (validators not weakened); a week planned only from the prompt's numbers
  passes the validator for all eight plannable trial members (the list is checked against every
  code gate); per-serving facts equal the app's arithmetic; the seven impossible trial weeks are
  `CATALOG_GAP` with the right slot (and the eight plannable ones are not); T2S05 and T3S02 and
  15 English and Arabic boundary notes are `SCOPE_REVIEW` before any call while seven look-alike
  notes stay plannable; the week prompt puts the coach's boundaries first and no longer says
  "already fit"; the six trial boundary declines (Seed, Opus, Sonnet for T2S05 and T3S02) decode
  through references to a decline citing the boundaries case; every trial reply that broke a
  rule for those members is still refused by the validator; the Opus declines parse as declines;
  the request carries no full UUID, references decode to the real IDs, the trial's miscopied
  case ID and an unknown reference are refused; recipe references and the 422 path; all twelve
  trial policy replies (Seed's blanks become questions, Opus/Sonnet conflict objects are saved,
  Haiku's invented values are flagged, Haiku's broken replies stay invalid); an invented 5%
  tolerance on T1 and T3 is flagged, and 18 phrasings that state a field's number are found
  while 10 that state the same number for something else (and a client's age in a scenario) are
  not; the seven trial worked meals pass and a 1 kcal error fails; the trial's safety-check
  citations (36 decisions) pass except the five that quote a scenario or use another principle;
  identifiers in the client explanation are refused; an exact Arabic quote (and the same words
  with other hamza, diacritic and punctuation spellings) passes the rationale check while a
  scenario quote, words the case never says, a too-short quote and a wrong principle fail; a
  draft field that cannot be used always comes with a question.
- `tests/fix-nutrition-model.test.ts` (10 tests, PGlite or PostgreSQL): evaluation request (no
  scenario category, the category map, budget, precision and quote wording, references) passes
  with rounded meals and a diet-case citation; the week request (numbers, 150 s, 12,000 tokens,
  references, perServing) delivers a decoded plan; a miscopied, one-character-off or unknown ID
  becomes `GENERATION_UNAVAILABLE` with no plan; a declined week opens `PLAN_NOT_POSSIBLE` with
  the coach-only detail; the trial's T2S05 and T3S02 notes and an Arabic Ramadan note open
  `SCOPE_REVIEW` with no model call and no plan; each of the six trial boundary declines,
  replayed for a note the code screen has no word for, opens `PLAN_NOT_POSSIBLE` with the
  model's reason for the coach, no plan, and a week request that carries the boundary clause and
  the notes; a catalog gap opens `CATALOG_GAP` with no model call and no request, and the
  preview explains it; an in-flight week's manual job lease, `GENERATION_PENDING` three minutes
  into a dispatch and `PROVIDER_RECONCILIATION` after the lease; the worker's claim lease for
  weeks and for other jobs; policy compilation of Seed's, Opus's and Haiku's replies.
- `tests/fix-nutrition-ops.test.ts`: the compile test now recognises the sent sources by title
  (IDs are references) and checks that no full ID is sent.
- `tests/e2e/mocks/model-rules.ts` is unchanged by this track (the evaluation double reads the
  `[category]` prefix the e2e checks' prompts carry, as before).

Mutation checks (each applied, run, then restored): the old tolerance rule (2 tests fail), the old
0.01 sample tolerance (1), rationale without `acceptedCaseIds` (1), no numeric grounding (1),
feasibility without the repeat limit (2), no feasibility pre-check (1), the uncertain check
without the lease exclusion (1), a two-minute claim for weeks (1), declines treated as invalid
(1).

Review round mutation checks (each applied, run, then restored; the tree was compared byte for
byte afterwards): without the new scope terms (3 tests fail), without the bone-density term (1),
without the boundary clause in the week prompt (2), "any number anywhere" grounding again (1),
the case scenario searched for limits again (1), the scenario category sent again (the evaluation
test fails, and the tests that need its release fail after it; the in-flight lease test used to
hang in that case and now waits at most about 20 s), ASCII-only rationale comparison again (1).

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

### Review round (29 September 2026, same worktree)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: both pass on the final tree.
- PGlite, the 35 test files that mention nutrition, the e2e model rules or prompt-refs
  (`node --import tsx --test --test-concurrency=1`): 394 tests, 393 pass, 1 skipped (the
  retirement race needs PostgreSQL), 0 fail. Started before two last edits (comments in
  `nutrition-policy-draft.ts`, the bounded wait in the lease test); `fix-nutrition-trial`,
  `fix-nutrition-model`, `fix-nutrition-ops`, `nutrition`, `fix-nutrition-safety`, `prompt-refs`
  and `e2e-harness-mocks` were run again on the final tree: 100 tests, 100 pass.
- PostgreSQL sandbox (`/opt/tools/pg-sandbox.sh 56549`, 68 migrations, runtime role verified)
  with the same 12 database files as above: 109 tests, 109 pass, `PG_SELECTED_FAILED_FILES=0`
  (started before the two last edits); `fix-nutrition-model` and `fix-nutrition-trial` again on
  the final tree: 35 tests, 35 pass, `PG_SELECTED_FAILED_FILES=0`.
- Mutation checks as listed under Tests.
- Not run in that pass: the e2e harness, the whole test suite, a live model call or a new trial
  run.

### Review round, checks re-run on the committed tree (29 September 2026)

Every finding was verified again against the trial records (the six declines in
`tests/nutrition-trial-fixtures.ts` match `calls-seed.jsonl` and the Opus and Sonnet
`tasks-10.answers.json` replies word for word; Haiku returned full weeks for both members). The
only change after commit `931ef09` is the stale header comment on `NUTRITION_PROMPT_VERSION`
(`packages/providers/src/nutrition.ts`), which still said evaluation scenarios carry their
category. All runs below are on that final tree:

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: both pass.
- PGlite, the 35 test files that mention nutrition, the worker dispatcher, the Next config, the
  e2e model rules, prompt-refs, `foldNutritionText`, `rationaleMatches` or
  `nutritionScopeSignals` (`node --import tsx --test --test-concurrency=1`): 394 tests, 393 pass,
  1 skipped (the retirement race needs PostgreSQL), 0 fail.
- PostgreSQL sandbox (`/opt/tools/pg-sandbox.sh 56556`, 68 migrations, runtime role verified)
  with the 26 database-touching files among those 35, `isolation-follower` and
  `governance-suspension` (from the earlier database set) and `fix-nutrition-trial`: 29 files, 311
  tests, 310 pass, 1 skipped (a consent-history migration replay that runs embedded only), 0
  fail, `PG_SELECTED_FAILED_FILES=0`; the retirement race ran here and passed.
- E2E harness, suites `trainer,follower` (`node scripts/e2e/run.mjs --suites=trainer,follower`,
  including a fresh `next build`): 213 passed, 0 failed, 0 skipped, including AI recipe drafts
  and policy compilation, 24 held-out nutrition checks, the nutrition evaluation (now without a
  scenario category) and sample-week preview, and activation of automatic nutrition delivery.
- Not run: the whole test suite, the other e2e suites, a live model call or a new trial run.

## Limits and follow-ups

- No model was called. The week prompt's effect on Seed's calorie accuracy is argued from the
  trial (Seed kept one serving everywhere; the numbers it now receives are enough to pass the
  validator, as the planning test shows) but is not measured; a new trial run is the check.
- The trial harness copies the old instruction strings verbatim (`brain-full/lib/tasks.mts`
  `verbatim(…)`); it must be refreshed for v3 (the week instruction is now
  `nutritionWeekInstruction(nutritionWeekLimits(…))`, and requests are encoded by `nutritionModel`).
- `expected.json` in the trial marks T1S01, T1S08, T2S04, T3S01, T3S04 and T3S05 as "plan"; the
  catalog cannot fill those weeks (see above), so a re-run should expect `CATALOG_GAP`. T2S05 and
  T3S02 stay exceptions but now end as `SCOPE_REVIEW` before any model call.
- The wider scope screen (section 3a) sends more members to the coach: any vitamin, anaemia or
  deficiency mention, fasting (including intermittent fasting and fasted training) and Ramadan
  meal timing. That is the owner's "when unsure, route to the trainer"; a coach who plans
  Ramadan weeks does so personally. The boundary clause in the week prompt is the second layer
  for boundaries the word list cannot know; its effect on a live model is not measured (the
  trial's Seed, Opus and Sonnet already declined these weeks under v2; Haiku did not).
- `statedInTeaching` reads English and Arabic wording and English number words; Arabic number
  words (خمس، عشرة) are not read, so a limit written only that way is flagged for the coach to
  confirm (safe direction).
- The `brain_plan` job (plan generation up to 240 s) still gets the generic two-minute worker
  lease; that belongs to the plans track.
- The proxy timeout is global for API forwarding (330 s).
- The feasibility energy check is necessary, not sufficient (it ignores the repeat limit when
  bounding a day's kcal); a week it lets through can still be declined or rejected, as before.
