# Account self-service and sign-in

Branch `feat/accounts`, base `6fa8aba`. Migration
`packages/db/migrations/054_account_self_service.sql`. Nothing here was
deployed; no live provider, email or payment request was made.

## Plan (written before implementation)

Findings that shaped the design:

- Every sign-in path inserted `sessions` rows either through `session()` in
  `app.ts` (password login, trainer registration, public join, invitation,
  workspace switch) or `insertAccountSession()` in `account-completion.ts`
  (magic link, authenticator recovery, passkey). Both now call one function,
  `openSignInSession()` in `apps/api/src/sign-in.ts`.
- There was no change-password form in the web UI for any role, although
  `POST /api/v1/auth/password` works for all roles.
- `processStripeEvent` refused events for a user without a membership, so a
  follower leaving during a paid period would have orphaned the final Stripe
  events. Exits are recorded in `membership_exits` and Stripe events for a
  recorded former member keep posting.
- Email jobs need a tenant; account emails use the member's current or most
  recent workspace, as `queueAccountEmail` already does.
- `validateIntegrationValues` rejects line breaks, so the Apple `.p8` key is
  accepted without them (PEM markers and whitespace are stripped).

## What was built, per audience

### Every account (trainer owner, staff, finance, follower, platform operator)

Web: `AccountSettings` (`apps/web/components/account-settings.tsx`) is mounted
in Settings (`/trainer/settings`, `/app/profile`) and on
`/admin/account-security`.

- **Display name**: `PATCH /api/v1/account/profile` `{name}` (2 to 100 plain
  characters). Audited as `account.name_changed` in the current workspace with
  `{fields:["name"]}`; the value itself is never written to the audit.
- **Re-proving ownership** (`confirmAccountOwner`): the current password, or,
  for an account without a password, a real sign-in within the last ten
  minutes, plus a fresh authenticator code when one is enrolled. "Real sign-in"
  is `sessions.authenticated_at`, set by password, Apple/Google, passkey, magic
  link, authenticator recovery, registration, public join and invitation
  sign-ins. A workspace switch (`POST /api/v1/auth/workspace`) and the
  follow-on session after leaving a trainer carry the replaced session's time
  forward (`openSignInSession` refuses those two methods without it), so they
  never reopen the ten-minute window. `GET /api/v1/account` `recentSignIn`
  uses the same column.
- **Email change**: `POST /api/v1/account/email` `{email, password, code?}`
  needs that proof. It
  queues a 30-minute confirmation link to the new address through the existing
  `email` job queue (marked sensitive, scrubbed after sending) and a notice to
  the old address. Nothing changes until `POST /api/v1/account/email/confirm`
  `{token}` from `/verify-email-change/<token>` (a button, not page load, so
  link scanners cannot consume it). Confirmation re-checks under lock that the
  account email is unchanged and that no other account holds the new address;
  the unique email constraint is the final race guard (409 `EMAIL_IN_USE`, the
  request is cancelled). The response never reveals whether another account
  uses an address; that address instead receives a "not possible" notice.
  Confirming verifies the address, signs out other devices, voids magic/reset
  links, adds an account notice and emails the old address. A pending change
  can be cancelled (`POST /api/v1/account/email/cancel`). In production
  without email delivery the request returns 503 ("Email delivery must be
  configured…", the forgot-password pattern) and the screen says email
  delivery is not configured instead of showing the form. The link uses the
  address the change started from; on a trainer's own domain
  `/verify-email-change/<token>` is served as the confirmation page (it was
  missing from the custom-host allowlist in `apps/web/host-proxy.ts` and was
  rewritten to the coach site).
- **Password**: a change-password form over the existing
  `POST /api/v1/auth/password` (current password, new password twice,
  authenticator code when enrolled; every session ends). Accounts created
  through Apple/Google have no password; they can set one right after a fresh
  sign-in with `POST /api/v1/account/password/set`.
- **Authenticator for accounts without a password**: both authenticator routes
  confirm with the password, so `POST /api/v1/auth/mfa/enroll` answers 409
  `PASSWORD_REQUIRED` ("Set a password in Account settings first") instead of
  "Password is incorrect", `GET /api/v1/auth/security` reports `hasPassword`,
  and the Account security card shows that guidance instead of the form.
- **Apple and Google sign-in methods**: link from settings
  (`POST /api/v1/auth/oidc/:provider/link` re-proves ownership with password
  or recent sign-in plus authenticator code) and unlink
  (`POST /api/v1/account/identities/:provider/unlink`, same proof; refused with
  `LAST_SIGN_IN_METHOD` unless a password, an active passkey or another linked
  provider remains). Linking adds an in-app notice and an email notice.
- **Account notices**: account-level in-app notices (`account_notices`),
  listed in `GET /api/v1/account` and marked read with
  `POST /api/v1/account/notices/read`. Used for email change, recovery link
  issue/use, linked/unlinked providers and membership exits, so a follower
  removed from a trainer sees it from any other workspace.
- The personal data export (`GET /api/v1/privacy/export`) now includes linked
  sign-in identities and account notices; erasure of an unused account
  (`scrubUnusedAccount`) deletes identities, OIDC requests, email changes,
  recovery grants and notices.

### Sign-in and registration (public)

Web: `SocialSignIn` buttons on `/login`, `/join-coach/<slug>` and
`/join/<token>`; `/sign-in/verify` for the authenticator step.

- Authorization code flow with PKCE (S256), `state` and `nonce`. The browser
  that starts a flow receives an httpOnly `oidc_binder` cookie
  (SameSite=None; Secure in production because Apple returns with a cross-site
  form POST). The database stores only hashes of state and binder; the PKCE
  verifier and nonce are derived from the binder, so the stored request cannot
  complete a sign-in. A callback in another browser fails
  (`OIDC_BROWSER_MISMATCH`), a replay finds the request already claimed.
- ID tokens are verified against the provider JWKS (RS256/ES256 only, key type
  checked), cached with the provider's `max-age` (bounded 5 minutes to 1 day),
  refreshed once on an unknown key id and throttled to one forced refresh per
  ten seconds; issuer (both Google forms), audience and authorized party,
  expiry, issue time (at most ten minutes old) and nonce are checked.
- Apple: `client_secret` is an ES256 JWT (`iss` team, `sub` Services ID, `aud`
  Apple, five-minute lifetime) signed with the stored key; `response_mode=
  form_post`, `scope=name email`; the one-time `user` name is used for new
  accounts. Only the Apple callback path accepts a form body (encapsulated
  parser) and is exempt from the origin check; state and binder replace it.
- Account resolution: a linked provider subject signs in to its account.
  Otherwise an account is linked automatically only when the provider asserts
  a verified email equal to a verified local email on a non-platform account;
  anything else returns `OIDC_LINK_REQUIRED` (sign in with the password and
  link from settings). Plain sign-in never creates an account
  (`OIDC_NO_ACCOUNT`).
- New accounts only through a public join (`intent: join`, published active
  coach) or an invitation (`intent: invite`, provider email must equal the
  invited address), with explicit terms acceptance and the same
  `LEGAL_APPROVED` gate as password sign-up (503 `LEGAL_PENDING` in
  production). Consent is recorded as for password sign-up. New accounts have
  a verified email and no password.
- An enrolled authenticator is never bypassed: the callback parks the sign-in
  (`mfa_pending`, five minutes, five attempts, bound to the binder cookie) and
  `/sign-in/verify` completes it with `POST /api/v1/auth/oidc/verify`.
- Available on the platform address only (the provider return URL is
  registered there); on a trainer's custom domain the buttons are hidden and
  the API returns `PLATFORM_HOST_REQUIRED`.

### Superadmin

- **Settings**: two new connections in Settings & connections, "Sign in with
  Google" (`GOOGLE_SIGNIN_CLIENT_ID`, secret `GOOGLE_SIGNIN_CLIENT_SECRET`) and
  "Sign in with Apple" (`APPLE_SIGNIN_SERVICES_ID`, `APPLE_SIGNIN_TEAM_ID`,
  `APPLE_SIGNIN_KEY_ID`, secret `APPLE_SIGNIN_PRIVATE_KEY`). Secrets are sealed
  like other provider secrets. A provider stays disabled until its row is
  enabled and its connection check passes at the current revision (or the
  same values come from deployment environment variables). The check reads the
  live discovery document (issuer must match) and signing keys, validates the
  Apple key locally, then probes the token endpoint with a code that cannot
  exist: `invalid_grant` means the client credentials were accepted
  (`verified`), `invalid_client` fails the check. No one is signed in.
  Return URLs to register: `<public app address>/api/v1/auth/oidc/google/callback`
  and `/api/v1/auth/oidc/apple/callback`.
- **Operator-assisted recovery** (`OperatorRecovery` on
  `/admin/account-security`, and on `/admin/support` for support operators):
  `POST /api/v1/admin/account-recovery` `{email, reason, code}`. Superadmins,
  or support operators for non-platform accounts only, record a reason (10 to
  500 characters) and the operator's current authenticator code is consumed in
  the request. The one-time link (`/account-recovery/<token>`, 30 minutes) is
  returned once; only its hash is stored and it is never emailed. Limits:
  5 requests per 15 minutes per operator (route), 20 links per operator and 3
  per account per 24 hours; a newer link revokes the older one; links can be
  revoked (`POST /api/v1/admin/account-recovery/:id/revoke`) and listed
  (`GET`, fresh authenticator). Issue, use and revoke are written to
  `admin_operations_audit`. Using the link (`POST /api/v1/auth/account-recovery`)
  sets a new password, deletes every session and voids magic/reset links; an
  enrolled authenticator code is still required (five attempts per link). The
  member gets an account notice and, when email delivery is configured, an
  email at issue and at use. A link works only while its issuer still holds
  an operator role covering the account (Superadmin, or support for
  non-platform accounts): demoting the issuer voids their open links at once.
  The host-only authenticator reset
  (`operator-actions.ts`) is unchanged and separate. Trainers have no route.

### Trainer

- **Remove a follower** (`FollowerRemoval` on `/trainer/subscribers/<id>`,
  owner only): `GET /api/v1/trainer/followers/:userId/exit` previews the
  effect; `POST /api/v1/trainer/followers/:userId/remove` `{reason}` needs the
  owner role and a fresh authenticator (`MFA_STEP_UP` otherwise). The reason
  is shared with the follower and kept in the workspace audit. The target must
  be a current follower (and the actor the owner) before any billing call, so a
  refused removal never touches Stripe. The renewal cancellation is recorded as
  the owner's instruction: the `subscription_transition` record carries
  `initiatedBy` and `subscription.renewal_requested` names the owner as actor
  with `memberId`.
- **Removed followers stay out**: the public join paths (password
  `/api/v1/auth/enroll` and the Apple/Google `join` intent) refuse a person
  whose latest exit from that workspace is `removed` and who is not a member
  again (403 `REMOVED_BY_TRAINER`, checked after the password and
  authenticator). A new invitation from the workspace is the only way back;
  a follower who left by choice can rejoin publicly.
- **Former followers** (`FormerFollowers` on `/trainer/subscribers`, owner and
  staff): `GET /api/v1/trainer/follower-exits`.
- When a follower leaves, owner and staff get an in-app notification ("A
  subscriber left", with the optional note; no email or push).

### Follower

- **Leave a trainer** (`LeaveTrainer` in `/app/profile`):
  `GET /api/v1/membership/leave` previews; `POST /api/v1/membership/leave`
  `{confirm:true, reason?}`. "Leave <coach>" opens an in-app bottom sheet
  (what happens, an optional note for the coach, "Stay with <coach>" or
  "Leave <coach>") instead of a required checkbox. With another coach the
  app opens it; otherwise the member lands on `/login?left=1`, which
  confirms "You left <coach>" (read once from this tab's
  `sessionStorage`), says whether renewal was cancelled and offers Find a
  coach.
- **Signing in with an ended or missing membership** (`MEMBERSHIP_ENDED`,
  `NO_MEMBERSHIP`, including from Apple or Google) shows a neutral panel
  with next steps (rejoin the coach on a coach's address, or find a coach),
  not a red error.

Shared exit behaviour (`apps/api/src/membership-exit.ts`):

- A renewing Stripe subscription is first set to cancel at period end through
  the existing `changeRenewal` flow (stable intent; an uncertain outcome is
  held for reconciliation and blocks the exit until reconciled). Without a
  payment provider the exit is refused with 503 and nothing changes. Paid
  time is not refunded automatically; the UI tells the follower to request a
  refund before leaving.
- Exits wait for in-flight instructions: renewal changes being confirmed, open
  checkouts, refunds or payment intents being submitted, and upcoming
  confirmed bookings (409 `EXIT_BLOCKED` with the reasons). The same checks run
  again inside the locked exit transaction, after the workspace lock, the
  membership row lock and the member's booking lock. Checkout creation takes
  the workspace lock and locks the membership row; booking reservation takes
  the member's booking lock and now re-reads the membership inside its
  transaction (`booking-schedule.ts`), so a checkout or booking either lands
  before the exit (which then refuses) or finds no membership. If the renewal
  was already cancelled when the late check refuses, it stays cancelled and
  the member stays; the member can switch renewal back on.
- An open deletion request does not block an exit. `eraseMember` now accepts a
  former member of the workspace (a `membership_exits` row and no current
  membership) and still scrubs the account when no other membership remains;
  someone never a member is still refused (`WORKSPACE_CLOSURE_REQUIRED`). The
  preview reports `openDeletionRequests`, and the Leave and removal screens
  say that such a request is still processed after the membership ends. The
  Leave screen advises filing a deletion request and downloading the export
  before leaving, because a follower without another membership cannot sign
  in to file one afterwards.
- Then, in one transaction: a `membership_exits` row (immutable), the
  membership removed, that workspace's sessions deleted (push subscriptions
  cascade), that workspace's links and any unused invitation to the address
  voided, passkeys bound to the trainer's custom domain revoked, wearable
  connections in that workspace revoked (provider revocation queued by the
  existing worker), `membership.left`/`membership.removed` audit event.
- Records stay in the workspace under the existing retention rules; erasure
  remains a separate privacy request. The global account and other trainer
  memberships are untouched; when the follower leaves on the platform address
  and has another workspace, a session for it is opened.
- Stripe events for a recorded former member still reach the ledger
  (`stripe-events.ts`); events for someone never a member are still refused.
- Signing in after the last membership ended: exit notices record their
  workspace (`account_notices.tenant_id`). Password login answers 403
  `MEMBERSHIP_ENDED` with the notice text (trainer name and reason) once the
  password and any enrolled authenticator are proven, for the trainer's own
  address or a chosen workspace, or for the account's latest exit on the
  platform address. Passkey sign-in does the same. Apple/Google sign-in
  redirects with `signin_error=MEMBERSHIP_ENDED` (generic wording, after the
  authenticator step). Anyone else still gets `NO_MEMBERSHIP`.

## Single sign-in entry point

`openSignInSession(tx, {userId, tenantId, mfa, method})` in
`apps/api/src/sign-in.ts` is the only code that inserts `sessions` rows
(a test asserts this). It checks the membership and active workspace and
sets `authenticated_at`, carried forward for `workspace_switch` and
`membership_exit`. An
account lock or suspension check belongs there, before the insert; it then
covers password login, registration, public join, invitation, workspace
switch, magic link, authenticator recovery, passkey, Apple, Google and the
follow-on session after leaving a trainer.

## Migration 054

System tables (service connection only, no tenant grants, granted to
`trainer_service` in the migration and `infra/runtime-role.sql`):
`account_identities`, `oidc_sign_in_requests`, `email_change_requests`
(one open request per account), `account_recovery_grants`,
`account_notices` (with a nullable `tenant_id` for exit notices).
`sessions.authenticated_at` (not null, default `now()`; existing sessions are
backfilled with their `created_at`). The existing table-level grants on
`sessions` cover the column. Migration 054 is this work package's own
migration and has not been merged or applied to any database outside tests,
so the review round added these two columns to it instead of a new file. Tenant table `membership_exits` with RLS (owner, staff and
finance of the workspace), `SELECT, INSERT` for `trainer_app`, immutable
trigger. `scripts/verify-runtime-access.mjs` classifies all six and asserts
the tenant role cannot read the system tables or delete exits.

## Tests actually run

Initial implementation, 27 September 2026, Node 24:

- `npx tsc --noEmit -p .` passed. PGlite: accounts-self-service 7/7,
  accounts-recovery 3/3, accounts-membership-exit 3/3, accounts-oidc 7/7,
  accounts-web 3/3, plus 54 + 63 + 89 + 28 existing related tests, all passing.
- `/opt/tools/pg-sandbox.sh 56111 …`: runtime access verified (46 migrations,
  41 system tables, 34 scoped tables); 20/20, 72/72 and 23/23 in three runs,
  `PG_SELECTED_FAILED_FILES=0`.

Review round (fixes listed above), 27 September 2026, Node 24. Every check
below was run after the last code change, which was a `prettier --write` pass
over the changed files (the same checks had also passed before it):

- `npx tsc --noEmit` passed (exit 0, no output).
- PGlite: `node --import tsx --test tests/accounts-self-service.test.ts
  tests/accounts-recovery.test.ts tests/accounts-membership-exit.test.ts
  tests/accounts-oidc.test.ts tests/accounts-web.test.ts`: 30/30 pass
  (9 + 4 + 6 + 8 + 3).
- PGlite, related existing files with `--test-concurrency=1`:
  account-completion, fix-auth, platform-settings, provider-configuration,
  privacy-lifecycle, privacy-media, host-routing, finance-completion,
  team-completion, rate-limits, fix-web, fix2-web, fix-edge,
  bookings-completion, fix-ledger, finance-checkout, fix2-finance, platform,
  integrations-completion, support-preview: 211/211 pass.
- Restricted-role PostgreSQL: `/opt/tools/pg-sandbox.sh 56111 "$PWD"` with the
  five account files plus account-completion, fix-auth, privacy-lifecycle,
  finance-completion, team-completion, bookings-completion and host-routing:
  runtime access verified (46 migrations, 41 system tables, 34 scoped tables,
  9 helpers); 12 files, 98/98 pass, `PG_SELECTED_FAILED_FILES=0`.
- The workspace-switch regression test was also run against the old check
  (`created_at` in `confirmAccountOwner`, restored afterwards) and failed, as
  expected.

New regression tests: a stolen session of a passwordless account cannot
set a password, change the email, link Apple or unlink Google after one or two
workspace switches, and the sign-in time carries over exactly; a fresh Google
sign-in reopens the window; a follower on a trainer's own domain confirms an
email change there (and the link is origin-bound); deletion requests filed
before leaving or pending at removal are erased afterwards, and a never-member
is still refused; a checkout inserted while the renewal call is in flight, and
a booking reserved at that moment, both stop the exit; a refused removal of a
staff member makes no billing call; the owner is recorded as the renewal
initiator; a removed follower gets `MFA_REQUIRED` then `MEMBERSHIP_ENDED` with
the reason at login, is refused by the password and Apple/Google join pages
(`REMOVED_BY_TRAINER`) and comes back by invitation; Apple/Google sign-in
after removal redirects with `MEMBERSHIP_ENDED`; links from a demoted support
operator stop working; `mfa/enroll` answers `PASSWORD_REQUIRED` for a
passwordless account.

The OIDC tests use in-test mock issuers on reserved `.test` domains, served
through the existing fixture transport (fetch replacement allowed only under
`node --test`) with RSA/EC keys generated in the test; the mock token endpoint
verifies PKCE, the redirect URI, the Google client secret and the Apple ES256
client-secret JWT. `setOidcTestOverrides()` (issuer and clock) refuses to run
outside the Node test runner or in production.

## Not done, and why

- No live Apple or Google qualification: no credentials were available and
  deployment is out of scope. Apple's discovery document does not advertise
  PKCE; the adapter still sends `code_challenge`/`code_verifier` (OAuth servers
  ignore unknown parameters), which needs confirming against Apple once
  credentials exist.
- Apple sign-in needs HTTPS: the binder cookie is SameSite=None; Secure only in
  production mode, so Apple's cross-site form POST cannot complete over plain
  local HTTP. Google works locally.
- Apple/Google sign-in is platform-address only; custom trainer domains keep
  password, passkey and magic-link sign-in.
- Trainer workspace registration through Apple/Google is not offered; a
  trainer registers with a password and links a provider in settings.
- Apple/Google sign-in after an ended membership shows generic wording, not
  the coach's message: the callback is a redirect and the message is not put
  in a URL. Password and passkey sign-in show it; the email copy is sent when
  email delivery is configured.
- A former follower cannot see the status of their deletion request after
  leaving (the privacy status view needs a workspace session); the platform
  privacy queue still lists and processes it.
- A workspace switch still clears the authenticator step-up time (unchanged
  behaviour), in addition to carrying the sign-in time.
- Automatic pro-rated refunds on exit are not built; refunds stay with the
  existing refund flow.
- `next build` and browser checks were not run (instructions); the web code is
  typechecked and covered by the static render tests above.
