"""Mock host operations: no Docker, cloud API, or real provider verification."""
import copy
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from contextlib import ExitStack, redirect_stderr
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
    "migrate": {}, "edge": {"image": "caddy:2.11.4-alpine"},
}}


class HostDeployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(host, "ROOT", self.root))
        # Engine maintenance (volume inspection, image and build-cache pruning) is mocked too.
        self.docker = self.stack.enter_context(patch.object(host, "docker", return_value=None))

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

    # The web proxy signs X-Forwarded-For into the API's per-client budget key, so
    # the edge must set it from the connecting address, never pass a client value.
    EDGE_PROXY = "    reverse_proxy web:3000 {\n        header_up X-Forwarded-For {remote_host}\n    }\n"

    def test_bootstrap_edge_and_example_overwrite_forwarded_client_address(self):
        with patch.object(host, "metadata", return_value="1.1.1.1"):
            host.ensure_runtime()
        caddyfile = (self.root / "Caddyfile").read_text()
        self.assertIn(self.EDGE_PROXY, caddyfile)
        # The platform block and the on-demand coach-domain block both overwrite it.
        self.assertEqual(caddyfile.count("reverse_proxy"), 2)
        self.assertEqual(caddyfile.count(self.EDGE_PROXY), 2)
        example = (Path(__file__).resolve().parents[1] / "infra/Caddyfile.example").read_text()
        self.assertIn("reverse_proxy 127.0.0.1:3000 {\n        header_up X-Forwarded-For {remote_host}\n    }", example)
        self.assertEqual(example.count("reverse_proxy"),
                         example.count("reverse_proxy 127.0.0.1:3000 {\n        header_up X-Forwarded-For {remote_host}\n    }"))

    def test_release_and_rollback_edge_overwrite_forwarded_client_address(self):
        edges = []

        def failure(sha, args):
            if "--force-recreate" in args:
                edges.append((sha, (self.root / "Caddyfile").read_text()))
            return sha == SHA and "--force-recreate" in args

        self.deployment(failure=failure)
        with self.assertRaises(subprocess.CalledProcessError):
            host.deploy(SHA, Mock())
        self.assertEqual([sha for sha, _ in edges], [SHA, PREVIOUS])
        for sha, caddyfile in edges:
            self.assertIn("header X-GymMembership-Release " + sha + "\n" + self.EDGE_PROXY, caddyfile)
            self.assertEqual(caddyfile.count("reverse_proxy"), 1)

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
        self.assertNotIn("set_config", kwargs["input"])

    def test_scope_compatible_controller_applies_tenant_scope_after_grants(self):
        release = self.root / "release"
        (release / "infra").mkdir(parents=True)
        (release / "infra/runtime-role.sql").write_text("GRANT trainer_app TO trainer_service;\n")
        (release / "infra/tenant-scope.sql").write_text(
            "REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC;\n")
        with patch.object(host, "compose", return_value=SimpleNamespace(stdout=json.dumps(RENDERED))) as compose:
            host.runtime_role(release, SHA)
        sql = compose.call_args[1]["input"]
        self.assertLess(sql.index("PASSWORD"), sql.index("REVOKE EXECUTE ON FUNCTION pg_catalog.set_config"))
        self.assertLess(sql.index("GRANT trainer_app"), sql.index("REVOKE EXECUTE"))

    def test_host_network_cannot_bypass_port_boundary(self):
        rendered = copy.deepcopy(RENDERED)
        rendered["services"]["database"]["network_mode"] = "host"
        with self.assertRaises(common.DeploymentError):
            host.validate_exposure(rendered)

    def test_compose_cannot_inherit_runtime_or_remote_engine_overrides(self):
        overrides = {
            "PUBLIC_APP_URL": "http://localhost:3000",
            "DATABASE_URL": "postgres://foreign/other",
            "PAYOUTS_APPROVED": "true",
            "DOCKER_HOST": "tcp://foreign:2375",
            "COMPOSE_FILE": "/foreign/compose.yaml",
            "RELEASE_TAG": PREVIOUS,
        }
        with patch.dict(os.environ, overrides), patch.object(host, "run") as run:
            host.compose(self.root / "release", SHA, "config")
        args, kwargs = run.call_args
        self.assertEqual(kwargs["env"]["RELEASE_TAG"], SHA)
        for key in overrides.keys() - {"RELEASE_TAG"}:
            self.assertNotIn(key, kwargs["env"])
        self.assertIn(str(self.root / "runtime.env"), args[0])

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
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "http://localhost:3000", "PAYOUTS_APPROVED": "true"}):
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
        self.assertEqual(api_env["PAYOUTS_APPROVED"], "false")

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

    def admin_request(self, mode=0o600, **overrides):
        common.atomic_json(self.root / "release-state.json", {"current": SHA})
        request = {"email": "owner@example.test", "password": "correct-horse-battery-staple", **overrides}
        path = self.root / host.ADMIN_REQUEST
        path.write_text(json.dumps(request))
        path.chmod(mode)
        return path

    def test_admin_bootstrap_without_request_runs_nothing(self):
        compose = self.stack.enter_context(patch.object(host, "compose"))
        host.bootstrap_pending_admin()
        compose.assert_not_called()

    def test_admin_bootstrap_sends_password_on_stdin_and_removes_request(self):
        path = self.admin_request()
        compose = self.stack.enter_context(patch.object(host, "compose"))
        host.bootstrap_pending_admin()
        (release, sha, *args), kwargs = compose.call_args
        self.assertEqual((release, sha), (self.root / "releases" / SHA, SHA))
        self.assertIn("BOOTSTRAP_ADMIN_EMAIL=owner@example.test", args)
        self.assertEqual(kwargs["input"], "correct-horse-battery-staple")
        self.assertFalse(any("correct-horse" in str(arg) for arg in args))
        self.assertIs(kwargs["stdout"], subprocess.DEVNULL)
        self.assertFalse(path.exists())

    def test_admin_bootstrap_rejects_shared_or_invalid_requests_before_commands(self):
        compose = self.stack.enter_context(patch.object(host, "compose"))
        for mode, overrides in ((0o644, {}), (0o600, {"password": "short"}), (0o600, {"email": "not-an-email"}),
                                (0o600, {"password": "multi\nline-password-value"}), (0o600, {"name": "$(id)"})):
            self.admin_request(mode, **overrides)
            with self.assertRaises(common.DeploymentError):
                host.bootstrap_pending_admin()
        compose.assert_not_called()

    def test_admin_bootstrap_failure_keeps_request_but_existing_admin_discards_it(self):
        path = self.admin_request()
        failure = subprocess.CalledProcessError(1, ["docker"], stderr="database unavailable")
        self.stack.enter_context(patch.object(host, "compose", side_effect=failure))
        with self.assertRaises(common.DeploymentError) as raised:
            host.bootstrap_pending_admin()
        self.assertNotIn("correct-horse", str(raised.exception))
        self.assertTrue(path.exists())
        existing = subprocess.CalledProcessError(1, ["docker"], stderr="Error: " + host.ADMIN_EXISTS + ".")
        with patch.object(host, "compose", side_effect=existing):
            host.bootstrap_pending_admin()
        self.assertFalse(path.exists())

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

    # Compose allowlist (quality-delivery:G13)

    def test_compose_host_escalation_is_rejected_before_build_or_start(self):
        self.deployment()
        (self.root / "outside").mkdir()

        def variant(change):
            rendered = copy.deepcopy(RENDERED)
            change(rendered, rendered["services"])
            return rendered

        caddyfile = str(self.root / "Caddyfile")
        release = str(self.root / "releases" / SHA)
        variants = {
            "privileged": variant(lambda r, s: s["api"].update(privileged=True)),
            "host root bind": variant(lambda r, s: s["worker"].update(
                volumes=[{"type": "bind", "source": "/", "target": "/host"}])),
            "extra service": variant(lambda r, s: s.update(sidecar={"image": "alpine"})),
            "missing edge": variant(lambda r, s: s.pop("edge")),
            "capability": variant(lambda r, s: s["edge"].update(cap_add=["SYS_ADMIN"])),
            "host pid": variant(lambda r, s: s["database"].update(pid="host")),
            "host ipc": variant(lambda r, s: s["web"].update(ipc="host")),
            "device": variant(lambda r, s: s["api"].update(devices=[{"source": "/dev/sda", "target": "/dev/sda"}])),
            "engine socket": variant(lambda r, s: s["worker"].update(use_api_socket=True)),
            "security option": variant(lambda r, s: s["api"].update(security_opt=["apparmor=unconfined"])),
            "user namespace": variant(lambda r, s: s["api"].update(userns_mode="host")),
            "container network": variant(lambda r, s: s["worker"].update(network_mode="service:database")),
            "host file secret": variant(lambda r, s: s["api"].update(secrets=[{"source": "shadow"}])),
            "gpu reservation": variant(lambda r, s: s["worker"].update(
                deploy={"resources": {"reservations": {"devices": [{"capabilities": ["gpu"]}]}}})),
            "database volume in api": variant(lambda r, s: s["api"].update(
                volumes=[{"type": "volume", "source": "postgres_data", "target": "/data"}])),
            "writable caddyfile": variant(lambda r, s: s["edge"].update(
                volumes=[{"type": "bind", "source": caddyfile, "target": "/etc/caddy/Caddyfile", "read_only": False}])),
            "other edge bind": variant(lambda r, s: s["edge"].update(
                volumes=[{"type": "bind", "source": str(self.root / "outside"), "target": "/etc/caddy/Caddyfile",
                          "read_only": True}])),
            "edge image": variant(lambda r, s: s["edge"].update(image="caddy:latest")),
            "migrate port": variant(lambda r, s: s["migrate"].update(ports=[{"published": "9229", "target": 9229}])),
            "second builder": variant(lambda r, s: s["api"].update(build={"context": release})),
            "build outside release": variant(lambda r, s: s["migrate"].update(build={"context": "/", "dockerfile": "Dockerfile"})),
            "build host context": variant(lambda r, s: s["migrate"].update(
                build={"context": release, "additional_contexts": {"host": "/"}})),
            "privileged build": variant(lambda r, s: s["migrate"].update(
                build={"context": release, "entitlements": ["security.insecure"]})),
            "host bind named volume": variant(lambda r, s: r.update(volumes={"postgres_data": {
                "driver": "local", "driver_opts": {"type": "none", "o": "bind", "device": "/"}}})),
            "unreviewed named volume": variant(lambda r, s: r.update(volumes={"host_data": {}})),
            "external host network": variant(lambda r, s: r.update(networks={"default": {"name": "host", "external": True}})),
        }
        for name, rendered in variants.items():
            calls = []

            def compose(release, sha, *args, rendered=rendered, **kwargs):
                calls.append(args)
                return SimpleNamespace(stdout=json.dumps(rendered))

            with self.subTest(name), patch.object(host, "compose", side_effect=compose):
                with self.assertRaises(common.DeploymentError) as raised:
                    host.deploy(SHA, Mock())
                self.assertEqual([args[0] for args in calls], ["config"])
                self.assertNotIn("fixture_password", str(raised.exception))
        self.assertEqual(json.loads((self.root / "release-state.json").read_text()), {"current": PREVIOUS})

    def test_reviewed_topology_with_release_build_and_edge_caddyfile_is_accepted(self):
        release = self.root / "releases" / SHA
        release.mkdir(parents=True)
        rendered = copy.deepcopy(RENDERED)
        services = rendered["services"]
        services["migrate"]["build"] = {"context": str(release), "dockerfile": "Dockerfile"}
        services["database"]["volumes"] = [{"type": "volume", "source": "postgres_data", "target": "/var/lib/postgresql/data"}]
        services["edge"].update(ports=[{"published": "80", "target": 80}, {"published": "443", "target": 443}], volumes=[
            {"type": "bind", "source": str(self.root / "Caddyfile"), "target": "/etc/caddy/Caddyfile", "read_only": True,
             "bind": {"create_host_path": True}},
            {"type": "volume", "source": "caddy_data", "target": "/data", "volume": {}},
            {"type": "volume", "source": "caddy_config", "target": "/config", "volume": {}}])
        for service in services.values():
            # Benign or empty settings that some Compose versions render must not halt deployment.
            service.update(networks={"default": None}, entrypoint=None, privileged=False, cap_add=[], pull_policy="missing")
        rendered["volumes"] = {name: {"name": "gymmembership_" + name} for name in ("postgres_data", "caddy_data", "caddy_config")}
        rendered["networks"] = {"default": {"name": "gymmembership_default", "ipam": {}, "external": False}}
        host.validate_exposure(rendered, release)
        with self.assertRaises(common.DeploymentError):
            host.validate_exposure(rendered, self.root / "releases" / PREVIOUS)

    def test_real_compose_render_passes_allowlist_only_for_its_release(self):
        if not shutil.which("docker") or subprocess.run(["docker", "compose", "version"], capture_output=True,
                                                        check=False).returncode:
            if os.environ.get("GITHUB_ACTIONS") == "true":
                self.fail("Docker Compose CLI is required for the CI configuration gate")
            self.skipTest("Docker Compose CLI unavailable; real configuration was not verified locally")
        with patch.object(host, "metadata", return_value="1.1.1.1"):
            host.ensure_runtime()
        release = Path(__file__).resolve().parents[1]
        rendered = json.loads(host.compose(release, SHA, "config", "--format", "json", capture_output=True, text=True).stdout)
        host.validate_exposure(rendered, release)
        self.assertEqual(Path(rendered["services"]["migrate"]["build"]["context"]).resolve(), release)
        with self.assertRaises(common.DeploymentError):
            host.validate_exposure(rendered, self.root)

    # Bounded host retention (quality-delivery:G12)

    def test_success_prunes_old_releases_unpack_dirs_backups_and_images(self):
        old = "c" * 40
        self.deployment()
        releases = self.root / "releases"
        (releases / old / "infra").mkdir(parents=True)
        (releases / (".unpack-" + old + "-0123abcd") / "partial").mkdir(parents=True)
        (releases / "operator-notes").mkdir()
        backups = self.root / "backups"
        backups.mkdir()
        for index in range(10):
            (backups / (str(1000 + index) + ".sql")).write_text("dump")
        (backups / "manual-copy.sql").write_text("kept")
        self.docker.side_effect = lambda *args: SimpleNamespace(
            returncode=0, stdout="\n".join((old, PREVIOUS, SHA, "local", "latest")) + "\n") \
            if args[:2] == ("image", "ls") else SimpleNamespace(returncode=0, stdout="")
        host.deploy(SHA, Mock())
        self.assertEqual(sorted(p.name for p in releases.iterdir()), sorted([SHA, PREVIOUS, "operator-notes"]))
        dumps = sorted(p.name for p in backups.glob("[0-9]*.sql"))
        self.assertEqual(len(dumps), host.BACKUPS_KEPT)
        self.assertEqual(dumps[:6], [str(1000 + index) + ".sql" for index in range(4, 10)])
        self.assertTrue((backups / "manual-copy.sql").exists())
        removed = [args for args, _ in self.docker.call_args_list if args[:2] == ("image", "rm")]
        self.assertEqual(removed, [("image", "rm", "trainer-brain:" + old)])
        self.docker.assert_any_call("builder", "prune", "--force", "--filter", "until=168h")
        self.assertEqual(json.loads((self.root / "release-state.json").read_text())["previous"], PREVIOUS)

    def test_failed_deploy_prunes_nothing(self):
        old = "c" * 40
        _, _, _, ready = self.deployment()
        (self.root / "releases" / old).mkdir()
        backups = self.root / "backups"
        backups.mkdir()
        seeded = [str(1000 + index) + ".sql" for index in range(host.BACKUPS_KEPT + 3)]
        for name in seeded:
            (backups / name).write_text("complete")
        ready.side_effect = common.DeploymentError("bad readiness")
        with self.assertRaises(common.DeploymentError):
            host.deploy(SHA, Mock())
        self.assertTrue((self.root / "releases" / old).is_dir())
        self.assertFalse(any(args[:2] == ("image", "rm") for args, _ in self.docker.call_args_list))
        names = {p.name for p in backups.iterdir()}
        self.assertTrue(set(seeded) <= names, "a failed deployment removes no dump")
        self.assertEqual(len(names), len(seeded) + 1)

    def test_failed_retries_keep_every_dump_including_the_pre_migration_one(self):
        # The timer retries a failing head every cycle; each retry dumps the
        # already-migrated database. None of that may push out older dumps.
        calls, _, _, ready = self.deployment()
        backups = self.root / "backups"
        backups.mkdir()
        seeded = [str(1000 + index) + ".sql" for index in range(host.BACKUPS_KEPT)]
        for name in seeded:
            (backups / name).write_text("complete")
        ready.side_effect = lambda url, **kwargs: (_ for _ in ()).throw(common.DeploymentError("bad readiness")) \
            if kwargs.get("expected_sha") == SHA else None
        clock = iter(range(2000, 3000))
        self.stack.enter_context(patch.object(host, "time", SimpleNamespace(
            time_ns=lambda: next(clock), time=host.time.time, sleep=host.time.sleep)))
        attempts = host.BACKUPS_KEPT + 2
        for _ in range(attempts):
            with self.assertRaises(common.DeploymentError):
                host.deploy(SHA, Mock())
        self.assertEqual(len([args for _, args, _ in calls if args[0] == "run"]), attempts)
        self.assertEqual(sorted(p.name for p in backups.iterdir()),
                         sorted(seeded + [str(2000 + index) + ".sql" for index in range(attempts)]))
        self.assertTrue((backups / "2000.sql").is_file(), "the dump taken before the migration survives")
        self.assertEqual(json.loads((self.root / "release-state.json").read_text()), {"current": PREVIOUS})

    def test_backup_retention_errors_never_fail_a_recorded_deployment(self):
        self.deployment()
        backups = self.root / "backups"
        backups.mkdir()
        for index in range(host.BACKUPS_KEPT + 2):
            (backups / (str(1000 + index) + ".sql")).write_text("complete")
        errors = io.StringIO()
        with patch.object(host.Path, "unlink", side_effect=PermissionError("read-only")), redirect_stderr(errors):
            host.deploy(SHA, Mock())
        state = json.loads((self.root / "release-state.json").read_text())
        self.assertEqual((state["current"], state["previous"]), (SHA, PREVIOUS))
        self.assertIn("Old backups could not all be removed", errors.getvalue())
        self.assertEqual(len(list(backups.glob("[0-9]*.sql"))), host.BACKUPS_KEPT + 3)
        # Release retention still ran after the backup error.
        self.docker.assert_any_call("builder", "prune", "--force", "--filter", "until=168h")

    def test_retention_removes_links_without_following_them(self):
        outside = self.root / "outside"
        (outside / "data").mkdir(parents=True)
        (outside / "data" / "keep.txt").write_text("outside")
        releases = self.root / "releases"
        releases.mkdir()
        (releases / ("c" * 40)).symlink_to(outside, target_is_directory=True)
        (releases / ".unpack-link").symlink_to(outside / "data", target_is_directory=True)
        (releases / SHA).mkdir()
        host.prune_releases({SHA, None})
        self.assertEqual([p.name for p in releases.iterdir()], [SHA])
        self.assertEqual((outside / "data" / "keep.txt").read_text(), "outside")

    def test_failed_extract_leaves_no_partial_release(self):
        common.atomic_json(self.root / "release-state.json", {"current": PREVIOUS})
        compose = self.stack.enter_context(patch.object(host, "compose"))

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def partial_extract(archive, destination, sha):
            (destination / "apps").mkdir(parents=True)
            (destination / "apps" / "file").write_text("partial")
            raise OSError("No space left on device")

        self.stack.enter_context(patch.object(host.urllib.request, "urlopen", return_value=Response(b"archive")))
        self.stack.enter_context(patch.object(host, "extract_release", side_effect=partial_extract))
        with self.assertRaises(OSError):
            host.deploy(SHA, Mock())
        self.assertEqual(list((self.root / "releases").iterdir()), [])
        compose.assert_not_called()

    def test_failed_backup_is_removed_and_older_dumps_are_kept(self):
        calls, _, role, _ = self.deployment(failure=lambda sha, args: args[0] == "exec" and "pg_dump" in args)
        backups = self.root / "backups"
        backups.mkdir()
        for index in range(host.BACKUPS_KEPT):
            (backups / (str(1000 + index) + ".sql")).write_text("complete")
        with self.assertRaises(subprocess.CalledProcessError):
            host.deploy(SHA, Mock())
        self.assertEqual(sorted(p.name for p in backups.iterdir()),
                         sorted(str(1000 + index) + ".sql" for index in range(host.BACKUPS_KEPT)))
        self.assertFalse(any(args[0] == "run" for _, args, _ in calls))
        role.assert_not_called()

    # Missing runtime secrets on an existing host (quality-delivery:M2)

    def test_missing_runtime_on_existing_deployment_is_not_regenerated(self):
        def state(root):
            common.atomic_json(root / "release-state.json", {"current": SHA})

        def fingerprint(root):
            (root / host.FINGERPRINT).write_text("{}")

        def release(root):
            (root / "releases" / SHA).mkdir(parents=True)

        def backup(root):
            (root / "backups").mkdir()
            (root / "backups" / "1.sql").write_text("dump")

        def volume(root):
            self.docker.return_value = SimpleNamespace(returncode=0, stdout="[]")

        for name, arrange in (("state", state), ("fingerprint", fingerprint), ("release", release),
                              ("backup", backup), ("database volume", volume)):
            with self.subTest(name), tempfile.TemporaryDirectory() as directory, \
                    patch.object(host, "ROOT", Path(directory)), patch.object(host, "metadata", return_value="1.1.1.1"):
                root = Path(directory)
                self.docker.return_value = SimpleNamespace(returncode=1, stdout="")
                arrange(root)
                before = sorted(p.name for p in root.iterdir())
                with self.assertRaises(common.DeploymentError) as raised:
                    host.ensure_runtime()
                self.assertIn("restore", str(raised.exception))
                self.assertFalse((root / "runtime.env").exists())
                self.assertEqual(sorted(p.name for p in root.iterdir()), before)
        self.docker.assert_any_call("volume", "inspect", "gymmembership_postgres_data")

    def test_new_host_generates_runtime_and_records_non_secret_fingerprint(self):
        self.docker.return_value = SimpleNamespace(returncode=1, stdout="")
        with patch.object(host, "metadata", return_value="1.1.1.1"):
            host.ensure_runtime()
            values = dict(line.split("=", 1) for line in (self.root / "runtime.env").read_text().splitlines())
            path = self.root / host.FINGERPRINT
            recorded = path.read_text()
            self.assertEqual(json.loads(recorded)["security_encryption_key_sha256"],
                             hashlib.sha256(values["SECURITY_ENCRYPTION_KEY"].encode()).hexdigest())
            self.assertNotIn(values["SECURITY_ENCRYPTION_KEY"], recorded)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            # Existing hosts are backfilled from their unchanged runtime file.
            path.unlink()
            original = (self.root / "runtime.env").read_bytes()
            host.ensure_runtime()
            self.assertEqual(path.read_text(), recorded)
            self.assertEqual((self.root / "runtime.env").read_bytes(), original)
            (self.root / "runtime.env").unlink()
            with self.assertRaises(common.DeploymentError):
                host.ensure_runtime()
            self.assertFalse((self.root / "runtime.env").exists())


if __name__ == "__main__":
    unittest.main()
