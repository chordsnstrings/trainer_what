# Mock provider sandbox and full-stack end-to-end harness

Branch `feat/e2e-harness`. Migration `061_tenant_member_join_date.sql` (one column grant, defect 1).
How to run and the safety model: `docs/E2E_MOCK_PROVIDERS.md`.

## Plan (written before implementation)

1. Sandbox guard (`packages/providers/src/sandbox.ts`): `TRAINER_PROVIDER_SANDBOX=mock` honoured only
   for a loopback `PUBLIC_APP_URL` and loopback API host; API and worker startup refuse it (and any
   sandbox-only override) otherwise.
2. Sandbox-only endpoint overrides: Stripe SDK host/port/protocol and account check, WHOOP, Open Food
   Facts; loopback HTTPS provider URLs and push endpoints accepted only in the sandbox.
3. Loud state: readiness, bootstrap and Superadmin settings report `providerSandbox`; a banner on every
   workspace screen.
4. HTTPS mocks for every provider under `tests/e2e/mocks/`, a per-run CA through `NODE_EXTRA_CA_CERTS`.
5. `scripts/e2e/run.mjs`: throwaway CI-shaped PostgreSQL, migrations, runtime role, web build, API/web/
   worker in production mode behind a local TLS edge, first Superadmin via `npm run admin:bootstrap`,
   providers configured through the Superadmin settings API, seeding through the public API, suites,
   `tests/e2e/report.json`, teardown.
6. Scenario suites per audience mapped to the verified feature inventory; capture/replay for AI review.

## What was built, per audience

**Super admin**
- Sandbox is visible to operators: `/api/v1/ready` returns `providerSandbox: "mock"` plus a notice;
  `/api/v1/admin/settings` and `/api/v1/bootstrap` carry `providerSandbox`; the new
  `ProviderSandboxBanner` (`apps/web/components/provider-sandbox-banner.tsx`) is mounted once in the
  workspace shell so every screen, including all Superadmin screens, shows it; `npm run readiness`
  adds a finding; API and worker log a warning at startup.
- The harness drives every operator surface that exists on this base through the API or the host
  commands an operator would run: settings and connection tests, legal/notification/macro/safety
  documents, finance (usage statements, settlements, balance debits, fee policy, cost allocation,
  month close, Lean payout, automation, statements), affiliates, support previews and one-time
  corrections, safety triage, privacy erasure and workspace closure, operator roles and
  authenticator resets (`npm run operator:role`, `scripts/reset-mfa.ts`), readiness, key rotation
  (`npm run secrets:reseal`), alert thresholds and recommendations, passkeys and account recovery.

**Trainers, followers, public**
- No product behaviour changes except the four defect fixes below. The harness exercises existing
  features for each audience through the real API (see "Coverage").

**Provider code (production-safe)**
- `packages/providers/src/sandbox.ts`: `providerSandbox()`, `assertProviderSandboxBinding()`,
  `sandboxOverride()`, `sandboxAllowsEndpoint()`, `providerSandboxStatus()`.
- `configuration.ts`: `endpointUrl`/`validatePublicEndpoint` accept `https://` loopback only when the
  sandbox is honoured (plain HTTP and private addresses stay refused); the Stripe account check uses
  the sandbox Stripe base. `index.ts`: `stripeClient()` passes host/port/protocol from
  `STRIPE_API_BASE_URL` only in the sandbox. `integrations.ts`: WHOOP base from `WHOOP_API_BASE_URL`
  only in the sandbox. `food.ts`: Open Food Facts origin from `FOOD_LOOKUP_BASE_URL` only in the
  sandbox. `push.ts`: loopback HTTPS push endpoints only in the sandbox.
- `apps/api/src/server.ts` and `apps/worker/src/index.ts` call `assertProviderSandboxBinding()`.

**Harness (tests only)**
- `tests/e2e/mocks/*`; `tests/e2e/harness/*` (a client per person with its own address, shared
  authenticator counters and step-up reuse, a software WebAuthn passkey, a host-command runner, a
  report with inventory coverage); `tests/e2e/scenarios/*` (seed, audience suites,
  `extended.e2e.ts`, `extended-accounts.e2e.ts`); `tests/e2e/reviewed/model-answers.jsonl`;
  `scripts/e2e/run.mjs`.

## Defects found by the harness and fixed (small, clearly bugs)

1. Trainer analytics (`GET /api/v1/analytics/business`, retention cohorts) and the Superadmin
   subscriber list (`GET /api/v1/admin/operations/subscribers`) returned HTTP 500 (`42501 permission
   denied for table users`) as the restricted runtime role: both read `users.created_at`, but the
   tenant role `trainer_app` could select only `users(id,name,email)`. Migration
   `061_tenant_member_join_date.sql` grants `SELECT(created_at)` on `users` to `trainer_app` only;
   password, verification and platform-role columns stay hidden. PGlite tests did not catch it
   because they do not enforce column grants. Regression: `tests/e2e-harness-member-dates.test.ts`
   (run on pg-sandbox as the restricted role).
2. Stripe's `charge.refunded` for a refunded paid coaching session returned HTTP 500 ("Refunded
   charge has not been reconciled"), so Stripe would retry it indefinitely: the subscription ledger has
   no record of booking charges. `processBookingStripeEvent` now recognises a charge whose payment
   intent belongs to a booking and applies its refunds through the existing idempotent booking refund
   path (`apps/api/src/finance-bookings.ts`). Regression: `tests/e2e-harness-booking-refund.test.ts`.
3. `POST /api/v1/payout-runs/prepare` returned HTTP 500 for two expected business states: no
   closed month for the period, and a closed month with nothing eligible (for example a workspace
   whose members are all in a free trial, so every invoice is $0). `createPayout`
   (`apps/api/src/finance.ts`) threw plain errors; they are now 409 `PAYOUT_CLOSE_REQUIRED` and
   `PAYOUT_NOTHING_AVAILABLE`, consistent with `BENEFICIARY_REQUIRED` and `BANK_CHANGE_HOLD` on the
   same route. Messages are unchanged. Regression: `tests/e2e-harness-payout-precondition.test.ts`.
4. A follower never saw that their trainer had taken over the conversation: `GET
   /api/v1/messages/thread` computed `personalReview` from the member's own takeover record, which is
   not a subscriber-visible record kind, so it was always `false` for the member (the web shows "Your
   trainer is handling this conversation personally" only when it is `true`). For a member the flag
   is now read the way the digital coach already reads it (`coaching-completion.ts`): a staff view
   limited to that member's own active takeover (`apps/api/src/training-programs.ts`). The member
   still cannot read the takeover record itself. Regression:
   `tests/e2e-harness-takeover-notice.test.ts` (it fails on PGlite without the fix).

## Findings reported, not fixed (need a product decision or larger change)

1. **Disputes on paid-session charges fail the webhook.** `charge.dispute.created`/`closed` for a
   booking charge throws "Disputed charge has not been reconciled" (HTTP 500, Stripe retries) and no
   dispute reserve is posted: the dispute path only looks for subscription invoice journals.
   Confirmed with a throwaway probe against `processStripeEvent` (not committed); the harness
   exercises disputes only on membership charges. Needs a booking dispute journal design.
2. **Free-trial members are stored as `active`.** The $0 trial invoice's `invoice.paid` sets the
   subscription status to `active`, replacing `trialing` from `customer.subscription.created`
   (`apps/api/src/stripe-events.ts`). Access is the same, but screens and metrics cannot tell trial
   members from paying ones (Omar's four trial members show `active, 0 AED`).
3. **Nutrition document import has no personal-identifier review.** Brain document imports flag
   emails, phone numbers and client references and refuse approval until they are redacted;
   `POST /api/v1/nutrition/documents` stores the extracted text as teaching material as is (the run
   records `stored text keeps the email address: true`).
4. **Notification template variables.** When a Superadmin publishes a template for a key, `{{coach}}`
   renders the literal "Your coach" and `{{date}}` the sending date (`notifyUser` in
   `apps/api/src/notifications.ts`), so a published `workout-reminder` template replaces "Your next
   training day … planned for <session date>" with the send date and no coach name (seen in the run:
   "Hi Yousef Aziz, your session with Your coach is on 2026-09-27").
5. **Setup checklist after launch.** Later changes make the reviewed subscriber preview stale, so a
   live workspace's checklist shows "Complete subscriber preview" as an open gate (22 steps, 21
   complete in the run). Harmless, but confusing for a launched trainer.
6. **Held-out Brain scenarios are not checked for overlap with the teaching.** The harness's 20
   "held-out" prompts restate confirmed rule directives almost verbatim and the evaluation accepts
   them; a near-duplicate check against sources and rules would make "held-out" meaningful.
7. **A meal-photo estimate must contain at least one item.** An honest "nothing identifiable in
   this photo" answer has to invent a placeholder item (see the AI review below).
8. **Custom domains:** DNS TXT/CNAME verification and live TLS activation are not simulated; the
   registrar mock is exercised through the operator evidence flow only, because the app records
   registrar work as evidence and never calls a registrar API itself.

## AI review (reviewer judgement on captured model traffic)

Every model request in a run is captured with its answer. The reviewer read one request of every
prompt kind from the run capture and judged the rule-based answers and the app's handling:

- Rule compilation: each draft rule traces to one source sentence; the always/never conflict on
  accessory-curl failure sets is surfaced and resolved. A scripted rule citing an unknown source is
  withheld and its usage still recorded (guardrail step).
- Coach action selection: travel and missed-week messages select the approved "missed week"
  action with the rule and teaching case as evidence; tax/legal requests are refused.
- Digital coach reply: for a dumbbell-only beginner who logged goblet squats, the answer cites the
  trainer's *barbell* squat progression rule. The app marked it for trainer review
  (`requiresHumanReview`), which is the correct outcome. The reviewed replay answer cites the rule
  and the intake and asks the coach to confirm how it applies; in the replay run the trainer sees
  exactly that held reply with its evidence. A scripted reply citing invented evidence is withheld
  from the member (guardrail step).
- Meal photo: the rule responder is not image-aware and "estimated" chicken and rice for a
  flat-colour sample image. The app requires the member to edit and confirm, so nothing enters the
  diary unreviewed, but it cannot detect a hallucinated estimate. The reviewed replay answer
  identifies nothing and asks the member (finding 7). Invalid JSON is withheld with 503.
- Nutrition: policy compilation returns `policy: null` with gaps rather than inventing calorie
  numbers; the evaluation's decisions cite teaching quotes with the category principle; a week
  outside the calorie policy becomes a coach exception instead of a delivered plan.

## Coverage

A feature counts when a step with its inventory name ran, or when a step performed exactly the same
flow for another audience (the pairs are listed in `EQUIVALENT_FEATURES` in
`tests/e2e/harness/report.ts`). Final rules-mode run:

| Audience | Exercised / listed |
| --- | --- |
| Super admin | 80 / 87 |
| Trainers | 90 / 91 |
| Followers | 76 / 85 |
| Public / joining | 63 / 77 |

Not exercised, with the reason: not built on this base per the inventory (executive metrics,
suspension and locks, alerts to operators, cloud actions, database backups, moving the platform
address, HealthKit automatic sync, trainer-granted free access, leaving a trainer, changing name or
email, operator password reset, follower invitation emails and the invitation list, Apple/Google
sign-in, coach directory, sitemap/robots, coach alert on join, contact messages as leads, coach-domain
HTTPS); custom-domain DNS and TLS that cannot be simulated without DNS (ownership check, activation,
coach site on its own domain, member sign-in at the coach's address); browser-only behaviour (Brain
workspace screen, Today home screen, Settings and API connections page, offline workout and food
diary sync); conversion milestones beyond sign-up, analytics expiry (180 days) and "training access
right after joining" as the public-join audience defines it. `tests/e2e/report.json` lists them under
`inventory.notExercised` when the run is given the inventory.

## Tests actually run (2026-09-27, Node 24)

- `npx tsc --noEmit`: exit 0.
- PGlite: `node --import tsx --test tests/e2e-harness-sandbox.test.ts tests/e2e-harness-mocks.test.ts
  tests/e2e-harness-booking-refund.test.ts tests/e2e-harness-member-dates.test.ts
  tests/e2e-harness-payout-precondition.test.ts tests/e2e-harness-takeover-notice.test.ts
  tests/coaching-completion.test.ts tests/coaching-runtime.test.ts tests/platform.test.ts`: 73 tests,
  73 pass (21 of them in the six harness files).
- pg-sandbox (restricted `trainer_service` role, port 56118): `/opt/tools/pg-sandbox.sh 56118 <worktree>`
  with the six harness files plus `coaching-completion`, `coaching-runtime`, `platform`,
  `admin-completion`, `finance-completion`, `fix-payouts`, `retention`, `provider-configuration`:
  14 files, 119 tests, 119 pass. Earlier in the package `platform-settings.test.ts` was also listed
  and failed 0/15 in its `before` hook, which by design only accepts a disposable `trainer_ci_<hex>`
  database (pg-sandbox uses `trainer`); it passes on PGlite.
- Related suites on PGlite earlier in the package: `provider-configuration, push-notifications,
  integrations-completion, meal-capture, platform-settings, fix-payouts, fix2-finance, fix-ledger,
  fix-settings`: 83/83; `admin-completion, finance-completion, retention, platform`: 68/68; `fix2-web,
  fix2-edge-deploy, onboarding-completion, integrations-completion`: 32/32.
- Full harness, `node scripts/e2e/run.mjs --pg-port=56118 --features=<inventory> --skip-build` (web
  built in this package with `npm run build`; the web sources did not change afterwards):
  - rules-mode run `2026-09-27T20-55-39-365Z`: 356 steps, 356 pass, 0 fail, 0 skipped, 474 s; Stripe
    webhooks all HTTP 200; mock requests: Stripe 60, email 46, Lean 4, model 109, push 1, WHOOP 8,
    Zepp 4, voice 1, registrar 2, Open Food Facts 2; model answers: rules 104, queue 4 (guardrails).
  - replay run with `--model-replay=tests/e2e/reviewed/model-answers.jsonl`: see "Final runs" below.
  - Earlier runs in this package found the four defects above (first full run: 268 steps, 261 pass,
    7 fail: analytics 42501, operator subscriber list 42501, payout preparation 500 and four harness
    ordering/selection issues; the takeover notice failed in the extended suite before its fix).
