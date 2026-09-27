# Apple HealthKit companion sync API

Contract between the server and a future native iOS/iPadOS companion app that reads
HealthKit and uploads it in the background. The server side is implemented in
`apps/api/src/healthkit-sync.ts` (routes) and `packages/domain/src/healthkit.ts`
(validation and mapping); migration `060_healthkit_sync.sql` adds the tables.

**The companion app itself does not exist yet.** It needs native iOS work, an Apple
developer account, the HealthKit entitlement and App Store review, none of which can be
produced in this repository. Until it is published the platform switch stays off.

## 1. When sync is accepted

Every pairing and upload checks, in this order:

| Check | Where it is set | Error when it fails |
| --- | --- | --- |
| `APPLE_IMPORTS_ENABLED` is not `false` | Super admin → Integrations → Apple Health | 503 `APPLE_IMPORTS_DISABLED` |
| `FILE_IMPORTS_APPROVED` is `true` (production security mode) | Super admin → Application settings | 503 `IMPORT_REVIEW_PENDING` |
| `HEALTHKIT_SYNC_ENABLED` is `true` (default `false`) | Super admin → Integrations → Apple Health | 503 `HEALTHKIT_SYNC_DISABLED` |
| The trainer's wearable policy is `permitted_imports_and_sync` | Trainer onboarding → Wearable policy | 403 `HEALTHKIT_POLICY` |
| The member's latest `wearable:apple_health` consent is granted and general `wearable` permission is not withdrawn | Member, when creating a pairing code; Privacy settings | 403 `CONSENT_REQUIRED` (upload), 409 `WEARABLE_PERMISSION_WITHDRAWN` (code) |
| The member still belongs to an active workspace | Membership / workspace lifecycle | 403 `MEMBERSHIP_ENDED` / `WORKSPACE_CLOSED` |
| The device is paired and not revoked | Pairing / Connections page | 401 `DEVICE_TOKEN_INVALID` / `DEVICE_REVOKED` |

These are the same platform gates as the Apple Health export import
(`POST /api/v1/wearables/import`), which now also refuses imports with 403
`WEARABLE_POLICY` when the trainer's policy is `none`.

## 2. Base address and transport

- The member's app shows the server address next to the pairing code: the platform
  address (`PUBLIC_APP_URL`) or the trainer's verified custom domain. Use HTTPS.
- Requests reach the API through the web edge at `/api/v1/...`. The body limit for uploads
  is 1 MiB (the web proxy buffers up to 10 MB by default, so the API limit applies).
- JSON only: `Content-Type: application/json`.
- The companion routes live under `/api/v1/healthkit/device/`. They never use cookies and
  do not need an `Origin` header. They authenticate only with the device token.
- On a custom domain, a device token only works on the domain of its own workspace
  (403 `HOST_TENANT_MISMATCH` otherwise). The platform address works for every workspace.

## 3. Pairing

1. The member opens **Connections** (`/app/wearables`, trainers: `/trainer/integrations`),
   ticks the permission box and selects **Create pairing code**. The web app calls
   `POST /api/v1/healthkit/pairing-codes` with `{ "consent": true }` (session + same-origin
   only). This records `wearable:apple_health` consent with version
   `<privacy document version>|integration-consent:v1|healthkit-sync:v1` and returns a code
   such as `7K2M-9QXR-4T8V` valid for **10 minutes, once**. A new code cancels the previous
   one. Only the SHA-256 of the code is stored. At most 5 active devices per member.
2. The member types the server address and code into the companion app, which calls:

```http
POST /api/v1/healthkit/device/pair
Content-Type: application/json

{ "code": "7K2M-9QXR-4T8V", "deviceName": "Sara’s iPhone", "platform": "ios", "appVersion": "1.0.0" }
```

- `code`: case-insensitive; spaces and hyphens are ignored; `O`→`0`, `I`/`L`→`1`.
- `deviceName`: 1–60 letters, digits, spaces and `' ’ . _ ( ) -`. It is shown to the member
  and in their security notification.
- `platform`: `ios` or `ipados`. `appVersion` (optional): `[0-9A-Za-z.+-]{1,32}`.

Response `200`:

```json
{
  "deviceToken": "hk1.3f0c…-workspace-id.Q2x…43 characters",
  "device": { "id": "…", "name": "Sara’s iPhone", "platform": "ios", "status": "active", "pairedAt": "…", "lastSyncAt": null, "samplesReceived": 0 },
  "workspace": { "name": "Coach studio" },
  "server": "https://coach.example.com",
  "endpoints": { "status": "/api/v1/healthkit/device/status", "samples": "/api/v1/healthkit/device/samples", "unpair": "/api/v1/healthkit/device/unpair" },
  "limits": { "batchSamples": 1000, "…": "see section 6" },
  "acceptedTypes": ["workout", "heart_rate", "heart_rate_variability", "resting_heart_rate", "sleep_analysis", "step_count", "active_energy", "body_mass"]
}
```

The token is returned **once**; the server stores only its SHA-256. Store it in the
Keychain with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (background delivery runs
while the phone is locked), never in logs, analytics or iCloud backups. The member receives
an account notification (in-app and email) naming the device.

Errors: 400 `PAIRING_CODE_INVALID` (unknown, expired, used or malformed code), 400
`VALIDATION`, 403 `HOST_TENANT_MISMATCH` (code created for another workspace's website; the
code stays usable on the right address), 403 `HEALTHKIT_POLICY`, 403 `CONSENT_REQUIRED`, 403
`MEMBERSHIP_ENDED`, 409 `DEVICE_LIMIT`, 503 gate codes, 429 `RATE_LIMITED`
(10 attempts per 10 minutes per client address). A failed pairing after the code was
accepted uses up the code; create a new one.

## 4. Authentication for device routes

```http
Authorization: Bearer hk1.<workspace-id>.<43-character secret>
```

| Response | Meaning | App action |
| --- | --- | --- |
| 401 `DEVICE_TOKEN_REQUIRED` | Header missing or not `Bearer` | Fix the request |
| 401 `DEVICE_TOKEN_INVALID` | Unknown token (never paired, erased, or wrong server) | Delete the token, stop HealthKit queries, ask the member to pair again |
| 401 `DEVICE_REVOKED` | Disconnected by the member, by the app, by revoked permission or ended membership | Same as above |
| 403 `WORKSPACE_CLOSED` | The workspace closed | Delete the token |
| 429 `TOO_MANY_ATTEMPTS` | More than 20 invalid tokens from one client address in 10 minutes | Back off 10 minutes |

## 5. Endpoints

### `GET /api/v1/healthkit/device/status`

Call before each sync. Updates `lastSeenAt`.

```json
{
  "device": { "id": "…", "name": "…", "status": "active", "lastSyncAt": "…", "lastErrorCode": null },
  "workspace": { "name": "Coach studio" },
  "uploadsAllowed": true,
  "reason": null,
  "endpoints": { "…": "…" },
  "limits": { "…": "…" },
  "acceptedTypes": ["…"],
  "serverTime": "2026-09-27T10:00:00.000Z"
}
```

When `uploadsAllowed` is `false`, `reason` is `{ "code", "message" }` with one of the gate
codes from section 1 (`HEALTHKIT_POLICY`, `CONSENT_REQUIRED`, `MEMBERSHIP_ENDED`, 503 codes).
The device stays paired: stop reading HealthKit and check again later (for example once a
day). Budget: 30 requests per minute per device.

### `POST /api/v1/healthkit/device/samples`

```json
{
  "batchId": "2026-09-27T06-00-00Z-7f3a",
  "samples": [
    { "type": "resting_heart_rate", "id": "6F1C1F3E-8B6A-4C77-9D1E-1F2A3B4C5D6E", "start": "2026-09-26T07:00:00+04:00", "end": "2026-09-26T07:00:00+04:00", "value": 54, "unit": "count/min" }
  ],
  "deletedSampleIds": ["0B3D…"]
}
```

- `batchId` (required, `[A-Za-z0-9_-]{8,64}`): idempotency key, scoped to the device.
  Retrying the same `batchId` with the same body returns the stored result with
  `"replayed": true` and writes nothing. The same `batchId` with a different body returns
  409 `BATCH_ID_REUSED`. After a network failure retry with the same `batchId` and the same
  bytes; use a new `batchId` for new data. Receipts are kept for 30 days.
- `samples`: up to 1,000 entries; `deletedSampleIds`: up to 500 HealthKit UUIDs from
  `HKAnchoredObjectQuery` deleted objects. At least one of the two must be non-empty.
- Unknown fields anywhere are rejected (400 `VALIDATION`), as are duplicate sample ids or
  statistic periods inside one batch and per-type counts above the limits below.
- Times are ISO 8601 **with the device's UTC offset** (`2026-09-26T07:00:00+04:00`; `Z` is
  accepted). The local calendar date in the string decides the day a sample belongs to.

Response `200`:

```json
{ "batchId": "…", "received": 16, "stored": 14, "updated": 1, "duplicates": 1, "deleted": 0,
  "skipped": { "outsideWindow": 0, "dayLimit": 0 }, "days": 2, "replayed": false, "serverTime": "…" }
```

`duplicates` are samples already stored (same HealthKit UUID, or an unchanged statistic);
`updated` are statistics whose value changed (for example today's step total);
`skipped.outsideWindow` are samples ending more than 90 days ago or starting more than
10 minutes in the future; `skipped.dayLimit` are samples over the per-day cap. Skipped
samples should not be re-sent. Budget: 30 uploads per minute per device, plus 1,000
uploads and 50,000 entries per device per UTC day (429 `DAILY_QUOTA`).

### `POST /api/v1/healthkit/device/unpair`

Body `{}`. Revokes this device (for example when the member signs out of the companion
app). Returns `{ "ok": true }`; afterwards every call returns 401 `DEVICE_REVOKED`.
Budget: 10 per minute per device.

## 6. Sample types

| `type` | Shape | Units and ranges | HealthKit source | Per batch | Stored per local day |
| --- | --- | --- | --- | --- | --- |
| `workout` | `id, start, end, activity, durationSeconds`, optional `activeEnergyKcal`, `distanceMeters`, `averageHeartRate` | `activity` snake_case `HKWorkoutActivityType` name (`running`, `traditional_strength_training`); `durationSeconds` ≤ span + 60 s, ≤ 48 h; energy ≤ 20,000 kcal; distance ≤ 1,000 km; heart rate 20–260 | `HKWorkout` via anchored query | 200 | 50 (by local start date) |
| `heart_rate` | hourly statistic: `start, end, unit, average, minimum, maximum`, optional `sampleCount` | `count/min`, 20–260, `minimum ≤ average ≤ maximum`; starts on the local hour, lasts exactly 1 hour | `HKStatisticsCollectionQuery` on `heartRate`, `.discreteAverage/.discreteMin/.discreteMax`, 1-hour interval | 750 | 100 |
| `heart_rate_variability` | `id, start, end, value, unit` | `ms`, 1–1,000 (SDNN) | `heartRateVariabilitySDNN` samples | 500 | 200 |
| `resting_heart_rate` | `id, start, end, value, unit` | `count/min`, 20–200 | `restingHeartRate` samples | 200 | 24 |
| `sleep_analysis` | `id, start, end, stage` | `stage`: `in_bed`, `asleep_unspecified`, `awake`, `asleep_core`, `asleep_deep`, `asleep_rem`; ≤ 24 h | `HKCategoryTypeIdentifierSleepAnalysis` | 1,000 | 500 (by wake date) |
| `step_count` | daily statistic: `start, end, value, unit` | `count`, 0–200,000; starts at local midnight, 23–25 h long | `HKStatisticsCollectionQuery` on `stepCount`, `.cumulativeSum`, 1-day interval anchored at local midnight | 100 | 10 devices |
| `active_energy` | daily statistic: `start, end, value, unit` | `kcal` (0–20,000) or `kJ` (converted); same day rules | `activeEnergyBurned`, `.cumulativeSum`, 1-day interval | 100 | 10 devices |
| `body_mass` | `id, start, end, value, unit` | `kg` or `lb` (converted), 20–400 kg | `bodyMass` samples | 200 | 24 |

`id` is the HealthKit object UUID. Instantaneous samples may span at most 26 hours.

Use statistics queries for heart rate, steps and active energy: HealthKit then removes
overlap between iPhone and Apple Watch sources. Re-send the last two days of statistics on
every sync so completed days carry their final totals; the server keeps the latest report
per device and period.

## 7. How uploads are stored and used

- One `records` row (kind `wearable`, status `imported`) per member and local day, with
  `source: "apple_health"`, `origin: "apple_healthkit"`, the de-duplicated inputs, and a
  derived `observations[]` array in the same `{type, value, unit, measuredAt}` model as the
  export import. `allowedUses` is `["render", "deterministic_feature"]` and
  `restrictions` is `["no_model_prompt", "no_marketing"]`.
- Observations: `HKQuantityTypeIdentifierRestingHeartRate` (count/min),
  `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` (ms), `HKQuantityTypeIdentifierBodyMass`
  (kg), `HKQuantityTypeIdentifierHeartRate` (hourly average), `HKWorkout` (minutes, with
  activity and optional energy/distance/heart rate), `workout_minutes` (merged workout time
  per day), `sleep_minutes` (merged asleep intervals, excluding in-bed and awake),
  `in_bed_minutes`, `daily_steps` and `daily_active_energy` (maximum across devices).
  Period values (hourly heart rate, daily totals) appear only after the period ends.
- Sleep belongs to the local date on which it ends; a segment ending at or after 18:00
  counts toward the next night.
- The Client Twin (member "Coaching context", trainer client profile) reads these
  observations: resting heart rate, HRV, body mass, sleep duration, daily steps, daily
  active energy and wearable workout minutes. They are never part of the model-facing
  coaching object. The Progress page shows a per-day summary for the last 14 days
  (`GET /api/v1/healthkit/activity`).
- Upload audit events (`healthkit.batch_received`) record counts only.

## 8. Member controls and privacy

| Action | Route (web session) | Effect |
| --- | --- | --- |
| See status, devices and synced days | `GET /api/v1/healthkit/status`, `GET /api/v1/healthkit/devices` | No credentials or hashes are returned |
| Cancel an outstanding code | `POST /api/v1/healthkit/pairing-codes/cancel` | Code can no longer be exchanged |
| Disconnect a device | `POST /api/v1/healthkit/devices/:id/revoke` | Uploads from it stop immediately; synced data stays |
| Revoke Apple Health use | `POST /api/v1/integrations/apple_health/revoke` (existing) | Withdraws consent, revokes every device, restricts all Apple Health rows (file and sync) to display only |
| Withdraw wearable permission | `POST /api/v1/privacy/consent` `{type:"wearable",granted:false}` (existing) | Revokes every device and restricts all wearable rows |
| Delete synced data | `POST /api/v1/healthkit/data/delete` `{ "confirm": true }` | Deletes every HealthKit-synced day row (file imports are untouched) |
| Export | `GET /api/v1/privacy/export` (existing) | Includes synced day rows, `healthKitSync.devices` (no token hashes) and upload receipts |
| Account erasure / workspace closure | Existing privacy lifecycle | Deletes devices, receipts and synced rows |

The worker revokes devices whose membership ended or whose consent was withdrawn, deletes
receipts older than 30 days and spent pairing codes (hourly). Super admin support
(`/admin/wearables`) lists devices with status, last sync, last error code and counts only.

## 9. Error format

All errors are JSON: `{ "code": "…", "message": "…", "requestId": "…" }`. Validation errors
use 400 `VALIDATION` with the failing paths in `message`. 413 means the body exceeded 1 MiB.
Route budgets answer 429 `RATE_LIMITED` with a `Retry-After` header. On 503 or 429, back off
exponentially starting at the `Retry-After` value or one minute.
