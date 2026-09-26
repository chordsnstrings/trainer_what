# Claude continuation handoff

Updated 26 September 2026, Asia/Dubai. The owner is switching to Claude because of token budget and requested this file. **The complete application is not finished.** Completed stages and unfinished implementation are preserved together on a work branch; the final combined tree is not release-verified.

## Start here

- Repository: https://github.com/chordsnstrings/trainer_what
- Branch: `work/completion-2026-09-26`. Continue this branch; `main` does not contain this completion work.
- Local checkout used here: `/workspace/scratch/50654f17bfe7/trainer_what`. A fresh GitHub checkout of the work branch is sufficient; do not depend on this temporary directory or old chat attachments.
- Latest completed coaching stage: local `249df91`, GitHub `e9e083c77b42d8c605b65e714833e77e29187851`. Subsequent commits preserve unfinished work and this handoff; inspect the branch tip.
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

## Completed and committed application work

These are engineering-stage results. Counts overlap across stages and must not be summed into a final suite result.

| Area | Implemented and connected | Observed stage checks |
| --- | --- | --- |
| Baseline already present | Superadmin encrypted provider/settings controls, trainer styling, meal photos/barcodes, foundational auth/RLS, finance ledger, nutrition and PWA | Historical September 25 baseline had 91 tests, build, browser and PostgreSQL/container CI; that evidence does not qualify this expanded branch |
| Workout safety | Subscriber-wide holds; explicit trainer resume/abandon; no restart bypass; consent/profile/takeover guards; ordinary chat safety reports open the same hold | 5 initial safety tests; included in final 14 coaching/runtime passes |
| Training and chat | Dated multiweek templates/assignments, progression, substitutions, demonstrations by HTTPS link, RIR/rest tools, immutable set corrections, progress/Twin lineage, polling/paginated messages | 7 training tests; final combined coaching/runtime run passed 14 |
| Qualified workout AI | Structured teaching cases, approved routine actions, independent held-out checks, model/prompt/policy/material pins, shadow approval and bounded automatic delivery; Brain UI routes connected | 14 coaching/runtime tests after direct-chat and rollback integration; synthetic providers only |
| Nutrition | Current-version catalog, archival, safe weekly/manual uncertainty recovery, individual calorie methods/targets/macros/habits, coach week editor, diary totals/trends/corrections/favorites/copying, photo scaling/food facts, groceries purchase conversions and dated leftovers | 33 related nutrition/capture tests; 9 final completion tests; TypeScript at stage boundary |
| Nutrition teaching | Adaptive coverage/contradictions, independent worked recipe/portion/nutrient/rationale checks, qualification version 2, stale-release invalidation, no replay of uncertain generation | Included in the nutrition results; old releases require requalification |
| Billing servicing | Cancellation/reactivation identities, service during paused sales, invoice/charge history, selected-charge refund requests, admin overrides, grace and reconciliation | 15 focused finance tests through final refund/job safeguards; late Checkout changes below are separate |
| Coach business/finance | Effective policy history, gross-to-net statements, promotions/trials, paid bookings, recurring slots/timezones/policies/calendar, reviewed monthly finance jobs, worker lease CAS | 19 combined booking/finance checks at integration stage; later 15 finance tests |
| Administration | Scoped operator views for accounts, safety/Brain, FinOps, support, jobs, integrations, audit, acquisition/experiments/configuration; published legal/templates, support macros and recovery | 7 admin tests; later acquisition/email edits below are unfinished |
| Team and ingestion | Team invite/role/revoke/session controls; CSV/XLSX/program JSON, image/scanned-PDF OCR, rights/privacy review, redaction/retry/discard and approved compilation inputs | 14 team/import tests plus 3 legacy import tests; TypeScript |
| Privacy | Scoped exports/erasure, provider/backup evidence tracking, ownership transfer and reviewed workspace closure; current actor/lifecycle and financial obligations guarded | 8 privacy tests in final 18 account/privacy run |
| Accounts | Magic links, authenticator recovery codes, real WebAuthn passkeys, active sessions/revocation, settings/login/recovery routes and custom-host recovery paths | 10 account tests plus 8 privacy tests; actual signed WebAuthn assertions used |
| Integrations | WHOOP OAuth/refresh/sync/revocation, explicit Apple import consent/revoke, approved-gateway-only Zepp, reviewed voice enrollment/guided audio/cost/fallback, domain quote/approval/DNS/TLS/expiry, signed host routing and worker integration | 45 integration/settings/configuration/host tests; TypeScript |

Area details and earlier root-hook notes: `docs/COACHING_COMPLETION_HANDOFF.md`, `NUTRITION_COMPLETION_HANDOFF.md`, `FINANCE_COMPLETION_HANDOFF.md`, `ADMIN_COMPLETION_HANDOFF.md`, `INGESTION_COMPLETION_HANDOFF.md`, `PRIVACY_COMPLETION_HANDOFF.md`, `INTEGRATIONS_COMPLETION_HANDOFF.md`. Many earlier hook instructions in those files have already been applied; inspect current code before duplicating routes.

## Frozen unfinished work and exact next actions

### 1. Immediate known failures

- Last combined `npm run typecheck` **failed**: `tests/finance-checkout.test.ts` lines 399–400 use possibly undefined `old` (TS18048). No other TypeScript diagnostics appeared in that run. This is an unfinished test; fix the assertion/narrowing and rerun.
- Onboarding API now requires `values.digest` for preview completion. `apps/web/components/onboarding.tsx` and the existing `tests/platform.test.ts` preview fixture still submit `{}`. This is a known broken transition; send the observed GET `previewDigest` and test stale digests.
- Public coach SSR now calls `/api/v1/public/sites/:slug`, but `registerCoachSite(app, db)` is not yet called in `app.ts`. Until wired, the new website path cannot work.
- `registerSubscriptionCheckout` is not wired. The old `/payments/checkout` handler remains active despite the new module and Stripe event hooks. Complete the replacement before relying on the new payment safeguards.
- **All five new Checkout tests fail** with `permission denied for table tenants`: `finance-checkout.ts` reads `tenants.lifecycle_state` inside a `trainer_app` transaction. Fix admission atomically before registering it; see section 4.
- Final full tests, production build, functional browser smoke, and PostgreSQL/container CI have **not** run on the combined work.

### 2. Photos, galleries, design and actual trainer website

Files: migration `018_brand_site.sql`, API `coach-site.ts`, web `coach-site.tsx`, `coach-site.css`, `trainer-design.tsx`, catch-all `page.tsx`, layout CSS import, contracts `branding.ts`, `tests/coach-site.test.ts`.

Implemented: decoded/re-encoded JPEG uploads with crop/rights/limits and metadata removal; media library; unlimited paginated galleries with site/app/private audiences, ordering, captions and alt text; versioned private design/website drafts and publication; multipage public site, contact inquiries, memberships, social links; branded manifest and actual PNG icons; server-rendered public metadata. **11 focused API/media tests passed**, including non-owner runtime, 29 galleries, privacy/isolation/CAS and real image processing. UI/SSR integration is unfinished and untested.

Next:

1. Import/call `registerCoachSite(app, db)`.
2. Harden existing `/tenant/brand`: acquire workspace then brand advisory locks; use `trainer_brand_tenant()` to recheck active current owner; call `assertBrandMedia(tx, actor, design)` before saving. Do not query unrestricted tenant rows through `trainer_app`.
3. Mount `WebsiteStudio`, `GalleryStudio`, client galleries and `CoachWebsite` owner preview in `workspace.tsx`; add navigation for `/trainer/website`, `/trainer/galleries`, `/app/galleries`, `/trainer/website/preview/...`.
4. Set the coach-specific manifest for the actual logged-in client app; public SSR metadata already supplies it.
5. Review runtime grants now present in `infra/runtime-role.sql`, preview/launch ordering and onboarding digest changes; then verify upload → gallery → site publish → public/client visibility in a local browser.

### 3. Notifications and email delivery

Files: migration `023_notifications.sql`, API `notifications.ts`, worker `email-delivery.ts` and edited `index.ts`, UI `notifications.tsx`, `tests/notifications.test.ts`; email reconciliation edits in `admin-operations.ts` and its tests.

Implemented: persisted preferences/inbox, quiet hours/timezones, published templates, critical alert preservation, dedupe, booking/workout reminders, current preference/source-state checks, email dispatch marked unknown before outbound send, manual-evidence recovery and worker attempt/lease CAS. Five notification tests passed **before** the last helper/admin changes. Worker scheduler/email replacement is written. New `coaching` category and `notifyCoachingTeam` helper are unverified. Privacy hooks already cover preferences/inboxes; account/privacy tests checked their isolation/erasure.

Next:

1. Register `registerNotifications(app, db, identity)`.
2. Replace the old Settings notification form with `NotificationPreferences`; add `NotificationInbox` and trainer/client navigation.
3. Connect `notifyUser` to booking hooks and `notifyCoachingTeam` to `openTrainingHold`; add appropriate nutrition-review/message notifications. Keep sensitive details inside the app. Existing safety holds currently record events/exceptions without these delivery hooks.
4. Verify worker nutrition CAS does not overwrite module-managed unknown/blocked states. Check stale email leases, failure after dispatch, manual delivered/not-sent outcomes and no duplicate sends.
5. Run notification/admin checks and a real assembled-app local workflow. Live email provider qualification remains separate.

### 4. Subscription Checkout and premium voice

Files: new `finance-checkout.ts`, `tests/finance-checkout.test.ts`, modified `stripe-events.ts`, product contract and finance tests.

A real defect was found in the old handler: elapsed local Checkout expiry could permit another attempt before Stripe's outcome was known; completed Checkout with a delayed subscription webhook, or past_due/unpaid/incomplete subscriptions, could also permit a parallel subscription. The new module is intended to preserve unresolved intents and reconcile provider evidence before another purchase. **Sixteen existing finance tests passed, including the new premium voice projection fixture; all five new Checkout tests failed** with the same `tenants` permission error. The module is not functional yet and must not be advertised as finished.

First fix reservation admission in one system transaction: acquire workspace → tenant → checkout locks, verify active workspace and current subscriber membership, then set the local tenant role/context for the remaining scoped work. `privacy-lifecycle.ts` has this transaction pattern. Do not add broad tenant-table grants or put the lifecycle precheck in a separate transaction.

After the five tests pass, replace the old `/api/v1/payments/checkout` route with `registerSubscriptionCheckout(app, db, requireNutritionReady)`; remove the now-unused `checkoutOfferTerms` import. Wire the reconciliation UI at `/payments/checkout/reconcile`. Do not register duplicate paths. Validate signed checkout events, terminal subscriptions, delayed webhooks, elapsed unknown/open sessions, changed promotions and current membership. Product contract/projection now carries `premiumVoice` default false; add owner product checkbox and `premiumVoice: f.get("premiumVoice") === "on"` to the form body, keeping unknown/legacy prices false and preserving the two-tier structure. First-paid acquisition hook is still absent. The Stripe dispatcher already imports the unfinished Checkout lifecycle handlers.

### 5. Onboarding readiness

Only `apps/api/src/onboarding.ts` was changed in this unfinished pass. Written: effective legal versions, richer teaching/design/site/gallery/voice/nutrition preview digests, current base Brain evaluation checks, independent nutrition evaluation/preview gates, combined-tier requirements and actual verified voice readiness.

No onboarding checks ran after this edit. Fix preview payload compatibility first. Render returned readiness links/details in `apps/web/components/onboarding.tsx`, remove outdated supervised/voice wording, and integrate exported `coachingRuntimeReadiness(tx)` from `coaching-runtime.ts` instead of duplicating its contract hash. Add tests for changed teaching/policies/media/legal versions invalidating previews and no website-publish/launch circular dependency.

### 6. Private chat attachments

Only three new files exist: `chat-attachments.ts`, migration `028_chat_attachments.sql`, `scripts/sanitize-chat-pdf.py`. They implement draft private upload/download/delete, JPEG normalization, bounded PDF conversion, binding/storage/rights limits, privacy helpers and expiry. **No attachment tests or UI exist.** Previous spawn-environment typing was fixed; aggregate typecheck currently reports only the Checkout test errors.

Next: register `registerChatAttachments(app, db)`; accept up to five IDs in `/messages`, require text or attachments, call `validateChatAttachments(tx, actor, subjectId, ids)` and `bindChatAttachments(tx, actor, subjectId, messageId, ids)` in the same transaction. Messages already store `authorUserId`. Build upload/display/removal UI. Wire export/erasure helpers into `privacy-hooks.ts` and `expireChatAttachments(db, tenantId)` into maintenance. Validate every PDF page's dimensions (current check covers first page), active-content removal, malformed media, tenant/client/author binding, cross-user drafts, expiry and erasure.

Deferred coaching hardening: enforce creation caps of 30 actions/100 teaching cases/100 held-out cases before query-budget overflow; load held-out cases separately from latest evaluation history so repeated evaluations do not hide cases. Hosted exercise video upload is not implemented; demonstrations currently use HTTPS links.

### 7. Consented acquisition and experiments

Migration `029_acquisition_consent.sql` and edits in `admin-operations.ts` are draft and **untested**. Schema includes revocable opaque-cookie consent records, safe first/last attribution and exposure fields; event writer and funnel counts were extended. The insecure public experiment endpoint that trusted unsigned JSON consent was removed, so `GET /api/v1/public/experiments/:key` currently returns 404.

No `acquisition.ts`, consent UI/API/cookies, conversion helpers or replacement exposure endpoint exists. Build explicit opt-in/readback/withdrawal before analytics cookies, mount controls in layout, record signup/enrollment and successful storefront publication, record first positive paid invoice only after verified financial evidence, dedupe, and add permission-gated copy experiments. Integrate privacy export/erasure; never use health data for acquisition targeting. Affiliate payout contracts have not been invented.

### 8. Runtime configuration and release checks

Frozen infra changes cover `.env.example`, `.github/workflows/check.yml`, `apps/web/package.json`, `compose.yaml`, `infra/digitalocean/host.py`, `infra/runtime-role.sql`, browser/CI/readiness scripts and new `scripts/verify-runtime-access.mjs`.

Written: shared raw UTF-8 `INTERNAL_PROXY_SECRET` (at least 32 bytes) for API/web, exact `PUBLIC_APP_URL`, web `API_INTERNAL_URL`, root env loading for Next dev/start, browser-test signing key, narrow account/media/acquisition grants, idempotent runtime role setup, PostgreSQL permission gate, screenshot CI gate removal with functional smoke retained.

Observed: all **29 migrations** plus runtime grants twice passed in fresh PGlite; runtime verification covered 27 system tables, 27 scoped tables and 5 privileged helpers. **36 Python deployment boundary tests passed; 1 Docker-only check skipped** because Docker is unavailable. Changed infra JS/TS/YAML was formatted. Actual PostgreSQL 17.6, Docker/container CI, web build and browser smoke remain unrun. No environment was deployed.

## Completion order for Claude

1. Fix the explicit type/preview breaks, review unfinished Checkout module and run relevant focused tests.
2. Connect website/media, notification and Checkout routes/UI/worker hooks; keep separate stage commits and update this file after each.
3. Finish onboarding, attachments and consented acquisition from the frozen files; add meaningful missing tests.
4. Reconcile runtime grants/config and privacy hooks against all migrations; run the full suite and build, then local browser journeys and PostgreSQL/non-owner/container CI on the exact committed tree.
5. Review source requirements against the resulting app for remaining gaps: advanced Twin domains/retrieval, scheduled follow-ups, campaigns/affiliate rules, support impersonation, infrastructure Governor and native HealthKit/BLE may still have unmet scope. These have not been completed or silently removed by this handoff. Bespoke per-coach weights, per-trainer App Store apps, social marketplace and gym ERP were outside initial scope.
6. Update current evidence documents and only then prepare review/merge. Do not merge or deploy this unfinished checkpoint automatically.

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

Run targeted checks while finishing each stage; run the broad gates once the shared tree is stable. The work branch has not had new GitHub Actions qualification. Review CI conditions before triggering it; do not launch the separate provisioning workflow.

## External qualification remains open

Application controls and provider fixtures do not establish real coach/model fidelity, clinical scope, camera/barcode device behavior, legal/retention approval, Stripe/Lean account capabilities or bank finality, production WHOOP/Zepp rights, real voice identity/quality/cost, domain registrar/DNS/TLS operation, sender delivery, restoration, accessibility/load or production deployment. Complete the enabled engineering paths and leave unavailable external capabilities explicitly gated. No live Lean finality adapter was fabricated; audited bank/provider evidence remains necessary.

## Ongoing completion log format

After each stage append: date; area; exact behavior completed; files/migrations; checks actually run with results; commit; remaining limitations; next action. Update the corresponding unfinished section above. Preserve historical evidence and distinguish source implementation, assembled application checks and real external qualification.
