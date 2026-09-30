import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "infra" / "digitalocean" / "admin-access.sh"
SHA = "a" * 40
PASSWORD = "Host-Recovery-Password-2026"


class AdminAccessScriptTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.root, self.bin, self.log = base / "root", base / "bin", base / "docker.log"
        release = self.root / "releases" / SHA
        (release / "scripts").mkdir(parents=True)
        (release / "scripts" / "admin-access.ts").write_text("")
        (self.root / "release-state.json").write_text(json.dumps({"current": SHA}))
        self.bin.mkdir()
        # Stand-ins: root identity and a docker that records its call and stdin.
        self.tool("id", "#!/bin/sh\necho 0\n")
        self.tool("docker", f'#!/bin/sh\n{{ pwd; echo "RELEASE_TAG=$RELEASE_TAG"; '
                            f'for a in "$@"; do echo "$a"; done; echo STDIN; cat; }} > "{self.log}"\n')

    def tearDown(self):
        self.temp.cleanup()

    def tool(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def run_script(self, *args, stdin=""):
        env = {"PATH": f"{self.bin}:{os.environ['PATH']}", "ADMIN_ACCESS_ROOT": str(self.root)}
        return subprocess.run(["bash", str(SCRIPT), *args], input=stdin, env=env,
                              capture_output=True, text=True, timeout=30)

    def test_password_travels_only_on_stdin_to_the_current_release(self):
        result = self.run_script("create", "owner@example.com", stdin=f"{PASSWORD}\n{PASSWORD}\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        call = self.log.read_text().split("\n")
        args, piped = call[:call.index("STDIN")], "\n".join(call[call.index("STDIN") + 1:])
        self.assertEqual(args[0], str(self.root / "releases" / SHA))
        self.assertIn("RELEASE_TAG=" + SHA, args)
        self.assertEqual(args[1:12], ["RELEASE_TAG=" + SHA, "compose", "--project-name", "gymmembership",
                                      "--env-file", str(self.root / "runtime.env"),
                                      "-f", str(self.root / "releases" / SHA / "compose.yaml"),
                                      "-f", str(self.root / "edge.json"), "exec"])
        self.assertIn("ADMIN_ACCESS_EMAIL=owner@example.com", args)
        self.assertEqual(args[-2:], ["admin-access", "create"])
        self.assertEqual(piped, PASSWORD)
        self.assertFalse(any(PASSWORD in a for a in args))
        self.assertNotIn(PASSWORD, result.stdout + result.stderr)

    def test_list_needs_no_password(self):
        result = self.run_script("list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("admin:access", self.log.read_text())
        self.assertTrue(self.log.read_text().rstrip().endswith("list\nSTDIN"))

    def test_refusals_run_no_command(self):
        cases = [
            (("reset-password", "owner@example.com"), f"{PASSWORD}\nDifferent-Password-2026\n"),
            (("reset-password", "owner@example.com"), "short\nshort\n"),
            (("create", "not-an-email"), f"{PASSWORD}\n{PASSWORD}\n"),
            (("promote", "owner@example.com"), ""),
            (("create",), ""),
        ]
        for args, stdin in cases:
            with self.subTest(args=args):
                result = self.run_script(*args, stdin=stdin)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.log.exists())
                self.assertNotIn(PASSWORD, result.stdout + result.stderr)

    def test_release_without_recovery_command_points_to_the_manual_command(self):
        (self.root / "releases" / SHA / "scripts" / "admin-access.ts").unlink()
        result = self.run_script("list")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("predates admin:access", result.stderr)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
