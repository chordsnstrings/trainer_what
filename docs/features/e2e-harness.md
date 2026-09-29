# Mock provider sandbox and full-stack end-to-end harness

Branch `feat/e2e-harness` (now containing `integrate/round2`). Migration
`062_tenant_member_join_date.sql` (one column grant, defect 1, and the follower's takeover flag
helper, stage 3). Per-feature results of the final runs:
[`e2e-harness-coverage.md`](e2e-harness-coverage.md).
How to run and the safety model: `docs/E2E_MOCK_PROVIDERS.md`.

## Stage 3 (2026-09-27): adversarial review fixes

### Follower takeover notice without a staff scope (major finding)

Stage 1's defect-4 fix read the follower's `personalReview` flag by opening a staff tenant scope
for the follower's own identity (`db.tenant({ ...a, role: "staff" })`), so only a WHERE clause kept
the follower to its own row, and `hard/isolation`'s scope rule (a subscriber member may act only as a
subscriber, `ACTOR_ROLE_MISMATCH`) would have broken `GET /api/v1/messages/thread` for every
follower after both branches merge.

- `apps/api/src/training-programs.ts`: a follower's thread now reads the flag inside its own
  subscriber transaction with `SELECT member_takeover_active()`; trainers keep the direct query.
  No staff scope is opened for a follower any more.
- `packages/db/migrations/062_tenant_member_join_date.sql` (renamed from `061_…`, see below) creates
  `member_takeover_active()` only when it does not exist: a `SECURITY DEFINER` SQL function that
  returns one boolean for `app.user_id` in `app.tenant_id`, `EXECUTE` revoked from `PUBLIC` and
  granted to `trainer_app` only. The body is identical to the function `hard/isolation` creates in
  `061_tenant_scope_isolation.sql`; that file sorts first, so on a merged branch it creates the
  function and this file leaves it alone (checked: both file sets migrate on PGlite and the
  function has the same definition and grant either way).
- `scripts/verify-runtime-access.mjs` classifies the helper (definer, tenant-only, not `PUBLIC`,
  not runtime-owned). After merging `hard/isolation` the list names it twice; remove one line.
- `tests/e2e-harness-takeover-notice.test.ts` also checks that another member of the same
  workspace never sees someone else's takeover, that the helper answers only for the scope's own
  user, and that the member's own scope still cannot read takeover rows.
- The booking regression tests now call `preparePaidBooking` in the follower's own scope (as
  `hard/isolation` requires) instead of a follower acting as staff.
- Not changed: `apps/api/src/coaching-completion.ts` still runs the digital-coach turn in the
  base's staff scope. `hard/isolation` rewrites exactly that function (its own scope,
  `member_takeover_active()`, `member_material()`); repeating part of that rewrite here would only
  create overlapping hunks, and the rest of that transaction needs `member_material()`, which only
  `hard/isolation` has. Merge `hard/isolation` before or with this branch.

### Migration renumbered (minor finding)

`061_tenant_member_join_date.sql` is now `062_tenant_member_join_date.sql` (it records version
`062_tenant_member_join_date`), so it no longer shares 061 with `hard/isolation` and sorts after it,
which the helper above relies on. No database outside throwaway test clusters has applied the old
name. The coordinator still owns the final number; if it changes, keep it after
`061_tenant_scope_isolation.sql`.

### Stripe double and provider-loss recovery (missing requirement)

- `tests/e2e/mocks/stripe.ts`: `GET /v1/refunds/:id` (the app's `refunds.retrieve` in booking
  reconciliation); `loseNextResponse(method, path)` applies a request (and caches it for its
  idempotency key) but answers HTTP 500 with `Stripe-Should-Retry: false`, so the SDK does not
  retry and the app must reconcile; coupons limited to products are refused for another product's
  price (`coupon_not_applicable`), expired or used-up coupons are refused, and redemptions are
  counted; `charge.refunded` no longer embeds the refunds list, matching the stamped API version
  `2026-06-24.dahlia`, the live account default, since 29 September 2026 (Stripe dropped it from 2022-11-15); `chargeEventObject(charge, "2022-08-01")`
  and `sendEvent(..., { apiVersion })` produce the older shape on purpose.
- New suite `tests/e2e/scenarios/provider-recovery.e2e.ts` (phase "completion: provider-loss
  recovery"), per audience:
  - **Follower**: paid session with the checkout and refund webhooks lost: `POST
    /api/v1/bookings/:id/payment/reconcile` confirms the payment (`checkout.sessions.retrieve`),
    then after cancelling confirms the refund (`refunds.retrieve`); the booking ends refunded with
    exactly one `booking-charge:` and one `booking-refund:` journal. Renewal cancellation whose
    Stripe answer is lost: the app answers 500, holds the instruction (a second change gets
    `RENEWAL_UNRESOLVED`), `POST /api/v1/membership/renewal/reconcile` confirms it from Stripe's
    subscription, and reactivation restores the renewal.
  - **Trainer**: an approved refund whose webhooks are lost: nothing is posted until `POST
    /api/v1/refund-requests/:id/reconcile`, which posts one `stripe-refund:` journal; a second
    reconcile and the late webhook change nothing. A promotion whose coupon answer is lost: held
    as `unknown`, a retry gets `PROMOTION_EXISTS`, `POST /api/v1/finance/promotions/:id/reconcile`
    publishes it from the coupon, then it is archived.
  - **Super admin** (Stripe payment events endpoint): the lost webhooks arrive late, including
    `charge.refunded` in both the current and the pre-2022-11-15 shape; all answer 200 and the
    ledger is unchanged.
- `tests/e2e-harness-booking-refund.test.ts` states which API versions each case covers and adds
  the current shape: a `charge.refunded` without a refunds list is accepted and changes nothing
  until `refund.created` confirms the refund once. Checked against the pre-fix code (the booking
  branch disabled): the two pre-2022-11-15 cases fail and the current-shape case passes, so the
  stage-1 defect 2 affects only webhook endpoints pinned before 2022-11-15, as the review said.
  The fix stays: it is harmless on current versions and an endpoint's version is set in the
  Stripe dashboard, not by this code.

### Scenario assertions (minor findings)

- Silent setup failures: `Reporter.prepare()` runs setup that later steps need and records a
  failure as a failed step; `Reporter.blocked()` and `missingPrerequisite()` record steps that
  cannot run. Applied to every early return that previously recorded nothing (member-completion
  joins and seeded-member lookups, extended's seeded followers, deletion/closure dependants,
  domain sign-in, account lock, unpaid gating). Returns that follow a step which already failed
  are left as they were: that failure already fails the run.
- `scripts/e2e/run.mjs` fails a run of every suite when fewer than `FULL_RUN_MIN_STEPS` steps
  passed or failed (`--min-steps=N` overrides; 0 for a partial `--suites` run).
- Discount checkout: the step now requires the promotion's coupon on the session and
  `amount_total = round(unit_amount × 0.8)` with `amount_subtotal = unit_amount`, and no discount
  without a code; the double refuses a coupon for another product's price, as Stripe does.
- Month close and payout: the payout must equal `min(eligible at close − later debits − reserved,
  available, bank cash − reserved)` from the admin finance summary, where the later debits are
  checked to be exactly the usage charge and the settlement fee the scenario posted; after the bank
  confirmation the `payout:<id>` journal must exist with `trainer_payable +amount` and
  `bank_cash −amount`, and the amount owed to the trainer must drop by exactly the payout.

### Stage 3 tests actually run

All on 2026-09-27 with Node 24 in this worktree. Code commit `356b8c2`; this doc and the
regenerated coverage table are committed on top of it.

- `npx tsc --noEmit`: exit 0 (after the last code change).
- PGlite, `node --import tsx --test --test-concurrency=1 tests/e2e-harness-*.test.ts`: 7 files,
  31 tests, 31 pass (27 before this stage; new: two takeover-scope tests, the current-API
  `charge.refunded` case, the Stripe double's retrieve/lost-response/coupon/API-version test).
- The pre-fix check of `tests/e2e-harness-booking-refund.test.ts` with the booking
  `charge.refunded` branch disabled: 2 pass, 2 fail (the two pre-2022-11-15 cases); the file was
  restored before anything else ran.
- PGlite related suites: `accounts-self-service, coaching-completion, coaching-followups,
  coaching-runtime, governance-locks, platform, finance-completion, bookings-completion,
  fix-ledger, fix-payouts`: 113 tests, 113 pass; `fix2-finance, provider-configuration,
  integrations-completion, retention, admin-completion`: 46 tests, 46 pass.
- pg-sandbox (restricted runtime role, port 56118): `/opt/tools/pg-sandbox.sh 56118 <worktree>`
  with the seven harness files plus `coaching-completion, coaching-runtime, coaching-followups,
  platform, fix-ledger, finance-completion, bookings-completion, accounts-self-service,
  governance-locks`: `runtimeAccess: verified` (53 migrations, 52 system tables, 37 scoped tables,
  14 helpers), 16 files, 137 tests, 137 pass, `PG_SELECTED_FAILED_FILES=0`.
- Trial merge with `hard/isolation` (`1d3203f`) in a throwaway worktree, removed afterwards:
  the only conflict was `apps/api/src/membership-exit.ts`, between `hard/isolation` and
  `integrate/round2`'s `54e575f` (not this branch; `hard/isolation`'s side was taken for the
  trial). On the merged tree, PGlite: `e2e-harness-takeover-notice, booking-refund,
  booking-dispute, member-dates, payout-precondition`: 14 tests, 14 pass; pg-sandbox with the
  same five files: `runtimeAccess: verified` (54 migrations, both 061 and 062), 14 tests, 14 pass
  as the restricted role, so the thread route works under the isolation scope rule and the two
  migrations apply together.
- Full harness, `node scripts/e2e/run.mjs --skip-build --pg-port=56118 --features=<inventory>`
  (web build from stage 2; no web source changed in this stage):
  - development run `2026-09-27T23-23-23-656Z` (with `--min-steps=0`): 398 steps, 397 pass, 1 fail. The
    new discount assertion failed (`23920 !== 29900`): the Stripe double reported
    `amount_subtotal` after the discount. Fixed in the double (and its unit test). The failed
    checkout left that follower unpaid, which exposed another silent drop: the extended suite
    could not schedule its follow-up and logged only a note, so "Scheduled follow-up messages from
    the trainer" was not exercised and the run still counted as complete. Scheduling now goes
    through `reporter.prepare()` and the delivery step through `blocked()`. The five
    provider-loss recovery steps and the payout steps passed in this run.
  - **final run A `2026-09-27T23-35-07-873Z`** on `356b8c2`: 399 steps, 399 pass, 0 fail,
    0 skipped, 536 s, exit 0 with the default minimum of 399 steps.
  - **final run B `2026-09-27T23-44-32-198Z`**, same commit: 399 steps, 399 pass, 0 fail,
    0 skipped, 542 s, exit 0.
  - `node scripts/e2e/coverage-table.mjs <A> <B> --out=docs/features/e2e-harness-coverage.md`:
    exit 0; no step differs in status between the runs and none varies by more than 3x in
    duration. Inventory: 340 features, 297 exercised by their own steps and 43 through an
    identical flow of another audience, 0 not exercised, 0 failing; 187 provider-dependent
    features, none without a scenario or stated limit.
  - Both final runs: 80 Stripe webhook deliveries, all HTTP 200 (74 in stage 2; the recovery
    suite adds six, four of them the late redeliveries); 0 automatic step-ups; one request-budget
    wait (54 s and 56 s). Mock requests in run A: Stripe 80, email 74, Lean 4, model 109, push 1,
    WHOOP 8, Zepp 4, voice 1, registrar 3, Open Food Facts 2, Google 8, Apple 5, S3 3, DNS 12;
    model answers rules 104, queue 4 (unchanged, so the AI review below still applies).
- Not run: the whole `npm test` suite (the coordinator's gate), `next build`, the model replay
  run (no prompt or model path changed in this stage), live providers, any deployment.

## Stage 2 (2026-09-27): every provider-dependent feature covered, two runs compared

### Base

The branch now contains `integrate/round2` (merged at `54e575f`, merge commit `f380839`), so the
harness runs against the round-two packages (governance, account self-service, joining and
complimentary access, messaging policy, discovery, HealthKit sync, host operations). Conflicts were
three import lists (layout stylesheets, worker imports, provider exports). Before any new scenario,
the unchanged stage-1 harness passed 356 of 356 on the merged code (run `2026-09-27T21-21-25-151Z`).

### Sandbox additions (production code, honoured only in the loopback sandbox)

- `packages/providers/src/sandbox.ts`: `GOOGLE_OIDC_ISSUER` and `APPLE_OIDC_ISSUER` join the
  HTTPS-loopback endpoint overrides; `DOMAIN_DNS_SERVER` (exactly `127.0.0.1:<port>`) binds
  `sandboxResolver()`. Startup refuses all three outside the sandbox or in any other form.
- `packages/providers/src/oidc.ts`: `oidcIssuer()`/accepted issuers use the sandbox issuer when set.
- `apps/api/src/integrations-completion.ts`: the ownership TXT and target CNAME lookups use the
  sandbox resolver when it exists, otherwise the system resolver as before.
- `packages/providers/src/configuration.ts` (`validatePublicEndpoint`): in the sandbox only, a name
  the DNS double answers with 127.0.0.0/8 addresses is accepted, so the activation's HTTPS check
  reaches the local edge. Every other answer keeps the public-address rule.
- `apps/api/src/host-operations.ts`: the platform-address check uses the sandbox resolver when set.
- The readiness finding, the sandbox notice and the red workspace banner name sign-in and DNS too.

### New doubles and harness parts (tests only)

- `tests/e2e/mocks/dns.ts` (UDP DNS: A, TXT, CNAME, CNAME chasing, NXDOMAIN; the registrar double
  publishes what the operator saves there), `oidc.ts` (Google RS256 and Apple ES256 issuers that
  check client credentials, the redirect address, PKCE and single use of codes), `s3.ts` (Signature
  Version 4 and payload hash checks for off-server backups).
- Runner edge on `127.77.0.1:443` for coach domains with a TLS "ask" to the API before a
  certificate is presented (Caddy on-demand TLS); coach-domain clients connect there with the
  coach's name as SNI and Host.
- `tests/e2e/harness/host_controller.py`: one cycle of the real controller (`hostops.py`) with only
  the host primitives simulated. Backups are real `pg_dump` archives of the throwaway database,
  encrypted by the controller, copied to the S3 double and restored into a scratch database.
- `tests/e2e/scenarios/browser.e2e.ts`: local headless Chromium (`/opt/pw-browsers`, never a cloud
  browser); the throwaway leaf is trusted by SPKI pin so the service worker registers.
- `Client.ok()` proves a fresh authenticator code once when the server answers `MFA_STEP_UP`
  (round two requires one within ten minutes for every operator route); the report counts these
  (`automaticStepUps`, 0 in the final runs because sessions step up before operator suites).
- `tests/e2e/harness/report.ts`: `LOCAL_LIMITS` (every feature the sandbox covers only in part,
  with the reason), a per-feature `inventory.table` and `providerDependentUnaccounted` (must be
  empty); `scripts/e2e/coverage-table.mjs` renders the table and compares runs.

### New scenarios, per audience

**Super admin** (`operator-completion.e2e.ts`, `domains.e2e.ts`, `browser.e2e.ts`): executive
metrics and CSV (no formula cells); suspension of `omar-conditioning` with a team notice (owner
423 and notice, members keep billing, public page closed, owner email), the finance follow-up
raising an operator alert that is acknowledged and resolved, reinstatement; account lock (sessions
end, `ACCOUNT_LOCKED` after the password) and unlock; on-demand backup with off-server copy and a
verified signed report, restore check into a scratch database that is dropped afterwards; signed
pause/resume deploy actions executed by the controller, a refused `resize_server`, a forged report
shown as unverified; the platform-address check (valid name, coach-domain clash, bad format, no
DNS); domain activation with the wrong target refused and the right one accepted; the settings
page in the browser; a card dispute on a paid coaching session (see the defect below).

**Trainers**: the Brain workspace in the browser (Knowledge, Constitution and Readiness tabs);
invitation emails, the invitation list with cancel and resend, join alerts, complimentary access
granted and ended with a fresh code, removal of a follower with a reason, the directory listing,
HealthKit activity of a member, leads in business analytics.

**Followers**: sign-in at the trainer's own address; training access that opens right after the
checkout webhook; complimentary access without any Stripe call; display-name change and a
confirmed email move (old address notified, old address no longer signs in); operator-issued
one-time recovery link; leaving a trainer (renewal stopped in Stripe, `MEMBERSHIP_ENDED` at the
next sign-in) and being removed (`REMOVED_BY_TRAINER` on public re-join); HealthKit companion
pairing, sample upload with an idempotent retry and unpairing; the Today screen, offline set
logging with an offline reload served by the service worker, and an offline food-diary entry that
reaches the diary after reconnecting.

**Public and joining**: DNS ownership check (missing TXT refused, published TXT verified), on-demand
certificate refused before activation and for unknown names, the coach website on its own domain
(home, about, join; `/admin`, `/trainer/brain`, `/signup` answer 403, another coach's site is not
served), robots.txt and sitemaps on the platform and the coach domain, the coach directory with
filters, Google (link, then sign-in on a new device, callback in another browser refused) and
Apple (join with terms, form_post return), invitation email join, conversion milestones (a
consenting trainer's sign-up, launch and first payment; a consenting visitor's join), website
contact messages counted as leads, analytics consent in the personal export and expired after the
180-day window.

### Harness defects found and fixed in this stage

1. `next start --hostname 127.0.0.1`: Next normalises 127.0.0.1 to localhost in `request.nextUrl`
   but not in its base URL, so the coach-domain rewrite in `apps/web/proxy.ts` was proxied as an
   external URL (HTTP 500, `EPROTO`). The runner now starts Next on `localhost`; production uses
   `0.0.0.0` (`apps/web/package.json`), which Next leaves unchanged, and this run confirms the
   rewrite stays internal when the host names agree.
2. Operator routes require a fresh code every ten minutes after round two; the client steps up
   when the server asks instead of failing long suites.
3. A new paid session collided with the follower suite's booking time (`SLOT_OVERLAP`, depending
   on the hour the run started); it now books six days ahead at half past the hour.
4. The browser suite used Playwright's expected Chromium build, which is not installed; it now uses
   the local build under `PLAYWRIGHT_BROWSERS_PATH` (or `E2E_CHROMIUM`), and skips with a reason
   when none exists. Offline steps skip with a reason when their prerequisites (an assigned program,
   a delivered meal plan) were not produced because the follower suite was not selected.

### Application defect found and fixed in this stage

5. **Card disputes on paid coaching sessions failed the Stripe webhook.**
   `apps/api/src/stripe-events.ts:504-508` (dispute branch of `processStripeEvent`) looked for the disputed charge only among subscription
   invoice journals, so `charge.dispute.created`/`closed` for a session charge threw "Disputed
   charge has not been reconciled" (HTTP 500; Stripe retries for days) and no dispute reserve was
   posted, leaving the disputed money payable to the trainer. The lookup now also finds the
   `booking-charge:` journal by the dispute's payment intent and posts the same reserve, release and
   loss journals as a membership dispute. Repro before the fix: `node --import tsx --test
   tests/e2e-harness-booking-dispute.test.ts` failed 0/2 with that message; after the fix 2/2, and
   the harness step "Reconciliation exceptions — a dispute on a paid coaching session" passes with
   both webhooks at HTTP 200.

### Findings still open (reported, not fixed)

- **Free-trial members are stored as `active`** (`apps/api/src/stripe-events.ts`, `invoice.paid`
  for the $0 trial invoice replaces `trialing`). Seen again: Omar's four seeded trial members show
  `active, 0 AED minor`, so the new executive metrics count them as active (the final runs report
  `memberships active 17 / trialing 1`). Needs the subscription status to follow Stripe's
  `trialing` state.
- **Setup checklist after launch** still shows "Complete subscriber preview" open (22 steps, 21
  complete) for a launched trainer.
- **Nutrition document import keeps personal identifiers** (`POST /api/v1/nutrition/documents`;
  the run records `stored text keeps the email address: true`).
- **Template `{{date}}`** is the recipient's local date when sent, as documented in
  `docs/features/messaging.md`; `{{coach}}` now renders the workspace name (the stage-1 "Your
  coach" finding is fixed by round two). A published `workout-reminder` template therefore has no
  way to name the planned session date that the built-in text includes
  (`apps/api/src/notifications.ts:203`). Product decision: add a session-date variable or keep the
  built-in date line.
- **Held-out Brain scenarios** and **meal-photo estimates with no items**: unchanged from stage 1.
- [Resolved in stage 3: renumbered to 062.] **Migration number shared**: this branch's
  `061_tenant_member_join_date.sql` and `hard/isolation`'s `061_tenant_scope_isolation.sql` both
  started with 061.

### What the sandbox still cannot do (explicit limits, also in the report)

Real Apple/Google consent screens and key rotation; the live Caddy configuration and ACME
issuance (the API side of on-demand TLS is exercised); Docker/systemd host primitives, the daily
backup timer, restart/rollback/re-apply and DigitalOcean server backups; moving the platform
address (host work); the operating system's install prompt; the native HealthKit companion app
(the harness plays its API client); the worker's hourly analytics purge (the expiry itself is
exercised). Each is listed in `LOCAL_LIMITS` and appears as the "Local limit" note in the table.

## Stage 1 plan (written before implementation)

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

## Stage 1: what was built, per audience

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

## Stage 1: defects found by the harness and fixed (small, clearly bugs)

1. Trainer analytics (`GET /api/v1/analytics/business`, retention cohorts) and the Superadmin
   subscriber list (`GET /api/v1/admin/operations/subscribers`) returned HTTP 500 (`42501 permission
   denied for table users`) as the restricted runtime role: both read `users.created_at`, but the
   tenant role `trainer_app` could select only `users(id,name,email)`. Migration
   `062_tenant_member_join_date.sql` (named `061_…` until stage 3) grants `SELECT(created_at)` on `users` to `trainer_app` only;
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
   is now read through the `member_takeover_active()` definer helper in the member's own scope
   (stage 3; stage 1 used a staff view limited to that member, which the review rejected). The
   member still cannot read the takeover record itself. Regression:
   `tests/e2e-harness-takeover-notice.test.ts` (it fails on PGlite without the fix).

## Stage 1: findings reported, not fixed (status after stage 2 in brackets)

1. [Fixed in stage 2, defect 5.] **Disputes on paid-session charges fail the webhook.** `charge.dispute.created`/`closed` for a
   booking charge throws "Disputed charge has not been reconciled" (HTTP 500, Stripe retries) and no
   dispute reserve is posted: the dispute path only looks for subscription invoice journals.
   Confirmed with a throwaway probe against `processStripeEvent` (not committed); the harness
   exercises disputes only on membership charges. Needs a booking dispute journal design.
2. [Still open.] **Free-trial members are stored as `active`.** The $0 trial invoice's `invoice.paid` sets the
   subscription status to `active`, replacing `trialing` from `customer.subscription.created`
   (`apps/api/src/stripe-events.ts`). Access is the same, but screens and metrics cannot tell trial
   members from paying ones (Omar's four trial members show `active, 0 AED`).
3. [Still open.] **Nutrition document import has no personal-identifier review.** Brain document imports flag
   emails, phone numbers and client references and refuse approval until they are redacted;
   `POST /api/v1/nutrition/documents` stores the extracted text as teaching material as is (the run
   records `stored text keeps the email address: true`).
4. [`{{coach}}` fixed by round two; `{{date}}` is documented as the send date, see stage 2.] **Notification template variables.** When a Superadmin publishes a template for a key, `{{coach}}`
   renders the literal "Your coach" and `{{date}}` the sending date (`notifyUser` in
   `apps/api/src/notifications.ts`), so a published `workout-reminder` template replaces "Your next
   training day … planned for <session date>" with the send date and no coach name (seen in the run:
   "Hi Yousef Aziz, your session with Your coach is on 2026-09-27").
5. [Still open.] **Setup checklist after launch.** Later changes make the reviewed subscriber preview stale, so a
   live workspace's checklist shows "Complete subscriber preview" as an open gate (22 steps, 21
   complete in the run). Harmless, but confusing for a launched trainer.
6. [Still open.] **Held-out Brain scenarios are not checked for overlap with the teaching.** The harness's 20
   "held-out" prompts restate confirmed rule directives almost verbatim and the evaluation accepts
   them; a near-duplicate check against sources and rules would make "held-out" meaningful.
7. [Still open.] **A meal-photo estimate must contain at least one item.** An honest "nothing identifiable in
   this photo" answer has to invent a placeholder item (see the AI review below).
8. [Resolved in stage 2: DNS and on-demand TLS are simulated.] **Custom domains:** DNS TXT/CNAME verification and live TLS activation are not simulated; the
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

## Stage 1 coverage

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

## Stage 1 tests actually run (2026-09-27, Node 24)

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
  - replay run `2026-09-27T21-07-51-227Z` with `--model-replay=tests/e2e/reviewed/model-answers.jsonl`:
    356 steps, 356 pass, 462 s, 2 answers replayed from the reviewed file.
  - Earlier runs in this package found the four defects above (first full run: 268 steps, 261 pass,
    7 fail: analytics 42501, operator subscriber list 42501, payout preparation 500 and four harness
    ordering/selection issues; the takeover notice failed in the extended suite before its fix).

## Stage 2 tests actually run (2026-09-27, Node 24, worktree `feat/e2e-harness`)

- `npx tsc --noEmit`: exit 0 (after the last code change).
- PGlite, `node --import tsx --test --test-concurrency=1` with `e2e-harness-sandbox`,
  `e2e-harness-mocks`, `e2e-harness-booking-refund`, `e2e-harness-booking-dispute`,
  `e2e-harness-payout-precondition`, `e2e-harness-takeover-notice`, `e2e-harness-member-dates`,
  `accounts-oidc`, `infra-ops-api`, `infra-ops-tls`, `integrations-completion`, `fix-ledger`,
  `finance-completion`, `bookings-completion`, `provider-configuration`: 15 files, 107 tests, 107
  pass. The harness unit tests alone: 16/16 (7 new: issuer and DNS overrides refused outside the
  sandbox, the DNS, OIDC and S3 doubles against the real resolver, the app's OIDC client and a
  Signature Version 4 client).
- `tests/e2e-harness-booking-dispute.test.ts` before the fix: 0/2 ("Disputed charge has not been
  reconciled"); after: 2/2.
- pg-sandbox (restricted runtime role, port 56118): `/opt/tools/pg-sandbox.sh 56118 <worktree>` with
  the seven harness files plus `finance-completion` and `bookings-completion`:
  `runtimeAccess: verified` (53 migrations, 52 system tables, 37 scoped tables, 13 helpers), 9
  files, 50 tests, 50 pass, `PG_SELECTED_FAILED_FILES=0`.
- `npm run build -w @trainer/web` (after the banner copy change): exit 0.
- Full harness, `node scripts/e2e/run.mjs --pg-port=56118 --features=<inventory> --skip-build`:
  - on the merged base before new scenarios, `2026-09-27T21-21-25-151Z`: 356/356.
  - development runs (not counted as final): 388 steps with 4 failures (all harness assertions,
    fixed), 388 pass + 5 skipped (Chromium build missing), 393 pass + 1 failure (slot overlap,
    fixed); partial runs of the domain, follower and browser suites while writing them.
  - **final run A `2026-09-27T22-22-29-152Z`** on commit `7debb77`: 394 steps, 394 pass, 0 fail,
    0 skipped, 546 s.
  - **final run B `2026-09-27T22-31-36-627Z`**, same commit, started right after A: 394 steps,
    394 pass, 0 fail, 0 skipped, 537 s.
  - Flakiness: `node scripts/e2e/coverage-table.mjs <A> <B>`: every step has the same status in
    both runs; no step's duration differs by more than 3x over 5 s. Inventory: 340 features, 297
    exercised by their own steps and 43 by an identical flow of another audience, 0 not exercised,
    0 failing; 187 provider-dependent features, none without a scenario or a stated local limit.
  - Both final runs: every Stripe webhook HTTP 200 (74 deliveries), 0 automatic step-ups, one
    request-budget wait (54 s); mock requests Stripe 69, email 70, Lean 4, model 109, push 1,
    WHOOP 8, Zepp 4, voice 1, registrar 3, Open Food Facts 2, Google 8, Apple 5, S3 3, DNS 12;
    model answers rules 104, queue 4.
  - replay run `2026-09-27T22-40-56-414Z` (same commit) with
    `--model-replay=tests/e2e/reviewed/model-answers.jsonl`: 394 steps, 394 pass, 548 s; model
    answers rules 102, replay 2, queue 4. The two reviewed answers (digital-coach squat question,
    meal-photo estimate) still match their request hashes after round two, so the prompts the app
    sends for them did not change; the member's photo estimate shows the reviewed "Unidentified
    food" answer and still needs the member's confirmation. The model call mix is unchanged from
    stage 1 (109 requests), so the stage-1 AI review below still describes the traffic.
- Not run: the whole `npm test` suite (the coordinator's gate), live providers of any kind, any
  deployment.
