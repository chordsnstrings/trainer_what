"""Dedicated GymMembership host bootstrap and checked-main deployment controller."""
import base64
import fcntl
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import time
import urllib.request
from urllib.parse import unquote, urlparse, urlsplit
from pathlib import Path

from common import API, REPOSITORY, DeploymentError, NoRedirect, approved_head, atomic_json, droplet_name, extract_release, validate_config, valid_sha

ROOT = Path("/opt/gymmembership")


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def metadata(name):
    with urllib.request.urlopen("http://169.254.169.254/metadata/v1/" + name, timeout=5) as response:
        return response.read().decode().strip()


def assert_instance(config, owner, instance_id, hostname):
    validate_config(config)
    if (hostname != droplet_name(config) or not str(instance_id).isdigit() or int(instance_id) <= 0
            or isinstance(owner.get("droplet_id"), bool) or str(owner.get("droplet_id")) != str(instance_id)):
        raise DeploymentError("This is not the owned GymMembership server")
    if owner.get("deployment_id") != config["deployment_id"] or owner.get("project_id") != config["project_id"]:
        raise DeploymentError("Deployment ownership mismatch")
    if owner.get("repository", REPOSITORY) != REPOSITORY:
        raise DeploymentError("Deployment repository mismatch")


def engine_environment():
    return {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "TMPDIR") if key in os.environ}


def docker(*args):
    """Best-effort local engine maintenance; failures are reported by return code only."""
    try:
        return subprocess.run(["docker", *args], env=engine_environment(), capture_output=True, text=True,
                              check=False, timeout=600)
    except (OSError, subprocess.SubprocessError):
        return None


def compose_command(release, sha, *args):
    command = ["docker", "compose", "--project-name", "gymmembership",
               "--env-file", str(ROOT / "runtime.env"), "-f", str(release / "compose.yaml"),
               "-f", str(ROOT / "edge.json"), *args]
    # The reviewed private runtime file is authoritative. Inherited application
    # flags/credentials must not override it, nor may DOCKER_HOST redirect this
    # dedicated-server controller to another engine.
    environment = engine_environment()
    environment["RELEASE_TAG"] = valid_sha(sha)
    return command, environment


def compose(release, sha, *args, **kwargs):
    command, environment = compose_command(release, sha, *args)
    return run(command, cwd=release, env=environment, **kwargs)


def wait_ready(url, attempts=60, expected_sha=None):
    if expected_sha is not None:
        valid_sha(expected_sha)
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(attempts):
        try:
            with opener.open(url, timeout=5) as response:
                correct_release = expected_sha is None or response.headers.get("X-GymMembership-Release") == expected_sha
                is_ready = not url.endswith("/api/v1/ready") or json.loads(response.read(4096)).get("status") == "ready"
                if response.status == 200 and correct_release and is_ready:
                    return
        except (OSError, TimeoutError, ValueError, AttributeError):
            pass
        if attempt + 1 < attempts:
            time.sleep(3)
    raise DeploymentError("Application readiness did not pass at " + url)


FINGERPRINT = "runtime.fingerprint"
DATABASE_VOLUME = "gymmembership_postgres_data"


def existing_deployment():
    """True when this host already has state that only the original runtime secrets can open."""
    def non_empty(directory):
        return directory.is_dir() and any(directory.iterdir())
    if ((ROOT / "release-state.json").exists() or (ROOT / FINGERPRINT).exists()
            or non_empty(ROOT / "releases") or non_empty(ROOT / "backups")):
        return True
    result = docker("volume", "inspect", DATABASE_VOLUME)
    return result is not None and result.returncode == 0


TLS_ASK_URL = "http://api:4000/api/v1/internal/tls/ask?token="


def edge_config(endpoint, revision=None, ask=None):
    # Overwrite X-Forwarded-For with the connecting address: the web proxy signs it
    # for the API's per-client budgets, so a client must not be able to choose it.
    release = "    header X-GymMembership-Release " + valid_sha(revision) + "\n" if revision else ""
    site = ("    encode zstd gzip\n" + release
            + "    reverse_proxy web:3000 {\n        header_up X-Forwarded-For {remote_host}\n    }\n")
    if not ask:
        return endpoint + " {\n" + site + "}\n"
    if not ask.startswith(TLS_ASK_URL) or not re.fullmatch(r"[0-9a-f]{64}", ask[len(TLS_ASK_URL):]):
        raise DeploymentError("Unexpected TLS ask endpoint")
    # Coach domains: Caddy obtains a certificate on the first TLS handshake for a
    # name only when the API's ask endpoint answers 200 (an active, verified
    # mapping or a short activation allowance). The platform keeps its own block.
    return ("{\n    on_demand_tls {\n        ask " + ask + "\n    }\n}\n\n"
            + endpoint + " {\n" + site + "}\n\n"
            + "https:// {\n    tls {\n        on_demand\n    }\n" + site + "}\n")


def runtime_values():
    """Parsed private runtime settings, or an empty mapping when unavailable."""
    path = ROOT / "runtime.env"
    try:
        mode = path.lstat().st_mode
        if not stat.S_ISREG(mode) or mode & 0o077:
            return {}
        return dict(line.split("=", 1) for line in path.read_text().splitlines()
                    if line and not line.startswith("#") and "=" in line)
    except OSError:
        return {}


def edge_ask(values=None):
    """On-demand TLS ask URL with a token derived from the proxy secret, unless disabled."""
    values = runtime_values() if values is None else values
    secret = values.get("INTERNAL_PROXY_SECRET", "")
    if values.get("EDGE_ON_DEMAND_TLS", "true").strip().lower() == "false" or len(secret.encode()) < 32:
        return None
    token = hmac.new(secret.encode(), b"gymmembership-tls-ask-v1", hashlib.sha256).hexdigest()
    return TLS_ASK_URL + token


def ensure_runtime():
    path = ROOT / "runtime.env"
    ip = str(ipaddress.IPv4Address(metadata("interfaces/public/0/ipv4/address")))
    if not ipaddress.ip_address(ip).is_global:
        raise DeploymentError("Expected this new server's public IPv4 address")
    if path.exists():
        mode = path.lstat().st_mode
        if not stat.S_ISREG(mode) or mode & 0o077:
            raise DeploymentError("Runtime secrets must be a private regular file")
        values = dict(line.split("=", 1) for line in path.read_text().splitlines()
                      if line and not line.startswith("#") and "=" in line)
        if not all(values.get(k) for k in ("PUBLIC_APP_URL", "POSTGRES_PASSWORD", "MIGRATION_DATABASE_URL",
                                         "DATABASE_URL", "SECURITY_ENCRYPTION_KEY", "INTERNAL_PROXY_SECRET")):
            raise DeploymentError("Runtime configuration is incomplete; recover it without changing database credentials")
    elif existing_deployment():
        # New secrets could not open the existing database, and every stored encrypted
        # record would become unreadable. Stop without writing anything.
        raise DeploymentError("Runtime secrets are missing for an existing deployment; restore "
                              + str(path) + " from its private backup. New secrets were not generated.")
    else:
        admin_password, runtime_password = secrets.token_urlsafe(36), secrets.token_urlsafe(36)
        values = {
            "POSTGRES_PASSWORD": admin_password,
            "MIGRATION_DATABASE_URL": f"postgres://trainer_migrations:{admin_password}@database:5432/trainer",
            "DATABASE_URL": f"postgres://trainer_service:{runtime_password}@database:5432/trainer",
            "SECURITY_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
            "INTERNAL_PROXY_SECRET": secrets.token_urlsafe(48),
            "PUBLIC_APP_URL": "https://gymmembership." + ip + ".sslip.io",
            "LEGAL_APPROVED": "false", "FILE_IMPORTS_APPROVED": "false",
            "NUTRITION_ENABLED": "false", "NUTRITION_SCOPE_APPROVED": "false",
            "BUNDLE_CHANGES_APPROVED": "false", "COMMERCE_APPROVED": "false",
            "PAYOUTS_APPROVED": "false", "LEAN_CONTRACT_VERIFIED": "false",
        }
        temporary = path.with_name(path.name + "." + secrets.token_hex(8) + ".next")
        with open(temporary, "x", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
            stream.write("\n".join(f"{k}={v}" for k, v in values.items()) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    if len(values["INTERNAL_PROXY_SECRET"].encode("utf-8")) < 32:
        raise DeploymentError("Internal proxy signing secret must be at least 32 UTF-8 bytes")
    if not (ROOT / FINGERPRINT).exists():
        # Non-secret marker that this host has runtime secrets, written once (or backfilled).
        atomic_json(ROOT / FINGERPRINT, {"security_encryption_key_sha256":
                                         hashlib.sha256(values["SECURITY_ENCRYPTION_KEY"].encode()).hexdigest()})
    endpoint = values["PUBLIC_APP_URL"]
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.path or parsed.query or parsed.fragment
            or any(c.isspace() for c in endpoint) or any(c in endpoint for c in "{}")):
        raise DeploymentError("Expected a public HTTPS origin")
    # Recover interruption after writing runtime.env without rotating database secrets.
    if not (ROOT / "Caddyfile").exists():
        (ROOT / "Caddyfile").write_text(edge_config(endpoint, ask=edge_ask(values)))
    if not (ROOT / "edge.json").exists():
        atomic_json(ROOT / "edge.json", {
            "services": {"edge": {
                "image": "caddy:2.11.4-alpine", "restart": "unless-stopped",
                "ports": ["80:80", "443:443"],
                "volumes": [str(ROOT / "Caddyfile") + ":/etc/caddy/Caddyfile:ro", "caddy_data:/data", "caddy_config:/config"],
            }}, "volumes": {"caddy_data": {}, "caddy_config": {}},
        })
    atomic_json(ROOT / "endpoint.json", {"url": endpoint, "ip": ip})


SERVICES = frozenset({"database", "migrate", "api", "web", "worker", "edge"})
NAMED_VOLUMES = {"database": {"postgres_data"}, "edge": {"caddy_data", "caddy_config"}}
EDGE_IMAGE = "caddy:2.11.4-alpine"
# Service settings that reach the host kernel, devices, namespaces, engine or files.
# This is a deny-list so that benign keys a newer Compose renders cannot halt every
# future deployment; only truthy values are rejected.
HOST_ACCESS_KEYS = ("privileged", "cap_add", "devices", "device_cgroup_rules", "gpus", "pid", "ipc", "uts",
                    "userns_mode", "cgroup", "cgroup_parent", "security_opt", "network_mode", "volumes_from",
                    "use_api_socket", "runtime", "isolation", "secrets", "configs", "env_file", "provider",
                    "post_start", "pre_stop")
BUILD_HOST_ACCESS_KEYS = ("additional_contexts", "secrets", "ssh", "privileged", "entitlements")


def validate_exposure(rendered, release=None):
    """Allow only the reviewed topology before any build or start.

    A release that main-branch writers control still supplies the next controller;
    this check blocks obvious Compose escalation, not a malicious controller change.
    """
    services = rendered.get("services") or {}
    if set(services) != SERVICES:
        raise DeploymentError("Compose services must be exactly " + ", ".join(sorted(SERVICES)))
    if any(service.get("network_mode") == "host" for service in services.values()):
        raise DeploymentError("Host networking would bypass the published-port boundary")
    if any(services[name].get("ports") for name in ("database", "migrate", "api", "worker")):
        raise DeploymentError("Database, migration, API and worker must not publish host ports")
    ports = services["web"].get("ports", [])
    if not ports or any(p.get("host_ip") != "127.0.0.1" for p in ports):
        raise DeploymentError("The web port must bind to localhost behind HTTPS")
    if services["database"].get("image") != "postgres:17.6-alpine":
        raise DeploymentError("Database image changes require an explicit upgrade procedure")
    if services["edge"].get("image") != EDGE_IMAGE:
        raise DeploymentError("Edge image changes require an explicit upgrade procedure")
    for name, service in sorted(services.items()):
        denied = [key for key in HOST_ACCESS_KEYS if service.get(key)]
        reservations = ((service.get("deploy") or {}).get("resources") or {}).get("reservations") or {}
        if reservations.get("devices"):
            denied.append("deploy.resources.reservations.devices")
        if denied:
            raise DeploymentError("Compose service " + name + " requests host access: " + ", ".join(denied))
        build = service.get("build")
        if build:
            if name != "migrate" or not isinstance(build, dict):
                raise DeploymentError("Only the migrate service may build the release image")
            if any(build.get(key) for key in BUILD_HOST_ACCESS_KEYS) or build.get("network") == "host":
                raise DeploymentError("The release image build must not request host access")
            if release is not None and (Path(release) / str(build.get("context") or ".")).resolve() != Path(release).resolve():
                raise DeploymentError("The release image must build from its own release directory")
        for volume in service.get("volumes") or []:
            kind = volume.get("type") if isinstance(volume, dict) else None
            if kind == "volume" and volume.get("source") in NAMED_VOLUMES.get(name, ()):
                continue
            if (kind == "bind" and name == "edge" and volume.get("source") == str(ROOT / "Caddyfile")
                    and volume.get("target") == "/etc/caddy/Caddyfile" and volume.get("read_only") is True):
                continue
            raise DeploymentError("Compose service " + name + " may mount only its named volumes"
                                  + (" and the read-only edge Caddyfile" if name == "edge" else ""))
    allowed_volumes = set().union(*NAMED_VOLUMES.values())
    for key, spec in (rendered.get("volumes") or {}).items():
        spec = spec or {}
        if (key not in allowed_volumes or spec.get("external") or spec.get("driver_opts")
                or spec.get("driver") not in (None, "", "local")):
            raise DeploymentError("Named volumes must be the reviewed local volumes without host-path options")
    for key, spec in (rendered.get("networks") or {}).items():
        spec = spec or {}
        if (spec.get("external") or spec.get("driver_opts") or spec.get("driver") not in (None, "", "bridge")
                or spec.get("name") in ("host", "none")):
            raise DeploymentError("Compose networks must be private bridge networks")


TENANT_SCOPE_SQL = "infra/tenant-scope.sql"
# The pre-hardening default: releases without infra/tenant-scope.sql call
# set_config after SET ROLE trainer_app (docs/features/isolation.md).
UNSCOPED_SET_CONFIG = "GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) TO PUBLIC;\n"


def scope_compatible(sha):
    """Whether a deployed release sets tenant scope before SET ROLE (it ships infra/tenant-scope.sql)."""
    return (ROOT / "releases" / valid_sha(sha) / TENANT_SCOPE_SQL).is_file()


def admin_sql(release, sha, sql):
    compose(release, sha, "exec", "-T", "database", "psql", "-q", "-v", "ON_ERROR_STOP=1",
            "-U", "trainer_migrations", "-d", "trainer", input=sql, text=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def runtime_role(release, sha, serving):
    """Grant the runtime role for `release` while `serving` (None on a first deployment) keeps serving.

    `serving` is also what a failed deployment restores, so the tenant-scope
    hardening (no set_config for trainer_app) is applied only when that release
    is scope-compatible too; while an older release serves, the pre-hardening
    grant is restored instead so that release keeps working.
    """
    # Rendered Compose config contains secrets: keep it in memory and never print it.
    result = compose(release, sha, "config", "--format", "json", capture_output=True, text=True)
    config = json.loads(result.stdout)
    validate_exposure(config, release)
    connection = urlparse(config["services"]["api"]["environment"]["DATABASE_URL"])
    if connection.username != "trainer_service" or connection.hostname != "database" or not connection.password:
        raise DeploymentError("Runtime must use the dedicated database role")
    password = unquote(connection.password)
    quoted = password.replace("'", "''")
    sql = """DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
        CREATE ROLE trainer_service LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
    END $$;
    """
    grants = (release / "infra/runtime-role.sql").read_text()
    grants = "\n".join(line for line in grants.splitlines() if not line.startswith("CREATE ROLE"))
    sql += grants + "\nALTER ROLE trainer_service WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '" + quoted + "';\n"
    # A controller older than tenant scoping never reaches this step; after an
    # operator rollback this controller can run while an older release serves.
    scope = release / TENANT_SCOPE_SQL
    if serving and not scope_compatible(serving):
        sql += UNSCOPED_SET_CONFIG
    elif scope.is_file():
        sql += scope.read_text()
    admin_sql(release, sha, sql)


BACKUPS_KEPT = 7
BUILD_CACHE_MAX_AGE = "168h"


def remove_entry(path):
    """Remove one controller-owned directory entry without following a link out of it."""
    if path.is_symlink() or not path.is_dir():
        path.unlink(missing_ok=True)
    else:
        shutil.rmtree(path)


def prune_backups(kept=BACKUPS_KEPT):
    """After a recorded deployment, keep only the newest complete local dumps.

    A failed or retried deployment never prunes, so the dump taken before its
    migration survives. This is a recovery aid, not off-host backup, and
    retention never fails a deployment that has already been recorded.
    """
    backups = ROOT / "backups"
    try:
        if not backups.is_dir():
            return
        dumps = sorted((p for p in backups.iterdir() if re.fullmatch(r"[0-9]+\.sql", p.name)
                        and p.is_file() and not p.is_symlink()), key=lambda p: int(p.stem), reverse=True)
        for old in dumps[kept:]:
            old.unlink(missing_ok=True)
    except OSError:
        print("Old backups could not all be removed; retrying after the next deployment", file=sys.stderr)


def prune_releases(keep):
    """After a recorded deployment, keep only the current and previous release trees and images.

    Retention never fails a deployment that has already been recorded: anything left
    behind is retried after the next successful deployment.
    """
    keep = {valid_sha(sha) for sha in keep if sha}
    releases = ROOT / "releases"
    try:
        for entry in sorted(releases.iterdir()) if releases.is_dir() else []:
            if entry.name in keep:
                continue
            if re.fullmatch(r"[0-9a-f]{40}", entry.name) or entry.name.startswith(".unpack-"):
                remove_entry(entry)
    except OSError:
        print("Old release trees could not all be removed; retrying after the next deployment", file=sys.stderr)
    listing = docker("image", "ls", "trainer-brain", "--format", "{{.Tag}}")
    for tag in sorted(set(listing.stdout.split())) if listing is not None and listing.returncode == 0 else []:
        if re.fullmatch(r"[0-9a-f]{40}", tag) and tag not in keep:
            # Never forced: an image still used by a container stays.
            docker("image", "rm", "trainer-brain:" + tag)
    docker("builder", "prune", "--force", "--filter", "until=" + BUILD_CACHE_MAX_AGE)


def deploy(sha, github):
    sha = valid_sha(sha)
    state_path = ROOT / "release-state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get("current"):
        valid_sha(state["current"])
    if state.get("current") == sha:
        return False
    # After an operator rollback the previous release serves while "current" keeps
    # naming the newest controller; a failed deployment restores what is serving.
    running = serving_release(state)
    releases = ROOT / "releases"
    releases.mkdir(exist_ok=True)
    release = releases / sha
    if not release.exists():
        req = urllib.request.Request(f"https://codeload.github.com/{REPOSITORY}/tar.gz/{sha}",
                                     headers={"User-Agent": "GymMembership-deployment"})
        with urllib.request.urlopen(req, timeout=60) as response:
            archive = response.read(128 * 1024 * 1024 + 1)
        if len(archive) > 128 * 1024 * 1024:
            raise DeploymentError("Compressed release exceeds limit")
        unpacked = releases / (".unpack-" + sha + "-" + secrets.token_hex(4))
        try:
            extract_release(archive, unpacked, sha)
            unpacked.rename(release)
        except BaseException:
            # A retry uses a new random name; never leave a partial tree behind.
            shutil.rmtree(unpacked, ignore_errors=True)
            raise
    rendered = compose(release, sha, "config", "--format", "json", capture_output=True, text=True)
    validate_exposure(json.loads(rendered.stdout), release)
    compose(release, sha, "build", "migrate")
    # A newer main commit may have arrived while this image built.
    if approved_head(github) != sha:
        print("A newer main commit is pending; no running services changed")
        return False
    compose(release, sha, "up", "-d", "--no-recreate", "--wait", "--wait-timeout", "120", "database")
    if state.get("current"):
        backups = ROOT / "backups"
        backups.mkdir(mode=0o700, exist_ok=True)
        backup = backups / (str(time.time_ns()) + ".sql")
        try:
            with open(backup, "xb", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
                compose(release, sha, "exec", "-T", "database", "pg_dump", "-U", "trainer_migrations", "trainer", stdout=stream)
        except BaseException:
            # A partial dump must never displace a complete one from retention.
            backup.unlink(missing_ok=True)
            raise
    # Failed migrations do not replace the currently running application.
    compose(release, sha, "run", "--rm", "--no-deps", "migrate")
    runtime_role(release, sha, running)
    endpoint = json.loads((ROOT / "endpoint.json").read_text())["url"]
    ask = edge_ask()

    def edge_release(revision):
        (ROOT / "Caddyfile").write_text(edge_config(endpoint, revision, ask))
    try:
        edge_release(sha)
        compose(release, sha, "up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "180",
                "api", "web", "worker", "edge")
        wait_ready("http://127.0.0.1:3000/api/v1/ready")
        wait_ready(endpoint + "/api/v1/ready", expected_sha=sha)
        wait_ready(endpoint + "/", attempts=10, expected_sha=sha)
    except Exception:
        previous = running
        if previous:
            edge_release(previous)
            compose(releases / previous, previous, "up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "180",
                    "api", "web", "worker", "edge")
            wait_ready("http://127.0.0.1:3000/api/v1/ready")
            wait_ready(endpoint + "/api/v1/ready", expected_sha=previous)
            print("Previous application restored; database migrations were not reversed")
        else:
            compose(release, sha, "stop", "api", "web", "worker", "edge")
        raise
    atomic_json(state_path, {"current": sha, "previous": running, "deployed_at": int(time.time())})
    print("Deployed checked main commit " + sha)
    # Retention only after the deployment is recorded (see prune_backups).
    prune_backups()
    prune_releases({sha, running})
    return True


def read_state():
    path = ROOT / "release-state.json"
    return json.loads(path.read_text()) if path.exists() else {}


def serving_release(state):
    """The release whose containers serve traffic: an operator rollback, else current."""
    sha = state.get("serving") or state.get("current")
    return valid_sha(sha) if sha else None


def endpoint_url():
    return json.loads((ROOT / "endpoint.json").read_text())["url"]


def start_release(sha, endpoint):
    """Recreate the application services of one recorded release and verify it."""
    sha = valid_sha(sha)
    (ROOT / "Caddyfile").write_text(edge_config(endpoint, sha, edge_ask()))
    compose(ROOT / "releases" / sha, sha, "up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "180",
            "api", "web", "worker", "edge")
    wait_ready("http://127.0.0.1:3000/api/v1/ready")
    wait_ready(endpoint + "/api/v1/ready", expected_sha=sha)


def switch_release(target):
    """Serve the latest or previous deployed release without touching the database.

    "current" keeps naming the newest release, so dispatch.py keeps running this
    controller (which honours a deploy pause) after a rollback.
    """
    state = read_state()
    current, running = valid_sha(state.get("current")), serving_release(state)
    target = valid_sha(target)
    if target not in (current, state.get("previous")):
        raise DeploymentError("Only the latest or previous deployed release can be served")
    if target == running:
        return False
    release = ROOT / "releases" / target
    if not release.is_dir():
        raise DeploymentError("That release is no longer on this server")
    rendered = compose(release, target, "config", "--format", "json", capture_output=True, text=True)
    validate_exposure(json.loads(rendered.stdout), release)
    endpoint = endpoint_url()
    if not scope_compatible(target):
        # A release older than tenant scoping calls set_config after SET ROLE:
        # restore the pre-hardening grant before it serves. The next deployment
        # from a scope-compatible serving release hardens the database again.
        admin_sql(release, target, UNSCOPED_SET_CONFIG)
    try:
        start_release(target, endpoint)
    except Exception:
        start_release(running, endpoint)
        print("The release that was serving has been restored")
        raise
    updated = {key: value for key, value in state.items() if key != "serving"}
    if target != current:
        updated["serving"] = target
    updated["switched_at"] = int(time.time())
    atomic_json(ROOT / "release-state.json", updated)
    return True


def reapply_release():
    """Recreate the serving release with the current runtime settings and edge address."""
    sha = serving_release(read_state())
    if not sha:
        raise DeploymentError("No release has been deployed on this server")
    start_release(sha, endpoint_url())
    return sha


DEPLOY_CONTROL = "deploy-control.json"


def deploy_control():
    path = ROOT / DEPLOY_CONTROL
    try:
        data = json.loads(path.read_text()) if path.exists() else {}
    except (OSError, ValueError):
        # An unreadable control file fails safe: automatic deployment stays paused.
        return {"paused": True, "reason": "unreadable"}
    return data if isinstance(data, dict) else {"paused": True, "reason": "unreadable"}


def set_deploy_pause(paused, reason, request_id=None):
    if reason not in ("operator", "rollback"):
        raise DeploymentError("Unknown pause reason")
    atomic_json(ROOT / DEPLOY_CONTROL, {"paused": bool(paused), "reason": reason, "changed_at": int(time.time()),
                                        "request_id": request_id})


ADMIN_REQUEST = "bootstrap-admin.json"
ADMIN_EXISTS = "A Superadmin already exists"


def bootstrap_pending_admin():
    """Create the first Superadmin once from a private request written at server creation.

    The password travels to the API container on stdin, never in arguments or logs, and
    the request is deleted once the administrator exists. Without the file this is a no-op.
    """
    path = ROOT / ADMIN_REQUEST
    if not path.exists():
        return
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o077:
        raise DeploymentError("The one-time administrator request must be a private regular file")
    state_path = ROOT / "release-state.json"
    if not state_path.exists():
        return
    sha = valid_sha(json.loads(state_path.read_text()).get("current"))
    request = json.loads(path.read_text())
    email, password = request.get("email"), request.get("password")
    name = request.get("name", "Platform administrator")
    if (not isinstance(email, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
            or not isinstance(password, str) or not 16 <= len(password) <= 128 or any(c in password for c in "\r\n")
            or not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9 .'-]{2,100}", name)):
        raise DeploymentError("Invalid one-time administrator request")
    script = ('umask 077; f="$(mktemp)"; cat > "$f"; BOOTSTRAP_ADMIN_PASSWORD_FILE="$f" '
              'npm run --silent admin:bootstrap; status=$?; rm -f "$f"; exit $status')
    try:
        compose(ROOT / "releases" / sha, sha, "exec", "-T", "-e", "BOOTSTRAP_ADMIN_EMAIL=" + email,
                "-e", "BOOTSTRAP_ADMIN_NAME=" + name, "api", "sh", "-c", script,
                input=password, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as error:
        if ADMIN_EXISTS not in (error.stderr or ""):
            raise DeploymentError("First Superadmin creation failed; the request is kept for the next cycle") from None
        print("A Superadmin already exists; the one-time request was discarded")
    else:
        print("First Superadmin created from the one-time request")
    path.unlink()


def main():
    if os.geteuid() != 0:
        raise DeploymentError("This controller runs only on its dedicated server")
    config = validate_config(json.loads((ROOT / "launch.json").read_text()))
    instance_id, hostname = metadata("id"), metadata("hostname")
    owner_path = ROOT / "owner.json"
    if "--bootstrap" in sys.argv and not owner_path.exists():
        if hostname != droplet_name(config) or not instance_id.isdigit():
            raise DeploymentError("Unexpected bootstrap host")
        atomic_json(owner_path, {"deployment_id": config["deployment_id"], "project_id": config["project_id"],
                                "droplet_id": int(instance_id), "repository": REPOSITORY})
    owner = json.loads(owner_path.read_text())
    assert_instance(config, owner, instance_id, hostname)
    os.umask(0o077)
    ensure_runtime()
    if "--bootstrap" in sys.argv:
        run(["systemctl", "enable", "--now", "docker"])
        service = """[Unit]
Description=Deploy checked GymMembership main commits
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/gymmembership/dispatch.py
TimeoutStartSec=""" + str(UNIT_TIMEOUT_SECONDS) + """
UMask=0077
"""
        timer = """[Unit]
Description=Check GymMembership Git updates every five minutes
[Timer]
OnBootSec=1min
OnUnitInactiveSec=5min
Unit=gymmembership-deploy.service
[Install]
WantedBy=timers.target
"""
        Path("/etc/systemd/system/gymmembership-deploy.service").write_text(service)
        Path("/etc/systemd/system/gymmembership-deploy.timer").write_text(timer)
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "enable", "--now", "gymmembership-deploy.timer"])
        return
    with open(ROOT / "deploy.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        run_cycle()


def operations_module():
    """Backups, host reports and operator actions (hostops.py beside this file).

    The bootstrap copy of this controller has no hostops.py; operations then wait
    until the first release's controller runs.
    """
    try:
        import hostops
    except ImportError:
        return None
    except Exception as error:
        # A broken operations module must never block deploying its fix.
        print("Host operations unavailable: " + type(error).__name__, file=sys.stderr)
        return None
    return hostops


# The deploy unit's TimeoutStartSec. systemd stops a cycle that runs longer, and
# Python finally blocks do not run then, so long operations budget against it.
UNIT_TIMEOUT_SECONDS = 1800
CYCLE_STARTED = None


def cycle_remaining():
    """Seconds left before systemd stops this timer cycle; None outside a cycle (console commands)."""
    if CYCLE_STARTED is None:
        return None
    return UNIT_TIMEOUT_SECONDS - (time.monotonic() - CYCLE_STARTED)


def run_cycle():
    """One serialized controller cycle: operator actions, deployment, then upkeep."""
    global CYCLE_STARTED
    CYCLE_STARTED = time.monotonic()
    operations = operations_module()
    this = sys.modules[__name__]
    # True only when a long action (a backup or a restore check) ran in this cycle.
    busy = operations.before_deploy(this) is True if operations else False
    deployed = False
    try:
        if deploy_control().get("paused"):
            print("Automatic deployment is paused by an operator")
        elif busy:
            print("A backup or restore check used this cycle; deployment waits for the next cycle")
        else:
            github = API("https://api.github.com")
            sha = approved_head(github)
            if sha:
                # Only a recorded deployment counts as having used the cycle. A failed
                # attempt is retried every cycle and must not hold back the backup.
                deployed = bool(deploy(sha, github))
                bootstrap_pending_admin()
            else:
                print("Waiting for current main application checks to succeed")
    finally:
        try:
            if operations:
                operations.after_deploy(this, deployed or busy)
        finally:
            CYCLE_STARTED = None


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Exception types are enough for external-service failures; never echo a request/header/env.
        print(str(error) if isinstance(error, DeploymentError) else "Deployment failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
