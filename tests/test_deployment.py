import copy
import io
import json
import sys
import tarfile
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import common
import host
import provision

SHA = "a" * 40
OTHER = "b" * 40
CONFIG = json.loads((provision.HERE / "launch.json").read_text())
PROJECT_ID = "ef0f9c84-bfea-4c29-bd41-b61c6e91f2a2"


class Runs:
    def __init__(self, runs):
        self.runs = runs

    def call(self, method, path):
        return {"sha": SHA} if "/commits/main" in path else {"workflow_runs": self.runs}


def passed(**changes):
    return {"head_sha": SHA, "head_branch": "main", "event": "push", "status": "completed",
            "conclusion": "success", "run_number": 10, "run_attempt": 1,
            "head_repository": {"full_name": common.REPOSITORY}, **changes}


def archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for name, kind in entries:
            item = tarfile.TarInfo(name)
            if kind == "symlink":
                item.type, item.linkname = tarfile.SYMTYPE, "/etc/passwd"
                tar.addfile(item)
            else:
                value = b"test content"
                item.size = len(value)
                tar.addfile(item, io.BytesIO(value))
    return output.getvalue()


def checkpoint():
    state = object.__new__(provision.Checkpoint)
    state.data = {"resources": {}, "pending": None}
    state.records = []
    state.save = lambda: state.records.append(copy.deepcopy(state.data))
    return state


class FakeDO:
    def __init__(self, existing=False):
        self.calls, self.assigned, self.existing = [], False, existing

    def call(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path.startswith("/v2/projects?"):
            return {"projects": [{"name": "GymMembership"}] if self.existing else []}
        if path == "/v2/projects" and method == "POST":
            return {"project": {"id": PROJECT_ID}}
        if path == "/v2/projects/" + PROJECT_ID:
            return {"project": {"id": PROJECT_ID, "name": "GymMembership", "is_default": False}}
        if path == "/v2/account/keys" and method == "POST":
            return {"ssh_key": {"id": 123}}
        if path == "/v2/account/keys/123":
            return {"ssh_key": {"id": 123, "public_key": CONFIG["ssh_public_key"]}}
        if path == "/v2/droplets" and method == "POST":
            return {"droplet": {"id": 456}}
        if path == "/v2/droplets/456":
            return {"droplet": {"id": 456, "size_slug": CONFIG["size"], "name": common.droplet_name(CONFIG),
                                "status": "active", "region": {"slug": "blr1"},
                                "networks": {"v4": [{"type": "public", "ip_address": "1.1.1.1"}]}}}
        if path.startswith("/v2/projects/" + PROJECT_ID + "/resources"):
            if method == "POST":
                self.assigned = True
            return {"resources": [{"urn": "do:droplet:456"}] if self.assigned else []}
        raise AssertionError("Unexpected API operation " + method + " " + path)


class FakeGitHub:
    """A persistent branch/content store shared across independent setup attempts."""
    def __init__(self):
        self.calls, self.record, self.branch, self.version = [], None, None, 0

    def call(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET":
            if "/contents/" in path and self.record:
                return copy.deepcopy(self.record)
            if "/git/ref/heads/" in path and self.branch:
                return {"ref": self.branch}
            raise urllib.error.HTTPError("https://api.github.com" + path, 404, "not found", {}, None)
        if method == "POST" and path.endswith("/git/refs"):
            self.branch = payload["ref"]
            return {"ref": self.branch}
        if method == "PUT" and "/contents/" in path:
            if self.record and payload.get("sha") != self.record["sha"]:
                raise AssertionError("Checkpoint write omitted the previous content SHA")
            self.version += 1
            self.record = {"content": payload["content"], "sha": format(self.version, "040x")}
            return {"content": {"sha": self.record["sha"]}}
        raise AssertionError("Unexpected GitHub operation " + method + " " + path)


class DeploymentBoundaries(unittest.TestCase):
    def test_only_current_checked_main_is_accepted(self):
        self.assertEqual(common.approved_head(Runs([passed()])), SHA)
        for changed in ({"head_sha": OTHER}, {"event": "pull_request"}, {"head_branch": "feature"},
                        {"head_repository": {"full_name": "someone/fork"}}, {"conclusion": "failure"},
                        {"status": "in_progress"}):
            with self.subTest(changed=changed):
                self.assertIsNone(common.approved_head(Runs([passed(**changed)])))

    def test_newer_rerun_failure_overrides_old_success(self):
        self.assertIsNone(common.approved_head(Runs([passed(), passed(run_attempt=2, conclusion="failure")])))
        self.assertIsNone(common.approved_head(Runs([])))

    def test_release_extracts_exact_commit_and_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "release"
            common.extract_release(archive([("trainer_what-" + SHA + "/app.py", "file")]), destination, SHA)
            self.assertEqual((destination / "app.py").read_text(), "test content")
        for name, kind in [("trainer_what-" + SHA + "/../../escape", "file"), ("/etc/passwd", "file"),
                           ("trainer_what-" + SHA + "/link", "symlink"), ("trainer_what-" + OTHER + "/app", "file"),
                           ("trainer_what-" + SHA + "/.env", "file")]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                destination = Path(folder) / "release"
                with self.assertRaises(common.DeploymentError):
                    common.extract_release(archive([(name, kind)]), destination, SHA)
                self.assertFalse(destination.exists())

    def test_duplicate_archive_entries_do_not_write(self):
        with tempfile.TemporaryDirectory() as folder:
            name = "trainer_what-" + SHA + "/file"
            target = Path(folder) / "release"
            with self.assertRaises(common.DeploymentError):
                common.extract_release(archive([(name, "file"), (name, "file")]), target, SHA)
            self.assertFalse(target.exists())

    def test_host_ownership_must_match(self):
        config = {**CONFIG, "project_id": PROJECT_ID}
        owner = {"deployment_id": CONFIG["deployment_id"], "project_id": PROJECT_ID, "droplet_id": 456}
        host.assert_instance(config, owner, "456", common.droplet_name(CONFIG))
        for modified in ({**owner, "droplet_id": 999}, {**owner, "project_id": "foreign"},
                         {**owner, "deployment_id": "foreign"}):
            with self.assertRaises(common.DeploymentError):
                host.assert_instance(config, modified, "456", common.droplet_name(CONFIG))

    def test_database_and_api_cannot_be_published(self):
        good = {"services": {"database": {"image": "postgres:17.6-alpine"}, "api": {}, "worker": {},
                              "web": {"ports": [{"host_ip": "127.0.0.1", "published": "3000"}]}}}
        host.validate_exposure(good)
        for service in ("database", "api", "worker", "web"):
            bad = copy.deepcopy(good)
            bad["services"][service]["ports"] = [{"host_ip": "0.0.0.0", "published": "5432"}]
            with self.assertRaises(common.DeploymentError):
                host.validate_exposure(bad)

    def test_price_increase_or_unavailable_region_stops_setup(self):
        size = {"slug": CONFIG["size"], "available": True, "price_monthly": 24, "price_hourly": .03571, "regions": ["blr1"]}
        region = {"slug": "blr1", "available": True, "sizes": [CONFIG["size"]]}
        self.assertEqual(provision.validate_available(CONFIG, [size], [region])["usd_month"], 24)
        for changed_size, changed_region in [({**size, "price_monthly": 25}, region),
                                             (size, {**region, "available": False}), ({**size, "regions": []}, region),
                                             ({**size, "price_monthly": float("nan")}, region),
                                             ({**size, "price_monthly": True}, region)]:
            with self.assertRaises(common.DeploymentError):
                provision.validate_available(CONFIG, [changed_size], [changed_region])

    def test_unknown_create_outcome_blocks_retry(self):
        state = checkpoint()

        class TimeoutAPI:
            calls = 0

            def call(self, *args):
                self.calls += 1
                self_before = state.records[-1]
                self_case.assertEqual(self_before["pending"]["operation"], "project")
                raise TimeoutError()

        self_case = self
        api = TimeoutAPI()
        with self.assertRaises(TimeoutError):
            state.create("project", api, "/v2/projects", {}, "project")
        with self.assertRaises(common.DeploymentError):
            state.create("project", api, "/v2/projects", {}, "project")
        self.assertEqual(api.calls, 1)
        self.assertEqual(state.data["resources"], {})

    def test_confirmed_create_id_is_reused_without_second_create(self):
        state, api = checkpoint(), FakeDO()
        first = state.create("project", api, "/v2/projects", {}, "project")
        second = state.create("project", api, "/v2/projects", {}, "project")
        self.assertEqual((first, second), (PROJECT_ID, PROJECT_ID))
        self.assertEqual(len(api.calls), 1)
        self.assertIsNone(state.records[-1]["pending"])

    def test_cloud_create_waits_for_durable_pending_checkpoint(self):
        state, api = checkpoint(), FakeDO()
        state.save = lambda: (_ for _ in ()).throw(TimeoutError("checkpoint unavailable"))
        with self.assertRaises(TimeoutError):
            state.create("project", api, "/v2/projects", {}, "project")
        self.assertEqual(api.calls, [])

    def test_invalid_create_ids_remain_unreconciled_and_cannot_select_endpoints(self):
        for kind, value in (("project", "../account"), ("ssh_key", True), ("droplet", -1), ("droplet", "456")):
            state = checkpoint()
            path, key = provision.CREATES[kind]

            class InvalidResponse:
                def call(self, *args):
                    return {key: {"id": value}}

            with self.subTest(kind=kind, value=value), self.assertRaises(common.DeploymentError):
                state.create(kind, InvalidResponse(), path, {}, key)
            self.assertEqual(state.data["resources"], {})
            self.assertEqual(state.data["pending"]["operation"], kind)

    def test_create_scope_rejects_other_resource_types_before_calls(self):
        state, api = checkpoint(), FakeDO()
        with self.assertRaises(common.DeploymentError):
            state.create("project", api, "/v2/firewalls", {}, "project")
        self.assertEqual((api.calls, state.records), ([], []))

    def test_successful_ids_and_unknown_outcomes_survive_new_runner(self):
        github = FakeGitHub()
        with tempfile.TemporaryDirectory() as folder, patch.object(provision, "Path", lambda name: Path(folder) / name):
            state = provision.Checkpoint(github, CONFIG, SHA)
            state.create("project", FakeDO(), "/v2/projects", {}, "project")
            resumed = provision.Checkpoint(github, CONFIG, OTHER)
            self.assertEqual(resumed.data["resources"], {"project": PROJECT_ID})
            resumed.data["pending"] = {"operation": "ssh_key", "path": "/v2/account/keys"}
            resumed.save()
            with self.assertRaisesRegex(common.DeploymentError, "unknown"):
                provision.Checkpoint(github, CONFIG, OTHER)
            self.assertEqual(sum(method == "POST" for method, _, _ in github.calls), 1)

    def test_existing_unowned_branch_and_malformed_saved_ids_are_never_reused(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(provision, "Path", lambda name: Path(folder) / name):
            github = FakeGitHub()
            github.branch = "refs/heads/deployment/gymmembership-" + CONFIG["deployment_id"][:8]
            with self.assertRaisesRegex(common.DeploymentError, "exists without"):
                provision.Checkpoint(github, CONFIG, SHA)
            self.assertTrue(all(method == "GET" for method, _, _ in github.calls))
            github = FakeGitHub()
            state = provision.Checkpoint(github, CONFIG, SHA)
            state.data["resources"] = {"project": "../foreign"}
            state.save()
            github.calls.clear()
            with self.assertRaises(common.DeploymentError):
                provision.Checkpoint(github, CONFIG, SHA)
            self.assertTrue(all(method == "GET" for method, _, _ in github.calls))

    def test_definitive_rejection_clears_pending_without_resource(self):
        class Denied:
            def call(self, *args):
                raise urllib.error.HTTPError("https://api.digitalocean.com/v2/projects", 403, "denied", {}, None)

        state = checkpoint()
        with self.assertRaises(urllib.error.HTTPError):
            state.create("project", Denied(), "/v2/projects", {}, "project")
        self.assertIsNone(state.data["pending"])
        self.assertEqual(state.data["resources"], {})

    def test_existing_project_is_never_adopted(self):
        state, api = checkpoint(), FakeDO(existing=True)
        with self.assertRaises(common.DeploymentError):
            provision.provision(CONFIG, state, api, SHA)
        self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_only_new_resources_are_assigned_and_rerun_is_read_only(self):
        state, api = checkpoint(), FakeDO()
        provision.provision(CONFIG, state, api, SHA)
        writes = [(method, path, body) for method, path, body in api.calls if method != "GET"]
        self.assertEqual([path for _, path, _ in writes], ["/v2/projects", "/v2/account/keys", "/v2/droplets",
                                                          "/v2/projects/" + PROJECT_ID + "/resources"])
        self.assertEqual(writes[-1][2], {"resources": ["do:droplet:456"]})
        self.assertFalse(writes[2][2]["backups"])
        self.assertNotIn("vpc_uuid", writes[2][2])
        api.calls.clear()
        provision.provision(CONFIG, state, api, SHA)
        self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_cloud_init_contains_no_management_tokens(self):
        with patch.dict("os.environ", {"DO_PROVISION_TOKEN": "do_private_fixture_123", "GH_TOKEN": "gh_private_fixture_123"}):
            config = provision.cloud_config(CONFIG, PROJECT_ID, SHA)
        self.assertNotIn("do_private_fixture_123", config)
        self.assertNotIn("gh_private_fixture_123", config)
        data = json.loads(config.split("\n", 1)[1])
        self.assertFalse(data["ssh_pwauth"])
        self.assertEqual(len(data["write_files"]), 4)

    def test_assignment_without_owned_ids_is_rejected(self):
        for resources in ({}, {"project": PROJECT_ID}, {"project": PROJECT_ID, "droplet": "foreign"},
                          {"project": PROJECT_ID, "droplet": True}, {"project": "../foreign", "droplet": 456}):
            with self.assertRaises(common.DeploymentError):
                provision.assignment_payload({"resources": resources})

    def test_changed_owned_server_identity_stops_before_assignment(self):
        for field, value in (("id", 999), ("size_slug", "s-4vcpu-8gb"), ("name", "old-server")):
            state, api = checkpoint(), FakeDO()
            state.data["resources"] = {"project": PROJECT_ID, "ssh_key": 123, "droplet": 456}
            original = api.call

            def changed(method, path, payload=None):
                result = original(method, path, payload)
                if path == "/v2/droplets/456":
                    result["droplet"][field] = value
                return result

            with self.subTest(field=field), patch.object(api, "call", changed), self.assertRaises(common.DeploymentError):
                provision.provision(CONFIG, state, api, SHA)
            self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_resume_owned_server_does_not_require_size_still_on_sale(self):
        state = checkpoint()
        state.data.update({"resources": {"project": PROJECT_ID, "ssh_key": 123, "droplet": 456},
                           "url": "https://gymmembership.1.1.1.1.sslip.io"})

        class AccountOnly:
            def call(self, method, path, payload=None):
                if (method, path) != ("GET", "/v2/account"):
                    raise AssertionError("An existing server should not need a new size/image quote")
                return {"account": {"status": "active"}}

        class Ready:
            status, headers = 200, {"X-GymMembership-Release": SHA}
            def read(self, limit):
                return b'{"status":"ready"}'
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass

        env = {"GITHUB_REPOSITORY": common.REPOSITORY, "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SHA,
               "GH_TOKEN": "github_fixture", "DO_PROVISION_TOKEN": "digitalocean_fixture"}
        with patch.dict("os.environ", env), patch.object(provision, "API", return_value=AccountOnly()), \
                patch.object(provision, "Checkpoint", return_value=state), \
                patch.object(provision, "approved_head", return_value=SHA), \
                patch.object(provision, "provision") as launch, \
                patch.object(provision.urllib.request, "urlopen", return_value=Ready()):
            provision.main()
        launch.assert_called_once()
        self.assertEqual(state.data["phase"], "https_ready")

    def test_unapproved_api_origin_is_rejected(self):
        with self.assertRaises(common.DeploymentError):
            common.API("https://example.com", "secret")


if __name__ == "__main__":
    unittest.main()
