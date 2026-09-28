# Trainer Brain plan generation (work package `core/brain-plans`)

Status: implemented on branch `core/brain-plans` (migration 063). Everything here is engineering
work with a scripted fake model; no real model, provider or live server was used.

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
`plan_generation`, `plan_learning`, `plan_scenario`, `plan_qualification`); none is in
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

`apps/api/src/programme-length.ts` — `programmeLengthDays(tx, userId)`: the member's current offer
(`subscriptions.data.productId` → `product.data.programmeDays`, 7..365), else the trainer's
`defaultBlockDays` plan setting, else 28 (`BRAIN_DEFAULT_PROGRAMME_DAYS`). The `programme` package
owns the final logic; the signature is the agreed one.

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
| `POST /api/v1/brain/plans/scenarios`, `.../scenarios/:id/archive` | owner | held-out plan scenarios (at most 50) |
| `POST /api/v1/brain/plans/qualify` | owner | run plan qualification |
| `POST /api/v1/brain/plans/exercises/:id/equipment` | owner, staff | tag a library exercise's equipment |
| `GET /api/v1/brain/plans/mine` | subscriber | own plan state, generated programme summary and the next 14 Brain sessions |

Behaviour:

- **Generation** runs in three steps (gather in one transaction, call the model outside it,
  recheck and route in a second). The recheck supersedes the draft if access, consent, intake or
  a safety hold changed meanwhile. Length from `programmeLengthDays`; start date is today in the
  member's timezone (notification preference, then nutrition profile, then UTC), or the day after
  the running block for a next block. A delivered plan is one `program` (status `assigned`,
  `generated: true`, `startDate`, `endDate`, `planWeeks`, `draft`, `generationId`) and one
  `planned_session` per training date (`date`, `timezone`, `week`, `label`, `sessionKey`,
  `program.exercises` in the existing exercise shape, `programId`, `programVersion`) plus the
  `program.scheduled` event, as `scheduleProgram` writes them. Other assigned programmes are
  archived and their sessions from the start date canceled; a Brain block that ends before the new
  one starts stays assigned for its last days and the worker archives it once it has ended.
- **Routing**: automatic only when the mode is automatic, plan qualification passed for the
  current contract, no safety reason applies and the score is at least the threshold. Otherwise
  `pending_review`, with the reasons (safety, supervised mode, missing qualification,
  low-confidence signals, validator errors, model uncertainties) and a notice to the coaching team
  (`brain-plan-review`). Automatic plans notify the subscriber (`brain-plan-ready`). While fewer
  than `youngBrainReviews` reviews exist, a deterministic `spotCheckRate` share of automatic plans
  is flagged for a post-delivery trainer spot check.
- **Safety floor (code)**: a non-empty limitation; a red-flag or personal-review term in the goal,
  limitations or equipment (`screenSafety` with the published policy); or a hold, flagged set note
  or flagged check-in note in the last 28 days (7 for adaptation). An active hold blocks generation.
- **Review**: approve re-validates against the current library and bounds; edit takes a full plan
  (or a week for adaptations), validates it and stores the diff; reject needs a note. A spot check
  can be confirmed, edited (re-delivered from today) or withdrawn (future sessions canceled,
  subscriber notified with `brain-plan-withdrawn`). Every decision stores one `plan_learning`
  example.
- **Weekly adaptation**: near each programme week's end the worker queues an adaptation of the
  next week. Outcomes: due, completed and skipped sessions, adherence, logged sets with corrections
  (per exercise: prescribed vs logged sets, reps, max load, RIR) and the week's check-ins (hunger,
  difficulty, weight). A pain or safety report skips the model and queues the unchanged week for
  the trainer. Otherwise the proposed changes (sets, reps, load, RIR, rest, swap to a listed
  alternative) are applied to a copy, validated against the current week, scored (confidence
  scaled by outcome evidence) and written to the planned sessions (only those unchanged since) or
  queued for review.
- **Qualification**: at least 6 held-out scenarios, at least 4 expected deliverable and 2 expected
  to reach the trainer. Code-safety scenarios pass without a model call; the others pass when the
  validator result matches the expectation. A passing run pins the Brain release and rules, the
  prompt/validator/confidence/retrieval versions, the model endpoint and name, and the bounds;
  changing any of them (or the scenarios) returns the workspace to supervised mode.
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
(three days before a Brain block ends) and weekly adaptations; it never replaces a trainer's
hand-written programme and leaves a rejected or failed plan for the same intake to the trainer. A
retried job never pays the model twice: an interrupted generation becomes `failed` for the
trainer; a request refused before dispatch (daily limit) is retried the next day. The worker
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
  reject with a note), prepare a plan now, confidence and safety settings (owner), learning stats
  and recent plans, library equipment tags, held-out scenarios and qualification (owner).
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

## Checks actually run

- `npx tsc --noEmit` (whole tree): passes.
- `node --import tsx --test tests/brain-plans.test.ts` on PGlite: 11 tests, 11 pass. Covered:
  validator bounds; confidence, coverage, safety reasons and diff; the e2e rule responder's output
  validates; template registration; supervised generation to review, then approval with dated
  sessions in `Pacific/Kiritimati` from a 14-day offer; a validator rejection that cannot be
  approved, a rejected edit, then a validated edit with its diff learned; learning raising later
  case coverage and confidence and appearing in retrieval; qualification (4 model calls, 2
  code-safety gates) enabling automatic delivery with a spot check, and changed bounds returning
  to supervised; the safety floor for a limitation, recent pain and a red flag, and an active hold
  blocking; worker scheduling to job to generation without a second model call on re-run;
  adaptation from logged outcomes raising next week's loads and a pain report skipping the model;
  next block queued before the end with hand-over and later archive; workspace isolation and member
  route refusals.
- PostgreSQL restricted role (`/opt/tools/pg-sandbox.sh 56131`): migrations (55 files) and
  `verify-runtime-access.mjs` passed (`helpers: 41`); every selected file passed: `brain-plans`
  11/11, `isolation-elevation` 3/3, `isolation-scope` 8/8, `coaching-runtime` 8/8,
  `governance-suspension` 7/7, `fix-nutrition-ops` 8/8, `messaging-templates` 5/5.
- Related existing suites plus this package's test on PGlite, on the final code, in one run of 23
  files: 166 tests, 166 pass (`coaching-runtime`, `coaching-completion`, the four `isolation-*`
  files, `messaging-templates`, `governance-suspension`, `fix-nutrition-ops`, `e2e-harness-mocks`,
  `client-twin-adherence`, `fix-coaching`, `coaching-feedback`, `coaching-retrieval`,
  `coaching-input-coverage`, `bounded-bootstrap`, `notifications`, `privacy-lifecycle`,
  `client-context`, `coaching-followups`, `logical-css`, `rtl-layout`, `brain-plans`).
- Not run: the whole suite, `next build`, a browser journey and the e2e harness. No real model was
  called.

## Limits

- Plan quality depends on the configured model and the trainer's material. The tests use a
  scripted fake and the rule responder, which prove the pipeline, not coaching quality.
- Confidence signals are lexical and structural, not a measure of physiological
  appropriateness; the weights are fixed in code (`brain-plan-confidence-v1`).
- Plan qualification pins the Brain release and bounds but not the growing set of reviewed
  examples (the trainer's own decisions); new examples do not force requalification.
- Equipment checks need library tags; untagged exercises are allowed with a warning that lowers
  confidence.
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
- The voice-led workout session is a separate package and was not built here.
