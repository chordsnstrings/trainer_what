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
| Wearables and HealthKit (`healthkit-sync`, `integrations-completion`) | owner | subscriber; `coach_wearable_policy()`; the companion's device-token check uses `healthkit_device_for_token()` and the provider's OAuth redirect uses `integration_oauth_relay()`, both in a workspace-bound service transaction; only the worker's sync and maintenance jobs use `worker` |
| Super admin voice and domain listings (`integrations-completion`) | owner (`worker`) | `platform-operator` with the operator's user id |
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
   `trainer_service`, but only on a fresh database: the revoke runs when `001_initial` was
   recorded in the same migration transaction (`applied_at = now()`; `applyMigrations`
   applies every pending file in one transaction). On any database an older release has
   served, the revoke is left to `infra/tenant-scope.sql` (see Rollout), because releases
   before this one call `set_config` after `SET ROLE`.
2. Definer helpers (all `SECURITY DEFINER`, `search_path` pinned to `pg_catalog,public`,
   arguments validated against the fixed scope, `EXECUTE` revoked from PUBLIC and granted to
   `trainer_app` only, returning only the columns their callers use): the notification,
   exit, booking, checkout, billing, budget, guided voice, wearable policy, invitation,
   export, brand-erasure, nutrition catalog and coaching helpers named above, plus
   `workspace_member_role(uuid)` (a recipient's current role in the active workspace, for
   the outbox worker; a follower may ask only about itself). Each helper fails closed when
   a scope setting is unset (explicit `NULL` checks or `coalesce`). Every helper that
   returns workspace material or lets a subscriber address the coaching team
   (`notification_recipient`, `enqueue_notification`, `notification_team`,
   `booking_slot_taken`, `booking_fee_policy`, `checkout_promotion`, `model_usage_today`,
   `voice_guidance_spent_today`, `guided_voice`, `coach_wearable_policy`,
   `member_nutrition_*`, `member_material`) also requires a subscriber caller's current
   membership: the db package admits a user without a membership as a subscriber of its own
   rows, and such a scope gets no row, `NULL` or a 42501 refusal. Helpers about the caller's
   own rows (charges, exit blockers, export, takeover flag, personal review) do not.
   `personal_export_records(subject)` holds its fixed list of other-owned record kinds
   (equal to `privateKinds` in `privacy-lifecycle.ts`, compared by a test) instead of taking
   the list from the caller.
3. Subscriber policies. `record_subscriber_scope` adds the follower's own billing intents
   and invoices, guided sessions and nutrition requests/favourites/leftovers/targets/open
   nutrition exceptions, and, only while the subscriber has a current membership in the
   workspace, the material its bookings and nutrition plans are served from (the active
   booking policy, the saved nutrition setup, confirmed nutrition policy/cases/sources,
   published/paused/needs-recheck releases, active purchase conversions, the product of its
   own subscription). A subscriber scope without a membership sees published products and
   its own rows only, as before 061. Internal coaching reviews
   (decisions, exceptions, takeovers), the coaching Brain (releases, actions, teaching,
   program templates) and held-out scenarios stay invisible, so the follower's
   `/bootstrap` and training listings do not show them. Also: a follower may not insert
   subscriptions and may change only `cancel_at_period_end` on its own
   (`subscription_member_insert`, `subscription_member_update_guard`); a follower may delete
   only its own records (`record_subscriber_delete`); a follower's own weekly nutrition job
   and its own usage rows are readable; `schema_migrations` is revoked from `trainer_app`.
4. Service tables: `service_workspace_scope` (RLS enabled and forced) on the 14
   tenant-keyed service tables above and on `tenants`; `membership_scope` and
   `domain_mapping_scope` gain the same service branch. A service transaction bound with
   `db.system(fn, { tenantId })` (sets `app.service_tenant_id`) sees and writes only that
   workspace; `tx.acrossWorkspaces(fn)` lifts the binding for one explicitly
   cross-workspace step in the same transaction. Binding is opt-in: 13 service
   transactions use it (coach site, coaching follow-up delivery, two governance actions,
   lifecycle messages, two onboarding steps, push delivery, retention, the HealthKit device
   lookup, the wearable OAuth relay, workspace closure and member erasure); every other
   service transaction (about 240 call sites: sign-in, sessions, joining, membership exit,
   provider callbacks, operator tools and more) is unbound and keeps the pre-061 behaviour,
   where its own `tenant_id` predicates are the only workspace limit. The `trainer_app`
   branch of these policies adds nothing today, because `trainer_app` has no grant on the
   14 tables; it only keeps an accidental future grant from exposing rows.
5. `balanced_journal()` (the deferred ledger balance trigger) is a trigger-only definer: a
   deferred trigger fires at `COMMIT` as the role that queued it, after the db package has
   left a nested scope and cleared its settings.
6. Bearer-secret lookups for session-less follower requests, executable by
   `trainer_service` only (granted in `infra/runtime-role.sql`) and refused (42501) outside
   a bound service transaction: `healthkit_device_for_token(token_hash)` returns a
   companion device's id, workspace, member and status; `integration_oauth_relay(state_hash,
   provider)` returns only the initiating origin of an unexpired, unused wearable OAuth
   state. They replace the worker-elevated owner scope those two follower requests used.

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
  no `SESSION AUTHORIZATION`; a `set_config` target counts as a literal only when it is one
  plain string argument, so a parameter, an expression such as `'app.'||'role'`, a cast or
  an `E''` string with escapes is refused). Both guards refuse any Unicode-escaped
  identifier or string (`U&"\0073et_config"`) and any reference to `pg_settings`, so they
  do not depend on the database revocation having been applied.
- `tx.tenant()` on a service transaction enters and leaves a scope, blocks the service
  handle meanwhile and refuses nesting; `db.system(fn, { tenantId })` binds a service
  transaction to one workspace and refuses a scope in another; `tx.acrossWorkspaces(fn)`
  lifts that binding for one explicitly cross-workspace step and restores it (refused
  inside a tenant scope).
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
  `trainer_service`. `infra/runtime-role.sql` grants it to `trainer_service`, and grants
  `EXECUTE` on the two bearer-secret lookups to `trainer_service`.
- `infra/digitalocean/host.py`:
  - `runtime_role(release, sha, serving)` receives the release that is serving (the one a
    failed deployment restores). It appends `release/infra/tenant-scope.sql` only when
    that serving release ships the file too (or nothing serves yet); while an older
    release serves, for example after an operator rollback, it appends
    `GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) TO PUBLIC` instead,
    so the release that may be restored keeps working.
  - `switch_release(target)` (operator rollback and return) restores that PUBLIC grant
    before it starts a target without `infra/tenant-scope.sql`. The next deployment while a
    scope-compatible release serves hardens the database again.
  - `tests/test_host_deployment.py` covers the order of the role SQL, a deployment while a
    pre-061 release serves after a rollback (the new release fails readiness: no revoke,
    the PUBLIC grant is sent, the older release is restored), a deployment while a
    compatible release serves (revoke sent) and a switch to a pre-061 release (grant sent
    before its services start; none for a compatible one).
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
  `provider_events` are unreadable by the tenant role; the two bearer-secret lookups are
  definers executable by `trainer_service` only (not `trainer_app`, not PUBLIC) and refuse
  an unbound service transaction.

## Rollout

- Migration 061 runs while the previous release still serves. It changes nothing the
  previous release depends on: the `set_config` revoke is skipped on any database that
  existed before this migration run, the new service-table policies admit unbound service
  transactions (the previous release's only kind), subscriber policies only widen what a
  subscriber scope may read (except the insert/update guards on `subscriptions`, which the
  previous release's follower paths did not perform as subscriber), and
  `balanced_journal()` behaves the same.
- The database-level `set_config` revoke on the live database is applied by the controller's
  `runtime_role` step from `infra/tenant-scope.sql`. The controller that deploys this
  release is the previous release's copy and skips the step; the first deployment after
  this release is serving applies it, and only while the serving release (the restore
  target of that deployment) is scope-compatible. After an operator rollback to a pre-061
  release, `switch_release` restores the PUBLIC grant before that release starts and
  deployments keep it until a scope-compatible release serves again. Until the revoke
  applies, the application-side guard (which now also refuses `U&` spellings and
  `pg_settings`) and the extended protocol are the protection. No new secret, manual step
  or login role is needed; the bearer-secret lookup grants arrive with the release's own
  `infra/runtime-role.sql`, which every controller applies before the new services start.

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

## Adversarial review fixes (second pass)

An adversarial review of commit `1d3203f` reported three major and three minor findings.
What changed for each:

1. **Non-member subscriber scopes reached workspace material (major, regression).** The db
   package admits a user without a membership as a subscriber of its own rows (former
   members' account and exit paths), and 061's shared-material branches and member-facing
   helpers checked only `app.role`. Now every shared-material branch of
   `record_subscriber_scope` sits under `EXISTS(current membership)`, `booking_policy` is
   readable only when `active` and `nutrition_setup` only when `saved`/`active` (never a
   draft), and every material or team-addressing helper requires a subscriber caller's
   membership (list in "What changed", item 2). The db package still admits the non-member
   subscriber scope; with the database check that scope reaches its own rows and published
   products only, as at the base commit. New test in `tests/isolation-follower.test.ts`: a
   non-member subscriber scope in the coach's workspace reads none of ten shared kinds,
   gets no team, fee policy, coupon, wearable policy, voice, taken seats, foods or
   recipient, cannot enqueue a team notice, and `member_material()`/`model_usage_today()`
   refuse it with 42501; a current follower still gets each answer. The test failed on the
   previous 061 (checked by running it against `git show HEAD:…/061…sql`).
2. **Rollout after an operator rollback (major).** `runtime_role` now takes the serving
   release and applies the revoke only when that release is scope-compatible; otherwise it
   restores the PUBLIC grant, and `switch_release` restores it before starting a pre-061
   release (details under "Infrastructure and CI"). Migration 061 itself now revokes only
   on a fresh database (all migrations in one run) instead of "no workspaces yet", so a
   live database without workspaces is not hardened while the previous release serves.
   New Python tests (three in `tests/test_host_deployment.py`) and a PGlite test that an
   upgraded database keeps the PUBLIC grant until `infra/tenant-scope.sql` runs.
3. **Follower requests under the `worker` elevation (major).** The HealthKit companion's
   token check and the wearable OAuth redirect no longer open a tenant scope before the
   member is known: they call `healthkit_device_for_token()` and
   `integration_oauth_relay()` in a service transaction bound to the credential's
   workspace, then continue in the member's own subscriber scope (or, for the relay, only
   redirect). The Super admin voice and domain listings use `platform-operator` with the
   operator's user id. Tests spy on `db.tenant`/`db.system` during the companion's
   status and upload calls (every scope is the member's own subscriber scope, an unknown
   token opens none) and during the OAuth relay (no tenant scope, the service transaction
   bound to the state's workspace); the lookup returns nothing when bound to another
   workspace and refuses an unbound transaction. `ELEVATIONS.worker.usedBy` keeps
   `healthkit-sync.ts` and `integrations-completion.ts`, because their worker jobs
   (`maintainHealthKitSync`, `processIntegrationJobs`) still use it; the allowlist test
   stays file-granular, so the spy tests are what pins the two follower routes.
4. **`U&` spellings passed the guard (minor).** Both guards refuse Unicode-escaped
   identifiers and strings and any `pg_settings` reference; the service guard also stops
   trusting a `set_config` target that is not one plain string literal. New cases in
   `tests/isolation-guard.test.ts`, including the reviewer's
   `SELECT U&"\0073et_config"('app.role','owner',true)`.
5. **Workspace binding opt-in and inaccurate doc (minor).** Workspace closure and member
   erasure now run bound to their workspace; their account scrub and visitor analytics
   erasure run inside `tx.acrossWorkspaces()`, because both must see other workspaces (a
   person's other memberships and sessions; a visitor's rows whose `tenant_id` is another
   workspace or empty). On PostgreSQL, a negative control (the closure with the scrub left
   bound, in a scratch copy) failed the new test exactly as expected: the account of a
   person still following workspace B was scrubbed. New tests: the closure's service
   transaction is bound to the closing workspace, B's sessions and links survive, only the
   account left without a membership is scrubbed (`tests/privacy-lifecycle.test.ts`); a
   bound `DELETE` without a tenant predicate removes only the bound workspace's link, and
   `acrossWorkspaces` sees and then re-hides another workspace's membership
   (`tests/isolation-scope.test.ts`). The description of unbound transactions and of the
   `trainer_app` branch was corrected (item 4 of "What changed").
6. **`personal_export_records()` took its kinds from the caller (minor).** The function now
   takes only the subject and holds the fixed list; a test compares it with
   `privateKinds` in `privacy-lifecycle.ts`.

One existing fixture changed: `tests/fix-nutrition-ops.test.ts` checked the workspace
model allowance with a random, non-member user id as a subscriber; `model_usage_today()`
now refuses that scope (42501), so the test uses a real follower of that workspace. The
production callers reach model accounting only after their own membership checks.

Second-pass runs (all in the worktree, `export PATH=/opt/node24/bin:$PATH`):

- `npx tsc --noEmit`: no errors.
- `python3 -m unittest tests/test_host_deployment.py`: 38 tests, OK.
  `python3 -m unittest tests/test_hostops_deployment.py`: 45 tests, OK (1 skipped: Caddy
  is not installed here).
- PGlite, targeted: `node --import tsx --test --test-concurrency=2
  tests/isolation-guard.test.ts tests/isolation-elevation.test.ts
  tests/isolation-scope.test.ts tests/isolation-follower.test.ts
  tests/privacy-lifecycle.test.ts tests/healthkit-sync.test.ts
  tests/integrations-completion.test.ts tests/accounts-membership-exit.test.ts
  tests/coaching-runtime.test.ts tests/platform.test.ts`: 107 tests, 107 pass, 0 fail.
- PostgreSQL, targeted: `/opt/tools/pg-sandbox.sh 56121 <worktree>
  tests/isolation-scope.test.ts tests/isolation-follower.test.ts
  tests/isolation-guard.test.ts tests/isolation-elevation.test.ts
  tests/privacy-lifecycle.test.ts tests/healthkit-sync.test.ts
  tests/integrations-completion.test.ts`: verifier
  `{"runtimeAccess":"verified","migrations":53,"systemTables":52,"scopedTables":37,"helpers":40,"serviceLookups":2,"workspaceBoundServiceTables":17,"tenantScopeFixed":true}`;
  7 files, 56 tests, 56 pass, `PG_SELECTED_FAILED_FILES=0`.
- PostgreSQL negative control (scratch copy of the worktree with the closure's account
  scrub left bound): `tests/privacy-lifecycle.test.ts` 9 tests, 8 pass, 1 fail (the new
  closure test: the shared follower's account was scrubbed), as expected. The copy was
  deleted.
- PostgreSQL, whole suite once: `/opt/tools/pg-sandbox.sh 56121 <worktree>` (no file
  arguments), 4 min 38 s: verifier as above; 91 files, 687 tests, 684 pass, 1 fail,
  0 cancelled, 2 skipped; `PostgreSQL test files failed: 1`. The failure was the
  `fix-nutrition-ops` fixture above; after the fixture change,
  `/opt/tools/pg-sandbox.sh 56121 <worktree> tests/fix-nutrition-ops.test.ts`: 8 tests,
  8 pass, `PG_SELECTED_FAILED_FILES=0`, and on PGlite `node --import tsx --test
  tests/fix-nutrition-ops.test.ts`: 8 tests, 8 pass. The whole PostgreSQL suite was not run
  again after that test-only change.
- PGlite, whole suite once after the fixture change: `npm test` (`node --import tsx --test
  --test-concurrency=1 tests/*.test.ts`), 8 min 41 s: 687 tests, 686 pass, 0 fail,
  0 cancelled, 1 skipped (the PostgreSQL-only race test), exit 0.

Declined after checking:

- **Binding the `provider_objects` writes in `stripe-events.ts` and
  `finance-bookings.ts`.** Both write paths first read the existing mapping for the
  external id and refuse it when it belongs to another workspace or member
  (`Conflicting provider object ownership`, `PAYMENT_OWNER_CONFLICT`). A transaction bound
  to the resolved workspace would hide exactly that conflicting row, and
  `INSERT … ON CONFLICT DO NOTHING` would then skip silently, turning a refused
  cross-workspace payment mapping into a quiet no-op. They stay unbound; every statement
  there carries its external id and workspace explicitly.
- **Binding membership exit.** It deliberately works across workspaces (it finds the
  person's next membership and opens a session there), so it stays unbound.
- **Refusing non-member subscriber scopes in the db package.** The database now enforces
  the membership rule for every shared read, and several real paths (rejoin checks, account
  emails and audit for former members, integration revocation, HealthKit error notes) rely
  on a former member's own-row scope; a package-level refusal would need an allowlist of
  those paths without adding protection the database does not already give.

## Remaining limits

- PostgreSQL has no per-role privilege for `SET ROLE`/`RESET ROLE` or for `SET` of a custom
  `app.*` placeholder, and a separate tenant login is out of scope (no new secrets).
  `trainer_app` can therefore still issue those utility statements if code could send them.
  Application code cannot: the db package rejects them before the database, and the
  extended protocol keeps an injected value from adding a statement; the database refuses
  the function forms (`set_config`, `UPDATE pg_settings`) that a single injected data
  statement could use.
- The live database gets the `set_config` revoke only from the deployment after this
  release is serving, and loses it again while an operator rollback serves a pre-061
  release (see Rollout).
- Workspace binding covers 13 service transactions; the other service transactions
  (about 240) rely on their own `tenant_id` predicates as before.
- The elevation allowlist is file-granular: `healthkit-sync.ts` and
  `integrations-completion.ts` are listed for `worker` because of their background jobs;
  spy tests, not the allowlist, pin their follower routes to the member's own scope.
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
