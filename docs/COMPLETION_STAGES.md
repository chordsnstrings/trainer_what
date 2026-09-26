# Completion stages — 26 September 2026

The owner requested all unfinished application work, verified and committed in stages. Screenshots are no longer requested. Parallel agents are authorized for separate areas. Deployment remains stopped and owned by Claude; no cloud browser, live transactions, infrastructure purchases or provider qualification are part of these implementation checks.

## Recovery boundary

The local environment restored an older snapshot. Yesterday's uncommitted completion work is absent. The recovery note on `work-in-progress/completion-2026-09-25` documents intended behavior, not preserved source. Work here starts from published `620eef1` and reconstructs missing features. Previously passing release evidence does not verify these new changes.

## Stage register

Each implemented stage records concrete behavior, changed paths, actual checks and its remaining qualification. Only the coordinating agent stages and commits files. Completed stages are pushed before moving on; provider-dependent functionality stays gated until its real contract and account are qualified.

| Area | State | Next acceptance |
| --- | --- | --- |
| Recovery and ownership | Committed | Published checkpoint on work/completion-2026-09-26 |
| Workout coaching | In progress | Safety-hold lifecycle and governed automatic actions; scheduled logging |
| Nutrition | In progress | Current facts and safe week recovery; individual targets, plan editor and diary |
| Billing and finance | In progress | Servicing/idempotency; billing history, statements, reconciliation and paid bookings |
| Administration and team | In progress | Real scoped operator views, content publication, team roles and bookings |
| Integrations | In progress | Contract-gated wearables, voice, domains and verified host handling |
| Privacy and accounts | In progress | Export/erasure/closure/transfer, secure account recovery and sessions |
| Galleries and website | In progress | Actual image uploads, unlimited galleries, published pages and trainer app identity |
| Notifications and worker | In progress | Preference readback/delivery, reminders and safe external-outcome recovery |
| Release checks | Pending | TypeScript, targeted/full suites, production build and non-owner PostgreSQL CI |

## Evidence

This file is updated with actual stage evidence as work completes. No unfinished row is a claim of delivery.

### Nutrition stage 1

Current food/recipe versions and safe weekly recovery are implemented. Sixteen focused tests passed (14 existing, two new), covering supersession, isolation, unsent versus uncertain dispatch, audit and stale recovery. This is fixture qualification; real model qualification remains open. See NUTRITION_COMPLETION_HANDOFF.md.

### Coaching stage 1

Subscriber-wide safety holds now prevent bypass by starting another workout. Explicit trainer resume/abandon, hold visibility, concurrency and consent/profile/takeover rechecks are connected. Five focused tests passed with isolated provider fixtures. Escalation records are present; preference-aware delivery is a later stage.

### Billing stage 1

Existing subscribers can be serviced while new sales are paused. Distinct cancel/reactivate transitions have stable individual intents; uncertain outcomes require reconciliation. Invoice/payment history, selected-charge refund requests, operator overrides and finite past-due grace are connected. Six focused finance regressions passed with isolated Stripe fixtures.
