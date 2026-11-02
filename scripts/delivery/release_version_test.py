import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from release_test import r

class VersionTests(unittest.TestCase):
    def test_first_and_successive_releases(self):
        self.assertEqual(r.select_version("1.4.0", []), "1.4.1")
        self.assertEqual(r.select_version("1.4.0", ["v1.4.1", "v1.5.0"]), "1.5.1")
        self.assertEqual(r.select_version("1.4.0", [], bump="minor"), "1.5.0")
        self.assertEqual(r.select_version("1.4.0", [], bump="major"), "2.0.0")
    def test_regression_and_invalid_version_blocked(self):
        for version in ("1.4.0", "1.03.0", "1.5.0-beta", "v1.2.0", "1.4.0;touch bad"):
            with self.subTest(version=version), self.assertRaises(r.GateError):
                r.select_version("1.4.0", [], requested=version)

class ReleaseVersionTests(unittest.TestCase):
    def test_release_version_matches_source_and_exceeds_existing_tags(self):
        r.validate_release_version("1.4.1", "1.4.1", ["v1.4.0"])
        for package, selected, tags in (("1.4.0", "1.4.1", []), ("1.4.1", "1.4.1", ["v1.4.1"])):
            with self.assertRaises(r.GateError):
                r.validate_release_version(package, selected, tags)
    def test_package_version_preparation_is_dry_by_default_and_idempotent(self):
        with tempfile.TemporaryDirectory() as destination:
            root = Path(destination)
            package = '{\n  "name": "warpdrive",\n  "version": "1.4.0",\n  "packageManager": "bun@1.4.4"\n}\n'
            lock = '{"workspaces":{"":{"name":"warpdrive"}},"lockfileVersion":3}\n'
            (root / "package.json").write_text(package)
            (root / "bun.lock").write_text(lock)
            self.assertEqual(r.prepare_package_version(root, "1.4.1"), ["package.json"])
            self.assertEqual((root / "package.json").read_text(), package)
            r.prepare_package_version(root, "1.4.1", apply=True)
            self.assertEqual(json.loads((root / "package.json").read_text())["version"], "1.4.1")
            self.assertEqual((root / "bun.lock").read_text(), lock)
            self.assertEqual(r.prepare_package_version(root, "1.4.1", apply=True), [])
    def test_timed_out_commands_report_gate_failure_without_retry(self):
        import release_support
        with patch.object(release_support.subprocess, "run", side_effect=release_support.subprocess.TimeoutExpired("gh", 60)) as command:
            with self.assertRaises(r.GateError):
                r.GitHub().request("repos/o/r", "POST", {"title": "bounded"})
            self.assertEqual(command.call_count, 1)
    def test_subprocess_calls_have_finite_deadlines(self):
        import release_support
        result = type("Result", (), {"returncode": 0, "stdout": "{}", "stderr": ""})()
        with patch.object(release_support.subprocess, "run", return_value=result) as command:
            r.run("git", "status")
            self.assertLessEqual(command.call_args.kwargs["timeout"], 60)
            r.GitHub().request("repos/o/r")
            self.assertLessEqual(command.call_args.kwargs["timeout"], 60)

