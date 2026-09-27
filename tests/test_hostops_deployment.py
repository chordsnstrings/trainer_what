"""Host operations: edge TLS, release serving, operator actions, backups and reports.

No Docker, database, cloud or storage provider is used. OpenSSL is run for real
to prove the encryption round trip; storage is a local HTTP fixture server.
"""
import base64
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import ExitStack, redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import common
import dispatch
import host
import hostops

SHA, PREVIOUS, OLDER = "a" * 40, "b" * 40, "c" * 40
ENDPOINT = "https://gymmembership.1.1.1.1.sslip.io"
# Synthetic fixture values; the same vectors are asserted in tests/infra-ops-api.test.ts.
PROXY_SECRET = "synthetic-host-operations-secret-with-more-than-32-bytes"
ASK_TOKEN = "8c437ce20c7da0fd1368eae05874247b724bb9684d8dc601a7d56b8121ece587"
ENCRYPTION_KEY = "c3ludGhldGljLWJhY2t1cC1rZXktbm90LWEtcmVhbC1vbmU="
OLD_ENCRYPTION_KEY = "b2xkLXN5bnRoZXRpYy1iYWNrdXAta2V5LXJvdGF0ZWQtb3V0"
RENDERED = {"services": {
    "database": {"image": "postgres:17.6-alpine"},
    "api": {"environment": {"DATABASE_URL": "postgres://trainer_service:fixture@database:5432/trainer"}},
    "worker": {}, "web": {"ports": [{"host_ip": "127.0.0.1", "published": "3000"}]},
    "migrate": {}, "edge": {"image": "caddy:2.11.4-alpine"},
}}
VECTOR_ROW = {
    "id": "11111111-2222-4333-8444-555555555555", "request_id": "66666666-7777-4888-9999-000000000000",
    "action": "restart_service", "target": "api", "requested_by": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "issued_at_ms": 1790000000000, "expires_at_ms": 1790001800000, "reason": "Synthetic vector: restart the API",
    "signature": "d815af0aebe1d7e55e898e76c703084f01886655f630d35668b3b99be9e59c0d",
}


def runtime_env(root, **extra):
    values = {"PUBLIC_APP_URL": ENDPOINT, "POSTGRES_PASSWORD": "fixture", "MIGRATION_DATABASE_URL": "postgres://m",
              "DATABASE_URL": "postgres://r", "SECURITY_ENCRYPTION_KEY": ENCRYPTION_KEY,
              "INTERNAL_PROXY_SECRET": PROXY_SECRET, **extra}
    path = root / "runtime.env"
    path.write_text("\n".join(k + "=" + v for k, v in values.items()) + "\n")
    path.chmod(0o600)
    return values


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(host, "ROOT", self.root))
        self.stack.enter_context(patch.object(host, "docker", return_value=None))
        self.stack.enter_context(redirect_stdout(io.StringIO()))
        self.errors = io.StringIO()
        self.stack.enter_context(redirect_stderr(self.errors))
        for sha in (SHA, PREVIOUS):
            (self.root / "releases" / sha / "packages/db/migrations").mkdir(parents=True)
            for version in ("001_initial", "058_host_operations"):
                (self.root / "releases" / sha / "packages/db/migrations" / (version + ".sql")).write_text("--")
        common.atomic_json(self.root / "endpoint.json", {"url": ENDPOINT})
        (self.root / "Caddyfile").write_text("old configuration")
        self.calls = []
        self.fail_when = None

        def compose(release, sha, *args, **kwargs):
            self.calls.append((sha, args))
            if self.fail_when and self.fail_when(sha, args):
                raise subprocess.CalledProcessError(1, ["docker", "compose"])
            return SimpleNamespace(stdout=json.dumps(RENDERED))

        self.compose = self.stack.enter_context(patch.object(host, "compose", side_effect=compose))
        self.ready = self.stack.enter_context(patch.object(host, "wait_ready"))

    def state(self, **values):
        common.atomic_json(self.root / "release-state.json", values)

    def read_state(self):
        return json.loads((self.root / "release-state.json").read_text())


class EdgeTLS(Base):
    PROXY = "    reverse_proxy web:3000 {\n        header_up X-Forwarded-For {remote_host}\n    }\n"

    def test_legacy_edge_is_unchanged_without_ask(self):
        self.assertEqual(host.edge_config(ENDPOINT, SHA),
                         ENDPOINT + " {\n    encode zstd gzip\n    header X-GymMembership-Release " + SHA + "\n"
                         + self.PROXY + "}\n")

    def test_on_demand_edge_asks_the_api_and_keeps_platform_block(self):
        ask = host.edge_ask(runtime_env(self.root))
        self.assertEqual(ask, host.TLS_ASK_URL + ASK_TOKEN)
        config = host.edge_config(ENDPOINT, SHA, ask)
        self.assertTrue(config.startswith("{\n    on_demand_tls {\n        ask " + ask + "\n    }\n}\n"))
        self.assertIn(ENDPOINT + " {\n", config)
        self.assertIn("https:// {\n    tls {\n        on_demand\n    }\n", config)
        self.assertEqual(config.count(self.PROXY), 2)
        self.assertEqual(config.count("header X-GymMembership-Release " + SHA), 2)
        self.assertNotIn(PROXY_SECRET, config)
        for bad in ("http://evil.example/ask?token=" + ASK_TOKEN, host.TLS_ASK_URL + "zz", host.TLS_ASK_URL + ASK_TOKEN + "\n}"):
            with self.assertRaises(common.DeploymentError):
                host.edge_config(ENDPOINT, SHA, bad)

    def test_on_demand_can_be_disabled_and_needs_the_secret(self):
        self.assertIsNone(host.edge_ask(runtime_env(self.root, EDGE_ON_DEMAND_TLS="false")))
        self.assertIsNone(host.edge_ask({"INTERNAL_PROXY_SECRET": "short"}))
        self.assertIsNone(host.edge_ask({}))
        (self.root / "runtime.env").chmod(0o644)
        self.assertEqual(host.runtime_values(), {})

    def test_deploy_and_rollback_render_on_demand_edge(self):
        runtime_env(self.root)
        self.state(current=PREVIOUS)
        edges = []

        def failure(sha, args):
            if "--force-recreate" in args:
                edges.append((sha, (self.root / "Caddyfile").read_text()))
            return sha == SHA and "--force-recreate" in args

        self.fail_when = failure
        with patch.object(host, "approved_head", return_value=SHA), patch.object(host, "runtime_role"):
            with self.assertRaises(subprocess.CalledProcessError):
                host.deploy(SHA, Mock())
        self.assertEqual([sha for sha, _ in edges], [SHA, PREVIOUS])
        for sha, config in edges:
            self.assertIn("on_demand_tls", config)
            self.assertEqual(config.count("header X-GymMembership-Release " + sha + "\n" + self.PROXY), 2)

    def test_generated_caddyfiles_pass_real_caddy_validation(self):
        """Uses CADDY_BIN or caddy on PATH; in CI falls back to the pinned Caddy image."""
        caddy = os.environ.get("CADDY_BIN") or shutil.which("caddy")
        docker = shutil.which("docker")
        in_ci = os.environ.get("GITHUB_ACTIONS") == "true"
        if not caddy and not (in_ci and docker):
            self.skipTest("Caddy is unavailable; set CADDY_BIN to validate generated Caddyfiles locally")
        ask = host.TLS_ASK_URL + ASK_TOKEN
        for name, config in (("legacy", host.edge_config(ENDPOINT, SHA)),
                             ("on-demand", host.edge_config(ENDPOINT, SHA, ask)),
                             ("bootstrap", host.edge_config(ENDPOINT, ask=ask))):
            with self.subTest(name):
                path = self.root / ("Caddyfile." + name)
                path.write_text(config)
                path.chmod(0o644)
                if caddy:
                    command = [caddy, "validate", "--adapter", "caddyfile", "--config", str(path)]
                else:
                    command = [docker, "run", "--rm", "-v", str(path) + ":/etc/caddy/Caddyfile:ro",
                               host.EDGE_IMAGE, "caddy", "validate", "--adapter", "caddyfile",
                               "--config", "/etc/caddy/Caddyfile"]
                result = subprocess.run(command, capture_output=True, text=True, timeout=180,
                                        env={**os.environ, "XDG_DATA_HOME": str(self.root / "caddy-data"),
                                             "XDG_CONFIG_HOME": str(self.root / "caddy-config")})
                self.assertEqual(result.returncode, 0, result.stderr[-2000:])
                self.assertIn("Valid configuration", result.stdout + result.stderr)


class ReleaseServing(Base):
    def test_rollback_serves_previous_and_keeps_newest_controller(self):
        self.state(current=SHA, previous=PREVIOUS, deployed_at=1)
        self.assertTrue(host.switch_release(PREVIOUS))
        state = self.read_state()
        self.assertEqual((state["current"], state["previous"], state["serving"]), (SHA, PREVIOUS, PREVIOUS))
        up = [(sha, args) for sha, args in self.calls if args[0] == "up"]
        self.assertEqual(up, [(PREVIOUS, ("up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout",
                                          "180", "api", "web", "worker", "edge"))])
        self.ready.assert_any_call(ENDPOINT + "/api/v1/ready", expected_sha=PREVIOUS)
        self.assertIn("X-GymMembership-Release " + PREVIOUS, (self.root / "Caddyfile").read_text())
        # dispatch.py still runs the newest controller, which honours a deploy pause.
        script = self.root / "releases" / SHA / "infra/digitalocean/host.py"
        script.parent.mkdir(parents=True)
        script.write_text("# newest controller")
        self.assertEqual(dispatch.controller(self.root), script)
        self.assertFalse(host.switch_release(PREVIOUS))
        self.assertTrue(host.switch_release(SHA))
        self.assertNotIn("serving", self.read_state())

    def test_failed_switch_restores_the_serving_release(self):
        self.state(current=SHA, previous=PREVIOUS)
        self.fail_when = lambda sha, args: sha == PREVIOUS and args[0] == "up"
        with self.assertRaises(subprocess.CalledProcessError):
            host.switch_release(PREVIOUS)
        self.assertEqual([sha for sha, args in self.calls if args[0] == "up"], [PREVIOUS, SHA])
        self.assertEqual(self.read_state(), {"current": SHA, "previous": PREVIOUS})
        self.assertIn("X-GymMembership-Release " + SHA, (self.root / "Caddyfile").read_text())

    def test_switch_accepts_only_recorded_releases_on_disk(self):
        self.state(current=SHA, previous=PREVIOUS)
        for target in (OLDER, "../../x"):
            with self.assertRaises(common.DeploymentError):
                host.switch_release(target)
        shutil.rmtree(self.root / "releases" / PREVIOUS)
        with self.assertRaises(common.DeploymentError):
            host.switch_release(PREVIOUS)
        self.assertEqual(self.calls, [])

    def test_deploy_after_rollback_restores_and_records_the_serving_release(self):
        new = "d" * 40
        (self.root / "releases" / new).mkdir()
        self.state(current=SHA, previous=PREVIOUS, serving=PREVIOUS)
        with patch.object(host, "approved_head", return_value=new), patch.object(host, "runtime_role"):
            self.ready.side_effect = lambda url, **kw: (_ for _ in ()).throw(common.DeploymentError("bad")) \
                if kw.get("expected_sha") == new else None
            with self.assertRaises(common.DeploymentError):
                host.deploy(new, Mock())
            recreated = [sha for sha, args in self.calls if "--force-recreate" in args]
            self.assertEqual(recreated, [new, PREVIOUS])
            self.assertEqual(self.read_state()["serving"], PREVIOUS)
            self.ready.side_effect = None
            self.assertTrue(host.deploy(new, Mock()))
        state = self.read_state()
        self.assertEqual((state["current"], state["previous"]), (new, PREVIOUS))
        self.assertNotIn("serving", state)
        self.assertEqual(sorted(p.name for p in (self.root / "releases").iterdir()), sorted([new, PREVIOUS]))

    def test_paused_cycle_skips_deployment_but_runs_operations(self):
        operations = Mock()
        with patch.object(host, "operations_module", return_value=operations), \
                patch.object(host, "approved_head") as approved:
            host.set_deploy_pause(True, "operator", None)
            host.run_cycle()
            approved.assert_not_called()
            operations.before_deploy.assert_called_once()
            operations.after_deploy.assert_called_once_with(host, False)
            (self.root / host.DEPLOY_CONTROL).write_text("{not json")
            self.assertTrue(host.deploy_control()["paused"])
            host.set_deploy_pause(False, "operator", None)
            approved.return_value = None
            host.run_cycle()
            approved.assert_called_once()
        with self.assertRaises(common.DeploymentError):
            host.set_deploy_pause(True, "because", None)

    def test_failed_deployment_still_runs_upkeep_but_defers_the_backup(self):
        operations = Mock()
        with patch.object(host, "operations_module", return_value=operations), \
                patch.object(host, "approved_head", return_value=SHA), \
                patch.object(host, "deploy", side_effect=common.DeploymentError("bad readiness")):
            with self.assertRaises(common.DeploymentError):
                host.run_cycle()
        operations.after_deploy.assert_called_once_with(host, True)
        broken = Mock(side_effect=SyntaxError("broken module"))
        with patch.dict(sys.modules, {"hostops": None}):
            self.assertIsNone(host.operations_module())
        with patch("builtins.__import__", side_effect=lambda name, *a, **k: broken() if name == "hostops"
                   else __import__(name, *a, **k)):
            self.assertIsNone(host.operations_module())

    def test_operations_failures_never_block_deployment(self):
        self.state(current=SHA)
        runtime_env(self.root)
        with patch.object(host, "approved_head", return_value=SHA), \
                patch.object(hostops, "open_dump", side_effect=lambda h, sha: FakeProcess(b"", code=1)), \
                patch.object(hostops, "psql", side_effect=subprocess.CalledProcessError(1, "psql")):
            host.run_cycle()
        self.assertIn("operator actions were not processed", self.errors.getvalue())
        self.assertTrue((self.root / "host-status.json").is_file())

    def test_bootstrap_controller_without_hostops_still_deploys(self):
        with patch.object(host, "operations_module", return_value=None), \
                patch.object(host, "approved_head", return_value=None) as approved:
            host.run_cycle()
        approved.assert_called_once()


class FakeDatabase:
    """Records SQL sent through hostops.psql and answers the controller's queries."""
    def __init__(self, pending=(), running=()):
        self.pending, self.running, self.sql = list(pending), list(running), []

    def __call__(self, h, sql, database="trainer", timeout=300):
        self.sql.append((database, sql))
        if "to_regclass" in sql:
            return "t\n"
        if sql == hostops.RUNNING_SQL:
            return json.dumps(self.running)
        if sql == hostops.PENDING_SQL:
            return json.dumps(self.pending)
        match = re.search(r"WHERE id='([0-9a-f-]{36})' AND status='(\w+)' RETURNING id", sql)
        return (match.group(1) + "\n") if match else ""

    def decoded(self):
        texts = []
        for _, sql in self.sql:
            texts += [base64.b64decode(v).decode() for v in re.findall(r"decode\('([A-Za-z0-9+/=]*)','base64'\)", sql)]
        return texts


def signed_row(key, **changes):
    row = {"id": "0d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e", "request_id": "1d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
           "action": "pause_deploys", "target": None, "requested_by": "2d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
           "issued_at_ms": 1790000000000, "expires_at_ms": 1790001800000,
           "reason": "Synthetic: pause during maintenance", **changes}
    row["signature"] = hostops.sign(key, *hostops.action_canonical(row))
    return row


class OperatorActions(Base):
    def setUp(self):
        super().setUp()
        self.values = runtime_env(self.root)
        self.key = hostops.host_key(self.values)
        self.state(current=SHA, previous=PREVIOUS)

    def test_signature_vector_matches_the_api(self):
        key = hostops.host_key({"INTERNAL_PROXY_SECRET": PROXY_SECRET})
        now = VECTOR_ROW["issued_at_ms"] + 1000
        self.assertEqual(hostops.verify_request(dict(VECTOR_ROW), key, now), ("ok", ""))
        for change in ({"action": "rollback_release", "target": None}, {"target": "web"}, {"reason": "Other"},
                       {"expires_at_ms": VECTOR_ROW["expires_at_ms"] + 1}, {"requested_by": VECTOR_ROW["id"]}):
            self.assertEqual(hostops.verify_request({**VECTOR_ROW, **change}, key, now)[0], "rejected", change)
        self.assertEqual(hostops.verify_request(dict(VECTOR_ROW), key, VECTOR_ROW["expires_at_ms"])[0], "expired")
        self.assertEqual(hostops.verify_request(dict(VECTOR_ROW), key, VECTOR_ROW["issued_at_ms"] - 600000)[0],
                         "rejected")
        other = hostops.host_key({"INTERNAL_PROXY_SECRET": "another-synthetic-secret-of-at-least-32-bytes"})
        self.assertEqual(hostops.verify_request(dict(VECTOR_ROW), other, now)[0], "rejected")
        unlisted = signed_row(key, action="shell", target=None)
        self.assertEqual(hostops.verify_request(unlisted, key, now)[0], "rejected")
        with self.assertRaises(common.DeploymentError):
            hostops.host_key({"INTERNAL_PROXY_SECRET": "short"})

    def test_actions_are_verified_executed_and_reported_with_signed_results(self):
        now = 1790000001000
        valid = signed_row(self.key)
        forged = {**signed_row(self.key, id="3d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
                               request_id="4d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e"), "action": "backup_now"}
        expired = signed_row(self.key, id="5d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
                             request_id="6d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
                             issued_at_ms=now - 3600000, expires_at_ms=now - 1)
        interrupted = "7d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e"
        database = FakeDatabase([valid, forged, expired], [interrupted])
        with patch.object(hostops, "psql", side_effect=database):
            handled = hostops.process_actions(host, self.values, self.key, now_ms=now)
        self.assertEqual(handled, [(valid["id"], "succeeded"), (forged["id"], "rejected"),
                                   (expired["id"], "expired")])
        self.assertTrue(host.deploy_control()["paused"])
        self.assertEqual(host.deploy_control()["request_id"], valid["id"])
        updates = [sql for _, sql in database.sql if sql.startswith("BEGIN")]
        self.assertEqual(len(updates), 5)
        self.assertIn("WHERE id='" + interrupted + "' AND status='running'", updates[0])
        self.assertIn("status='running'", updates[1])
        success = updates[2]
        result = next(t for t in database.decoded() if t.startswith('{"details":{"paused":true}'))
        self.assertIn("result_signature='" + hostops.sign(self.key, "gymmembership-host-result-v1", valid["id"],
                                                          "succeeded", result) + "'", success)
        self.assertIn("'infrastructure.host_action.succeeded'", success)
        for _, sql in database.sql:
            # Reasons and results reach SQL only as base64 text.
            self.assertNotIn("maintenance", sql)
        self.assertEqual(self.calls, [])

    def test_restart_rollback_and_resume_execute_allowlisted_commands(self):
        restart = signed_row(self.key, action="restart_service", target="web")
        with patch.object(hostops, "psql", side_effect=FakeDatabase([restart])):
            hostops.process_actions(host, self.values, self.key, now_ms=1790000001000)
        self.assertEqual(self.calls, [(SHA, ("up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout",
                                             "180", "web"))])
        self.ready.assert_any_call(ENDPOINT + "/api/v1/ready", expected_sha=SHA)
        self.calls.clear()
        rollback = signed_row(self.key, action="rollback_release", id="8d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e")
        with patch.object(hostops, "psql", side_effect=FakeDatabase([rollback])):
            self.assertEqual(hostops.process_actions(host, self.values, self.key, now_ms=1790000001000),
                             [(rollback["id"], "succeeded")])
        self.assertEqual(self.read_state()["serving"], PREVIOUS)
        self.assertEqual(host.deploy_control()["reason"], "rollback")
        again = signed_row(self.key, action="rollback_release", id="9d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e")
        database = FakeDatabase([again])
        with patch.object(hostops, "psql", side_effect=database):
            self.assertEqual(hostops.process_actions(host, self.values, self.key, now_ms=1790000001000),
                             [(again["id"], "failed")])
        self.assertIn("The previous release is already serving", " ".join(database.decoded()))
        restore = signed_row(self.key, action="restore_release", id="ad3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e")
        resume = signed_row(self.key, action="resume_deploys", id="bd3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e")
        with patch.object(hostops, "psql", side_effect=FakeDatabase([restore, resume])):
            hostops.process_actions(host, self.values, self.key, now_ms=1790000001000)
        self.assertNotIn("serving", self.read_state())
        self.assertFalse(host.deploy_control()["paused"])

    def test_canceled_request_is_not_executed(self):
        row = signed_row(self.key, action="restart_service", target="api")
        database = FakeDatabase([row])
        original = database.__call__

        def canceled(h, sql, **kwargs):
            output = original(h, sql, **kwargs)
            return "" if "status='running'" in sql and "SET" in sql else output

        with patch.object(hostops, "psql", side_effect=canceled):
            self.assertEqual(hostops.process_actions(host, self.values, self.key, now_ms=1790000001000), [])
        self.assertEqual(self.calls, [])

    def test_transition_rejects_unexpected_identifiers(self):
        for args in (("x'; DROP TABLE users; --", "pending", "running"), (VECTOR_ROW["id"], "pending", "done")):
            with self.assertRaises(common.DeploymentError):
                hostops.transition(host, self.key, *args)


class FakeProcess:
    def __init__(self, stdout=b"", code=0):
        self.stdout = io.BytesIO(stdout)
        self.stdin = io.BytesIO()
        self.stdin.close = lambda: None
        self.code = code

    def wait(self, timeout=None):
        return self.code

    def poll(self):
        return self.code

    def kill(self):
        pass


DUMP = b"PGDMP" + os.urandom(300000)


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL is required for the backup round trip")
class Backups(Base):
    def setUp(self):
        super().setUp()
        self.values = runtime_env(self.root)
        self.state(current=SHA, previous=PREVIOUS)
        self.dump = self.stack.enter_context(patch.object(hostops, "open_dump", side_effect=lambda h, sha: FakeProcess(DUMP)))
        self.directory = hostops.backup_dir(host)

    def decrypt(self, path, values=None):
        key = hostops.backup_keys(values or self.values)[0]
        result = subprocess.run(["openssl", "enc", "-d", *hostops.CIPHER, "-pass", "env:GM_BACKUP_PASSPHRASE",
                                 "-in", str(path)], capture_output=True,
                                env={"PATH": os.environ["PATH"], "GM_BACKUP_PASSPHRASE": key["passphrase"]})
        self.assertEqual(result.returncode, 0)
        return result.stdout

    def test_backup_is_encrypted_checksummed_private_and_decryptable(self):
        record = hostops.run_backup(host, self.values, "scheduled", now=1790000000)
        dump = self.directory / (record["name"] + ".dump.enc")
        self.assertEqual(record["name"], "20260921T141320Z")
        data = dump.read_bytes()
        self.assertNotIn(DUMP[5:4096], data)
        self.assertTrue(data.startswith(b"Salted__"))
        self.assertEqual(dump.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(record["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(record["plainSha256"], hashlib.sha256(DUMP).hexdigest())
        mac = hostops.backup_keys(self.values)[0]["mac"]
        self.assertEqual(record["hmacSha256"], hmac.new(mac, data, hashlib.sha256).hexdigest())
        self.assertEqual(self.decrypt(dump), DUMP)
        self.assertEqual(record["offsite"], {"status": "not_configured"})
        self.assertNotIn(ENCRYPTION_KEY, json.dumps(record))
        self.assertEqual(hostops.list_backups(self.directory)[0]["name"], record["name"])
        # A second backup in the same second gets a distinct name.
        second = hostops.run_backup(host, self.values, "manual", now=1790000000)
        self.assertEqual(second["name"], record["name"] + "-1")

    def test_failed_or_invalid_dumps_leave_nothing_and_record_the_failure(self):
        for process in (FakeProcess(DUMP, code=1), FakeProcess(b"not a custom archive"), FakeProcess(b"")):
            self.dump.side_effect = lambda h, sha, process=process: process
            with self.assertRaises(common.DeploymentError):
                hostops.backup_with_state(host, self.values, "manual")
            self.assertEqual([p.name for p in self.directory.iterdir()], ["state.json"])
        state = hostops.load_state(self.directory)
        self.assertIn("no backup was recorded", state["lastFailure"]["message"])
        with self.assertRaises(common.DeploymentError):
            hostops.run_backup(host, {**self.values, "SECURITY_ENCRYPTION_KEY": ""}, "manual")
        with patch.object(hostops.shutil, "disk_usage", return_value=SimpleNamespace(free=10 << 20)):
            with self.assertRaises(common.DeploymentError) as raised:
                hostops.run_backup(host, self.values, "manual")
        self.assertIn("free disk space", str(raised.exception))

    def test_retention_keeps_the_newest_complete_backups(self):
        values = {**self.values, "BACKUP_KEEP": "3"}
        names = [hostops.run_backup(host, values, "scheduled", now=1790000000 + i * 86400)["name"] for i in range(5)]
        (self.directory / "manual-notes.txt").write_text("kept")
        (self.directory / "20200101T000000Z.dump.enc").write_text("orphan without metadata")
        hostops.prune_backups(self.directory, 3)
        self.assertEqual([r["name"] for r in hostops.list_backups(self.directory)], names[::-1][:3])
        self.assertTrue((self.directory / "manual-notes.txt").exists())
        self.assertTrue((self.directory / "20200101T000000Z.dump.enc").exists())

    def test_schedule_defers_after_deploy_backs_off_after_failure_and_respects_interval(self):
        day = 86400
        self.assertIsNone(hostops.scheduled_backup(host, self.values, deployed=True, now=1790000000))
        first = hostops.scheduled_backup(host, self.values, deployed=False, now=1790000000)
        self.assertIsNotNone(first)
        self.assertIsNone(hostops.scheduled_backup(host, self.values, deployed=False, now=1790000000 + 3600))
        self.dump.side_effect = lambda h, sha: FakeProcess(b"", code=1)
        with self.assertRaises(common.DeploymentError):
            hostops.scheduled_backup(host, self.values, deployed=False, now=1790000000 + day)
        failure_at = hostops.parse_iso(hostops.load_state(self.directory)["lastFailure"]["at"])
        self.assertIsNone(hostops.scheduled_backup(host, self.values, deployed=False, now=failure_at + 60))
        self.dump.side_effect = lambda h, sha: FakeProcess(DUMP)
        self.assertIsNotNone(hostops.scheduled_backup(host, self.values, deployed=False, now=failure_at + 3601))
        self.assertIsNone(hostops.load_state(self.directory)["lastFailure"])
        hourly = {**self.values, "BACKUP_INTERVAL_HOURS": "6"}
        latest = hostops.parse_iso(hostops.list_backups(self.directory)[0]["createdAt"])
        self.assertIsNotNone(hostops.scheduled_backup(host, hourly, deployed=False, now=latest + 6 * 3600))
        self.assertEqual(hostops.backup_settings({"BACKUP_INTERVAL_HOURS": "0", "BACKUP_KEEP": "x"})["keep"], 7)

    def test_restore_check_decrypts_into_a_scratch_database_and_verifies_it(self):
        record = hostops.run_backup(host, self.values, "scheduled", now=1790000000)
        restored = []

        def restore(h, sha, database):
            process = FakeProcess()
            restored.append((sha, database, process))
            return process

        facts = {"migrations": ["001_initial", "058_host_operations"], "tables": 80, "users": 3, "tenants": 2}
        database = FakeDatabase()

        def psql(h, sql, **kwargs):
            database(h, sql, **kwargs)
            return json.dumps(facts) if sql == hostops.VERIFY_SQL else ""

        with patch.object(hostops, "open_restore", side_effect=restore), patch.object(hostops, "psql", side_effect=psql):
            result = hostops.verify_with_state(host, self.values)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["backup"], record["name"])
        (sha, scratch, process), = restored
        self.assertEqual(sha, SHA)
        self.assertRegex(scratch, r"^restore_check_[0-9a-f]{12}$")
        self.assertEqual(process.stdin.getvalue(), DUMP)
        statements = [(db, sql) for db, sql in database.sql]
        self.assertEqual(statements[0], ("postgres", "CREATE DATABASE " + scratch + ";"))
        self.assertEqual(statements[1], (scratch, hostops.VERIFY_SQL))
        self.assertEqual(statements[-1], ("postgres", "DROP DATABASE IF EXISTS " + scratch + " WITH (FORCE);"))
        self.assertTrue(hostops.load_state(self.directory)["lastVerification"]["ok"])
        # A migration unknown to this release fails verification; the scratch copy is still dropped.
        facts["migrations"].append("999_future")
        with patch.object(hostops, "open_restore", side_effect=restore), patch.object(hostops, "psql", side_effect=psql):
            result = hostops.verify_with_state(host, self.values)
        self.assertFalse(result["ok"])
        self.assertIn("999_future", result["message"])
        self.assertTrue(database.sql[-1][1].startswith("DROP DATABASE"))

    def test_tampered_or_foreign_key_backups_fail_before_any_restore(self):
        record = hostops.run_backup(host, self.values, "scheduled", now=1790000000)
        dump = self.directory / (record["name"] + ".dump.enc")
        database = FakeDatabase()
        with patch.object(hostops, "psql", side_effect=database), patch.object(hostops, "open_restore") as restore:
            data = bytearray(dump.read_bytes())
            data[-1] ^= 1
            dump.write_bytes(bytes(data))
            result = hostops.verify_with_state(host, self.values)
            self.assertFalse(result["ok"])
            self.assertIn("checksum", result["message"])
            # Checksum recomputed by someone without the key: the keyed tag still fails.
            meta = json.loads((self.directory / (record["name"] + ".json")).read_text())
            meta["sha256"] = hashlib.sha256(bytes(data)).hexdigest()
            (self.directory / (record["name"] + ".json")).write_text(json.dumps(meta))
            self.assertIn("authentication", hostops.verify_with_state(host, self.values)["message"])
            restore.assert_not_called()
        self.assertEqual(database.sql, [])

    def test_backups_remain_restorable_after_key_rotation(self):
        old = {**self.values, "SECURITY_ENCRYPTION_KEY": OLD_ENCRYPTION_KEY}
        record = hostops.run_backup(host, old, "scheduled", now=1790000000)
        rotated = {**self.values, "SECURITY_ENCRYPTION_PREVIOUS_KEYS": OLD_ENCRYPTION_KEY}
        keys = hostops.backup_keys(rotated)
        self.assertEqual(keys[1]["id"], record["keyId"])
        self.assertEqual(hostops.verify_backup_file(self.directory, record, keys)["id"], record["keyId"])
        self.assertEqual(self.decrypt(self.directory / (record["name"] + ".dump.enc"), old), DUMP)
        with self.assertRaises(common.DeploymentError):
            hostops.verify_backup_file(self.directory, record, hostops.backup_keys(self.values))


class StorageServer(BaseHTTPRequestHandler):
    objects, requests, status = {}, [], 200

    def log_message(self, *args):
        pass

    def do_PUT(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        type(self).requests.append(("PUT", self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        if type(self).status == 200:
            type(self).objects[self.path] = body
        self.send_response(type(self).status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        type(self).requests.append(("HEAD", self.path, {k.lower(): v for k, v in self.headers.items()}, b""))
        body = type(self).objects.get(self.path)
        self.send_response(200 if body is not None else 404)
        self.send_header("Content-Length", str(len(body or b"")))
        self.end_headers()


@unittest.skipUnless(shutil.which("openssl"), "OpenSSL is required for the backup round trip")
class OffServerCopies(Base):
    def setUp(self):
        super().setUp()
        self.state(current=SHA)
        StorageServer.objects, StorageServer.requests, StorageServer.status = {}, [], 200
        self.stack.enter_context(patch.dict(os.environ, {"NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"}))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), StorageServer)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.settings = {"endpoint": "http://127.0.0.1:" + str(self.server.server_port), "bucket": "fixture-bucket",
                         "region": "blr1", "prefix": "gymmembership/backups/", "access_key": "FIXTUREACCESSKEY",
                         "secret_key": "fixture-secret-access-key"}
        self.stack.enter_context(patch.object(hostops, "open_dump", side_effect=lambda h, sha: FakeProcess(DUMP)))

    def test_signature_version_4_matches_published_vectors(self):
        empty = hashlib.sha256(b"").hexdigest()
        self.assertTrue(hostops.sigv4_authorization(
            "GET", "https://example.amazonaws.com/", {"Host": "example.amazonaws.com", "X-Amz-Date": "20150830T123600Z"},
            empty, "us-east-1", "service", "20150830T123600Z", "AKIDEXAMPLE",
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY").endswith(
            "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"))
        self.assertTrue(hostops.sigv4_authorization(
            "GET", "https://examplebucket.s3.amazonaws.com/test.txt",
            {"Host": "examplebucket.s3.amazonaws.com", "Range": "bytes=0-9", "x-amz-content-sha256": empty,
             "x-amz-date": "20130524T000000Z"}, empty, "us-east-1", "s3", "20130524T000000Z",
            "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY").endswith(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"))
        body = hashlib.sha256(b"Welcome to Amazon S3.").hexdigest()
        self.assertTrue(hostops.sigv4_authorization(
            "PUT", "https://examplebucket.s3.amazonaws.com/test%24file.text",
            {"Host": "examplebucket.s3.amazonaws.com", "Date": "Fri, 24 May 2013 00:00:00 GMT",
             "x-amz-content-sha256": body, "x-amz-date": "20130524T000000Z",
             "x-amz-storage-class": "REDUCED_REDUNDANCY"}, body, "us-east-1", "s3", "20130524T000000Z",
            "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY").endswith(
            "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"))

    def test_upload_sends_signed_encrypted_dump_and_metadata_then_confirms_size(self):
        values = runtime_env(self.root)
        with patch.object(hostops, "offsite_settings", return_value=self.settings):
            record = hostops.run_backup(host, values, "scheduled", now=1790000000)
        self.assertEqual(record["offsite"]["status"], "uploaded")
        self.assertEqual(hostops.location(record), "local+offsite")
        key = "/fixture-bucket/gymmembership/backups/" + record["name"]
        methods = [(m, p) for m, p, _, _ in StorageServer.requests]
        self.assertEqual(methods, [("PUT", key + ".dump.enc"), ("PUT", key + ".json"), ("HEAD", key + ".dump.enc")])
        _, _, headers, body = StorageServer.requests[0]
        self.assertEqual(body, (self.directory() / (record["name"] + ".dump.enc")).read_bytes())
        self.assertEqual(headers["x-amz-content-sha256"], record["sha256"])
        self.assertRegex(headers["authorization"], r"^AWS4-HMAC-SHA256 Credential=FIXTUREACCESSKEY/\d{8}/blr1/s3/"
                         r"aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$")
        metadata = json.loads(StorageServer.requests[1][3])
        self.assertEqual(metadata["sha256"], record["sha256"])
        self.assertNotIn("offsite", metadata)
        for _, _, _, sent in StorageServer.requests:
            self.assertNotIn(DUMP[5:4096], sent)
        stored = json.loads((self.directory() / (record["name"] + ".json")).read_text())
        self.assertEqual(stored["offsite"]["status"], "uploaded")

    def directory(self):
        return hostops.backup_dir(host)

    def test_storage_failure_keeps_the_local_backup_and_retries_hourly(self):
        values = runtime_env(self.root)
        StorageServer.status = 403
        with patch.object(hostops, "offsite_settings", return_value=self.settings):
            record = hostops.run_backup(host, values, "scheduled", now=1790000000)
            self.assertEqual(record["offsite"]["status"], "failed")
            self.assertEqual(record["offsite"]["error"], "Storage request failed with HTTP 403")
            self.assertEqual(hostops.location(record), "local")
            self.assertTrue((self.directory() / (record["name"] + ".dump.enc")).is_file())
            StorageServer.status = 200
            now = hostops.parse_iso(record["createdAt"]) + 600
            hostops.scheduled_backup(host, values, deployed=False, now=now)
            self.assertEqual(hostops.list_backups(self.directory())[0]["offsite"]["status"], "uploaded")
            requests = len(StorageServer.requests)
            hostops.scheduled_backup(host, values, deployed=False, now=now + 60)
            self.assertEqual(len(StorageServer.requests), requests)
        self.assertNotIn("fixture-secret-access-key", self.errors.getvalue())

    def test_offsite_settings_are_optional_and_validated(self):
        base = {"BACKUP_S3_ENDPOINT": "https://blr1.digitaloceanspaces.com", "BACKUP_S3_BUCKET": "gm-backups",
                "BACKUP_S3_REGION": "blr1", "BACKUP_S3_ACCESS_KEY_ID": "DO00FIXTUREKEY",
                "BACKUP_S3_SECRET_ACCESS_KEY": "fixture-secret-value"}
        self.assertIsNone(hostops.offsite_settings({}))
        settings = hostops.offsite_settings(base)
        self.assertEqual((settings["endpoint"], settings["prefix"]), (base["BACKUP_S3_ENDPOINT"], "gymmembership/backups/"))
        for change in ({"BACKUP_S3_BUCKET": ""}, {"BACKUP_S3_ENDPOINT": "http://blr1.digitaloceanspaces.com"},
                       {"BACKUP_S3_ENDPOINT": "https://user:pw@example.test"}, {"BACKUP_S3_BUCKET": "Bad_Bucket"},
                       {"BACKUP_S3_PREFIX": "../escape/"}, {"BACKUP_S3_ENDPOINT": "https://example.test/path"}):
            self.assertEqual(hostops.offsite_settings({**base, **change}), "invalid", change)
        summary = hostops.backup_summary(host, {**base, "BACKUP_S3_REGION": ""})
        self.assertEqual(summary["policy"]["offsite"], "invalid")


class HostReport(Base):
    def test_report_is_signed_bounded_and_matches_the_api_shape(self):
        values = runtime_env(self.root)
        self.state(current=SHA, previous=PREVIOUS, deployed_at=1790000000)
        host.set_deploy_pause(True, "operator", None)
        lines = "\n".join(json.dumps({"Service": s, "State": "running", "Health": "healthy" if s == "api" else "",
                                      "ExitCode": 0}) for s in ("database", "api", "web", "worker", "edge"))
        self.compose.side_effect = lambda release, sha, *args, **kwargs: SimpleNamespace(stdout=lines)
        report = hostops.build_report(host, values)
        self.assertEqual(report["version"], 1)
        self.assertTrue(report["edge"]["onDemandTls"])
        self.assertEqual(report["deploy"]["current"], SHA)
        self.assertTrue(report["deploy"]["paused"])
        self.assertEqual(report["deploy"]["pausedReason"], "operator")
        self.assertEqual([c["service"] for c in report["containers"]], ["database", "api", "web", "worker", "edge"])
        self.assertEqual(report["containers"][1]["health"], "healthy")
        self.assertIsNone(report["containers"][0]["health"])
        self.assertEqual(report["backups"]["policy"], {"intervalHours": 24, "keep": 7, "offsite": "not_configured"})
        self.assertIsNone(report["backups"]["latest"])
        self.assertIsInstance(report["host"]["disks"], list)
        self.assertEqual(report["host"]["disks"][0]["mount"], "/")
        database = FakeDatabase()
        with patch.object(hostops, "psql", side_effect=database):
            self.assertTrue(hostops.write_report(host, hostops.host_key(values), report))
        payload = next(t for t in database.decoded() if t.startswith("{"))
        self.assertEqual(json.loads(payload), report)
        sql = database.sql[-1][1]
        self.assertIn("'" + hostops.sign(hostops.host_key(values), "gymmembership-host-status-v1", "controller",
                                         payload) + "'", sql)
        self.assertNotIn(PROXY_SECRET, sql)
        self.assertNotIn(ENCRYPTION_KEY, payload)
        self.assertEqual((self.root / "host-status.json").stat().st_mode & 0o777, 0o600)
        # Compose v2 may also print a JSON array.
        self.compose.side_effect = lambda release, sha, *args, **kwargs: SimpleNamespace(
            stdout=json.dumps([{"Service": "migrate", "State": "exited", "ExitCode": 1}]))
        self.assertEqual(hostops.container_status(host, SHA),
                         [{"service": "migrate", "state": "exited", "health": None, "exitCode": 1}])
        self.compose.side_effect = subprocess.CalledProcessError(1, "docker")
        self.assertIsNone(hostops.container_status(host, SHA))

    def test_report_is_skipped_quietly_before_the_migration(self):
        values = runtime_env(self.root)
        self.state(current=SHA)
        database = FakeDatabase()
        database_call = database.__call__

        def old_schema(h, sql, **kwargs):
            return "f\n" if "to_regclass" in sql else database_call(h, sql, **kwargs)

        with patch.object(hostops, "psql", side_effect=old_schema):
            self.assertFalse(hostops.write_report(host, hostops.host_key(values), hostops.build_report(host, values)))
            self.assertEqual(hostops.process_actions(host, values, hostops.host_key(values)), [])

    def test_controller_release_is_read_from_the_release_path(self):
        with patch.object(hostops, "__file__", "/opt/gymmembership/releases/" + SHA + "/infra/digitalocean/hostops.py"):
            self.assertEqual(hostops.controller_release(), SHA)
        with patch.object(hostops, "__file__", "/opt/gymmembership/hostops.py"):
            self.assertIsNone(hostops.controller_release())


class CloudInit(unittest.TestCase):
    def test_bootstrap_payload_stays_within_the_user_data_limit(self):
        import provision
        config = json.loads((provision.HERE / "launch.json").read_text())
        data = provision.cloud_config(config, "ef0f9c84-bfea-4c29-bd41-b61c6e91f2a2", SHA)
        self.assertLess(len(data.encode()), 64 * 1024)
        self.assertNotIn("hostops.py", data)


if __name__ == "__main__":
    unittest.main()
