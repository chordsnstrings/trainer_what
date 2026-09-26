# Completion stages — 26 September 2026

The owner requested all unfinished application work, verified and committed in stages. Screenshots are no longer requested. Parallel agents are authorized for separate areas. Latest owner steering: prioritize finishing app features; broad review and release qualification are deferred to the queue in CLAUDE_HANDOFF.md. Deployment remains stopped and owned by Claude; no cloud browser, live transactions, infrastructure purchases or provider qualification are part of these implementation checks.

## Recovery boundary

The local environment restored an older snapshot. Yesterday's uncommitted completion work is absent. The recovery note on `work-in-progress/completion-2026-09-25` documents intended behavior, not preserved source. Work here starts from published `620eef1` and reconstructs missing features. Previously passing release evidence does not verify these new changes.

## Stage register

Each implemented stage records concrete behavior, changed paths, actual checks and its remaining qualification. Only the coordinating agent stages and commits files. Completed stages are pushed before moving on; provider-dependent functionality stays gated until its real contract and account are qualified.

| Area | State | Next acceptance |
| --- | --- | --- |
| Recovery and ownership | Committed | Published checkpoint on work/completion-2026-09-26 |
| Workout coaching | Qualified runtime, training, attachments, case/history and scheduled follow-ups committed | Correction feedback, source coverage and adherence are connected; broad review is deferred |
| Nutrition | Four stages and current onboarding readiness committed | Qualify actual providers and final assembled application |
| Billing and finance | Servicing, statements, bookings, jobs, Checkout and paid conversion connected | Actual Stripe/Lean qualification remains |
| Administration and team | Scoped views, publication, team, ingestion, acquisition and temporary support preview connected | Infrastructure status connected; deferred review |
| Integrations | Connected and stage-tested | Premium voice product UI is connected; external qualification remains |
| Privacy and accounts | Connected, including attachments, acquisition and former-owner website media | Final combined privacy checks and external erasure evidence |
| Galleries and website | Uploads, galleries, drafts, SSR, manifests and former-owner privacy connected | Browser journeys |
| Notifications and worker | Routes, preferences/inbox, lifecycle/source-review/retention alerts, trainer policy and worker connected | Final browser and live email qualification remain |
| Release checks | Stage TypeScript passes; combined branch not qualified | Full tests/build/browser and non-owner PostgreSQL/container CI |

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

### Onboarding completion

The client submits the observed preview digest; stale approvals fail. Launch readiness uses current coaching/model, legal versions, independent nutrition evidence and actual voice consent, and explains private/published site state without a circular publish prerequisite. Six dedicated tests and two existing regressions passed, plus a final model-disconnection assertion. The Claude handoff now removes the fixed preview/type blockers.

### Private chat attachment completion

Image and raster-rebuilt PDF uploads now connect to message-only or attachment-only conversation delivery and scoped UI controls. Author/client/tenant binding is immutable; expired drafts cannot bind, and privacy/closure/worker cleanup includes bytes and message references. Forward migration030 upgrades the preserved028 schema without a reset. Seven attachment and eight privacy tests passed together after030; stage TypeScript passed. Browser qualification remains pending after the local Chromium CDN returned invalid archives. Root handoff updated in the same stage commit.

### Trainer website and gallery completion

Actual multipage public websites, private owner previews, gallery management/client galleries and coach-specific manifests/icons are connected. Brand writes serialize with media deletion and recheck current ownership/revisions; hidden pages are excluded from public data. Twelve coach-site and five branding tests, whole-tree TypeScript and scoped diff checks passed. Existing migration018 is unchanged. Browser journeys and former-owner media erasure remain separate work; root handoff updated.

### Coaching capacity and history hardening

Active coaching material is bounded before creation/model calls; held-out cases and the active release load separately from recent evaluations. Revision-checked assessment archiving permits replacement without leaking archived questions into training. Seven runtime tests and a final targeted assertion passed; whole-tree TypeScript and diff checks passed. No migration; root handoff updated in the same stage commit.

### Migration upgrade and runtime permission verification

A dedicated original001–029 →030 migration regression preserves existing conversation/media state and verifies binding, expiry and scoped helpers. Five behavioral subtests passed (six reported checks including their parent). Fresh all 30 migrations and twice-applied grants passed runtime verification of 54 tables and nine privileged helpers, including no PUBLIC helper execution and no unclassified definer helpers. Test TypeScript, script syntax and diff checks passed. Real PostgreSQL/container/browser remain CI gates; no deployment.

### Consented acquisition completion

Explicit consent and host-scoped opaque cookies now govern attribution and guarded landing/onboarding wording experiments. Actual signup/new enrollment, publication and verified first-positive-payment hooks dedupe after commit; analytics failures preserve business success. Withdrawal, export/erasure and bounded expiry cleanup include linked anonymous history. Thirty-four focused acquisition/onboarding/privacy/admin tests and TypeScript passed. Migration029 is unchanged. Browser interaction remains pending; root handoff updated.

### Former-owner media privacy completion

Reviewed personal erasure now removes owned media/galleries and exact applied/private design references, bumps stale-editor revisions and compacts remaining gallery order. Other users' media, other workspaces and the continuing workspace are preserved. Four new media privacy tests, eight existing lifecycle tests, TypeScript and diff checks passed. No migration/grant change; root handoff updated.

### Notification settings connection correction

Replaced the mistakenly retained legacy Settings form with NotificationPreferences. Kept old-client opt-outs effective in the actual preference row without resetting newer quiet-hour/booking choices; revisions advance for conflict detection. Nine notification tests passed and the component mount passed TypeScript. Browser persistence review is deferred per the latest owner instruction; the root handoff has the review queue.

### Browser continuation harness prepared

Updated browser selectors and added consent, gallery/website, private attachment and notification-preference journeys. A local-only synthetic launched-workspace fixture separates website-publication testing from launch qualification; offline checks remain. Four syntax checks and scoped diff checks passed. Browser execution is unrun and explicitly deferred per owner steering; this is test-harness implementation, not feature verification.

### Scheduled coach follow-ups completed

Added private scheduling/rescheduling/canceling and history to actual conversation screens. Worker delivery is context-checked and transactional with one message/notification; changed access/consent/safety/coaching context returns to review. Sender/client erasure includes scheduled and delivered content. Migration032 adds private record policies and unique intents/delivery indexes. Seven real-app follow-up and eight existing privacy tests passed; diff checks passed and no external calls occurred. Browser/timezone and real PostgreSQL review are deferred in the root handoff.

### Current Twin facts and complete compilation input

Current profiles/active holds now survive bounded history queries and retain lineage; current corrections and history overflow are explicit. Compiler input is sent in full within visible limits, with explicit source selection and persisted/returned coverage. Five new checks, three selected existing Twin/model-accounting checks, TypeScript and diff checks passed. Includes a real authenticated /brain/compile regression. No migration; quality/source review is deferred and the root handoff is updated.

### Temporary support preview completed

Added case/session-bound read-only account/access/connection previews with fresh MFA, reason, 15-minute expiry, visible Stop/banner, repeated authority checks and real-operator audit. App registration and support links are connected; migration031 has narrow system grants. Seven focused tests, strict TypeScript and diff checks passed. Sensitive view reproduction/write elevation are not implemented; browser/PostgreSQL/retention review is deferred explicitly in the handoff.

### Observe-only infrastructure operations completed

Actual process/API/worker/DB/queue observations, versioned thresholds, evidence-linked recommendations and audited acknowledgement/recovery are connected to admin/API/worker. Stale/partial evidence cannot prove recovery; execution is always denied. Migration033 and narrow grants are included. Nine observer tests, connected TypeScript and all 33 migration/runtime grants checks passed (58 tables/nine helpers). Cloud telemetry remains explicitly unavailable; production/browser/fleet/retention/load review is deferred in the handoff.

### Training adherence and latest-block summary completed

Added timezone-aware rolling 28-day history/next 28-day schedule and complete latest-assigned-block summaries across verified revisions. Completion needs exact linked workout evidence; held/canceled/abandoned/unverifiable states are separate, and bounded legacy/overflow coverage is explicit. Trainer/subscriber views show counts and expandable lineage. Two new and three existing focused checks, TypeScript and diff checks passed. No migration; active-block selection and browser/release review are deferred in the root handoff.

### Correction-to-teaching and regression workflow completed

Added guarded replacement decisions preserving originals, preferred/rejected correction episodes, meaningful/cosmetic differences and saved teaching drafts. Owner-confirmed teaching reuses held-out exclusion; linked independent evaluation reports readiness without releasing or leaking prompts. Client-owned outcomes, privacy erasure and consent revocation are connected in the actual app and attention-list UI. Eight new and seven existing runtime tests, TypeScript and diff checks passed. No migration/provider call; broad security/browser/quality review is deferred in the root handoff.

### Lifecycle messages and trainer reminder policy completed

Connected bounded, deduplicated trainer/subscriber lifecycle triggers with pinned source/template identity and current-state delivery checks. Coverage includes onboarding/interview/payout setup/readiness, paid milestones/review queue, intake/program/workout/block/wearable and verified billing/refund/payout states. Owner-controlled missed reminders are off by default and honor exact policy revisions, recorded schedule, current paid consent, safety and client workout/quiet-hour preferences. API, Settings UI and worker are connected; existing notification/job privacy applies, with no migration or live provider call. Eight lifecycle plus nine existing notification checks and final whole-tree TypeScript passed; basic policy component rendering and diff checks passed. Backfill/candidate/expiry bounds and unsupported churn/upload-count/push features remain explicit in the root handoff. All assigned continuation slices are committed; broader scope and release/provider qualification remain for Claude.

### Upload and compilation review notifications completed

Connected actual extraction and compilation to generic, deduplicated review prompts with exact proposed rule/conflict counts and source/batch references. Delivery suppresses stale or revoked material, changed review states, expired prompts and lost trainer/workspace access. Compilation rechecks selected material and current authority after model processing before persisting results. Four new actual-app checks and two existing targeted regressions passed; diff checks passed. No migration or real provider call. Final connected TypeScript subsequently passed with the retention stage; root handoff updated.

### Searchable coaching history completed

Added correction/outcome full-text search with change/category/client filters, bounded keyset pagination, deletion-safe cursors and connected attention-list controls. Current trainer/workspace checks, held-out exclusion, existing detail/teaching behavior and erasure are preserved. Seven new route tests and eight correction-workflow regressions passed; diff checks passed. Migration034 adds indexes over current records. Tenant RLS prevented GIN use in the local diagnostic; no isolation bypass was added, and the 3-second timeout/input/page bounds remain explicit. Final connected TypeScript subsequently passed; production plans/performance/browser remain deferred as recorded in the root handoff.

### Configurable retention alerts completed

Connected an owner-only Business policy/cohort/evidence panel and bounded worker alerts. Actual linked positive invoices plus confirmed instructions or signed subscription receipts determine scheduled/ended/recovered states; incomplete or unresolved evidence suppresses alerts. Policies are off by default, revision-safe and bounded; source/policy/ownership/preferences/expiry are rechecked before email, with poll deduplication and a 24-hour cooldown. Shared bootstrap excludes retention configuration. Eight tests (including actual assembled routes/bootstrap and notification delivery), final whole-tree TypeScript and diff checks passed. No migration/provider call. Counts are recorded current-member evidence, not historical churn rates; bounds and PostgreSQL/browser/provider review remain explicit in the root handoff.
