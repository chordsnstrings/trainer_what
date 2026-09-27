"""Print one signed controller report produced by the real hostops code.

Used by tests/infra-ops-contract.test.ts to prove that what the Python host
controller writes is what the API accepts. Synthetic values only; no Docker or
database is used (compose output and the database dump are simulated).
"""
import io
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import common  # noqa: E402
import host  # noqa: E402
import hostops  # noqa: E402

SHA, PREVIOUS = "a" * 40, "b" * 40


class Dump:
    def __init__(self):
        self.stdout = io.BytesIO(b"PGDMP" + b"\x00" * 4096)

    def wait(self, timeout=None):
        return 0

    def poll(self):
        return 0

    def kill(self):
        pass


def main(secret):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "runtime.env").write_text("SECURITY_ENCRYPTION_KEY=c3ludGhldGljLWNvbnRyYWN0LWtleQ==\n"
                                          "INTERNAL_PROXY_SECRET=" + secret + "\n")
        (root / "runtime.env").chmod(0o600)
        (root / "releases" / SHA).mkdir(parents=True)
        common.atomic_json(root / "endpoint.json", {"url": "https://gymmembership.1.1.1.1.sslip.io"})
        common.atomic_json(root / "release-state.json", {"current": SHA, "previous": PREVIOUS, "deployed_at": 1790000000})
        containers = "\n".join(json.dumps({"Service": s, "State": "running", "Health": "healthy" if s in ("api", "database") else "",
                                           "ExitCode": 0}) for s in ("database", "api", "web", "worker", "edge"))
        captured = []
        with patch.object(host, "ROOT", root), \
                patch.object(host, "compose", side_effect=lambda *a, **k: SimpleNamespace(stdout=containers)), \
                patch.object(hostops, "open_dump", side_effect=lambda h, sha: Dump()), \
                patch.object(hostops, "psql", side_effect=lambda h, sql, **k: captured.append(sql) or "t\n"), \
                patch("sys.stdout", io.StringIO()):
            values = host.runtime_values()
            hostops.backup_with_state(host, values, "scheduled")
            hostops.write_report(host, hostops.host_key(values), hostops.build_report(host, values))
        payload = json.loads((root / "host-status.json").read_text())
        text = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        signature = hostops.sign(hostops.host_key(values), "gymmembership-host-status-v1", "controller", text)
        assert signature in captured[-1]
        print(json.dumps({"payload": text, "signature": signature}))


if __name__ == "__main__":
    main(sys.argv[1])
