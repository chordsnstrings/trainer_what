# Completion stages — 26 September 2026

The owner requested all unfinished application work, verified and committed in stages. Screenshots are no longer requested. Parallel agents are authorized for separate areas. Deployment remains stopped and owned by Claude; no cloud browser, live transactions, infrastructure purchases or provider qualification are part of these implementation checks.

## Recovery boundary

The local environment restored an older snapshot. Yesterday's uncommitted completion work is absent. The recovery note on `work-in-progress/completion-2026-09-25` documents intended behavior, not preserved source. Work here starts from published `620eef1` and reconstructs missing features. Previously passing release evidence does not verify these new changes.

## Stage register

Each implemented stage records concrete behavior, changed paths, actual checks and its remaining qualification. Only the coordinating agent stages and commits files. Completed stages are pushed before moving on; provider-dependent functionality stays gated until its real contract and account are qualified.

| Area | State | Next acceptance |
| --- | --- | --- |
| Recovery and ownership | Committed | Published checkpoint on work/completion-2026-09-26 |
| Workout coaching | Qualified runtime and training stages committed | Unfinished attachment module/UI and final assembled checks |
| Nutrition | Four checked stages committed | Finish the separate onboarding readiness changes; qualify actual providers |
| Billing and finance | Servicing, statements, bookings, jobs and Checkout committed | Actual Stripe/Lean qualification and acquisition conversion hook remain |
| Administration and team | Scoped views, publication, team and ingestion committed | Acquisition consent/experiments implementation remains unfinished |
| Integrations | Connected and stage-tested | Product voice UI and external qualification remain |
| Privacy and accounts | Connected and stage-tested | Attachments/acquisition privacy hooks still need completion |
| Galleries and website | Backend tested; UI/SSR written | Register routes, wire navigation/brand ownership locks/client manifest, then browser checks |
| Notifications and worker | Routes, preferences/inbox, events and worker connected | Final browser and live email qualification remain |
| Release checks | Not passed on combined branch | Fix explicit type/preview/Checkout failures, full tests/build/browser and non-owner PostgreSQL CI |

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

### Nutrition qualification completion

Adaptive teaching now checks conflicting cases and requires independent worked meal, portion, nutrient, rationale and safety evidence before automatic activation. Old releases require requalification. Subscriber-requested generation uncertainty has a durable recovery path and cannot be retried under a new key. Thirty-three related tests and TypeScript passed; nine completion tests passed again after the final recovery refinement. Real provider quality remains a separate qualification requirement.

### Connected integrations and verified hosts

Wearable connection/revocation, trainer voice enrollment and guided playback, reviewed domain ordering and DNS/TLS verification, signed host forwarding, scoped integration operations and worker processing are connected. Explicit provider contracts and rights gates remain enforced; no live provider was called. Forty-five focused integration/settings/configuration/host tests and TypeScript passed. The worker also uses the committed finance lease-CAS helper.

### Account access and privacy completion

Magic-link login, authenticator recovery codes, verified WebAuthn passkeys, session controls and account settings are connected for members, trainers and administrators. Privacy export/erasure covers all current owned data, including notification preferences and inboxes; stale membership and financial obligations remain guarded. Eighteen account/privacy tests passed, including real signed WebAuthn assertions and assembled-app route checks. Aggregate TypeScript is deferred until the concurrent attachment module finishes.

### Qualified workout coaching completion

Case teaching, confirmed routine actions, independent evaluation, shadow approval and qualified automatic delivery are connected to the Brain screens. Contract pins cover current model, rules, examples, actions and templates. Changes, safety holds, takeover and revoked consent stop automatic effects. Plain chat safety reports now create the same training hold; rollback serializes with qualification. Fourteen coaching/runtime tests passed after these shared hooks. Attachment work is a separate unfinished stage.

### Claude handoff request

The owner requested a written handoff on 26 September because of token budget and intends to use Claude to finish. Stop new feature expansion, checkpoint existing completed and unfinished work, and keep `CLAUDE_HANDOFF.md` current after each completed stage. Deployment remains stopped. Unfinished checkpoints must not be described as verified completion.

Frozen implementation is preserved for continuation. The handoff names the two current TypeScript errors, five failing new Checkout tests, onboarding preview payload break, unregistered website/notification/Checkout modules and all unfinished UI/worker/privacy hooks. Infrastructure checks applied all 29 migrations and role grants in PGlite and passed 36 deployment boundary tests with one Docker-only skip. Those results do not qualify the combined application. No further feature implementation was started after the handoff request.

### Resumed Checkout completion

The owner resumed implementation after the handoff checkpoint. Atomic current-workspace/subscriber Checkout admission now preserves database isolation; unresolved outcomes block duplicate purchase and closure until provider evidence resolves them. Routes, member reconciliation and premium voice controls are connected. Eight Checkout tests and sixteen finance tests passed, including an assembled-app smoke. Root handoff updated with the resolved failures and remaining work.

### Notification completion

Preferences/inbox are connected to actual screens; safety, nutrition review, chat, booking/payment/refund and reminder events queue private, deduplicated alerts. Unknown email outcomes require evidence-based recovery; stale worker leases cannot resend or overwrite. Eight final notification tests and two signed paid-booking cases passed, following connected 22- and 30-test runs. The root handoff records exact boundaries and the unrelated in-progress acquisition typecheck blocker.
