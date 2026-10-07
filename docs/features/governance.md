# Super admin governance: suspension, locks, metrics, alerts

Branch `feat/governance` (based on `6fa8aba`). Migration `056_governance.sql`.
No deployment, provider call or live action was made. All test data is synthetic.

## Plan (written before implementation)

1. Suspension as a new lifecycle value so every existing `lifecycle_state='active'`
   check takes the workspace offline (fail closed), with sessions kept so members
   and staff see a clear status, worker skip, payout holds, a finance follow-up,
   audit and an owner notification; reinstatement reverses it.
2. Account locks enforced by one shared sign-in check inside both session
   creators, a database backstop on `sessions`, and a session-resolution check.
3. Read-only executive metrics per workspace from the ledger and related tables,
   monthly series and CSV.
4. An alert engine in the worker with de-duplication, fingerprints,
   acknowledge/resolve, auto-resolution, scoped delivery and a pluggable hook.
5. A central fresh-authenticator guard for every operator route, plus a route
   inventory test.

## What was built

### Super admin
- **Workspaces and accounts** screen at `/admin/governance`
  (`apps/web/components/workspace-governance.tsx`): search/filter workspaces by
  state, suspend (reason + optional team notice) or reinstate with a reason; find
  an account by exact email, lock or unlock it with a reason, see lock history and
  currently locked accounts. Support operators can view workspaces (read-only).
  Since 7 October 2026 (owner request) a Super admin can also confirm another
  account's unconfirmed email address with a reason (`POST /api/v1/admin/governance/accounts/:userId/verify-email`,
  fresh authenticator, audited as `account.email_verified_by_operator`, account notice to the person); it is
  meant for test accounts while email delivery is off.
- **Business metrics** at `/admin/metrics` (`business-metrics.tsx`), also for
  finance operators: KPI tiles, active memberships by tier, monthly series table,
  payout status, definitions, CSV download.
- **Operator alerts** at `/admin/alerts` (`platform-alerts.tsx`), for every
  operator role within its scope: status tabs, severity with text label,
  acknowledge (optional note), resolve (required note), "Run checks now" for Super
  admins. Links from the admin overview (`governance-shared.tsx`).

### Trainers (owner, staff, finance members)
- A suspended workspace answers `423 WORKSPACE_SUSPENDED` (clear message) and the
  web app shows `workspace-suspended.tsx`: the workspace name, the platform
  message, the operator's team notice (team roles only), recent notifications
  (the owner receives an in-app `account` notification, also queued for
  email/push through the existing channels), other workspaces to switch to,
  personal data download and sign-out. Reinstatement notifies the owner again.
- Payouts: `ready` instructions move to the existing `held` state; preparing or
  executing a payout returns `409 PAYOUT_HELD` while the workspace is not active.
  Billing is not cancelled. A `reconciliation` follow-up is opened in the
  workspace for platform finance (billing review, held and in-flight payouts).
- The suspension notice is in-app plus the critical email only (no device push,
  which could only be delivered after reinstatement). Reinstatement closes any
  still-pending email or push job for that notice
  (`last_error='Superseded by workspace reinstatement'`) so it is never sent late.

### Followers (subscribers)
- Billing continues during a suspension, so the member's own money and privacy
  routes stay open: `GET /membership/billing` (now also returns the member's
  `membership` renewal state), `POST /membership/cancel` (stop renewal),
  `POST /membership/renewal/reconcile`, `POST /refund-requests` (the existing
  7-day eligibility rule applies), `POST /privacy/delete-request` and
  `POST /privacy/consent` for withdrawals only (a new grant returns
  `423 WORKSPACE_SUSPENDED`). Restarting renewal (`/membership/reactivate`) and
  the trainer's refund decision stay refused until reinstatement. A coaching
  consent withdrawal uses `lockSuspendedMember` (same training lock, confirms the
  membership and that the workspace is suspended) because the existing
  `training_actor_is_current` helper answers only for active workspaces.
- The suspended screen tells a follower that coaching with the coach is
  paused ("Coaching with <coach> is paused", about the coach's coaching
  workspace, never "<name> is suspended"), with Check again and Sign out
  first, other coaches as buttons and a real support link (`mailto:` the
  `SUPPORT_EMAIL` from `/workspace/status`, else the platform's About page).
  Its **Membership and payments** section (`suspended-member-billing.tsx`)
  shows the price and renewal date, **Cancel membership renewal**, **Check
  renewal status** for a pending change, a refund request form for eligible
  charges and their refund requests in plain words; renewal and refund text
  appears only with a live membership (otherwise "You have no paid
  membership with <coach>, so nothing is charged while coaching is
  paused"). **Download my data** is a secondary button and **Request account
  deletion** a quiet link that confirms in a bottom sheet. Trainers and team
  members keep the workspace wording and the data download
  (docs/features/phone-first.md).
- Payment and refund confirmation emails for paid sessions (Stripe webhooks keep
  arriving) are marked `transactional` and are still sent while suspended.
- The suspended screen with a generic message (no operator notice). The public
  trainer page, coach website/custom-domain pages and public join return
  not-found/unavailable; invitations to a suspended workspace are invalid.
- Offline workout/meal entries receiving `423` are kept for retry, never rejected
  (`offline-queue.ts`).
- A locked account gets `423 ACCOUNT_LOCKED` ("This account is locked by the
  platform team…") only after its credentials are proven.

## Behaviour details

### Suspension (`apps/api/src/governance.ts`, `workspace-state.ts`)
- `tenants.lifecycle_state` now allows `active | suspended | closed`. All existing
  `='active'` checks (public pages, joins, invitations, checkout, team, scoped
  helper functions, schedulers, queue metrics) treat it as offline without edits.
- Sessions: resolution accepts `suspended` and flags the identity; the request
  gate allows only `/auth/*`, `/public/*`, webhooks, health, `GET /workspace/status`,
  `GET /notifications`, `POST /notifications/:id/read`, `GET /privacy/export`,
  `GET /privacy/status`, `POST /invitations/accept`, and the member billing and
  privacy routes listed under Followers. The gate decides from the matched route
  pattern (`req.routeOptions.url`) when the request was routed, so an encoded
  spelling (`/api/v1/workspace/%73tatus`) gets the same answer as the plain path;
  anything unlisted fails closed. Platform operators are exempt from the gate on
  `/api/v1/admin/*` routes only (raw or routed): those routes are scoped by their
  own parameters and keep their role and fresh-authenticator checks, so an
  operator who follows or staffs a suspended trainer keeps operator access.
  Password, magic-link, passkey and recovery sign-in prefer an active workspace
  and fall back to a suspended one. `/auth/workspaces` lists suspended workspaces
  with `state`.
- Custom domains of a suspended workspace keep resolving (host routing accepts
  `suspended`) so signed-in members see the notice; its public pages still refuse.
- Refused: non-Super-admin (`OPERATOR_SCOPE`), stale code (`MFA_STEP_UP`), a
  platform administration workspace (`PLATFORM_WORKSPACE`), non-active state. A
  platform administration workspace is one whose **owner** holds a platform role
  (`platformWorkspaceSql` in `workspace-state.ts`, shared with business metrics,
  the governance list and alert delivery). Operators who merely follow or staff a
  trainer no longer block that trainer's suspension.
- Serialized with the workspace lock (the same lock payout preparation and
  dispatch take). Audit: `admin_operations_audit` `workspace.suspended` /
  `workspace.reinstated` plus workspace events and `payout.held` / `payout.ready`.
- Worker (`apps/worker/src/tenant-cycle.ts`, extracted from `index.ts`): a
  suspended workspace runs no nutrition, finance automation, reminders,
  lifecycle/retention messages or coaching follow-ups, and claims only
  `email` jobs in the `account`/`safety` categories or marked `transactional`
  (paid-session payment and refund confirmations, set by `finance-bookings.ts`
  through `notifyUser({ transactional: true })`). Push jobs wait (push delivery
  requires an active workspace); queued booking and workout reminders are
  re-validated at dispatch and dropped when their session or date has passed.
  Wearable sync already skips non-active workspaces (revocations still run).
  Chat attachment expiry continues.
- Reinstatement releases only the payouts that suspension held and that are still
  `held`; the finance follow-up stays open until finance resolves it with evidence.
- Closure or ownership transfer of a suspended workspace requires reinstatement
  first (existing lifecycle routes require `active`).

### Account locks (`account-governance.ts`, `governance.ts`)
- `assertSignInAllowed(tx, userId)` runs in `session()` (password login,
  registration, public join, invitation acceptance, workspace switch) and
  `insertAccountSession()` (magic link, passkey, recovery code); public join and
  invitation acceptance with an existing account check it after the password and
  authenticator are verified and before any membership is written. Trigger
  `sessions_account_unlocked` raises SQLSTATE `TBLCK` for any other insert (mapped to
  `423 ACCOUNT_LOCKED`). Session resolution also excludes locked accounts.
- Lock deletes every session (push subscriptions cascade), consumes outstanding
  magic/reset/verify links and passkey challenges; magic-link requests for a
  locked account are silently not sent. Password reset is not a sign-in and is not
  blocked; the account still cannot sign in afterwards.
- Refuses `SELF_LOCK`, `ACCOUNT_ALREADY_LOCKED`, and `LAST_SUPERADMIN` (counted
  under the platform administrator lock).
- Host CLI (`operator-actions.ts`, used by `scripts/operator.ts` and
  `scripts/reset-mfa.ts`): a locked Super admin cannot assign platform roles or
  reset an authenticator. The last-admin rule counts only unlocked Super admins,
  so the last active one cannot be demoted while another is locked; the
  no-admin recovery path opens when every Super admin is locked, and a locked
  account cannot recover the role for itself. Because the actor must be an unlocked
  Super admin other than the target, the last-admin refusal is a defensive
  invariant; the tests prove one active Super admin always remains.
- Lock and unlock are revisioned; history rows can only move `active → lifted`
  (trigger `governance_history_guard`); audited as `account.locked`/`account.unlocked`.

### Executive metrics (`business-metrics.ts`)
- `GET /api/v1/admin/metrics?months=1..36` and `/api/v1/admin/metrics.csv`,
  Super admin and finance operators only, audited (`metrics.read`,
  `metrics.exported`). One scoped read transaction per workspace; platform
  administration workspaces (owner is an operator) are excluded.
- Snapshot: trainers (total/active/published/suspended/closed), distinct followers,
  memberships by tier and status, pending cancellations, MRR (active + past-due
  last invoiced amount, trials excluded), payouts by status.
- Monthly (Asia/Dubai): gross takings (subscription invoices + paid sessions),
  refunds and refund rate, net commission and take rate, cost recovery, platform
  revenue, paying and new paying memberships, cancellations and churn (canceled ÷
  prior month's paying memberships; only a member who had a positive subscription
  charge before the cancellation counts, and trials or other memberships canceled
  before any charge are reported separately as `unpaidCancellations`, also in the
  CSV and the web table), trials started/converted, AI and voice cost in
  USD converted at the 3.6725 AED peg, unpriced requests, cost-to-revenue, payouts
  paid/returned. Zero data yields zeros and `null` rates. CSV neutralizes formulas.

### Operator alerts (`platform-alerts.ts`)
- Tables `platform_alerts` (one unresolved alert per dedupe key) and
  `platform_alert_deliveries` (append-only).
- Built-in rules: `infrastructure.threshold` (observer recommendations),
  `safety.escalation_waiting` (open safety exceptions older than
  `PLATFORM_ALERT_SAFETY_WAIT_MINUTES`, default 240; critical after 24 h or 4×),
  `jobs.failed` (failed jobs and blocked finance jobs, 7 days), 
  `finance.reconciliation_open`, `email.delivery_uncertain`,
  `finance.payout_failure` (failed/returned/unknown, 30 days). Alert text carries
  counts, ages and the workspace name only, never record content.
- Engine: condition fingerprints; changes update the alert (no re-notification);
  severity escalation re-opens and re-notifies; operator resolution holds while
  the fingerprint is unchanged; alerts whose condition clears auto-resolve; a rule
  that throws leaves its alerts untouched.
- Hook: `registerPlatformAlertRule({ id, description, evaluate })` (e.g. a future
  `backups.stale`), `raisePlatformAlert(db, rule, candidate)` and
  `clearPlatformAlert(db, dedupeKey)` for event-driven alerts.
- Delivery: open alerts go to every unlocked operator whose role is in scope
  (Super admins always) as an `account` notification in an active platform
  administration workspace the operator **owns** (most recently used first;
  `href /admin/alerts`); email only when email is configured and severity is
  warning/critical; push for critical when push is configured. An operator with
  no such workspace (for example one whose only membership is a follower or staff
  seat in a trainer's workspace) gets a `no_workspace` delivery record and sees
  the alert in the operator inbox; nothing is written into that trainer's
  workspace, whose owner could otherwise read it.
  Each (alert, operator, severity) is delivered once. Worker evaluates every 60 s.
- API: `GET /api/v1/admin/alerts?status=active|open|acknowledged|resolved`,
  `POST /api/v1/admin/alerts/:id/acknowledge|resolve` (revision, note),
  `POST /api/v1/admin/alerts/evaluate` (Super admin). Audited.

### Fresh-authenticator coverage (`operator-step-up.ts`)
- Audit result: 96 operator routes (27 reads, 69 state-changing). Gaps found and
  closed: finance controls reads (`/admin/tenants/:id/finance/controls`,
  `/statements/:period`) had no authenticator check at all; finance controls
  writes, finance automation, `/admin/overview` and `/payout-runs/:id/execute`
  enforced it only in production.
- A central guard in the request hook requires an authenticator code verified
  within 10 minutes for every `/api/v1/admin/*` request and
  `/api/v1/payout-runs/:id/execute` by a platform operator, in every environment,
  before any handler or body validation. Module checks were also forced.
  `trackOperatorRoutes()` records every operator route; the test fails for any new
  unguarded route.
- The guard decides from the raw path **and** the matched route pattern, so a
  percent-encoded spelling (`/api/v1/%61dmin/settings`) that the router decodes
  to an admin route is guarded too. The inventory test calls every route with its
  plain and encoded spelling.
- `STEP_UP_EXEMPT_ROUTES` lists revocation-only routes, matched by method and
  routed pattern: `POST /api/v1/admin/support-previews/:id/end`, restoring the
  existing policy that an operator can always stop their own member-data preview
  (grants last up to 15 minutes, the step-up window is 10). Reading a preview and
  starting a correction still need a fresh code.

## Routes added
`GET /api/v1/workspace/status`; `GET /api/v1/admin/governance/workspaces`,
`GET …/workspaces/:tenantId/history`, `POST …/workspaces/:tenantId/suspend|reinstate`,
`GET /api/v1/admin/governance/accounts[?email=]`,
`POST …/accounts/:userId/lock|unlock`; `GET /api/v1/admin/metrics`,
`GET /api/v1/admin/metrics.csv`; `GET /api/v1/admin/alerts`,
`POST /api/v1/admin/alerts/:id/acknowledge|resolve`, `POST /api/v1/admin/alerts/evaluate`.
Web: `/admin/governance`, `/admin/metrics`, `/admin/alerts`.

## Settings and flags
- `PLATFORM_ALERT_SAFETY_WAIT_MINUTES` (optional, 15–10080, default 240).
- `SUPPORT_EMAIL` (existing) is included in locked/suspended messages when set.
- Email/push delivery of alerts uses the existing `EMAIL_*` and push settings and
  stays in-app only while they are unconfigured.

## Migration 056_governance
Widens `tenants_lifecycle_state_check`; adds `workspace_suspensions`,
`account_locks` (history guard trigger), `sessions_account_unlocked` trigger,
`platform_alerts`, `platform_alert_deliveries`, and the scoped definer helper
`current_workspace_state()` (EXECUTE for `trainer_app` only). Runtime grants in
`infra/runtime-role.sql`; `scripts/verify-runtime-access.mjs` classifies the four
system tables and the helper.

## Tests actually run (first implementation)
- `node node_modules/typescript/bin/tsc --noEmit` — pass (exit 0, no errors).
- PGlite, `node --import tsx --test <file>`:
  `tests/governance-suspension.test.ts` 4/4, `tests/governance-locks.test.ts` 4/4,
  `tests/governance-step-up.test.ts` 4/4, `tests/governance-metrics.test.ts` 3/3,
  `tests/governance-alerts.test.ts` 3/3, `tests/governance-web.test.ts` 6/6.
- Restricted runtime role, `/opt/tools/pg-sandbox.sh 56113 <worktree> …`: 46
  migrations applied, `runtimeAccess: verified` (40 system tables, 33 scoped
  tables, 10 helpers). Run 1: the five API governance files, 18/18 pass. Run 2: all
  six governance files plus `fix-auth`, `account-completion`, `fix-payouts`,
  `finance-completion`, `fix2-finance`, `platform`, `fix-web`, `host-routing`,
  `notifications`, `push-notifications`: 150 tests, 149 pass, 1 skipped (existing
  skip in `fix-web`), `PG_SELECTED_FAILED_FILES=0`. Run 3 (after adding the coach
  website assertions): `governance-suspension` 4/4.
- Related existing suites on PGlite (`--test-concurrency=1`):
  batch 1 — `fix-auth`, `account-completion`, `admin-completion`,
  `finance-completion`, `fix-payouts`, `fix-ledger`, `platform`, `fix2-finance`,
  `infrastructure-actions`, `fix-settings`, `fix-keys`, `settings-runtime`,
  `acquisition`, `fix-web`, `team-completion`, `notifications`, `host-routing`,
  `privacy-lifecycle`, `bootstrap-admin`, `infrastructure-observer`,
  `support-preview`, `fix-db`: 208 tests, 208 pass.
  batch 2 — `fix-nutrition-ops`, `push-notifications`, `chat-attachments`,
  `coach-site`, `coaching-followups`, `finance-checkout`, `fix-edge`,
  `fix2-edge-deploy`, `integrations-completion`, `lifecycle-messages`,
  `privacy-media`, `retention`, `source-review-notifications`,
  `onboarding-completion`, `affiliates`, `bookings-completion`, `fix2-web`,
  `fix2-safety`: 131 tests, 130 pass, 1 skipped (existing PGlite-only skip).
- Not run: the full `npm test`, `npm run build`/`next build`, browser checks.

## Review round 1 (adversarial review fixes)
Findings fixed on this branch:
1. Followers of a suspended workspace can stop renewal, reconcile a renewal
   change, see billing, request a refund, request erasure and withdraw consent;
   the suspended screen offers these actions (major, requirement 1).
2. Only a workspace whose owner holds a platform role is a platform
   administration workspace; one definition is shared by suspension, the
   governance list, metrics and alert delivery. Operators keep `/api/v1/admin/*`
   access from a suspended workspace session (major, requirement 1).
3. Stopping a support preview is exempt from the step-up guard again, by routed
   pattern (major, requirement 5).
4. The step-up guard and the suspension gate decide from the matched route as
   well as the raw path; encoded admin paths are guarded (minor).
5. Host CLI honours account locks; the last-admin rule counts unlocked Super
   admins only (minor).
6. Alerts are stored only in a platform workspace the operator owns (minor).
7. Churn counts paid cancellations only; unpaid trial cancellations are reported
   separately (minor).
8. The suspension notice creates no push job, and reinstatement closes its
   pending jobs; payment/refund confirmation emails are sent while suspended
   (minor).

Tests added: `governance-suspension` (operator follower/staff does not block
suspension and keeps operator routes; suspended follower cancels renewal via an
injected fake Stripe client, reconciles, files a refund and an erasure request,
withdraws consent, cannot re-grant or reactivate; encoded paths; reinstatement
closes the notice email job; worker sends the transactional refund email and
leaves push and booking reminders pending), `governance-step-up` (plain and
encoded spelling of every operator route; exemption list; encoded
`/admin/settings`; stale support operator ends a preview through `buildApp` but
cannot read it or start a correction), `governance-locks` (host CLI with a locked
Super admin; last active admin; recovery when every admin is locked; a locked
account cannot recover itself), `governance-metrics` (canceled unpaid trial;
operator follower still counted as a trainer's follower), `governance-alerts`
(operator follower/staff get `no_workspace`, nothing written to the trainer's
workspace, alert visible in the inbox), `governance-web` (suspended billing
section states).

Checks run for this round (worktree, Node 24):
- `npx tsc --noEmit` — exit 0, no errors.
- PGlite `node --import tsx --test --test-concurrency=1` on the six governance
  files — 32 tests, 32 pass, 0 fail.
- PGlite related suites: `fix-auth`, `host-routing`, `platform`, `fix-web`,
  `finance-completion`, `admin-completion`, `infrastructure-actions`,
  `support-preview`, `fix-payouts`, `fix-ledger`, `bootstrap-admin`,
  `account-completion`, `notifications`, `push-notifications`,
  `privacy-lifecycle`, `bookings-completion`, `finance-checkout` — 177 tests, 177
  pass (a first run had 1 failure: an existing `fix-auth` assertion expects the
  last-admin message to contain "last one"; the message was kept compatible and
  the rerun passed). `fix-nutrition-ops`, `fix-settings`, `lifecycle-messages`,
  `coaching-followups`, `fix2-finance`, `privacy-media`, `team-completion`,
  `fix-keys`, `settings-runtime`, `fix2-web`, `onboarding-completion` — 60 tests,
  60 pass.
- Restricted runtime role, `/opt/tools/pg-sandbox.sh 56113 <worktree>` with the
  six governance files plus `support-preview`, `fix-payouts`,
  `account-completion`, `fix-auth`, `finance-completion`, `notifications`,
  `push-notifications`, `platform`, `host-routing`, `fix-web`,
  `bookings-completion`, `privacy-lifecycle`: `runtimeAccess: verified` (46
  migrations, 40 system tables, 33 scoped tables, 10 helpers); 18 files, 179
  tests, 178 pass, 1 skipped (existing skip in `fix-web`), 0 fail,
  `PG_SELECTED_FAILED_FILES=0`, exit 0.
- Mutation check: with the routed pattern disabled in `app.ts`, the encoded-path
  and preview-stop tests fail (2 of 2), and pass again with it restored.
- Not run: the full `npm test`, `npm run build`/`next build`, browser checks.

## Not done, and why
- No browser run: the local environment has no usable Chromium and cloud browsers
  are not allowed. The screens were typechecked and render-tested with
  `react-dom/server`; 390 px overflow is not browser-verified (layouts wrap, tables
  sit in scrollable regions). CI's browser journey remains the check.
- Metrics are computed on request (one scoped read per workspace); no cached
  snapshot table yet. Historic MRR is not reconstructable from stored data, so MRR
  is a current snapshot and the series shows collected takings.
- Passkey sign-in of a locked account was verified through the shared session
  creator it uses (`insertAccountSession`) and the database trigger, not with a
  signed WebAuthn assertion in these tests.
- No stale-backup rule is shipped: there is no backup evidence table yet; the hook
  is ready for it.
- An operator with no platform administration workspace of their own receives
  platform alerts in the operator inbox only, not by email: email jobs are
  tenant-scoped rows, and queuing one in a trainer's workspace would put alert
  text where that trainer's team can read it. A platform-level email queue would
  be needed.
- Jobs queued before a suspension other than the suspension notice (for example
  a coaching reply push) are delivered after reinstatement. Booking and workout
  reminders are re-validated at dispatch and dropped when stale; other messages
  remain accurate after reinstatement, so they were not expired.
- The suspended screen's billing section is render-tested only (no browser run).
