# Claude continuation handoff

Updated 27 September 2026 (afternoon). PR #1 and [PR #2](https://github.com/chordsnstrings/trainer_what/pull/2) are merged into `main`. At the owner's request the application runs live on a new DigitalOcean project, GymMembership, which deployed `main` `eb7b678` automatically after its checks passed, and live verification passed on it. Historical stage entries below retain their original evidence.

## Start here

- Repository: https://github.com/chordsnstrings/trainer_what
- Delivery: [PR #2](https://github.com/chordsnstrings/trainer_what/pull/2), from `claude/repository-overview-osejlw` to `main`, with the defect fixes and live-deployment support. PR #1 is merged. Evidence for this phase: `docs/VERIFICATION_2026-09-27_LIVE_DEPLOYMENT.md`.
- Local checkout used here: `/workspace/scratch/50654f17bfe7/trainer_what`. A fresh GitHub checkout is sufficient; do not depend on this temporary directory or old chat attachments.
- Read [current verification](docs/VERIFICATION_2026-09-27.md) and the GitHub delivery state first; older per-area handoffs may name superseded checkpoints. Stage commits include their own handoff updates.
- GitHub commits were published through the connector because direct Git transport was unreliable. Their hashes differ from local commits, but each published tree was compared with the local committed tree. Prefer GitHub history in a fresh checkout.
- Read this file before `docs/BUILD_STATUS.md`, `docs/DELIVERY_ROADMAP.md` or the September 25 audit: those documents contain historical verification and many now-superseded gap lists. Current stage evidence is in `docs/COMPLETION_STAGES.md`.
- Node 24; npm workspaces; Next.js 16.3.6, Fastify API, PostgreSQL/PGlite, separate worker. Read `apps/web/AGENTS.md` and the installed Next documentation before web changes.

## Owner decisions to preserve

1. Complete application work one bounded, checked, committed stage at a time. Parallel agents are authorized; use tokens wisely. **Update this file and the stage register after every completed stage.**
2. On 27 September the owner asked Claude to deploy everything under a new DigitalOcean project. The GymMembership project, one SSH key and one Droplet were created (IDs in `docs/DIGITALOCEAN_DEPLOYMENT.md`); existing projects/resources remain untouched. Never use a cloud browser. Further DO work uses the direct API from the coordinating session only and creates only new owned resources.
3. Screenshots were explicitly waived on September 26. Functional checks still matter.
4. Stripe collects subscriber money; Lean initiates eligible trainer payouts from the company bank. Do not restore the superseded Stripe Connect payout design.
5. Exactly two subscriber tiers: workout only; workout + nutrition at a higher price. Premium voice is an optional product capability, not a third nutrition tier.
6. The coach teaches decisions through cases and boundaries. Qualified routine output should be automatic; the coach does not approve every meal/workout response. Current architecture uses private versioned examples/rules and bounded evaluated actions, not separately trained model weights per coach.
7. Nutrition includes individual coach-guided approximate targets, daily meal plans, recipes, portions, cooking choices and weekly groceries. Meal photos and barcodes are required; the subscriber confirms estimated entries.
8. Trainers can personalize the client app and actual website, upload their own photos and create unlimited galleries.
9. Credentials belong in deployment secrets or encrypted Superadmin settings. Do not copy old chat credentials into code, docs, logs or tests. No live payment, payout, provider, registrar or cloud actions were used for these completion stages.
10. The 27 September instruction supersedes the earlier broad-review deferral: finish the app, audit the jobs, run combined qualification and merge after passing checks. Real services and deployment remain the next phase.

## Completed and committed application work

These are engineering-stage results. Counts overlap across stages and must not be summed into a final suite result.

| Area | Implemented and connected | Observed stage checks |
| --- | --- | --- |
| Baseline already present | Superadmin encrypted provider/settings controls, trainer styling, meal photos/barcodes, foundational auth/RLS, finance ledger, nutrition and PWA | Historical September 25 baseline had 91 tests, build, browser and PostgreSQL/container CI; that evidence does not qualify this expanded branch |
| Workout safety | Subscriber-wide holds; explicit trainer resume/abandon; no restart bypass; consent/profile/takeover guards; ordinary chat safety reports open the same hold | 5 initial safety tests; included in final 14 coaching/runtime passes |
| Training and chat | Dated multiweek templates/assignments, progression, substitutions, demonstrations by HTTPS link, RIR/rest tools, immutable set corrections, progress/Twin lineage, polling/paginated messages | 7 training tests; final combined coaching/runtime run passed 14 |
| Qualified workout AI | Structured teaching cases, approved routine actions, independent held-out checks, model/prompt/policy/material pins, shadow approval and bounded automatic delivery; active-case capacity, independent history loading and assessment archiving | 14 earlier coaching/runtime checks; 7 hardening runtime tests plus final targeted assertion; synthetic providers only |
| Nutrition | Current-version catalog, archival, safe weekly/manual uncertainty recovery, individual calorie methods/targets/macros/habits, coach week editor, diary totals/trends/corrections/favorites/copying, photo scaling/food facts, groceries purchase conversions and dated leftovers | 33 related nutrition/capture tests; 9 final completion tests; TypeScript at stage boundary |
| Nutrition teaching | Adaptive coverage/contradictions, independent worked recipe/portion/nutrient/rationale checks, qualification version 2, stale-release invalidation, no replay of uncertain generation | Included in the nutrition results; old releases require requalification |
| Billing servicing | Cancellation/reactivation identities, service during paused sales, invoice/charge history, selected-charge refund requests, admin overrides, grace and reconciliation | 15 focused finance tests through final refund/job safeguards; late Checkout changes below are separate |
| Coach business/finance | Effective policy history, gross-to-net statements, promotions/trials, paid bookings, recurring slots/timezones/policies/calendar, reviewed monthly finance jobs, worker lease CAS | 19 combined booking/finance checks at integration stage; later 15 finance tests |
| Administration | Scoped operator views for accounts, safety/Brain, FinOps, support, jobs, integrations, audit, acquisition/experiments/configuration; published legal/templates, support macros and recovery | 7 admin tests; later acquisition, support and infrastructure evidence below |
| Team and ingestion | Team invite/role/revoke/session controls; CSV/XLSX/program JSON, image/scanned-PDF OCR, rights/privacy review, redaction/retry/discard and approved compilation inputs | 14 team/import tests plus 3 legacy import tests; TypeScript |
| Privacy | Scoped exports/erasure, provider/backup evidence tracking, ownership transfer and reviewed workspace closure; current actor/lifecycle and financial obligations guarded | 8 privacy tests in final 18 account/privacy run |
| Accounts | Magic links, authenticator recovery codes, real WebAuthn passkeys, active sessions/revocation, settings/login/recovery routes and custom-host recovery paths | 10 account tests plus 8 privacy tests; actual signed WebAuthn assertions used |
| Integrations | WHOOP OAuth/refresh/sync/revocation, explicit Apple import consent/revoke, approved-gateway-only Zepp, reviewed voice enrollment/guided audio/cost/fallback, domain quote/approval/DNS/TLS/expiry, signed host routing and worker integration | 45 integration/settings/configuration/host tests; TypeScript |

Area details and earlier root-hook notes: `docs/COACHING_COMPLETION_HANDOFF.md`, `NUTRITION_COMPLETION_HANDOFF.md`, `FINANCE_COMPLETION_HANDOFF.md`, `ADMIN_COMPLETION_HANDOFF.md`, `INGESTION_COMPLETION_HANDOFF.md`, `PRIVACY_COMPLETION_HANDOFF.md`, `INTEGRATIONS_COMPLETION_HANDOFF.md`. Many earlier hook instructions in those files have already been applied; inspect current code before duplicating routes.

## Final engineering qualification

[GitHub run 36295491678](https://github.com/chordsnstrings/trainer_what/actions/runs/36295491678) passed on code commit `dcfa92c4b353520f7444bb20055eda1fe1a0145c`:

- 367 application tests and 367 restricted-role PostgreSQL tests; zero failures or skips on either path.
- TypeScript, production web build and all 38 deployment boundary checks.
- 40 migration files through 041; permission verification for 35 system tables, 33 scoped tables and nine privileged helpers. Production container build and readiness passed.
- A 50-route Chromium journey, with zero page errors and no 390px overflow: analytics consent, onboarding/context persistence, offline workout/meal replay, groceries, gallery privacy/publication, private attachment send/download/delete, inbox state and preferences.

The final documentation commit does not change qualified code or workflows. Exact logs, browser artifact and audit corrections are in `docs/VERIFICATION_2026-09-27.md`. Historical stage counts overlap and must not be summed. Local Docker/Chromium limitations were resolved by running those gates in GitHub Actions; screenshots were waived.

## Job and runtime audit resolved

Migration 041 preserves worker lease identity across JavaScript/PostgreSQL timestamp precision. Payment callbacks and retention now enter validated tenant scope; retention joins only a bounded scoped projection to privileged provider evidence. Recovery-code consumption retains security-row serialization without broader code-table permissions. Tests run as the restricted runtime role in isolated migrated databases. Email/push/finance retries retain attempt/lease compare-and-set guards, and unknown external outcomes require reconciliation before another dispatch.

The audit also corrected overlapping infrastructure routes, health-probe request identity, invalid/future MFA timestamps, inherited Compose environment overrides and unstable form labels. Runtime grants and production rate budgets were not relaxed. The full combined checks above pass after these changes.

## Current completion and next real-service phase

1. PR #1 is qualified for the owner-authorized merge. Verify its GitHub merge state, then start the next phase from `main`; do not reconstruct already connected routes from older handoffs.
2. Qualify enabled providers/models/legal and operational paths with the correct account access. Configure encrypted settings and deployment secrets without copying old chat keys.
3. Exercise real Stripe collections, Lean payouts and bank finality; model/food/voice/wearable rights and quality; email and device push; camera/barcodes; registrar/DNS/TLS; reviewed legal/retention/residency policy; hosted backup restoration, accessibility, monitoring and load/canary behavior.
4. GymMembership is live at `https://gymmembership.64.227.151.196.sslip.io` on `main`. It redeploys every checked `main` commit. No live payment, payout, model, email or food-provider transaction occurred; provider flags stay disabled.

## Preserved scope boundaries

| Area | Implemented boundary | Next-phase or separate scope |
| --- | --- | --- |
| Support | Temporary audited previews, consent-gated schedule scope and exact single-use preference correction | Arbitrary impersonation, payment/consent/safety edits and unrestricted raw history remain unavailable by design |
| Infrastructure | Measured app/worker/DB/queue status and approved worker pause/resume/interval operations | Execution is disabled by default; real cloud capacity/billing feeds and cloud-operation adapters require account qualification |
| Client Twin and learning | Training/nutrition evidence, current-block summaries, private cases/reviewed outcomes and evaluated actions | Voluntary communication/exercise/travel context remains display-only; new physiological or travel action inputs require rights and qualification |
| Acquisition and affiliates | Consented attribution, copy experiments, deterministic lifecycle/retention notices, reviewed agreements/receipts/statements and bank-evidence ledger settlement | Actual provider agreements and bank evidence; no predictive churn or fabricated commercial claims |
| Devices and native integration | Browser push, governed wearables/imports and PWA offline behavior | Real Android/iOS/desktop device delivery and permissions; native HealthKit/BLE companion is separate platform work |

Bespoke per-coach model weights, per-trainer App Store apps, a social marketplace and gym ERP remain outside initial scope. Fixture acceptance does not establish real provider quality, device delivery, legal approval or production readiness. No live Lean finality adapter was fabricated.

Useful verification entry points are `npm run check`, `node scripts/run-browser-check.mjs` and the non-owner PostgreSQL/container workflow in `.github/workflows/check.yml`. Repeat only checks affected by subsequent changes or required for the next release; do not launch provisioning during application review.

## Ongoing completion log format

After each stage append: date; area; exact behavior completed; files/migrations; checks actually run with results; commit; remaining limitations; next action. Update the corresponding unfinished section above. Preserve historical evidence and distinguish source implementation, assembled application checks and real external qualification.

### 26 September — Checkout completion

Completed atomic admission, unresolved-intent reconciliation/closure protection, real API registration, member reconciliation controls and premium voice product controls. Eight Checkout tests and sixteen finance tests passed. Changes: finance-checkout.ts, app.ts, privacy-lifecycle.ts, workspace.tsx and Checkout tests; no new migration. Commit: the stage commit containing this log entry (use Git history). Next: onboarding test fixes and notification/site/attachment wiring. Live payment qualification remains open.

### 26 September — Notification completion

Completed saved preference/inbox UI, API registration, safety/nutrition/chat/free and paid booking event hooks, reminder processing and conservative email recovery. Eight final notification tests and two paid-booking regressions passed; connected related suites also passed as recorded above. No new migration beyond existing023. Commit: the stage commit containing this entry. Next: connect attachments and trainer website, finish onboarding/acquisition and run aggregate gates.

### 26 September — Onboarding completion

Completed digest-bound preview approval, current coaching/model/nutrition/voice/legal readiness and practical workflow details. Six dedicated and two existing onboarding checks passed; final model-disconnection assertion passed. No new migration. Commit: the stage commit containing this entry. Next: website/attachment/acquisition integration and aggregate validation.

### 26 September — Private chat attachment completion

Completed private image/PDF uploads, sealed conversation binding, composer/download/removal controls, personal/workspace privacy and hourly orphan cleanup. Original migration028 is unchanged; forward030 upgrades existing data safely. Seven attachment and eight privacy tests passed after this migration. Commit: the stage commit containing this entry. Next: website registration/brand transaction, consented acquisition and combined release checks. Local Chromium installation failed on invalid CDN archives; browser verification remains an explicit CI gate.

### 26 September — Trainer website and gallery completion

Connected actual website routes/SSR, versioned drafts, private preview, trainer/client gallery navigation, coach-specific manifest and guarded brand saves. Hidden pages stay out of public data; inquiry actions preserve unsaved website edits. Twelve coach-site and five branding tests, whole-tree TypeScript and scoped diff checks passed. Commit: the stage commit containing this entry. Next: former-owner media erasure, acquisition hooks and aggregate browser/build checks.

### 26 September — Coaching capacity and history hardening

Enforced bounded creation of 30 active actions, 100 teaching cases and 100 active independent assessment cases. Cases and the active release load independently of recent evaluation history, so newer history cannot hide them. Owners can archive obsolete assessment cases with revision/reason checks; archived questions stay excluded from teaching. Oversized legacy corpora fail before model dispatch instead of silently truncating. Seven runtime tests passed, then the strengthened capacity/archived-question assertion passed again; TypeScript and scoped diff checks passed. No migration. Commit: the stage commit containing this entry. Next: acquisition/media privacy and aggregate gates.

### 26 September — Migration upgrade and runtime permission verification

Added a dedicated original001–029 →030 regression with preexisting messages/media, confirming preserved bytes/timestamps, one-time binding, expiry, null-role rejection and isolated privacy cleanup. All five behavioral subtests passed (six reported checks with the parent). Fresh all 30 runtime verification passed with grants applied twice across 54 tables and nine privileged helpers. Strict test TypeScript, script syntax and diff checks passed. Commit: the stage commit containing this entry. Real PostgreSQL/container/browser gates remain pending; no deployment.

### 26 September — Consented acquisition completion

Connected opt-in/readback/withdrawal, opaque host-scoped cookie handling, safe attribution, guarded copy experiments, signup/new enrollment/publication/first-positive-payment conversions, privacy and hourly retention. Thirty-four focused tests across four suites and TypeScript passed, including actual shared app/payment/privacy hooks and best-effort analytics failures. Existing029 is unchanged. Commit: the stage commit containing this entry. Next: media erasure checkpoint, settings mount correction, source-scope follow-ups and combined release/browser gates.

### 26 September — Former-owner media privacy completion

Approved personal erasure removes the former owner's photos/galleries, clears exact references from applied/private designs, updates affected gallery ordering/revisions and prevents stale editors restoring deleted media. Other people's media and the ongoing workspace remain intact; current-owner erasure still requires transfer/closure. Four new media and eight existing privacy tests, whole-tree TypeScript and scoped diff checks passed. No migration or new grant. Commit: the stage commit containing this entry. Next: settings mount correction, source-scope slices and release/browser checks.

### 26 September — Notification settings connection correction

Source review found that the notification preference component was imported but the legacy Settings form still rendered. Settings now mounts the persisted reminder/timezone/quiet-hours controls. The compatibility `/settings` endpoint also applies explicit email/workout/marketing choices to the real preference row while preserving newer quiet-hour/booking fields and advancing its revision. Nine notification checks passed, including opt-out delivery suppression and stale-revision rejection; the component mount passed TypeScript. No migration. Commit: the stage commit containing this entry. The browser persistence journey is in Claude's deferred review queue.

### 26 September — Browser continuation harness prepared; execution deferred

Saved current semantic selectors and separate completion journeys for consent, upload/gallery/publication visibility, chat PDF download/removal, notification read status and preferences, while preserving offline workout/nutrition checks. A narrowly guarded local synthetic fixture prepares launch state before starting test servers; website publication itself remains a UI action. Four script syntax checks and diff checks passed. **No browser journey was executed.** Commit: the stage commit containing this entry. Per the owner, execution and comprehensive review are deferred in the queue above; current effort stays on app implementation.

### 26 September — Scheduled coach follow-ups completed

Conversation screens now support private coach-authored drafts, explicit reviewed scheduling in the device timezone, upcoming/history, revision-safe reschedule/cancel and review-required recovery. The worker rechecks active workspace, sender/recipient roles, paid relationship, consent, profile/program context, safety holds and takeover, then atomically creates one human message and one notification. Changed or unsafe context returns to review; retry cannot duplicate delivery. Privacy covers sender/client pending and delivered content. Migration032 adds scoped policies, due indexes and unique delivery/intent constraints. Seven real-app follow-up tests and eight existing privacy tests passed; no external calls. Whole-tree TypeScript at this boundary was blocked by the separately unfinished infrastructure UI. Commit: the stage commit containing this entry. Browser timezone behavior and real PostgreSQL concurrency are deferred review items.

### 26 September — Current Twin facts and complete compilation input

Current intake and active safety holds are fetched separately from bounded histories, so older current facts cannot be evicted by busy workout history. Set corrections retain their latest applicable revision; bounded histories expose actual overflow and retain tenant/rights filtering. Compilation sends all selected reviewed text within explicit 20-source, 60,000-character-per-source and 120,000-total bounds; invalid selections fail before paid dispatch. The UI explicitly selects sources instead of silently taking the first 20, and displays supplied-input counts/notice. Exact source hashes/versions/character coverage persist in draft rules and audit and return from the real endpoint; this does not claim every instruction becomes a rule.

Five new checks (including assembled compilation) and three selected existing Twin/model-accounting checks passed. TypeScript and scoped diff checks passed. No migration. Commit: the stage commit containing this entry. Richer outcome-based retrieval and model extraction quality remain deferred source/quality review items; no model-weight training is claimed.

### 26 September — Temporary support preview completed

Support operators can start a case-bound, session-bound preview with fresh MFA and an explicit reason, for at most 15 minutes. It retains the real operator identity and only projects account identity, access state and connection status; no health/payment secrets or target cookies are exposed. Every read rechecks current roles/session/case/target/workspace; visible expiry/banner/Stop controls and operator-attributed audit accompany the preview. Target mutations are denied. The actual app registration and support workbench links are connected. Migration031 and narrow runtime grants are included.

Seven focused support checks, strict component/module TypeScript and diff checks passed. The connected whole-tree TypeScript run also passed after explicitly typing the source-coverage test fixture. Commit: the stage commit containing this entry. Browser/real PostgreSQL and privacy-retention/access-history review are deferred. Reproducing sensitive screens or elevating target mutations is additional implementation, not claimed by this safe preview.

### 26 September — Observe-only infrastructure operations completed

Connected the admin status screen and API/worker samplers for actual process/request/cycle/database/queue measurements. Timestamped evidence and threshold versions are immutable; recommendation acknowledgement and verified recovery use revisions, source freshness and durable request deduplication. All execution requests are denied/audited. No cloud resource or provider account is queried or changed. The API sampler stops/drains before database shutdown; fixtures disable automatic sampling.

Migration033 and narrow runtime grants are included. Nine focused observer tests and connected whole-tree TypeScript passed. Fresh all 33 migrations plus grants twice passed the 58-table/nine-helper permission gate. Commit: the stage commit containing this entry. Limits: latest reporter per service, last 2,048 latency samples, at most 100 active-workspace queue scan with explicit partial coverage; cloud billing/capacity/storage telemetry remains unavailable. Browser, production PostgreSQL sampling, retention/fleet/load and execution-broker design remain deferred reviews/additional scope for Claude.

### 26 September — Training adherence and latest-block summary completed

Client Twin now presents the prior 28 calendar days including today and next 28 days using each session timezone. Completion requires matching client/program/session/workout evidence; missed past sessions, today's schedule, upcoming, canceled, held, in-progress, abandoned and unverifiable records stay separate. The latest assigned block includes actual sessions across verified revisions, including older completions outside the rolling window, with source lineage and expandable trainer/subscriber views. No adherence percentage or health/readiness inference is invented.

Two new checks (including rendered trainer and subscriber variants), two existing coverage regressions and one snapshot/isolation/revocation regression passed; whole-tree TypeScript and scoped diff checks passed. No migration. Commit: the stage commit containing this entry. Limits: 1,000 rolling sessions, 182 block sessions, 64 linked revisions and 2, 400 linked workouts, with explicit incomplete coverage. Multiple assigned programs are possible, so the screen says “Latest assigned block”; selecting the intended active block is a product review item. Browser/timezone and broader release checks remain deferred. Next: correction feedback and lifecycle messages.

### 26 September — Correction-to-teaching and regression workflow completed

The attention list now supports separately reviewed replacement decisions while preserving the original proposal. Delivery reuses current consent/context/safety and qualified-action checks, with stable request identity and conflict detection. Each correction retains preferred/rejected decisions, deterministic meaningful-versus-cosmetic classification, rationale, client-context lineage and a private teaching draft. Only the current owner can explicitly confirm a saved draft as teaching material; held-out cases remain excluded. Linked independent regression evidence exposes readiness without revealing assessment prompts or automatically activating a release. Client-owned outcome links, export, erasure of copied release examples and coaching-consent revocation are connected.

Eight new assembled-app checks and seven existing runtime tests passed; whole-tree TypeScript and scoped diff checks passed. Files: coaching-feedback API/UI/tests, extracted coaching-completion/runtime helpers and root app/privacy/workspace hooks. No migration, paid provider call or automatic release. Commit: the stage commit containing this entry. Browser, real PostgreSQL concurrency, broad privacy/security and learning-quality review remain in Claude's deferred queue. Next: lifecycle messages.

### 26 September — Lifecycle messages and trainer reminder policy completed

The worker now schedules evidence-based onboarding 15-minute/24-hour reminders, incomplete-interview reminders, actionable payout setup/48-hour reminders, publish readiness tied to the current preview digest, paid-member milestones 1/5/10/25, and non-safety review-queue threshold 8. Subscriber notices cover paid-but-incomplete intake, actually scheduled programs, recorded workout completion, fully verified block completion, unresolved wearable attention, current signed payment failure/cancellation, refund state changes and confirmed bank-backed payout outcomes. Workout completion and cancellation confirmations stay in the inbox. Messages reuse existing preferences, private content, pinned source/template identity, deduplication and delivery-time current-state checks.

Owner Settings now includes an explicit missed-workout policy, disabled until enabled, with a 1–7 local-calendar-day threshold and revision-safe save/reload. Inbox-only missed reminders require current paid access/coaching consent, the exact policy version, verified complete current-block evidence, no training hold, client workout preference and quiet hours; active/canceled/abandoned/unverifiable targets do not generate reminders. Existing notification/job privacy covers all messages; the only added record kind is tenant configuration. No migration or provider call.

Eight lifecycle tests and nine existing notification regressions passed. Final whole-tree TypeScript and scoped diff checks passed; the policy component also passed basic rendered loading/control checks. Files: lifecycle-messages.ts, notifications.ts, lifecycle-policy.tsx, lifecycle tests and app/workspace/worker hooks. Commit: the stage commit containing this entry. Limits: polling, at most 100 candidates per source/pass, 7-day event/state backfill, 30-day missed-plan window and 48-hour queued-source expiry. No inferred churn, invented hours/revenue/SLA, historical-upload rule/conflict-count email, new mobile push transport or real email/provider qualification is claimed. Existing booking/due-workout/safety triggers remain independent. Next: Claude's ordered review/setup/scope queue above; no assigned implementation slice remains active.

### 26 September — Upload and compilation review notifications completed

Actual document extraction queues one generic trainer inbox/email prompt to review the private import. Actual compilation records a batch identity with proposed rule/conflict references and queues the exact draft-rule and potential-conflict counts. Existing trainer screens are linked directly; no uploaded text, filenames, client facts or rule text enters the email. Source versions, current trainer role/workspace, preferences and 48-hour expiry are rechecked before delivery; review, redaction, approval, source withdrawal or removal suppresses stale notices. Compilation also rechecks current authority and exact selected material after the provider returns, so changed or revoked sources cannot persist new proposals or send a completion message.

Four new assembled-app checks plus two selected existing compilation/ingestion regressions passed; scoped diff checks passed. Files: source-review-notifications.ts, app/ingestion/notification hooks and its tests. No migration or real provider call. Commit: the stage commit containing this entry. Final connected TypeScript subsequently passed in the retention stage; comprehensive review remains deferred. Next: searchable coaching history and configurable retention alerts.

### 26 September — Searchable coaching correction and outcome history completed

The attention list now searches correction requests, rejected/preferred responses, explanations and linked outcome notes. Change/category/client filters, newest-first pagination, deletion-safe cursors, reset/retry/empty states and stale-request cancellation are connected to the existing correction/teaching detail workflow. Current trainer membership and active workspace are rechecked. Held-out prompts and client context snapshots are excluded from search; search does not give render-only records learning permission or send personal history to a model. Existing record erasure removes the searchable data without a duplicate store.

Seven new registered-route checks and eight existing correction-workflow checks passed; scoped diff checks passed. Migration034 adds full-text and history/link indexes over existing records, without new privileges or copied personal data. Commit: the stage commit containing this entry. Final connected TypeScript subsequently passed in the retention stage. Important performance limit: a PGlite diagnostic used the GIN index under the system role but scanned under tenant RLS; no RLS bypass was added. Search has a 200-character query limit, 1–50 results/page and 3-second SQL timeout. Production query-plan/load optimization and browser review remain deferred. Matching is whole-word across correction fields or within one outcome note. Next: finish configurable retention alerts.

### 26 September — Configurable retention alerts completed

The owner's Business screen now includes a saved retention policy, recorded cancellation summary and source-linked cohort details. Policies default disabled and set a 7–30-day UTC window plus an absolute 1–100-member threshold. Verified positive invoices must link to the same subscription. Confirmed cancellation instructions or signed subscription receipts distinguish scheduled cancellation, ended membership, resumed/recovered membership and unresolved states; repeated provider updates cannot manufacture new cancellation events. The comparison uses equal elapsed periods only when the workspace existed for the earlier window. No historical churn denominator, predicted churn, health inference or revenue estimate is claimed.

The worker sends one generic trainer alert per policy/window with at least 24 hours between alerts across policy edits. Delivery rechecks current owner/workspace, policy version, exact evidence, preferences and expiry. Incomplete/unresolved or capped evidence cannot alert. Owner-only routes and the mounted panel are connected; retention configuration is excluded from shared bootstrap records. Existing record/notification/job privacy applies. No migration, external provider call or subscriber campaign.

Eight focused checks passed, including the assembled app/bootstrap guard and real notification-delivery source hook. Final connected whole-tree TypeScript and scoped diff checks passed after correcting payload types in the two new test helpers; product tests had already passed. Commit: the stage commit containing this entry. Limits: fixed UTC windows anchored to epoch, 500 source events, 100 current cohort members, 48-hour source expiry or earlier window end, and current-membership evidence only. Browser, real PostgreSQL concurrency, query performance and actual email delivery remain deferred. No assigned slice remains in progress; Claude's review/setup and broader-scope queue above remains authoritative.

### 26 September — Opt-in browser push completed

Added device controls in Settings, encrypted endpoint/session storage with RLS (migration035), current-session/tenant validation, opt-in job creation, category/quiet-hour/source suppression, role-aware inbox redirects and payloadless generic service-worker notifications. A restricted FCM/Mozilla/Apple adapter uses web-push 3.6.7 VAPID generation with the existing public-DNS-pinned, no-redirect transport. Encrypted Superadmin VAPID settings verify a matching key pair without sending. Endpoint tokens and message content stay out of jobs and notification payloads. Privacy exports show device metadata only; erasure, workspace closure, logout and revoked sessions remove subscriptions. Worker lease CAS marks dispatch unknown before network I/O, records only service acceptance, prunes 404/410 and uses bounded 429 backoff; uncertain sends are not automatically repeated.

Checks: seven new API/worker/VAPID tests, nine existing notification tests, fifteen platform-settings tests and eight privacy lifecycle tests passed; connected whole-tree TypeScript, service-worker syntax and scoped diff checks passed. No real push/provider/deployment call. Devices must explicitly reconnect after login/session expiry or key rotation; other browser push providers are unsupported. Actual device/provider delivery, production PostgreSQL and browser qualification remain in the review queue. Commit: the stage containing this entry. Next: commit coaching retrieval/support stages and finish voluntary client context.

### 26 September — Relevant coaching examples and reviewed outcomes completed

Replaced last-six example selection with deterministic relevance ranking over confirmed, same-tenant, permitted teaching cases. Request and factual context select up to six complete cases from at most100 candidates within24,000 serialized characters. The retrieval policy/material digest and selected case versions/scores are pinned and recorded in evaluation/runtime decisions. Prompt v2 and retrieval pins require fresh independent qualification; no automatic release is granted. This is bounded lexical retrieval, not embeddings or per-coach model-weight training.

The correction workflow now supports explicit owner review of a deidentified outcome summary with source ownership/version and current consent checks. Raw outcome notes/references stay render-only and out of prompts. Revising a draft retains previously confirmed teaching until new confirmation; stale sources/predecessors require renewed review, and held-out copies remain excluded. No migration or shared route hook. Five new retrieval tests plus17 feedback/runtime tests passed; the two final changed outcome/recovery checks re-passed. Connected whole-tree TypeScript and diff checks passed. No live model/provider call. Files: provider retrieval/selector, coaching domain/runtime/feedback, feedback UI and three focused test files. Commit: the stage containing this entry. Next: finish support integration and voluntary client context; broader quality/device/release review remains with Claude.

### 26 September — Scoped support screens and corrections completed

Extended the case/session-bound support preview with explicit notification settings, training schedule and nutrition schedule scopes. Health views use current coaching/nutrition permission and show bounded schedule information; raw conversations, health history, payment secrets and target sessions are not projected. Defaults stay read-only. Operators can prepare one exact preference correction (booking/workout reminders, quiet hours or timezone), review it, then apply or discard it within five minutes. The action, reason, expected preference version, operator session and parent grant are sealed. Customer changes revoke stale approval; repeat execution returns the original receipt. Fresh MFA, current operator/case/member/workspace authority and real-operator audit apply at dispatch; expiry/stop/replacement ends authority.

Migration037 adds system-only elevations and expands explicit preview scopes; runtime grants and the permission verifier are updated. Thirteen focused checks passed (seven existing plus six expansion checks). Connected whole-tree TypeScript and diff checks passed. Fresh PGlite applied all36 migrations through037 and twice-applied runtime grants; the gate passed for32 system/28 scoped tables and nine helpers. This is embedded-database evidence; real PostgreSQL/browser/audit-retention review remains deferred. No provider call. Commit: the stage containing this entry. Next: voluntary client context, affiliate workflow and guarded infrastructure approval controls.

### 27 September — Voluntary client context completed

Connected client-owned communication preferences, exercise likes/dislikes and dated travel/schedule changes to the actual Client Twin screen. Trainer access requires current coaching consent; writes require current subscriber ownership and a matching revision. Notes remain display-only and are not model/action inputs. Self-reported provenance and timezone-aware status are visible; cleared fields persist. Migration038 adds isolated storage and the per-client uniqueness constraint. Personal export/erasure covers the new record without retaining private notes in audit events. Four focused API/privacy/date/isolation tests passed; whole-tree TypeScript passed before the final UI resilience refinement, with combined checks still due. Stage commit contains this entry. Next: affiliate administration, guarded infrastructure operations, then combined qualification and merge. No real service called.

### 27 September — Affiliate administration and finance guards completed

Added approved provider agreements with explicit disclosure and trainer shares, aggregate receipts pinned to contract revisions, immutable reversals and monthly statements, and exact signed bank-evidence reconciliation. Confirmed receipts post balanced entries to the existing trainer-payable/bank/commission ledger; no provider money is assumed collected before evidence. Outstanding clawbacks block payout dispatch, and outstanding affiliate obligations block workspace closure. Owner statements and Superadmin editing are connected. Migration039 has tenant/finance RLS and immutable financial history. Six new affiliate/MFA checks plus sixteen finance regressions passed (22 total). The audit fixed invalid/future MFA timestamps in the shared guard. No consumer tracking, external payout, provider call or new service occurred. Next: finish guarded infrastructure operations and combined release qualification.

### 27 September — Guarded infrastructure operations completed

Added disabled-by-default execution policy and an immutable proposal/approval history for the primary application worker. The initial allowlist permits pausing/resuming new cycles and setting their interval; it cannot purchase cloud resources, change DNS/databases/security or execute arbitrary commands. Operator role and fresh MFA, exact resource/policy revisions, expiry, zero added cloud cost, hourly action limits and current approver authority are checked in the same transaction as execution. Retrying an executed operation cannot repeat it; rollback requires the resource still to match the original result and remains available when execution is disabled. The real worker reads the control at cycle boundaries; existing cycles finish normally. Admin UI and navigation are connected. Migration040 and runtime grants are included. Four action tests plus nine observer tests passed (13 total); combined TypeScript is being rerun after fixture typing corrections. Next: full suite/build/browser/PostgreSQL/container gates, bounded audit, then merge. No cloud or provider action occurred.

### 27 September — Integrated application audit and regression fixes

The first full run found a route collision between the new broker and legacy observe-only rejection routes, plus a preexisting health-probe rate-budget regression. Broker APIs now use /infrastructure/operations while the historical denial endpoints remain intact. Authenticated probes use verified session identities for their budget, without requiring a host proof or extending session activity; invalid cookies remain IP-limited. Forty affected assembly checks and nine host/rate-limit checks passed after fixes. Whole-tree TypeScript and the production web build pass. Browser coverage now checks client-context persistence and trainer read-only access and visits the new operator pages. See docs/VERIFICATION_2026-09-27.md for exact counts, initial failures and remaining GitHub gates.

### 27 September — Controller environment isolation

First PR CI exposed inherited application variables overriding the reviewed private Compose runtime file. The controller now inherits only ordinary process settings, pins the release, and excludes application, Docker-host and Compose overrides. Added mock and real-Compose assertions. All 38 local deployment checks ran: 37 passed and the Docker-only check skipped. No controller was deployed. PR #1 reruns all release gates before merge.

### 27 September — PostgreSQL runtime and job fixes

The non-owner PostgreSQL suite exposed tenant-table reads in payment projections, an unnecessary UPDATE lock on recovery codes, and microsecond lease tokens that JavaScript truncated. Payment callbacks now read through their validated tenant identity, recovery remains serialized by the existing security-row lock, and forward migration 041 stores leases at millisecond precision for exact compare-and-set retries. No runtime grants were broadened. Test setup now uses tenant transactions for scoped tables; immutability probes recognize permission denial, and PostgreSQL-specific observer checks require real connection metrics. CI clones its disposable migrated database per test file to prevent global policy/queue fixtures contaminating other files, while every test still runs with the restricted runtime role. TypeScript and script syntax pass; final suites are running.

### 27 September — Retention scope and final fixture corrections

PostgreSQL now passes payment callbacks, MFA recovery and worker lease/retry checks. The expanded database run exposed retention loading tenant policies/events before entering the tenant role. Retention now reads a bounded owner-authorized projection under RLS, joins only that projection to privileged provider evidence, and returns to the tenant role for output and notifications. Runtime grants remain narrow. Remaining test-only setup/assertion reads now use the proper tenant role; global settings tests use isolated databases without migration credentials; observer tests enable actual PostgreSQL metrics. Browser journeys explicitly decline optional analytics in each new browser context so the consent panel does not cover controls. Consolidated current handoff status and preserved historical stage evidence.

### 27 September — Browser preference persistence and final retention fixture

Browser execution verified offline workout replay and preference saving, then found the saved textarea content affecting its implicit label after reload. Client-context textareas now have stable accessible names. The guarded synthetic browser seed records explicit coaching consent for Sam so trainer read-only context checks satisfy the real consent gate. PostgreSQL reached363/367 passing checks; the four remaining failures shared a test-only retention event insert using the service role. Split provider receipts and scoped audit inserts, including bounded overflow fixtures; all eight retention tests pass locally. TypeScript passes. The next CI run must qualify the complete browser and PostgreSQL/container paths.

### 27 September — PostgreSQL/container qualification and stable shared form labels

Run36294655491 passed all367 PostgreSQL tests as the non-owner runtime, all 40 migrations,35 system/33 scoped table classifications and nine privileged helpers, plus the production container build and readiness probe. Application tests/typecheck/build also passed. Browser flows reached and passed client-context persistence/trainer read-only access, offline workout and meal replay, grocery persistence and private gallery upload; gallery visibility exposed implicit labels containing select-option text. Galleries, workspace, coaching, training and nutrition now share a label component binding controls to their visible label text, preserving existing explicit accessible names. TypeScript passes; final browser requalification remains before merge.

### 27 September — Browser request pacing

Run36295139032 again passed the full application and PostgreSQL suites, build, permission checks and container readiness. Browser execution passed gallery editing, then correctly hit the production120-request/minute budget while traversing dozens of screens. The harness now spaces real API requests per browser context below that budget; server limits and responses are unchanged. Browser-script syntax passes.

### 27 September — Final combined qualification and merge handoff

Both jobs in [run 36295491678](https://github.com/chordsnstrings/trainer_what/actions/runs/36295491678) passed on `dcfa92c4b353520f7444bb20055eda1fe1a0145c`: 367 application tests, 367 non-owner PostgreSQL tests, TypeScript/build, all 38 deployment checks, migration/runtime permissions, container readiness and the 50-route browser journey. Exact evidence and audit fixes are consolidated in `docs/VERIFICATION_2026-09-27.md`. This stage changes documentation only. Next action is the authorized PR #1 merge, followed by the separate real-services phase; no application code or engineering gate remains open.

### 27 September — Live GymMembership deployment and audited defect fixes

- **Deployment.** Created only new DigitalOcean resources (project, SSH key, Droplet) with the repository's create-only provisioner, driven locally because the session has no GitHub Actions secret access. The controller deployed `main` `2708f21` with TLS. The host controller gained a one-time private Superadmin request because the automation environment cannot SSH. Live checks passed: public pages and headers, Superadmin bootstrap with rotation and MFA, settings, the registration gates, trainer and subscriber journeys, and 32 browser views at two widths.
- **Rechecked audit.** Of 109 earlier findings, 26 were already fixed on `main`, 28 partly and 55 still present.
- **Fixes.** Twelve area branches fixed them: edge rate limiting, authentication, settings, key rotation, database integrity, deploy host and CI, ledger, payouts, coaching safety, nutrition safety, nutrition delivery and the web client. Conflicts were resolved by hand: authenticator sealing now uses the shared key-rotation module, with re-seal on use. The worker dispatcher keeps the scrub of bearer links from email jobs. `operator:role` keeps both the audited role change and the emergency `reset-mfa`.
- **Review round.** An adversarial review confirmed 15 findings, which a second round fixed. They include a blocker: after the edge change, probes resolved the signed host, so the controller's `127.0.0.1:3000` readiness check would have returned 421 and rolled back every deploy.
- **Files and migrations.** New migrations 043 (platform role audit), 046 and 046b (domain mapping isolation, migration checksums, payout integrity), 049 (payout separation) and 053 (marketing consent history). New test files are `tests/fix-*.test.ts` and `tests/fix2-*.test.ts`. The CI Compose-topology job and `scripts/compose-smoke.sh` are new, as is `npm run secrets:reseal`.
- **Checks on the final head.** The local full suite ran 484 tests: 483 passed, 0 failed, and 1 PostgreSQL-only test was skipped. TypeScript, the production build and 56 deployment tests passed. The full restricted-role PostgreSQL suite passed 477 tests with 0 failures and 2 embedded-only skips. A local upgrade rehearsal from a `main`-migrated database with data to the merged head passed in production mode. GitHub CI passed all three jobs on the reviewed fixes.
- **Not done.** The right-to-left layout was blocked by the session's permission policy. Architectural isolation redesign, Lean status reads and commission-rank policy sign-off are open.
- **Merged and deployed.** The owner authorized the merge; `main` `eb7b678` deployed automatically at 14:38 UTC. Live public, fix, journey and browser checks passed on it (see the verification record).
- **Next action.** The owner rotates the DigitalOcean token and takes over the Superadmin through account recovery or the host `reset-mfa` command. Then real-provider qualification, reviewed legal documents and the open items above.
