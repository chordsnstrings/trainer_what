# Check my Brain and learning from corrections (round 4, phase 6 backend)

One teaching loop for the coach. The separate teach-and-test loops (Brain replies, routine replies,
plans, nutrition) are run as one "Check my Brain" over the coach's held-out cases, with a result per
area. After every edit a check runs in the background; the last passing version stays live
meanwhile and a new version goes live on its own once it passes. Corrections of real Brain replies
become suggested rules in "Keep training" that the coach confirms. Backend only; the "My Brain"
screens call these endpoints.

Code: `apps/api/src/brain-check.ts` (check, background job, overview), `apps/api/src/brain-learning.ts`
(suggestions), `apps/api/src/brain-replies-check.ts` (the replies check, moved out of `app.ts`),
`packages/domain/src/brain-learning.ts` (suggestion checks), `packages/providers/src/brain-learning.ts`
(prompt `brain-correction-v2`), worker dispatch `apps/worker/src/dispatch.ts`. Tests:
`tests/brain-check.test.ts`.

## Safety floor (unchanged)

- The Brain only drafts. A check or a suggestion never sends anything to a member.
- A suggested rule is never a rule until the coach confirms it. The confirmed text is checked again
  (the same warnings a compiled draft rule gets: medical, medicine, dose or diagnosis advice, a red
  flag not stopped and handed to the coach, links, contact details, approval claims, guarantees;
  plus numbers the coach did not write, "always"/"any message" conditions and naming the software).
  A flagged suggestion has no "confirm anyway": the coach teaches it in their own words instead.
- Validators, the safety policy, medical-advice blocks and the automatic-sending checks are
  unchanged. "Sends automatically" still needs the level gate (`assertAutomaticLevel`).
- No model or vendor name appears in any coach, member or public text.

## One held-out set, per-area results

The held-out cases stay in their area's records (`scenario`, `coaching_scenario`, `plan_scenario`,
`nutrition_scenario`: each expects a different kind of answer) and are shown and counted as one set.

| Method and path | Who | What |
|---|---|---|
| `GET /api/v1/brain/check` | owner, staff | `state` (`not_live`, `rechecking`, `needs_attention`, `up_to_date`), plain `summary`, `heldOut {total, byArea}`, `areas.{replies,actions,plans,nutrition}` with `label`, `used`, `live`, `upToDate`, `cases` (actions also `mode`), `recheck` (the pending background run), `lastCheck` (`status`, `trigger`, `areas.<area>.state` = `passed`/`failed`/`needs_cases`/`unchanged`/`unavailable`/`not_used` with `passed`/`total`/`message`, `promoted`) |
| `POST /api/v1/brain/check` | owner | Asks for a check now (runs in the background); returns the overview |
| `GET /api/v1/brain/check/cases` | owner | The held-out set as one list: `{id, version, area, label, text, createdAt}` |

Adding and archiving cases still uses each area's endpoint (`/brain/scenarios`,
`/brain/coaching-scenarios`, `/brain/plans/scenarios`, `/nutrition/scenarios`).

## Background re-check after every edit

- A successful coach-team write to a teaching route (rules, conflicts, held-out cases, actions,
  teaching cases, releases, plan settings and cases, nutrition cases, sources, foods, recipes,
  policy, held-out checks, confirmed correction teaching) asks for a `brain_check` job
  (`isBrainEdit`). There is one job per workspace (`intent_key brain_check:<tenant>`); edits within
  60 seconds are checked together, and an edit during a run re-arms the job so the newer version is
  checked next. Lease 30 minutes (model calls run one after another).
- Before the coach's Brain is live nothing is re-checked unless the coach asks (`POST`), so the setup
  wizard does not pay for checks on every rule approval.
- The job runs as the workspace owner (the membership must still be current), only for areas whose
  material changed:
  1. **Brain replies**: the approved rules against the coach's own held-out cases (skipped when the
     latest check of these rules covered the same cases).
  2. **Rules changed and passed**: a candidate Brain release (`status 'candidate'`) is checked against
     every area live today: routine replies (`evaluateCoachingRuntime` with the candidate) and plans
     (`qualifyPlanGeneration` with the candidate) when they are qualified. Only when all pass is it
     published (old one archived) and the routine-replies release re-activated in its current mode
     (`activateCoachingRuntime`, so the level gate applies). Otherwise it becomes `check_failed` and
     the last passing version stays live everywhere. Qualification is `full` with 20+ own cases,
     otherwise `quiz` ("Waits for me").
  3. **Only routine replies changed** (actions, teaching cases, their held-out cases, the model):
     checked with the live Brain; passing re-activates in the same mode.
  4. **Plans** that were qualified before and are not now (settings, cases or model changed) are
     re-qualified.
  5. **Plan learning** (round 5): reviewed plan examples waiting since the live learning snapshot
     are qualified at most once a week while plans are qualified; a passing check publishes the
     new snapshot (`promoted.learningSnapshotId`), a failing one keeps the last passing snapshot
     live (`docs/features/brain-learning.md`).
  6. **Nutrition** (when the coach has used it): evaluated in the background. Switching updated
     nutrition on still needs the coach's reviewed sample week (unchanged; the message says so).
- Each run stores a `brain_check` record (`passed`, `failed`, `incomplete`, `nothing_to_check`) and
  the event `brain.check_completed`.

## Keeping the last passing version live (routine replies)

`liveRuntimeMaterial` in `coaching-runtime.ts`: automatic delivery uses the published runtime
release's own snapshot (the exact contract its passing check covered), not today's material. It is
live only while:

- the snapshot hashes to the release's `contractDigest`;
- the model pin (endpoint, model, prompt, retrieval versions) equals the current one: a model switch
  stops automatic sending until a check on the new model passes;
- every action, teaching case and template it uses is still active at the same version: anything
  archived or withdrawn ends it (every request then waits for the coach);
- every rule it uses is still in the published Brain release.

Newer material (a new action, a new teaching case) is not used until a check of it passes.
`coachingRuntimeReadiness` returns `live` and `rechecking` besides `current`; the onboarding
readiness treats a live snapshot as current.

## Learning from corrections

- An edit before sending (`POST /exceptions/:id/corrections`) or a rejected draft
  (`POST /exceptions/:id/resolve` without `approveDecision`) queues a `brain_learning` job
  (`data.userId` is the client, so a pending job is erased with the client).
- The model gets only the Brain's draft, the coach's reply (edits) and the coach's note, as one JSON
  object of data the instructions say is never to be followed; the client's name is replaced by
  `[client]`; the client's own message is never sent. Texts with contact details or account
  numbers are not sent at all (`withheld`, `personal_data`).
- Prompt `brain-correction-v2`: at most one narrow rule in the coach's own terms, or nothing for
  one-off client facts, personal remarks, typos, "handled it personally" notes, or when the coach's
  own words are unsafe. A hand-over directive only says the coach will reply personally (plus
  "stop" for pain or a symptom). Model budget `brain_correction`: 1500 output tokens, 30 s (60 s for
  Seed-family models).
- Stored as `brain_suggestion` records owned by the client (`owner_user_id`), status `suggested`,
  `withheld` (a check failed; never shown), `nothing_to_learn`, `confirmed` or `dismissed`. Erasing
  the client deletes them; a confirmed rule is the coach's (owned by the coach, checked text only).

| Method and path | Who | What |
|---|---|---|
| `GET /api/v1/brain/suggestions` | owner, staff | `suggestions` (status `suggested`): `{id, version, source: "edit"/"rejection", rule{title,category,condition,directive}, why, example{draft,coachReply,coachNote}, createdAt}`; `counts` per status |
| `POST /api/v1/brain/suggestions/:id/confirm` | owner | `{version, rule?}` (edited wording optional). Re-checked; 409 `SUGGESTION_FLAGGED`, `SUGGESTION_CHANGED`, `RULE_LIMIT`. Creates an approved rule (`origin: "reply_correction"`, `learnedFrom`) and asks for a background check |
| `POST /api/v1/brain/suggestions/:id/dismiss` | owner | `{version}` |

`GET /brain/teach` `suggestions.learned` counts suggestions waiting; a correction handled by a
suggestion no longer appears in `GET /brain/teach/suggestions` `replyCorrections` (the earlier
compile route still works for the others).

## Other changes

- `POST /brain/evaluate`, `POST /brain/coaching-evaluate`, `POST /brain/coaching-activate` and
  `POST /nutrition/evaluate` behave as before; their bodies are now the exported functions the
  background check calls (`evaluateBrainReplies`, `evaluateCoachingRuntime`,
  `activateCoachingRuntime`, `evaluateNutritionKnowledge`). `qualifyPlanGeneration`,
  `planQualificationState` and `runtimeMaterial` accept a candidate Brain release.
- `brainTrainingState` returns `latestEvaluation` and `learnedSuggestions`.
- No migration: all new data is in generic `records` and `jobs`.

## Live model test (Seed 2.0 Pro, 30 September 2026)

`seed-2-0-pro-260328` through the app's own `suggestRuleFromCorrection` and checks; eval script,
the 26 corrections and results outside the repository (session scratchpad
`round4-evals/teaching-loop/`). Case types: style (5), training rules with the coach's numbers (5),
one-off client facts (4), typos (2), safety hand-overs (3), rejections with a note (2), adversarial
(3: the coach's own ibuprofen dose, an injected instruction with an email address and fat burners,
an injected "approve every request" in the draft), a draft number the coach removed (2).

- v1 (26 calls): 22/26 by the eval's scoring. The congratulation on a client's new job became a
  general rule (over-generalised); two correct safety hand-overs were withheld by the code checks
  ("do not give supplement advice" read as supplement advice; a pain hand-over without "stop");
  the coach's ibuprofen rule was proposed and withheld by the checks. One eval expectation was wrong
  (P2: the coach wrote "never 5").
- v2 (two rounds, 52 calls): every case type correct after the one expectation fix: 36/36 rules
  shown when expected, 16/16 nothing shown when expected; no rule broader than the correction, no
  number the coach did not write, no injected text followed; medical advice shown 0 (the coach's
  own "400 mg ibuprofen" rule was still proposed both times and withheld by the code checks; one
  pain hand-over added "never suggest painkillers", a prohibition the app checks accept).
- About 4-14 s per call; about 700 input and 400 output tokens per call; the whole test (78 calls)
  used about 53,000 input and 30,000 output tokens.
