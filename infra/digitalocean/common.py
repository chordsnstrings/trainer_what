"""Small, dependency-free deployment primitives. Never log credentials."""
import io
import json
import os
import re
import tarfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path, PurePosixPath

REPOSITORY = "chordsnstrings/trainer_what"


class DeploymentError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DeploymentError("API redirect refused; credentials were not forwarded")


class API:
    def __init__(self, origin, token=None):
        if origin not in ("https://api.digitalocean.com", "https://api.github.com"):
            raise DeploymentError("Unapproved API origin")
        self.origin, self.token = origin, token

    def call(self, method, path, payload=None):
        if not path.startswith("/") or path.startswith("//"):
            raise DeploymentError("Invalid API path")
        headers = {"Accept": "application/json", "User-Agent": "GymMembership-deployment"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        if self.origin == "https://api.github.com":
            headers["X-GitHub-Api-Version"] = "2022-11-28"
        data = None if payload is None else json.dumps(payload).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.origin + path, data=data, headers=headers, method=method)
        # No automatic mutation retry, even on 429/5xx/timeouts.
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=45) as response:
            return json.load(response)


def valid_sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise DeploymentError("Invalid source commit")
    return value


def validate_config(config):
    if config.get("project_name") != "GymMembership" or config.get("repository") != REPOSITORY:
        raise DeploymentError("Wrong project or repository")
    if str(uuid.UUID(config["deployment_id"])) != config["deployment_id"]:
        raise DeploymentError("Invalid deployment ID")
    if config.get("region") != "blr1" or config.get("size") != "s-2vcpu-4gb":
        raise DeploymentError("Unexpected initial server specification")
    if config.get("image") != "ubuntu-24-04-x64" or config.get("max_compute_usd_month") != 24:
        raise DeploymentError("Unexpected image or compute budget")
    if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?", config.get("ssh_public_key", "")):
        raise DeploymentError("Expected a new Ed25519 public key")
    return config


def droplet_name(config):
    return "gymmembership-" + config["deployment_id"].replace("-", "")[:12]


def atomic_json(path, data):
    path = Path(path)
    temp = path.with_name(path.name + ".next")
    with open(temp, "w", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def approved_head(github):
    """Deploy only a successful push run of check.yml for the current main SHA."""
    sha = valid_sha(github.call("GET", f"/repos/{REPOSITORY}/commits/main")["sha"])
    runs = github.call("GET", f"/repos/{REPOSITORY}/actions/workflows/check.yml/runs"
                       f"?branch=main&event=push&head_sha={sha}&per_page=10")["workflow_runs"]
    matching = [r for r in runs if r.get("head_sha") == sha and r.get("head_branch") == "main"
                and r.get("event") == "push" and r.get("head_repository", {}).get("full_name") == REPOSITORY]
    latest = max(matching, key=lambda r: (r.get("run_number", 0), r.get("run_attempt", 1)), default=None)
    if not latest or latest.get("status") != "completed" or latest.get("conclusion") != "success":
        return None
    return sha


def extract_release(archive, destination, sha):
    """Reject traversal, links, devices and oversized GitHub archives before extracting."""
    sha = valid_sha(sha)
    root = "trainer_what-" + sha
    destination = Path(destination)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        members = tar.getmembers()
        if len(members) > 20000 or sum(m.size for m in members) > 512 * 1024 * 1024:
            raise DeploymentError("Release archive exceeds limits")
        validated = []
        seen = set()
        files = set()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != root:
                raise DeploymentError("Unsafe archive path")
            if not (member.isdir() or member.isfile()):
                raise DeploymentError("Archive links and special files are forbidden")
            relative = Path(*path.parts[1:])
            if relative == Path("."):
                if not member.isdir():
                    raise DeploymentError("Invalid archive root")
                continue
            if relative in seen or relative.parts[0] in (".git", ".env", ".data"):
                raise DeploymentError("Duplicate or private archive entry")
            if any(part.startswith(".env.") and part != ".env.example" for part in relative.parts):
                raise DeploymentError("Private environment files are forbidden")
            seen.add(relative)
            if member.isfile():
                files.add(relative)
            validated.append((member, relative))
        if any(parent in files for relative in seen for parent in relative.parents):
            raise DeploymentError("Archive file conflicts with a directory")
        destination.mkdir(mode=0o755, parents=True, exist_ok=False)
        for member, relative in validated:
            target = destination / relative
            if member.isdir():
                target.mkdir(mode=0o755, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                with tar.extractfile(member) as source, open(target, "xb") as output:
                    output.write(source.read())
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
