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

## Stage 2 — booking calendar and public legal reader

Files: `apps/api/src/booking-schedule.ts`, `apps/web/components/bookings.tsx`, `apps/web/components/published-legal.tsx`, `packages/db/migrations/019_bookings_completion.sql`, `tests/bookings-completion.test.ts`.

- Replace the booking route block inside `operationsRoutes` (GET bookings through attendance endpoint) with `registerBookingRoutes(app,db,identity,hooks)`. Retain support/wearable/onboarding routes in operations.ts. Old booking paths and free reservation response shape remain compatible.
- Hooks are optional safe-disabled interfaces: `{preparePaidBooking, startBookingCheckout, refundCanceledBooking, notify:notifyUser}`. Finance exports the first three from finance-bookings.ts. Priced reservations fail unavailable without paid preparation/checkout hooks. Payment preparation runs inside the serialized tenant transaction; provider checkout and refund run after commit. Booking response retains status `payment_pending` and separately exposes `checkoutStatus`. Do not confirm on browser redirect.
- Notification hook uses root's `notifyUser(tx,a,{userId,category:'booking',dedupeKey,title,body,href})` for free reservations, reschedule and cancellation. No direct new email jobs bypass preferences.
- Calendar/time controls: timezone and policy defaults; 1–26 weekly occurrences (up to four-week interval), local clock preservation across daylight changes, rejected nonexistent/ambiguous local times; coach/owner permissions, overlap checks, capacity and same-client overlap protection. Policies are snapshotted on each new slot. Slot edits/cancellation are revision checked, individual occurrences only. Attendance after end only. Paid holds consume capacity for 35 minutes; late payment compensation belongs to finance webhook handling.
- Authenticated `GET /api/v1/bookings/calendar.ics` exports the subscriber's own reservations or trainer's workspace sessions. Private cache headers, escaped/folded iCalendar data. This is a calendar file download, not a live external calendar integration.
- `PublishedLegal({documentKey:'terms'|'privacy'|'ai-disclosure'})` uses `GET /api/v1/public/documents/:key`. The response has `{document:{id,kind,key,version,title,content,effective_at,published_at},versions:[{version,effective_at}]}`. Reader supports historical effective version selection and explicit no-approved-document error. Mount on the three public legal paths.
- Migration019 has no new tables or runtime grants. It adds booking slot timezone, series, revision, policy and price; reservation revision, payment status, hold expiry and cancellation reason.

Verification: targeted booking suite passed 7/7; shared `npm run typecheck` passed. Coverage includes DST invalid/ambiguous clock time, recurrence, concurrent capacity, tenant/subscriber isolation, policy snapshots and cutoffs, CAS/coach ownership, paid pending hook semantics and calendar injection escaping.

## Stage 3 — team administration

Files: `apps/api/src/team.ts`, `apps/web/components/team-controls.tsx`, `packages/db/migrations/022_team_completion.sql`, `tests/team-completion.test.ts`.

Root integration:

- Call `registerTeamRoutes(app,db,identity)` and render `TeamControls({role})` at `/trainer/team`. Replace the broken settings invitation form with a link to the dedicated team view.
- Remove old `DELETE /api/v1/team/:userId` from app.ts, now replaced by MFA/revision/reason-checked deletion. Delegate legacy `POST /api/v1/invitations` for staff/finance to `createTeamInvitation(db,a,body,publicUrl())`; subscriber invitations retain their current workflow. New team invitation form sends valid `staff`/`finance` role values.
- Replace invitation-acceptance initial token SQL with `await lockActiveInvitation(tx, tokenHash(b.token))`. This helper first reads tenant identity, locks `tenantId+':workspace'` then `tenantId+':team'`, then loads the active token FOR UPDATE. It verifies workspace active and the recorded staff/finance invitation issuer is still owner. Do not acquire token lock before workspace/team locks. Existing invitations without an issuer cannot newly grant staff/finance access; create a fresh owner-approved invitation.
- After valid authenticated session lookup, `touchTeamSession(db, tokenHash)` updates last_seen_at only after five minutes. Treat an optional tracking failure as nonfatal to the user request.
- Owner and fresh MFA are checked for every team view/mutation, then current database ownership is rechecked under locks. Ownership transfer is reserved to the privacy workflow. Role changes/revocation invalidate this workspace's active sessions only. Optimistic membership revisions prevent stale edits. Invite replacement revokes older outstanding staff/finance links for that address. Mutations and audit event commit atomically.
- Membership version trigger increments when privacy transfer changes roles. Existing system table grants cover added columns; no new table grants. Session last_seen_at uses IF NOT EXISTS to coexist with migration021. Passkey listing exposes only active credential counts from auth_passkeys, when installed.

Verification: team targeted suite passed 6/6 before the display-only passkey count addition. Cases cover owner/MFA/current-owner checks, invite replacement/revocation/isolation, stale issuer, role CAS/session revocation isolation, owner protection, and throttled last-active reporting. Shared typecheck reported only a concurrent finance-bookings.ts undefined-stripe narrowing issue, relayed to its owner; team files themselves had no errors.
