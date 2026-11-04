import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import security_audit as audit


class AuditTests(unittest.TestCase):
    def fixture(self, root):
        for project in audit.PROJECTS:
            directory = root / project
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "package.json").write_text('{"packageManager":"bun@1.4.4"}\n')
            (directory / "bun.lock").write_text('{}\n')

    def test_four_locks_use_native_all_severity_exit_and_retain_exact_raw_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "checkout"
            self.fixture(root)
            output = Path(temp) / "output"
            results = [subprocess.CompletedProcess(audit.COMMAND, code, raw, b"diagnostic\x00\n")
                       for code, raw in ((0, b""), (1, b'{"pkg":[{"severity":"low"}]}'),
                                         (1, b'{"pkg":[{"severity":"moderate"}]}'), (0, b"{}"))]
            with patch.object(audit.subprocess, "run", side_effect=results) as run:
                report = audit.audit_all(root, output)
            self.assertFalse(report["passed"])
            self.assertEqual([r["result"] for r in report["projects"]], ["passed", "failed", "failed", "passed"])
            self.assertEqual(run.call_count, 4)
            self.assertTrue(all(call.args == (audit.COMMAND,) and call.kwargs["timeout"] == 60
                                for call in run.call_args_list))
            for row, result in zip(report["projects"], results):
                self.assertEqual((output / row["stdout"]["path"]).read_bytes(), result.stdout)
                self.assertEqual(row["stdout"]["sha256"], hashlib.sha256(result.stdout).hexdigest())
                self.assertEqual((output / row["stderr"]["path"]).read_bytes(), result.stderr)
                self.assertTrue(row["inputs_unchanged"])
            self.assertEqual(json.loads((output / "summary.json").read_text()), report)

    def test_timeout_operational_failure_and_zero_without_details_cannot_be_retried_or_filtered(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "checkout"
            self.fixture(root)
            responses = [subprocess.TimeoutExpired(audit.COMMAND, 60, output=b"partial\x00", stderr=b"timeout"),
                         subprocess.CompletedProcess(audit.COMMAND, 2, b"bad response", b"network"),
                         subprocess.CompletedProcess(audit.COMMAND, 1, b"", b""),
                         subprocess.CompletedProcess(audit.COMMAND, 0, b"", b"checked")]
            with patch.object(audit.subprocess, "run", side_effect=responses) as run:
                report = audit.audit_all(root, Path(temp) / "output")
            self.assertFalse(report["passed"])
            self.assertEqual(run.call_count, 4)
            self.assertEqual(report["projects"][0]["error"], "timeout")
            self.assertEqual([r["result"] for r in report["projects"]], ["failed", "failed", "failed", "passed"])

    def test_input_mutation_is_failure_even_when_native_audit_exits_zero(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "checkout"
            self.fixture(root)
            def mutate(*args, **kwargs):
                (kwargs["cwd"] / "bun.lock").write_text('{"changed":true}\n')
                return subprocess.CompletedProcess(args[0], 0, b"", b"")
            with patch.object(audit.subprocess, "run", side_effect=mutate):
                report = audit.audit_all(root, Path(temp) / "output")
            self.assertFalse(report["passed"])
            self.assertTrue(all(not row["inputs_unchanged"] for row in report["projects"]))

    def test_missing_lock_or_reused_output_fails_and_does_not_invent_clean_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "checkout"
            self.fixture(root)
            (root / "site/bun.lock").unlink()
            output = Path(temp) / "output"
            with patch.object(audit.subprocess, "run", return_value=subprocess.CompletedProcess(audit.COMMAND, 0, b"", b"")) as run:
                report = audit.audit_all(root, output)
            self.assertFalse(report["passed"])
            self.assertEqual(run.call_count, 3)
            self.assertEqual(report["projects"][1]["result"], "failed")
            with self.assertRaises(FileExistsError):
                audit.audit_all(root, output)

    def test_zero_exit_malformed_json_or_advisory_envelope_fails_with_raw_evidence(self):
        for raw in (b"[]", b'{"error":"unavailable"}', b"not JSON", b"null",
                    b'{"pkg":[{"id":1,"severity":"unknown"}]}',
                    b'{"pkg":[{"severity":"high"}]}',
                    b'{"pkg":[{"id":1,"severity":[]}]}'):
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / "checkout"
                self.fixture(root)
                output = Path(temp) / "output"
                with patch.object(audit.subprocess, "run", return_value=subprocess.CompletedProcess(
                    audit.COMMAND, 0, raw, b"diagnostic\x00"
                )):
                    report = audit.audit_all(root, output)
                self.assertFalse(report["passed"])
                for row in report["projects"]:
                    self.assertEqual(row["exit_code"], 0)
                    self.assertEqual(row["error"], "malformed-audit-output")
                    self.assertEqual((output / row["stdout"]["path"]).read_bytes(), raw)
                    self.assertEqual((output / row["stderr"]["path"]).read_bytes(), b"diagnostic\x00")

    def test_known_empty_success_and_valid_advisory_free_json_envelopes_pass(self):
        for raw in (b"", b"\n", b"{}\n", b'{"pkg":[]}'):
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / "checkout"
                self.fixture(root)
                with patch.object(audit.subprocess, "run", return_value=subprocess.CompletedProcess(
                    audit.COMMAND, 0, raw, b""
                )):
                    report = audit.audit_all(root, Path(temp) / "output")
                self.assertTrue(report["passed"])
                self.assertTrue(all(row["advisory_count"] == 0 for row in report["projects"]))

    def test_any_reported_severity_fails_even_if_native_exit_is_zero(self):
        for severity in ("low", "moderate", "high", "critical"):
            raw = json.dumps({"pkg": [{"id": 1, "severity": severity}]}).encode()
            with self.subTest(severity=severity), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / "checkout"
                self.fixture(root)
                with patch.object(audit.subprocess, "run", return_value=subprocess.CompletedProcess(
                    audit.COMMAND, 0, raw, b""
                )):
                    report = audit.audit_all(root, Path(temp) / "output")
                self.assertFalse(report["passed"])
                self.assertTrue(all(row["error"] == "advisories-reported-with-zero-exit"
                                    and row["advisory_count"] == 1 for row in report["projects"]))


if __name__ == "__main__":
    unittest.main()
