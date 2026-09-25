"""Dedicated GymMembership host bootstrap and checked-main deployment controller."""
import base64
import fcntl
import ipaddress
import json
import os
import secrets
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


def compose(release, sha, *args, **kwargs):
    command = ["docker", "compose", "--project-name", "gymmembership",
               "--env-file", str(ROOT / "runtime.env"), "-f", str(release / "compose.yaml"),
               "-f", str(ROOT / "edge.json"), *args]
    return run(command, cwd=release, env={**os.environ, "RELEASE_TAG": valid_sha(sha)}, **kwargs)


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
                                         "DATABASE_URL", "SECURITY_ENCRYPTION_KEY")):
            raise DeploymentError("Runtime configuration is incomplete; recover it without changing database credentials")
    else:
        admin_password, runtime_password = secrets.token_urlsafe(36), secrets.token_urlsafe(36)
        values = {
            "POSTGRES_PASSWORD": admin_password,
            "MIGRATION_DATABASE_URL": f"postgres://trainer_migrations:{admin_password}@database:5432/trainer",
            "DATABASE_URL": f"postgres://trainer_service:{runtime_password}@database:5432/trainer",
            "SECURITY_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
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
    endpoint = values["PUBLIC_APP_URL"]
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.path or parsed.query or parsed.fragment
            or any(c.isspace() for c in endpoint) or any(c in endpoint for c in "{}")):
        raise DeploymentError("Expected a public HTTPS origin")
    # Recover interruption after writing runtime.env without rotating database secrets.
    if not (ROOT / "Caddyfile").exists():
        (ROOT / "Caddyfile").write_text(endpoint + " {\n    encode zstd gzip\n    reverse_proxy web:3000\n}\n")
    if not (ROOT / "edge.json").exists():
        atomic_json(ROOT / "edge.json", {
            "services": {"edge": {
                "image": "caddy:2.11.4-alpine", "restart": "unless-stopped",
                "ports": ["80:80", "443:443"],
                "volumes": [str(ROOT / "Caddyfile") + ":/etc/caddy/Caddyfile:ro", "caddy_data:/data", "caddy_config:/config"],
            }}, "volumes": {"caddy_data": {}, "caddy_config": {}},
        })
    atomic_json(ROOT / "endpoint.json", {"url": endpoint, "ip": ip})


def validate_exposure(rendered):
    services = rendered["services"]
    if any(service.get("network_mode") == "host" for service in services.values()):
        raise DeploymentError("Host networking would bypass the published-port boundary")
    if services["database"].get("ports") or services["api"].get("ports") or services["worker"].get("ports"):
        raise DeploymentError("Database, API and worker must not publish host ports")
    ports = services["web"].get("ports", [])
    if not ports or any(p.get("host_ip") != "127.0.0.1" for p in ports):
        raise DeploymentError("The web port must bind to localhost behind HTTPS")
    if services["database"]["image"] != "postgres:17.6-alpine":
        raise DeploymentError("Database image changes require an explicit upgrade procedure")


def runtime_role(release, sha):
    # Rendered Compose config contains secrets: keep it in memory and never print it.
    result = compose(release, sha, "config", "--format", "json", capture_output=True, text=True)
    config = json.loads(result.stdout)
    validate_exposure(config)
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
    compose(release, sha, "exec", "-T", "database", "psql", "-q", "-v", "ON_ERROR_STOP=1",
            "-U", "trainer_migrations", "-d", "trainer", input=sql, text=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def deploy(sha, github):
    sha = valid_sha(sha)
    state_path = ROOT / "release-state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get("current"):
        valid_sha(state["current"])
    if state.get("current") == sha:
        return
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
        extract_release(archive, unpacked, sha)
        unpacked.rename(release)
    rendered = compose(release, sha, "config", "--format", "json", capture_output=True, text=True)
    validate_exposure(json.loads(rendered.stdout))
    compose(release, sha, "build", "migrate")
    # A newer main commit may have arrived while this image built.
    if approved_head(github) != sha:
        print("A newer main commit is pending; no running services changed")
        return
    compose(release, sha, "up", "-d", "--no-recreate", "--wait", "--wait-timeout", "120", "database")
    if state.get("current"):
        backups = ROOT / "backups"
        backups.mkdir(mode=0o700, exist_ok=True)
        backup = backups / (str(time.time_ns()) + ".sql")
        with open(backup, "xb", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
            compose(release, sha, "exec", "-T", "database", "pg_dump", "-U", "trainer_migrations", "trainer", stdout=stream)
    # Failed migrations do not replace the currently running application.
    compose(release, sha, "run", "--rm", "--no-deps", "migrate")
    runtime_role(release, sha)
    endpoint = json.loads((ROOT / "endpoint.json").read_text())["url"]
    def edge_release(revision):
        (ROOT / "Caddyfile").write_text(endpoint + " {\n    encode zstd gzip\n    header X-GymMembership-Release "
                                       + valid_sha(revision) + "\n    reverse_proxy web:3000\n}\n")
    try:
        edge_release(sha)
        compose(release, sha, "up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "180",
                "api", "web", "worker", "edge")
        wait_ready("http://127.0.0.1:3000/api/v1/ready")
        wait_ready(endpoint + "/api/v1/ready", expected_sha=sha)
        wait_ready(endpoint + "/", attempts=10, expected_sha=sha)
    except Exception:
        previous = state.get("current")
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
    atomic_json(state_path, {"current": sha, "previous": state.get("current"), "deployed_at": int(time.time())})
    print("Deployed checked main commit " + sha)


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
TimeoutStartSec=1800
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
        github = API("https://api.github.com")
        sha = approved_head(github)
        if sha:
            deploy(sha, github)
        else:
            print("Waiting for current main application checks to succeed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Exception types are enough for external-service failures; never echo a request/header/env.
        print(str(error) if isinstance(error, DeploymentError) else "Deployment failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
