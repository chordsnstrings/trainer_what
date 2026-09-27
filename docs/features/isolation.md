# Database isolation redesign (work package `hard/isolation`)

Status: implemented on branch `hard/isolation` (migration 061). Test results are recorded
below exactly as run; remaining limits are listed at the end.

## Plan (written before implementation)

Sources read: `docs/APP_AUDIT_2026-09-25.md`, the recheck items `data-tenancy:G4`, `G5`,
`M1`, `M2`, `coaching:M1`, `nutrition:G7`, `packages/db/src/index.ts`,
`infra/runtime-role.sql`, `scripts/verify-runtime-access.mjs`, `/opt/tools/pg-sandbox.sh`,
`infra/digitalocean/host.py` (`runtime_role`), every RLS policy in migrations 001-060, and
the elevation sites listed in the inventory below.

Constraints that shape the design:

- No new login role or secret: the live controller only knows `trainer_service`'s password
  (`runtime.env`), and `host.py` is an installed copy that does not update itself. A second
  tenant login pool is therefore out of scope; the escape has to be closed without it.
- `infra/runtime-role.sql` and migrations run as `trainer_migrations` (the bootstrap
  superuser on the live host, in CI and in pg-sandbox; `postgres` in PGlite).
- The previous release keeps serving between `migrate` and the API restart, so migration
  061 must not remove privileges that the previous release's hot paths need to answer
  requests during that window without a clear, temporary error.

Design:

1. **Close the in-transaction escape (requirement 3).** Database side: revoke
   `pg_catalog.set_config` from PUBLIC and grant it to `trainer_service` only. Driver side:
   tenant-scoped statements use the extended query protocol (one statement per call).
   Wrapper side: tenant-scoped statements must be ordinary data statements; role, setting
   and transaction changes are rejected before they reach the database; service
   transactions may not hand-roll a scope. Mixed service-then-tenant work uses one helper,
   `tx.tenant(actor, fn)`.
2. **Verified actors and an explicit elevation allowlist (requirements 1-2).** The db
   package checks the actor's membership in the same transaction before `SET LOCAL ROLE`;
   service identities carry an allowlisted `elevation`; follower paths run as `subscriber`
   with narrow `SECURITY DEFINER` helpers or dedicated subscriber policies.
3. **Global/service tables (requirement 4).** Workspace-bound service transactions and
   row security on the tenant-carrying service tables.
4. **Verifier/CI** proves the new boundaries on PostgreSQL.
5. **Tests** `tests/isolation-*.test.ts`, then the whole suite on PGlite and on PostgreSQL.

## Inventory (base commit 3088123)

### Role and setting switches inside transactions

Hand-rolled scopes (`SET LOCAL ROLE trainer_app` + `set_config('app.*')`, sometimes followed
by `RESET ROLE` or a second `set_config`) in 22 application files: `account-completion`,
`affiliates`, `app` (register, enroll, change plan, admin overview), `bootstrap-admin`,
`coach-site`, `coaching-followups` (switched `app.user_id` mid-transaction),
`finance-bookings`, `finance-checkout`, `governance`, `integrations-completion`, `joining`,
`lifecycle-messages`, `membership-exit`, `notifications`, `oidc-sign-in`, `onboarding`,
`privacy-lifecycle`, `push-notifications`, `retention`, `security`, `support-preview`,
`team` (all under `apps/api/src`). Every one is now `db.system(...)` plus `tx.tenant(...)`
or a plain `db.tenant(...)`; `tests/isolation-elevation.test.ts` fails if application
source contains `SET ROLE`, `RESET ROLE`, `SESSION AUTHORIZATION` or a `set_config` of a
scope setting again.

### Elevations (an actor whose role is not its membership role)

At the base commit 26 files built actors such as `{ ...a, role: "owner" }` for a follower,
`{ ...a, role: "staff" }`, or `{ userId: "0000…", role: "owner" }`. Follower requests that
ran as owner/staff/finance:

| Former follower path | Ran as | Now |
| --- | --- | --- |
| Coaching chat and qualified automatic coaching (`coaching-completion`, `coaching-runtime`) | staff | subscriber; Brain material by name through `member_material()`, takeover through `member_takeover_active()`, review items written without read-back (`putPrivateRecord`), repeated personal-review questions through `member_policy_review_append()` |
| Notifications a follower triggers (`notifyUser`, `notifyCoachingTeam`) | owner | subscriber; `notification_recipient()`, `enqueue_notification()`, `notification_team()` |
| Membership exit preview/leave, rejoin check (`membership-exit`) | owner | subscriber; `membership_exit_blockers()`, `membership_exit_self_*` policies |
| Paid session reservation, booking fee (`booking-schedule`, `finance-bookings`) | owner/finance | subscriber; `booking_slot_taken()`, `booking_fee_policy()` |
| Checkout, promotions (`finance-checkout`, `finance-promotions`) | owner/finance | subscriber; `checkout_promotion()`; provider callbacks use `provider-callback` |
| Billing self-service (`finance-billing`) | finance | subscriber; `member_charges()`, `member_charge()` |
| Model and voice budgets (`model-accounting`, guided voice) | owner | subscriber; `model_usage_today()`, `voice_guidance_spent_today()`, `guided_voice()` |
| Nutrition, meal capture, leftovers, shopping (`nutrition*`, `meal-capture`) | owner | subscriber; catalog through `member_nutrition_foods/recipes/recipe_options/ingredients()`, confirmed nutrition material and purchase conversions through the subscriber policy |
| Wearables and HealthKit (`healthkit-sync`, `integrations-completion`) | owner | subscriber; `coach_wearable_policy()`; worker jobs use `worker` |
| Personal export (`privacy-lifecycle`) | owner | subscriber; `personal_export_records/followups/usage/audit()`, `export_personal_chat_media()` for self |
| Invitation acceptance (`joining`) | owner | the accepting member; `withdraw_accepted_invitation_emails()` |
| First-paid acquisition read (`acquisition`) | finance with the payer's id | `provider-callback` (system user) |

Service identities that remain elevated are listed with their purpose and every file that
uses them in `ELEVATIONS` (`packages/db/src/scope.ts`): `worker` (15 files),
`provider-callback` (4), `platform-operator` (14), `coach-workflow` (a staff/finance member
doing owner-reserved coaching work, 5) and `member-self-service` (a team member's own
export, 1). `tests/isolation-elevation.test.ts` fails when code uses an elevation that is
not listed, or from a file that is not listed, or when a listed file stops using it.

### Global (service) tables reached by runtime roles

`trainer_service` reads and writes the service tables `users`, `tenants`, `memberships`,
`sessions`, `one_time_tokens`, `user_security`, `provider_events`, `provider_objects`,
`domain_mappings` and the tenant-keyed service tables added later (`acquisition_consents`,
`acquisition_events`, `auth_passkey_challenges`, `complimentary_access_directory`,
`email_change_requests`, `oidc_sign_in_requests`, `privacy_erasure_registry`,
`support_preview_grants`, `tls_issuance_allowances`, `workspace_lifecycle_requests`,
`workspace_suspensions`), plus platform-only tables. `trainer_app` has no grant on any of
them except `users(id,name,email)`, `memberships` and `domain_mappings` (`SELECT`,
`UPDATE(active)`), all row-secured to the current workspace; it still had a grant on
`schema_migrations`, which nothing used.

## What changed

### Database (`packages/db/migrations/061_tenant_scope_isolation.sql`)

1. `set_config` is revoked from PUBLIC (and so from `trainer_app`) and granted to
   `trainer_service`. On a database that already has workspaces the revoke is deferred to
   `infra/tenant-scope.sql` (see Rollout), because releases before this one call
   `set_config` after `SET ROLE`.
2. Definer helpers (all `SECURITY DEFINER`, `search_path` pinned to `pg_catalog,public`,
   arguments validated against the fixed scope, `EXECUTE` revoked from PUBLIC and granted to
   `trainer_app` only, returning only the columns their callers use): the notification,
   exit, booking, checkout, billing, budget, guided voice, wearable policy, invitation,
   export, brand-erasure, nutrition catalog and coaching helpers named above, plus
   `workspace_member_role(uuid)` (a recipient's current role in the active workspace, for
   the outbox worker; a follower may ask only about itself). Each helper fails closed when
   a scope setting is unset (explicit `NULL` checks or `coalesce`).
3. Subscriber policies. `record_subscriber_scope` adds the follower's own billing intents
   and invoices, guided sessions and nutrition requests/favourites/leftovers/targets/open
   nutrition exceptions, and the material its bookings and nutrition plans are served from
   (booking policy, confirmed nutrition setup/policy/cases/sources/releases, active purchase
   conversions, the product of its own subscription). Internal coaching reviews
   (decisions, exceptions, takeovers), the coaching Brain (releases, actions, teaching,
   program templates) and held-out scenarios stay invisible, so the follower's
   `/bootstrap` and training listings do not show them. Also: a follower may not insert
   subscriptions and may change only `cancel_at_period_end` on its own
   (`subscription_member_insert`, `subscription_member_update_guard`); a follower may delete
   only its own records (`record_subscriber_delete`); a follower's own weekly nutrition job
   and its own usage rows are readable; `schema_migrations` is revoked from `trainer_app`.
4. Service tables: `service_workspace_scope` (RLS enabled and forced) on the 14
   tenant-keyed service tables above and on `tenants`; `membership_scope` and
   `domain_mapping_scope` gain the same service branch. `trainer_app` gets no row; a service
   transaction bound with `db.system(fn, { tenantId })` (sets `app.service_tenant_id`) sees
   and writes only that workspace; an unbound service transaction (a session lookup by token
   hash, a provider object by external id) is unchanged.
5. `balanced_journal()` (the deferred ledger balance trigger) is a trigger-only definer: a
   deferred trigger fires at `COMMIT` as the role that queued it, after the db package has
   left a nested scope and cleared its settings.

### db package (`packages/db/src/index.ts`, `packages/db/src/scope.ts`)

- `db.tenant(actor)` and `tx.tenant(actor)` look up the actor's membership in the same
  transaction before `SET LOCAL ROLE trainer_app`. A member acts with its own role (an
  owner may also act as staff, finance or subscriber); anyone else only as a subscriber of
  its own rows; an elevation must be allowlisted for that role and may never carry a
  follower's user id (`ACTOR_ROLE_MISMATCH` 403, `ELEVATION_NOT_ALLOWED`,
  `ELEVATION_SUBJECT`, `INVALID_ACTOR`).
- Scope settings (`app.tenant_id`, `app.user_id`, `app.role`, `app.elevation`,
  `app.privacy_erasure`) are set as the service role before `SET LOCAL ROLE`; the erasure
  flag is on only with the `{ privacyErasure: true }` option and is restored on leaving.
- Tenant statements go through `assertScopedSql` (one data statement; no `set_config`, no
  `SET`/`RESET`, no transaction control; savepoints only in a `db.tenant` transaction) and
  the extended query protocol. Service statements go through `assertServiceSql` (no
  hand-rolled scope, no reserved setting, no transaction control, no `SET ROLE trainer_app`,
  no `SESSION AUTHORIZATION`).
- `tx.tenant()` on a service transaction enters and leaves a scope, blocks the service
  handle meanwhile and refuses nesting; `db.system(fn, { tenantId })` binds a service
  transaction to one workspace and refuses a scope in another.
- `putPrivateRecord()` writes a record without reading it back (follower-filed review
  items); `elevated()` and `actingAs()` build the only elevated actors.

### Application

All sites in the inventory were refactored (see the table). Notable behaviour-preserving
changes: scheduled coaching follow-ups are delivered in their author's own verified scope
(the worker only reviews them when the author is no longer current); the automatic coaching
decision is stored once, already delivered; the push worker rechecks the recipient's
membership and the workspace state as service facts; nutrition pantry answers a plan that
is not the follower's own with the same 400 as before instead of revealing it.

### Infrastructure and CI

- `infra/tenant-scope.sql` (new): revokes `set_config` from PUBLIC, grants it to
  `trainer_service`. `infra/runtime-role.sql` grants it to `trainer_service`.
- `infra/digitalocean/host.py` `runtime_role`: after the grants and the password step,
  applies `release/infra/tenant-scope.sql` when the release has it
  (`tests/test_host_deployment.py` covers the order and that no `set_config` is issued in
  the role SQL itself).
- `scripts/prepare-ci-postgres.mjs` and `scripts/compose-smoke.sh` apply it after the
  runtime role, as a scope-compatible controller would.
- `scripts/verify-runtime-access.mjs` additionally proves: every new helper is a definer,
  executable by `trainer_app` only, not PUBLIC, not owned by the runtime role;
  `balanced_journal()` is a trigger-only definer nobody may execute; `trainer_app` cannot
  execute `set_config` and PUBLIC cannot; the 17 bound service tables force RLS and carry
  the binding policy; a bound transaction counts no other workspace's rows (the CI
  database is still empty at that point, so `tests/isolation-scope.test.ts` repeats the
  check with seeded rows); inside a real
  tenant scope `set_config('role'|'app.tenant_id'|'app.role', …)` fails with 42501 and the
  scope is unchanged; `schema_migrations`, `tenants`, `provider_objects` and
  `provider_events` are unreadable by the tenant role.

## Rollout

- Migration 061 runs while the previous release still serves. It changes nothing the
  previous release depends on: the `set_config` revoke is skipped on a database with
  workspaces, the new service-table policies admit unbound service transactions (the
  previous release's only kind), subscriber policies only widen what a subscriber scope may
  read (except the insert/update guards on `subscriptions`, which the previous release's
  follower paths did not perform as subscriber), and `balanced_journal()` behaves the same.
- The database-level `set_config` revoke on the live database is applied by the controller's
  `runtime_role` step from `infra/tenant-scope.sql`. The controller that deploys this
  release is the previous release's copy and skips the step; the first deployment after
  this release is serving applies it. Until then the application-side guard and the
  extended protocol are the protection. No new secret, manual step or login role is needed.

## Tests actually run

New tests (`node --import tsx --test tests/<file>`):

- `tests/isolation-guard.test.ts` (5): the tenant and service statement guards, the
  membership matrix and elevation rules, `actingAs`.
- `tests/isolation-elevation.test.ts` (3): the allowlist matches every elevation in
  `apps/` file by file; no application source switches role or scope settings; no hand-built
  system-user team actor.
- `tests/isolation-scope.test.ts` (5): refused and admitted actors against real
  memberships; every role/setting/transaction statement refused inside `db.tenant` and
  `tx.tenant` with the scope unchanged afterwards; a raw PGlite connection as
  `trainer_app` gets 42501 for `set_config` of every scope setting, `role` and
  `session_authorization`, for `UPDATE pg_settings`, and for the global tables; workspace
  binding of service rows (PGlite through a non-bypassing fixture role, PostgreSQL through
  `trainer_service` itself), including a refused cross-workspace insert; argument checks of
  the definer helpers.
- `tests/isolation-follower.test.ts` (4): with a second follower's rows seeded across the
  workspace, a follower's scope finds none of them in any column naming a person on any
  table the tenant role may read (plus `records.data`, `journals.data`, `jobs.data`); lists
  no internal review or Brain material, even about itself; the replacement helpers answer
  for the follower or with counts only; `/bootstrap`, `/training/overview` and the leave
  preview carry nothing of the other follower.

Runs:

- `npx tsc --noEmit`: no errors.
- `python3 -m unittest tests/test_host_deployment.py`: 35 tests, OK.
- Isolation files on PostgreSQL: `/opt/tools/pg-sandbox.sh 56121 <worktree>
  tests/isolation-scope.test.ts tests/isolation-follower.test.ts
  tests/isolation-guard.test.ts tests/isolation-elevation.test.ts`: verifier
  `{"runtimeAccess":"verified",…,"workspaceBoundServiceTables":17,"tenantScopeFixed":true}`,
  17 tests, 17 pass, `PG_SELECTED_FAILED_FILES=0`.
- Whole suite on PGlite, on a byte copy of the worktree (sources plus hard-linked
  `node_modules`): `node --import tsx --test --test-timeout=180000 --test-concurrency=1
  tests/*.test.ts` (the `npm test` command plus a per-test timeout): 681 tests, 680 pass,
  0 fail, 0 cancelled, 1 skipped (the PostgreSQL-only race test), 540 s.
- Whole suite on PostgreSQL once: `/opt/tools/pg-sandbox.sh 56121 <worktree>` (no file
  arguments): verifier passed as above; 91 files, 681 tests, 678 pass, 0 fail,
  1 cancelled, 2 skipped; `PostgreSQL test files failed: 1`. The cancelled test was
  `tests/fix2-safety.test.ts` "a retirement racing a delivery…", which paused the delivery
  after its first `FROM nutrition_recipes` read; the follower's delivery now reads recipes
  through `member_nutrition_recipes()`, so the pause never triggered and the test timed out
  at 120 s. The test's matcher now recognises the helper; rerun alone on PostgreSQL
  (`/opt/tools/pg-sandbox.sh 56121 <worktree> tests/fix2-safety.test.ts`): 6 tests, 6 pass,
  including the race (the retirement still waits for the delivery's catalog lock and the
  raced week is flagged `needs_recheck`). The whole PostgreSQL suite was not run a second
  time.
- Whole suite on PGlite in the worktree after that fix: `npm test`: 681 tests, 680 pass,
  0 fail, 0 cancelled, 1 skipped (the PostgreSQL-only race test), 529 s, exit 0.

Earlier full PGlite runs during development (before the fixes listed here) failed 431 and
then 117 tests; every failure was either application code still claiming a role its actor
did not hold (fixed in the application) or a test fixture doing the same (fixtures now use
`seedScope()`/`privacyOperator()` from `tests/scope-fixtures.ts`, the privacy erasure option
for direct erasure calls, or assert the db package's refusal where a test expected a later
refusal). Two expectations changed on purpose: a follower no longer sees its own internal
decisions (`tests/platform.test.ts` already required that), and a stale team role is now
refused at scope entry with `ACTOR_ROLE_MISMATCH` as well as by the route's own
`WORKSPACE_CHANGED` recheck (`tests/coaching-history-search.test.ts`,
`tests/source-review-notifications.test.ts` accept either).

## Remaining limits

- PostgreSQL has no per-role privilege for `SET ROLE`/`RESET ROLE` or for `SET` of a custom
  `app.*` placeholder, and a separate tenant login is out of scope (no new secrets).
  `trainer_app` can therefore still issue those utility statements if code could send them.
  Application code cannot: the db package rejects them before the database, and the
  extended protocol keeps an injected value from adding a statement; the database refuses
  the function forms (`set_config`, `UPDATE pg_settings`) that a single injected data
  statement could use.
- The live database gets the `set_config` revoke only from the deployment after this
  release is serving (see Rollout).
- Definer helpers and `service_workspace_scope` rely on the migration owner being a
  superuser (as the existing helpers do), because the tables force row security.
- A follower's scope can read the confirmed nutrition material and purchase conversions its
  plans are generated from; no follower listing returns `nutrition_*` records, but they are
  not behind helpers like the coaching Brain.
- The subscriber write check is unchanged from migration 003: a follower may insert records
  of any kind it owns (its own review items rely on this); reads are what 061 narrows.
- Test fixtures seed and inspect with `seedScope()` (`tests/scope-fixtures.ts`, the `worker`
  elevation) instead of claiming a team role for a follower or a stranger, which the db
  package now refuses.
- Records updates (`CLAUDE_HANDOFF.md`, `docs/COMPLETION_STAGES.md`,
  `docs/PROJECT_MEMORY.md`) were not edited, as this work package instructs.
