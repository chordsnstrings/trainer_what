# Model gateway: current OpenAI models and reply formatting (branch `fix/openai-compat`)

Status: implemented on branch `fix/openai-compat` from `integrate/round2` `0c9569d`, with a review
round (findings C1 to C8 of the retest of the fixed code, below); not merged, not deployed. Code:
`packages/providers/src/model-request.ts` (new), `packages/providers/src/model-accounting.ts`
(`modelCompletion`), the AI model settings in `packages/providers/src/configuration.ts`, the
qualification pins (`coachingModelPin`, `planModelPin`, `nutritionModelIdentity`), the worker's
claim (`apps/worker/src/dispatch.ts`) and every model call site. Tests:
`tests/model-gateway.test.ts` and the voice wording case in `tests/voice-session.test.ts`.

## Why

The live retest of 29 September 2026 (harness notes `app-compat.md`, session scratchpad
`brain-retest`, not committed) sent the app's exact requests to 50 models. Every Brain call sends
`max_tokens` (except voice wording), a low `temperature` (0, 0.1, 0.2 or 0.4) and
`response_format: json_object`. Found:

| Problem | Models | Provider answer (recorded) | Before this branch |
|---|---|---|---|
| `max_tokens` refused | every GPT-5 and GPT-6 model, o1, o3, o3-mini, o4-mini, chat-latest | HTTP 400 `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.` | every call failed |
| non-default `temperature` refused | gpt-5, -mini, -nano, 5.5, 5.6-sol/-terra/-luna, gpt-6-astra/-sol/-luna, o-series, chat-latest (gpt-5.1, 5.2, 5.4 accept it) | HTTP 400 `Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported.`; o1: `Unsupported parameter: 'temperature' is not supported with this model.` | every call failed |
| reply in a code fence | GLM-4.7, GLM-5.2 (JSON mode accepted) | `` ```json\n{...}\n``` `` | strict `JSON.parse` failed: GLM-4.7 passed 0 of 13 app checks |
| reasoning inside the output budget | gpt-5-nano, gpt-5, gpt-5-mini, o1, o3-mini | `finish_reason: length`, all completion tokens reasoning | answer withheld |
| slow reasoning | gpt-5 (10 aborted calls), DeepSeek V4 Pro, GLM-5.2, Seed 2.1 Turbo | the app's abort | chat 30 s limit hit |

A failed call's message was only `Model request failed (400)`: the refused parameter was lost.

## Request style

Super admin, AI model, **Request style** (`MODEL_REQUEST_STYLE`):

- **Automatic** (default): the style follows the model ID (`requestStyleForModel`). Reasoning
  for OpenAI GPT-5 and later (`gpt-5`, `gpt-5-mini`, `gpt-5.1` ... `gpt-6-*`, snapshots such as
  `gpt-5-mini-2025-08-07`), the o-series (`o1`, `o3`, `o3-mini`, `o4-mini`) and `chat-latest`,
  also behind a routing prefix (`openai/gpt-5`) or as a fine-tune (`ft:gpt-5-mini:...`).
  Classic for everything else: GPT-4.1, GPT-4o, gpt-oss, ModelArk Seed, DeepSeek and GLM.
- **Classic**: the request as the call site writes it (`max_tokens`, `temperature`).
- **Reasoning**: `max_tokens` is sent as `max_completion_tokens` with the same value, the
  **Reasoning effort** below is added, and the call's `temperature` is kept only for the models
  that accept one (next paragraph); every other model gets none (the provider default). Messages
  (image parts and their `detail` included), `response_format` and every other field are
  unchanged. The voice wording call sends no output limit, so none is added.

**Temperature in the reasoning style** (`reasoningModelAcceptsTemperature`,
`reasoningKeepsTemperature`): gpt-5.1, gpt-5.2, gpt-5.4, gpt-5.4-mini and gpt-5.4-nano (and their
dated snapshots, behind a routing prefix or as a fine-tune) accepted the app's temperature 0.1
in the retest probe while refusing `max_tokens`. They keep the call's own temperature (the coach
selector's 0, rules' and the meal photo's 0.1, drafts' 0.2, voice wording's 0.4) as long as no
reasoning effort other than `none` is sent, which is OpenAI's condition for a temperature on these
models; with low, medium or high they get none. Every other reasoning model and variant (-pro,
-codex, -chat-latest, gpt-5, gpt-5.5, gpt-5.6, gpt-6, the o-series, chat-latest, deployment names)
refused a set temperature or is unknown and gets none. If a provider still refuses the kept
temperature, the call is retried once without it (below).

### Reasoning effort

Super admin, AI model, **Reasoning effort (reasoning style only)** (`MODEL_REASONING_EFFORT`):

- **Automatic** (default; blank or unknown values read as automatic, `automaticReasoningEffort`):
  `low` for gpt-5, gpt-5-mini, gpt-5-nano, o1, o3, o3-mini and o4-mini (dated snapshots, routing
  prefix and fine-tunes included); nothing for every other model. These are the models whose own
  default (medium) spent the whole output budget on reasoning in the retest: calls that ended with
  `finish_reason: length` and no answer were gpt-5-nano 31 of 52, gpt-5 13 of 31, gpt-5-mini 7 of
  52, o1 2 of 10, plus weekly adjustments on o3-mini and o3; the meal photo used 2,500 of 2,500
  tokens and the plan 7,560 of 7,560 on reasoning. Every one of them accepts `low`. gpt-5.1 and
  later reasoned little or not at all by default (no call ran out: gpt-5.1 and 5.4 used no
  reasoning tokens, gpt-5.5 and gpt-6-luna a few hundred) and keep their default, and for 5.1, 5.2
  and 5.4 the call's temperature. A provider that refuses the automatic level gets the request
  once more without it (below).
- **Not sent** (`omit`): no `reasoning_effort` (the provider's default).
- **none** (labelled "GPT-5.1 and later only"), **minimal** ("gpt-5, gpt-5-mini and gpt-5-nano
  only"), **low**, **medium**, **high**: sent exactly. A chosen level the model refuses is never
  retried: every AI call fails, naming it (`the provider does not accept reasoning_effort none for
  this model (reasoning request style); choose another AI model reasoning effort, or
  automatic`). The connection check warns before that happens (`reasoningEffortMismatch`: none
  against gpt-5, -mini, -nano or the o-series; minimal against the o-series, GPT-5.1 and later or
  GPT-6; deployment names are never flagged).

Output budgets are not raised for reasoning (the automatic effort addresses the retest's
failures without more tokens or cost); a reasoning model that is not on the automatic list and
still stops at the output limit needs `low` chosen, which the connection check suggests.

### The one retry (automatic only)

When the provider answers **HTTP 400 with the specific unsupported-parameter refusal of a parameter
the request sent** (`refusedStyleParameter`), and reports no token usage, the same request is sent
once more (`retryAfterRefusal`). With the automatic style, in the other style:

- classic refused `max_tokens` (`Unsupported parameter: 'max_tokens' ...`, or `param` max_tokens
  with code `unsupported_parameter`) or `temperature` (`Unsupported value: 'temperature' does not
  support ...`, `Unsupported parameter: 'temperature' ...`, or `param` temperature with code
  `unsupported_parameter`/`unsupported_value`): retried as reasoning;
- reasoning refused `max_completion_tokens` (`Unsupported parameter: 'max_completion_tokens' ...`
  or Azure's `Unrecognized request argument supplied: max_completion_tokens`): retried as
  classic. This mirror case was not seen in the retest (no screened provider refused it).

With any style setting, without an addition the app made on its own (never an admin's choice):

- reasoning refused a kept `temperature` (same wording as above): retried in the reasoning style
  without it;
- reasoning refused the automatic `reasoning_effort` (`Unsupported value: 'reasoning_effort' does
  not support ...`, `Unsupported parameter: 'reasoning_effort' ...`, or `param` reasoning_effort
  with code `unsupported_value`/`unsupported_parameter`): retried without it. A chosen effort is
  never dropped.

Never retried: a refused value another name would not fix (`max_tokens is too large: 12000`),
context length, a refused `response_format` (GPT-4, gpt-oss, DeepSeek V3.2), no image input
(`Model do not support image input`), any other status (401, 404, 429, 5xx), a body without an
error object, a refusal that reports usage, a refused chosen reasoning effort, and a second
refusal. A chosen style (classic or reasoning) is never switched.

The retry belongs to the call's single reservation: one daily-limit count, one reservation and one
usage row, which records the answering call's usage (a refused request carries no usage and is not
billed). It uses what is left of the call's time limit, so leases sized for the call still hold.
When it succeeds, the style and any parameter left out are remembered for that API address and
model in this process (`learnModelRequestStyle`, at most 64 entries) and later calls start with
them (source `learned`). A learned style never overrides a chosen one, a learned omission never
suppresses a chosen effort, and neither changes time limits (below) or qualification pins.

### What is recorded

- `ModelUsage.request` = `{ style, source, retriedAfterRefusal, reasoningEffort }` and
  `ModelUsage.reasoning` (reasoning tokens reported). `source` is where the answering request's
  style came from: `setting`, `learned`, `model_name`, or `refusal_retry` when it is the one retry
  after the refused `retriedAfterRefusal` (before this round a retried row still said
  `model_name`). `reasoningEffort` is the effort that request sent, or null. The API's accounting
  writes them into the cost row's `pricing` JSON next to the prices: `reasoningTokens`,
  `requestStyle`, `requestStyleSource`, `refusedParameter` after a retry, and `reasoningEffort`
  when one was sent.
- A failed call names what was refused without repeating the provider's text: `Model request
  failed (400): the provider does not accept max_tokens for this model (classic request style);
  set the AI model request style to reasoning or automatic; usage has been retained`, or for other
  errors `Model request failed (400, parameter max_tokens, invalid_request_error); usage has been
  retained`. The error also carries `providerStatus` and `providerError` (`type`, `code`, `param`).
- The AI model connection check (still a read-only model-list request) reports what calls start
  with (`describeModelRequest`), for example `Credentials verified with a read-only provider
  request. Calls start with the reasoning request style (from the model ID), reasoning effort low
  (automatic for this model). A refused request parameter is retried once and recorded on the AI
  cost row.` With the reasoning style and no effort it adds `no reasoning effort (the provider's
  default; choose low if replies stop at the output limit)`, and for a chosen effort the model ID
  is not documented to accept: `The chosen reasoning effort may be refused: none is accepted by
  GPT-5.1 and later only; a refused level fails every AI call until it is changed.`
  (`testIntegration` details: `requestStyle`, `requestStyleSource`, `reasoningEffort`,
  `reasoningEffortSource`, `reasoningEffortWarning`, `timeLimitMultiplier`.) The note describes the
  API process that runs the check: a style another process (the worker, which runs plans and meal
  weeks) learned after a refusal is not visible there; its cost rows carry `requestStyleSource`
  `refusal_retry` and `refusedParameter`, and choosing that style in the settings makes it
  permanent for every process.

## Qualification pins

The request style and reasoning effort change what the model is sent (for example classic to
reasoning on gpt-4.1: temperature 0 becomes the provider default and `max_completion_tokens` is
sent), so they are part of every qualification (`modelRequestPin`):

- `coachingModelPin()` (in the coaching runtime's material digest: automatic coaching replies run
  only while the published runtime release's `contractDigest` equals it),
- `planModelPin()` and the plan contract (`planContract`, automatic plan and adaptation delivery),
- `nutritionModelIdentity()` (the nutrition material digest; automatic weeks and swaps pause with
  "The AI model's request style or reasoning effort changed after activation" when only these
  changed).

Each carries `request: { style, family, reasoningEffort, temperature }`: the saved style (auto,
classic or reasoning), the family it or the model ID implies (`modelFamily`), the effort sent
(the setting, or the automatic one) and whether the reasoning style keeps the temperature.
Changing either setting therefore invalidates the release, plan and nutrition qualifications
until they are evaluated again; `platform-settings` needs no qualification handling of its own.

`request` is left out for the default classic request (automatic style, a model ID of the
classic family, no effort): that request is byte for byte the one sent before request styles
existed, so qualifications made before this branch stay valid on deploy (their pins keep exactly
their earlier keys). A style learned from a refusal is not pinned: it follows only a refused
request, which never answered. The time limit multipliers change no request and no pin.

## Reasoning tokens in cost

`completionUsage`: OpenAI and ModelArk count reasoning inside `completion_tokens`
(`completion_tokens_details.reasoning_tokens` is a part of it), so the output billed is
`completion_tokens` and reasoning is never counted twice. A provider that reports reasoning beside
the answer (`total_tokens` = prompt + completion + reasoning, or more reasoning than completion
tokens) has it added. The usage-required rule is unchanged: without `completion_tokens` the output
and cost are unknown and the row needs reconciliation.

## One outer code fence

`modelReplyJson(payload)` replaces `JSON.parse(content ?? "null")` at every call site
(`selectCoachAction`, `modelDecision`, `compileTrainerRules`, plan generation and adaptation,
`nutritionModel`, the meal photo and voice wording). A reply that is exactly one fenced block,
`` ```json `` or a bare `` ``` `` with only whitespace outside it, is read as the text inside; the
strict `JSON.parse` and every schema and validator still apply. Not loosened: text before or after
the fence, two fences, another language tag, an unclosed fence, trailing prose after JSON.

## Meal photos

The photo request (`image_url` with a `data:image/jpeg;base64` URL and `detail: "low"`, text part
first) is unchanged in both styles. `detail` "low" is a documented Chat Completions value, and every
GPT-5.x, GPT-6 and o-series model answered the app's photo request with it in the retest (HTTP 200).
Photo failures seen there were non-vision models (keep "Selected model supports image input" off
for them) and reasoning using the whole 2,500-token budget on gpt-5-nano, gpt-5 and o3-mini; a low
reasoning effort addresses the latter (the harness's minimal-effort run answered in 4 s).

## Time limits per model family

Every call site's limit now comes from a budget, never a literal (`MODEL_CALL_BUDGETS`,
`planGenerationBudget`, `nutritionBudget`), multiplied for the configured model's family:

| Call site | Output budget | Base limit (classic, unchanged) |
|---|---|---|
| coaching chat selector (`coach_selection`) | 800 | 30 s |
| coaching drafts, release evaluation (`coach_decision`) | 2,500 | 30 s |
| rule compilation (`rule_compilation`) | 5,000 | 30 s |
| plan adaptation (`plan_adaptation`) | 3,000 | 60 s |
| meal photo (`meal_photo`) | 2,500 | 30 s |
| voice wording (`voice_suggestions`) | not sent | 30 s |
| plan generation (`planGenerationBudget`) | 6,000 to 16,000 | 52.5 to 166.5 s (formula capped at 240 s) |
| nutrition (`nutritionBudget`) | 12,000 to 27,000 | 150 to 300 s |

A slower model-name family raises a call site's base limit before the multiplier applies
(`MODEL_FAMILY_TIMEOUT_MS`, `modelCallTimeoutMs` in `model-request.ts`, merged from the Brain
prompt tuning of 30 September 2026): a model ID containing the word `seed` (ModelArk Seed) gets
90 s for rule compilation and 60 s for a meal photo; other call sites keep their base. An allowance
never shortens a base limit. These two call sites run inside the request, not a leased job, so no
lease changes with it.

Super admin, AI model: **Time limit multiplier, classic request style**
(`MODEL_TIMEOUT_MULTIPLIER`, default 1) and **..., reasoning request style**
(`MODEL_REASONING_TIMEOUT_MULTIPLIER`, default 2), each 1 to 10 with at most two decimals; an
invalid runtime value reads as the default. The family is the chosen style, or with automatic the
style the model ID implies (`modelFamily`); a learned style changes the wire form only, so a lease
computed before a call and the call's own limit always agree. No call waits longer than 300 s
(`modelCompletion`'s cap; the web proxy allows 330 s). Output budgets do not change with the family
(the automatic reasoning effort above addresses reasoning inside them).

Classic defaults are unchanged: chat 30 s, plans 52.5 to 166.5 s, a meal week 150 s. Reasoning
models get twice that by default within the cap: chat 60 s, plans 105 to 300 s, a meal week 300 s. The meal-week
lease follows the configured limit (`nutritionWeekLeaseSeconds()`: 240 s classic, 390 s reasoning;
`NUTRITION_WEEK_LEASE_SECONDS` stays the classic value): the worker's claim, the manual job, the
running window and the scheduler's recovery read it in the request's settings snapshot. A
`brain_plan` job's lease follows it the same way (`brainPlanLeaseSeconds()`): the longest call such
a job makes (a 7-day, 53-week programme draft or a weekly adjustment) at the configured limit plus
90 s for the transactions around it, 257 s classic and 390 s reasoning at the defaults. It was a
fixed two minutes, below a large classic plan's 166.5 s and every reasoning plan's 126 to 300 s,
so a second claim meanwhile found the generation still `generating`, marked it interrupted and
sent the paid reply to the trainer (`prepareGeneration`). Other jobs keep two minutes.

## Not changed here

- `response_format: json_object` is still always sent: GPT-4, gpt-oss-120b, DeepSeek V3.2 and
  Seed 2.0 Code Preview refuse it (not current OpenAI models; a "JSON mode" setting would be a
  separate change).
- Output budgets are not raised for reasoning (the automatic reasoning effort covers the models
  that ran out in the retest). Legacy gpt-3.5-turbo and gpt-4-turbo (4,096 output tokens at most)
  cannot run the plan, rule and nutrition budgets.
- The connection check still lists models only; it sends no app-shaped request, so a refused
  parameter or missing image support shows on the first real call (now with the parameter named);
  it warns about a chosen reasoning effort the model ID is not documented to accept.
- The style learned after a refusal stays in the memory of the process that learned it (not
  persisted, not shown by the connection check); the cost rows record it (above).

## Review round (29 September 2026, findings C1 to C8)

A retest of the fixed code found:

| # | Finding | Resolution |
|---|---|---|
| C1 | Request style and reasoning effort were in no qualification pin, so changing them kept automatic coaching, plans and meal weeks on unevaluated behaviour | Fixed: `modelRequestPin` in `coachingModelPin`, `planModelPin` (and `planContract`) and `nutritionModelIdentity` (Qualification pins, above); nutrition readiness names the cause |
| C2 | gpt-5.1, 5.2 and 5.4 accept a temperature but always lost it | Fixed: kept for them while no effort other than none is sent; a refused kept temperature is dropped once |
| C3 | `brain_plan` jobs kept a two-minute lease below the plan and adaptation limits | Fixed: `brainPlanLeaseSeconds()` in the worker's claim |
| C4 | Effort help said "unselected sends none" beside an option that sends `none` | Fixed: automatic and not-sent options, labelled model-limited levels, connection-check warning |
| C5 | Default settings let medium-default reasoning models spend the output budget on reasoning | Fixed: automatic effort `low` for them; the check suggests low when the reasoning style sends none |
| C6 | A retried cost row said `model_name`; the check could not see another process's learned style | Fixed: `refusal_retry` source and the effort sent on the cost row; the note says what it covers. Not done (optional): persisting the learned style or reading recent cost rows in the check (cost rows are workspace-scoped; the check would scan every workspace) |
| C7 | No test that each call site passes its time limit or unwraps a fence; no reasoning-config lease test; no pin test | Fixed: table test over every call site (limit and fence, reasoning model), voice wording in `voice-session.test.ts`, PGlite claim test, pin and digest tests. Each was checked by breaking the code it covers |
| C8 | Restricted-role PostgreSQL and the e2e harness had not run | Run (below), in a private mount namespace with its own `/dev/null`; the container's `/dev/null` (still a regular root-owned file) was not changed |

## Checks (29 September 2026, first round)

- `npx tsc --noEmit` and `npx tsc -p apps/web/tsconfig.json --noEmit`: pass.
- `tests/model-gateway.test.ts` (17 tests: recorded OpenAI and ModelArk error bodies, the retry
  rules, accounting, fences, the photo request, budgets, settings validation, the Super admin
  route, runtime settings and the cost row under PGlite): pass.
- PGlite, the 34 test files that exercise model calls, budgets, leases or settings
  (`provider-configuration`, `platform-settings`, `settings-runtime`, `fix-settings`,
  `brain-plans*`, `coaching-*`, `fix-chat`, `fix-coaching`, `fix-nutrition-*`, `nutrition`,
  `meal-capture`, `voice-session*`, `voice-talkback`, `platform`, `platform-finance`,
  `prompt-refs`, `model-gateway` and others): 445 tests, 444 pass, 1 skipped (needs PostgreSQL).
- `/opt/tools/pg-sandbox.sh`: **not run to completion**. `initdb` failed before any test because
  `/dev/null` in the container is a regular root-owned file the `postgres` user cannot write
  (`sh: cannot create /dev/null: Permission denied`); restoring it is outside this task.
- `npm run build` and the e2e harness: not run (no web code changed; the settings page renders
  the new fields from the catalog, and the harness's mock model is classic, whose requests are
  byte-for-byte unchanged).

## Checks (29 September 2026, review round)

- `npx tsc --noEmit` and `npx tsc -p apps/web/tsconfig.json --noEmit`: pass (final code).
- `tests/model-gateway.test.ts`: 27 tests (the first round's 17, updated for the new behaviour,
  plus 10 for C1 to C7), pass under PGlite. The C7 voice wording case in
  `tests/voice-session.test.ts` passes (11 tests in the file).
- Each new test was checked against the fault it covers by temporarily breaking the code:
  removing the request pin from the coaching pin, the plan contract or the nutrition identity;
  never keeping the temperature; dropping the `brain_plan` lease case; dropping `{ timeoutMs }`
  in the coach selector or forcing 30 s in rule compilation and voice wording; plain
  `JSON.parse` in plan generation, `modelDecision` and voice wording; the old cost-row source.
  Every break failed at least one test; the code was restored each time.
- PGlite, 57 test files that exercise model calls, pins, budgets, leases, settings or the e2e
  harness mocks (`model-gateway`, `provider-configuration`, `platform-settings`,
  `settings-runtime`, `fix-settings`, `brain-plans*`, `coaching-*`, `fix-chat`, `fix-coaching`,
  `fix-nutrition-*`, `nutrition*`, `meal-capture`, `voice-*`, `platform*`, `prompt-refs`,
  `onboarding-*`, `integrations-completion`, `admin-completion`, `chat-*`, `e2e-harness-*`,
  `notifications`, `push-notifications`, `messaging-templates`, `finance-completion` and others):
  615 tests, 615 pass, on the final code.
- `/opt/tools/pg-sandbox.sh` (restricted runtime role, PostgreSQL 16): run inside a private mount
  namespace (`unshare -m`) with a bind-mounted character device as `/dev/null`, because the
  container's `/dev/null` is still a regular root-owned file that `initdb` cannot write as
  `postgres`; the container's file was not changed. 13 files: `model-gateway` (27),
  `provider-configuration` (8), `settings-runtime` (1), `fix-settings` (5),
  `fix-nutrition-model` (10), `brain-plans` (30), `coaching-runtime` (9), `voice-session` (11),
  `nutrition` (15), `meal-capture` (9), `fix-chat` (18), `platform-finance` (15): pass.
  `platform-settings` refuses the selected-file mode by design (its fixture requires a database
  named `trainer_ci_<hex>`, the full-suite runner's naming, and the sandbox names them `sel_<hex>`);
  run with a scratch copy of the sandbox that uses the CI naming, it passes (15). The gateway and
  voice files were rerun on the final code: 27 and 11 pass.
- `node scripts/e2e/run.mjs --rebuild --pg-port=56813` (same namespace; `next build` included):
  439 steps, 437 pass, 2 fail, both outside the model gateway and both environmental: the backup
  restore check (`Not enough free disk space to restore a scratch copy: 1722 MiB free, 2074 MiB
  needed`; the container's disk is 96 % full) and the memory-alert recovery step (`Timed out
  waiting for fresh recovery measurement`, host measurement under the load of parallel jobs). Both
  steps passed in earlier runs of the harness in this environment. The harness's mock model is
  classic, whose requests and pins are unchanged. Two edits landed while it ran (a comment in
  `dispatch.ts` and the scope of the connection check's effort warning), neither exercised by the
  harness; the unit and PostgreSQL runs above are on the final code.
