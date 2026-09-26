# Admin completion handoff — 26 September 2026

## Stage 1 — specialist operations and publishing

Files: `apps/api/src/admin-operations.ts`, `apps/web/components/admin-operations.tsx`, `packages/db/migrations/016_admin_completion.sql`, `tests/admin-completion.test.ts`.

Root integration:

- Import and call `registerAdminOperations(app, db, identity)` with the existing verified actor callback (includes `platformRole`, `mfaAt`). All operations reads and mutations require recent MFA, including development fixtures.
- Mount `AdminOperations({path, platformRole})` for `/admin/{acquisition,trainers,subscribers,brains,safety,finops,wearables,domains,infrastructure,support,security,experiments,configuration}`. Keep current `/admin/settings`, integrations, finance and privacy components. Keep personal `AccountSecurity` accessible separately (e.g. `/admin/account-security`). Trainer/subscriber drilldown paths accept IDs; workspace selection can be specified in `?tenantId=`.
- `TrainerAnalytics` is the business reporting view for owner/finance. Existing subscriber progress and coaching analytics remain separate.
- `getPublishedDocument(db, kind, key)` resolves the effective published immutable version. It uses a system transaction: call before entering a tenant transaction. Kinds: `legal`, `notification`, `support_macro`, `safety`; legal keys: `terms`, `privacy`, `ai-disclosure`. Returns null when no approved effective version exists. New future versions leave today's version effective. Public legal endpoint returns `{document, versions}` and supports an effective historical `?version=`.
- Runtime grants after all migrations: `GRANT SELECT,INSERT,UPDATE ON admin_documents,admin_experiments TO trainer_service; GRANT SELECT,INSERT ON admin_operations_audit,acquisition_events TO trainer_service; GRANT DELETE ON acquisition_events TO trainer_service;`. No trainer_app grants. Deletion of acquisition data additionally requires `SELECT set_config('app.privacy_erasure','true',true)` in the same system transaction. Privacy agent has the schema.
- Optional consented acquisition hooks: `consentedAcquisition(cookieValue)` validates explicit consent + visitor UUID + allowlisted source/campaign/medium; returns null for malformed/unconsented or extra fields. Pass valid metadata to `recordAcquisition(db,{eventKey,name,tenantId?,userId?,visitorId,source,campaign?,medium?})` after successful signup/publish/contact. Names are landing/signup/publish/lead. Stable eventKey prevents duplicate counts. Business success must not fail because analytics recording failed. No health fields are accepted.
- Public experiment assignment endpoint `/api/v1/public/experiments/:key` reads an `acquisition` consent cookie; returns stable visitor bucket for running, consented landing/onboarding copy experiments. It never affects safety, prices, health targeting or authorisation. Stopping is irreversible for that experiment; start a newly reviewed experiment to run again. Surface consumers may render returned copy. Measured analysis is explicit operator-entered result, not invented significance.
- Support mutations use revision checks; macros insert published reviewed text for the operator to send. Safety review annotates triage and never releases an underlying hold. Infrastructure view reports application job state only; host metrics require external monitoring. Email recovery accepts only unleased blocked/failed email jobs with exact attempt count and delivery evidence, preserving intent. Financial/nutrition jobs cannot use generic recovery.

Verification: `npm run typecheck` passed for the shared repository at this stage. `node --import tsx --test tests/admin-completion.test.ts` covers role/MFA gates, effective publication/immutability, tenant-isolated support/CAS, safety hold preservation, email recovery boundaries, consented acquisition/idempotence/erasure and experiment transitions. See coordinating agent for actual passing result and commit.

## Remaining stages owned here

Booking calendar recurrence/timezones/policies/calendar export, paid-session hook integration with finance agent, then team invitations/role changes/revocation with MFA and concurrency checks. No screenshots, deployment or live provider calls.
