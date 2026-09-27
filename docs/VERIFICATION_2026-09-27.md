# Application completion verification — 27 September 2026

The owner authorized finishing application work, auditing it and merging to main. Real-service connections, payments and deployment are deferred. Screenshots remain waived. This record supersedes September 25 feature-gap lists; historical observations remain in their original files.

## Completed application scope

- Voluntary client communication/exercise/travel context, with current membership, consent, revision, privacy and display-only boundaries.
- Affiliate agreements, pinned aggregate provider receipts, immutable corrections/statements, exact bank-evidence posting to the existing ledger, trainer visibility and Superadmin controls. Unresolved clawbacks block payment execution; pending obligations block workspace closure. No consumer affiliate tracking or invented provider contract.
- Guarded primary-worker pause/resume/cycle-interval operations. Disabled-by-default policy, explicit proposal and approval, current role/MFA, resource/policy revisions, expiry, cost/action limits, atomic retry safety and revision-safe rollback. No arbitrary command, infrastructure purchase or remote cloud operation is permitted.
- Earlier completion-branch work remains connected: onboarding, trainer teaching and qualified coaching, nutrition, subscriptions/finance, websites/galleries, attachments, notifications/push, privacy/accounts, supported integration adapters, scoped support and operational observations.

## Checks and corrections observed locally

- Four client-context checks passed.
- Six affiliate/MFA checks and sixteen finance regressions passed together: 22 tests.
- Infrastructure action and observer checks passed. An additional assembled-application regression was added after detecting an overlap with the legacy observe-only rejection endpoint.
- The first combined run reported 366 tests: 353 passed and 13 failed. Ten failures were consequences of the route collision; three concerned the health endpoint's per-user request budget.
- After corrections, the affected account/acquisition/branding/attachment/infrastructure suites passed all 40 tests. Host routing and rate-limit suites passed all nine tests. These counts overlap other runs and are not a new combined-suite total.
- Health/readiness probes retain their host-independent response, but supplied sessions are verified for rate-limit identity; invalid cookies remain in the anonymous IP budget. Probes do not extend session activity.
- Shared MFA verification now rejects invalid, stale and future timestamps. Production behavior and explicit sensitive development checks preserve the existing step-up requirement.
- Whole-tree TypeScript passed. The production web build passed after replacing a corrupt restored Turbopack cache. Browser-script syntax passed.
- Deployment boundary suite ran 37 tests: 36 passed, one Docker-only case skipped because Docker is unavailable locally. Provider and infrastructure calls in these tests are synthetic.
- Local browser installation failed because the Playwright CDN returned invalid archives. No local browser success is claimed. GitHub must run the full suite, non-owner PostgreSQL permission gate, container build/readiness and functional browser journeys before merge.

## First GitHub qualification

PR #1 runs the combined checks. Run `36293353753` passed fresh PostgreSQL migrations and non-owner runtime grants before its full database suite. The application job exposed a real Compose boundary defect: inherited controller environment values could override the private runtime file. The controller now inherits only ordinary process settings, pins the requested release and obtains application credentials/approval flags from the reviewed runtime file. Remote Docker/Compose overrides are excluded. A regression protects this boundary; 38 local deployment checks ran, 37 passed and the Docker-only case remained skipped. The next CI run must verify real Compose rendering and the remaining application/browser/container gates.


### 27 September — PostgreSQL runtime and job fixes

The non-owner PostgreSQL suite exposed tenant-table reads in payment projections, an unnecessary UPDATE lock on recovery codes, and microsecond lease tokens that JavaScript truncated. Payment callbacks now read through their validated tenant identity, recovery remains serialized by the existing security-row lock, and forward migration041 stores leases at millisecond precision for exact compare-and-set retries. No runtime grants were broadened. Test setup now uses tenant transactions for scoped tables; immutability probes recognize permission denial, and PostgreSQL-specific observer checks require real connection metrics. CI clones its disposable migrated database per test file to prevent global policy/queue fixtures contaminating other files, while every test still runs with the restricted runtime role. TypeScript and script syntax pass; final suites are running.

## External phase

Real Stripe/Lean contracts and bank finality, actual provider/model quality, real device push/camera/wearables/voice, registrar/DNS/TLS, live email, reviewed legal/retention/residency policy, hosted backup/restore and operational load/canary qualification require the next real-services phase. Native HealthKit/BLE is separate platform scope, not provided by the PWA. Actual cloud telemetry/scaling adapters remain disabled pending real account/resource qualification; the shipped infrastructure executor controls only the application worker. No production release or live transaction is claimed.

- Second CI application job passed all 367 tests, TypeScript, production build and all 38 deployment checks. Browser execution reached analytics consent and caught a stale fixture expectation: arbitrary channel names are intentionally normalized to `other`. The harness now uses supported `instagram`/`newsletter` channels; privacy filtering is unchanged. The targeted account/payment/notification/push rerun after the PostgreSQL fixes passed all 50 tests locally. Final PostgreSQL/browser qualification is still pending.

### 27 September — Retention scope and final fixture corrections

PostgreSQL now passes payment callbacks, MFA recovery and worker lease/retry checks. The expanded database run exposed retention loading tenant policies/events before entering the tenant role. Retention now reads a bounded owner-authorized projection under RLS, joins only that projection to privileged provider evidence, and returns to the tenant role for output and notifications. Runtime grants remain narrow. Remaining test-only setup/assertion reads now use the proper tenant role; global settings tests use isolated databases without migration credentials; observer tests enable actual PostgreSQL metrics. Browser journeys explicitly decline optional analytics in each new browser context so the consent panel does not cover controls. Consolidated current handoff status and preserved historical stage evidence.

### 27 September — Browser preference persistence and final retention fixture

Browser execution verified offline workout replay and preference saving, then found the saved textarea content affecting its implicit label after reload. Client-context textareas now have stable accessible names. The guarded synthetic browser seed records explicit coaching consent for Sam so trainer read-only context checks satisfy the real consent gate. PostgreSQL reached363/367 passing checks; the four remaining failures shared a test-only retention event insert using the service role. Split provider receipts and scoped audit inserts, including bounded overflow fixtures; all eight retention tests pass locally. TypeScript passes. The next CI run must qualify the complete browser and PostgreSQL/container paths.

### 27 September — PostgreSQL/container qualification and stable shared form labels

Run36294655491 passed all367 PostgreSQL tests as the non-owner runtime, all40 migrations,35 system/33 scoped table classifications and nine privileged helpers, plus the production container build and readiness probe. Application tests/typecheck/build also passed. Browser flows reached and passed client-context persistence/trainer read-only access, offline workout and meal replay, grocery persistence and private gallery upload; gallery visibility exposed implicit labels containing select-option text. Galleries, workspace, coaching, training and nutrition now share a label component binding controls to their visible label text, preserving existing explicit accessible names. TypeScript passes; final browser requalification remains before merge.
