# Build status

Checkpoint: 24 September 2026. This file reports code and observed checks, separately from provider readiness and production release.

## Evidence

| Check | Observed result |
| --- | --- |
| TypeScript | Passed |
| Automated tests | 32 passed, 0 failed; real PGlite/PostgreSQL engine and Fastify requests |
| Next.js production build | Passed |
| Existing local fixture database | Seven migrations applied to the existing local fixture; idempotent demo seed completed |
| Browser smoke | Passed in [GitHub CI](https://github.com/chordsnstrings/trainer_what/actions/runs/36022148348) on `a49e4db`: login, trainer/admin routes, 390px navigation, no overflow or page errors; human visual review pending |
| GitHub Actions | First clean-checkout build/test/browser run passed; expanded PostgreSQL/container job added in this revision |
| Docker / production PostgreSQL | Configuration supplied; not executed in this runtime |
| Staging / DigitalOcean | Not deployed; account, region and budget unavailable |
| Stripe / Lean / model / email calls | No live provider call performed |

The suite covers commission boundaries, RLS and directory boundaries, authentication/origin checks, single-use invitations, consent, workout replay and safety holds, balanced and sealed journals, payout reservation/uncertain outcomes/returns/revisions, Stripe event replay and signatures, refunds, disputes, stale subscription events, MFA replay and invitation bypass, password recovery, booking capacity, support isolation, unavailable-provider behavior, consent/takeover enforcement, bounded PDF/DOCX extraction, entity rejection, local privacy erasure, staff scopes, funding rechecks and usage-charge posting.

## Implemented behavior

| Area | Delivered | Remaining boundary |
| --- | --- | --- |
| Foundation (005–009) | npm monorepo, API/web/worker, seven migrations, RLS, sessions, invites, MFA, tokens, responsive shell, events/jobs, CI/container definitions | Production PostgreSQL and container verification, staging, browser/accessibility/performance/restore evidence; verified custom-host resolution |
| Acquisition/onboarding (010–011) | Landing/calculator, signup/login/recovery, stored brand, public coach enrollment, onboarding record/checkpoints | Dedicated full acquisition pages, attribution, every source onboarding step and cross-device acceptance |
| Brain (012–014) | PDF/DOCX/text sources and interview, rights metadata, bounded compilation adapter, draft review/conflicts/corrections, 20-case evaluation, digest-pinned supervised release/rollback | OCR/audio/image ingestion, parser isolation/security scanning, sophisticated retrieval/conflict evaluation, real provider traces and broader safety corpus |
| Coaching (015–017) | Versioned intake records/consent, assigned programs, set logs, local queue/PWA implementation, messaging, takeover, structured model decisions awaiting review, approved-program assignment | Browser offline recovery evidence, complete Twin freshness/uncertainty engine, exercise-media library and advanced deterministic adaptations |
| Commerce (018–022) | Stable Checkout intent, products/prices, cancel/reactivate, signature/inbox validation, subscription projection, refund/dispute ledger, settlement evidence entry, monthly close, reviewed destination, payout reservations/holds/revisions | Provider sandbox/canary, approved commission/fee/tax policy, automatic Stripe/bank reconciliation, provider validation of refund-uncertainty recovery, Lean transport/finality verification and callbacks |
| Privacy (023) | Consent versions/revocation, export, reviewed subscriber local erasure, retained finance/audit references, restricted model evidence | Reviewed legal content, automatic provider/backups erasure and trainer/workspace closure, retention/incident processes |
| Integrations (026–029,033) | Numeric Apple export parser/import, rights tags, duplicate-batch guard | WHOOP/Zepp approved adapters, fine-grained overlapping-import deduplication, custom domains, voice, native HealthKit/BLE companion |
| Operations (030–032) | Booking capacity/cancellation/attendance, support, email outbox/worker, finance overview and manual evidence tools, operator role command | Lifecycle campaign scheduling, affiliate/experiments, complete role-specific admin/support/impersonation views, infra Governor and measured operational readiness |
| Bespoke model (034) | Provider-independent supervised baseline | No bespoke model work is justified or claimed without measured baseline results |

A provider placeholder or unavailable badge is not an implemented integration. The 75 source screen groups are the target contract; the current route shell does not mean every group is complete.

## Financial behavior and limits

- Minor-unit amounts and balanced journals are enforced. Journal rows cannot be edited or appended after their creating transaction. Corrections compensate history.
- Commission uses marginal bands; invoice allocation currently orders active paid subscribers by first paid timestamp/user ID. This implementation policy requires financial sign-off for mixed prices, churn, discounts and tax.
- Settlement entry is a privileged **manual evidence workflow**, not an automatic bank feed. Actual processing fees are entered in minor units and charged against trainer payables. Fee responsibility still requires approval.
- Reviewed usage statements convert recorded USD cost at an explicitly supplied exchange rate, round once to AED minor units, and post immutable charges against trainer earnings. Close blocks missing usage statements. No exchange rate or fee schedule is silently chosen.
- Close uses Dubai month-end and a seven-day review buffer. It blocks unresolved refunds/reconciliation, uncertain payouts and unpriced usage. The settlement check is conservative across all outstanding receivables.
- Payout preparation requires a closed month, verified destination, 72-hour bank-change hold, available liability and recorded bank funding. Unknown payments remain reserved and cannot be resubmitted. Confirmed terminal failures/returns use new instruction revisions.
- Lean POST paths/payloads are isolated behind `LEAN_CONTRACT_VERIFIED` and `PAYOUTS_APPROVED`. They are **not verified for the operator's account**. A provider response never directly marks a payout paid.
- Financial finality currently requires a privileged operator to record bank evidence. There is no claim of tested automated transfers or a completed monthly live close.

## Release dependencies

1. Configure separate nonproduction provider credentials through environment secrets. Verify provider contracts and business acceptance using account-specific sandbox evidence.
2. Supply reviewed terms/privacy/disclosure, retention/tax/fee policy, actual bank review requirements, budget and approved region/domain.
3. Run browser smoke and full PostgreSQL/container checks; fix findings and capture screenshots. Exercise concurrency against PostgreSQL rather than relying only on embedded serialization.
4. Complete the remaining implementation rows above; verify each source acceptance criterion. Run threat/safety/accessibility/load review and demonstrated restore/rollback.
5. Deploy staging and conduct an approved, bounded live canary only after the corresponding gates pass.

No production completion, legal approval, PCI scope conclusion, provider approval or audit certification is implied by the passing local suite.
