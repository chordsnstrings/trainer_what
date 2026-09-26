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
