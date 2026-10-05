"""Optional wildcard upgrade keeps the existing edge safe until explicitly enabled."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import host
import wildcard_tls
from common import DeploymentError


class WildcardUpgrade(unittest.TestCase):
    def test_wildcard_uses_one_dns_certificate_and_retains_custom_domain_allowlist(self):
        config = host.edge_config("https://coaching.example", ask=host.TLS_ASK_URL + "a" * 64,
                                  root="coaching.example", wildcard_tls=True)
        self.assertIn("dns digitalocean {env.DIGITALOCEAN_DNS_TOKEN}", config)
        self.assertEqual(config.count("on_demand\n"), 1, "Only independent custom domains use per-name issuance")
        self.assertIn("ask " + host.TLS_ASK_URL, config)
        self.assertIn("redir @www https://coaching.example", config)
        self.assertNotIn("api_token", config)

    def test_upgrade_is_opt_in(self):
        self.assertFalse(host.edge_wildcard({}))
        self.assertFalse(host.edge_wildcard({"EDGE_WILDCARD_TLS": "false"}))
        self.assertTrue(host.edge_wildcard({"EDGE_WILDCARD_TLS": "true"}))

    def test_private_secret_replacements_keep_owner_only_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dns.env"
            path.write_text("old")
            path.chmod(0o644)
            wildcard_tls.private_write(path, "synthetic-dns-token")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.read_text(), "synthetic-dns-token")

    def test_invalid_tokens_and_missing_platform_setup_make_no_change(self):
        for token in ("", "x" * 22 + "\nEVIL=yes", "x" * 22 + "$bad"):
            with self.assertRaises(DeploymentError):
                wildcard_tls.enable(token)
        with patch.object(host, "runtime_values", return_value={}), patch.object(host, "run") as run:
            with self.assertRaises(DeploymentError):
                wildcard_tls.enable("synthetic-only-token-1234")
            run.assert_not_called()

    def test_image_and_module_versions_are_pinned(self):
        self.assertIn(wildcard_tls.PLUGIN, wildcard_tls.DOCKERFILE)
        self.assertIn("caddy:2.11.4-builder", wildcard_tls.DOCKERFILE)
        self.assertNotIn("@latest", wildcard_tls.DOCKERFILE)
        self.assertNotIn(":latest", wildcard_tls.DOCKERFILE)
