"""Use the controller included in the last successfully deployed, CI-checked release."""
import json
import os
from pathlib import Path

from common import DeploymentError, valid_sha


def controller(root):
    state = root / "release-state.json"
    if not state.exists():
        return root / "host.py"
    sha = valid_sha(json.loads(state.read_text()).get("current"))
    candidate = root / "releases" / sha / "infra/digitalocean/host.py"
    if candidate.resolve() != candidate:
        raise DeploymentError("Release controller cannot be a link outside its release")
    if candidate.is_file():
        return candidate
    raise DeploymentError("The deployed release controller is missing")


if __name__ == "__main__":
    script = controller(Path("/opt/gymmembership"))
    os.execv("/usr/bin/python3", ["python3", str(script)])
