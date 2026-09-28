"""Host operations for the GymMembership controller.

Scheduled encrypted database backups (with optional S3-compatible off-server
copies), a restore-into-scratch verification, a signed host status report and
allowlisted Super admin actions. host.py imports this module lazily and passes
itself as ``h``; the bootstrap copy of the controller has no hostops.py and
simply skips these operations until the first release runs.

Nothing here prints a secret, a request reason, database content or command
stderr. The database is reached only through ``docker compose exec database``
as the migration administrator, exactly like the runtime-role step.

Command line (as root on the server, from a deployed release):
  python3 hostops.py status | list | backup | restore-check [--backup NAME] [--keep] | reapply
"""
import base64
import datetime
import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlsplit

from common import DeploymentError, NoRedirect, atomic_json, valid_sha

HOST_KEY_LABEL = b"gymmembership-host-operations-v1"
BACKUP_ENCRYPTION_LABEL = b"gymmembership-backup-encryption-v1"
BACKUP_MAC_LABEL = b"gymmembership-backup-mac-v1"
ACTIONS = frozenset({"restart_service", "rollback_release", "restore_release", "reapply_release",
                     "pause_deploys", "resume_deploys", "backup_now", "verify_backup"})
SERVICES = ("api", "web", "worker")
STATUSES = frozenset({"pending", "running", "succeeded", "failed", "rejected", "expired", "canceled"})
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
HEX64 = re.compile(r"[0-9a-f]{64}")
BACKUP_NAME = re.compile(r"[0-9]{8}T[0-9]{6}Z(?:-[0-9]{1,3})?")
SCRATCH_NAME = re.compile(r"restore_check_[0-9a-f]{12}")
CIPHER = ["-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256"]
FORMAT = "pg_dump-custom+openssl-aes-256-cbc-pbkdf2-sha256+hmac-sha256"
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
MAX_ACTIONS_PER_CYCLE = 5
# At most one of these runs per cycle, and that cycle does not also deploy.
LONG_ACTIONS = frozenset({"backup_now", "verify_backup"})
ACTION_MAX_LIFETIME_MS = 3600 * 1000
CLOCK_SKEW_MS = 5 * 60 * 1000
BACKUP_TIMEOUT_SECONDS = 1200
FAILURE_BACKOFF_SECONDS = 3600
# A backup this much past its interval is taken even in a cycle that deployed.
OVERDUE_SECONDS = 3600
# Time kept back at the end of a cycle so a stopped step can clean up (kill its
# processes, drop a scratch database, record the result) before systemd stops it.
CYCLE_MARGIN_SECONDS = 180
LONG_MIN_SECONDS = 300
ACTION_START_MIN_SECONDS = 900
GUARD_INTERVAL_SECONDS = 2
# A backup stops when free space would fall below this.
BACKUP_FREE_FLOOR_BYTES = 512 << 20
DOCKER_ROOT = Path("/var/lib/docker")
DEFAULT_INTERVAL_HOURS, DEFAULT_KEEP = 24, 7
S3_KEYS = ("BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_REGION",
           "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY")


def log(message):
    print("Host operations: " + message)


def warn(message):
    print("Host operations: " + message, file=sys.stderr)


def safe_message(error):
    """A reportable description without stderr, arguments or secrets."""
    if isinstance(error, DeploymentError):
        return str(error)[:300]
    if isinstance(error, subprocess.TimeoutExpired):
        return "A host command timed out"
    if isinstance(error, subprocess.CalledProcessError):
        return "A host command failed with exit status " + str(error.returncode)
    if isinstance(error, urllib.error.HTTPError):
        return "Storage request failed with HTTP " + str(error.code)
    return "Failed: " + type(error).__name__


def iso(timestamp=None):
    return datetime.datetime.fromtimestamp(time.time() if timestamp is None else timestamp,
                                           datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    try:
        return datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def private(path, flags):
    return os.open(path, flags, 0o600)


# ---- Signing -------------------------------------------------------------

def host_key(values):
    """Key shared with the API (apps/api/src/host-operations.ts hostOperationsKey)."""
    secret = values.get("INTERNAL_PROXY_SECRET", "")
    if len(secret.encode()) < 32:
        raise DeploymentError("The internal proxy secret is unavailable; host operations are disabled")
    return hmac.new(secret.encode(), HOST_KEY_LABEL, hashlib.sha256).digest()


def sign(key, *fields):
    return hmac.new(key, "\n".join(fields).encode(), hashlib.sha256).hexdigest()


def action_canonical(row):
    return ["gymmembership-host-action-v1", row["id"], row["request_id"], row["action"], row.get("target") or "-",
            row["requested_by"], str(row["issued_at_ms"]), str(row["expires_at_ms"]),
            hashlib.sha256(row["reason"].encode()).hexdigest()]


def verify_request(row, key, now_ms):
    """Return ("ok" | "expired" | "rejected", message) for one pending request."""
    try:
        if not all(isinstance(row.get(k), str) and UUID.fullmatch(row[k]) for k in ("id", "request_id", "requested_by")):
            return "rejected", "The request identity is malformed"
        if row.get("action") not in ACTIONS:
            return "rejected", "The action is not on the host allowlist"
        target = row.get("target")
        if (row["action"] == "restart_service") != (target is not None) or (target is not None and target not in SERVICES):
            return "rejected", "The action target is not allowed"
        issued, expires = row.get("issued_at_ms"), row.get("expires_at_ms")
        if (not isinstance(issued, int) or not isinstance(expires, int) or isinstance(issued, bool)
                or isinstance(expires, bool) or not issued < expires <= issued + ACTION_MAX_LIFETIME_MS):
            return "rejected", "The request lifetime is invalid"
        if not isinstance(row.get("reason"), str) or not isinstance(row.get("signature"), str):
            return "rejected", "The request is incomplete"
        if not hmac.compare_digest(sign(key, *action_canonical(row)), row["signature"]):
            return "rejected", "The request signature does not verify; it was not executed"
        if issued > now_ms + CLOCK_SKEW_MS:
            return "rejected", "The request was issued in the future"
        if expires <= now_ms:
            return "expired", "The request expired before the host controller picked it up"
        return "ok", ""
    except (KeyError, TypeError, AttributeError):
        return "rejected", "The request is malformed"


# ---- Database access through the migration administrator -----------------

def text_sql(value):
    """A SQL expression for arbitrary text: base64 has no quotes, backslashes or psql variables."""
    return "convert_from(decode('" + base64.b64encode(value.encode()).decode() + "','base64'),'UTF8')"


def psql(h, sql, database="trainer", timeout=300):
    """Run SQL as the migration administrator inside the database container; return stdout."""
    if database not in ("trainer", "postgres") and not SCRATCH_NAME.fullmatch(database):
        raise DeploymentError("Unexpected database name")
    sha = h.serving_release(h.read_state())
    if not sha:
        raise DeploymentError("No release is deployed on this server")
    result = h.compose(h.ROOT / "releases" / sha, sha, "exec", "-T", "database", "psql", "-X", "-q", "-A", "-t",
                       "-v", "ON_ERROR_STOP=1", "-U", "trainer_migrations", "-d", database,
                       input=sql, text=True, capture_output=True, timeout=timeout)
    return result.stdout or ""


def table_ready(h, table):
    if not re.fullmatch(r"[a-z_]{3,63}", table):
        raise DeploymentError("Unexpected table name")
    return psql(h, "SELECT to_regclass('public." + table + "') IS NOT NULL;").strip() == "t"


def json_rows(output):
    text = output.strip()
    return json.loads(text) if text else []


# ---- Operator actions ------------------------------------------------------

def transition(h, key, row_id, from_status, to_status, result=None):
    """Move one request between statuses, sign any result and audit the change."""
    if not UUID.fullmatch(row_id) or from_status not in STATUSES or to_status not in STATUSES:
        raise DeploymentError("Invalid action transition")
    sets = ["status='" + to_status + "'", "picked_up_at=now()" if to_status == "running" else "finished_at=now()"]
    if result is not None:
        message = str(result.get("message", ""))[:1000]
        details = result.get("details") if isinstance(result.get("details"), dict) else {}
        text = json.dumps({"message": message, "details": details}, sort_keys=True, separators=(",", ":"))
        if len(text.encode()) > 16000:
            text = json.dumps({"message": message, "details": {}}, sort_keys=True, separators=(",", ":"))
        sets += ["result=" + text_sql(text), "result_signature='" + sign(key, "gymmembership-host-result-v1",
                                                                          row_id, to_status, text) + "'"]
    audit = json.dumps({"status": to_status, "executor": "host-controller"}, separators=(",", ":"))
    sql = ("BEGIN;\n"
           "UPDATE host_action_requests SET " + ",".join(sets) + " WHERE id='" + row_id + "' AND status='"
           + from_status + "' RETURNING id;\n"
           "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) SELECT gen_random_uuid(),requested_by,"
           "'infrastructure.host_action." + to_status + "',id::text," + text_sql(audit) + "::jsonb "
           "FROM host_action_requests WHERE id='" + row_id + "' AND status='" + to_status + "'"
           + (" AND picked_up_at>=now()" if to_status == "running" else " AND finished_at>=now()") + ";\n"
           "COMMIT;\n")
    return row_id in psql(h, sql)


def restart_service(h, target):
    if target not in SERVICES:
        raise DeploymentError("Only api, web or worker can be restarted")
    sha = h.serving_release(h.read_state())
    h.compose(h.ROOT / "releases" / sha, sha, "up", "-d", "--no-deps", "--force-recreate", "--wait",
              "--wait-timeout", "180", target)
    if target in ("api", "web"):
        h.wait_ready("http://127.0.0.1:3000/api/v1/ready")
        h.wait_ready(h.endpoint_url() + "/api/v1/ready", expected_sha=sha)
    return {"message": "Recreated " + target + " from release " + sha[:12] + " and it is ready.",
            "details": {"service": target, "release": sha}}


def execute(h, values, row):
    action = row["action"]
    if action == "restart_service":
        return restart_service(h, row["target"])
    if action == "rollback_release":
        state = h.read_state()
        previous, running = state.get("previous"), h.serving_release(state)
        if not previous:
            raise DeploymentError("There is no previous release on this server")
        valid_sha(previous)
        if previous == running:
            raise DeploymentError("The previous release is already serving")
        # Pause first, so an interrupted rollback can never be undone by an automatic deploy.
        h.set_deploy_pause(True, "rollback", row["id"])
        h.switch_release(previous)
        return {"message": "Serving the previous release " + previous[:12] + ". Automatic deploys are paused; "
                "database migrations were not reversed.", "details": {"serving": previous, "rolledBackFrom": running}}
    if action == "restore_release":
        state = h.read_state()
        current = valid_sha(state.get("current"))
        if h.serving_release(state) == current:
            raise DeploymentError("The latest deployed release is already serving")
        h.switch_release(current)
        return {"message": "Serving the latest deployed release " + current[:12] + " again.",
                "details": {"serving": current}}
    if action == "reapply_release":
        sha = h.reapply_release()
        return {"message": "Recreated the services of release " + sha[:12] + " with the current runtime settings.",
                "details": {"release": sha, "endpoint": h.endpoint_url()}}
    if action in ("pause_deploys", "resume_deploys"):
        paused = action == "pause_deploys"
        h.set_deploy_pause(paused, "operator", row["id"])
        return {"message": "Automatic deploys are " + ("paused." if paused else "resumed."), "details": {"paused": paused}}
    if action in LONG_ACTIONS and cycle_limit(h) is None:
        raise DeploymentError("Too little of this controller cycle was left; request it again")
    if action == "backup_now":
        record = backup_with_state(h, values, "manual", limit=cycle_limit(h))
        return {"message": "Backup " + record["name"] + " written (" + str(record["sizeBytes"]) + " bytes, "
                + location(record) + ").", "details": summarize(record)}
    if action == "verify_backup":
        result = verify_with_state(h, values, limit=cycle_limit(h))
        if not result["ok"]:
            raise DeploymentError(result["message"])
        return {"message": result["message"], "details": result}
    raise DeploymentError("The action is not on the host allowlist")


PENDING_SQL = ("SELECT coalesce(json_agg(r ORDER BY r.created_at),'[]'::json) FROM (SELECT id,request_id,action,target,"
               "reason,requested_by,issued_at_ms,expires_at_ms,signature,created_at FROM host_action_requests "
               "WHERE status='pending' ORDER BY created_at LIMIT " + str(MAX_ACTIONS_PER_CYCLE) + ") r;")
RUNNING_SQL = "SELECT coalesce(json_agg(id),'[]'::json) FROM host_action_requests WHERE status='running';"


def cycle_limit(h):
    """Seconds a long step may run so its own cleanup finishes before systemd stops the cycle.

    None when too little of the cycle is left to start one. Console commands run
    outside a cycle and get the full limit.
    """
    remaining = h.cycle_remaining()
    if remaining is None:
        return BACKUP_TIMEOUT_SECONDS
    limit = int(min(BACKUP_TIMEOUT_SECONDS, remaining - CYCLE_MARGIN_SECONDS))
    return limit if limit >= LONG_MIN_SECONDS else None


def process_actions(h, values, key, now_ms=None, cycle=None):
    """Verify and run pending requests. ``cycle["long"]`` becomes True when a long action ran.

    At most one long action runs per cycle, and no action starts when too little of
    the cycle is left; such requests stay pending for the next cycle.
    """
    cycle = {} if cycle is None else cycle
    if not table_ready(h, "host_action_requests"):
        return []
    # The controller holds the deploy lock, so anything still running was interrupted.
    for row_id in json_rows(psql(h, RUNNING_SQL)):
        transition(h, key, row_id, "running", "failed", {
            "message": "The controller stopped before recording a result. The action may or may not have "
                       "completed; check the host state before requesting it again."})
    handled = []
    for row in json_rows(psql(h, PENDING_SQL)):
        verdict, message = verify_request(row, key, int(time.time() * 1000) if now_ms is None else now_ms)
        row_id = row.get("id") if isinstance(row.get("id"), str) and UUID.fullmatch(row.get("id", "")) else None
        if row_id is None:
            continue
        if verdict != "ok":
            transition(h, key, row_id, "pending", verdict, {"message": message})
            handled.append((row_id, verdict))
            continue
        remaining = h.cycle_remaining()
        if remaining is not None and remaining < ACTION_START_MIN_SECONDS:
            log("little time is left in this cycle; remaining requests wait for the next one")
            break
        is_long = row["action"] in LONG_ACTIONS
        if is_long and cycle.get("long"):
            log("one backup or restore check per cycle; " + row["action"] + " waits for the next cycle")
            continue
        if not transition(h, key, row_id, "pending", "running"):
            continue  # canceled meanwhile
        if is_long:
            cycle["long"] = True
        try:
            outcome, status = execute(h, values, row), "succeeded"
        except Exception as error:
            outcome, status = {"message": safe_message(error)}, "failed"
        log(row["action"] + " " + status)
        transition(h, key, row_id, "running", status, outcome)
        handled.append((row_id, status))
    return handled


# ---- Backups ---------------------------------------------------------------

def backup_dir(h):
    return h.ROOT / "backups" / "scheduled"


def backup_keys(values):
    """The current key first, then previous keys: (key id, openssl passphrase, MAC key)."""
    current = values.get("SECURITY_ENCRYPTION_KEY", "")
    if not current:
        raise DeploymentError("The runtime encryption key is unavailable; no backup was written")
    keys, seen = [], set()
    for raw in [current] + re.split(r"[\s,]+", values.get("SECURITY_ENCRYPTION_PREVIOUS_KEYS", "")):
        if not raw:
            continue
        material = hmac.new(raw.encode(), BACKUP_ENCRYPTION_LABEL, hashlib.sha256).digest()
        key_id = hashlib.sha256(material).hexdigest()[:16]
        if key_id not in seen:
            seen.add(key_id)
            keys.append({"id": key_id, "passphrase": material.hex(),
                         "mac": hmac.new(raw.encode(), BACKUP_MAC_LABEL, hashlib.sha256).digest()})
    return keys


def offsite_settings(values):
    """None when not configured, "invalid" when partly or wrongly configured, else a settings dict."""
    present = [key for key in S3_KEYS if values.get(key, "").strip()]
    if not present:
        return None
    if len(present) != len(S3_KEYS):
        return "invalid"
    endpoint = values["BACKUP_S3_ENDPOINT"].strip().rstrip("/")
    parts = urlsplit(endpoint)
    bucket, region = values["BACKUP_S3_BUCKET"].strip(), values["BACKUP_S3_REGION"].strip()
    access, secret = values["BACKUP_S3_ACCESS_KEY_ID"].strip(), values["BACKUP_S3_SECRET_ACCESS_KEY"].strip()
    prefix = values.get("BACKUP_S3_PREFIX", "gymmembership/backups/").strip()
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    valid = (parts.scheme == "https" and parts.hostname and not parts.username and not parts.password
             and parts.path == "" and not parts.query and not parts.fragment
             and re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket)
             and re.fullmatch(r"[a-z0-9-]{2,32}", region)
             and re.fullmatch(r"[A-Za-z0-9._/-]{0,200}", prefix) and ".." not in prefix and not prefix.startswith("/")
             and re.fullmatch(r"[A-Za-z0-9+/=_.-]{8,128}", access) and 8 <= len(secret) <= 256
             and not any(c.isspace() for c in secret))
    if not valid:
        return "invalid"
    return {"endpoint": endpoint, "bucket": bucket, "region": region, "prefix": prefix,
            "access_key": access, "secret_key": secret}


def backup_settings(values):
    def bounded(name, default, low, high):
        raw = values.get(name, "").strip()
        if re.fullmatch(r"[0-9]{1,4}", raw) and low <= int(raw) <= high:
            return int(raw)
        if raw:
            warn(name + " is outside " + str(low) + "-" + str(high) + "; using " + str(default))
        return default
    offsite = offsite_settings(values)
    return {"interval_hours": bounded("BACKUP_INTERVAL_HOURS", DEFAULT_INTERVAL_HOURS, 1, 168),
            "keep": bounded("BACKUP_KEEP", DEFAULT_KEEP, 2, 90), "offsite": offsite}


def list_backups(directory):
    """Complete backups (encrypted dump plus metadata), newest first."""
    records = []
    if not directory.is_dir():
        return records
    for meta in directory.iterdir():
        name = meta.name[:-5] if meta.name.endswith(".json") else None
        if not name or not BACKUP_NAME.fullmatch(name) or meta.is_symlink():
            continue
        dump = directory / (name + ".dump.enc")
        try:
            record = json.loads(meta.read_text())
        except (OSError, ValueError):
            continue
        if (isinstance(record, dict) and record.get("name") == name and dump.is_file() and not dump.is_symlink()
                and isinstance(record.get("sha256"), str) and HEX64.fullmatch(record["sha256"])):
            records.append(record)
    return sorted(records, key=lambda r: r["name"], reverse=True)


def load_state(directory):
    try:
        data = json.loads((directory / "state.json").read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(directory, state):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    atomic_json(directory / "state.json", state)


def location(record):
    return "local+offsite" if (record.get("offsite") or {}).get("status") == "uploaded" else "local"


def summarize(record):
    if not record:
        return None
    offsite = record.get("offsite") or {"status": "not_configured"}
    return {"name": record["name"], "createdAt": record["createdAt"], "sizeBytes": record["sizeBytes"],
            "sha256": record["sha256"], "keyId": record.get("keyId"), "kind": record.get("kind"),
            "location": location(record),
            "offsite": {"status": offsite.get("status", "not_configured"), "at": offsite.get("at"),
                        "objectKey": offsite.get("objectKey"), "error": offsite.get("error")}}


def file_digests(path, mac_key):
    digest, tag = hashlib.sha256(), hmac.new(mac_key, digestmod=hashlib.sha256)
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
            tag.update(chunk)
    return digest.hexdigest(), tag.hexdigest()


def openssl_environment(h, passphrase):
    environment = h.engine_environment()
    environment["GM_BACKUP_PASSPHRASE"] = passphrase
    return environment


def open_dump(h, sha):
    """Custom-format dump streamed from the database container to stdout."""
    release = h.ROOT / "releases" / sha
    command, environment = h.compose_command(release, sha, "exec", "-T", "database", "pg_dump", "-U",
                                             "trainer_migrations", "-Fc", "-Z", "6", "trainer")
    return subprocess.Popen(command, cwd=release, env=environment, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)


def open_restore(h, sha, database):
    """pg_restore into a scratch database, reading the archive from stdin."""
    if not SCRATCH_NAME.fullmatch(database):
        raise DeploymentError("Restores go only into a scratch database")
    release = h.ROOT / "releases" / sha
    command, environment = h.compose_command(release, sha, "exec", "-T", "database", "pg_restore", "-U",
                                             "trainer_migrations", "-d", database, "--no-owner", "--exit-on-error")
    return subprocess.Popen(command, cwd=release, env=environment, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def pump(source, sink, processes, limit=BACKUP_TIMEOUT_SECONDS, guard=None):
    """Copy a stream while hashing it; kill every process if it takes too long.

    ``guard`` is called after every chunk and every few seconds while the processes
    finish (a restore builds its indexes after the stream ends). When it raises,
    every process is killed and the error propagates.
    """
    digest, size, head = hashlib.sha256(), 0, b""
    timer = threading.Timer(limit, lambda: [p.kill() for p in processes if p.poll() is None])
    timer.daemon = True
    timer.start()
    deadline = time.monotonic() + limit + 30
    try:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            if len(head) < 5:
                head += chunk[:5 - len(head)]
            digest.update(chunk)
            size += len(chunk)
            sink.write(chunk)
            if guard:
                guard()
        sink.close()
        codes = []
        for process in processes:
            while True:
                try:
                    codes.append(process.wait(timeout=max(0.1, min(GUARD_INTERVAL_SECONDS if guard else limit,
                                                                   deadline - time.monotonic()))))
                    break
                except subprocess.TimeoutExpired:
                    if time.monotonic() >= deadline:
                        raise
                    if guard:
                        guard()
    except BaseException:
        for p in processes:
            if p.poll() is None:
                p.kill()
        raise
    finally:
        timer.cancel()
    return digest.hexdigest(), size, head, codes


def disk_free(h):
    """Free bytes on the filesystems holding the backups and Docker's volumes (the database)."""
    directory = backup_dir(h)
    paths = [directory if directory.is_dir() else h.ROOT] + ([DOCKER_ROOT] if DOCKER_ROOT.is_dir() else [])
    return min(shutil.disk_usage(path).free for path in paths)


def free_space_guard(h, floor, what):
    def guard():
        free = disk_free(h)
        if free < floor:
            raise DeploymentError("Free disk space fell to " + str(free // (1 << 20)) + " MiB during the " + what
                                  + "; it was stopped to protect the production database")
    return guard


DATABASE_FACTS_SQL = ("SELECT pg_database_size('trainer')::text||' '||"
                      "pg_size_bytes(current_setting('max_wal_size'))::text;")


def database_facts(h):
    """(size of the production database, max_wal_size) in bytes, measured now."""
    parts = psql(h, DATABASE_FACTS_SQL, timeout=60).split()
    if len(parts) != 2 or not all(re.fullmatch(r"[0-9]{1,20}", part) for part in parts):
        raise DeploymentError("The database size could not be measured")
    return int(parts[0]), int(parts[1])


def run_backup(h, values, kind, now=None, limit=BACKUP_TIMEOUT_SECONDS):
    """Write one encrypted, checksummed custom-format dump; upload it when configured."""
    if kind not in ("scheduled", "manual"):
        raise DeploymentError("Unknown backup kind")
    settings, keys = backup_settings(values), backup_keys(values)
    key = keys[0]
    sha = h.serving_release(h.read_state())
    if not sha:
        raise DeploymentError("No release is deployed yet; there is no database to back up")
    directory = backup_dir(h)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    for stale in directory.glob("*.partial"):
        # The controller holds the deploy lock: a partial file is from an interrupted run.
        stale.unlink(missing_ok=True)
    records = list_backups(directory)
    needed = max(1 << 30, 3 * int(records[0].get("plainSizeBytes", 0))) if records else 1 << 30
    free = disk_free(h)
    if free < needed:
        raise DeploymentError("Not enough free disk space for a backup: " + str(free // (1 << 20)) + " MiB free, "
                              + str(needed // (1 << 20)) + " MiB needed")
    try:
        # Recorded so a restore check can size its scratch copy by the real database.
        database_size = database_facts(h)[0]
    except Exception:
        database_size = None
    created = time.time() if now is None else now
    name = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(created))
    for suffix in range(1, 1000):
        if not (directory / (name + ".dump.enc")).exists():
            break
        name = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(created)) + "-" + str(suffix)
    partial = directory / (name + ".dump.enc.partial")
    started = []
    try:
        with open(partial, "xb", opener=private) as output:
            started.append(subprocess.Popen(["openssl", "enc", "-e", *CIPHER, "-salt", "-pass",
                                             "env:GM_BACKUP_PASSPHRASE"], stdin=subprocess.PIPE, stdout=output,
                                            stderr=subprocess.DEVNULL, env=openssl_environment(h, key["passphrase"])))
            started.append(open_dump(h, sha))
            encrypt, dump = started
            plain_sha, plain_size, head, codes = pump(dump.stdout, encrypt.stdin, [dump, encrypt], limit,
                                                      free_space_guard(h, BACKUP_FREE_FLOOR_BYTES, "backup"))
        if any(codes):
            raise DeploymentError("The database dump or its encryption failed; no backup was recorded")
        if plain_size == 0 or head != b"PGDMP":
            raise DeploymentError("The database dump was not a custom-format archive; no backup was recorded")
        digest, tag = file_digests(partial, key["mac"])
        final = directory / (name + ".dump.enc")
        os.replace(partial, final)
    except BaseException:
        for process in started:
            if process.poll() is None:
                process.kill()
        partial.unlink(missing_ok=True)
        raise
    record = {"version": 1, "name": name, "createdAt": iso(created), "kind": kind, "format": FORMAT,
              "keyId": key["id"], "sizeBytes": final.stat().st_size, "sha256": digest, "hmacSha256": tag,
              "plainSha256": plain_sha, "plainSizeBytes": plain_size, "databaseSizeBytes": database_size,
              "release": sha, "database": "trainer", "offsite": {"status": "not_configured"}}
    atomic_json(directory / (name + ".json"), record)
    if settings["offsite"]:
        record["offsite"] = upload_backup(directory, record, settings["offsite"])
        atomic_json(directory / (name + ".json"), record)
    prune_backups(directory, settings["keep"])
    log("backup " + name + " written (" + location(record) + ")")
    return record


def prune_backups(directory, keep):
    """Keep the newest complete backups; never touch other files."""
    for record in list_backups(directory)[keep:]:
        for suffix in (".dump.enc", ".json"):
            try:
                (directory / (record["name"] + suffix)).unlink(missing_ok=True)
            except OSError:
                warn("an old backup could not be removed; retrying after the next backup")


def backup_with_state(h, values, kind, now=None, limit=BACKUP_TIMEOUT_SECONDS):
    directory = backup_dir(h)
    state = load_state(directory)
    state["lastAttemptAt"] = iso(now)
    try:
        record = run_backup(h, values, kind, now, limit)
    except Exception as error:
        state["lastFailure"] = {"at": iso(now), "message": safe_message(error)}
        save_state(directory, state)
        raise
    state["lastFailure"] = None
    save_state(directory, state)
    return record


def scheduled_backup(h, values, deployed, now=None):
    """Run the daily (or configured) backup when due.

    ``deployed`` is True when this cycle recorded a deployment or ran a long host
    action; the backup then waits one cycle, unless it is overdue by an hour or no
    backup exists. A backup starts only with enough of the cycle left to finish.
    """
    now = time.time() if now is None else now
    settings = backup_settings(values)
    directory = backup_dir(h)
    records = list_backups(directory)
    latest_at = parse_iso(records[0]["createdAt"]) if records else None
    # A five-minute tolerance keeps a daily backup from drifting by one timer cycle per day.
    due = latest_at is None or now - latest_at >= settings["interval_hours"] * 3600 - 300
    state = load_state(directory)
    if not due:
        retry_offsite(h, settings, records, state, now)
        return None
    overdue = latest_at is None or now - latest_at >= settings["interval_hours"] * 3600 + OVERDUE_SECONDS
    if deployed and not overdue:
        log("backup deferred to the next cycle after a deployment or a long host action")
        return None
    failure = parse_iso((state.get("lastFailure") or {}).get("at"))
    if failure is not None and now - failure < FAILURE_BACKOFF_SECONDS:
        return None
    limit = cycle_limit(h)
    if limit is None:
        log("backup deferred: too little of this cycle is left")
        return None
    return backup_with_state(h, values, "scheduled", now, limit)


def retry_offsite(h, settings, records, state, now):
    """Retry the latest backup's off-server copy at most hourly after a failure."""
    if not records or not isinstance(settings["offsite"], dict):
        return
    record = records[0]
    if (record.get("offsite") or {}).get("status") == "uploaded":
        return
    last = parse_iso(state.get("lastUploadAttemptAt"))
    if last is not None and now - last < FAILURE_BACKOFF_SECONDS:
        return
    directory = backup_dir(h)
    state["lastUploadAttemptAt"] = iso(now)
    save_state(directory, state)
    record["offsite"] = upload_backup(directory, record, settings["offsite"])
    atomic_json(directory / (record["name"] + ".json"), record)


def verify_backup_file(directory, record, keys):
    """Check the stored checksum and the keyed authentication tag of an encrypted dump."""
    key = next((k for k in keys if k["id"] == record.get("keyId")), None)
    if key is None:
        raise DeploymentError("The key that encrypted this backup is not in the runtime settings "
                              "(SECURITY_ENCRYPTION_KEY or SECURITY_ENCRYPTION_PREVIOUS_KEYS)")
    digest, tag = file_digests(directory / (record["name"] + ".dump.enc"), key["mac"])
    if not hmac.compare_digest(digest, record.get("sha256", "")):
        raise DeploymentError("The backup file does not match its recorded checksum")
    if not hmac.compare_digest(tag, record.get("hmacSha256", "")):
        raise DeploymentError("The backup file failed its authentication check")
    return key


VERIFY_SQL = ("SELECT json_build_object('migrations',(SELECT coalesce(json_agg(version ORDER BY version),'[]'::json) "
              "FROM schema_migrations),'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),"
              "'users',(SELECT count(*) FROM users),'tenants',(SELECT count(*) FROM tenants));")


SCRATCH_SQL = ("SELECT coalesce(json_agg(datname ORDER BY datname),'[]'::json) FROM pg_database "
               "WHERE left(datname,14)='restore_check_';")


def drop_leftover_scratch(h):
    """Drop restore-check databases left by a stopped or killed run.

    A scratch database holds a full copy of production data, so only those kept on
    purpose (``restore-check --keep``, recorded in state.json) survive.
    """
    directory = backup_dir(h)
    names = [n for n in json_rows(psql(h, SCRATCH_SQL, database="postgres", timeout=60))
             if isinstance(n, str) and SCRATCH_NAME.fullmatch(n)]
    state = load_state(directory)
    kept = [n for n in state.get("keptScratch") or [] if n in names]
    if kept != (state.get("keptScratch") or []):
        state["keptScratch"] = kept
        save_state(directory, state)
    dropped = [n for n in names if n not in kept]
    for name in dropped:
        psql(h, "DROP DATABASE IF EXISTS " + name + " WITH (FORCE);", database="postgres")
    if dropped:
        log("removed " + str(len(dropped)) + " leftover restore-check database(s)")
    return dropped


def expected_migrations(h, state):
    """Migrations of the newest recorded release and of the serving one (after a rollback)."""
    expected = set()
    for sha in {state.get("current"), h.serving_release(state)} - {None}:
        folder = h.ROOT / "releases" / valid_sha(sha) / "packages/db/migrations"
        expected |= {p.name[:-4] for p in folder.glob("*.sql")}
    return expected


def restore_check(h, values, name=None, keep=False, limit=BACKUP_TIMEOUT_SECONDS):
    """Restore a backup into a scratch database, verify it, then drop the scratch database."""
    directory = backup_dir(h)
    records = list_backups(directory)
    record = next((r for r in records if name is None or r["name"] == name), None)
    if record is None:
        raise DeploymentError("No complete backup is available to verify" if name is None else "Backup not found")
    key = verify_backup_file(directory, record, backup_keys(values))
    drop_leftover_scratch(h)
    # The scratch copy lives in the production cluster, on its disk and its WAL. Size
    # it by the real database (a compressed dump is several times smaller), and keep
    # room for the production WAL.
    live_size, max_wal = database_facts(h)
    recorded = record.get("databaseSizeBytes")
    size = max(live_size, recorded if isinstance(recorded, int) and not isinstance(recorded, bool) else 0)
    floor = max_wal + (1 << 30)
    needed = size * 3 // 2 + floor
    free = disk_free(h)
    if free < needed:
        raise DeploymentError("Not enough free disk space to restore a scratch copy: " + str(free // (1 << 20))
                              + " MiB free, " + str(needed // (1 << 20)) + " MiB needed")
    state = h.read_state()
    sha = h.serving_release(state)
    scratch = "restore_check_" + secrets.token_hex(6)
    if keep:
        kept = load_state(directory)
        kept["keptScratch"] = (kept.get("keptScratch") or []) + [scratch]
        save_state(directory, kept)
    psql(h, "CREATE DATABASE " + scratch + ";", database="postgres")
    started = []
    try:
        started.append(subprocess.Popen(["openssl", "enc", "-d", *CIPHER, "-pass", "env:GM_BACKUP_PASSPHRASE", "-in",
                                         str(directory / (record["name"] + ".dump.enc"))],
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                        env=openssl_environment(h, key["passphrase"])))
        started.append(open_restore(h, sha, scratch))
        decrypt, restore = started
        plain_sha, _, _, codes = pump(decrypt.stdout, restore.stdin, [decrypt, restore], limit,
                                      free_space_guard(h, floor, "restore check"))
        if codes[0]:
            raise DeploymentError("The backup could not be decrypted")
        if plain_sha != record.get("plainSha256"):
            raise DeploymentError("The decrypted backup does not match its recorded checksum")
        if codes[1]:
            raise DeploymentError("pg_restore failed for the scratch database")
        facts = json.loads(psql(h, VERIFY_SQL, database=scratch).strip())
        expected = expected_migrations(h, state)
        applied = set(facts.get("migrations") or [])
        unknown = sorted(applied - expected)
        ok = bool(applied) and not unknown and int(facts.get("tables", 0)) > 0
        message = ("Backup " + record["name"] + " restored into a scratch database: " + str(len(applied))
                   + " migrations, " + str(facts.get("tables")) + " tables, " + str(facts.get("tenants"))
                   + " workspaces, " + str(facts.get("users")) + " accounts.")
        if unknown:
            message = "The restored backup has migrations no deployed release knows: " + ", ".join(unknown[:5])
        elif not applied:
            message = "The restored backup has no migration history"
        return {"ok": ok, "backup": record["name"], "message": message, "migrations": len(applied),
                "pendingMigrations": len(expected - applied), "tables": facts.get("tables"),
                "tenants": facts.get("tenants"), "users": facts.get("users"),
                "scratchDatabase": scratch if keep else None}
    finally:
        for process in started:
            if process.poll() is None:
                process.kill()
        if not keep:
            # FORCE also ends a pg_restore session still running inside the container.
            psql(h, "DROP DATABASE IF EXISTS " + scratch + " WITH (FORCE);", database="postgres")


def verify_with_state(h, values, name=None, keep=False, limit=BACKUP_TIMEOUT_SECONDS):
    directory = backup_dir(h)
    try:
        result = restore_check(h, values, name, keep, limit)
    except Exception as error:
        result = {"ok": False, "backup": name, "message": safe_message(error)}
    state = load_state(directory)
    state["lastVerification"] = {"at": iso(), "ok": bool(result["ok"]), "backup": result.get("backup"),
                                 "message": str(result["message"])[:500]}
    save_state(directory, state)
    return result


# ---- S3-compatible off-server copies (AWS Signature Version 4) ------------

def sigv4_authorization(method, url, headers, payload_hash, region, service, amz_date, access_key, secret_key):
    """Authorization header for an already percent-encoded URL and the headers to sign."""
    parts = urlsplit(url)
    query = sorted(parse_qsl(parts.query, keep_blank_values=True))
    canonical_query = "&".join(quote(k, safe="-_.~") + "=" + quote(v, safe="-_.~") for k, v in query)
    values = {k.lower(): " ".join(str(v).strip().split()) for k, v in headers.items()}
    names = sorted(values)
    canonical = "\n".join([method, parts.path or "/", canonical_query,
                           "".join(n + ":" + values[n] + "\n" for n in names), ";".join(names), payload_hash])
    scope = amz_date[:8] + "/" + region + "/" + service + "/aws4_request"
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope,
                                hashlib.sha256(canonical.encode()).hexdigest()])
    key = ("AWS4" + secret_key).encode()
    for part in (amz_date[:8], region, service, "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return ("AWS4-HMAC-SHA256 Credential=" + access_key + "/" + scope + ", SignedHeaders=" + ";".join(names)
            + ", Signature=" + signature)


def s3_request(settings, method, object_key, body=None, size=0, payload_hash=EMPTY_SHA256,
               content_type="application/octet-stream", now=None):
    if not re.fullmatch(r"[A-Za-z0-9._/-]{1,400}", object_key) or ".." in object_key:
        raise DeploymentError("Unexpected storage object name")
    url = settings["endpoint"] + "/" + settings["bucket"] + "/" + quote(object_key, safe="/-_.~")
    amz_date = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(time.time() if now is None else now))
    signed = {"host": urlsplit(url).netloc, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    headers = {"Authorization": sigv4_authorization(method, url, signed, payload_hash, settings["region"], "s3",
                                                    amz_date, settings["access_key"], settings["secret_key"]),
               "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date,
               "User-Agent": "GymMembership-backup"}
    if body is not None:
        headers["Content-Length"] = str(size)
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=120) as response:
        response.read(65536)
        return response.status, response.headers


def upload_backup(directory, record, settings, now=None):
    """Upload the encrypted dump and its metadata, then confirm the stored size."""
    base = settings["prefix"] + record["name"]
    try:
        dump = directory / (record["name"] + ".dump.enc")
        with open(dump, "rb") as stream:
            s3_request(settings, "PUT", base + ".dump.enc", body=stream, size=record["sizeBytes"],
                       payload_hash=record["sha256"], now=now)
        metadata = json.dumps({k: v for k, v in record.items() if k != "offsite"}, sort_keys=True).encode()
        s3_request(settings, "PUT", base + ".json", body=metadata, size=len(metadata),
                   payload_hash=hashlib.sha256(metadata).hexdigest(), content_type="application/json", now=now)
        status, headers = s3_request(settings, "HEAD", base + ".dump.enc", now=now)
        if status != 200 or headers.get("Content-Length") != str(record["sizeBytes"]):
            raise DeploymentError("Off-server storage did not confirm the uploaded size")
    except Exception as error:
        warn("off-server copy failed: " + safe_message(error))
        return {"status": "failed", "at": iso(now), "objectKey": base + ".dump.enc", "error": safe_message(error)}
    return {"status": "uploaded", "at": iso(now), "objectKey": base + ".dump.enc", "error": None}


# ---- Host status report ----------------------------------------------------

def host_metrics(root):
    def meminfo():
        values = {}
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                match = re.fullmatch(r"(\w+):\s+(\d+) kB", line.strip())
                if match:
                    values[match.group(1)] = int(match.group(2)) * 1024
        except OSError:
            return None
        if "MemTotal" not in values or "MemAvailable" not in values:
            return None
        return {"totalBytes": values["MemTotal"], "availableBytes": values["MemAvailable"],
                "swapTotalBytes": values.get("SwapTotal", 0), "swapFreeBytes": values.get("SwapFree", 0)}
    try:
        load = [round(v, 3) for v in os.getloadavg()]
    except OSError:
        load = None
    try:
        uptime = round(float(Path("/proc/uptime").read_text().split()[0]), 1)
    except (OSError, ValueError, IndexError):
        uptime = None
    disks, seen = [], set()
    for mount in ("/", str(root)):
        try:
            device = os.stat(mount).st_dev
            if device in seen:
                continue
            seen.add(device)
            usage = shutil.disk_usage(mount)
            disks.append({"mount": mount, "totalBytes": usage.total, "usedBytes": usage.used, "freeBytes": usage.free})
        except OSError:
            continue
    return {"cpuCount": os.cpu_count(), "load": load, "uptimeSeconds": uptime, "memory": meminfo(), "disks": disks}


def container_status(h, sha):
    try:
        result = h.compose(h.ROOT / "releases" / sha, sha, "ps", "--all", "--format", "json",
                           capture_output=True, text=True, timeout=60)
        text = (result.stdout or "").strip()
        items = json.loads(text) if text.startswith("[") else [json.loads(line) for line in text.splitlines()
                                                                 if line.strip()]
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
    containers = []
    for item in items[:20]:
        if not isinstance(item, dict):
            continue
        exit_code = item.get("ExitCode")
        containers.append({"service": str(item.get("Service", ""))[:40], "state": str(item.get("State", ""))[:40],
                           "health": str(item.get("Health"))[:40] if item.get("Health") else None,
                           "exitCode": exit_code if isinstance(exit_code, int) and not isinstance(exit_code, bool)
                           else None})
    return containers


def controller_release():
    parts = Path(__file__).resolve().parts
    try:
        index = parts.index("releases")
        return valid_sha(parts[index + 1])
    except (ValueError, IndexError, DeploymentError):
        return None


def backup_summary(h, values):
    settings = backup_settings(values)
    directory = backup_dir(h)
    records, state = list_backups(directory), load_state(directory)
    latest = records[0] if records else None
    latest_at = parse_iso(latest["createdAt"]) if latest else None
    offsite = settings["offsite"]
    return {"policy": {"intervalHours": settings["interval_hours"], "keep": settings["keep"],
                       "offsite": "invalid" if offsite == "invalid" else "configured" if offsite else "not_configured"},
            "count": len(records), "totalBytes": sum(int(r.get("sizeBytes", 0)) for r in records),
            "latest": summarize(latest), "lastAttemptAt": state.get("lastAttemptAt"),
            "lastFailure": state.get("lastFailure"), "lastVerification": state.get("lastVerification"),
            "nextDueAt": iso(latest_at + settings["interval_hours"] * 3600) if latest_at else None}


def edge_state(h, values, endpoint, sha):
    """What the edge serves (the Caddyfile on disk), not only what runtime.env asks for.

    The Caddyfile changes only when a release is started (deploy, rollback, return,
    re-apply), so after a settings change or a rollout by an older controller the
    served edge can lag behind; that shows as ``pendingReapply``.
    """
    ask = h.edge_ask(values)
    # A controller older than workspace subdomains has no edge_root.
    root = h.edge_root(values) if hasattr(h, "edge_root") else None
    try:
        served = (h.ROOT / "Caddyfile").read_text()
    except OSError:
        served = None
    try:
        if not endpoint or not sha:
            expected = None
        elif root:
            expected = h.edge_config(endpoint, sha, ask, root)
        else:
            expected = h.edge_config(endpoint, sha, ask)
    except DeploymentError:
        expected = None
    return {"onDemandTls": served is not None and served.startswith("{\n    on_demand_tls {\n"),
            "onDemandConfigured": bool(ask), "pendingReapply": expected is not None and served != expected,
            "endpoint": endpoint[:300]}


def build_report(h, values):
    state, control = h.read_state(), h.deploy_control()
    sha = h.serving_release(state)
    try:
        endpoint = h.endpoint_url()
    except (OSError, ValueError, KeyError):
        endpoint = ""
    paused_at = control.get("changed_at") if control.get("paused") else None
    reason = control.get("reason") if control.get("paused") else None
    return {"version": 1, "generatedAt": iso(), "controllerRelease": controller_release(),
            "host": host_metrics(h.ROOT), "containers": container_status(h, sha) if sha else None,
            "edge": edge_state(h, values, endpoint, sha),
            "deploy": {"current": state.get("current"), "previous": state.get("previous"),
                       "serving": state.get("serving"), "deployedAt": state.get("deployed_at"),
                       "paused": bool(control.get("paused")),
                       "pausedAt": paused_at if isinstance(paused_at, int) else None,
                       "pausedReason": reason if reason in ("operator", "rollback", "unreadable") else None},
            "backups": backup_summary(h, values)}


def write_report(h, key, report):
    payload = json.dumps(report, sort_keys=True, separators=(",", ":"))
    if len(payload.encode()) > 200000:
        raise DeploymentError("Host report is unexpectedly large")
    atomic_json(h.ROOT / "host-status.json", report)
    if not table_ready(h, "host_status"):
        return False
    signature = sign(key, "gymmembership-host-status-v1", "controller", payload)
    psql(h, "INSERT INTO host_status(source,payload,signature,reported_at) VALUES('controller'," + text_sql(payload)
         + ",'" + signature + "',now()) ON CONFLICT(source) DO UPDATE SET payload=EXCLUDED.payload,"
         "signature=EXCLUDED.signature,reported_at=now();")
    return True


# ---- Controller hooks ------------------------------------------------------

def ready(h):
    values = h.runtime_values()
    if not values or not h.serving_release(h.read_state()):
        return None, None
    return values, host_key(values)


def before_deploy(h):
    """Operator actions run first so a pause or rollback applies to this cycle's deployment.

    Returns True when a long action (a backup or a restore check) ran; the cycle then
    skips its deployment so the two together stay within the unit's time limit.
    """
    cycle = {}
    try:
        values, key = ready(h)
    except Exception as error:
        warn("operator actions were not processed: " + safe_message(error))
        return False
    if not values:
        return False
    try:
        drop_leftover_scratch(h)
    except Exception as error:
        warn("leftover restore-check databases were not checked: " + safe_message(error))
    try:
        process_actions(h, values, key, cycle=cycle)
    except Exception as error:
        warn("operator actions were not processed: " + safe_message(error))
    return bool(cycle.get("long"))


def after_deploy(h, deployed):
    try:
        values, key = ready(h)
    except Exception as error:
        warn("host operations are unavailable: " + safe_message(error))
        return
    if not values:
        return
    try:
        scheduled_backup(h, values, deployed)
    except Exception as error:
        warn("scheduled backup failed: " + safe_message(error))
    try:
        write_report(h, key, build_report(h, values))
    except Exception as error:
        warn("host status was not reported: " + safe_message(error))


def cli(argv):
    import host as h
    if os.geteuid() != 0:
        raise DeploymentError("Run this as root on the GymMembership server")
    command = argv[0] if argv else "status"
    with open(h.ROOT / "deploy.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise DeploymentError("The controller is running; retry in a few minutes") from None
        values = h.runtime_values()
        if not values:
            raise DeploymentError("Runtime settings are unavailable")
        if command == "status":
            print(json.dumps(backup_summary(h, values), indent=2))
        elif command == "list":
            for record in list_backups(backup_dir(h)):
                print(record["name"], record["sizeBytes"], location(record), record["sha256"])
        elif command == "backup":
            print(json.dumps(summarize(backup_with_state(h, values, "manual")), indent=2))
        elif command == "restore-check":
            name = argv[argv.index("--backup") + 1] if "--backup" in argv else None
            if name is not None and not BACKUP_NAME.fullmatch(name):
                raise DeploymentError("Unexpected backup name")
            result = verify_with_state(h, values, name, keep="--keep" in argv)
            print(json.dumps(result, indent=2))
            return 0 if result["ok"] else 1
        elif command == "reapply":
            # Console recovery when the admin page is unreachable, for example after a
            # platform address change whose readiness check failed: re-read runtime.env
            # (as a timer cycle does first) and recreate the serving release with it.
            h.ensure_runtime()
            sha = h.reapply_release()
            print("Recreated release " + sha[:12] + " for " + h.endpoint_url())
        else:
            raise DeploymentError("Commands: status, list, backup, restore-check [--backup NAME] [--keep], reapply")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(cli(sys.argv[1:]))
    except Exception as error:
        print(safe_message(error), file=sys.stderr)
        sys.exit(1)
