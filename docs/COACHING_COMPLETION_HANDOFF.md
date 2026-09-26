# Coaching completion — 26 September 2026

## Stage 1: subscriber-wide safety holds

New route module: `registerCoachingCompletion(app, db)` from `apps/api/src/coaching-completion.ts`.

Remove the old app.ts handlers for `/workouts/start`, `/workouts/:id/sets`, `/workouts/:id/finish`, `/workouts/:id/pain`, `/coaching/ask`, `/takeover`, and `/exceptions/:id/resolve`, then register this module. Keep existing `/programs`, `/messages`, and Brain handlers for this stage.

Acquire `lockTraining(tx, actor)` in the existing intake and coaching-consent mutations before changing data. This is the same lock used by workout mutations, safety reports, takeover, trainer review and model output commit.

UI: import `TrainingHoldReview` and `TrainingHoldNotice` from `coaching-completion.tsx`. Render `<TrainingHoldReview onChange={...bootstrap reload...} />` in trainer Exceptions before the ordinary list. Render `<TrainingHoldNotice records={state.records} />` in subscriber program and workout views. The new controls use their own requests and refresh their own holds; `onChange` should refresh shared state too.

Migration013 creates an independent active hold per subscriber and backfills existing paused sessions. Generic exception resolution cannot clear the hold. Trainer explicit resume/abandon writes the resolution, affected workout state, client message and audit event atomically. New sessions, sets, finish and subscriber abandonment share the same lock and hold gate. Existing set retries remain side-effect free. Safety questions also create the hold. Ordinary takeover questions stay ordinary human review.

No outgoing email delivery is claimed. `openTrainingHold` records `safety.escalated` and a visible exception; root can attach its notification helper there.

Verification: all five original safety cases passed. Stage 1 was committed as `d10743a`.

## Stage 2: persisted training programs and client workflow

`registerTrainingPrograms(app, db)` replaces the legacy `/programs` handler. Root integrated the module, `TrainingPrograms`, `CoachingMessages`, `TrainingProgress` and `WorkoutTools` in the shared workspace. The existing offline log flow remains active; repetitions in reserve are now recorded too.

- Trainer templates and assignments create dated multiweek sessions, with separate weekday prescriptions, coaching cues, rest, repetitions in reserve, demonstrations and approved alternatives.
- Clients start a scheduled snapshot, reschedule or skip future sessions, use only approved substitutions before logging an exercise, and explicitly end incomplete workouts.
- Trainer progression changes the named exercise in future prescriptions while keeping existing workout snapshots intact.
- Set corrections append new evidence, retain the original log, guard against stale edits and feed corrected totals plus correction lineage into the Client Twin.
- Conversations refresh while visible and support paginated tenant-scoped history and personal takeover. Program, history and progress screens show real persisted data.
- `training_actor_is_current` in migration026 narrowly rechecks the current actor's role and workspace lifecycle under the training lock. It grants no general tenant-table access.

Verification: seven targeted coaching-completion tests passed; stage 2 was committed as `be853a3` (published checkpoint `bf8802f`).

## Stage 3: coach teaching and qualified automatic runtime

`registerCoachingRuntime` is called by `registerCoachingCompletion`; no additional app registration is needed. UI `CoachingStudio({path})` handles `/trainer/brain/teaching`, `/actions`, `/checks` and `/autonomy`; route these before the old Brain handler and link from the overview.

The coach teaches recommendations, rationale, alternatives, changed conditions and escalation boundaries. Follow-up questions address missing areas and contrast the coach's previous recommendations. Teaching cases and held-out scenarios cannot overlap; near-identical and numbered copies do not inflate evaluation coverage.

The runtime supports trainer-approved messages, starting a saved program, bounded exercise progression, an approved exercise substitution and a one-to-three-day calendar postponement. Progression requires recorded completed sets, target repetitions, known reserve and the coach's percentage bound. Automatic program creation requires no existing assigned program; ambiguous or different prescriptions fall back to trainer review. Changes to future plans keep workout history intact.

Qualification requires at least 20 independent cases, two positive cases per enabled action, two nearby but unsupported requests that require model refusal, and coverage for pain, urgent symptoms, pregnancy and self-harm. Each enabled category needs a full teaching example. Held-out outcomes are never included in the learning prompt. Evaluation and activation pin the model endpoint/name, prompt and policy versions, Brain snapshot, actions, teaching cases and program templates; stale material cannot be activated or delivered.

Automatic text is the coach's approved copy with deterministic details from the applied action. Arbitrary model prose is retained only for personal review. Structured decisions are stored before effects and messages. Delivery rechecks payment access, consent, member/workspace state, safety holds, takeover, current profile/training facts and qualified release. Shadow mode stores proposed actions; trainer approval applies the same bounded effect once after fresh validation. Model changes invalidate automatic qualification.

Verification: six runtime tests passed with local synthetic provider responses, including the full automatic program → logged completed workout → progression → substitution → schedule path, and one-time shadow approval. The three dependent baseline consent/workout tests passed after explicitly clearing their prior safety-hold fixture; the consent 409 assertion remains intact. Additional safety-note logging creates a hold.

## Deliberate boundaries and handoff

- Real model quality remains to be qualified with each coach's own cases and configured provider; fixtures prove application controls and persistence, not clinical or provider quality.
- Unrestricted novel prescriptions remain supervised. Automatic support is limited to explicitly defined, evaluated actions; current code does not claim per-coach model-weight training.
- Exercise demonstrations are links. Rich private message attachments and hosted exercise video uploads are not included in these coaching stages.
- Root owns notification delivery, global onboarding links, legal/privacy flow, broad suite/build and release checkpoints. Root should acquire the tenant `:brain` advisory lock on the legacy Brain rollback path. Subscriber safety reports sent through the plain `/messages` route should call `openTrainingHold` under `lockTraining`, just like the digital-coaching and workout-note paths.
- No cloud browser, screenshots, deployment, live provider calls or payments were used for these stages.
