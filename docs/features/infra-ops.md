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
  - Forged, unsigned or stale controller reports are never shown as current. A report's age is its signed `generatedAt`, not the `reported_at` column (which any writer of `host_status` could set), so an old signed report written again is shown as stale. A signed report dated more than five minutes ahead of the API clock is refused as invalid.
  - The thresholds are revisioned and immutable, and changes require a reason and are audited.
- **Backups.** The page shows the last successful backup (time, age, size, name, SHA-256), its location ("this server only" or "this server and off-server storage"), the off-server status (uploaded, failed and retried hourly, invalid settings, or local only), the retention policy, the last failure and the last restore check.
- **Host actions.** An admin requests an allowlisted action with a reason and fresh MFA:
  - restart `api`, `web` or `worker`;
  - roll back to the previous deployed release (this also pauses automatic deploys);
  - return to the latest deployed release;
  - re-apply runtime settings;
  - pause or resume automatic deploys;
  - back up now;
  - verify the latest backup;
  - change the platform address (with DNS verification and automatic restore, see "Changing the platform's own address");
  - remove old-address redirects.

  Each request is HMAC-signed by the API, picked up by the controller within about five minutes and executed only if it verifies and is on the allowlist. The result is signed and reported back. Every transition is audited: `infrastructure.host_action.requested`, `.canceled`, `.running`, `.succeeded`, `.failed`, `.rejected` and `.expired`.
  - Pending requests can be canceled.
  - Requests expire after 30 minutes.
  - Only one request per action and target can be open at a time, and there are at most 12 per hour.
  - A result not signed by the controller is shown as unverified.
  - A request still "running" after 45 minutes is shown as outcome unknown. The next controller cycle marks it failed with an "interrupted, check the host" message.
- **Deployment state.** The page shows the serving release (with "rolled back" if applicable), the latest and previous releases, whether automatic deploys are paused (and why), and whether the edge actually serves coach-domain HTTPS. That comes from the Caddyfile on disk, not from `runtime.env`. When the served Caddyfile differs from what the current settings would render (after the rollout by an older controller, a changed `PUBLIC_APP_URL` or `EDGE_ON_DEMAND_TLS`), the page says "Pending re-apply" and names the action to request.
- **Platform address change.** The page shows this server's public IPv4, the root domain and the old-address redirects, previews what a proposed name (and a name under a proposed root domain) resolves to, lists the warnings and the provider settings to update, requests the move and follows its progress. See "Changing the platform's own address" below.
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
| `POST /api/v1/admin/infrastructure/host/actions` | Super admin, fresh MFA, current admin in DB | `{requestId, action, target?, parameters?, reason}` → signed request; `parameters` (`{url, rootDomain?}`) only and always for `change_platform_address`; 400 validation, `HOST_ACTION_PARAMETERS`, `PLATFORM_ADDRESS_INVALID`, `PLATFORM_ADDRESS_UNCHANGED`, 409 `INTENT_CONFLICT`/`HOST_ACTION_OPEN`, 429 `HOST_ACTION_RATE`, 503 `HOST_SIGNING_UNAVAILABLE` |
| `POST /api/v1/admin/infrastructure/host/actions/:id/cancel` | Super admin, fresh MFA | `{reason}`; only `pending` |
| `POST /api/v1/admin/infrastructure/platform-address/check` | Super admin, fresh MFA | `{url, rootDomain?}` → `{valid, origin, current, rootDomain, currentRootDomain, changed, serverIpv4, resolution[], checks[], providerUpdates[], procedure[]}` |
| `GET /api/v1/internal/tls/ask?domain=&token=` | The Caddy edge only | 200 when a certificate may be issued, 404 otherwise; 400 for an invalid domain, 403 for a bad token, 503 without the secret |

The ask endpoint is protected in several layers:

- Like the health probes, it is exempt from host mapping (`app.ts`).
- It answers 404 to any request carrying the web proxy's host-provenance headers, so a public request relayed through the edge and web gets nothing.
- It requires `token = HMAC-SHA256(INTERNAL_PROXY_SECRET, "gymmembership-tls-ask-v1")`.
- Every ask comes from the one edge container, so its rate budget (120 per minute) is keyed by the requested name, not by address. A flood of random names therefore cannot exhaust a shared budget and deny real names.
- Answers come from an in-memory set of permitted names (active verified mappings of active workspaces, plus unexpired allowances with their expiry), loaded in one query per database. The set is re-read at least every 30 s, so a deactivation takes effect within 30 s. An unknown name triggers at most one reload per 5 s, so random-name handshakes cost no query each. Concurrent asks share one load. A new allowance marks the set stale, so the next ask re-reads it.
- It allows only DNS names: no IP literals, no ports, and never the platform's own name.

Exported functions other packages can use (in `apps/api/src/host-operations.ts`):

- `readBackupStatus(db, { now? })` returns a `BackupStatus` whose `stale` is true when:
  - the latest successful backup in the last verified report is older than the warning age (26 h by default), measured against now;
  - no successful backup exists;
  - no verified controller report exists (unsigned, forged or future-dated reports count as none);
  - or the controller has not reported for longer than the backup warning age (`report_stale`).

  A report that is merely older than the report freshness threshold (15 minutes by default, for example during a long image build) sets the separate `reportStale` flag and a note in `message`, but not `stale`. `state` is one of `healthy | warning | stale | missing | unreported | report_stale`. This is the single function for a stale-backup alert.
- `readHostHealth(db)`: evaluated metrics, containers, deploy state, backups and an overall level.
- `tlsIssuancePermitted(db, hostname)` and `permitCertificateIssuance(db, {...})`.

## Controller behaviour (`infra/digitalocean/host.py` and `hostops.py`)

Each timer cycle (about five minutes, under the existing `deploy.lock`) runs in this order:

1. `ensure_runtime()`: unchanged, except that the first Caddyfile of a new server includes on-demand TLS.
2. `hostops.before_deploy`:
   - Restore-check scratch databases (`restore_check_*`) left by a stopped or killed run are dropped, except those kept on purpose with `restore-check --keep` (recorded in `backups/scheduled/state.json`).
   - Requests left in `running` are marked failed, because the lock proves they were interrupted.
   - Up to 5 pending requests are processed. Each is checked for signature, allowlist, target, lifetime and clock skew, and is then rejected, expired, or executed and reported.
   - At most one long action (`backup_now` or `verify_backup`) runs per cycle; a second one stays pending for the next cycle. No request is started when less than 15 minutes of the cycle remain; those stay pending too (they expire after 30 minutes).
   - SQL values travel only as base64 (`convert_from(decode(...))`), so no quoting or psql interpolation is possible.
3. Deployment, unless `deploy-control.json` says it is paused, or a long action ran in step 2 (the deployment then waits one cycle, so the two together stay within the unit's 30-minute `TimeoutStartSec`). An unreadable control file counts as paused. `deploy()` returns whether it recorded a release. After a rollback, a failed deployment restores the *serving* release, and a successful one records it as `previous`.
4. `hostops.after_deploy`: the scheduled backup, a retry of a failed off-server copy (at most hourly), and the signed host report. The report goes to `host_status` and to a private local `host-status.json` for console inspection.

Only a *recorded* deployment (or a long action) defers the scheduled backup by one cycle. A deployment attempt that fails does not: a broken main head is retried every cycle, and backups must continue meanwhile. A backup overdue by more than an hour, or the very first backup, is taken even in a cycle that deployed.

**Cycle time budget.** systemd stops a cycle after 30 minutes, and Python `finally` blocks do not run then. The controller therefore records the cycle start (`host.cycle_remaining()`). A backup or restore check runs with a time limit of at most 20 minutes and never beyond the remaining cycle time minus 3 minutes, so its own timeout (kill the processes, drop the scratch database, record the result) always fires first. A scheduled backup with less than 8 minutes left is deferred to the next cycle without counting as a failure. Console commands run outside a cycle and get the full 20 minutes.

Failures in operations never block or fail a deployment. A module that fails to import (other than `ImportError`) is reported and skipped.

### Rollback, return and re-apply

- `switch_release(target)` accepts only the recorded `current` or `previous` release still present on disk. It re-validates that release's Compose file with the existing allowlist, renders the edge for it, recreates `api`, `web`, `worker` and `edge`, and checks local and public readiness with the release header.
- On failure it restores the release that was serving and raises.
- `release-state.json` gains `serving` (and `switched_at`). `current` keeps naming the newest release, so `dispatch.py` keeps running the newest controller.
- Database migrations are never reversed, so the previous release must be compatible with the current schema. That is already the documented rule.
- `reapply_release()` recreates the serving release with the current `runtime.env` and a freshly rendered Caddyfile. On its own it has no automatic fallback: if readiness fails at the new address, the Caddyfile stays on the new name. The previous Caddyfile alone could not restore service, because the API and web would already run with the new `PUBLIC_APP_URL`. The platform address change action (below) has the fallback, because it saves the previous `runtime.env` and redirects before switching.
- Console recovery: `python3 /opt/gymmembership/releases/<sha>/infra/digitalocean/hostops.py reapply` (as root, under the controller lock) re-reads `runtime.env` exactly as a timer cycle does (`ensure_runtime()`, which refreshes `endpoint.json`) and then re-applies. Use it when the admin page is unreachable. While a platform address change is unfinished it settles that change first and clears it (see "What the controller does", step 6).

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
- **Rollout.** The first deployment of this change is made by the old controller, which writes the old-format Caddyfile. The new edge configuration takes effect on the next deployment, on a rollback or return, or immediately after "Re-apply runtime settings". Until then the host page shows "Platform address only" with "Pending re-apply", because the report compares the Caddyfile on disk with what the controller would render. (The comparison reads the file the edge mounts; it cannot see whether the running Caddy process has loaded it, which it does when the edge container is recreated.)

### Backups

- **Schedule.** Every `BACKUP_INTERVAL_HOURS` (default 24, range 1–168), measured from the last success with a 5-minute tolerance. After a failure the next try waits at least an hour. A cycle that recorded a deployment or ran a long host action defers a due backup by one cycle, unless it is overdue by more than an hour or no backup exists yet. A failed deployment attempt never defers it.
- **Format.** `pg_dump -U trainer_migrations -Fc -Z 6 trainer`, streamed from the database container and encrypted on the fly with `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -salt`.
  - The passphrase is `hex(HMAC-SHA256(SECURITY_ENCRYPTION_KEY, "gymmembership-backup-encryption-v1"))`. It is passed through the environment of the `openssl` process only, never as an argument.
  - Files are written to `/opt/gymmembership/backups/scheduled/<UTC>.dump.enc`, with mode 600 in a 700 directory.
  - The plaintext is never written to disk. The first bytes must be the custom-format magic `PGDMP`, or the backup is discarded.
- **Integrity.** A metadata file `<name>.json` is written only after the encrypted file is complete. It records the SHA-256 and size of the encrypted file, a keyed `HMAC-SHA256(SECURITY_ENCRYPTION_KEY, "gymmembership-backup-mac-v1")` tag, the plaintext SHA-256 and size, `databaseSizeBytes` (`pg_database_size('trainer')` measured just before the dump; null if that query failed), a `keyId`, the release, the kind (scheduled or manual) and the off-server status.
- **Retention.** The newest `BACKUP_KEEP` complete backups are kept (default 7, range 2–90). Other files and orphan dumps without metadata are never deleted. Partial files from interrupted runs are removed.
- **Disk guard.** Free space is the lower of the backup directory's filesystem and Docker's data root (`/var/lib/docker`, where the database volume lives).
  - A backup needs at least 1 GiB free and three times the last dump size before it starts. While it streams, it is stopped (processes killed, partial file removed) if free space falls below 512 MiB.
  - A restore check is sized by the real database, not the compressed dump (a custom-format dump is several times smaller than the database with its indexes). It needs `1.5 × max(databaseSizeBytes recorded with the backup, current size of trainer) + max_wal_size + 1 GiB` free, or it refuses before creating anything. While the restore streams, and every 2 seconds while `pg_restore` builds indexes afterwards, it is stopped if free space falls below `max_wal_size + 1 GiB`. The scratch database is then dropped `WITH (FORCE)`, which also ends the `pg_restore` session inside the container.
- **Key rotation.** Restore tries the current key and `SECURITY_ENCRYPTION_PREVIOUS_KEYS` by `keyId`. **Keep a private off-server copy of `runtime.env`**: without its keys the backups cannot be decrypted. Each platform address change also leaves a full plaintext copy of the previous `runtime.env` (database passwords, `SECURITY_ENCRYPTION_KEY`, `INTERNAL_PROXY_SECRET`, Stripe and other provider secrets) in `/opt/gymmembership/runtime-env-backups` (mode 600, newest 10 kept, never expired). After rotating secrets, delete those copies with `hostops.py purge-runtime-backups` (refused while an address change is unfinished, because its restore needs the copy); otherwise the pre-rotation secrets stay on disk.
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
  2. It drops leftover scratch databases (see step 2 of the cycle), checks free space as described above, creates `restore_check_<random>` and streams `openssl enc -d` into `pg_restore --no-owner --exit-on-error` in the database container, comparing the decrypted SHA-256 with the metadata.
  3. It verifies that the migration history is non-empty and known to a deployed release, that tables exist, and counts workspaces and accounts. The known migrations are the union of the newest recorded release (`current`) and the serving one, so after an operator rollback a healthy backup (which carries the newer migrations) still verifies.
  4. It then drops the scratch database, unless `--keep` is given. A kept scratch database is recorded in `state.json` so the next cycle does not drop it; it holds a full copy of production data, so drop it with `psql` as `trainer_migrations` when the manual restore is done.

  The result is recorded as `lastVerification`. Other subcommands are `status`, `list`, `backup`, `reapply` (console recovery, see "Rollback, return and re-apply") and `purge-runtime-backups` (deletes the saved `runtime.env` copies of address changes, for use after rotating secrets). They take the controller lock and refuse to run while a cycle is active.
- **Production restore (manual, documented and not automated).**
  1. `restore-check --keep` produces a verified scratch database.
  2. Stop `api`, `web` and `worker`.
  3. Rename `trainer` to `trainer_before_restore` and the scratch database to `trainer` (as `trainer_migrations`).
  4. Re-run the runtime-role grants (`infra/runtime-role.sql`, as the controller does after migrations) and request "Re-apply runtime settings".
  5. Reconcile provider receipts and journals as `docs/DEPLOYMENT.md` requires.
- **Pre-deployment dumps.** The existing plaintext dumps in `backups/<ns>.sql` (mode 600) are unchanged. They are a fast rollback aid, and existing tests cover them.

## Changing the platform's own address (item 5)

Branch `core/platform-address`, migration `068_platform_address_change`. The move is a signed,
allowlisted host action, **Change the platform address**, requested from the Host page. The
controller checks DNS itself, writes `runtime.env`, keeps the old name as a permanent
redirect and restores everything automatically when the new address fails. The manual route
(edit `runtime.env` in the DigitalOcean console, then "Re-apply runtime settings") stays for
servers whose controller predates this change. Nothing here has been run on the live server.

### Procedure (Super admin → Host and backups → Change the platform address)

1. **DNS first.** At the registrar, create an A record for the new name that points only at
   this server's public IPv4, which the page shows under "This server (public IPv4)" (from the
   verified controller report). When the root domain is set as well (for example `trainsyou.com`
   for `<workspace>.trainsyou.com`), add a wildcard A record `*.trainsyou.com` to the same
   address. Remove parking, URL-forwarding and `www` CNAME records, and every AAAA (IPv6)
   record for these names: the droplet has no IPv6 address (`"ipv6": False` in
   `provision.py`), so an AAAA record necessarily points at another host, and certificate
   authorities try IPv6 first. If a CAA record exists it must allow `letsencrypt.org`.
2. **Check DNS.** Enter the new address (for example `https://trainsyou.com`) and, optionally,
   the root domain, then press "Check DNS". The live check
   (`POST /api/v1/admin/infrastructure/platform-address/check`) shows what the new name and a
   random name under the root resolve to now (A and AAAA), whether each points only at this
   server, and every other check (format, coach-domain clash, workspace label under the root,
   AAAA records, passkeys, sessions). It also lists the provider settings to update after the
   move, with their new values.
3. **Read the warnings and request the switch.** The request form appears only after a passing
   check of exactly those inputs. It needs a reason (10–500 characters), a confirmation box and a
   fresh authenticator check (like every host action). Warnings shown:
   - passkeys are tied to the hostname (WebAuthn relying-party ID, `new URL(origin).hostname` in
     `passkeys.ts`) and stop working; their owners sign in with password and authenticator (or a
     recovery code) and register a new passkey;
   - sign-in cookies are host-only, so everyone, including the administrator, signs in again at
     the new address; email links already sent keep the old address and are redirected while the
     old-address redirect stays;
   - the provider settings below must be updated.
4. **Progress.** The request waits for the controller (about five minutes). While it runs the
   page shows the controller's signed progress messages and polls every 15 seconds; while the
   services restart the page may not load, which is shown as progress, not as an error. After a
   successful move the old address redirects to the new one, so the page offers a link to the
   Host page at the new address, where the administrator signs in again and sees the result.
5. **After a successful move**, update, in this order:

   | Setting | New value | Where |
   | --- | --- | --- |
   | Stripe webhook endpoint | `<new>/api/v1/webhooks/stripe` | Stripe Dashboard → Developers → Webhooks → the existing endpoint → Update details (the signing secret stays the same) |
   | Sign in with Google | `<new>/api/v1/auth/oidc/google/callback` | Google Cloud → Credentials → OAuth web client → Authorized redirect URIs |
   | Sign in with Apple | `<new>/api/v1/auth/oidc/apple/callback` | Apple Developer → the Services ID → Sign in with Apple → domains and return URLs |
   | WHOOP | `<new>/api/v1/integrations/whoop/callback` | WHOOP developer dashboard, and Super admin → Settings → WHOOP → Registered callback URL |
   | Amazfit / Zepp | `<new>/api/v1/integrations/zepp/callback` | Zepp developer console, and Super admin → Settings → Amazfit / Zepp → Registered callback URL |
   | Instagram | `<new>/api/v1/trainer/instagram/callback` | Meta app OAuth redirect URIs, and Super admin → Settings → Instagram (follower estimates) → Redirect URI |
   | Coach-domain CNAME target | the new host name | Super admin → Settings → Custom domains → `DOMAIN_CNAME_TARGET` |

   Then re-run the live checks. Where a provider accepts several redirect URIs (Google does),
   adding the new one before the move avoids a gap.
6. **Remove the old-address redirect later**, once nothing uses the old name, with the host
   action **Remove old-address redirects** (no parameters). Until then the old name keeps its
   certificate and redirects. Coach domains that CNAME to the old name do not depend on the
   redirect, only on the old name's DNS: keep that DNS record until they point at the new name.

### What the controller does (`hostops.py change_platform_address`)

The request is a long action: at most one long action runs per cycle, that cycle skips its
deployment, and the change starts only with at least 1610 seconds (about 27 minutes) of the
cycle left (otherwise it stays pending; requests still expire after 30 minutes). That threshold
is the computed worst case (`ADDRESS_CHANGE_MIN_SECONDS`): the DNS check (120 s), the switch
(compose `--wait-timeout 180` plus container recreation, counted as 240 s, and two readiness
waits of at most `SWITCH_READY_ATTEMPTS` = 40 attempts of 8 s each: 880 s), the certificate
check (30 s), a restore whose readiness waits get at least 10 attempts each (400 s) and the
180 s cycle margin. The restore's waits are sized to the time actually left
(`ready_attempts()`), up to the usual 60, so it ends before systemd stops the cycle; outside a
cycle (console) it gets the full 60.

1. **Verify the signed request.** Parameters are canonical JSON
   (`{"url":"https://trainsyou.com","rootDomain":"trainsyou.com"}`, `rootDomain` null to leave
   `PLATFORM_ROOT_DOMAIN` as it is), stored in `host_action_requests.parameters` and signed under
   a v2 canonical form that appends their SHA-256 (`gymmembership-host-action-v2`). Requests
   without parameters keep the v1 form, so older pending requests still verify. The action
   without parameters, or parameters on any other action, is rejected (and refused by the
   database). The URL must be exactly `https://<lower-case DNS name>`; the root a plain DNS name.
   "Nothing to change" (same address and root) fails without changes.
2. **Verify public DNS before changing anything.** The reference is this server's own public
   IPv4 as the controller last read it from the metadata service (`endpoint.json` `ip`, written
   every cycle). The new host and, with a root domain, a random name
   `gm-address-check-<8 hex>.<root>` must resolve (A records) to that address and to nothing
   else, and must have no AAAA record. A records are decided by the server's own (system)
   resolver only, because every later step (readiness, the certificate check, the redirect
   check) resolves the name through it: a name that only public DNS knows yet (the server
   still caches a negative answer) is refused with "does not resolve on this server yet
   (public DNS shows …; retry after the record's TTL)". Public DNS over HTTPS (Cloudflare
   `https://cloudflare-dns.com/dns-query`, then Google `https://dns.google/resolve`, JSON API,
   redirects refused) is asked for that report and, when the system resolver has no AAAA
   record, for AAAA records (a stale local cache must not hide one). Any AAAA record is
   refused, since the server has no IPv6 address; this would be relaxed only if the server
   ever reported one. Otherwise the request fails with a result such as "DNS is not ready:
   trainsyou.com resolves to 198.51.100.7. Every A record must point only to this server,
   203.0.113.10, including a wildcard record \*.trainsyou.com. Nothing was changed." (with
   ", and every AAAA record must be removed: this server has no IPv6 address" when AAAA
   records exist) and the answers in the result details.
3. **Switch.** The previous `runtime.env` is copied byte for byte to
   `/opt/gymmembership/runtime-env-backups/runtime.env.<UTC>.<request>` (mode 600, directory
   700, newest 10 kept). Each copy holds every secret in plaintext as it was then; after
   rotating secrets, remove them with `hostops.py purge-runtime-backups` (see "Key rotation"). The state file `platform-address.json` (mode 600) records the change
   as in progress, with the previous redirects and the copy's name. `runtime.env` is then
   rewritten atomically (temporary file, `fsync`, rename, mode 600): only the
   `PUBLIC_APP_URL=` line (and `PLATFORM_ROOT_DOMAIN=`, appended when absent) changes; every
   other line, comment, blank line and value stays byte for byte in order. The controller
   re-reads the settings (`ensure_runtime()`, which refreshes `endpoint.json`) and re-applies
   the serving release (`reapply_release()`, readiness waits bounded as above), which renders a Caddyfile serving the new name,
   with the former name as a permanent redirect:

   ```
   https://gymmembership.<ip>.sslip.io {
       redir https://trainsyou.com{uri} 308
   }
   ```

   The redirect blocks come from `platform-address.json` (`redirectFrom`, at most 8 names), so
   every later deployment, rollback, return and re-apply keeps them. Names that are not plain DNS
   names, duplicates and the current platform name are never rendered.
4. **Check.** Readiness at the new address (`/api/v1/ready` with the release header, over
   verified HTTPS). Once it passes, the state file marks the change as `switched`. Then the
   certificate the new name serves is checked: it must verify and stay valid for at least a
   day. The progress messages are written to the running request, signed like a result.
5. **On failure** of any step in 3–4, the controller restores the address in `runtime.env`
   (atomic, mode 600): `PUBLIC_APP_URL` and `PLATFORM_ROOT_DOMAIN` go back to their values in
   the saved copy (`PLATFORM_ROOT_DOMAIN` is removed when it was absent), but only while they
   still hold what the change wrote. Every other line, and any value an operator changed in
   the console meanwhile, stays as it is now; the file is never replaced wholesale. It then
   restores the previous redirects, re-reads the settings and re-applies the serving release
   again, and reports "The switch to … failed (…). The previous address … and its settings
   were restored and are serving again." If that restore also fails, the result names the
   console recovery
   (`python3 /opt/gymmembership/releases/<serving sha>/infra/digitalocean/hostops.py reapply`
   as root; `runtime.env` already holds the previous address by then).
6. **Interrupted change.** If systemd stops the cycle or the server restarts part-way, the next
   cycle (before any request) finds the change still marked in progress. When it was marked
   `switched` (readiness had passed over verified HTTPS), only the certificate check is
   repeated: a pass keeps the new address and records success; a failure restores as in step 5.
   Otherwise it restores as in step 5. The outcome is recorded on the request itself instead of
   the generic "controller stopped before recording a result". That cycle counts as long and
   skips its deployment. After three failed restore attempts it stops retrying and records
   `restore_failed` (shown on the page); the console re-apply is then the recovery.
   **Console `reapply` while a change is unfinished** settles it first, exactly as the next
   cycle would (keeps a `switched` change whose certificate checks out, otherwise restores the
   two address values as in step 5), records the outcome and clears the in-progress mark, so no
   later cycle reverts what the operator applies afterwards. To keep an address the operator
   set by hand, edit `runtime.env` and run `reapply` again, or request the change again.
7. **On success**, the state records the change, the result reports the new address, the DNS
   answers, the certificate issuer and expiry, and whether the old name already answered with
   the redirect (`verified` or `not verified yet`; not a failure). The old-name redirect stays
   until **Remove old-address redirects**. That action clears the list and re-applies; if the
   re-apply fails, the list is put back and re-applied.

Moving back to a former name removes that name from the redirect list and adds the name being
left. The signed controller report carries an `address` block: the server's public IPv4, the
root domain in effect, the redirect names, whether a change is in progress and the last change's
outcome. The page shows them; reports from older controllers simply lack the block.

### Checks on the API side (`checkPlatformAddress`)

- **Format.** HTTPS; a DNS name with a letter in its last label (not an IP literal); no port
  other than 443; no path, query, fragment or trailing slash. The root domain, when given, is a
  plain DNS name.
- **Changed.** The address or the root domain must differ from the current one to request a
  switch (`PLATFORM_ADDRESS_UNCHANGED`).
- **No clash with a coach domain.** The name must not be an existing coach-domain mapping or a
  live allowance.
- **Workspace label.** A single label under the root (current or new) is a workspace address;
  only the root itself, deeper names or reserved labels such as `app` or `www` are accepted.
- **DNS.** Every A record of the new name (and of the random name under the root) must be the
  server IPv4 from the verified controller report. Without a verified report that names one
  (before the first report of a controller with this change, or an unverified report) the DNS
  check is an error, "This server's public IPv4 address is not reported yet", so the request
  stays blocked; there is no looser fallback. Any AAAA record is an error (`dns_ipv6`): the
  report carries no server IPv6 address because the droplet has none.
- **Root change.** A different root domain warns that workspace addresses move.
- **Passkeys.** Counts the passkeys whose `rp_id` is the current hostname, with a warning, when
  the name changes.
- **Sessions and providers.** Notes that everyone signs in again, and lists the provider
  settings with their new values.

A new request (`POST /api/v1/admin/infrastructure/host/actions` with
`{"action":"change_platform_address","parameters":{"url","rootDomain"}}`) must pass the same
checks (`PLATFORM_ADDRESS_INVALID` otherwise); a retry with the same `requestId` returns the
recorded request, and the same `requestId` with different parameters is `INTENT_CONFLICT`. Only
one address change can be open at a time. The audit row `infrastructure.host_action.requested`
includes the parameters.

### Rollout and backwards compatibility

- The first deployment of this change is made by the currently deployed controller. It applies
  migration 068 (additive: one nullable column and two checks that every existing request
  satisfies), renders its own Caddyfile and never sees an address change request: requests
  created after that deployment are processed by the new controller from the next cycle,
  because `dispatch.py` runs the newest release's `host.py`.
- Without `platform-address.json` (the action never used), `edge_config` renders byte-identical
  Caddyfiles for every variant, and the report's `pendingReapply` is unchanged; the Python tests
  compare the exact text.
- The controller's pending-request query reads the new column through `to_jsonb(row)`, so it also
  works on a schema without it. Compose, services and mounts are unchanged. The bootstrap copy of
  `host.py` grew by under 1 KiB; the cloud-init payload is 61,276 of 65,536 bytes after the review fixes (asserted below 64 KiB).
- An older release served after an operator rollback ignores the new column and actions
  (`SELECT *`, unknown action labels fall back to the name).
- The plain "Re-apply runtime settings" action is unchanged and still has no automatic fallback;
  the fallback belongs to the address change, which knows the previous settings.

### Files of the address change

- New: `packages/db/migrations/068_platform_address_change.sql`, `tests/platform-address.test.ts`,
  `tests/platform-address-web.test.ts`, `tests/test_platform_address_deployment.py`.
- Changed: `infra/digitalocean/host.py` (`edge_config(..., moved)`, `MOVED`, `edge_moved()`, used by
  deploy and `start_release`), `infra/digitalocean/hostops.py` (signed parameters, the two actions,
  DNS verification, `runtime.env` rewrite and restore, interrupted-change recovery, report `address`
  block), `apps/api/src/host-operations.ts` (v2 canonical form, parameters, validation, DNS preview,
  provider settings, report schema), `apps/web/components/host-operations.tsx` and
  `apps/web/app/host-operations.css` (address section, DNS table, progress), `tests/infra-ops-api.test.ts`,
  `tests/infra-ops-contract.test.ts` and `tests/hostops_report_contract.py` (parameters through the real
  schema and the Python verifier; the report's address block), `docs/features/web-addresses.md` and
  `docs/DIGITALOCEAN_DEPLOYMENT.md` (pointers).

### Checks actually run for the address change (local, 28 September 2026)

All in `.claude/worktrees/wf_7873d359-283-2` on branch `core/platform-address`, after the last code change:

- `npx tsc --noEmit` (run as `node node_modules/typescript/bin/tsc --noEmit`): exit 0. `prettier --check` on
  the changed TypeScript, TSX and CSS files: clean.
- `python3 -m unittest discover -s tests -p 'test_*deployment.py'`: 142 tests OK, 3 skipped (the Caddy
  validations). With `CADDY_BIN` set to the Caddy v2.11.4 binary: 142 tests OK, no skips; the Caddyfiles with
  old-name redirects (on-demand with root, and legacy) pass `caddy validate`. `test_platform_address_deployment.py`
  has 28 tests: exact pre-change Caddyfile text for every variant and byte-identical deploy/re-apply output
  without the state file; redirect rendering and filtering; v2 signature vector shared with TypeScript;
  malformed parameters; long-action scheduling; DNS mismatch refusal (nothing written, no command run), a record
  shared with another server, the missing wildcard record, the DNS-over-HTTPS fallback (against a local HTTP
  fixture) and an unknown server address; the success path (runtime.env byte-for-byte apart from the changed
  line and the appended root, mode 600, private backup, redirect block, endpoint, signed progress, report block,
  redirect kept by later re-applies); moving back; root-only change; readiness failure and certificate failure
  roll back to byte-identical `runtime.env` and Caddyfile; failed restore names the console command; an
  interrupted change is undone by the next cycle; retries stop after three failed restores; redirect removal and
  its failure path; `runtime.env` update, atomic private write under a permissive umask, backup pruning and a
  group-readable file refused.
- PGlite: `tests/infra-ops-api`, `infra-ops-contract`, `infra-ops-tls`, `infra-ops-web`, `platform-address`,
  `platform-address-web`, `web-address-orders`, `web-address-subdomains` and `rtl-layout`: 65 tests passed.
  Related suites `fix-edge`, `fix2-edge-deploy`, `host-routing`, `infrastructure-actions`,
  `infrastructure-observer`, `integrations-completion`, `platform` and `rate-limits`: 89 tests passed.
- `/opt/tools/pg-sandbox.sh 56152` (PostgreSQL 16, restricted `trainer_service` role) with `platform-address`,
  `infra-ops-api`, `infra-ops-contract`, `infra-ops-tls`, `web-address-subdomains`, `integrations-completion` and
  `host-routing`: `{"runtimeAccess":"verified","migrations":60,...}`, 51 tests passed,
  `PG_SELECTED_FAILED_FILES=0`. Migration 068 applied on PostgreSQL 16 and on PGlite.
- `next build` (apps/web): compiled successfully, exit 0. It ran before two wording-only edits (a typo in the
  warning list and one provider hint); `tsc` and the web rendering tests ran after them.
- A local Playwright check (not committed; local Chromium, no cloud browser) rendered the address section,
  progress and DNS preview with the real CSS at 390 and 1440 px, left-to-right and right-to-left: no page-level
  horizontal overflow; at 390 px the DNS table scrolls inside its own box.
- Not run: the full `npm test`, the end-to-end harness, anything on Docker, the live server or real DNS and
  certificate authorities. The controller's DNS, certificate and redirect probes were replaced in the Python
  tests (except the DNS-over-HTTPS parser, which ran against a local fixture server).

### Review of the address change (28 September 2026)

An adversarial review found one major and five minor problems. All six were fixed:

| Finding | Fix |
| --- | --- |
| Major: only A records were checked. The droplet has no IPv6, so any AAAA record points at another host; the page only warned and the controller never looked, so a certificate authority (IPv6 first) could fail, taking the platform down before the rollback, or IPv6 visitors could reach another host. | The controller resolves AAAA too (system resolver, then public DNS over HTTPS when it has none; IPv4-mapped answers ignored) and refuses any AAAA record for the new name or under the root with "every AAAA record must be removed: this server has no IPv6 address". On the page `dns_ipv6` is an error, and the procedure text says to remove every AAAA record. |
| The public DNS fallback accepted a name the server's own resolver could not resolve yet, although readiness and the certificate check after the switch resolve through it: a near-certain outage and rollback. | A records are decided by the system resolver only; public DNS is only reported ("does not resolve on this server yet (public DNS shows …; retry after the record's TTL)"). |
| The restore replaced `runtime.env` wholesale with the pre-change copy, silently discarding console edits made while a change was unfinished; a console `reapply` did not clear the unfinished change, so the next cycle reverted it. | The restore puts back only `PUBLIC_APP_URL` and `PLATFORM_ROOT_DOMAIN` (removed when absent before), and only while they still hold what the change wrote; every other line stays. Console `reapply` settles the unfinished change first (as the next cycle would), records the outcome and clears it. |
| The worst case (two re-applies of about 1140 s each) exceeded the 1800 s unit timeout, and a cycle killed after readiness had passed rolled back a working move. | Budgeted: readiness waits of 40 attempts during the switch, restore waits sized to the time left (at least 10 attempts), start threshold computed as 1610 s. A `switched` mark after readiness makes the next cycle repeat only the certificate check; interrupted changes record their real outcome on the request. |
| Without a verified controller report the page fell back to a much looser DNS rule and showed "Ready to switch" for requests the controller would refuse. | Without a reported server IPv4 the DNS check is an error ("not reported yet"); the fallback was removed. |
| Saved `runtime.env` copies keep pre-rotation secrets indefinitely. | Documented under "Key rotation" and the switch step; new console command `hostops.py purge-runtime-backups` (refused while a change is unfinished). |

Checks actually run after these fixes (local, 28 September 2026, same worktree and branch):

- `npx tsc --noEmit`: exit 0. `prettier --check` on the changed API, web component and test files: clean after
  formatting `tests/platform-address.test.ts` (`tests/e2e/scenarios/operator-completion.e2e.ts` was already not
  Prettier-formatted before this change and was left as it was).
- `python3 -m unittest discover -s tests -p 'test_*deployment.py'`: 151 tests OK, 3 skipped (the Caddy
  validations; `CADDY_BIN` was not set, and Caddyfile rendering did not change). New Python tests: any AAAA
  refused (system resolver, public-only, wildcard), a name only public DNS knows refused, AAAA parsing over the
  local DNS-over-HTTPS fixture, mapped-IPv4 filtering, restore keeping console edits, the real outcome recorded
  on an interrupted request, a `switched` change kept or rolled back by its certificate, console `reapply`
  settling the change, purging saved copies, the budget arithmetic and restore sizing, and removal in
  `updated_runtime`.
- PGlite: `platform-address`, `platform-address-web`, `infra-ops-api`, `infra-ops-contract`, `infra-ops-tls`,
  `infra-ops-web`: 30 tests passed; `rtl-layout`: 9 passed.
- `/opt/tools/pg-sandbox.sh 56152` with `platform-address`, `infra-ops-api`, `infra-ops-contract`,
  `infra-ops-tls`: `runtimeAccess` verified, 23 tests passed, `PG_SELECTED_FAILED_FILES=0`.
- Not run: `next build`, a browser check (the web change is text inside the existing result list), the
  end-to-end harness (its platform-address step now expects "not reported yet", because the sandbox controller
  reports no public IPv4), anything on Docker, the live server, real DNS or certificate authorities.

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

## Migration 068 (`packages/db/migrations/068_platform_address_change.sql`)

- `host_action_requests.parameters text` (2–2048 bytes, nullable). The existing trigger keeps it immutable with the other intent columns.
- The action check now also allows `change_platform_address` and `clear_address_redirects`.
- `host_action_requests_parameters_action`: parameters are present exactly for `change_platform_address`.
- No new table or grant: `trainer_service` already has `SELECT, INSERT, UPDATE` on the table.

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

## Checks actually run after the review fixes (local, 27 September 2026)

All after the final code change and formatting, in `.claude/worktrees/wf_f1531986-5a3-1`:

- `npx tsc --noEmit`: exit 0. `npx prettier --check` on the changed TypeScript, TSX and CSS files: clean.
- `node --import tsx --test --test-concurrency=1 tests/infra-ops-api.test.ts tests/infra-ops-contract.test.ts tests/infra-ops-tls.test.ts tests/infra-ops-web.test.ts` (embedded PGlite): 22 tests, 22 passed, 0 failed, 0 skipped.
- Related files on PGlite (`integrations-completion`, `infrastructure-observer`, `infrastructure-actions`, `host-routing`, `rate-limits`, `fix2-edge-deploy`): 45 tests, 45 passed, 0 failed.
- `/opt/tools/pg-sandbox.sh 56115 <worktree>` with the four infra-ops files plus `integrations-completion`, `host-routing`, `infrastructure-observer`, `infrastructure-actions` and `rate-limits`, as the restricted `trainer_service` role on PostgreSQL 16: `{"runtimeAccess":"verified","migrations":46,"systemTables":40,"scopedTables":33,"helpers":9}`, then 10 + 2 + 6 + 4 + 16 + 6 + 9 + 5 + 3 = 61 tests passed, 0 failed, 0 skipped, `PG_SELECTED_FAILED_FILES=0`.
- `python3 -m unittest discover -s tests -p 'test_*deployment.py'`: 101 tests OK with 1 skip (Caddy validation without a Caddy binary). With `CADDY_BIN` set to the Caddy v2.11.4 release binary: 101 tests OK, no skips. `test_hostops_deployment.py` now has 45 tests (12 new).
- **Manual probe against a real PostgreSQL 16 cluster (not committed; throwaway cluster on 127.0.0.1:56115, stopped and deleted afterwards).** The repository migrations were applied, then a bulk table was added. The real `hostops` functions ran with `docker compose exec` replaced by the local `pg_dump`, `pg_restore` and `psql`:
  - `DATABASE_FACTS_SQL` returned `(130104343, 1073741824)`: a 124 MB database whose dump was 24.7 MB. The restore check then required 2,234 MiB free, where the old rule required about 560 MiB.
  - A restore check with `serving` set to a previous release that lacks the newest migration passed (46 migrations, 74 tables).
  - A manually created `restore_check_aaaaaaaaaaaa` was dropped by the cleanup, and a `--keep` scratch database survived it.
  - Free space reported below the floor during streaming stopped the restore after 0.6 s. With a 1.18 GB database, the same floor tripped during the index-build phase after the stream had ended (159 stream checks, then 1 wait-phase check, 6.7 s). In both cases the scratch database was gone afterwards and no session remained connected to a `restore_check_*` database.
- A separate probe of `pump` with real processes: the guard ran during streaming and every 2 s while waiting, a raised guard killed the sink process (exit -9), and the timer path ended a sleeping sink at its limit.

## Checks actually run, first round (local, 27 September 2026)

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

## Review round (27 September 2026)

An adversarial review found two major and seven minor problems. All nine were fixed:

| Finding | Fix |
| --- | --- |
| Major: the restore check's free-space guard used the compressed dump size, so restoring a large database into the production cluster could fill the disk and halt production. | Sized by the real database (recorded `databaseSizeBytes`, or the live size, whichever is larger) × 1.5 + `max_wal_size` + 1 GiB, measured on both the backup and Docker filesystems. A free-space floor stops the restore while streaming and while indexes build; the scratch database is dropped `WITH (FORCE)`. Backups also stop below 512 MiB free. |
| Major: a failed deployment attempt set `deployed = True`, so a broken main head stopped scheduled backups. | `deployed = bool(deploy(...))`; a failed attempt no longer defers the backup, and a backup overdue by an hour is taken even after a recorded deployment. The Python test now asserts that repeatedly failing cycles still back up. |
| Report freshness came from the unsigned `reported_at`, so an old signed report could be replayed as current. | Freshness, `ageSeconds` and backup report staleness use the signed `generatedAt`; future-dated reports are refused. |
| The edge's on-demand status came from `runtime.env`, not the served Caddyfile. | The report now carries `onDemandTls` (served), `onDemandConfigured` and `pendingReapply`; the page shows "Pending re-apply". |
| The procedure claimed re-apply restores the previous edge. | The text now says nothing is rolled back and names the console recovery; a `hostops.py reapply` command was added for it. |
| `readBackupStatus().stale` flipped to true whenever a deployment delayed the controller report. | Backup staleness is judged by backup age; report staleness is a separate `reportStale` flag, and only silence longer than the backup warning age gives `report_stale`. |
| The ask endpoint's 120/min budget was shared by all asks (one edge address), so random-name floods denied real names. | Per-name budget, and an in-memory permitted-name set with at most one reload per 5 s on misses. |
| A killed restore check left a full copy of production data in `restore_check_*`, and a cycle could exceed the unit timeout. | Leftover scratch databases are dropped every cycle (kept ones are recorded); one long action per cycle, which then skips the deployment; long steps are time-limited by the remaining cycle time. |
| After a rollback, verification rejected healthy backups carrying the newer release's migrations. | Known migrations are the union of the `current` and serving releases. |

## Left out, and why

- **Resizing or cloud-account actions.** These need a DigitalOcean token on the server, which the deployment deliberately does not hold (see above).
- **Alert delivery for stale backups or host thresholds.** `readBackupStatus()` and `readHostHealth()` are provided for the separately assigned alerts work. This package does not send notifications, and host thresholds have no recommendation lifecycle like the process observer's.
- **Remote retention and deletion.** Left to a bucket lifecycle rule, so the server never holds delete intent on off-server copies.
- **Encrypting the pre-deployment dumps.** Left unchanged to keep the tested deploy and rollback path identical. They stay private (mode 600, directory 700) on the same disk.
- **Automated production restore.** Documented as a manual procedure. Only restores into a scratch database are automated.
- **Live verification.** Deployment is separately assigned. None of the following has been exercised on the GymMembership server: on-demand certificates from Let's Encrypt, Spaces uploads, host actions, or the new controller.
- **Pickup latency.** The host controller acts on requests on its existing five-minute timer. A faster loop would exceed GitHub's unauthenticated API budget, because each cycle checks main.
- **Replay ordering within the freshness window.** The API does not refuse a signed report older than one it already accepted. A replayed report is at most 15 minutes old before it shows as stale, so this would only matter within that window.
- **The API container's own sample stays unsigned.** It is written by the API itself and is labelled on the page as the API's view; it is only used when no fresh verified controller report exists.
- **No SIGTERM handler in the controller.** Instead, long steps finish (or stop themselves and clean up) before the unit timeout, and leftover scratch databases are dropped at the start of the next cycle, which also covers a reboot during a restore check.
- **Automatic fallback for a failed plain re-apply.** Not implemented, because restoring only the edge would not help while the API and web run with the new `PUBLIC_APP_URL`; the console `reapply` command is the recovery path. An address change made with the "Change the platform address" action does restore itself, because it saves the previous settings first.
- **Automatic DNS changes, IPv6 and removing single redirect names.** The controller never edits DNS (no registrar or DigitalOcean credentials on the host). The server has no IPv6 address, so any AAAA record blocks the move (page and controller); serving IPv6 would need a droplet with IPv6 and a reported server IPv6 to compare against. "Remove old-address redirects" removes all former names at once.
