"""Create-only DigitalOcean setup, executed by this repository's GitHub Actions runner.

All resource IDs originate in successful create responses and are checkpointed on
a dedicated Git branch. Ambiguous create outcomes stop instead of duplicating resources.
"""
import base64
import hashlib
import ipaddress
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from common import API, REPOSITORY, DeploymentError, approved_head, atomic_json, droplet_name, validate_config, valid_sha

HERE = Path(__file__).resolve().parent
STATE_FILE = "infra/digitalocean/ownership.json"
CREATES = {"project": ("/v2/projects", "project"), "ssh_key": ("/v2/account/keys", "ssh_key"),
           "droplet": ("/v2/droplets", "droplet")}


def resource_id(kind, value):
    """Reject malformed checkpoint IDs before they can select a resource endpoint."""
    if kind == "project":
        try:
            if isinstance(value, str) and str(uuid.UUID(value)) == value:
                return value
        except ValueError:
            pass
    elif kind in CREATES and type(value) is int and value > 0:
        return value
    raise DeploymentError("Invalid owned " + str(kind) + " ID; reconcile the checkpoint before retrying")


def validate_resources(resources):
    if not isinstance(resources, dict) or not resources.keys() <= CREATES.keys():
        raise DeploymentError("Invalid ownership checkpoint resource list")
    for kind, value in resources.items():
        resource_id(kind, value)
    if ("ssh_key" in resources and "project" not in resources
            or "droplet" in resources and not {"project", "ssh_key"} <= resources.keys()):
        raise DeploymentError("Ownership checkpoint is missing prior create-response IDs")


class Checkpoint:
    def __init__(self, github, config, source_sha):
        self.github, self.config, self.source_sha = github, config, source_sha
        self.branch = "deployment/gymmembership-" + config["deployment_id"][:8]
        self.path = f"/repos/{REPOSITORY}/contents/{STATE_FILE}"
        self.digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
        self.content_sha = None
        self.local = Path(".deployment-result/ownership.json")
        self.local.parent.mkdir(parents=True, exist_ok=True)
        try:
            record = github.call("GET", self.path + "?ref=" + self.branch)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            # A pre-existing branch without our ownership record is not ours to overwrite.
            try:
                github.call("GET", f"/repos/{REPOSITORY}/git/ref/heads/{self.branch}")
            except urllib.error.HTTPError as ref_error:
                if ref_error.code != 404:
                    raise
            else:
                raise DeploymentError("Ownership branch exists without a valid checkpoint; reconcile it first")
            github.call("POST", f"/repos/{REPOSITORY}/git/refs", {"ref": "refs/heads/" + self.branch, "sha": source_sha})
            self.data = {"schema": 1, "deployment_id": config["deployment_id"], "project_name": "GymMembership",
                         "repository": REPOSITORY, "config_digest": self.digest, "resources": {}, "pending": None}
            self.save()
        else:
            self.content_sha = record["sha"]
            self.data = json.loads(base64.b64decode(record["content"]))
            if (not isinstance(self.data, dict) or self.data.get("schema") != 1
                    or self.data.get("deployment_id") != config["deployment_id"] or self.data.get("config_digest") != self.digest
                    or self.data.get("repository") != REPOSITORY or self.data.get("project_name") != "GymMembership"):
                raise DeploymentError("Ownership checkpoint does not match this deployment")
            validate_resources(self.data.get("resources"))
            atomic_json(self.local, self.data)
        if self.data.get("pending"):
            raise DeploymentError("Previous create outcome is unknown; reconcile the checkpoint before retrying")

    def save(self):
        atomic_json(self.local, self.data)
        payload = {"message": "GymMembership: checkpoint owned deployment resources", "branch": self.branch,
                   "content": base64.b64encode((json.dumps(self.data, indent=2) + "\n").encode()).decode()}
        if self.content_sha:
            payload["sha"] = self.content_sha
        result = self.github.call("PUT", self.path, payload)
        self.content_sha = valid_sha(result["content"]["sha"])

    def create(self, kind, api, path, payload, response_key):
        if CREATES.get(kind) != (path, response_key):
            raise DeploymentError("Create operation is outside this deployment's resource scope")
        if self.data.get("pending"):
            raise DeploymentError("Unreconciled operation prevents another create")
        if kind in self.data["resources"]:
            return resource_id(kind, self.data["resources"][kind])
        self.data["pending"] = {"operation": kind, "path": path, "started_at": int(time.time())}
        self.save()  # This succeeds before the billable/external create is attempted.
        try:
            result = api.call("POST", path, payload)[response_key]
        except urllib.error.HTTPError as error:
            if error.code in (400, 401, 403, 404, 409, 422):
                self.data["pending"] = None
                self.data["last_error"] = {"operation": kind, "http_status": error.code}
                self.save()
            raise
        identifier = resource_id(kind, result.get("id"))
        self.data["resources"][kind] = identifier
        self.data["pending"] = None
        self.data.pop("last_error", None)
        self.save()
        print("Created " + kind + " " + str(identifier))
        return identifier


def collect(api, path, key):
    items = []
    for page in range(1, 101):
        result = api.call("GET", path + f"?per_page=200&page={page}")
        items.extend(result[key])
        if not result.get("links", {}).get("pages", {}).get("next"):
            return items
    raise DeploymentError("Listing exceeded safe pagination limit")


def validate_available(config, sizes, regions):
    size = next((s for s in sizes if s["slug"] == config["size"]), None)
    region = next((r for r in regions if r["slug"] == config["region"]), None)
    monthly = size.get("price_monthly") if size else None
    if (not size or not size.get("available") or type(monthly) not in (int, float)
            or not math.isfinite(monthly) or not 0 < monthly <= config["max_compute_usd_month"]
            or config["region"] not in size["regions"] or not region or not region.get("available")
            or config["size"] not in region["sizes"]):
        raise DeploymentError("Selected server is unavailable or exceeds the USD 24 compute limit")
    return {"region": config["region"], "size": config["size"], "usd_month": size["price_monthly"],
            "usd_hour": size["price_hourly"], "quoted_at": int(time.time())}


def cloud_config(config, project_id, source_sha):
    settings = {**config, "project_id": project_id, "bootstrap_source_sha": source_sha}
    files = [{"path": "/opt/gymmembership/" + name, "owner": "root:root", "permissions": "0700", "encoding": "b64",
              "content": base64.b64encode((HERE / name).read_bytes()).decode()}
             for name in ("common.py", "host.py", "dispatch.py")]
    files.append({"path": "/opt/gymmembership/launch.json", "owner": "root:root", "permissions": "0600",
                  "content": json.dumps(settings)})
    data = {"package_update": True, "packages": ["docker.io", "docker-compose-v2", "ca-certificates"],
            "ssh_pwauth": False, "disable_root": False, "write_files": files,
            "runcmd": [["python3", "/opt/gymmembership/host.py", "--bootstrap"]]}
    result = "#cloud-config\n" + json.dumps(data)
    if len(result.encode()) > 64 * 1024:
        raise DeploymentError("Bootstrap exceeds the deployment's 64 KiB user-data limit")
    return result


def assignment_payload(state):
    resources = state["resources"]
    resource_id("project", resources.get("project"))
    droplet_id = resource_id("droplet", resources.get("droplet"))
    return {"resources": ["do:droplet:" + str(droplet_id)]}


def provision(config, state, do, source_sha):
    resources = state.data["resources"]
    validate_resources(resources)
    if "project" not in resources:
        if any(p["name"].casefold() == "GymMembership".casefold() for p in collect(do, "/v2/projects", "projects")):
            raise DeploymentError("GymMembership already exists outside this deployment; it will not be reused")
    project_id = state.create("project", do, "/v2/projects", {
        "name": "GymMembership", "purpose": "Web Application", "environment": "Development",
        "description": "New Trainer Brain deployment from chordsnstrings/trainer_what; " + config["deployment_id"],
    }, "project")
    project = do.call("GET", "/v2/projects/" + str(project_id))["project"]
    if project.get("id") != project_id or project["name"] != "GymMembership" or project.get("is_default"):
        raise DeploymentError("Owned project identity changed; no account defaults will be modified")
    key_id = state.create("ssh_key", do, "/v2/account/keys", {
        "name": droplet_name(config), "public_key": config["ssh_public_key"],
    }, "ssh_key")
    key = do.call("GET", "/v2/account/keys/" + str(key_id))["ssh_key"]
    if key.get("id") != key_id or key["public_key"].split()[:2] != config["ssh_public_key"].split()[:2]:
        raise DeploymentError("Owned SSH key no longer matches")
    droplet_id = state.create("droplet", do, "/v2/droplets", {
        "name": droplet_name(config), "region": config["region"], "size": config["size"],
        "image": config["image"], "ssh_keys": [key_id], "backups": False, "ipv6": False,
        "monitoring": True,
        "user_data": cloud_config(config, project_id, source_sha),
        # Dedicated VPC and cloud firewall are expressly deferred by the owner.
    }, "droplet")
    for _ in range(40):
        droplet = do.call("GET", "/v2/droplets/" + str(droplet_id))["droplet"]
        if (droplet.get("id") != droplet_id or droplet["name"] != droplet_name(config)
                or droplet["region"]["slug"] != config["region"] or droplet.get("size_slug") != config["size"]):
            raise DeploymentError("Owned Droplet identity changed")
        addresses = [n["ip_address"] for n in droplet["networks"]["v4"] if n["type"] == "public"]
        if droplet["status"] == "active" and addresses:
            break
        time.sleep(15)
    else:
        raise DeploymentError("Owned server still provisioning; rerun to resume it without creating another")
    ip = str(ipaddress.IPv4Address(addresses[0]))
    if not ipaddress.ip_address(ip).is_global:
        raise DeploymentError("Expected a public server address")
    path = "/v2/projects/" + str(project_id) + "/resources"
    expected = assignment_payload(state.data)
    current = collect(do, path, "resources")
    if expected["resources"][0] not in [r["urn"] for r in current]:
        # Only the new manifest-owned Droplet is assigned to the new manifest-owned project.
        do.call("POST", path, expected)
    if expected["resources"][0] not in [r["urn"] for r in collect(do, path, "resources")]:
        raise DeploymentError("Project assignment not confirmed")
    state.data.update({"ip": ip, "url": "https://gymmembership." + ip + ".sslip.io",
                       "project_url": "https://cloud.digitalocean.com/projects/" + str(project_id) + "/resources",
                       "project_assignment_verified": True, "phase": "server_created"})
    state.save()


def main():
    if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY or os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise DeploymentError("Provisioning runs only from this repository's main branch")
    config = validate_config(json.loads((HERE / "launch.json").read_text()))
    source_sha = valid_sha(os.environ["GITHUB_SHA"])
    if not os.environ.get("DO_PROVISION_TOKEN") or not os.environ.get("GH_TOKEN"):
        raise DeploymentError("Configure DO_PROVISION_TOKEN as a GitHub Actions secret first")
    github, do = API("https://api.github.com", os.environ["GH_TOKEN"]), API("https://api.digitalocean.com", os.environ["DO_PROVISION_TOKEN"])
    for _ in range(60):
        if approved_head(github) == source_sha:
            break
        if github.call("GET", f"/repos/{REPOSITORY}/commits/main")["sha"] != source_sha:
            raise DeploymentError("Main changed; run setup from the latest main commit")
        time.sleep(15)
    else:
        raise DeploymentError("Application checks did not pass; no new infrastructure was created")
    if do.call("GET", "/v2/account")["account"]["status"] != "active":
        raise DeploymentError("DigitalOcean account is not active")
    state = Checkpoint(github, config, source_sha)
    # A retry verifies an already-owned server even if its size is no longer sold.
    # Only a new billable create needs a fresh availability and budget check.
    if "droplet" not in state.data["resources"]:
        quote = validate_available(config, collect(do, "/v2/sizes", "sizes"), collect(do, "/v2/regions", "regions"))
        image = do.call("GET", "/v2/images/" + config["image"])["image"]
        if config["region"] not in image["regions"]:
            raise DeploymentError("Ubuntu image is unavailable in the selected region")
        state.data["compute_quote"] = quote
        state.save()
    provision(config, state, do, source_sha)
    print("Owned GymMembership server: " + state.data["url"])
    # Use a credential-free request for the new public endpoint; never forward either API token.
    for _ in range(80):
        try:
            with urllib.request.urlopen(state.data["url"] + "/api/v1/ready", timeout=10) as response:
                sha = response.headers.get("X-GymMembership-Release", "")
                ready = json.loads(response.read(4096)).get("status") == "ready"
                if response.status == 200 and ready and sha == approved_head(github):
                    state.data.update({"phase": "https_ready", "verified_release": sha, "verified_at": int(time.time())})
                    state.save()
                    print("HTTPS and checked Git release verified: " + sha)
                    return
        except (OSError, ValueError, AttributeError):
            pass
        time.sleep(15)
    raise DeploymentError("New server exists, but HTTPS readiness is not yet verified; inspect its cloud-init/deploy logs")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if isinstance(error, urllib.error.HTTPError):
            message = "Setup API request failed with HTTP " + str(error.code) + "; check the token scopes and ownership checkpoint"
        else:
            message = str(error) if isinstance(error, DeploymentError) else "Setup failed: " + type(error).__name__
        print(message, file=sys.stderr)
        sys.exit(1)
