"""Platform address change: DNS verification, runtime.env rewrite, old-name redirect and rollback.

No Docker, DNS, certificate authority or network is used: compose, readiness,
resolvers and the certificate probe are replaced; files are real (a temporary
/opt/gymmembership) so preservation and permissions are checked on disk.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import common  # noqa: E402
import host  # noqa: E402
import hostops  # noqa: E402
from test_hostops_deployment import (  # noqa: E402
    ASK_TOKEN, ENDPOINT, PREVIOUS, PROXY_SECRET, SHA, Base, FakeDatabase, signed_row)

SERVER = "1.1.1.1"
NEW = "https://trainsyou.com"
ROOT_DOMAIN = "trainsyou.com"
OLD_HOST = "gymmembership.1.1.1.1.sslip.io"
CERTIFICATE = {"host": "trainsyou.com", "notAfter": "2026-12-27T00:00:00Z", "issuer": "Let's Encrypt"}
# Comments, blank lines, an unrelated duplicate and a value containing "=" must survive byte for byte.
RUNTIME = ("# GymMembership runtime settings (fixture)\n"
           "PUBLIC_APP_URL=" + ENDPOINT + "\n"
           "POSTGRES_PASSWORD=fixture\n"
           "MIGRATION_DATABASE_URL=postgres://m\n"
           "DATABASE_URL=postgres://r?sslmode=disable&x=1\n"
           "\n"
           "SECURITY_ENCRYPTION_KEY=c3ludGhldGljLWJhY2t1cC1rZXktbm90LWEtcmVhbC1vbmU=\n"
           "INTERNAL_PROXY_SECRET=" + PROXY_SECRET + "\n"
           "#PUBLIC_APP_URL=https://commented.example.test\n"
           "STRIPE_WEBHOOK_SECRET=whsec_fixture=with=equals\n"
           "LEGAL_APPROVED=false\n")
# Parameters exactly as the API serialises them (apps/api/src/host-operations.ts).
PARAMETERS = json.dumps({"url": NEW, "rootDomain": ROOT_DOMAIN}, separators=(",", ":"))


class AddressBase(Base):
    def setUp(self):
        super().setUp()
        path = self.root / "runtime.env"
        path.write_text(RUNTIME)
        path.chmod(0o600)
        self.values = host.runtime_values()
        self.key = hostops.host_key(self.values)
        self.state(current=SHA, previous=PREVIOUS)
        common.atomic_json(self.root / "endpoint.json", {"url": ENDPOINT, "ip": SERVER})
        # The edge the serving release renders today, as the timer cycle wrote it.
        self.before_caddyfile = host.edge_config(ENDPOINT, SHA, host.edge_ask(self.values), host.edge_root(self.values))
        (self.root / "Caddyfile").write_text(self.before_caddyfile)
        self.stack.enter_context(patch.object(host, "metadata", return_value=SERVER))
        self.resolved = {NEW[8:]: [SERVER]}
        self.stack.enter_context(patch.object(hostops, "system_ipv4",
                                              side_effect=lambda name: self.resolved.get(
                                                  name, [SERVER] if name.endswith("." + ROOT_DOMAIN) else [])))
        self.public = self.stack.enter_context(patch.object(hostops, "public_ipv4", return_value=None))
        self.certificate = self.stack.enter_context(patch.object(hostops, "certificate_check",
                                                                 return_value=CERTIFICATE))
        self.redirect = self.stack.enter_context(patch.object(hostops, "redirect_check", return_value=True))
        self.database = FakeDatabase()

    def request(self, parameters=PARAMETERS, **changes):
        now = int(time.time() * 1000)
        return signed_row(self.key, action="change_platform_address", parameters=parameters,
                          issued_at_ms=now, expires_at_ms=now + 1800000,
                          reason="Synthetic: move the platform to its own domain", **changes)

    def run_request(self, row):
        self.database.pending = [row]
        with patch.object(hostops, "psql", side_effect=self.database):
            handled = hostops.process_actions(host, self.values, self.key)
        results = [t for t in self.database.decoded() if t.startswith('{"details"')]
        return handled, json.loads(results[-1]) if results else None

    def runtime_bytes(self):
        return (self.root / "runtime.env").read_bytes()

    def mode(self, path):
        return stat.S_IMODE(path.stat().st_mode)


class Rendering(AddressBase):
    def test_caddyfile_is_byte_identical_when_the_action_is_never_used(self):
        """The exact text the previous controller rendered, for every edge variant."""
        proxy = "    reverse_proxy web:3000 {\n        header_up X-Forwarded-For {remote_host}\n    }\n"
        site = "    encode zstd gzip\n    header X-GymMembership-Release " + SHA + "\n" + proxy
        ask = host.TLS_ASK_URL + ASK_TOKEN
        self.assertEqual(host.edge_config(ENDPOINT, SHA), ENDPOINT + " {\n" + site + "}\n")
        self.assertEqual(host.edge_config(ENDPOINT, SHA, ask),
                         "{\n    on_demand_tls {\n        ask " + ask + "\n    }\n}\n\n" + ENDPOINT + " {\n" + site
                         + "}\n\nhttps:// {\n    tls {\n        on_demand\n    }\n" + site + "}\n")
        self.assertEqual(host.edge_config(NEW, SHA, ask, ROOT_DOMAIN),
                         "{\n    on_demand_tls {\n        ask " + ask + "\n    }\n}\n\n" + NEW + " {\n" + site
                         + "}\n\n*.trainsyou.com {\n    tls {\n        on_demand\n    }\n"
                         "    @www host www.trainsyou.com\n    redir @www https://trainsyou.com{uri} 308\n" + site
                         + "}\n\nhttps:// {\n    tls {\n        on_demand\n    }\n" + site + "}\n")
        self.assertEqual(host.edge_moved(), ())
        # Deployments and re-applies render the same bytes without the state file.
        self.assertFalse((self.root / host.MOVED).exists())
        host.reapply_release()
        self.assertEqual((self.root / "Caddyfile").read_text(), self.before_caddyfile)
        self.assertEqual(hostops.edge_state(host, self.values, ENDPOINT, SHA)["pendingReapply"], False)

    def test_former_names_redirect_permanently_and_bad_names_are_dropped(self):
        ask = host.TLS_ASK_URL + ASK_TOKEN
        moved = (OLD_HOST, OLD_HOST, "trainsyou.com", "bad name", "10.0.0.1", "old.example.test")
        config = host.edge_config(NEW, SHA, ask, ROOT_DOMAIN, moved)
        redirect = "\nhttps://{} {{\n    redir " + NEW + "{{uri}} 308\n}}\n"
        self.assertIn(redirect.format(OLD_HOST), config)
        self.assertIn(redirect.format("old.example.test"), config)
        self.assertEqual(config.count("redir " + NEW + "{uri} 308"), 2, "duplicates and the endpoint itself skipped")
        self.assertNotIn("bad name", config)
        self.assertNotIn("10.0.0.1", config)
        legacy = host.edge_config(NEW, SHA, moved=[OLD_HOST])
        self.assertTrue(legacy.endswith("}\n" + redirect.format(OLD_HOST)))
        for text in ("[", "{}", '{"redirectFrom": "x.example.test"}', '{"redirectFrom": [1, "a.example.test"]}'):
            (self.root / host.MOVED).write_text(text)
            self.assertEqual(host.edge_moved(), ("a.example.test",) if "a.example" in text else ())

    def test_redirect_caddyfiles_pass_real_caddy_validation(self):
        caddy = os.environ.get("CADDY_BIN") or shutil.which("caddy")
        if not caddy:
            self.skipTest("Caddy is unavailable; set CADDY_BIN to validate generated Caddyfiles locally")
        ask = host.TLS_ASK_URL + ASK_TOKEN
        for name, config in (("moved-on-demand", host.edge_config(NEW, SHA, ask, ROOT_DOMAIN, [OLD_HOST])),
                             ("moved-legacy", host.edge_config(NEW, SHA, moved=[OLD_HOST, "old.example.test"]))):
            with self.subTest(name):
                path = self.root / ("Caddyfile." + name)
                path.write_text(config)
                result = subprocess.run([caddy, "validate", "--adapter", "caddyfile", "--config", str(path)],
                                        capture_output=True, text=True, timeout=180,
                                        env={**os.environ, "XDG_DATA_HOME": str(self.root / "caddy-data"),
                                             "XDG_CONFIG_HOME": str(self.root / "caddy-config")})
                self.assertEqual(result.returncode, 0, result.stderr[-2000:])


class Requests(AddressBase):
    def test_parameters_are_signed_and_required_only_for_the_address_change(self):
        now = int(time.time() * 1000)
        row = self.request()
        self.assertEqual(hostops.action_canonical(row)[0], "gymmembership-host-action-v2")
        self.assertEqual(hostops.verify_request(row, self.key, now), ("ok", ""))
        tampered = {**row, "parameters": PARAMETERS.replace("trainsyou.com", "evil.example")}
        self.assertEqual(hostops.verify_request(tampered, self.key, now)[0], "rejected")
        missing = {**row, "parameters": None}
        self.assertEqual(hostops.verify_request(missing, self.key, now),
                         ("rejected", "The action parameters are not allowed"))
        extra = signed_row(self.key, action="backup_now", parameters=PARAMETERS, issued_at_ms=now,
                           expires_at_ms=now + 1800000)
        self.assertEqual(hostops.verify_request(extra, self.key, now)[0], "rejected")
        # Requests without parameters keep the original v1 canonical form.
        self.assertEqual(hostops.action_canonical(signed_row(self.key))[0], "gymmembership-host-action-v1")

    def test_signature_vector_with_parameters_matches_the_api(self):
        """The same fixed vector is asserted in tests/platform-address.test.ts."""
        row = {"id": "11111111-2222-4333-8444-555555555555", "request_id": "66666666-7777-4888-9999-000000000000",
               "action": "change_platform_address", "target": None,
               "requested_by": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "issued_at_ms": 1790000000000,
               "expires_at_ms": 1790001800000, "reason": "Synthetic vector: move the platform address",
               "parameters": '{"url":"https://trainsyou.com","rootDomain":"trainsyou.com"}'}
        key = hostops.host_key({"INTERNAL_PROXY_SECRET": PROXY_SECRET})
        row["signature"] = VECTOR_SIGNATURE
        self.assertEqual(hostops.verify_request(row, key, row["issued_at_ms"] + 1000), ("ok", ""))
        self.assertEqual(hostops.verify_request({**row, "parameters": row["parameters"] + " "}, key,
                                                row["issued_at_ms"] + 1000)[0], "rejected")

    def test_malformed_parameters_fail_without_changes(self):
        for parameters in ('{"url":"http://trainsyou.com"}', '{"url":"https://trainsyou.com/"}',
                           '{"url":"https://TRAINSYOU.com"}', '{"url":"https://1.2.3.4"}',
                           '{"url":"https://trainsyou.com:8443"}', '{"url":"https://trainsyou.com","x":1}',
                           '{"url":"https://trainsyou.com","rootDomain":"bad domain"}', "[]", "not json"):
            with self.subTest(parameters):
                handled, result = self.run_request(self.request(parameters))
                self.assertEqual(handled[0][1], "failed")
                self.assertIn("Nothing was changed", result["message"])
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())
        self.assertEqual(self.calls, [])

    def test_address_change_is_a_long_action_that_needs_most_of_a_cycle(self):
        row = self.request()
        self.database.pending = [row]
        with patch.object(hostops, "psql", side_effect=self.database), \
                patch.object(host, "cycle_remaining", return_value=hostops.ADDRESS_CHANGE_MIN_SECONDS - 1):
            self.assertEqual(hostops.process_actions(host, self.values, self.key), [])
        self.assertFalse(any(sql.startswith("BEGIN") for _, sql in self.database.sql), "left pending")
        self.assertIn("change_platform_address", hostops.LONG_ACTIONS)
        self.assertIn("to_jsonb(q)->>'parameters' AS parameters", hostops.PENDING_SQL)
        self.assertEqual(hostops.ADDRESS_STATE, host.MOVED)


class DnsVerification(AddressBase):
    def test_dns_mismatch_is_refused_before_anything_changes(self):
        self.resolved[NEW[8:]] = ["198.51.100.7"]
        handled, result = self.run_request(self.request())
        self.assertEqual(handled[0][1], "failed")
        self.assertIn("DNS is not ready: trainsyou.com resolves to 198.51.100.7 (system resolver)", result["message"])
        self.assertIn("point only to this server, " + SERVER, result["message"])
        self.assertIn("Nothing was changed", result["message"])
        self.assertEqual(result["details"]["dns"][0], {"name": "trainsyou.com", "addresses": ["198.51.100.7"],
                                                       "source": "system resolver", "ok": False})
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())
        self.assertEqual((self.root / "Caddyfile").read_text(), self.before_caddyfile)
        self.assertFalse((self.root / hostops.ADDRESS_STATE).exists())
        self.assertFalse((self.root / hostops.RUNTIME_BACKUPS).exists())
        self.assertEqual(self.calls, [])

    def test_a_record_shared_with_another_server_is_refused(self):
        self.resolved[NEW[8:]] = [SERVER, "198.51.100.7"]
        handled, result = self.run_request(self.request())
        self.assertEqual(handled[0][1], "failed")
        self.assertEqual(self.calls, [])

    def test_root_domain_needs_a_wildcard_record(self):
        self.stack.enter_context(patch.object(hostops, "system_ipv4",
                                              side_effect=lambda name: [SERVER] if name == "trainsyou.com" else []))
        self.public.return_value = []
        handled, result = self.run_request(self.request())
        self.assertEqual(handled[0][1], "failed")
        probe = result["details"]["dns"][1]
        self.assertRegex(probe["name"], r"^gm-address-check-[0-9a-f]{8}\.trainsyou\.com$")
        self.assertEqual((probe["addresses"], probe["source"]), ([], "public DNS over HTTPS"))
        self.assertIn("including a wildcard record *.trainsyou.com", result["message"])
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())

    def test_public_dns_answers_when_the_system_resolver_has_none(self):
        self.resolved[NEW[8:]] = []
        self.public.return_value = [SERVER]
        server, checks = hostops.verify_address_dns(host, "trainsyou.com", None)
        self.assertEqual((server, checks[0]["source"], checks[0]["ok"]), (SERVER, "public DNS over HTTPS", True))
        self.public.return_value = None
        with self.assertRaises(hostops.ActionFailed) as refused:
            hostops.verify_address_dns(host, "trainsyou.com", None)
        self.assertIn("no resolver answered", str(refused.exception))

    def test_unknown_server_address_is_refused(self):
        common.atomic_json(self.root / "endpoint.json", {"url": ENDPOINT, "ip": "10.0.0.5"})
        with self.assertRaises(hostops.ActionFailed) as refused:
            hostops.verify_address_dns(host, "trainsyou.com", None)
        self.assertIn("public IPv4 address is unknown", str(refused.exception))


class DnsOverHttps(unittest.TestCase):
    """public_ipv4 parses the JSON DNS API (CNAME chains, NXDOMAIN) and skips failing resolvers."""
    def test_answers_are_parsed_and_failures_fall_through(self):
        answers = {"trainsyou.com": {"Status": 0, "Answer": [
            {"name": "trainsyou.com", "type": 5, "data": "edge.trainsyou.com."},
            {"name": "edge.trainsyou.com", "type": 1, "data": SERVER},
            {"name": "edge.trainsyou.com", "type": 1, "data": "not-an-address"}]},
            "missing.trainsyou.com": {"Status": 3}}
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append((self.path, self.headers.get("Accept")))
                if self.path.startswith("/broken"):
                    self.send_response(500)
                    self.end_headers()
                    return
                name = self.path.split("name=", 1)[1].split("&", 1)[0]
                body = json.dumps(answers.get(name, {"Status": 2})).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/dns-json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = "http://127.0.0.1:" + str(server.server_address[1])
        with patch.object(hostops, "PUBLIC_DNS", (base + "/broken", base + "/resolve")), \
                patch.dict(os.environ, {"NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"}):
            self.assertEqual(hostops.public_ipv4("trainsyou.com"), [SERVER])
            self.assertEqual(hostops.public_ipv4("missing.trainsyou.com"), [])
            self.assertIsNone(hostops.public_ipv4("servfail.trainsyou.com"))
        self.assertIn(("/resolve?name=trainsyou.com&type=A", "application/dns-json"), seen)


class Switching(AddressBase):
    def test_success_rewrites_runtime_env_keeps_the_old_name_as_redirect_and_reports(self):
        row = self.request()
        handled, result = self.run_request(row)
        self.assertEqual(handled, [(row["id"], "succeeded")])
        # runtime.env: the two values change in place or are appended; everything else is byte-identical.
        expected = RUNTIME.replace("PUBLIC_APP_URL=" + ENDPOINT + "\n", "PUBLIC_APP_URL=" + NEW + "\n", 1)
        self.assertEqual(self.runtime_bytes(), (expected + "PLATFORM_ROOT_DOMAIN=trainsyou.com\n").encode())
        self.assertEqual(self.mode(self.root / "runtime.env"), 0o600)
        self.assertEqual(list(self.root.glob("runtime.env.*")), [], "no temporary file left behind")
        # The previous file is kept, private, byte for byte.
        backups = list((self.root / hostops.RUNTIME_BACKUPS).iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), RUNTIME.encode())
        self.assertEqual(self.mode(backups[0]), 0o600)
        self.assertEqual(self.mode(self.root / hostops.RUNTIME_BACKUPS), 0o700)
        # The edge serves the new name and redirects the old one; endpoint.json follows runtime.env.
        caddyfile = (self.root / "Caddyfile").read_text()
        self.assertIn(NEW + " {\n    encode zstd gzip\n    header X-GymMembership-Release " + SHA, caddyfile)
        self.assertIn("\nhttps://" + OLD_HOST + " {\n    redir " + NEW + "{uri} 308\n}\n", caddyfile)
        self.assertIn("*.trainsyou.com {\n", caddyfile)
        self.assertNotIn(ENDPOINT + " {\n    encode", caddyfile)
        self.assertEqual(host.endpoint_url(), NEW)
        self.assertEqual([args[0] for _, args in self.calls], ["up"])
        self.ready.assert_any_call(NEW + "/api/v1/ready", expected_sha=SHA)
        self.certificate.assert_called_once_with("trainsyou.com")
        self.redirect.assert_called_once_with(OLD_HOST, NEW)
        self.assertIn("The platform now serves " + NEW, result["message"])
        self.assertIn(ENDPOINT + " permanently redirects to it", result["message"])
        details = result["details"]
        self.assertEqual((details["from"], details["to"], details["rootDomain"], details["changed"]),
                         (ENDPOINT, NEW, ROOT_DOMAIN, True))
        self.assertEqual((details["redirectFrom"], details["oldAddressRedirect"]), ([OLD_HOST], "verified"))
        self.assertEqual(details["certificate"], CERTIFICATE)
        # Progress was reported while running, signed like a result.
        progress = [sql for _, sql in self.database.sql if sql.startswith("UPDATE host_action_requests SET result=")]
        self.assertEqual(len(progress), 2)
        self.assertTrue(all("AND status='running'" in sql for sql in progress))
        state = hostops.address_state(host)
        self.assertIsNone(state["inProgress"])
        self.assertEqual(state["redirectFrom"], [OLD_HOST])
        self.assertEqual(state["lastChange"]["status"], "succeeded")
        report = hostops.address_report(host, host.runtime_values())
        self.assertEqual(report, {"publicIpv4": SERVER, "rootDomain": ROOT_DOMAIN, "redirectFrom": [OLD_HOST],
                                  "changeInProgress": False,
                                  "lastChange": {"from": ENDPOINT, "to": NEW, "at": state["lastChange"]["at"],
                                                 "status": "succeeded"}})
        self.assertFalse(hostops.edge_state(host, host.runtime_values(), NEW, SHA)["pendingReapply"])
        # Later deployments and re-applies keep the redirect until it is removed explicitly.
        (self.root / "Caddyfile").write_text("stale")
        host.start_release(PREVIOUS, NEW)
        self.assertIn("https://" + OLD_HOST + " {\n    redir " + NEW + "{uri} 308", (self.root / "Caddyfile").read_text())

    def test_moving_back_drops_the_redirect_for_the_name_now_served(self):
        self.run_request(self.request())
        self.values = host.runtime_values()
        back = json.dumps({"url": ENDPOINT, "rootDomain": None}, separators=(",", ":"))
        self.resolved[OLD_HOST] = [SERVER]
        row = self.request(back, id="1e3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
                           request_id="2e3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e")
        handled, result = self.run_request(row)
        self.assertEqual(handled, [(row["id"], "succeeded")], result)
        self.assertEqual(host.edge_moved(), ("trainsyou.com",))
        caddyfile = (self.root / "Caddyfile").read_text()
        self.assertIn(ENDPOINT + " {\n    encode", caddyfile)
        self.assertIn("https://trainsyou.com {\n    redir " + ENDPOINT + "{uri} 308", caddyfile)
        # The root domain was not part of this request, so it stays as set.
        self.assertIn("PLATFORM_ROOT_DOMAIN=trainsyou.com\n", self.runtime_bytes().decode())
        self.assertEqual(len(list((self.root / hostops.RUNTIME_BACKUPS).iterdir())), 2)

    def test_same_address_is_refused_as_nothing_to_change(self):
        same = json.dumps({"url": ENDPOINT, "rootDomain": None}, separators=(",", ":"))
        handled, result = self.run_request(self.request(same))
        self.assertEqual(handled[0][1], "failed")
        self.assertIn("Nothing to change", result["message"])
        self.assertEqual(self.calls, [])

    def test_setting_only_the_root_domain_keeps_the_address_and_adds_no_redirect(self):
        self.resolved[OLD_HOST] = [SERVER]
        root_only = json.dumps({"url": ENDPOINT, "rootDomain": ROOT_DOMAIN}, separators=(",", ":"))
        handled, result = self.run_request(self.request(root_only))
        self.assertEqual(handled[0][1], "succeeded", result)
        self.assertEqual(self.runtime_bytes(), (RUNTIME + "PLATFORM_ROOT_DOMAIN=trainsyou.com\n").encode())
        self.assertEqual(host.edge_moved(), ())
        self.assertIn("*.trainsyou.com {\n", (self.root / "Caddyfile").read_text())
        self.assertIn("PLATFORM_ROOT_DOMAIN is now trainsyou.com", result["message"])
        self.assertNotIn("signs in again", result["message"])
        self.redirect.assert_not_called()

    def test_readiness_failure_restores_the_previous_settings_and_edge(self):
        def ready(url, attempts=60, expected_sha=None):
            if url.startswith(NEW):
                raise common.DeploymentError("Application readiness did not pass at " + url)

        self.ready.side_effect = ready
        row = self.request()
        handled, result = self.run_request(row)
        self.assertEqual(handled, [(row["id"], "failed")])
        self.assertIn("The switch to " + NEW + " failed (Application readiness did not pass at " + NEW
                      + "/api/v1/ready)", result["message"])
        self.assertIn("The previous address " + ENDPOINT + " and its settings were restored", result["message"])
        self.assertEqual((result["details"]["restored"], result["details"]["changed"]), (True, False))
        # runtime.env, its permissions, endpoint.json and the edge are back to what they were.
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())
        self.assertEqual(self.mode(self.root / "runtime.env"), 0o600)
        self.assertEqual(host.endpoint_url(), ENDPOINT)
        self.assertEqual((self.root / "Caddyfile").read_text(), self.before_caddyfile)
        self.assertEqual([args[0] for _, args in self.calls], ["up", "up"])
        self.ready.assert_any_call(ENDPOINT + "/api/v1/ready", expected_sha=SHA)
        self.certificate.assert_not_called()
        state = hostops.address_state(host)
        self.assertEqual((state["inProgress"], state["redirectFrom"], state["lastChange"]["status"]),
                         (None, [], "rolled_back"))
        self.assertIn("Restoring " + ENDPOINT, " ".join(self.database.decoded()))

    def test_certificate_failure_also_rolls_back(self):
        self.certificate.side_effect = common.DeploymentError("The certificate for trainsyou.com expires within a day")
        handled, result = self.run_request(self.request())
        self.assertEqual(handled[0][1], "failed")
        self.assertIn("expires within a day", result["message"])
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())
        self.assertEqual((self.root / "Caddyfile").read_text(), self.before_caddyfile)

    def test_failed_restore_names_the_console_recovery(self):
        self.ready.side_effect = common.DeploymentError("Application readiness did not pass")
        handled, result = self.run_request(self.request())
        self.assertEqual(handled[0][1], "failed")
        self.assertIn("restoring " + ENDPOINT + " also failed", result["message"])
        self.assertIn("/infra/digitalocean/hostops.py reapply", result["message"])
        self.assertFalse(result["details"]["restored"])
        # The settings file is the previous one even though the re-apply failed.
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())
        state = hostops.address_state(host)
        self.assertEqual(state["inProgress"]["restoreAttempts"], 1, "retried on the next cycles")

    def test_interrupted_change_is_undone_on_the_next_cycle(self):
        """systemd stopped the cycle after runtime.env was switched: the next cycle restores it."""
        row = self.request()
        with patch.object(host, "reapply_release", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                hostops.change_platform_address(host, self.values, row)
        self.assertIn("PUBLIC_APP_URL=" + NEW, self.runtime_bytes().decode())
        self.assertTrue(hostops.address_state(host)["inProgress"])
        with patch.object(hostops, "psql", side_effect=FakeDatabase()):
            self.assertIs(hostops.before_deploy(host), True, "the restore uses the cycle; deployment waits")
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())
        self.assertEqual((self.root / "Caddyfile").read_text(), self.before_caddyfile)
        self.assertEqual(hostops.address_state(host)["lastChange"]["status"], "rolled_back")
        with patch.object(hostops, "psql", side_effect=FakeDatabase()):
            self.assertIs(hostops.before_deploy(host), False)

    def test_restore_stops_retrying_after_repeated_failures(self):
        row = self.request()
        with patch.object(host, "reapply_release", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                hostops.change_platform_address(host, self.values, row)
        self.compose.side_effect = subprocess.CalledProcessError(1, ["docker", "compose"])
        for attempt in range(hostops.RESTORE_ATTEMPTS):
            with self.assertRaises(subprocess.CalledProcessError):
                hostops.restore_address(host)
        state = hostops.address_state(host)
        self.assertIsNone(state["inProgress"])
        self.assertEqual(state["lastChange"]["status"], "restore_failed")
        self.assertEqual(self.runtime_bytes(), RUNTIME.encode())
        self.assertIsNone(hostops.restore_address(host))

    def test_old_address_redirects_are_removed_only_by_an_explicit_action(self):
        self.run_request(self.request())
        self.values = host.runtime_values()
        clear = signed_row(self.key, action="clear_address_redirects", id="3e3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
                           request_id="4e3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
                           issued_at_ms=int(time.time() * 1000), expires_at_ms=int(time.time() * 1000) + 1800000)
        handled, result = self.run_request(clear)
        self.assertEqual(handled, [(clear["id"], "succeeded")])
        self.assertEqual(result["details"]["removed"], [OLD_HOST])
        self.assertEqual(host.edge_moved(), ())
        self.assertNotIn(OLD_HOST, (self.root / "Caddyfile").read_text())
        clear2 = {**clear, "id": "5e3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e", "request_id": "6e3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e"}
        clear2["signature"] = hostops.sign(self.key, *hostops.action_canonical(clear2))
        handled, result = self.run_request(clear2)
        self.assertEqual(result["message"], "There were no old-address redirects to remove.")

    def test_failed_redirect_removal_puts_the_redirects_back(self):
        common.atomic_json(self.root / hostops.ADDRESS_STATE, {"version": 1, "redirectFrom": [OLD_HOST]})
        attempts = []

        def fail_first(release, sha, *args, **kwargs):
            attempts.append(args[0])
            if len(attempts) == 1:
                raise subprocess.CalledProcessError(1, ["docker", "compose"])

        self.compose.side_effect = fail_first
        with self.assertRaises(hostops.ActionFailed):
            hostops.clear_address_redirects(host)
        self.assertEqual(host.edge_moved(), (OLD_HOST,))
        self.assertIn("https://" + OLD_HOST + " {", (self.root / "Caddyfile").read_text())


class RuntimeFile(unittest.TestCase):
    def test_updates_replace_every_occurrence_and_append_missing_keys(self):
        text = "A=1\n#PUBLIC_APP_URL=x\nPUBLIC_APP_URL=old\n PUBLIC_APP_URL=spaced\nPUBLIC_APP_URL=dup\nB=2=3"
        self.assertEqual(hostops.updated_runtime(text, {"PUBLIC_APP_URL": NEW, "PLATFORM_ROOT_DOMAIN": ROOT_DOMAIN}),
                         "A=1\n#PUBLIC_APP_URL=x\nPUBLIC_APP_URL=" + NEW + "\n PUBLIC_APP_URL=spaced\nPUBLIC_APP_URL="
                         + NEW + "\nB=2=3\nPLATFORM_ROOT_DOMAIN=" + ROOT_DOMAIN)
        self.assertEqual(hostops.updated_runtime("A=1\n", {"A": "2"}), "A=2\n")

    def test_private_write_is_atomic_and_private_even_with_a_permissive_umask(self):
        with tempfile_directory() as directory:
            path = directory / "runtime.env"
            path.write_text("A=1\n")
            path.chmod(0o644)
            previous = os.umask(0)
            try:
                hostops.private_write(path, b"A=2\n")
            finally:
                os.umask(previous)
            self.assertEqual(path.read_bytes(), b"A=2\n")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(sorted(p.name for p in directory.iterdir()), ["runtime.env"])

    def test_backups_are_pruned_to_the_newest_copies(self):
        with tempfile_directory() as directory:
            fake = type("H", (), {"ROOT": directory})
            folder = directory / hostops.RUNTIME_BACKUPS
            folder.mkdir(mode=0o700)
            for day in range(1, 13):
                (folder / ("runtime.env.202609{:02d}T000000Z.0d3c9a4e".format(day))).write_text("old")
            (folder / "keep-me.txt").write_text("unrelated")
            name = hostops.backup_runtime(fake, b"A=1\n", "0d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e")
            names = sorted(p.name for p in folder.iterdir())
            self.assertIn(name, names)
            self.assertIn("keep-me.txt", names)
            self.assertEqual(len([n for n in names if n.startswith("runtime.env.")]), hostops.RUNTIME_BACKUPS_KEPT)

    def test_group_readable_runtime_env_is_refused(self):
        with tempfile_directory() as directory:
            (directory / "runtime.env").write_text("A=1\n")
            (directory / "runtime.env").chmod(0o640)
            with self.assertRaises(hostops.ActionFailed):
                hostops.runtime_file(type("H", (), {"ROOT": directory}))


def tempfile_directory():
    import tempfile
    from contextlib import contextmanager

    @contextmanager
    def directory():
        with tempfile.TemporaryDirectory() as name:
            yield Path(name)
    return directory()


VECTOR_SIGNATURE = "39e604acbfc6ea5c0146318d933545361cd27a66644601626d5595f763ca9b3b"


if __name__ == "__main__":
    unittest.main()
