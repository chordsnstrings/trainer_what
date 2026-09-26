# Coaching completion — 26 September 2026

## Stage 1: subscriber-wide safety holds

New route module: `registerCoachingCompletion(app, db)` from `apps/api/src/coaching-completion.ts`.

Remove the old app.ts handlers for `/workouts/start`, `/workouts/:id/sets`, `/workouts/:id/finish`, `/workouts/:id/pain`, `/coaching/ask`, `/takeover`, and `/exceptions/:id/resolve`, then register this module. Keep existing `/programs`, `/messages`, and Brain handlers for this stage.

Acquire `lockTraining(tx, actor)` in the existing intake and coaching-consent mutations before changing data. This is the same lock used by workout mutations, safety reports, takeover, trainer review and model output commit.

UI: import `TrainingHoldReview` and `TrainingHoldNotice` from `coaching-completion.tsx`. Render `<TrainingHoldReview onChange={...bootstrap reload...} />` in trainer Exceptions before the ordinary list. Render `<TrainingHoldNotice records={state.records} />` in subscriber program and workout views. The new controls use their own requests and refresh their own holds; `onChange` should refresh shared state too.

Migration013 creates an independent active hold per subscriber and backfills existing paused sessions. Generic exception resolution cannot clear the hold. Trainer explicit resume/abandon writes the resolution, affected workout state, client message and audit event atomically. New sessions, sets, finish and subscriber abandonment share the same lock and hold gate. Existing set retries remain side-effect free. Safety questions also create the hold. Ordinary takeover questions stay ordinary human review.

No outgoing email delivery is claimed. `openTrainingHold` records `safety.escalated` and a visible exception; root can attach its notification helper there.

Verification: targeted tests are in `tests/coaching-completion.test.ts`; check results are recorded after root integration.
