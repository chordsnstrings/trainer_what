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
- **Email change**: `POST /api/v1/account/email` `{email, password, code?}`
  needs the current password (or, for an account without a password, a sign-in
  within ten minutes) and a fresh authenticator code when one is enrolled. It
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
  delivery is not configured instead of showing the form.
- **Password**: a change-password form over the existing
  `POST /api/v1/auth/password` (current password, new password twice,
  authenticator code when enrolled; every session ends). Accounts created
  through Apple/Google have no password; they can set one right after a fresh
  sign-in with `POST /api/v1/account/password/set`.
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
  email at issue and at use. The host-only authenticator reset
  (`operator-actions.ts`) is unchanged and separate. Trainers have no route.

### Trainer

- **Remove a follower** (`FollowerRemoval` on `/trainer/subscribers/<id>`,
  owner only): `GET /api/v1/trainer/followers/:userId/exit` previews the
  effect; `POST /api/v1/trainer/followers/:userId/remove` `{reason}` needs the
  owner role and a fresh authenticator (`MFA_STEP_UP` otherwise). The reason
  is shared with the follower and kept in the workspace audit.
- **Former followers** (`FormerFollowers` on `/trainer/subscribers`, owner and
  staff): `GET /api/v1/trainer/follower-exits`.
- When a follower leaves, owner and staff get an in-app notification ("A
  subscriber left", with the optional note; no email or push).

### Follower

- **Leave a trainer** (`LeaveTrainer` in `/app/profile`):
  `GET /api/v1/membership/leave` previews; `POST /api/v1/membership/leave`
  `{confirm:true, reason?}`.

Shared exit behaviour (`apps/api/src/membership-exit.ts`):

- A renewing Stripe subscription is first set to cancel at period end through
  the existing `changeRenewal` flow (stable intent; an uncertain outcome is
  held for reconciliation and blocks the exit until reconciled). Without a
  payment provider the exit is refused with 503 and nothing changes. Paid
  time is not refunded automatically; the UI tells the follower to request a
  refund before leaving.
- Exits wait for in-flight instructions: renewal changes being confirmed, open
  checkouts, refunds or payment intents being submitted, and upcoming
  confirmed bookings (409 `EXIT_BLOCKED` with the reasons).
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

## Single sign-in entry point

`openSignInSession(tx, {userId, tenantId, mfa, method})` in
`apps/api/src/sign-in.ts` is the only code that inserts `sessions` rows
(a test asserts this). It checks the membership and active workspace. An
account lock or suspension check belongs there, before the insert; it then
covers password login, registration, public join, invitation, workspace
switch, magic link, authenticator recovery, passkey, Apple, Google and the
follow-on session after leaving a trainer.

## Migration 054

System tables (service connection only, no tenant grants, granted to
`trainer_service` in the migration and `infra/runtime-role.sql`):
`account_identities`, `oidc_sign_in_requests`, `email_change_requests`
(one open request per account), `account_recovery_grants`,
`account_notices`. Tenant table `membership_exits` with RLS (owner, staff and
finance of the workspace), `SELECT, INSERT` for `trainer_app`, immutable
trigger. `scripts/verify-runtime-access.mjs` classifies all six and asserts
the tenant role cannot read the system tables or delete exits.

## Tests actually run

All on 27 September 2026 in this worktree, Node 24.

- `npx tsc --noEmit -p .` — passed (no output), last run after the final code
  change.
- PGlite, new files:
  `node --import tsx --test tests/accounts-self-service.test.ts` 7/7,
  `tests/accounts-recovery.test.ts` 3/3,
  `tests/accounts-membership-exit.test.ts` 3/3,
  `tests/accounts-oidc.test.ts` 7/7 (re-run after the last change),
  `tests/accounts-web.test.ts` 3/3.
- PGlite, existing related files (with `--test-concurrency=1`):
  account-completion, fix-auth, platform-settings, provider-configuration,
  settings-runtime, fix-settings: 54/54; finance-completion, fix-ledger,
  privacy-lifecycle, team-completion, host-routing, rate-limits,
  finance-checkout, fix2-finance: 63/63; fix-db, fix-keys, platform, fix-web,
  notifications, retention, fix-edge, fix2-web: 89/89; privacy-lifecycle,
  privacy-media plus the account files after the export change: 28/28.
- Restricted-role PostgreSQL (`/opt/tools/pg-sandbox.sh 56111 …`):
  run 1, the four API account files: runtime access verified (46 migrations,
  41 system tables, 34 scoped tables), 20/20, `PG_SELECTED_FAILED_FILES=0`.
  Run 2, the five account files plus account-completion, fix-auth,
  privacy-lifecycle and finance-completion: runtime access verified, 72/72,
  `PG_SELECTED_FAILED_FILES=0`. Run 3, after the last code change (OIDC
  request housekeeping), the five account files: runtime access verified,
  23/23, `PG_SELECTED_FAILED_FILES=0`.

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
- A removed follower can rejoin through a public join page; a block list for
  removed followers is not built.
- Automatic pro-rated refunds on exit are not built; refunds stay with the
  existing refund flow.
- `next build` and browser checks were not run (instructions); the web code is
  typechecked and covered by the static render tests above.
