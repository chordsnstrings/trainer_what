"""Explicit host upgrade to one DNS-validated certificate for all coach subdomains.

Run from the qualified release on the dedicated host. Reads a DNS-only token
without echoing it. No application credentials or registrar settings are changed.
The regular controller and rollbacks keep using the reviewed edge image.
"""
import fcntl
import getpass
import json
import os
import subprocess
import tempfile
from pathlib import Path

import host
from common import DeploymentError, atomic_json

PLUGIN = "github.com/caddy-dns/digitalocean@v0.0.0-20250606074528-04bde2867106"
DOCKERFILE = Path(__file__).with_name("Dockerfile.edge").read_text()


def private_write(path, data):
    temporary = path.with_suffix(path.suffix + ".next")
    with open(temporary, "w", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def enable(token):
    # A newline would inject another environment setting.
    if len(token) < 20 or any(c.isspace() for c in token) or any(c in token for c in "'$\\\"#"):
        raise DeploymentError("Invalid DNS token format")
    values = host.runtime_values()
    root = host.edge_root(values)
    if not root or not host.edge_ask(values):
        raise DeploymentError("Configure a platform root and signed TLS allowlist first")
    state = host.read_state()
    sha = host.serving_release(state)
    if not sha:
        raise DeploymentError("A qualified release must be serving first")
    if host.edge_wildcard(values):
        raise DeploymentError("Wildcard TLS is already enabled; rotate its token through edge-dns.env")
    paths = [host.ROOT / name for name in ("runtime.env", "edge.json", "Caddyfile", "edge-dns.env")]
    previous = {p: p.read_bytes() if p.exists() else None for p in paths}
    with tempfile.TemporaryDirectory(prefix="wildcard-tls-") as directory:
        build = Path(directory)
        (build / "Dockerfile").write_text(DOCKERFILE)
        host.run(["docker", "build", "--tag", host.WILDCARD_EDGE_IMAGE, str(build)])
        config = host.edge_config(host.endpoint_url(), sha, host.edge_ask(values), root, host.edge_moved(), wildcard_tls=True)
        private_write(build / "Caddyfile", config)
        private_write(build / "dns.env", "DIGITALOCEAN_DNS_TOKEN=" + token + "\n")
        # Provider validation errors are not printed: some tools include config values.
        checked = subprocess.run(["docker", "run", "--rm", "--env-file", str(build / "dns.env"),
                                  "-v", str(build / "Caddyfile") + ":/etc/caddy/Caddyfile:ro",
                                  host.WILDCARD_EDGE_IMAGE, "caddy", "validate", "--config", "/etc/caddy/Caddyfile"],
                                 capture_output=True, timeout=60)
        if checked.returncode:
            raise DeploymentError("Wildcard edge configuration did not validate; serving configuration is unchanged")
        try:
            private_write(host.ROOT / "edge-dns.env", "DIGITALOCEAN_DNS_TOKEN=" + token + "\n")
            edge = json.loads((host.ROOT / "edge.json").read_text())
            edge["services"]["edge"]["image"] = host.WILDCARD_EDGE_IMAGE
            edge["services"]["edge"]["env_file"] = [str(host.ROOT / "edge-dns.env")]
            atomic_json(host.ROOT / "edge.json", edge)
            values["EDGE_WILDCARD_TLS"] = "true"
            private_write(host.ROOT / "runtime.env", "\n".join(k + "=" + v for k, v in values.items()) + "\n")
            host.reapply_release()
            # Unknown coach paths may return 421; the handshake still proves the
            # wildcard certificate, without allocating an individual certificate.
            import ssl
            import socket
            with socket.create_connection((root, 443), timeout=20) as connection:
                with ssl.create_default_context().wrap_socket(connection, server_hostname="certificate-check." + root) as secure:
                    names = [v for k, v in secure.getpeercert().get("subjectAltName", []) if k == "DNS"]
                    if "*." + root not in names:
                        raise DeploymentError("Wildcard certificate is not ready")
        except BaseException:
            for path, data in previous.items():
                if data is None:
                    path.unlink(missing_ok=True)
                else:
                    private_write(path, data.decode())
            host.reapply_release()
            raise DeploymentError("Wildcard TLS upgrade failed; prior edge configuration restored") from None


if __name__ == "__main__":
    if os.geteuid() != 0 or not (host.ROOT / "release-state.json").exists():
        raise SystemExit("Run on the dedicated deployment host as root")
    with open(host.ROOT / "deploy.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            enable(getpass.getpass("DigitalOcean DNS-only token: "))
        except DeploymentError as error:
            raise SystemExit(str(error)) from None
    print("Wildcard TLS enabled and verified")
