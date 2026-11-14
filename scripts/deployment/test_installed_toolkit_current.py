"""Exercise toolkit pointer CAS, lost acknowledgements and fixed read-only dispatch."""

from hashlib import sha256
import os
from pathlib import Path
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import installed_toolkit_current as current
import installed_web_toolkit_transport as transport


class InstalledToolkitCurrentTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory(prefix="wd-toolkit-current-"))).resolve()
        self.operators = self.root / "operators"
        self.private = self.root / "private"
        self.original = self.private / "original"
        self.state = self.private / "first" / "rollout"
        for path in (self.operators, self.private, self.original, self.state.parent, self.state):
            path.mkdir(mode=0o700)
        self.first = self.toolkit("release-a", "a")
        self.second = self.toolkit("release-b", "b")

    def toolkit(self, name, revision):
        names = transport.MODERN_REQUIRED | {current.SELF, current.STATUS}
        files = {name: b"VALUE = True\n" for name in names}
        files[current.STATUS] = ("import json,os,sys\n"
            "assert sys.argv[1]=='extract-current'\n"
            "assert 'WARPDRIVE_TEST_UNTRUSTED' not in os.environ\n"
            "print(json.dumps({'operationId':'accepted','event':{'state':'accepted'}}))\n").encode()
        manifest = {"kind": "warpdrive-local-installed-web-toolkit-proposal", "version": 1,
                    "repositoryHead": revision * 40, "draft": False, "transferred": False, "deploymentAuthorized": False,
                    "stageAcknowledgementEntry": transport.STAGE_ACK, **transport.MODERN_ENTRIES,
                    "sourceFiles": len(files), "pins": {name: sha256(raw).hexdigest() for name, raw in files.items()}}
        raw = current._raw(manifest)
        pin = sha256(raw).hexdigest()
        transport._publish(self.operators / name, raw, files, pin)
        return {"destination": name, "manifest_sha256": pin}

    def activate(self, selection=None, before="absent", operation="activate-a"):
        return current.activate(self.root, **(selection or self.first), expected_current_sha256=before, operation_id=operation)

    def test_activation_readback_previous_retention_and_rollback(self):
        first = self.activate()
        self.assertIsNone(first["previous"])
        self.assertEqual(first, current.readback(self.root, expected_current_sha256=first["currentSha256"]))
        second = self.activate(self.second, first["currentSha256"], "activate-b")
        self.assertEqual(second["previous"], first["current"])
        final = current.rollback(self.root, expected_current_sha256=second["currentSha256"], operation_id="reverse-b")
        self.assertEqual(final["current"], first["current"])
        self.assertEqual(final["previous"], second["current"])
        self.assertTrue((self.operators / "toolkit-activation-activate-a.json").is_file())
        self.assertEqual(stat.S_IMODE((self.operators / current.CURRENT).stat().st_mode), 0o600)
        self.assertFalse(final["applicationStateChanged"])

    def test_wrong_pin_wrong_cas_unsafe_destination_and_changed_source_hold(self):
        for selection, before in (({**self.first, "manifest_sha256": "0" * 64}, "absent"),
                                  ({**self.first, "destination": "../release-a"}, "absent"),
                                  (self.first, "0" * 64)):
            with self.subTest(selection=selection, before=before), self.assertRaises(ValueError):
                self.activate(selection, before)
        self.assertFalse((self.operators / current.CURRENT).exists())
        source = self.operators / self.first["destination"] / "source" / current.STATUS
        source.write_bytes(b"raise AssertionError('must not run')\n")
        with self.assertRaises(ValueError):
            self.activate()
        self.assertFalse((self.operators / current.PENDING).exists())

    def test_foreign_pointer_symlink_hardlink_and_lock_are_preserved(self):
        pointer = self.operators / current.CURRENT
        foreign = self.root / "foreign"
        foreign.write_bytes(b"foreign\n")
        foreign.chmod(0o600)
        cases = (lambda: pointer.symlink_to(foreign), lambda: os.link(foreign, pointer),
                 lambda: pointer.write_bytes(b"foreign\n"))
        for create in cases:
            create()
            if not pointer.is_symlink():
                pointer.chmod(0o600)
            with self.assertRaises((ValueError, OSError)):
                self.activate(before=sha256(b"foreign\n").hexdigest())
            self.assertEqual(foreign.read_bytes(), b"foreign\n")
            pointer.unlink()
        lock = self.operators / current.LOCK
        lock.write_bytes(b"foreign lock")
        lock.chmod(0o600)
        with self.assertRaisesRegex(current.ToolkitHeld, "Foreign toolkit lock"):
            self.activate()
        self.assertEqual(lock.read_bytes(), b"foreign lock")

    def test_lost_acknowledgement_after_pointer_is_same_operation_readback(self):
        with patch.object(current, "_finish", side_effect=OSError("lost final acknowledgement")):
            with self.assertRaises(current.ToolkitUnknown):
                self.activate()
        pointer = (self.operators / current.CURRENT).read_bytes()
        self.assertTrue((self.operators / current.PENDING).exists())
        with patch.object(current, "_write", side_effect=AssertionError("must not replay pointer mutation")):
            receipt = self.activate()
        self.assertEqual(receipt["currentSha256"], sha256(pointer).hexdigest())
        self.assertFalse((self.operators / current.PENDING).exists())
        self.assertEqual(pointer, (self.operators / current.CURRENT).read_bytes())

    def test_intent_before_pointer_loss_holds_without_replaying_or_new_operation(self):
        write = current._write

        def fail_pointer(parent, name, value, **options):
            if name == current.CURRENT:
                raise OSError("pointer not published")
            return write(parent, name, value, **options)

        with patch.object(current, "_write", side_effect=fail_pointer):
            with self.assertRaises(current.ToolkitUnknown):
                self.activate()
        self.assertFalse((self.operators / current.CURRENT).exists())
        for selection, operation in ((self.first, "activate-a"), (self.second, "activate-b")):
            with self.subTest(operation=operation), self.assertRaises(current.ToolkitHeld):
                self.activate(selection, operation=operation)
        with self.assertRaises(current.ToolkitHeld):
            current.readback(self.root, expected_current_sha256="absent", operation_id="activate-a")
        self.assertTrue((self.operators / current.PENDING).exists())

    def test_lost_reply_after_archived_acceptance_reads_back_without_pointer_mutation(self):
        finish = current._finish

        def lose_reply(*arguments):
            finish(*arguments)
            raise OSError("reply lost after durable accepted journal")

        with patch.object(current, "_finish", side_effect=lose_reply):
            with self.assertRaises(current.ToolkitUnknown):
                self.activate()
        pointer = (self.operators / current.CURRENT).read_bytes()
        self.assertFalse((self.operators / current.PENDING).exists())
        with patch.object(current, "_write", side_effect=AssertionError("must not rewrite pointer")):
            receipt = current.readback(self.root, expected_current_sha256=sha256(pointer).hexdigest(), operation_id="activate-a")
        self.assertEqual(receipt["state"], "verified")

    def test_operation_cannot_be_reused_with_other_pins_or_after_later_activation(self):
        first = self.activate()
        self.assertEqual(first, self.activate())
        with self.assertRaises(current.ToolkitHeld):
            self.activate(self.second)
        self.activate(self.second, first["currentSha256"], "activate-b")
        with self.assertRaises(current.ToolkitHeld):
            self.activate()

    def test_status_uses_only_fixed_entrypoint_clean_environment_and_private_paths(self):
        receipt = self.activate()
        runner = Mock(return_value=SimpleNamespace(returncode=0, stdout=b'{"operationId":"accepted","event":{}}\n'))
        result = current.run_status(self.root, expected_current_sha256=receipt["currentSha256"], original=self.original,
            state=self.state, target_key="pitant-warpdrive", runner=runner)
        args, options = runner.call_args
        self.assertEqual(args[0][:3], [sys.executable, "-I", "-B"])
        self.assertIn("extract-current", args[0])
        self.assertNotIn("shell", options)
        self.assertEqual(options["env"], {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertIs(options["stdin"], subprocess.DEVNULL)
        self.assertFalse(result["liveHealthQualified"])
        runner.reset_mock()
        with self.assertRaises(current.ToolkitHeld):
            current.run_status(self.root, expected_current_sha256=receipt["currentSha256"], original=self.root,
                state=self.state, target_key="pitant-warpdrive", runner=runner)
        runner.assert_not_called()

    def test_real_status_subprocess_is_isolated_and_dispatch_rechecks_source(self):
        receipt = self.activate()
        with patch.dict(os.environ, {"WARPDRIVE_TEST_UNTRUSTED": "must not reach child"}):
            result = current.run_status(self.root, expected_current_sha256=receipt["currentSha256"], original=self.original,
                state=self.state, target_key="pitant-warpdrive")
        self.assertEqual(result["status"]["operationId"], "accepted")

        def drift(*_args, **_options):
            path = self.operators / self.first["destination"] / "source" / current.STATUS
            path.write_bytes(b"changed during status\n")
            return SimpleNamespace(returncode=0, stdout=b'{"operationId":"accepted","event":{}}')

        with self.assertRaises(ValueError):
            current.run_status(self.root, expected_current_sha256=receipt["currentSha256"], original=self.original,
                state=self.state, target_key="pitant-warpdrive", runner=drift)

    def test_failed_timed_out_or_malformed_status_preserves_current_toolkit(self):
        receipt = self.activate()
        before = (self.operators / current.CURRENT).read_bytes()
        for result in (SimpleNamespace(returncode=1, stdout=b""), SimpleNamespace(returncode=0, stdout=b"x" * 1025),
                       SimpleNamespace(returncode=0, stdout=b"{}")):
            with self.subTest(result=result), self.assertRaises(current.ToolkitHeld):
                current.run_status(self.root, expected_current_sha256=receipt["currentSha256"], original=self.original,
                    state=self.state, target_key="pitant-warpdrive", runner=Mock(return_value=result))
        with self.assertRaises(subprocess.TimeoutExpired):
            current.run_status(self.root, expected_current_sha256=receipt["currentSha256"], original=self.original,
                state=self.state, target_key="pitant-warpdrive", runner=Mock(side_effect=subprocess.TimeoutExpired("status", 30)))
        self.assertEqual(before, (self.operators / current.CURRENT).read_bytes())
        self.assertFalse((self.operators / current.PENDING).exists())

    def test_cli_help_supports_isolated_interpreter_without_source_execution(self):
        result = subprocess.run([sys.executable, "-I", "-B", current.__file__, "--help"], capture_output=True, timeout=5, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"activate,rollback,readback,run", result.stdout)


if __name__ == "__main__":
    unittest.main()
