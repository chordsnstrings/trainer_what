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

### Followers (subscribers)
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
  `GET /privacy/status`, `POST /invitations/accept`. Password, magic-link, passkey
  and recovery sign-in prefer an active workspace and fall back to a suspended one.
  `/auth/workspaces` lists suspended workspaces with `state`.
- Custom domains of a suspended workspace keep resolving (host routing accepts
  `suspended`) so signed-in members see the notice; its public pages still refuse.
- Refused: non-Super-admin (`OPERATOR_SCOPE`), stale code (`MFA_STEP_UP`), a
  workspace holding a platform operator (`PLATFORM_WORKSPACE`), non-active state.
- Serialized with the workspace lock (the same lock payout preparation and
  dispatch take). Audit: `admin_operations_audit` `workspace.suspended` /
  `workspace.reinstated` plus workspace events and `payout.held` / `payout.ready`.
- Worker (`apps/worker/src/tenant-cycle.ts`, extracted from `index.ts`): a
  suspended workspace runs no nutrition, finance automation, reminders,
  lifecycle/retention messages or coaching follow-ups, and claims only
  `email` jobs in the `account`/`safety` categories. Wearable sync already skips
  non-active workspaces (revocations still run). Chat attachment expiry continues.
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
  under the platform administrator lock). Because the actor must be an unlocked
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
  prior month's paying memberships), trials started/converted, AI and voice cost in
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
  (Super admins always) as an `account` notification in their most recently used
  active workspace (`href /admin/alerts`); email only when email is configured
  and severity is warning/critical; push for critical when push is configured.
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

## Tests actually run (this branch)
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
