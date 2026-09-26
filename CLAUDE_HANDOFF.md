# Claude continuation handoff

Updated 26 September 2026. The owner requested this durable continuation file and an update after every completed stage. **The assigned continuation stages are implemented and committed; the application is not yet release-qualified.** Known broader-scope implementation gaps, provider setup and unrun reviews remain explicitly listed below.

Current checkpoint: Checkout, notifications, onboarding readiness, private chat attachments, trainer website/galleries, consented acquisition, coaching capacity/history, former-owner media privacy, scheduled follow-ups, Twin/compiler coverage, temporary support preview, infrastructure observations, training adherence/block summaries, correction-to-teaching and lifecycle messages are connected. No assigned slice remains in progress. Final whole-tree TypeScript passed; combined tests/build/browser/production qualification remain for Claude.

## Start here

- Repository: https://github.com/chordsnstrings/trainer_what
- Branch: `work/completion-2026-09-26`. Continue this branch; `main` does not contain this completion work.
- Local checkout used here: `/workspace/scratch/50654f17bfe7/trainer_what`. A fresh GitHub checkout of the work branch is sufficient; do not depend on this temporary directory or old chat attachments.
- Read the current work-branch tip and stage logs below for the latest completed work; older per-area handoffs may name superseded checkpoints. Stage commits include their own handoff updates.
- GitHub commits were published through the connector because direct Git transport was unreliable. Their hashes differ from local commits, but each published tree was compared with the local committed tree. Prefer GitHub history in a fresh checkout.
- Read this file before `docs/BUILD_STATUS.md`, `docs/DELIVERY_ROADMAP.md` or the September 25 audit: those documents contain historical verification and many now-superseded gap lists. Current stage evidence is in `docs/COMPLETION_STAGES.md`.
- Node 24; npm workspaces; Next.js 16.3.6, Fastify API, PostgreSQL/PGlite, separate worker. Read `apps/web/AGENTS.md` and the installed Next documentation before web changes.

## Owner decisions to preserve

1. Complete application work one bounded, checked, committed stage at a time. Parallel agents are authorized; use tokens wisely. **Update this file and the stage register after every completed stage.**
2. Deployment is stopped and assigned separately to Claude. No DigitalOcean resources were created by this work. Never use a cloud browser. Any later authorized DO work must use direct API access and only wholly new resources in the `GymMembership` project; existing projects/resources must remain untouched.
3. Screenshots were explicitly waived on September 26. Functional checks still matter.
4. Stripe collects subscriber money; Lean initiates eligible trainer payouts from the company bank. Do not restore the superseded Stripe Connect payout design.
5. Exactly two subscriber tiers: workout only; workout + nutrition at a higher price. Premium voice is an optional product capability, not a third nutrition tier.
6. The coach teaches decisions through cases and boundaries. Qualified routine output should be automatic; the coach does not approve every meal/workout response. Current architecture uses private versioned examples/rules and bounded evaluated actions, not separately trained model weights per coach.
7. Nutrition includes individual coach-guided approximate targets, daily meal plans, recipes, portions, cooking choices and weekly groceries. Meal photos and barcodes are required; the subscriber confirms estimated entries.
8. Trainers can personalize the client app and actual website, upload their own photos and create unlimited galleries.
9. Credentials belong in deployment secrets or encrypted Superadmin settings. Do not copy old chat credentials into code, docs, logs or tests. No live payment, payout, provider, registrar or cloud actions were used for these completion stages.
10. On 26 September the owner directed: **focus on completing the app; comprehensive review comes later.** Keep outstanding reviews in this file. Continue essential checks for each change, but defer broad audits, browser/release qualification and further review sweeps to the queue below.

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

## Connected stages and remaining release gates

### 1. Combined-tree verification

- Checkout/onboarding typing and the temporary acquisition syntax error are fixed; whole-tree TypeScript subsequently passed. Repeat aggregate checks after the final shared hooks.
- Public website/media routes, previews, client galleries and brand saves are now registered and connected; final browser journeys remain unverified.
- Final full tests, production build, functional browser smoke, and PostgreSQL/container CI have **not** run on the combined work.

### 2. Photos, galleries, design and actual trainer website — completed

Decoded/re-encoded uploads remove metadata and validate crop/rights/limits. Trainers can manage unlimited paginated galleries with public-site, client-app and private audiences, ordering, captions and alt text. Versioned website/design drafts publish separately from workspace launch; the actual multipage public site supports membership links, inquiries and social links. Hidden pages are excluded from public responses. The owner preview, website/gallery navigation, client galleries, coach-specific manifest and PNG icons are connected.

Brand saves serialize workspace and brand changes, recheck the current active owner through the scoped helper, validate same-workspace media and apply revision checks atomically. UI fixes preserve unsaved website edits when handling inquiries, reload current galleries/drafts and paginate private previews beyond 24 entries.

Checks: **12 coach-site and 5 branding tests passed**, including the assembled app registration/brand save, stale revision and media-deletion race. Whole-tree TypeScript and scoped diff checks passed. No additional migration beyond018. Actual browser upload → gallery → site publish → client/public visibility remains pending. Approved former-owner personal erasure now removes owned media/galleries and exact image references from applied/private designs under workspace→brand locks, with revision bumps to invalidate stale editors. Other users' media and the ongoing workspace remain intact. Four new media privacy and eight existing privacy lifecycle tests, TypeScript and diff checks passed; no migration or broader grant was needed.

### 3. Notifications and email delivery — completed

Notification routes are registered through operationsRoutes. Saved preferences/quiet hours reload in Settings; trainer/client navigation opens the scoped inbox. Safety holds/resolutions, nutrition exceptions, ordinary chat, booking confirmations/changes/cancellations, signed paid-booking confirmation/refund and scheduled booking/workout reminders enqueue deduplicated notifications. Email contains generic review prompts, with sensitive report/message details kept in the app. Critical safety/account alerts bypass reminder opt-outs and quiet hours.

The worker rechecks preferences and source state before delivery, marks the outbound outcome unknown before sending, and never automatically sends that unknown result again. Attempt/lease CAS prevents stale workers from sending or overwriting newer results. Admin evidence-based reconciliation updates both the job and inbox delivery status. Privacy export/erasure already includes notifications/preferences. The additional lifecycle triggers and trainer reminder policy are recorded in the final stage entry below.

Checks: final **8 notification tests passed**, including assembled app safety/inbox/booking routes and stale lease/no-repeat delivery; **2 signed paid-booking regressions passed**, including replay deduplication. Earlier connected runs passed 22 notification/admin/coaching checks and 30 notification/nutrition/booking checks. These overlap and are not a summed suite count. Whole-tree TypeScript subsequently passed; final build/browser/provider delivery qualification remains pending.

### 4. Subscription Checkout and premium voice — completed

The resumed stage fixed the tenant-table permission failure with one system transaction: workspace → tenant → checkout locks, current active subscriber admission, then the scoped tenant role. No broad grants were added. Unresolved provider outcomes survive elapsed local expiry; signed lifecycle or authenticated provider reads reconcile the original intent before a new purchase. Closure/erasure blocks unresolved Checkout while allowing an exactly matched terminal subscription.

`registerSubscriptionCheckout(app, db, requireNutritionReady)` now replaces the old inline route. The member UI can reconcile the original attempt, reopen its stored provider URL and repurchase only after canceled/incomplete-expired membership. Product creation persists the premium voice checkbox; signed offer mapping keeps unknown/legacy prices false. The strict plan-change body no longer includes an unsupported promotion field.

Checks: **8 Checkout tests and 16 finance tests passed**, including actual assembled-app route/product persistence and current actor/closure regressions. Scoped diff checks passed. The concurrent typing fixes are complete and whole-tree TypeScript subsequently passed. No live transactions occurred. First-paid acquisition is completed in the acquisition stage below; actual Stripe/Lean account qualification remains open.

### 5. Onboarding readiness — completed

The API and UI now agree on preview confirmation: the client submits the exact observed digest and stale approvals fail. Readiness uses current base/qualified coaching material and model connection, effective legal publications/approval, independently checked nutrition evaluation/sample week, and actual verified voice with current consent or explicit optional deferral. Preview material includes teaching/actions/model, nutrition methods/policy, private/published website/design, galleries/photos and voice evidence. A published combined-tier product retains nutrition gates even when setup is disabled.

The UI renders concrete readiness links, legal/teaching details and private-versus-published website state. Launch precedes separate website publication without a circular prerequisite. Checks: **6 dedicated onboarding tests and 2 existing platform/nutrition onboarding regressions passed**; an additional final assertion confirms model disconnection invalidates readiness. Diff checks passed. No migration was added. Aggregate compilation/build/browser validation remains a final gate after concurrent modules settle.

Files: apps/api/src/onboarding.ts, apps/web/components/onboarding.tsx, tests/onboarding-completion.test.ts and the preview fixture in tests/platform.test.ts.

### 6. Private chat attachments — completed

Image/PDF uploads, the message composer and shared-file controls are connected. Uploads require rights confirmation, are private until sent, and bind once to the authenticated sender and correct client conversation. Images are decoded/re-encoded without metadata. PDFs are rebuilt from bounded rasterized pages into a new PDF without original actions, links or embedded files. Attachment-only messages work; digital coaching explicitly does not read these files.

Personal export/erasure, reviewed workspace closure and hourly orphan expiry include attachment data and message references. Current membership, active workspace, expiry and independent tenant/subject/author checks are enforced. Migration028 is preserved exactly; forward migration030 applies the binding policy, sealed expiry and narrow privacy-helper fixes to existing installations without deleting data.

Checks: **7 attachment and 8 privacy tests passed together after the forward migration**, including assembled application upload/message routes, real image/PDF sanitization, erasure/expiry and cross-tenant access. A separate original001–029 →030 upgrade test passed its five behavioral subtests (six reported checks including the parent), preserving existing bytes/timestamps/messages and checking expiry, binding, null-role rejection and cross-tenant cleanup. TypeScript passed at the stage boundary. Final browser interaction and aggregate release gates remain pending.

### 7. Consented acquisition and experiments — completed

Explicit optional consent/readback/withdrawal is mounted once in layout. An opaque HttpOnly host-only cookie is created only after opt-in; stored hashes, exact origin/verified-host binding and current identity checks prevent reassignment. Safe first/last source fields omit referrer/IP/health traits. Withdrawal removes linked anonymous and identified event history; export/erasure and bounded hourly expiry cleanup are connected.

Actual registration, new enrollment/invitation acceptance, successful storefront publication and first positive verified subscription payment record deduplicated conversions after core transactions commit. Delayed historical receipts cannot attribute a payment made before consent. Analytics failure does not undo signup, publication or payment success. Public landing/onboarding wording experiments require current consent, a permitted surface and an observed assignment/revision; only one runs per surface. Admin exposure/conversion reports are connected. Referral codes are attribution only; no affiliate payout contract is claimed.

Migration029 remains unchanged. **34 tests passed** across acquisition, onboarding completion, privacy lifecycle and administration, including actual registration/enrollment, publication, Stripe dispatch and erasure hooks. Whole-tree TypeScript passed. Browser consent interaction remains pending.

### 8. Runtime configuration and release checks

Frozen infra changes cover `.env.example`, `.github/workflows/check.yml`, `apps/web/package.json`, `compose.yaml`, `infra/digitalocean/host.py`, `infra/runtime-role.sql`, browser/CI/readiness scripts and new `scripts/verify-runtime-access.mjs`.

Written: shared raw UTF-8 `INTERNAL_PROXY_SECRET` (at least 32 bytes) for API/web, exact `PUBLIC_APP_URL`, web `API_INTERNAL_URL`, root env loading for Next dev/start, browser-test signing key, narrow account/media/acquisition grants, idempotent runtime role setup, PostgreSQL permission gate, screenshot CI gate removal with functional smoke retained.

Observed: all **33 migrations** plus runtime grants twice passed in fresh PGlite; runtime verification covered 31 system tables, 27 scoped tables and 9 privileged helpers. The gate also rejects unclassified privileged helpers, PUBLIC execution and runtime-owned helpers. The historical028→030 upgrade is tested separately with existing data. **36 Python deployment boundary tests passed; 1 Docker-only check skipped** because Docker is unavailable. Changed infra JS/TS/YAML was formatted. Actual PostgreSQL 17.6, Docker/container CI, web build and browser smoke remain unrun. Local Playwright installation exhausted its built-in retries because the CDN returned invalid/truncated Chromium archives; no local browser executable is available. Use the existing CI browser gate without claiming local verification. No environment was deployed.

## Next actions for Claude

1. Continue the published `work/completion-2026-09-26` branch and use the latest stage entries below. Do not reconstruct already connected routes from older area handoffs.
2. Run the final combined TypeScript/tests/build and database permission/upgrade gates, then execute the saved browser journeys. These comprehensive checks were explicitly deferred by the owner; do not treat earlier stage evidence as release qualification.
3. Resolve the concrete scope/implementation boundaries in the table below against the original source contract. Keep missing implementation separate from a failed review or unavailable provider. Bespoke per-coach weights, per-trainer App Store apps, a social marketplace and gym ERP were outside initial scope.
4. Qualify the enabled real providers/models/legal and operational paths with the correct account access. Configure encrypted settings and deployment secrets without copying old chat keys.
5. Update this handoff and the stage register after every fix. Prepare review/merge only after the final tree passes its gates. Deployment remains separately assigned and stopped; do not automatically launch the provisioning workflow from this handoff.

Useful commands from repository root:

```sh
npm ci
npm run typecheck
node --import tsx --test --test-concurrency=1 tests/coaching-completion.test.ts tests/coaching-runtime.test.ts
node --import tsx --test --test-concurrency=1 tests/nutrition.test.ts tests/nutrition-completion.test.ts tests/meal-capture.test.ts
node --import tsx --test --test-concurrency=1 tests/finance-completion.test.ts tests/finance-checkout.test.ts
node --import tsx --test --test-concurrency=1 tests/coach-site.test.ts tests/notifications.test.ts tests/account-completion.test.ts tests/privacy-lifecycle.test.ts
npm test
npm run build
npm run test:browser
```

The next operator should run the broad gates on the final committed tree. Stage evidence below records the focused checks already performed. The work branch has not had new GitHub Actions qualification. Review CI conditions before triggering it; do not launch the separate provisioning workflow.

## Deferred review queue for Claude — owner requested

Implementation remains the current priority. These reviews/checks are **not passed** and must not be described as completed:

- Run the combined test suite, production build, fresh/upgrade migrations, real non-owner PostgreSQL permission gate and Docker readiness on the final committed tree. Current stage tests are partial evidence, not the final release result.
- Run the updated `scripts/run-browser-check.mjs` / `browser-completion-check.mjs` harness (syntax checked only): photo upload/gallery/site publication and client/public visibility; chat file send/download/delete; preference persistence/inbox; analytics opt-in/withdrawal; trainer/client/admin journeys and offline replay. The site browser fixture seeds an already launched synthetic workspace; actual launch prerequisites are separately covered by onboarding tests. Local Chromium was unavailable because downloads returned invalid archives.
- Independently review support access permissions, temporary grants, sensitive-field projection, erasure/retention and audit attribution; scheduled coaching context/consent/safety checks and duplicate-worker behavior; compiler source coverage/current Twin facts and teaching/evaluation separation.
- Review the complete source contract against the finished implementation, including richer Twin/retrieval, edit→teach regression, campaign/affiliate policy and observe-only infrastructure boundaries. Missing code must remain an implementation item; source review itself is deferred.
- Complete accessibility/device testing, load/latency, backup restoration and rollback, operational monitoring and the real provider/model/legal qualification below. Deployment stays separately owned by Claude and stopped in this task.

## Known boundaries that still require scope or implementation decisions

Do not relabel these as passed review. The implemented controls are usable, but the broader capabilities below are not claimed:

| Area | Implemented boundary | Remaining decision/work |
| --- | --- | --- |
| Support access | Temporary audited account/access/connection preview | Reproducing sensitive customer screens or acting as the customer needs additional scoped access/elevation implementation |
| Infrastructure | Measured app/worker/DB/queue status and tracked recommendations | Fleet/cloud billing/capacity telemetry and an execution broker are not built into this observer; deployment remains stopped |
| Client Twin / learning | Training/nutrition evidence, bounded histories, current-block summaries and evaluated coaching material | Broader Twin domains and indexed outcome-based retrieval need source-contract reconciliation and additional implementation if retained |
| Campaigns / affiliates | Consented attribution, safe copy experiments and deterministic lifecycle messages | Real affiliate contract/earnings settlement, churn-spike policy and historical-upload rule/conflict-count notices need additional implementation from approved rules/evidence; new mobile push transport is not supplied |
| Native integration | Governed wearable connections and imports | Native HealthKit/BLE companion requires separate platform work if approved; it is not supplied by the PWA |

## External qualification remains open

Application controls and provider fixtures do not establish real coach/model fidelity, clinical scope, camera/barcode device behavior, legal/retention approval, Stripe/Lean account capabilities or bank finality, production WHOOP/Zepp rights, real voice identity/quality/cost, domain registrar/DNS/TLS operation, sender delivery, restoration, accessibility/load or production deployment. Complete the enabled engineering paths and leave unavailable external capabilities explicitly gated. No live Lean finality adapter was fabricated; audited bank/provider evidence remains necessary.

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

Two new checks (including rendered trainer and subscriber variants), two existing coverage regressions and one snapshot/isolation/revocation regression passed; whole-tree TypeScript and scoped diff checks passed. No migration. Commit: the stage commit containing this entry. Limits: 1,000 rolling sessions, 182 block sessions, 64 linked revisions and 2,400 linked workouts, with explicit incomplete coverage. Multiple assigned programs are possible, so the screen says “Latest assigned block”; selecting the intended active block is a product review item. Browser/timezone and broader release checks remain deferred. Next: correction feedback and lifecycle messages.

### 26 September — Correction-to-teaching and regression workflow completed

The attention list now supports separately reviewed replacement decisions while preserving the original proposal. Delivery reuses current consent/context/safety and qualified-action checks, with stable request identity and conflict detection. Each correction retains preferred/rejected decisions, deterministic meaningful-versus-cosmetic classification, rationale, client-context lineage and a private teaching draft. Only the current owner can explicitly confirm a saved draft as teaching material; held-out cases remain excluded. Linked independent regression evidence exposes readiness without revealing assessment prompts or automatically activating a release. Client-owned outcome links, export, erasure of copied release examples and coaching-consent revocation are connected.

Eight new assembled-app checks and seven existing runtime tests passed; whole-tree TypeScript and scoped diff checks passed. Files: coaching-feedback API/UI/tests, extracted coaching-completion/runtime helpers and root app/privacy/workspace hooks. No migration, paid provider call or automatic release. Commit: the stage commit containing this entry. Browser, real PostgreSQL concurrency, broad privacy/security and learning-quality review remain in Claude's deferred queue. Next: lifecycle messages.

### 26 September — Lifecycle messages and trainer reminder policy completed

The worker now schedules evidence-based onboarding 15-minute/24-hour reminders, incomplete-interview reminders, actionable payout setup/48-hour reminders, publish readiness tied to the current preview digest, paid-member milestones 1/5/10/25, and non-safety review-queue threshold 8. Subscriber notices cover paid-but-incomplete intake, actually scheduled programs, recorded workout completion, fully verified block completion, unresolved wearable attention, current signed payment failure/cancellation, refund state changes and confirmed bank-backed payout outcomes. Workout completion and cancellation confirmations stay in the inbox. Messages reuse existing preferences, private content, pinned source/template identity, deduplication and delivery-time current-state checks.

Owner Settings now includes an explicit missed-workout policy, disabled until enabled, with a 1–7 local-calendar-day threshold and revision-safe save/reload. Inbox-only missed reminders require current paid access/coaching consent, the exact policy version, verified complete current-block evidence, no training hold, client workout preference and quiet hours; active/canceled/abandoned/unverifiable targets do not generate reminders. Existing notification/job privacy covers all messages; the only added record kind is tenant configuration. No migration or provider call.

Eight lifecycle tests and nine existing notification regressions passed. Final whole-tree TypeScript and scoped diff checks passed; the policy component also passed basic rendered loading/control checks. Files: lifecycle-messages.ts, notifications.ts, lifecycle-policy.tsx, lifecycle tests and app/workspace/worker hooks. Commit: the stage commit containing this entry. Limits: polling, at most 100 candidates per source/pass, 7-day event/state backfill, 30-day missed-plan window and 48-hour queued-source expiry. No inferred churn, invented hours/revenue/SLA, historical-upload rule/conflict-count email, new mobile push transport or real email/provider qualification is claimed. Existing booking/due-workout/safety triggers remain independent. Next: Claude's ordered review/setup/scope queue above; no assigned implementation slice remains active.
