# Build status

Code verification: 25 September 2026. This file reports code and observed checks, separately from provider readiness and production release.

## Evidence

| Check | Observed result |
| --- | --- |
| TypeScript | Passed |
| Automated tests | 51 passed, 0 failed in each CI job: embedded PGlite and network PostgreSQL 17.6 with a non-owner runtime role |
| Next.js production build | Passed |
| Database migrations | All ten migrations, including `010_nutrition`, exercised by the embedded/network database suites and container readiness |
| Browser smoke | Passed in [GitHub CI](https://github.com/chordsnstrings/trainer_what/actions/runs/36094669632) on `2bf35fd`: 32 routes on the production web build; public pages/demo, onboarding save/reload, Client Twin, coach nutrition and conditional setup, subscriber meals/groceries/pantry, offline nutrition diary and workout reload/replay; no overflow/page errors |
| GitHub Actions | Both application and PostgreSQL/container jobs passed on `2bf35fd`; see [verification record](VERIFICATION_2026-09-25_NUTRITION.md) |
| Docker / production PostgreSQL | Passed in [GitHub CI](https://github.com/chordsnstrings/trainer_what/actions/runs/36094669632) on `2bf35fd`: PostgreSQL 17.6, non-owner runtime role, production container readiness |
| Staging / DigitalOcean | New isolated resources authorized. Authenticated app account/region/size reads succeeded at 13:11 on 25 September. Project/VPC/firewall and host setup remain unavailable through the app; shell HTTPS and browser project access fail. No resources created or deployment. Required Git-triggered deployment is not configured. See DIGITALOCEAN_DEPLOYMENT.md. |
| Stripe / Lean / model / email calls | No live provider call performed |

The suite covers commission boundaries, RLS and directory boundaries, authentication/origin checks, single-use invitations, consent, workout replay and safety holds, balanced and sealed journals, payout reservation/uncertain outcomes/returns/revisions, Stripe event replay and signatures, refunds, disputes, stale subscription events, MFA replay and invitation bypass, password recovery, booking capacity, support isolation, unavailable-provider behavior, consent/takeover enforcement, bounded PDF/DOCX extraction, entity rejection, local privacy erasure, staff scopes, funding rechecks and usage-charge posting, durable model-cost accounting, concurrent AI request caps, 16-step onboarding concurrency/preview invalidation, Client Twin source/freshness/rights and versioned isolation. Nutrition adds deterministic ingredient/portion calculations, independent case qualification, immutable facts, two-tier entitlement projection, automatic delivery and swaps, diary replay/corrections, job deduplication, profile/consent races, tenant isolation, exception routing and retained model-cost evidence.

## Implemented behavior

| Area | Delivered | Remaining boundary |
| --- | --- | --- |
| Foundation (005–009) | npm monorepo, API/web/worker, ten migrations, RLS, sessions, invites, MFA, tokens, responsive shell, events/jobs, CI/container definitions | Staging, actual-device/accessibility/performance/restore evidence; verified custom-host resolution |
| Acquisition/onboarding (010–011) | Dedicated acquisition/how-it-works/scripted-demo/pricing/FAQ pages, signup/login/recovery, stored brand, public coach enrollment, 16-step registry with identity autosave/CAS resume, server-derived readiness, preview invalidation and publish gates | Attribution, brand media uploads, advanced onboarding capabilities tied to their provider issues and actual separate-device acceptance |
| Brain (012–014) | PDF/DOCX/text sources and interview, rights metadata, bounded compilation adapter, draft review/conflicts/corrections, 20-case evaluation, digest-pinned supervised release/rollback | OCR/audio/image ingestion, parser isolation/security scanning, sophisticated retrieval/conflict evaluation, real provider traces and broader safety corpus |
| Coaching (015–017) | Versioned intake/consent and Client Twin snapshots, dated facts, robust personal baselines with coverage/lineage and import deduplication, assigned programs, set logs, verified offline reload/replay, messaging, takeover, structured decisions awaiting review, approved-program assignment | Broader Twin domains, program-schedule adherence/advanced deterministic adaptations, exercise-media library, real-device PWA and accessibility coverage |
| Commerce (018–022) | Stable Checkout intent, products/prices, cancel/reactivate, signature/inbox validation, subscription projection, refund/dispute ledger, settlement evidence entry, monthly close, reviewed destination, payout reservations/holds/revisions | Provider sandbox/canary, approved commission/fee/tax policy, automatic Stripe/bank reconciliation, provider validation of refund-uncertainty recovery, Lean transport/finality verification and callbacks |
| Privacy (023) | Consent versions/revocation, export, reviewed subscriber local erasure, retained finance/audit references, restricted model evidence | Reviewed legal content, automatic provider/backups erasure and trainer/workspace closure, retention/incident processes |
| Integrations (026–029,033) | Numeric Apple export parser/import, rights tags, duplicate-batch guard | WHOOP/Zepp approved adapters, fine-grained overlapping-import deduplication, custom domains, voice, native HealthKit/BLE companion |
| Operations (030–032) | Booking capacity/cancellation/attendance, support, email outbox/worker, finance overview and manual evidence tools, operator role command | Lifecycle campaign scheduling, affiliate/experiments, complete role-specific admin/support/impersonation views, infra Governor and measured operational readiness |
| Bespoke model (034) | Provider-independent supervised baseline | No bespoke model work is justified or claimed without measured baseline results |

A provider placeholder or unavailable badge is not an implemented integration. The 75 source screen groups are the target contract; the current route shell does not mean every group is complete.

## Nutrition implementation — verified core

Nutrition core implementation now covers the two tiers, case-based coach teaching, conditional onboarding, recipe/ingredient versions and cooking variants, independent policy/evaluation/preview/release checks, automatic weekly plans, validated swaps and consolidated groceries. Subscriber profiles and separate permissions, diary corrections/offline queue, check-ins, nutrition Twin, privacy operations, exception handling and first/next-week worker scheduling are implemented. All nutrition quantities are derived from stored facts with explicit unknown/estimated values. Routine plans do not require individual coach approval.

Core nutrition passed **51 tests on each database engine**, TypeScript, the production web/container build and **32 browser routes**. Follow-up `2bf35fd` fixes reconnection without queued diary entries, preserves offline cache expiry and labels synthetic meal plans; both final CI jobs passed, including the new empty-queue reconnection browser check. See the [nutrition verification record](VERIFICATION_2026-09-25_NUTRITION.md) for the exact commits, jobs and evidence. New migration: `010_nutrition`. Model behavior in tests is synthetic; production qualification still requires real coach material and configured-provider evaluation. The new billing-portal change flow is account-unverified and disabled unless its reviewed policy is activated. The owner has now made meal-photo logging and barcode scanning required scope. Work 043 is not implemented or provider-configured; expanded 044 verification remains pending. The passing core checks above do not verify these new journeys. No production deployment or live provider transaction has occurred.

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

1. Configure separate nonproduction provider credentials through environment secrets. Verify provider contracts and business acceptance using account-specific sandbox evidence.
2. Supply reviewed terms/privacy/disclosure, retention/tax/fee policy, actual bank review requirements, budget and approved region/domain.
3. Retain passing browser and PostgreSQL/container evidence for each release; expand actual-device, accessibility, load and restore checks. The embedded and network PostgreSQL suites are both required.
4. Complete the remaining implementation rows above; verify each source acceptance criterion. Run threat/safety/accessibility/load review and demonstrated restore/rollback.
5. Deploy staging and conduct an approved, bounded live canary only after the corresponding gates pass.

No production completion, legal approval, PCI scope conclusion, provider approval or audit certification is implied by the passing engineering checks.
