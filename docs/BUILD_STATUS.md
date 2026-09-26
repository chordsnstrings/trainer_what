# Build status

> **26 September continuation notice:** this document records the historical September 25 release. The current completion branch is `work/completion-2026-09-26`. Read [CLAUDE_HANDOFF.md](../CLAUDE_HANDOFF.md) and [COMPLETION_STAGES.md](COMPLETION_STAGES.md) for implemented stages, frozen unfinished work and known failures. The combined expanded branch has not passed final release checks. Screenshots have been waived by the owner; deployment remains stopped.

Code verification: 25 September 2026. Active release: Superadmin settings, trainer design and meal capture. This file reports code and observed checks, separately from provider readiness and production release.

**Full-app audit:** [Created, partial and missing work](APP_AUDIT_2026-09-25.md). The verified development build is not the complete product. Workout AI still requires review for every output; specialist admin screens and finance automation remain incomplete. The audit also identifies concrete invitation, notification, safety-hold, billing-servicing, legal-version and nutrition-recovery/version-selection gaps that are not covered by the passing release checks. No application code was changed by the audit.

## Evidence

| Check | Observed result |
| --- | --- |
| TypeScript | Passed |
| Automated tests | 91 passed, 0 failed locally and in each [GitHub CI job](https://github.com/chordsnstrings/trainer_what/actions/runs/36126911122) on e5a1df5, including PGlite and PostgreSQL 17.6/non-owner runtime checks. Coverage includes settings, branding, bootstrap, meal capture, runtime requests and rate isolation. |
| Next.js production build | Final corrected slice passed locally and in GitHub; shared contracts are explicitly transpiled and web TypeScript settings match their imports. |
| Database migrations | All twelve migrations passed embedded and network PostgreSQL checks, including `011_platform_settings` and `012_meal_capture`; PostgreSQL 17.6/non-owner runtime and production container readiness passed in run 36126911122. |
| Browser smoke / screenshots | [Final CI](https://github.com/chordsnstrings/trainer_what/actions/runs/36126911122) passed core browser journeys and 252 screenshots across 94 routes, desktop/mobile, with zero layout/browser errors. The local gallery and ZIP were saved for the owner. |
| GitHub Actions | Both jobs passed on e5a1df5; [verification record](VERIFICATION_2026-09-25_SETTINGS_DESIGN_CAPTURE.md). Artifact 10860192604 retains browser evidence. |
| Docker / production PostgreSQL | Passed in [final CI](https://github.com/chordsnstrings/trainer_what/actions/runs/36126911122): PostgreSQL 17.6, non-owner runtime, production image and ready response. |
| Deployment automation | Code 224b893 passed all 37 deployment checks in GitHub, including real Compose configuration; both application CI jobs also passed, with 51 tests per database, production builds/readiness and browser smoke. [Exact evidence](VERIFICATION_2026-09-25_DEPLOYMENT.md). |
| Staging / DigitalOcean | Stopped by the owner; Claude will handle deployment. Provisioning workflow is manual-only. No real resources, HTTPS or automatic-update proof exist. Historical evidence remains in VERIFICATION_2026-09-25_DEPLOYMENT.md. |
| Current screenshots | 252 local screenshots across 94 routes, desktop 1440 px and mobile 390 px, with zero remaining overflow/navigation/browser errors. Settings/design/meal/retry interactions and the same 252-capture GitHub run passed. Saved gallery and ZIP use synthetic fixtures. |
| Stripe / Lean / model / email / food calls | No live provider call performed |

The suite covers commission boundaries, RLS and directory boundaries, authentication/origin checks, single-use invitations, consent, workout replay and safety holds, balanced and sealed journals, payout reservation/uncertain outcomes/returns/revisions, Stripe event replay and signatures, refunds, disputes, stale subscription events, MFA replay and invitation bypass, password recovery, booking capacity, support isolation, unavailable-provider behavior, consent/takeover enforcement, bounded PDF/DOCX extraction, entity rejection, local privacy erasure, staff scopes, funding rechecks and usage-charge posting, durable model-cost accounting, concurrent AI request caps, 16-step onboarding concurrency/preview invalidation, Client Twin source/freshness/rights and versioned isolation. Nutrition adds deterministic ingredient/portion calculations, independent case qualification, immutable facts, two-tier entitlement projection, automatic delivery and swaps, diary replay/corrections, job deduplication, profile/consent races, tenant isolation, exception routing and retained model-cost evidence.

## Implemented behavior

| Area | Delivered | Remaining boundary |
| --- | --- | --- |
| Foundation (005–009) | npm monorepo, API/web/worker, twelve migrations, RLS, sessions, invites, MFA, tokens, responsive shell, events/jobs, CI/container definitions | Staging, actual-device/accessibility/performance/restore evidence; verified custom-host resolution |
| Acquisition/onboarding (010–011) | Dedicated acquisition/how-it-works/scripted-demo/pricing/FAQ pages, signup/login/recovery, persisted trainer Design Studio, themed client/storefront, public coach enrollment, 16-step registry with identity autosave/CAS resume, server-derived readiness, preview invalidation and publish gates | Attribution, brand media uploads, advanced onboarding capabilities tied to their provider issues and actual separate-device acceptance |
| Brain (012–014) | PDF/DOCX/text sources and interview, rights metadata, bounded compilation adapter, draft review/conflicts/corrections, 20-case evaluation, digest-pinned supervised release/rollback | OCR/audio/image ingestion, parser isolation/security scanning, sophisticated retrieval/conflict evaluation, real provider traces and broader safety corpus |
| Coaching (015–017) | Versioned intake/consent and Client Twin snapshots, dated facts, robust personal baselines with coverage/lineage and import deduplication, assigned programs, set logs, verified offline reload/replay, messaging, takeover, structured decisions awaiting review, approved-program assignment | Broader Twin domains, program-schedule adherence/advanced deterministic adaptations, exercise-media library, real-device PWA and accessibility coverage |
| Commerce (018–022) | Stable Checkout intent, products/prices, cancel/reactivate, signature/inbox validation, subscription projection, refund/dispute ledger, settlement evidence entry, monthly close, reviewed destination, payout reservations/holds/revisions | Provider sandbox/canary, approved commission/fee/tax policy, automatic Stripe/bank reconciliation, provider validation of refund-uncertainty recovery, Lean transport/finality verification and callbacks |
| Privacy (023) | Consent versions/revocation, export, reviewed subscriber local erasure, retained finance/audit references, restricted model evidence | Reviewed legal content, automatic provider/backups erasure and trainer/workspace closure, retention/incident processes |
| Integrations (026–029,033) | Numeric Apple export parser/import, rights tags, duplicate-batch guard | WHOOP/Zepp approved adapters, fine-grained overlapping-import deduplication, custom domains, voice, native HealthKit/BLE companion |
| Operations (030–032) | Booking capacity/cancellation/attendance, support, email outbox/worker, finance overview/manual evidence, first-admin bootstrap, encrypted Superadmin settings and audit, MFA/revision-protected configuration and runtime API/worker reload | Lifecycle campaign scheduling, affiliate/experiments, remaining role-specific operations/support/impersonation views, infra Governor and measured operational readiness |
| Bespoke model (034) | Provider-independent supervised baseline | No bespoke model work is justified or claimed without measured baseline results |

A provider placeholder or unavailable badge is not an implemented integration. The 75 source screen groups are the target contract; the current route shell does not mean every group is complete.

## Nutrition implementation — verified core

Nutrition core implementation now covers the two tiers, case-based coach teaching, conditional onboarding, recipe/ingredient versions and cooking variants, independent policy/evaluation/preview/release checks, automatic weekly plans, validated swaps and consolidated groceries. Subscriber profiles and separate permissions, diary corrections/offline queue, check-ins, nutrition Twin, privacy operations, exception handling and first/next-week worker scheduling are implemented. All nutrition quantities are derived from stored facts with explicit unknown/estimated values. Routine plans do not require individual coach approval.

Core nutrition passed **51 tests on each database engine**, TypeScript, the production web/container build and **32 browser routes**. Follow-up `2bf35fd` fixes reconnection without queued diary entries, preserves offline cache expiry and labels synthetic meal plans; both final CI jobs passed, including the new empty-queue reconnection browser check. See the [nutrition verification record](VERIFICATION_2026-09-25_NUTRITION.md) for the exact commits, jobs and evidence. New migration: `010_nutrition`. Model behavior in tests is synthetic; production qualification still requires real coach material and configured-provider evaluation. The new billing-portal change flow is account-unverified and disabled unless its reviewed policy is activated. Work 043 now adds camera/upload meal photos, editable AI estimates, separate photo consent, bounded private media, Open Food Facts barcode lookup, confirmed serving facts and manual entry. Stable capture identities and confirmation prevent repeated paid analysis and diary effects; privacy export, withdrawal, erasure and expiry are wired. The suite passes 91 tests; expanded local desktop/mobile journeys and network PostgreSQL/container checks pass. Final GitHub screenshot validation passed with 252 captures and no layout/browser errors. These are fixture checks, not provider qualification. No production deployment or live provider transaction has occurred.

## Settings and trainer design — current slice

Superadmin now manages application controls and ten catalog entries through saved encrypted configuration, safe credential replacement/clearing, read-only or local connection checks, revision conflicts and an immutable sanitized audit. The API and worker use each operation's configuration snapshot; global environment variables are not mutated. Inherited environment connections remain supported and labeled untested here. The host-only first-admin bootstrap resolves initial email-configuration dependency.

Trainer Design Studio includes presets, custom colours with derived readable text, fonts, corners/buttons/spacing, personal copy and public HTTPS image URLs. It uses the same components for desktop/mobile previews, the real client app and public storefront; stale writes conflict and tenants remain isolated. Hosted brand-media uploads remain open.

WHOOP, Zepp, voice and custom-domain orchestration are still unavailable adapters. Their credential editors prepare configuration but cannot activate these integrations. Lean and email tests validate configuration without asserting bank or email delivery. See SUPERADMIN_AND_CUSTOMISATION.md for operator instructions and exact limits.

## Financial behavior and limits

- Minor-unit amounts and balanced journals are enforced. Journal rows cannot be edited or appended after their creating transaction. Corrections compensate history.
- Commission uses marginal bands; invoice allocation currently orders active paid subscribers by first paid timestamp/user ID. This implementation policy requires financial sign-off for mixed prices, churn, discounts and tax.
- Settlement entry is a privileged **manual evidence workflow**, not an automatic bank feed. Actual processing fees are entered in minor units and charged against trainer payables. Fee responsibility still requires approval.
- Reviewed usage statements convert recorded USD cost at an explicitly supplied exchange rate, round once to AED minor units, and post immutable charges against trainer earnings. Close blocks missing usage statements. No exchange rate or fee schedule is silently chosen. Model requests reserve a usage record before sending, retain reported cost even when output is rejected, and preserve missing usage as unknown. Finance can reconcile uncertain costs against provider evidence. Finalized usage is immutable. A configurable per-workspace daily call limit defaults to 100; it is a request cap, not a spend guarantee.
- Close uses Dubai month-end and a seven-day review buffer. It blocks unresolved refunds/reconciliation, uncertain payouts and unpriced usage. The settlement check is conservative across all outstanding receivables.
- Payout preparation requires a closed month, verified destination, 72-hour bank-change hold, available liability and recorded bank funding. Unknown payments remain reserved and cannot be resubmitted. Confirmed terminal failures/returns use new instruction revisions.
- Lean POST paths/payloads are isolated behind `LEAN_CONTRACT_VERIFIED` and `PAYOUTS_APPROVED`. They are **not verified for the operator's account**. A provider response never directly marks a payout paid.
- Financial finality currently requires a privileged operator to record bank evidence. There is no claim of tested automated transfers or a completed monthly live close.

## Release dependencies

1. Configure separate nonproduction provider credentials through encrypted Superadmin settings; host database, origin and encryption-key configuration remain external. Verify provider contracts and business acceptance using account-specific sandbox evidence.
2. Supply reviewed terms/privacy/disclosure, retention/tax/fee policy, actual bank review requirements and approved customer-data placement/domain. Initial GymMembership compute is selected at blr1 with a USD 24/month cap; broader production capacity and residency remain reviewed decisions.
3. Retain passing browser and PostgreSQL/container evidence for each release; expand actual-device, accessibility, load and restore checks. The embedded and network PostgreSQL suites are both required.
4. Complete the remaining implementation rows above; verify each source acceptance criterion. Run threat/safety/accessibility/load review and demonstrated restore/rollback.
5. Deploy staging and conduct an approved, bounded live canary only after the corresponding gates pass.

No production completion, legal approval, PCI scope conclusion, provider approval or audit certification is implied by the passing engineering checks.
