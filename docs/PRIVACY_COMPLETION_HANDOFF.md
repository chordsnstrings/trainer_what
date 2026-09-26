# Privacy and account completion handoff — 26 September 2026

## Stage 1: privacy lifecycle

Files: `apps/api/src/privacy-lifecycle.ts`, `privacy-operations.ts`; `apps/web/components/privacy-lifecycle.tsx`, `privacy-operations.tsx`; migration `020_privacy_completion.sql`; `tests/privacy-lifecycle.test.ts`.

Implemented: tenant/user-scoped export includes private derived decisions, workouts, bookings, capture metadata, usage and audit references without tokens; subscriber local erasure handles linked and derived records, jobs, capture bytes, session revocation and final-membership account cleanup. Financial/consent/audit references remain retained. Source/provider inventory review is explicit. Backup/provider follow-up tasks remain pending until actual evidence is recorded, with revisions, deadlines and overdue state. Immutable erasure registry supports restore exclusion.

Workspace closure requires owner password + fresh MFA, independent platform-admin review + fresh MFA, a live owner and current revision under workspace/financial locks, and rechecks subscriptions/refunds/invoices/intents/payouts/unknown usage/bookings/payables immediately before erasure. Owner transfer requires current owner request and verified active staff acceptance with their password/MFA; both parties' sessions are revoked. Stale or simultaneous acceptance cannot create multiple owners.

### Root wiring

- Import `registerPrivacyLifecycle`, `exportPersonalData` from `./privacy-lifecycle.ts`; call `registerPrivacyLifecycle(app, db, identity, privacyHooks)` and supply same optional hooks to `privacyOperations`.
- Replace existing `/privacy/export` data construction with `await exportPersonalData(db, a, privacyHooks)` while preserving attachment header.
- Hooks accept tenant owner `Tx`: `exportAdditional(tx,userId) => object`, `eraseAdditional(tx,userId) => void`, `closeAdditional(tx) => void`. Compose integration helpers and root brand/notification cleanup. Media export should omit bytes. Closure must delete gallery-photo links before galleries/media, plus site/design drafts. Erasure must delete notifications/preferences only for the subject.
- Render `WorkspaceLifecycle({role})` for owner/staff settings, `PersonalPrivacyStatus` for all account privacy settings. Existing PrivacyOperations now embeds provider/backup evidence and closure review.
- Existing baseline `platform.test.ts` privacy fixture must send `expectedRevision: created.json().version` and refresh its admin session `mfa_at=now()` before erasure. Privacy MFA no longer bypasses nonproduction.
- Auth/session/enroll/invite/workspace switch and workers must reject `tenants.lifecycle_state <> 'active'`. Membership-producing transactions must acquire `workspaceLock(tx,tenantId)` and lock affected users consistently before enrollment to prevent closure/erasure race. Closed-host mappings are deactivated; retain inbound financial webhooks.
- Runtime service grants required after migrations: `GRANT SELECT,INSERT ON privacy_erasure_registry TO trainer_service; GRANT SELECT,INSERT,UPDATE ON workspace_lifecycle_requests TO trainer_service;`.
- Acquisition cleanup uses `app.privacy_erasure=true` under service role, so runtime needs `DELETE ON acquisition_events`. Admin migration trigger must allow erasure context; public APIs never expose this setting.
- Add root `privacyHooks` before registering both route groups. Without them provider/media-specific cleanup is not claimed complete.

### Evidence

Seven focused API/database tests passed on PGlite: export isolation/internal decisions; role/MFA/revision/tenant barriers; derived erasure/retained finance/remaining membership; active subscription/unknown usage/future booking blockers; evidence-only backup completion/immutable registry; concurrent two-party ownership acceptance; independently reviewed closure with settlement recheck and financial retention. No provider or backup deletion was performed. No deployment.

Actual provider/backup execution is represented by evidence tasks; it is never inferred from a date or credential. Restore operations must apply the registry and verify provider/backup evidence before serving restored personal data. Root broader PostgreSQL/runtime-role gate still required.

## Stage 2: account access and passkeys

Files: `apps/api/src/account-completion.ts`, `passkeys.ts`, `security.ts`; `apps/web/components/account-completion.tsx`, `passkeys.tsx`, `account-security.tsx`; migration `021_account_completion.sql`; `tests/account-completion.test.ts`. Root owns `@simplewebauthn/server@14.0.2` package/lock change.

Implemented: account-wide private session list and individual revocation; ten 128-bit hashed recovery codes issued once after password/recent MFA; password+code recovery burns all codes and sessions, removes the lost authenticator and grants a session without privileged MFA; critical account email is queued. Magic links expire after 15 minutes, consume once, bind issuing host, preserve an existing authenticator requirement and use the active matching workspace. Email reset/verification receives the same host/closed-workspace checks; changing/resetting passwords invalidates other pending reset/magic links. Email provider preflight happens before address lookup.

Passkeys use the pinned SimpleWebAuthn verifier. Registration requires verified email, password and current authenticator if enabled. Challenges expire, bind origin/RP ID/browser nonce/current registration session, and consume before cryptographic verification; registration commit rechecks session/membership. Authentication requires UV, checks signed counters, rechecks revocation/membership under user/workspace locks and grants fresh verified MFA. Custom-host credentials bind their tenant, so host reassignment cannot transfer identity. Revocation requires password/recent MFA and signs out other sessions. Browser code uses native WebAuthn plus binary JSON conversion, not custom cryptography.

### Root hooks and grants

- `registerAccountCompletion(app, db, identity)` and `registerPasskeys(app, db, identity)`.
- `touchAccountSession(db, tokenHash(token))` after a valid authenticated session; it updates at most once in five minutes.
- Mount `AccountExtras` beside AccountSecurity for account/trainer settings and admin security. AccountSecurity dispatches `account-security-updated` so recovery count/enabled status reload after enrollment.
- Public `/magic-link`, `/magic-link/:token`, `/recover-authenticator` render `MagicAccess({path})`; login includes `PasskeyLoginButton` and links to the email/recovery views.
- `accountHost` uses verified `request.hostContext` from root host routing, with only configured public origin as fallback. Public/custom host identity filtering remains root request-hook responsibility.
- Runtime: `GRANT SELECT,INSERT,DELETE ON mfa_recovery_codes TO trainer_service; GRANT SELECT,INSERT,UPDATE,DELETE ON auth_passkeys,auth_passkey_challenges TO trainer_service;`.
- Migration021 adds `sessions.session_id` and `last_seen_at`; team migration022 uses IF NOT EXISTS for the latter.
- Critical account emails have `data.category='account'`, `critical=true` and `userId`; notification preferences must not suppress security links/alerts.

### Evidence

Ten focused account tests passed: private session isolation/revocation; assembled-app registration and session activity; hashed recovery and session/MFA invalidation; magic-link single-use/expiry/MFA; reset and magic host/closure protection; uniform missing-provider response; real WebAuthn registration and EC-signed authentication; forged signature, counter replay, missing UV and wrong-browser nonce rejection; revoked/removed-member rejection; revoked registration session and reassigned custom-host rejection. Positive WebAuthn assertions use generated synthetic EC credentials against the actual verifier, not a mocked verification function. No physical authenticator/browser-device compatibility or live email delivery claim. Root broader PostgreSQL/runtime role/build gates remain required.

Account integration is wired in the main application: account/passkey routes, one session activity update after valid host-bound authentication, account extras beside security in member/trainer settings and superadmin security, public email/recovery views, login passkey/email/recovery controls, and custom-host recovery path routing. The existing privacy hooks include notification/preferences export and erasure; the eight privacy checks now exercise those hooks and prove erasure preserves another user's notifications and another workspace's data. Combined account/privacy check: 18 passed. No media/gallery routes are included in this account integration checkpoint.
