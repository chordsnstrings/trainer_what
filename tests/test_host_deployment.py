"""Mock host operations: no Docker, cloud API, or real provider verification."""
import copy
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import common
import dispatch
import host

SHA = "a" * 40
PREVIOUS = "b" * 40
ENDPOINT = "https://gymmembership.1.1.1.1.sslip.io"
RENDERED = {"services": {
    "database": {"image": "postgres:17.6-alpine"},
    "api": {"environment": {"DATABASE_URL": "postgres://trainer_service:fixture_password@database:5432/trainer"}},
    "worker": {}, "web": {"ports": [{"host_ip": "127.0.0.1", "published": "3000"}]},
}}


class HostDeployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(host, "ROOT", self.root))

    def deployment(self, previous=PREVIOUS, failure=None):
        releases = self.root / "releases"
        for sha in (SHA, PREVIOUS):
            (releases / sha).mkdir(parents=True)
        if previous:
            common.atomic_json(self.root / "release-state.json", {"current": previous})
        common.atomic_json(self.root / "endpoint.json", {"url": ENDPOINT})
        (self.root / "Caddyfile").write_text("old configuration")
        calls = []

        def compose(release, sha, *args, **kwargs):
            calls.append((sha, args, kwargs))
            if failure and failure(sha, args):
                raise subprocess.CalledProcessError(1, ["docker", "compose", *args])
            return SimpleNamespace(stdout=json.dumps(RENDERED))

        self.stack.enter_context(patch.object(host, "compose", side_effect=compose))
        approved = self.stack.enter_context(patch.object(host, "approved_head", return_value=SHA))
        role = self.stack.enter_context(patch.object(host, "runtime_role"))
        ready = self.stack.enter_context(patch.object(host, "wait_ready"))
        return calls, approved, role, ready

    def test_migration_failure_never_replaces_current_application(self):
        calls, _, role, ready = self.deployment(failure=lambda sha, args: args[0] == "run")
        with self.assertRaises(subprocess.CalledProcessError):
            host.deploy(SHA, Mock())
        self.assertFalse(any("--force-recreate" in args for _, args, _ in calls))
        database_up = next(args for _, args, _ in calls if args[0] == "up")
        self.assertIn("--no-recreate", database_up)
        self.assertEqual(json.loads((self.root / "release-state.json").read_text()), {"current": PREVIOUS})
        self.assertEqual((self.root / "Caddyfile").read_text(), "old configuration")
        self.assertEqual(len(list((self.root / "backups").glob("*.sql"))), 1)
        role.assert_not_called()
        ready.assert_not_called()

    def test_failed_compose_start_restores_previous_and_verifies_https(self):
        calls, _, _, ready = self.deployment(failure=lambda sha, args: sha == SHA and "--force-recreate" in args)
        with self.assertRaises(subprocess.CalledProcessError):
            host.deploy(SHA, Mock())
        replacements = [(sha, args) for sha, args, _ in calls if "--force-recreate" in args]
        self.assertEqual([sha for sha, _ in replacements], [SHA, PREVIOUS])
        self.assertTrue(all("--wait" in args for _, args in replacements))
        ready.assert_any_call(ENDPOINT + "/api/v1/ready", expected_sha=PREVIOUS)
        self.assertIn(PREVIOUS, (self.root / "Caddyfile").read_text())
        self.assertEqual(json.loads((self.root / "release-state.json").read_text()), {"current": PREVIOUS})

    def test_failed_https_rolls_back_without_reversing_database(self):
        calls, _, _, ready = self.deployment()
        ready.side_effect = lambda url, **kwargs: (_ for _ in ()).throw(common.DeploymentError("bad readiness")) \
            if kwargs.get("expected_sha") == SHA else None
        with self.assertRaises(common.DeploymentError):
            host.deploy(SHA, Mock())
        self.assertEqual([sha for sha, args, _ in calls if "--force-recreate" in args], [SHA, PREVIOUS])
        self.assertEqual(len([args for _, args, _ in calls if args[0] == "run"]), 1)
        self.assertFalse(any(args[0] in ("down", "rm") for _, args, _ in calls))

    def test_failed_first_deployment_stops_candidate_and_keeps_database(self):
        calls, _, _, ready = self.deployment(previous=None)
        ready.side_effect = common.DeploymentError("bad readiness")
        with self.assertRaises(common.DeploymentError):
            host.deploy(SHA, Mock())
        stops = [args for _, args, _ in calls if args[0] == "stop"]
        self.assertEqual(stops, [("stop", "api", "web", "worker", "edge")])
        self.assertFalse((self.root / "release-state.json").exists())
        self.assertFalse(any(args[0] == "down" for _, args, _ in calls))

    def test_success_credits_only_ready_commit_and_retains_previous(self):
        calls, _, role, ready = self.deployment()
        host.deploy(SHA, Mock())
        state = json.loads((self.root / "release-state.json").read_text())
        self.assertEqual((state["current"], state["previous"]), (SHA, PREVIOUS))
        ready.assert_any_call(ENDPOINT + "/api/v1/ready", expected_sha=SHA)
        ready.assert_any_call(ENDPOINT + "/", attempts=10, expected_sha=SHA)
        role.assert_called_once()
        self.assertTrue(any(args[0] == "exec" and "pg_dump" in args for _, args, _ in calls))

    def test_new_head_after_build_does_not_mutate_running_services(self):
        calls, approved, role, ready = self.deployment()
        approved.return_value = None
        host.deploy(SHA, Mock())
        self.assertEqual([args[0] for _, args, _ in calls], ["config", "build"])
        role.assert_not_called()
        ready.assert_not_called()

    def test_same_commit_is_noop_and_invalid_commit_fails_before_commands(self):
        calls, _, _, _ = self.deployment(previous=SHA)
        host.deploy(SHA, Mock())
        with self.assertRaises(common.DeploymentError):
            host.deploy("../../foreign", Mock())
        self.assertEqual(calls, [])

    def test_partial_bootstrap_recovers_files_without_rotating_secrets(self):
        with patch.object(host, "metadata", return_value="1.1.1.1"):
            host.ensure_runtime()
            original = (self.root / "runtime.env").read_bytes()
            self.assertEqual((self.root / "runtime.env").stat().st_mode & 0o777, 0o600)
            for name in ("Caddyfile", "edge.json", "endpoint.json"):
                (self.root / name).unlink()
            host.ensure_runtime()
            self.assertEqual((self.root / "runtime.env").read_bytes(), original)
            self.assertTrue(all((self.root / name).is_file() for name in ("Caddyfile", "edge.json", "endpoint.json")))
            (self.root / "Caddyfile").write_text("active release configuration")
            host.ensure_runtime()
            self.assertEqual((self.root / "Caddyfile").read_text(), "active release configuration")

    def test_insecure_or_incomplete_runtime_is_not_overwritten(self):
        path = self.root / "runtime.env"
        path.write_text("PUBLIC_APP_URL=" + ENDPOINT + "\n")
        with patch.object(host, "metadata", return_value="1.1.1.1"):
            for mode in (0o644, 0o600):
                path.chmod(mode)
                with self.assertRaises(common.DeploymentError):
                    host.ensure_runtime()
                self.assertEqual(path.read_text(), "PUBLIC_APP_URL=" + ENDPOINT + "\n")

    def test_role_password_is_on_stdin_and_sql_errors_are_captured(self):
        release = self.root / "release"
        (release / "infra").mkdir(parents=True)
        (release / "infra/runtime-role.sql").write_text("CREATE ROLE trainer_service LOGIN;\nGRANT trainer_app TO trainer_service;\n")
        with patch.object(host, "compose", return_value=SimpleNamespace(stdout=json.dumps(RENDERED))) as compose:
            host.runtime_role(release, SHA)
        args, kwargs = compose.call_args
        self.assertNotIn("fixture_password", " ".join(map(str, args)))
        self.assertIn("fixture_password", kwargs["input"])
        self.assertEqual(kwargs["stderr"], subprocess.PIPE)
        self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)

    def test_host_network_cannot_bypass_port_boundary(self):
        rendered = copy.deepcopy(RENDERED)
        rendered["services"]["database"]["network_mode"] = "host"
        with self.assertRaises(common.DeploymentError):
            host.validate_exposure(rendered)

    def test_real_compose_renders_repository_and_private_runtime(self):
        if not shutil.which("docker"):
            if os.environ.get("GITHUB_ACTIONS") == "true":
                self.fail("Docker CLI is required for the CI Compose configuration gate")
            self.skipTest("Docker CLI unavailable; real Compose configuration was not verified locally")
        version = subprocess.run(["docker", "compose", "version"], capture_output=True, check=False)
        if version.returncode:
            if os.environ.get("GITHUB_ACTIONS") == "true":
                self.fail("Docker Compose CLI is required for the CI configuration gate")
            self.skipTest("Docker Compose CLI unavailable; real configuration was not verified locally")
        with patch.object(host, "metadata", return_value="1.1.1.1"):
            host.ensure_runtime()
        release = Path(__file__).resolve().parents[1]
        # Configuration parsing only: no image build, network, daemon or service start.
        result = host.compose(release, SHA, "config", "--format", "json", capture_output=True, text=True)
        rendered = json.loads(result.stdout)
        host.validate_exposure(rendered)
        services = rendered["services"]
        self.assertEqual(set(services), {"database", "migrate", "api", "web", "worker", "edge"})
        for name in ("migrate", "api", "web", "worker"):
            self.assertEqual(services[name]["image"], "trainer-brain:" + SHA)
        self.assertEqual(services["edge"]["image"], "caddy:2.11.4-alpine")
        self.assertEqual({int(port["published"]) for port in services["edge"]["ports"]}, {80, 443})
        api_env, worker_env = services["api"]["environment"], services["worker"]["environment"]
        self.assertTrue(api_env["DATABASE_URL"].startswith("postgres://trainer_service:"))
        self.assertTrue(api_env["DATABASE_URL"] == worker_env["DATABASE_URL"])
        self.assertNotIn("MIGRATION_DATABASE_URL", api_env)
        self.assertNotIn("MIGRATION_DATABASE_URL", worker_env)
        self.assertEqual(api_env["PUBLIC_APP_URL"], ENDPOINT)

    def test_readiness_rejects_old_release_and_non_ready_body(self):
        class Response(io.BytesIO):
            status = 200

            def __init__(self, sha, body):
                super().__init__(body)
                self.headers = {"X-GymMembership-Release": sha}

        for sha, body in ((PREVIOUS, b'{"status":"ready"}'), (SHA, b'{"status":"ok"}'), (SHA, b'not json')):
            with self.subTest(sha=sha, body=body), patch.object(host.urllib.request, "build_opener") as opener:
                opener.return_value.open.return_value = Response(sha, body)
                with self.assertRaises(common.DeploymentError):
                    host.wait_ready(ENDPOINT + "/api/v1/ready", attempts=1, expected_sha=SHA)
        with patch.object(host.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = Response(SHA, b'{"status":"ready"}')
            host.wait_ready(ENDPOINT + "/api/v1/ready", attempts=1, expected_sha=SHA)

    def test_dispatch_requires_recorded_deployed_controller(self):
        self.assertEqual(dispatch.controller(self.root), self.root / "host.py")
        common.atomic_json(self.root / "release-state.json", {"current": SHA})
        with self.assertRaises(common.DeploymentError):
            dispatch.controller(self.root)
        script = self.root / "releases" / SHA / "infra/digitalocean/host.py"
        script.parent.mkdir(parents=True)
        script.write_text("# approved controller")
        self.assertEqual(dispatch.controller(self.root), script)
        script.unlink()
        (self.root / "foreign.py").write_text("# unexpected controller")
        script.symlink_to(self.root / "foreign.py")
        with self.assertRaises(common.DeploymentError):
            dispatch.controller(self.root)
        common.atomic_json(self.root / "release-state.json", {"current": "../../foreign"})
        with self.assertRaises(common.DeploymentError):
            dispatch.controller(self.root)

    def test_archive_conflicting_paths_and_private_env_reject_before_writes(self):
        for names in (("parent", "parent/child"), (".env.production",), ("apps/api/.env.local",)):
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                for name in names:
                    member = tarfile.TarInfo("trainer_what-" + SHA + "/" + name)
                    member.size = 1
                    archive.addfile(member, io.BytesIO(b"x"))
            destination = self.root / "candidate"
            with self.assertRaises(common.DeploymentError):
                common.extract_release(output.getvalue(), destination, SHA)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
