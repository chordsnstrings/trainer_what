# Apple HealthKit sync — server API (work package `feat/healthkit`)

Status: server side, web screens, worker maintenance and tests implemented and checked on
this branch. The native iOS companion app is **not** built (it needs native iOS work, an
Apple developer account, the HealthKit entitlement and App Store review, none of which can
be produced here). The feature ships switched off (`HEALTHKIT_SYNC_ENABLED=false`) until that
app exists. Companion contract: [`docs/HEALTHKIT_SYNC_API.md`](../HEALTHKIT_SYNC_API.md).

## Plan (written before implementation)

Existing code read first:

- `apps/api/src/app.ts` `POST /api/v1/wearables/import` — the Apple export import. Gates:
  `APPLE_IMPORTS_ENABLED !== "false"`, `FILE_IMPORTS_APPROVED === "true"` under strict security,
  `integration_actor_is_current`, consent record `wearable:<source>` with version
  `<legal wearable version>|integration-consent:v1`. Stores one `records` row, kind `wearable`,
  `data.observations[] = {type, value, unit, measuredAt}`, `allowedUses = [render, deterministic_feature]`.
- `packages/domain/src/client-twin.ts` — the Client Twin reads every `wearable` record whose
  `allowedUses` contains `deterministic_feature`, recognises HealthKit type identifiers and
  `sleep_minutes`, and dedups by `(source, metric, time, value)`.
- `apps/api/src/integrations-completion.ts` — WHOOP/Zepp connections, `disableUserIntegrations`
  (general wearable consent withdrawal), `POST /integrations/:provider/revoke` (source consent
  withdrawal, records restricted to `render`), OAuth state carrying the tenant id so a
  tenant-scoped lookup can run before identity is known.
- `apps/api/src/operations.ts` `DELETE /api/v1/wearables/:id`, `privacy-hooks.ts`
  export/erase/close hooks, `admin-operations.ts` support "wearables" view,
  `onboarding.ts` trainer wearable policy (`none | permitted_imports`), `host-routing.ts`
  (origin check for every non-GET request, custom-host tenant binding).

Design: platform switch on the Apple Health settings card; trainer opt-in through the
wearable policy; member consent + one-time pairing code; hashed device token carrying the
workspace id; bearer-only device routes exempt from the browser origin check; idempotent
batch uploads with strict validation and limits; one synchronized-day record per member
and local day in the export-import observation model; revocation, deletion, export and
erasure through the existing privacy rules; support view and worker maintenance.

## What was built

### Super admin (platform operator)

- New switch **Enable automatic sync from the HealthKit companion app**
  (`HEALTHKIT_SYNC_ENABLED`, default `false`) on the existing Apple Health integration card
  (`packages/providers/src/configuration.ts`). The card's notes explain that the companion
  app is not part of this release. `APPLE_IMPORTS_ENABLED` and `FILE_IMPORTS_APPROVED` still
  apply.
- `integrationStatus()` has a new `apple_healthkit` entry (configured = switch on;
  approved = switch on and the Apple import gates pass). It appears in the readiness report
  (`npm run readiness` prints `integrations`) and on the trainer Integrations page.
- Support view **Wearables** (`/admin/wearables`, `GET /api/v1/admin/operations/wearables`)
  now lists paired HealthKit devices first: id, member id, status, platform, revoked reason,
  last sync, last error code, batch and entry counts. No tokens, hashes or health values.

### Trainer (workspace owner)

- Wearable policy (onboarding step `wearables`) gains **Allow permitted imports and Apple
  Health sync** (`permitted_imports_and_sync`). Automatic sync needs exactly this choice.
  Switching away pauses devices (uploads refused with `HEALTHKIT_POLICY`) without revoking
  them; switching back resumes them.
- The policy `none` now also blocks the existing Apple export file import
  (403 `WEARABLE_POLICY`); unset or deferred policies keep the previous behaviour.
- Client profile Client Twin shows the new metrics (daily steps, daily active energy,
  wearable workout minutes) alongside resting heart rate, HRV, body mass and sleep duration
  (the sleep label changed from "Self-reported sleep duration" to "Sleep duration" because
  it now includes device-recorded sleep).
- Progress page (`/app/progress`; its client selector is shown to trainers who open it —
  the trainer navigation has no direct link, as before): new **Activity from Apple Health**
  card for the selected client with the last 14 synchronized days, backed by
  `GET /api/v1/healthkit/activity?userId=`. Only rows whose use is permitted are shown and
  nothing is shown when the client withdrew wearable permission.
- Trainers can pair their own devices from `/trainer/integrations` (the panel links them to
  the policy step when sync is not enabled).

### Follower (subscriber)

- **Connections** (`/app/wearables`) has an **Automatic Apple Health sync** panel:
  - clear states: platform switch off, coach has not enabled it, wearable permission
    withdrawn, available;
  - explicit permission checkbox, **Create pairing code** (12 characters, one use,
    10 minutes, a new code cancels older ones), the server address to type into the app,
    **Cancel code**;
  - paired devices with pairing date, last sync, entry count, pause reason
    (policy/consent/quota/platform) or revocation reason, and **Disconnect** (confirmation);
  - **Delete synced data** (confirmation) removing every HealthKit-synced day.
- Pairing sends an account notification (in-app and email when email is configured)
  naming the device.
- The member's Client Twin ("Coaching context", `/app/twin`) and Progress page
  (`/app/progress`, new **Activity from Apple Health** card) use the synchronized data.
- Existing controls keep working: **Revoke use** of Apple Health (Imported sources) revokes
  every device and restricts all Apple Health rows to display; withdrawing wearable
  permission revokes every device; privacy export includes devices and receipts.

### Companion app (contract only; app not built)

`POST /api/v1/healthkit/device/pair`, `GET /api/v1/healthkit/device/status`,
`POST /api/v1/healthkit/device/samples`, `POST /api/v1/healthkit/device/unpair`, bearer
`hk1.<workspace-id>.<secret>`. Types: workout, heart rate (hourly statistics), HRV SDNN,
resting heart rate, sleep analysis, steps and active energy (daily statistics), body mass;
`deletedSampleIds` for Health-app deletions. Limits: 1,000 entries and 1 MiB per batch;
per-type batch limits; per-day storage caps; 90-day look-back; 10-minute future tolerance;
30 uploads/minute and 1,000 uploads + 50,000 entries per UTC day per device; 5 devices per
member; 20 invalid tokens per client address per 10 minutes. Full details in
`docs/HEALTHKIT_SYNC_API.md`.

## Routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/v1/healthkit/status` | session | Availability, coach policy, consent, devices, synced days, pending code |
| `GET /api/v1/healthkit/devices` | session | Paired devices (no credentials) |
| `POST /api/v1/healthkit/pairing-codes` `{consent:true}` | session + origin, 10 per 10 min | Records consent, returns a one-time code |
| `POST /api/v1/healthkit/pairing-codes/cancel` | session + origin | Cancels outstanding codes |
| `POST /api/v1/healthkit/devices/:id/revoke` | session + origin | Disconnects a device |
| `POST /api/v1/healthkit/data/delete` `{confirm:true}` | session + origin | Deletes synced day rows |
| `GET /api/v1/healthkit/activity?userId=&days=` | session (self, or owner/staff for a subscriber) | Per-day summary for Progress |
| `POST /api/v1/healthkit/device/pair` | pairing code, 10 per 10 min per address | Issues the device token |
| `GET /api/v1/healthkit/device/status` | device token, 30/min | Device state and whether uploads are allowed |
| `POST /api/v1/healthkit/device/samples` | device token, 30/min, 1 MiB | Batch upload |
| `POST /api/v1/healthkit/device/unpair` | device token, 10/min | Device revokes itself |

## Settings and flags

- `HEALTHKIT_SYNC_ENABLED` (new, Apple Health card, default `false`).
- Existing: `APPLE_IMPORTS_ENABLED`, `FILE_IMPORTS_APPROVED`.
- Trainer policy value `permitted_imports_and_sync` (stored in the `onboarding_step` record).

## Migration `060_healthkit_sync.sql`

- `healthkit_devices` (tenant-scoped, RLS `tenant_scope` + restrictive `personal_scope`
  like `integration_connections`; `token_hash` unique, SHA-256 only; status, revocation
  reason, consent version, daily quota counters, receipt counters, last error code).
- `healthkit_sync_batches` (upload receipts: `(tenant_id, device_id, batch_id)` primary key,
  request hash, result counts; same RLS; cascades with its device).
- Unique partial index `healthkit_day_record` on `records(tenant_id, owner_user_id,
  data->>'providerKey')` for imported HealthKit day rows.
- Grants to `trainer_app` only; `scripts/verify-runtime-access.mjs` classifies both tables
  as scoped. Pairing codes reuse `one_time_tokens` (purpose `healthkit_pair`), so no system
  table or service grant was added; `infra/runtime-role.sql` is unchanged.

## Worker

`maintainHealthKitSync` (hourly from `apps/worker/src/index.ts`): revokes devices whose
membership ended (`membership_ended`) or whose consent was withdrawn (`consent`), deletes
receipts older than 30 days and pairing codes spent or expired for more than a day.

## Audit events

`healthkit.pairing_code_created`, `healthkit.device_paired`, `healthkit.device_revoked`
(reason member/device), `healthkit.batch_received` (counts only), `healthkit.data_deleted`
(day count). Existing `wearable.revoked` and `consent.changed` cover source and permission
withdrawal.

## Security notes

- Device routes never read the session cookie; `app.ts` skips the browser origin check only
  for `/api/v1/healthkit/device/*`. Member routes keep the origin check (tested).
- Device tokens embed the workspace id so the lookup runs inside that workspace's RLS scope
  (same pattern as the OAuth state); only the SHA-256 is stored. A custom domain only accepts
  its own workspace's tokens and pairing codes.
- Upload transactions take shared workspace advisory locks (so member erasure and workspace
  closure, which take them exclusively, cannot interleave) and the member's integrations lock
  (so uploads, imports, revocations and consent changes for one member are serialized).
- Follower pairing does not require an authenticator step-up: followers generally have no
  authenticator, and WHOOP connection has the same rule. The pairing code is short-lived,
  single-use, rate limited, and every pairing notifies the member.
- Health values are excluded from model prompts and marketing (`restrictions`) and from
  audit events and logs; a test asserts they do not appear in the model-facing coaching
  object.

## Checks actually run

All on this branch, Node 24 (`/opt/node24/bin`).

- `npx tsc --noEmit` → passed (no output).
- `node --import tsx --test --test-concurrency=1 tests/healthkit-mapping.test.ts tests/healthkit-sync.test.ts tests/healthkit-ui.test.ts`
  (embedded PGlite) → **15 tests, 15 passed, 0 failed** (mapping 5, sync API 6, UI 4).
- `/opt/tools/pg-sandbox.sh 56117 <worktree> tests/healthkit-sync.test.ts tests/healthkit-mapping.test.ts tests/healthkit-ui.test.ts tests/integrations-completion.test.ts tests/privacy-lifecycle.test.ts`
  (PostgreSQL 16, restricted `trainer_service` role) → migrations applied;
  `verify-runtime-access` `{"runtimeAccess":"verified","migrations":46,"systemTables":36,"scopedTables":35,"helpers":9}`;
  healthkit-sync 6/6, healthkit-mapping 5/5, healthkit-ui 4/4, integrations-completion 16/16,
  privacy-lifecycle 8/8; `PG_SELECTED_FAILED_FILES=0`.
- Related existing suites on PGlite (files touching the changed shared code):
  integrations-completion, fix-auth, privacy-lifecycle, onboarding-completion,
  provider-configuration, fix-settings → 58/58 passed; host-routing, client-twin-adherence,
  coaching-input-coverage, fix-coaching, admin-completion, rate-limits, settings-runtime →
  33/33 passed; platform, fix-web, fix2-web, fix-db, notifications → 70/70 passed.
  After the last code change all 18 files were re-run together with
  `node --import tsx --test --test-concurrency=2 <the 18 files>` → **161 tests, 161 passed,
  0 failed**.
- `npx prettier --write` on the new files only. `admin-operations.ts` and
  `training-workspace.tsx` were already not Prettier-formatted before this change and were
  left as they were apart from the small edits.

Not run: the full test suite, `next build`, a browser check (no cloud browser; screenshots
waived). The web screens were checked by server rendering their presentational components
(`tests/healthkit-ui.test.ts`) and by the typecheck.

## Left out, with reasons

- **The native iOS companion app** (HealthKit queries, background delivery, Keychain
  storage, App Store review): native platform work outside this repository and environment.
- **QR code** for pairing: no QR library is installed and dependencies were not added; the
  code is short enough to type.
- **Propagating deletions into rows whose use was already revoked**: `deletedSampleIds`
  apply to active (imported) day rows; revoked rows stay as history until the member
  deletes them or erasure runs.
- **Per-device deletion of synced data**: day rows are shared by all of a member's devices
  (so duplicates across iPhone and iPad collapse); deletion is per member.
- **Readiness flag list**: `scripts/readiness.ts` `flags` was not edited; the new state is
  visible through its `integrations` output (`apple_healthkit`).
- **Account suspension check on device routes**: another package adds account suspension;
  if it lands, the device authentication path (`authenticate` in
  `apps/api/src/healthkit-sync.ts`) should also refuse suspended accounts.
