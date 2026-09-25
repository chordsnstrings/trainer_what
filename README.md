# Trainer Brain Platform

Trainer-branded coaching for UAE/AED: teach a Brain, review its rules, publish a coaching offer, serve subscribers and track trainer earnings.

**Status: runnable development implementation; production release is not complete.** See the [build status and remaining work](docs/BUILD_STATUS.md) for the exact boundary. No live payment, payout or deployment has been verified.

## Run locally

Requires Node **24.19.0 or newer** and npm. The lockfile pins dependencies.

```bash
npm ci
cp .env.example .env
npm run seed:demo
npm run dev
```

Open `http://localhost:3000`. The development database is real embedded PostgreSQL (PGlite), persisted under `.data/postgres`. Stop the API before migrations or seeding; the embedded database has a single-process lock. PostgreSQL is required for the standalone worker and production.

Optional synthetic demo accounts:

| Account | Email | Development password |
| --- | --- | --- |
| Trainer / development operator | `coach@example.test` | `TrainerDemo2026!` |
| Subscriber | `sam.taylor@example.test` | `TrainerDemo2026!` |

The seed refuses production. Its subscriptions, financial entries, coach nutrition material and meal plans are explicitly synthetic. Set `DEMO_PASSWORD` when generating a different local fixture. Never seed a customer database.

## What is implemented

- Trainer, subscriber and operator interfaces; stored branding, invitations and public enrollment.
- Password sessions, verification/reset flows, encrypted authenticator enrollment and MFA checks for privileged production actions.
- PostgreSQL tenant isolation; scoped directory access and hidden unapproved coaching decisions.
- PDF/DOCX/text teaching sources and interviews; model adapter for draft-rule compilation, conflict review, rule corrections, held-out evaluation, supervised releases and rollback.
- Intake/consent, trainer-authored programs, workout logs, offline queue/PWA code, chat, trainer takeover and safety review.
- Case-based nutrition onboarding, private diet/target policies, independent held-out qualification and automatic weekly meals with recipes, portions, cooking choices and consolidated groceries.
- Workout-only and higher-priced workout + nutrition tiers, nutrition consent/profile, diary/check-ins, exception handling, weekly worker jobs and opt-in offline plan/diary support.
- Session bookings with serialized capacity, cancellations and support conversations.
- Stripe Checkout/subscription adapters and signed webhook processing; immutable balanced ledger, refunds/disputes, reviewed settlements and reviewed usage charges and monthly close checks.
- Lean payout instruction adapter, destination review/hold, funded payout preparation, uncertain-outcome holds and payment reconciliation.
- Apple Health numeric XML import, permission revocation/export and reviewed local subscriber erasure, usage records, email outbox/worker, operator finance tools.

Provider-backed features return a clear unavailable state until configured. Lean's account-specific transport contract remains unverified and is separately gated. Coaches confirm compiled methodology and qualify releases. Training model responses remain supervised; routine qualified nutrition plans are delivered automatically, with human handling of exceptions.

Meal-photo logging and food-barcode scanning are committed next-scope features of workout + nutrition. They are not implemented or configured yet; see [section 7 of the nutrition plan](docs/NUTRITION_INTEGRATION_PLAN.md#7-meal-photos-and-barcode-scanning--required-scope).

## Verify

```bash
npm run check            # TypeScript, integration tests, production web build
npm run db:migrate      # local migrations, or separate MIGRATION_DATABASE_URL
npm run readiness       # configuration report; does not prove provider approval
```

Browser smoke setup on a machine with browser-download access:

```bash
npx playwright install --with-deps chromium --only-shell
npm run build
npm run seed:demo
npm run test:browser
```

The browser runner starts API and the production web build itself. Stop existing servers first. CI includes these checks; a configured workflow is not a passed CI run. Local browser downloads were unavailable, but [the nutrition release passed 51 tests on each database engine, 32 browser routes and production container checks](https://github.com/chordsnstrings/trainer_what/actions/runs/36094669632). See the [verification record](docs/VERIFICATION_2026-09-25_NUTRITION.md).

## Structure

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js / React responsive public and workspace UI |
| `apps/api` | Fastify API, security, coaching and finance |
| `apps/worker` | Durable email and nutrition-week jobs for PostgreSQL |
| `packages/db` | Migrations, scoped transactions and RLS |
| `packages/domain` | Money, coaching/nutrition schemas, food calculations, safety and payout transitions |
| `packages/providers` | Stripe, Lean, model and email boundaries |
| `packages/contracts` | Validated API inputs |
| `tests` | Real PostgreSQL-engine integration checks with isolated fixtures |
| `infra`, `Dockerfile`, `compose.yaml` | Containers and GymMembership setup/checked-main deployment controller; live deployment unverified |

## Deployment and project context

Start with [deployment instructions](docs/DEPLOYMENT.md), [build status](docs/BUILD_STATUS.md) and [implementation decisions](docs/ADR-001-IMPLEMENTATION.md). Production uses a separate migration administrator and a non-owner runtime role. Web receives no provider or migration credentials.

The money flow remains **Stripe → company bank → Lean → verified trainer IBAN**. A Stripe payment does not prove company-bank settlement; Lean initiation does not prove beneficiary receipt.

Planning baseline: [implementation plan](IMPLEMENTATION_PLAN.md), [34-work-package roadmap](docs/DELIVERY_ROADMAP.md), [technical blueprint](docs/TECHNICAL_BLUEPRINT.md), [75-screen source coverage](docs/SCREEN_AND_REQUIREMENTS.md), [release requirements](docs/OPERATIONS_AND_RELEASE.md). Current owner decisions and Astra/token preferences are in [project memory](docs/PROJECT_MEMORY.md).
