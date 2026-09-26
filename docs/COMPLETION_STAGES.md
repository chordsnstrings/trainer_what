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

### Administration stage 1

Dedicated scoped operator screens replace overview fallbacks for acquisition, accounts, Brain/safety, usage, integrations, support, jobs, audit, experiments and content. Effective legal/template publication, support CAS/macros, evidence-based email recovery and consented business analytics are implemented. Seven focused tests and TypeScript passed at the stage boundary.

### Nutrition stage 2

Coach-defined calorie methods, profile-bound individual calorie/macro/hydration targets and habits, and validated client week assignment/amendment/archive are implemented. Target/profile/consent changes are rechecked before model delivery. Twenty-seven related tests and TypeScript passed at this stage; four completion tests were rerun after the last refinements.

### Privacy stage 1

Scoped exports and local erasure now include derived data and explicit provider/backup follow-up evidence. Two-party ownership transfer and independently reviewed workspace closure recheck financial obligations and revoke sessions; closed workspaces reject normal access. Consent records resolve published legal versions. Seven privacy tests passed after route integration. Actual external erasure requires recorded provider/backup evidence.

### Coaching stage 2

Dated multiweek prescriptions, reusable templates, exercise-specific progression, approved substitutions, immutable set corrections, progress summaries, chat refresh and rest/RIR tools are connected. Seven focused tests passed, including cross-tenant schedule and stale-edit cases. Current-member checks now use a narrowly scoped database helper.

### Nutrition stage 3

Consumed-day totals, trends, detailed corrections, favorites and meal copying now connect to the diary. Photo quantity edits rescale nutrients and can use confirmed food facts. Grocery purchase quantities and expiry-aware leftovers/inventory are recorded. Thirty nutrition/capture tests passed after fixing the cross-feature media policy.

### Coach business and finance completion

Effective financial policies, gross-to-net statements, promotion/trial terms, paid one-to-one bookings and reviewed financial jobs are connected to API, UI, Stripe event dispatch and worker. Recurring slots preserve local time, policies/capacity/changes are guarded and private calendar downloads are available. Published legal content replaces draft-only pages. Nineteen combined booking/finance checks passed. Lean/bank finality still uses verified evidence; no live transaction was made.

### Team and knowledge import completion

Team invitation, role, revocation and session controls now use current owner/MFA/revision checks. Knowledge imports support bounded spreadsheets, program JSON and real image/scanned-PDF OCR, with extraction cleanup, privacy review/redaction and approved compilation material. API/UI and Docker/CI dependencies are connected. Fourteen team/import tests, three legacy import tests and TypeScript passed.

### Finance final safeguards

Admin refund overrides now have a dedicated review UI and current MFA/revision checks. Monthly jobs can be explicitly reauthorized against the displayed policy revision while preserving payment identities. Financial worker result helpers use attempt/lease CAS for success and failure. Fifteen focused finance tests and TypeScript passed; worker uses this helper in the integration stage.
