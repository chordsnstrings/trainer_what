"""Workspace subdomains at the edge: the wildcard site block for PLATFORM_ROOT_DOMAIN.

host.py runs on the live server, so the edge output must stay byte-for-byte the
same when the root is unset. No Docker, cloud or DNS is used; Caddy validates
the generated files when CADDY_BIN (or caddy on PATH) is available.
"""
import os
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import common  # noqa: E402
import host  # noqa: E402
import hostops  # noqa: E402
from test_hostops_deployment import ASK_TOKEN, ENDPOINT, PREVIOUS, SHA, Base, runtime_env  # noqa: E402

ROOT_DOMAIN = "trainsyou.com"
ASK = host.TLS_ASK_URL + ASK_TOKEN
PROXY = "    reverse_proxy web:3000 {\n        header_up X-Forwarded-For {remote_host}\n    }\n"


class WildcardEdge(Base):
    def test_unset_root_keeps_every_edge_byte_for_byte(self):
        for args in ((ENDPOINT, SHA), (ENDPOINT, SHA, ASK), (ENDPOINT, None, ASK)):
            with self.subTest(args=len(args)):
                self.assertEqual(host.edge_config(*args), host.edge_config(*args, root=None) if len(args) == 3
                                 else host.edge_config(*args, None, None))
        # Without on-demand TLS there is no wildcard, whatever the root.
        self.assertEqual(host.edge_config(ENDPOINT, SHA, None, ROOT_DOMAIN), host.edge_config(ENDPOINT, SHA))

    def test_root_adds_one_on_demand_wildcard_block_between_platform_and_catch_all(self):
        config = host.edge_config(ENDPOINT, SHA, ASK, ROOT_DOMAIN)
        platform = config.index(ENDPOINT + " {\n")
        wildcard = config.index("*." + ROOT_DOMAIN + " {\n    tls {\n        on_demand\n    }\n")
        catch_all = config.index("https:// {\n")
        self.assertLess(platform, wildcard)
        self.assertLess(wildcard, catch_all)
        self.assertEqual(config.count(PROXY), 3)
        self.assertEqual(config.count("header X-GymMembership-Release " + SHA), 3)
        self.assertTrue(config.startswith("{\n    on_demand_tls {\n        ask " + ASK + "\n    }\n}\n"))
        # The platform is elsewhere, so www is not special here.
        self.assertNotIn("redir", config)

    def test_platform_at_the_root_redirects_www(self):
        config = host.edge_config("https://" + ROOT_DOMAIN, SHA, ASK, ROOT_DOMAIN)
        self.assertIn("    @www host www." + ROOT_DOMAIN + "\n    redir @www https://" + ROOT_DOMAIN + "{uri} 308\n",
                      config)
        # An sslip.io platform name also works as the root.
        sslip = "gymmembership.1.1.1.1.sslip.io"
        self.assertIn("*." + sslip + " {\n", host.edge_config(ENDPOINT, SHA, ASK, sslip))

    def test_invalid_roots_are_refused_or_ignored(self):
        for bad in ("evil.com {\n}", "*.trainsyou.com", "1.2.3.4", "localhost", "-bad.com", "trainsyou.com:443",
                    "TrainsYou.com", "trainsyou.com."):
            with self.subTest(bad=bad), self.assertRaises(common.DeploymentError):
                host.edge_config(ENDPOINT, SHA, ASK, bad)
        self.assertEqual(host.edge_root({"PLATFORM_ROOT_DOMAIN": " TrainsYou.com. "}), ROOT_DOMAIN)
        self.assertIsNone(host.edge_root({}))
        self.assertIsNone(host.edge_root({"PLATFORM_ROOT_DOMAIN": ""}))
        self.assertIsNone(host.edge_root({"PLATFORM_ROOT_DOMAIN": "1.2.3.4"}))
        self.assertIn("Ignoring PLATFORM_ROOT_DOMAIN", self.output.getvalue())
        self.assertIsNone(host.edge_root({"PLATFORM_ROOT_DOMAIN": "evil.com {"}))

    def test_deploy_and_rollback_render_the_wildcard_from_runtime_settings(self):
        runtime_env(self.root, PLATFORM_ROOT_DOMAIN=ROOT_DOMAIN)
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
            self.assertEqual(config, host.edge_config(ENDPOINT, sha, ASK, ROOT_DOMAIN))

    def test_reapply_and_the_host_report_follow_the_root(self):
        values = runtime_env(self.root)
        self.state(current=SHA, previous=PREVIOUS)
        self.assertEqual(host.reapply_release(), SHA)
        self.assertNotIn("*." + ROOT_DOMAIN, (self.root / "Caddyfile").read_text())
        self.assertFalse(hostops.edge_state(host, values, ENDPOINT, SHA)["pendingReapply"])
        # Adding the root to runtime.env is pending until the edge is re-applied.
        values = runtime_env(self.root, PLATFORM_ROOT_DOMAIN=ROOT_DOMAIN)
        self.assertTrue(hostops.edge_state(host, values, ENDPOINT, SHA)["pendingReapply"])
        self.assertEqual(host.reapply_release(), SHA)
        self.assertIn("*." + ROOT_DOMAIN + " {\n", (self.root / "Caddyfile").read_text())
        edge = hostops.edge_state(host, values, ENDPOINT, SHA)
        self.assertEqual((edge["onDemandTls"], edge["pendingReapply"]), (True, False))

    def test_host_report_works_with_a_controller_without_subdomains(self):
        values = runtime_env(self.root, PLATFORM_ROOT_DOMAIN=ROOT_DOMAIN)
        (self.root / "Caddyfile").write_text(host.edge_config(ENDPOINT, SHA, ASK))
        older = Mock(wraps=host, spec=[name for name in dir(host) if name != "edge_root"])
        older.ROOT = self.root
        older.edge_config = lambda endpoint, sha, ask: host.edge_config(endpoint, sha, ask)
        older.edge_ask = host.edge_ask
        self.assertFalse(hostops.edge_state(older, values, ENDPOINT, SHA)["pendingReapply"])

    def test_compose_passes_the_root_to_api_worker_and_web_with_an_empty_default(self):
        text = (Path(__file__).resolve().parents[1] / "compose.yaml").read_text()
        self.assertEqual(len(re.findall(r"^      PLATFORM_ROOT_DOMAIN: \$\{PLATFORM_ROOT_DOMAIN:-\}$", text, re.M)), 2,
                         "the shared API/worker environment and the web environment")

    def test_generated_wildcard_caddyfiles_pass_real_caddy_validation(self):
        caddy = os.environ.get("CADDY_BIN") or shutil.which("caddy")
        docker = shutil.which("docker")
        in_ci = os.environ.get("GITHUB_ACTIONS") == "true"
        if not caddy and not (in_ci and docker):
            self.skipTest("Caddy is unavailable; set CADDY_BIN to validate generated Caddyfiles locally")
        for name, config in (("wildcard", host.edge_config(ENDPOINT, SHA, ASK, ROOT_DOMAIN)),
                             ("root-platform", host.edge_config("https://" + ROOT_DOMAIN, SHA, ASK, ROOT_DOMAIN)),
                             ("bootstrap", host.edge_config(ENDPOINT, ask=ASK, root=ROOT_DOMAIN))):
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


if __name__ == "__main__":
    unittest.main()
