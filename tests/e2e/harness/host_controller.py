"""Runs one cycle of the real host controller (infra/digitalocean/hostops.py)
against the end-to-end sandbox. Test tooling only.

Only the host primitives are simulated: ``docker compose exec database ...``
becomes the local PostgreSQL client tools against the throwaway cluster (as the
migration administrator, like the controller), container status is a fixed
healthy list, and deploy state lives in a temporary directory. Verification of
signed requests, execution of allowlisted actions, encrypted backups, the
off-server copy, the restore check into a scratch database and the signed host
report are the controller's own code.

Input (environment): E2E_HOST_ROOT, E2E_MIGRATION_URL, E2E_PG_BIN, E2E_REPO,
E2E_PUBLIC_URL, INTERNAL_PROXY_SECRET, SECURITY_ENCRYPTION_KEY and optional
BACKUP_S3_* values. Output: one JSON line (no secrets, no row content).
"""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, unquote

REPO = Path(os.environ["E2E_REPO"])
sys.path.insert(0, str(REPO / "infra" / "digitalocean"))
import hostops  # noqa: E402

SHA = "e2e0" + "0" * 36
PREVIOUS = "e2e1" + "1" * 36


class Completed:
    def __init__(self, stdout):
        self.stdout = stdout
        self.returncode = 0


class SandboxHost:
    """The subset of host.py that hostops.py calls, backed by local tools."""

    def __init__(self):
        self.ROOT = Path(os.environ["E2E_HOST_ROOT"])
        self.ROOT.mkdir(parents=True, exist_ok=True)
        url = urlsplit(os.environ["E2E_MIGRATION_URL"])
        self.pg = {"host": url.hostname, "port": str(url.port), "user": unquote(url.username or ""),
                   "password": unquote(url.password or "")}
        self.bin = Path(os.environ["E2E_PG_BIN"])
        # The restore check compares restored migrations with the release's migration files.
        for sha in (SHA, PREVIOUS):
            release = self.ROOT / "releases" / sha / "packages" / "db"
            release.mkdir(parents=True, exist_ok=True)
            link = release / "migrations"
            if not link.exists():
                link.symlink_to(REPO / "packages" / "db" / "migrations")
        self.control_file = self.ROOT / "deploy-control.json"

    # ---- state -------------------------------------------------------------
    def read_state(self):
        return {"current": SHA, "previous": PREVIOUS, "serving": SHA, "deployed_at": 1790000000}

    def serving_release(self, state):
        return state.get("serving") or state.get("current")

    def deploy_control(self):
        try:
            return json.loads(self.control_file.read_text())
        except (OSError, ValueError):
            return {"paused": False}

    def set_deploy_pause(self, paused, reason, request_id):
        import time
        self.control_file.write_text(json.dumps({"paused": paused, "reason": reason, "request": request_id,
                                                 "changed_at": int(time.time())}))

    def endpoint_url(self):
        return os.environ["E2E_PUBLIC_URL"]

    def edge_ask(self, values):
        return ""

    def edge_config(self, endpoint, sha, ask):
        return ""

    def cycle_remaining(self):
        return None

    def runtime_values(self):
        return values()

    def engine_environment(self):
        env = dict(os.environ)
        env["PGPASSWORD"] = self.pg["password"]
        return env

    # ---- docker compose stand-ins ------------------------------------------
    def _database_command(self, args):
        """exec -T database <tool> [...] -U trainer_migrations ... → local tool against the cluster."""
        if list(args[:3]) != ["exec", "-T", "database"]:
            raise hostops.DeploymentError("sandbox host: unsupported compose command " + str(args[:1]))
        tool, rest = args[3], list(args[4:])
        if tool not in ("psql", "pg_dump", "pg_restore"):
            raise hostops.DeploymentError("sandbox host: unsupported database tool")
        cleaned = []
        skip = False
        for index, value in enumerate(rest):
            if skip:
                skip = False
                continue
            if value == "-U":
                skip = True
                continue
            cleaned.append(value)
        connection = ["-h", self.pg["host"], "-p", self.pg["port"], "-U", self.pg["user"]]
        return [str(self.bin / tool), *connection, *cleaned]

    def compose_command(self, release, sha, *args):
        return self._database_command(args), self.engine_environment()

    def compose(self, release, sha, *args, **kwargs):
        if args and args[0] == "ps":
            services = ["database", "api", "web", "worker", "edge"]
            lines = [json.dumps({"Service": s, "State": "running", "Health": "healthy" if s != "edge" else "",
                                 "ExitCode": 0}) for s in services]
            return Completed("\n".join(lines))
        if args and args[0] == "exec":
            command = self._database_command(args)
            result = subprocess.run(command, env=self.engine_environment(), input=kwargs.get("input"),
                                    text=kwargs.get("text", True), capture_output=True,
                                    timeout=kwargs.get("timeout", 300))
            if result.returncode != 0:
                raise hostops.DeploymentError("sandbox host: database command failed")
            return Completed(result.stdout)
        raise hostops.DeploymentError("sandbox host: " + str(args[:1]) + " is not simulated")

    def wait_ready(self, *args, **kwargs):
        return True


def values():
    keys = ["INTERNAL_PROXY_SECRET", "SECURITY_ENCRYPTION_KEY", "SECURITY_ENCRYPTION_PREVIOUS_KEYS",
            "BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_REGION", "BACKUP_S3_ACCESS_KEY_ID",
            "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_S3_PREFIX", "BACKUP_INTERVAL_HOURS", "BACKUP_KEEP"]
    return {key: os.environ[key] for key in keys if os.environ.get(key)}


def main():
    host = SandboxHost()
    settings = values()
    key = hostops.host_key(settings)
    handled = hostops.process_actions(host, settings, key)
    report = hostops.build_report(host, settings)
    written = hostops.write_report(host, key, report)
    backups = report.get("backups") or {}
    print(json.dumps({
        "handled": [{"id": row_id, "status": status} for row_id, status in handled],
        "reportWritten": bool(written),
        "backups": {"count": backups.get("count"), "latest": (backups.get("latest") or {}).get("location"),
                    "offsite": ((backups.get("latest") or {}).get("offsite") or {}).get("status"),
                    "lastVerification": backups.get("lastVerification")},
        "deployPaused": report.get("deploy", {}).get("paused"),
    }))


if __name__ == "__main__":
    main()
