# Trainer Brain plan generation (work package `core/brain-plans`)

Status: implemented on branch `core/brain-plans` (migration 063), then revised after review (see
"Review fixes"). Everything here is engineering work with a scripted fake model; no real model,
provider or live server was used.

## Plan (written before implementation)

Owner concept of 28 September 2026: the trainer's Brain learns enough from the trainer to write
each subscriber's plan, keeps learning from trainer corrections and subscriber outcomes, delivers
automatically and hands a plan to the trainer only when it is not confident. Programme length is
trainer-set. Safety stays in code.

Existing code read first: `training-programs.ts` (`scheduleProgram`, planned sessions),
`coaching-runtime.ts` (published Brain material, runtime release, held-out qualification,
`member_material()`), `packages/providers/src/coaching.ts` + `coaching-retrieval.ts` (bounded
lexical retrieval, model pin), `packages/domain/src/coaching-completion.ts` (programme schema,
`trainingSchedule`), `client-twin.ts`, `safety-policy.ts` (`screenForSafety`), `entitlements.ts`,
`nutrition-schedule.ts` (worker job pattern), `apps/worker/src/*`, the isolation rules in
`docs/features/isolation.md` and the mock model rules in `tests/e2e/mocks/model-rules.ts`.

Design:

1. **Storage** in `records` (the same table the coaching Brain uses) with new staff-only kinds:
   `plan_brain_settings` (one per workspace), `plan_generation` (one per generation or weekly
   adaptation: Brain release, prompt version, model pin, inputs digest, retrieval trace, draft,
   validation, confidence breakdown, route, outcome), `plan_learning` (private teaching example
   from a trainer approval, edit with its diff, or rejection), `plan_scenario` (held-out plan
   scenarios) and `plan_qualification` (evaluation results). A generation is owned by the
   subscriber, so the existing personal export and erasure cover it; the follower's scope
   cannot read it (not in `record_subscriber_scope`) and learns its own plan state only through
   a new definer helper `member_plan_status()` (migration 063). Delivered plans are ordinary
   `program` + `planned_session` records, written exactly like `scheduleProgram`, so the
   calendar, reminders, workouts, substitutions and the Client Twin keep working.
2. **Generation** (`apps/api/src/brain-plans.ts`): the worker's per-workspace scheduler enqueues
   a `brain_plan` job when a member has access, a consented intake, no safety hold, no running
   plan (first plan) or a Brain-generated programme that ends within three days (next block).
   The job runs in the worker's allowlisted scope: gather material in one transaction, call the
   model outside it, then recheck the inputs and persist in a second transaction. Length comes
   from `programmeLengthDays(tx, userId)` (`apps/api/src/programme-length.ts`, shared contract).
   Dates use the member's own timezone (notification preference, then nutrition profile, then
   UTC). The model returns a compact structured plan (session templates + one row per week with
   volume/load/RIR factors and deloads); code expands it into dated sessions.
3. **Validation** (`packages/domain/src/brain-plans.ts`): schema plus hard bounds from the
   trainer's settings — sessions match days per week on distinct weekdays, the week count
   matches the length, every exercise and alternative is in the trainer's library or templates,
   tagged equipment is available, rest inside the range, estimated session length, week-to-week
   volume increase and per-exercise load jump limits, beginner RIR floor, cited evidence inside
   the supplied material. Errors block delivery; warnings reduce confidence.
4. **Confidence** is deterministic: rule coverage of the member's goal/experience/equipment/
   schedule, similar approved plans (approved/edited minus rejected in the same segment),
   validator warnings, library equipment metadata and the model's self-report, weighted into one
   score compared with the trainer's threshold (default 0.8). Automatic delivery also needs a
   passing plan qualification of the current contract and the automatic mode. Safety floor in
   code: a medical limitation, a red-flag term (`screenForSafety`) or a pain report/hold in the
   last 28 days always routes to the trainer. While the Brain is young (fewer than N reviewed
   plans) a deterministic sample of automatic plans is flagged for trainer spot-check.
5. **Review queue**: approve / edit (diff stored) / reject, one click each, owner or staff; edits
   are validated with the same code. Every decision becomes a `plan_learning` example that
   retrieval ranks by segment similarity and that raises that segment's case coverage.
6. **Weekly adaptation**: at the end of each programme week the worker summarises adherence,
   logged loads/RIR (with corrections), skipped sessions, pain reports and check-ins, asks the
   model for next-week changes, validates them against the current week with the same bounds and
   confidence gate, and applies them to next week's planned sessions or queues them for review.
   A pain report skips the model and queues the unchanged week for the trainer.
7. **Qualification**: held-out plan scenarios (at least 6, two that must go to review); a
   passing evaluation pins Brain release, rules, prompt/validator versions, model and bounds.
   Without it every plan goes to review (supervised mode).
8. **UI**: `/trainer/brain/plans` (queue with draft, reasons and approve/edit/reject; settings;
   learning stats; library equipment tags; scenarios and qualification; generate for a member),
   the subscriber's programme screen shows the generated plan and its state, and the intake form
   explains that the Brain will prepare the plan.
9. **Tests** with a scripted fake model (and the e2e rule responder for the two new prompt kinds).

## What was built

### Data (migration `063_brain_plans.sql`)

No new table: plans use `records` with staff-only kinds (`plan_brain_settings`,
`plan_generation`, `plan_learning`, `plan_scenario`, `plan_qualification`, and
`plan_schedule_state`, the scheduler's cursor with no owner); none is in
`record_subscriber_scope`, so a follower's scope cannot read them. The migration adds a unique
settings row per workspace, one generation per worker job (`data.jobId`), a queue index, one
learning example per generation, and the definer helper `member_plan_status()` (a follower's own
latest programme-generation state only: preparing / in review / delivered / with trainer; no
draft, reasons or confidence). `scripts/verify-runtime-access.mjs` lists the helper (41 helpers).
No `infra/runtime-role.sql` change was needed (no new table). A generation row is owned by the
subscriber, so the existing personal export and erasure cover it; a learning example is owned by
the reviewing trainer and holds only the coarse segment (goal category, experience, days,
equipment), the plan excerpt, the diff and the trainer's note.

`trainingExerciseSchema` gained an optional `equipment` list (library tags the validator checks).

### Shared contract

`apps/api/src/programme-length.ts` — `programmeLengthDays(tx, userId)`: the `programmeDays`
snapshotted on the member's membership (`subscriptions.data.programmeDays`), else the member's
current offer (`subscriptions.data.productId` → `product.data.programmeDays`, 7..365), else the
trainer's `defaultBlockDays` plan setting (`plan_brain_settings.data.settings.defaultBlockDays`;
the first version read the wrong path), else 28 (`BRAIN_DEFAULT_PROGRAMME_DAYS`). The `programme`
package owns the final logic; the signature is the agreed one (its version returns the default 28
for rolling offers and ignores the trainer's block setting; reconcile when merging).

Next blocks follow the same contract (`nextBlockAllowed`): an offer bought `upfront` is one
programme, so a next block needs access that demonstrably reaches its first day (period end at or
after it); a `monthly` membership (fixed length or rolling) continues in consecutive blocks while
it renews, as the programme package's calendar does; a membership set to end
(`cancel_at_period_end`) stops at its period end; complimentary access continues until its end.

### Domain and provider

- `packages/domain/src/brain-plans.ts`: model output schema (session templates A–G on weekdays,
  one row per week with volume/load factors, RIR delta and deload, self-confidence, uncertainties,
  cited evidence), trainer settings and bounds, library building (library exercises, template
  exercises and approved alternatives), expansion into dated sessions, the validator
  (`validatePlan`, `validateAdaptedWeek`), segments, rule/case coverage, the safety floor
  (`planSafetyReasons`), `planConfidence` (weights: rules 0.25, similar reviewed plans 0.30,
  validator 0.20, library equipment tags 0.10, model self-report 0.15; any validator error makes
  it not confident), deterministic spot-check sampling and the review diff (`planDiff`).
- `packages/providers/src/brain-plans.ts`: `retrievePlanMaterial` (bounded lexical retrieval over
  the release's rules, programme/progression/substitution/schedule teaching cases, reviewed plan
  examples ranked by segment similarity then recency, templates and the library; tenant, approval
  and learning-rights filters first; projected fields only), `generateTrainingPlan`
  (`brain-plan-v1`) and `proposePlanAdaptation` (`brain-plan-adapt-v1`). Schema failures are
  returned, not thrown, so they reach the trainer. Model use goes through `modelCompletion` and
  `modelAccounting` (tasks `brain_plan`, `brain_plan_adaptation`, `brain_plan_qualification`).

### API (`apps/api/src/brain-plans.ts`, registered in `app.ts`)

| Route | Who | What |
| --- | --- | --- |
| `GET /api/v1/brain/plans/workspace` | owner, staff | settings, qualification state (scenarios for the owner only), review queue (pending, failed, pending spot checks) with drafts, reasons and confidence, recent generations, learning stats, library equipment tags, subscribers |
| `PUT /api/v1/brain/plans/settings` | owner | mode, threshold, spot-check rate, young-Brain review count, default block length, bounds (version-checked) |
| `POST /api/v1/brain/plans/generate` | owner, staff | generate for one subscriber now (503 without a model; 409 with the reason when not ready) |
| `POST /api/v1/brain/plans/:id/review` | owner, staff | `{action: approve, edit or reject, version, note?, plan? or week?}` |
| `POST /api/v1/brain/plans/:id/regenerate` | owner, staff | `{version}`: a fresh attempt for a `failed`, `not_sent` or `pending_review` item (programme or week); the old item becomes `superseded` (`outcome.decision: regenerated`) once the new generation exists |
| `POST /api/v1/brain/plans/scenarios`, `.../scenarios/:id/archive` | owner | held-out scenarios (at most 50): programme scenarios (7..365 days) and `type: "adaptation"` scenarios (profile, one prescribed week, adherence, effort, pain) |
| `POST /api/v1/brain/plans/qualify` | owner | run plan qualification |
| `POST /api/v1/brain/plans/exercises/:id/equipment` | owner, staff | tag a library exercise's equipment |
| `GET /api/v1/brain/plans/mine` | subscriber | own plan state, generated programme summary and the next 14 Brain sessions |

Behaviour:

- **Generation** runs in three steps (gather in one transaction, call the model outside it,
  recheck and route in a second). The recheck supersedes the draft if access, consent, intake or
  a safety hold changed meanwhile. Length from `programmeLengthDays`; start date is today in the
  member's timezone (notification preference, then nutrition profile, then UTC), or the day after
  the running block for a next block. A delivered plan is one `program` (status `assigned`,
  `generated: true`, `startDate`, `endDate`, projected `planWeeks`, `generationId`; never the
  model's draft, confidence, uncertainties or evidence, which stay on the staff-only generation)
  and one
  `planned_session` per training date (`date`, `timezone`, `week`, `label`, `sessionKey`,
  `program.exercises` in the existing exercise shape, `programId`, `programVersion`) plus the
  `program.scheduled` event, as `scheduleProgram` writes them. Other assigned programmes are
  archived and their sessions from the start date canceled; a Brain block that ends before the new
  one starts stays assigned for its last days and the worker archives it once it has ended. An
  automatic delivery only ever archives the Brain's own programmes; a hand-written one is replaced
  only when the trainer approves.
- **Hand-written programmes**: a queued job carries `expectedProgramId` (the programme the
  scheduler saw, or null). Before and after the model call, a queued generation stops
  (`programme_changed` / `superseded`) when the latest assigned programme is hand-written or is not
  the expected one. A trainer's own request for a member with a hand-written (or meanwhile
  changed) programme goes to review with that reason, even when confident.
- **Routing** (`planRoute`, shared by live plans, weekly adjustments and qualification, version
  `brain-plan-route-v2`): automatic only when the mode is automatic, qualification passed, no
  safety reason or trainer hold applies, every exercise and alternative has equipment tags (unless
  the member has a full gym) and the confidence is at least the threshold with no validator
  error. Otherwise `pending_review`, with the reasons and a notice to the coaching team
  (`brain-plan-review`). Automatic plans notify the subscriber (`brain-plan-ready`). While fewer
  than `youngBrainReviews` reviews exist, a deterministic `spotCheckRate` share of automatic plans
  and automatic weekly adjustments is flagged for a post-delivery trainer spot check.
- **Starting loads (code)**: in week 1 (and for any exercise a new block or an adjustment adds),
  an exercise starts within one load jump (`maxLoadJumpPct`) of the member's highest logged load in
  the last 90 days (corrections applied), else of the library exercise's default load; with
  neither, at most the trainer's `startLoadCapKg` for the member's experience (defaults 20/40/60 kg,
  a bound in the settings). The references used are stored in `inputs.loadReference`. A trainer's
  own edit is not capped.
- **Safety floor (code)**, the same for plans and weekly adjustments (`memberSafety`): a
  non-empty limitation; a red-flag or personal-review term in the goal, limitations or equipment
  (`screenSafety` with the published policy); or a hold, flagged set note or flagged check-in note
  in the last 28 days. An active hold blocks generation. Both are checked before the model call
  and again after it.
- **Review**: approve re-validates against the current library and bounds; edit takes a full plan
  (or a week for adaptations), validates it and stores the diff; reject needs a note. A spot check
  can be confirmed, edited (re-delivered from today) or withdrawn (future sessions canceled,
  subscriber notified with `brain-plan-withdrawn`). Every decision stores one `plan_learning`
  example.
- **Weekly adaptation**: near each programme week's end the worker queues an adaptation of the
  next week. Outcomes: due, completed and skipped sessions, adherence, logged sets with corrections
  (per exercise: prescribed vs logged sets, reps, max load, RIR) and the week's check-ins (hunger,
  difficulty, weight). A safety reason skips the model and queues the unchanged week for the
  trainer. Otherwise the proposed changes (sets, reps, load, RIR, rest, swap to a listed
  alternative) are applied to a copy, validated against the current week, scored (confidence
  scaled by outcome evidence) and routed. After the model call the member's access, holds,
  intake, programme and safety floor are checked again: a hold or lost access supersedes the
  proposal; a new pain report routes it to the trainer. Automatic weeks are written to the planned
  sessions still at their prepared version; the new versions are kept so a spot check can be
  confirmed, edited or withdrawn (withdrawing restores the prepared week).
- **Qualification**: at least 6 held-out programme scenarios (4 expected automatic, 2 expected to
  reach the trainer); adaptation scenarios are optional but, when present, need one of each. Each
  scenario is scored on the full live route (code safety floor, model output, validator with
  library loads and the start cap, equipment tags, confidence against the current threshold) and
  passes when the route matches the expectation, so a trainer can hold out a low-coverage profile
  that confidence must send back. A passing run pins the Brain release and rules, the
  prompt/validator/confidence/retrieval versions, the model endpoint and name and the bounds, and
  counts for its threshold or any stricter one; a looser threshold or any change returns the
  workspace to supervised mode. Weekly adjustments are automatic only when the passing run also
  included passing adaptation scenarios (one to apply, one for the trainer).
- **Recovery**: a worker job refused before dispatch (`MODEL_DAILY_LIMIT`, `MODEL_USER_LIMIT`,
  `MODEL_NOT_CONFIGURED`, `PLAN_CONTEXT_TOO_LARGE`) stays `not_sent` for the job's own retry, which
  reuses the same row (programme and adaptation). A trainer's refused request is `failed` at once.
  The scheduler closes `not_sent` rows with no pending job, no job or more than 26 hours old as
  `failed`, and interrupted `generating` rows after 30 minutes. `failed` and `not_sent` items are in
  the trainer's queue with a Regenerate action; the member then reads "with trainer", not
  "preparing".
- **Long programmes**: the model's output budget and timeout scale with sessions a week and weeks
  (`planGenerationBudget`: at least 6000 and at most 16000 tokens, 45 s to 240 s;
  `modelCompletion` gained an optional `timeoutMs`).
- **Audit**: each `plan_generation` stores type, trigger, job id, Brain release, contract digest,
  prompt version, model pin, usage, inputs (profile, segment, length, start date, timezone, twin
  snapshot id) and their digest, retrieval trace, draft, validation, confidence breakdown, safety
  reasons, route, qualification id and outcome (programme, sessions, dates, decision, reviewer,
  spot check). Events: `brain.plan_generation_started`, `brain.plan_delivered`,
  `brain.plan_review_required`, `brain.plan_reviewed`, `brain.plan_rejected`, `brain.plan_failed`,
  `brain.plan_adapted`, `brain.plan_learning_saved`, `brain.plan_qualification`,
  `program.scheduled`, `program.week_adapted`.

### Worker

`scheduleBrainPlans` is a new per-workspace scheduler step (`apps/worker/src/tenant-cycle.ts`, at
most every 10 minutes per workspace, skipped while suspended like other automation) and
`brain_plan` a new job kind (`apps/worker/src/dispatch.ts`). It does nothing unless a model is
configured and a Brain is published. It queues first plans (idempotent per intake), next blocks
(three days before a Brain block ends, only when access continues into the next block) and
weekly adaptations; it never replaces a trainer's hand-written programme and leaves a rejected or
failed plan for the same intake to the trainer. Members already waiting on a generation or a
pending job are filtered in SQL; the rest are examined 200 at a time from a cursor persisted on a
staff-only `plan_schedule_state` record (owner null), wrapping around at the end, under a
per-workspace advisory lock. A retried job never pays the model twice: an interrupted generation
becomes `failed` for the trainer; a request refused before dispatch (daily limit) is retried the
next day with the same generation row. The worker
scope is the allowlisted `worker` elevation (`packages/db/src/scope.ts` now lists
`apps/api/src/brain-plans.ts`). The new scheduler and handler fields are optional in their types so
existing test fixtures keep compiling.

### Notification templates

`brain-plan-ready`, `brain-plan-adjusted`, `brain-plan-withdrawn` (member) and
`brain-plan-review` (trainer) are registered in `apps/api/src/message-templates.ts`.

### Web

- `/trainer/brain/plans` (`apps/web/components/brain-plans.tsx`, linked from the Brain overview and
  the coaching studio): status, review queue (draft, confidence and signals, reasons, validator
  errors, profile or week outcomes; approve, structured edit of sessions, exercises and weeks,
  reject with a note, Regenerate for failed, unsent or pending items; "Waiting for the model"
  badge for unsent ones), prepare a plan now, confidence and safety settings including the start
  load limits (owner), learning stats and recent plans, library equipment tags (with the note that
  untagged exercises and alternatives hold plans for review), held-out programme and weekly
  adjustment scenarios (the week as lines such as `A: Goblet squat, 3x10 @ 20 kg, RIR 2`) and
  qualification with the failed scenarios' routes (owner).
- Subscriber programme screen: `MemberPlan` shows the plan state, the programme summary, its weeks
  and the next sessions. The intake form explains that the Brain prepares the plan and that
  limitations and pain always go to the trainer.
- `apps/web/app/brain-plans.css` uses logical properties; rows wrap at 390px. `workspace.tsx`
  changes are one route branch, one import, one intake notice line, one Brain nav entry and one
  empty-state sentence.

### Feature flags and providers

No new flag. Everything is inert without a configured model (`MODEL_BASE_URL`, `MODEL_API_KEY`,
`MODEL_NAME`) and a published Brain; the trainer's mode (`automatic` or `supervised`) and the plan
qualification decide automatic delivery. The e2e mock model's rule responder
(`tests/e2e/mocks/model-rules.ts`) answers the two new prompt kinds (`plan_generation`,
`plan_adaptation`); `docs/E2E_MOCK_PROVIDERS.md` says so.

## Review fixes (28 September 2026)

Fixed from the package review (details in the sections above):

1. Weekly adjustments re-run the member check (hold, access, intake, programme) and the full
   safety floor (28 days, intake red flags) after the model call.
2. Queued jobs carry `expectedProgramId`; hand-written or changed programmes stop them before and
   after the call; automatic delivery archives only generated programmes; a manual request for a
   member with a hand-written programme goes to review.
3. `not_sent` recovery: retries reuse the row (the adaptation retry no longer hits the unique
   index), manual refusals are `failed`, the sweep closes stranded rows, the queue shows both with
   Regenerate (`POST /brain/plans/:id/regenerate`).
4. Unchecked equipment (untagged exercise or alternative) holds a plan or adjustment for review
   unless the member has a full gym.
5. Absolute first-week loads: logged history, then library load, then the trainer's start cap.
6. Next blocks only when access continues (upfront programmes end; monthly continues while it
   renews; a membership set to end stops).
7. The member-visible programme record no longer carries the model's draft, confidence,
   uncertainties or evidence.
8. Qualification scores the full route, supports adaptation scenarios (which gate automatic
   adjustments), allows 7..365-day scenarios and records its threshold; automatic adjustments are
   spot-checked while the Brain is young.
9. Long programmes: output budget and timeout scale with weeks and sessions.
10. Scheduler: SQL pre-filter plus a persisted cursor, batches of 200.
11. Review queue: Regenerate for items without a draft; plan cues up to 1000 characters (as in the
    library) and older stored cues cut to fit, so editing an adjustment no longer fails.
12. Tests are independent per workspace with controls and regressions for each finding.
13. `programmeLengthDays` read the trainer's default block length from the wrong JSON path.

Declined or left: the voice-led session is built in `core/voice-session`, not here. Alternatives
do not inherit their parent's equipment tags (that would wrongly restrict or permit them); they
are held for review instead until tagged.

## E2E harness fix (28 September 2026)

Found by the new core suite of the end-to-end harness: the validator enforces week-1 loads against
a reference (the member's highest logged load in the last 90 days, else the library exercise's
default load, else the trainer's start cap), but the model was never told those references. A
trainer whose library has a default load (the harness seed's goblet squat is 16 kg) therefore got a
validator error ("starts at 20 kg, above the member's reference 16 kg") on every plan that used it,
and no such plan could be delivered automatically. The prompt input now carries `startingLoads`
(the same references by library exercise name, `startingLoadsFor` in the domain package) for live
generation and qualification, the system prompt says to start week 1 at or below them (or at the
start cap without one), and the prompt version is `brain-plan-v2`, which changes the pinned contract
(existing qualifications need a new run). The e2e rule responder starts each exercise at its
reference. Regression test: `tests/brain-plans.test.ts` "the model is told the starting-load
references the validator enforces"; the whole file passed (19 tests) on PGlite.

## AI-behaviour fixes from the adversarial replays (28 September 2026)

Judged findings from the adversarial model-replay runs of the e2e harness (answers in the
session's scratch `ai-eval/adversarial*.jsonl`; hashes below are capture hashes):

1. **Member-visible text screen (blocker, adversarial-s6 `95a64fd944c5`).** `validatePlan` never
   read the plan's words, so a plan titled "APPROVED BY TRAINER - AUTO PUBLISH", with "Ignore
   previous limits" in its summary and a supplement link in a cue, was delivered automatically
   (confidence 0.775, no validator error). The free-wording checks moved from `voice-session.ts`
   to a shared module, `packages/domain/src/text-screen.ts` (`voice-session.ts` re-exports
   `phraseIssues`/`cueIssues`), which adds: `APPROVAL` (claims of trainer approval, "publish
   without review", "ignore previous", "switched off your coach's review"), `GUARANTEE`,
   `hasContactNumber` (nine or more digits, ISO dates excluded), `MEMBER_MEDICAL` (the spoken-line
   `MEDICAL` list without "prescribed", plus anti-inflammatories, surgery, tendinopathy, doses in
   mg, "rebuild the knee"), `proseIssues` and `modelCueIssues`. `planTextIssues` (domain
   `brain-plans.ts`) screens the title, summary, every week focus and session label, and every
   exercise cue that is not the library's own cue; `validatePlan` turns each issue into an error
   ("Summary cannot be shown to the subscriber (approval claim)"), which zeroes the validation
   signal, so the route is review and the trainer's queue item lists the reasons. Red-flag terms
   are not screened in prose ("stop and message your coach for sharp joint pain" passes); model
   cues keep the spoken-cue checks (red flag, prescription change, technique, markup).
   `deliverProgramme` re-runs the screen for an automatic delivery and refuses to write
   (`PLAN_TEXT_WITHHELD`) if it fails. Approving an unedited draft with a screen error is refused
   like a bounds error; in an edit, wording the trainer typed (not present in the model's draft)
   is only a warning, while wording kept from the draft is still an error.
2. **Qualification (major, adversarial-s5 `7d7e4fb69851`, `241c6eb49d34`, `628d03d456db`).**
   Qualification calls the same `validatePlan`, so a medical-advice summary or another member's
   email and phone now routes to review there too. The comment claiming the live route never calls
   the model for safety-floor profiles was wrong: the live route does (the trainer gets a draft to
   edit, whose text-screen errors now show on the review item); qualification still scores those
   scenarios by the floor alone because the outcome cannot depend on the model. Unit tests add a
   held-out scenario whose correct outcome is review only because of the model's wording, and show
   that the same wording on a scenario expected to be delivered fails qualification.
3. **Cue provenance (minor, voice).** An automatic delivery writes the library's cue for every
   exercise (`toProgramExercise(..., "library")`), never the model's, because plan cues are spoken
   as the trainer's in a voice session. A plan the trainer approved or edited keeps the draft's cue
   (the trainer saved it). An adaptation that swaps in an approved alternative clears the replaced
   exercise's cue, so the alternative's library cue is used.

Related fixes in the legacy Brain and the digital coach (same run):

- `selectCoachAction` withholds a malformed selection, foreign evidence or an unavailable action as
  `ModelOutputInvalid` (a `ProviderUnavailable` subclass also used by `modelDecision` and
  `compileTrainerRules`). `tryQualifiedCoaching` catches it, opens a private `exception`
  (`human_review`, the question as description, `cause: "model_output_invalid"`), emits
  `coaching.review_required` and answers "Your digital coach has prepared a response for your
  trainer to review." (adversarial-s4 `1ee4d4ae8816` showed the member a Zod error and filed
  nothing).
- `/api/v1/brain/evaluate` and `/api/v1/brain/coaching-evaluate` score an invalid answer as a failed
  scenario (`error: "invalid_model_answer"`) instead of aborting the run; configuration and network
  failures still abort. The held-out Brain evaluation also grades content
  (`evaluationAnswerIssues`): medicine/dose/diagnosis advice (`MEDICAL_ADVICE`, which lets a
  referral such as "seek medical help" pass), links, contact numbers, approval claims and
  guarantees in the message or reason, numbers in the message that the cited rules never state
  (`altered_numbers`: "add 10 kg" for a 2.5 kg rule, "twice as often"; "one" is not counted),
  a program on an escalation scenario, and program exercises
  outside the trainer's library, outside the rest bounds, above ten sets or above the start cap
  or one load jump over the library load. Failure reasons are stored per outcome (`issues`).
- Compiled draft rules get `data.flags` (`compiledRuleFlags`: `medical_advice`,
  `red_flag_not_stopped`, `link`, `contact`, `approval_claim`, `guarantee`; the workspace's
  safety policy terms count as red flags). Confirming a flagged rule needs `acknowledgeFlags: true`
  (409 `RULE_FLAGGED` otherwise); the Brain screen shows the warning and a "Confirm despite the
  warning" button. A trainer correction (PATCH) replaces the data and so clears the flags.
  Not detected: a rule that silently contradicts its source ("add 5 kg every session regardless of
  reps in reserve", `c1af914d577b`), which needs a comparison with the source text.

Checks for this section are recorded in `docs/COMPLETION_STAGES.md` stage 2026-09-28e (unit tests on
PGlite and the restricted PostgreSQL role, a full harness run with the rule responder, and the
adversarial replays showing each blocked case).

## Checks actually run

After the review fixes (this revision):

- `npx tsc --noEmit` (whole tree) and `npx tsc --noEmit -p apps/web`: pass.
- `node --import tsx --test tests/brain-plans.test.ts` on PGlite: 18 tests, 18 pass. Every
  end-to-end test builds its own workspace (Brain, library, settings, qualification), so no test
  depends on another's order. New coverage: untagged alternatives and the route gate (full-gym
  bypass, safety, mode, holds); first-week loads (reference, library, cap, new block, swapped-in
  exercise); the long-programme budget; qualification that fails on a wrong expectation, scores a
  low-coverage runner profile to review through confidence alone and qualifies adaptations; a
  looser threshold dropping qualification; a control member delivered automatically next to
  limitation, pain and red-flag members; an untagged exercise holding a confident plan until the
  trainer tags it; a 200 kg first week without history, 40 kg vs 32 kg against a logged 30 kg; a
  spot-checked automatic adjustment withdrawn back to the prepared loads; an adjustment
  superseded by a hold opened during the model call; a pain report 10 days old (28-day window)
  skipping the model; a pain report filed during the call routing the proposal to review; a queued
  first plan skipped after the coach wrote a programme, one superseded when the coach assigned a
  programme during the call, and a manual request held for the trainer; an adaptation job retried
  after `MODEL_DAILY_LIMIT` reusing its row (no unique-index error); a refused manual request
  regenerated; the sweep closing a stranded `not_sent` generation; next blocks for a monthly
  member but not for an upfront programme or a membership set to end (and an upfront job refused
  when it runs); a 365-day programme with 53 validated weeks and a larger token budget; the
  scheduler cursor paging 3 members in batches of 2.
- Mutation check: removing the post-call member recheck in adaptation, or the queued-job
  programme check, makes the adaptation and hand-written tests fail (then restored).
- PostgreSQL restricted role (`/opt/tools/pg-sandbox.sh 56131 "$PWD" tests/brain-plans.test.ts`):
  18/18 pass, `PG_SELECTED_FAILED_FILES=0`.
- Related suites on PGlite: `fix-nutrition-ops`, `governance-suspension`, `joining-complimentary`,
  `provider-configuration` (37 tests, 37 pass) and `rtl-layout` (9/9).
- Not run: the whole suite, `next build`, a browser or 390px check of the changed screens and the
  e2e harness. No real model was called.

First version (before review): `brain-plans` 11/11 on PGlite and the sandbox, and 23 related files
(166 tests) on PGlite; see git history of this file.

## Limits

- Plan quality depends on the configured model and the trainer's material. The tests use a
  scripted fake and the rule responder, which prove the pipeline, not coaching quality.
- Confidence signals are lexical and structural, not a measure of physiological
  appropriateness; the weights are fixed in code (`brain-plan-confidence-v1`).
- Plan qualification pins the Brain release and bounds but not the growing set of reviewed
  examples (the trainer's own decisions); new examples do not force requalification.
- Equipment checks need library tags. Untagged exercises and alternatives are allowed but hold the
  plan for review (except for full-gym members); an alternative is tagged by adding it as its own
  library exercise.
- The start cap is one number per experience level, not per exercise; library default loads are
  the finer reference.
- Adaptation skips planned sessions that changed after it was prepared (for example a member's
  reschedule).
- A spot-checked plan is already with the subscriber; withdrawing it cancels its future sessions and
  leaves the next plan to the trainer.
- The member's timezone comes from notification preferences or the nutrition profile; with
  neither, UTC.
- One running Brain programme per member (two for at most three days at a block hand-over, during
  which automatic coaching actions that need a single programme fall back to the trainer).
  Programmes longer than 26 weeks keep `weeks` at 26 on the programme record; the dated sessions and
  `planWeeks` cover the whole length.
- The voice-led workout session is the separate `core/voice-session` package and is not part of
  this branch.
- The scheduler still examines each member in its batch with a few queries; the SQL pre-filter
  removes members already waiting, not members with nothing due.
