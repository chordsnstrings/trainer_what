# Model gateway: current OpenAI models and reply formatting (branch `fix/openai-compat`)

Status: implemented on branch `fix/openai-compat` from `integrate/round2` `0c9569d`; not merged,
not deployed. Code: `packages/providers/src/model-request.ts` (new),
`packages/providers/src/model-accounting.ts` (`modelCompletion`), the AI model settings in
`packages/providers/src/configuration.ts`, and every model call site. Tests:
`tests/model-gateway.test.ts`.

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
- **Reasoning**: `max_tokens` is sent as `max_completion_tokens` with the same value,
  `temperature` is left out (the provider default), and the optional **Reasoning effort**
  (`MODEL_REASONING_EFFORT`: none, minimal, low, medium, high; unselected = not sent) is added.
  Messages (image parts and their `detail` included), `response_format` and every other field
  are unchanged. The voice wording call sends no output limit, so none is added.

gpt-5.1, 5.2 and 5.4 accept a temperature but refuse `max_tokens`, so they need the reasoning
style and are sent the provider's default temperature.

### The one retry (automatic only)

When the provider answers **HTTP 400 with the specific unsupported-parameter refusal of a parameter
the style sent** (`refusedStyleParameter`), and reports no token usage, the same request is sent
once more in the other style:

- classic refused `max_tokens` (`Unsupported parameter: 'max_tokens' ...`, or `param` max_tokens
  with code `unsupported_parameter`) or `temperature` (`Unsupported value: 'temperature' does not
  support ...`, `Unsupported parameter: 'temperature' ...`, or `param` temperature with code
  `unsupported_parameter`/`unsupported_value`): retried as reasoning;
- reasoning refused `max_completion_tokens` (`Unsupported parameter: 'max_completion_tokens' ...`
  or Azure's `Unrecognized request argument supplied: max_completion_tokens`): retried as
  classic. This mirror case was not seen in the retest (no screened provider refused it).

Never retried: a refused value another name would not fix (`max_tokens is too large: 12000`),
context length, a refused `response_format` (GPT-4, gpt-oss, DeepSeek V3.2), no image input
(`Model do not support image input`), any other status (401, 404, 429, 5xx), a body without an
error object, a refusal that reports usage, and a second refusal. A chosen style (classic or
reasoning) is sent exactly and never retried.

The retry belongs to the call's single reservation: one daily-limit count, one reservation and one
usage row, which records the answering call's usage (a refused request carries no usage and is not
billed). It uses what is left of the call's time limit, so leases sized for the call still hold.
When it succeeds, the style is remembered for that API address and model in this process
(`learnModelRequestStyle`, at most 64 entries) and later calls start with it (source `learned`).
A learned style never overrides a chosen one and never changes time limits (below).

### What is recorded

- `ModelUsage.request` = `{ style, source: setting | learned | model_name, retriedAfterRefusal }`
  and `ModelUsage.reasoning` (reasoning tokens reported). The API's accounting writes them into the
  cost row's `pricing` JSON next to the prices: `reasoningTokens`, `requestStyle`,
  `requestStyleSource`, and `refusedParameter` after a retry.
- A failed call names what was refused without repeating the provider's text: `Model request
  failed (400): the provider does not accept max_tokens for this model (classic request style);
  set the AI model request style to reasoning or automatic; usage has been retained`, or for other
  errors `Model request failed (400, parameter max_tokens, invalid_request_error); usage has been
  retained`. The error also carries `providerStatus` and `providerError` (`type`, `code`, `param`).
- The AI model connection check (still a read-only model-list request) reports the style calls will
  start with: `Credentials verified with a read-only provider request. Calls use the reasoning
  request style (from the model ID).` (`testIntegration` details: `requestStyle`,
  `requestStyleSource`, `timeLimitMultiplier`).

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

Super admin, AI model: **Time limit multiplier, classic request style**
(`MODEL_TIMEOUT_MULTIPLIER`, default 1) and **..., reasoning request style**
(`MODEL_REASONING_TIMEOUT_MULTIPLIER`, default 2), each 1 to 10 with at most two decimals; an
invalid runtime value reads as the default. The family is the chosen style, or with automatic the
style the model ID implies (`modelFamily`); a learned style changes the wire form only, so a lease
computed before a call and the call's own limit always agree. No call waits longer than 300 s
(`modelCompletion`'s cap; the web proxy allows 330 s). Output budgets do not change with the family.

Classic defaults are unchanged: chat 30 s, plans 52.5 to 166.5 s, a meal week 150 s. Reasoning
models get twice that by default within the cap: chat 60 s, plans 105 to 300 s, a meal week 300 s. The meal-week
lease follows the configured limit (`nutritionWeekLeaseSeconds()`: 240 s classic, 390 s reasoning;
`NUTRITION_WEEK_LEASE_SECONDS` stays the classic value): the worker's claim, the manual job, the
running window and the scheduler's recovery read it in the request's settings snapshot.

## Not changed here

- `response_format: json_object` is still always sent: GPT-4, gpt-oss-120b, DeepSeek V3.2 and
  Seed 2.0 Code Preview refuse it (not current OpenAI models; a "JSON mode" setting would be a
  separate change).
- Output budgets are not raised for reasoning; use the reasoning effort setting. Legacy
  gpt-3.5-turbo and gpt-4-turbo (4,096 output tokens at most) cannot run the plan, rule and
  nutrition budgets.
- The connection check still lists models only; it sends no app-shaped request, so a refused
  parameter or missing image support shows on the first real call (now with the parameter named).
- `brain_plan` jobs keep the worker's two-minute claim lease although plan generation may take up
  to 240 s (classic) or 300 s (reasoning); a second claim meanwhile finds the generation
  `generating` and hands it to the trainer as interrupted (existing behaviour, `prepareGeneration`).

## Checks (29 September 2026, this branch)

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
