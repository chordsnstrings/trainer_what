# Infrastructure operations: backups, host metrics, host actions, coach-domain HTTPS

Branch `feat/infra-ops`, based on `6fa8aba`. Migration `058_host_operations`. Nothing here was deployed or run on the live server; all evidence below is local.

## Plan (written before implementation)

Constraints read from the code first:

- `infra/digitalocean/dispatch.py` and `common.py` on the live server are fixed at bootstrap. `dispatch.py` runs the `host.py` of the release recorded as `current` in `release-state.json`. The *currently deployed* controller validates the next release's Compose file, so this change adds no Compose services or mounts (that would need two main commits). Everything works without Compose changes.
- The bootstrap cloud-init copy of `host.py` has no sibling modules except `common.py`, and the cloud-init payload is limited to 64 KiB (about 45 KiB used). New controller code therefore lives in a new module, `infra/digitalocean/hostops.py`, imported lazily. The bootstrap copy skips operations until the first release is deployed.
- The controller already reaches PostgreSQL through `docker compose exec database psql` as the migration administrator. It uses the same route to read signed action requests and write signed status reports, so nothing new is exposed on the network, and it keeps working while the API is down.
- A rollback that flipped `current` would hand the controller back to an older `host.py` that cannot honour a deploy pause. Rollback therefore records a separate `serving` release and keeps `current` (the controller) unchanged.
- Coach-domain activation (`integrations-completion.ts`) makes an HTTPS request to the domain before activating it. The TLS "ask" endpoint must therefore also allow a short-lived, operator-created issuance allowance for that one domain; otherwise activation could never succeed.

## What was built, per audience

### Super admin

New page `/admin/infrastructure/host` ("Host and backups"), linked from the observer and approved-operations tabs. A compact host-metrics panel also appears on `/admin/infrastructure/observer`. Every route needs `platform_role='admin'` and an authenticator check within the last 10 minutes, and every read or change is written to `admin_operations_audit`.

- **Host metrics with thresholds.** Disk use per filesystem, memory available, the 5-minute load average per CPU, and the state and health of the `database`, `api`, `web`, `worker` and `edge` containers. Each value is marked within limits, warning, critical or not reported.
  - The source is a controller report signed with HMAC. If there is no fresh verified report, the page falls back to figures the API container can see (`/proc`, `statfs`, `os`), clearly labelled. In that case container status is unavailable.
  - Forged, unsigned or stale controller reports are never shown as current.
  - The thresholds are revisioned and immutable, and changes require a reason and are audited.
- **Backups.** The page shows the last successful backup (time, age, size, name, SHA-256), its location ("this server only" or "this server and off-server storage"), the off-server status (uploaded, failed and retried hourly, invalid settings, or local only), the retention policy, the last failure and the last restore check.
- **Host actions.** An admin requests an allowlisted action with a reason and fresh MFA:
  - restart `api`, `web` or `worker`;
  - roll back to the previous deployed release (this also pauses automatic deploys);
  - return to the latest deployed release;
  - re-apply runtime settings;
  - pause or resume automatic deploys;
  - back up now;
  - verify the latest backup.

  Each request is HMAC-signed by the API, picked up by the controller within about five minutes and executed only if it verifies and is on the allowlist. The result is signed and reported back. Every transition is audited: `infrastructure.host_action.requested`, `.canceled`, `.running`, `.succeeded`, `.failed`, `.rejected` and `.expired`.
  - Pending requests can be canceled.
  - Requests expire after 30 minutes.
  - Only one request per action and target can be open at a time, and there are at most 12 per hour.
  - A result not signed by the controller is shown as unverified.
  - A request still "running" after 45 minutes is shown as outcome unknown. The next controller cycle marks it failed with an "interrupted, check the host" message.
- **Deployment state.** The page shows the serving release (with "rolled back" if applicable), the latest and previous releases, whether automatic deploys are paused (and why), and whether coach-domain HTTPS is on.
- **Platform address check.** The page validates a proposed new platform origin. Its checks are listed in "Changing the platform's own address" below, and it lists the procedure steps.
- **Out of scope, explained on the page.** Resizing the server, snapshots, volumes, firewalls, DNS and billing are DigitalOcean account operations. They would need a DigitalOcean API token on the server, and the deployment deliberately keeps the management token off the host (never in cloud-init, images or `runtime.env`), so a compromised application cannot change or buy cloud resources. Arbitrary commands, restores into production and secret changes also stay out: they are manual operator procedures.

### Trainer (coach)

A coach's own domain, once the Super admin activates it, gets an HTTPS certificate automatically:

- Caddy on-demand TLS asks the API before issuing.
- The activation step's HTTPS check now works: activation creates a 15-minute issuance allowance for that one hostname immediately before the check.

There is no new trainer screen. The existing domain request, verify and activation flow is unchanged apart from that allowance.

### Follower (subscriber)

Followers visiting a coach's connected domain get a valid certificate, where before the TLS handshake failed. There is no follower UI change.

## Routes

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/infrastructure/host` | Super admin, fresh MFA | Health, metrics, containers, deploy state, backups, allowlist, recent 50 requests, out-of-scope list |
| `POST /api/v1/admin/infrastructure/host/thresholds` | Super admin, fresh MFA, current admin in DB | `{revision, thresholds, reason}` → new policy revision; 409 `STALE_POLICY` |
| `POST /api/v1/admin/infrastructure/host/actions` | Super admin, fresh MFA, current admin in DB | `{requestId, action, target?, reason}` → signed request; 400 validation, 409 `INTENT_CONFLICT`/`HOST_ACTION_OPEN`, 429 `HOST_ACTION_RATE`, 503 `HOST_SIGNING_UNAVAILABLE` |
| `POST /api/v1/admin/infrastructure/host/actions/:id/cancel` | Super admin, fresh MFA | `{reason}`; only `pending` |
| `POST /api/v1/admin/infrastructure/platform-address/check` | Super admin, fresh MFA | `{url}` → `{valid, origin, current, checks[], procedure[]}` |
| `GET /api/v1/internal/tls/ask?domain=&token=` | The Caddy edge only | 200 when a certificate may be issued, 404 otherwise; 400 for an invalid domain, 403 for a bad token, 503 without the secret |

The ask endpoint is protected in several layers:

- Like the health probes, it is exempt from host mapping (`app.ts`).
- It answers 404 to any request carrying the web proxy's host-provenance headers, so a public request relayed through the edge and web gets nothing.
- It requires `token = HMAC-SHA256(INTERNAL_PROXY_SECRET, "gymmembership-tls-ask-v1")`.
- It has its own rate limit of 120 per minute.
- It caches answers per database: allowed for 60 s, refused for 10 s, at most 2,048 entries. An allowance clears the cached refusal for its host.
- It allows only DNS names: no IP literals, no ports, and never the platform's own name.

Exported functions other packages can use (in `apps/api/src/host-operations.ts`):

- `readBackupStatus(db, { now? })` returns a `BackupStatus` whose `stale` is true when:
  - the latest successful backup is older than the warning age (26 h by default);
  - no successful backup exists;
  - the controller report is stale or unverified;
  - or no controller has reported at all.

  `state` is one of `healthy | warning | stale | missing | unreported | report_stale`. This is the single function for a stale-backup alert.
- `readHostHealth(db)`: evaluated metrics, containers, deploy state, backups and an overall level.
- `tlsIssuancePermitted(db, hostname)` and `permitCertificateIssuance(db, {...})`.

## Controller behaviour (`infra/digitalocean/host.py` and `hostops.py`)

Each timer cycle (about five minutes, under the existing `deploy.lock`) runs in this order:

1. `ensure_runtime()`: unchanged, except that the first Caddyfile of a new server includes on-demand TLS.
2. `hostops.before_deploy`:
   - Requests left in `running` are marked failed, because the lock proves they were interrupted.
   - Up to 5 pending requests are processed. Each is checked for signature, allowlist, target, lifetime and clock skew, and is then rejected, expired, or executed and reported.
   - SQL values travel only as base64 (`convert_from(decode(...))`), so no quoting or psql interpolation is possible.
3. Deployment, unless `deploy-control.json` says it is paused. An unreadable control file counts as paused. `deploy()` now returns whether it recorded a release. After a rollback, a failed deployment restores the *serving* release, and a successful one records it as `previous`.
4. `hostops.after_deploy`: the scheduled backup (skipped in a cycle that attempted a deployment), a retry of a failed off-server copy (at most hourly), and the signed host report. The report goes to `host_status` and to a private local `host-status.json` for console inspection.

Failures in operations never block or fail a deployment. A module that fails to import (other than `ImportError`) is reported and skipped.

### Rollback, return and re-apply

- `switch_release(target)` accepts only the recorded `current` or `previous` release still present on disk. It re-validates that release's Compose file with the existing allowlist, renders the edge for it, recreates `api`, `web`, `worker` and `edge`, and checks local and public readiness with the release header.
- On failure it restores the release that was serving and raises.
- `release-state.json` gains `serving` (and `switched_at`). `current` keeps naming the newest release, so `dispatch.py` keeps running the newest controller.
- Database migrations are never reversed, so the previous release must be compatible with the current schema. That is already the documented rule.
- `reapply_release()` recreates the serving release with the current `runtime.env` and a freshly rendered Caddyfile.

### Coach-domain HTTPS (Caddyfile generation)

`edge_config(endpoint, revision, ask)` keeps the old output byte-for-byte when `ask` is empty. With `ask`, it adds:

```
{
    on_demand_tls {
        ask http://api:4000/api/v1/internal/tls/ask?token=<derived>
    }
}
<platform block unchanged>
https:// {
    tls {
        on_demand
    }
    <same encode / release header / reverse_proxy with X-Forwarded-For overwrite>
}
```

- On-demand TLS is on by default. Set `EDGE_ON_DEMAND_TLS=false` in `runtime.env` to keep the platform-only edge.
- The ask URL must match `http://api:4000/...token=<64 hex>` or the controller refuses to render.
- The derived token is not the secret. The Caddyfile is written with mode 600 and mounted read-only, as before.
- For coach domains, set `DOMAIN_CNAME_TARGET` to the platform host name (for example `gymmembership.<ip>.sslip.io`), which resolves to the server.
- **Rollout.** The first deployment of this change is made by the old controller, which writes the old-format Caddyfile. The new edge configuration takes effect on the next deployment, on a rollback or return, or immediately after "Re-apply runtime settings".

### Backups

- **Schedule.** Every `BACKUP_INTERVAL_HOURS` (default 24, range 1–168), measured from the last success with a 5-minute tolerance. After a failure the next try waits at least an hour. The backup is never taken in a cycle that attempted a deployment.
- **Format.** `pg_dump -U trainer_migrations -Fc -Z 6 trainer`, streamed from the database container and encrypted on the fly with `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -salt`.
  - The passphrase is `hex(HMAC-SHA256(SECURITY_ENCRYPTION_KEY, "gymmembership-backup-encryption-v1"))`. It is passed through the environment of the `openssl` process only, never as an argument.
  - Files are written to `/opt/gymmembership/backups/scheduled/<UTC>.dump.enc`, with mode 600 in a 700 directory.
  - The plaintext is never written to disk. The first bytes must be the custom-format magic `PGDMP`, or the backup is discarded.
- **Integrity.** A metadata file `<name>.json` is written only after the encrypted file is complete. It records the SHA-256 and size of the encrypted file, a keyed `HMAC-SHA256(SECURITY_ENCRYPTION_KEY, "gymmembership-backup-mac-v1")` tag, the plaintext SHA-256 and size, a `keyId`, the release, the kind (scheduled or manual) and the off-server status.
- **Retention.** The newest `BACKUP_KEEP` complete backups are kept (default 7, range 2–90). Other files and orphan dumps without metadata are never deleted. Partial files from interrupted runs are removed.
- **Disk guard.** A backup needs at least 1 GiB free and three times the last dump size.
- **Key rotation.** Restore tries the current key and `SECURITY_ENCRYPTION_PREVIOUS_KEYS` by `keyId`. **Keep a private off-server copy of `runtime.env`**: without its keys the backups cannot be decrypted.
- **Off-server copy.** This is optional and happens only when all of the following are set in `runtime.env`:
  - `BACKUP_S3_ENDPOINT` (https origin, for example `https://blr1.digitaloceanspaces.com`);
  - `BACKUP_S3_BUCKET`;
  - `BACKUP_S3_REGION`;
  - `BACKUP_S3_ACCESS_KEY_ID`;
  - `BACKUP_S3_SECRET_ACCESS_KEY`;
  - optionally `BACKUP_S3_PREFIX` (default `gymmembership/backups/`).

  How the copy works:
  - The encrypted dump and its metadata are uploaded with AWS Signature Version 4 (standard library only) and the payload hash in `x-amz-content-sha256`. The stored size is then confirmed with `HEAD`.
  - Redirects are refused, and the credentials are never logged or sent to containers. Compose only interpolates variables it names, so they never reach the containers.
  - If the settings are partial or invalid, the status is `invalid` and nothing is uploaded. With no settings, the status is "local only".
  - The controller never deletes remote objects. Configure a bucket lifecycle rule for remote retention.
- **Restore check (scratch database).** Run `python3 /opt/gymmembership/releases/<sha>/infra/digitalocean/hostops.py restore-check [--backup NAME] [--keep]` as root, or request "Verify the latest backup".
  1. It verifies the checksum and then the keyed tag, before touching the database.
  2. It creates `restore_check_<random>` and streams `openssl enc -d` into `pg_restore --no-owner --exit-on-error` in the database container, comparing the decrypted SHA-256 with the metadata.
  3. It verifies that the migration history is non-empty and known to this release, that tables exist, and counts workspaces and accounts.
  4. It then drops the scratch database, unless `--keep` is given.

  The result is recorded as `lastVerification`. Other subcommands are `status`, `list` and `backup`. They take the controller lock and refuse to run while a cycle is active.
- **Production restore (manual, documented and not automated).**
  1. `restore-check --keep` produces a verified scratch database.
  2. Stop `api`, `web` and `worker`.
  3. Rename `trainer` to `trainer_before_restore` and the scratch database to `trainer` (as `trainer_migrations`).
  4. Re-run the runtime-role grants (`infra/runtime-role.sql`, as the controller does after migrations) and request "Re-apply runtime settings".
  5. Reconcile provider receipts and journals as `docs/DEPLOYMENT.md` requires.
- **Pre-deployment dumps.** The existing plaintext dumps in `backups/<ns>.sql` (mode 600) are unchanged. They are a fast rollback aid, and existing tests cover them.

## Changing the platform's own address (item 5)

Validation is `checkPlatformAddress`, available through the admin route and the host page:

- **Format.** HTTPS; a DNS name (not an IP literal); no port other than 443; no path, query, fragment or trailing slash.
- **No clash with a coach domain.** The name must not be an existing coach-domain mapping or a live allowance.
- **Same server.** The name must have A or AAAA records sharing an address with the current name.
- **Passkeys.** Counts the passkeys whose `rp_id` is the current hostname, with a warning.
- **Other changes.** Notes that sessions end and that provider callbacks change.

The controller already validates `PUBLIC_APP_URL` (`Expected a public HTTPS origin`).

Procedure:

1. Create A (and AAAA, if used) records for the new name pointing at this server, and wait until the check passes.
2. Tell people with passkeys what to expect. WebAuthn binds each passkey to its relying-party ID, the current hostname (`passkeys.ts` uses `new URL(origin).hostname`). After the move those passkeys stop working. People sign in once with password and authenticator (or a recovery code), then register a new passkey. Sign-in cookies are host-only, so everyone signs in again. Email links already sent keep the old address.
3. In the DigitalOcean console, edit `PUBLIC_APP_URL` in `/opt/gymmembership/runtime.env`. Keep mode 600 and every other value unchanged.
4. Request "Re-apply runtime settings". The controller renders the edge for the new name, recreates the services and checks readiness at the new address, including a certificate for the new name. If that fails, restore the old `PUBLIC_APP_URL` and request re-apply again.
5. Update the Stripe webhook endpoint, the wearable OAuth redirect addresses and `DOMAIN_CNAME_TARGET`, then re-run the live checks.

## Settings and flags

`runtime.env` on the host holds all of these. They stay host-only, never reach containers and are never logged:

- `BACKUP_INTERVAL_HOURS`
- `BACKUP_KEEP`
- `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_PREFIX`
- `EDGE_ON_DEMAND_TLS`

Existing settings that are reused:

- `INTERNAL_PROXY_SECRET` derives the host-action and report signing key and the ask token.
- `SECURITY_ENCRYPTION_KEY` and `SECURITY_ENCRYPTION_PREVIOUS_KEYS` derive the backup encryption and authentication keys.
- `DOMAIN_OPERATIONS_ENABLED` and `DOMAIN_CNAME_TARGET` are unchanged.

## Migration 058 (`packages/db/migrations/058_host_operations.sql`)

- `host_status`: the latest report per source (`controller` or `api`). Controller rows must be signed. Payloads are at most 256 KiB.
- `host_monitor_policies`: revisioned thresholds, immutable (trigger `immutable_record`), with defaults as revision 1.
- `host_action_requests`: signed intent. The action and target are checked against the allowlist, and the lifetime is at most one hour.
  - A trigger keeps intent columns immutable, allows only `pending → running|rejected|expired|canceled` and `running → succeeded|failed`, seals finished rows and forbids `DELETE`.
  - A partial unique index allows one open request per action and target.
- `tls_issuance_allowances`: one row per hostname, lasting at most 30 minutes (15 minutes is used).

These are system tables: revoked from `PUBLIC` and `trainer_app`. The runtime grants in `infra/runtime-role.sql` are `SELECT, INSERT, UPDATE` on `host_status`, `host_action_requests` and `tls_issuance_allowances`, and `SELECT, INSERT` on `host_monitor_policies`. `scripts/verify-runtime-access.mjs` classifies all four tables and asserts that the tenant role cannot read them.

## Files

- **New:**
  - `apps/api/src/host-operations.ts`
  - `apps/web/components/host-operations.tsx`
  - `apps/web/app/host-operations.css`
  - `infra/digitalocean/hostops.py`
  - `packages/db/migrations/058_host_operations.sql`
  - `tests/infra-ops-api.test.ts`
  - `tests/infra-ops-tls.test.ts`
  - `tests/infra-ops-contract.test.ts`
  - `tests/infra-ops-web.test.ts`
  - `tests/test_hostops_deployment.py`
  - `tests/hostops_report_contract.py` and `tests/hostops_sql_contract.py` (helpers run by the contract test)
  - this document
- **Changed:**
  - `apps/api/src/app.ts`: import, probe exemption for the ask path, registration.
  - `apps/api/src/integrations-completion.ts`: import, plus an allowance created before the activation HTTPS check.
  - `apps/api/src/infrastructure-observer.ts`: wording of two "not connected" sources.
  - `apps/web/app/layout.tsx`: CSS import.
  - `apps/web/components/app-routes.ts`: `infrastructure_host`.
  - `apps/web/components/workspace.tsx`: import and one route branch.
  - `apps/web/components/infrastructure-observer.tsx`: tab link and compact panel.
  - `apps/web/components/infrastructure-actions.tsx`: tab link.
  - `infra/digitalocean/host.py`
  - `infra/Caddyfile.example`
  - `infra/runtime-role.sql`
  - `scripts/verify-runtime-access.mjs`
  - `scripts/browser-check.mjs`: visits the new page.
  - `tests/test_host_deployment.py`: the bootstrap-edge assertion now expects two proxy blocks, each overwriting `X-Forwarded-For`.
  - `docs/DIGITALOCEAN_DEPLOYMENT.md`: a short pointer paragraph.

## Checks actually run (local, 27 September 2026)

- `npx tsc --noEmit`: passed (exit 0) after the final changes and formatting.
- `node --import tsx --test --test-concurrency=1 tests/infra-ops-api.test.ts tests/infra-ops-tls.test.ts tests/infra-ops-contract.test.ts tests/infra-ops-web.test.ts` (embedded PGlite): 19 tests, 19 passed, 0 failed, 0 skipped.
- `/opt/tools/pg-sandbox.sh 56115 <worktree>` with the same four new files plus `integrations-completion`, `infrastructure-actions`, `infrastructure-observer`, `host-routing` and `rate-limits` (restricted `trainer_service` role, PostgreSQL 16):
  - `verify-runtime-access` reported `{"runtimeAccess":"verified","migrations":46,"systemTables":40,"scopedTables":33,"helpers":9}`;
  - 9 files, 58 tests, all passed, `PG_SELECTED_FAILED_FILES=0`.
- Related existing files on PGlite: `integrations-completion`, `infrastructure-observer`, `infrastructure-actions`, `host-routing`, `rate-limits`, `fix2-edge-deploy`, `fix-edge`, `fix-web` and `platform`, with 101 tests, all passed. Domain activation in `integrations-completion` runs through the new allowance hook.
- `python3 -m unittest discover -s tests -p 'test_*deployment.py' -v`:
  - 89 tests OK with 1 skip. The skip is Caddy validation when no Caddy binary is available. The 89 are the existing 56 plus 33 new.
  - With `CADDY_BIN` set to the official Caddy **2.11.4** linux-amd64 release binary (the version pinned for the edge image), all 89 passed with no skips. The legacy, on-demand and bootstrap Caddyfiles each validated with `caddy validate`. In GitHub Actions the test falls back to `docker run caddy:2.11.4-alpine caddy validate`.
- **Cross-language contracts:**
  - A report produced by the real Python `build_report` and `write_report` code is verified and parsed by the API.
  - The controller's generated SQL for pending requests, transitions with audit rows, and the report upsert was executed against the real schema, both on PGlite and in pg-sandbox as the restricted role.
  - The fixed signature vectors match between TypeScript and Python.
- **SigV4.** The implementation reproduces three published AWS vectors: SigV4 `get-vanilla`, and the S3 GET-object and PUT-object examples. The upload was tested against a local HTTP fixture server, not a real bucket.
- **Manual end-to-end check (not committed).** A real Caddy 2.11.4 ran with `local_certs`, on-demand TLS and `ask` pointed at the real API ask route (PGlite, one active mapping). The mapped name got a certificate and was served (`served coach.e2e-fixture.test`). An unmapped name was refused during the TLS handshake (`tlsv1 alert internal error`). During the first attempt Caddy installed its local development root into this sandbox's trust stores; it was removed with `caddy untrust`, and a check confirmed it was absent from `/etc/ssl/certs/ca-certificates.crt`. The retried run used `skip_install_trust`.
- Not run: `npm run build`, the full `npm test`, the browser journey, and anything on Docker or the live server (at the coordinator's instruction, and the machine has no Docker daemon).

## Left out, and why

- **Resizing or cloud-account actions.** These need a DigitalOcean token on the server, which the deployment deliberately does not hold (see above).
- **Alert delivery for stale backups or host thresholds.** `readBackupStatus()` and `readHostHealth()` are provided for the separately assigned alerts work. This package does not send notifications, and host thresholds have no recommendation lifecycle like the process observer's.
- **Remote retention and deletion.** Left to a bucket lifecycle rule, so the server never holds delete intent on off-server copies.
- **Encrypting the pre-deployment dumps.** Left unchanged to keep the tested deploy and rollback path identical. They stay private (mode 600, directory 700) on the same disk.
- **Automated production restore.** Documented as a manual procedure. Only restores into a scratch database are automated.
- **Live verification.** Deployment is separately assigned. None of the following has been exercised on the GymMembership server: on-demand certificates from Let's Encrypt, Spaces uploads, host actions, or the new controller.
- **Pickup latency.** The host controller acts on requests on its existing five-minute timer. A faster loop would exceed GitHub's unauthenticated API budget, because each cycle checks main.
