"""Exercise toolkit pointer CAS, lost acknowledgements and fixed read-only dispatch."""

from hashlib import sha256
from contextlib import contextmanager
import io
import json
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

    def sdk_toolkit(self):
        files = {name: b"VALUE = True\n" for name in transport.MODERN_REQUIRED | {current.SELF, current.STATUS, transport.SDK_OPERATOR}}
        files.update({name: '{"fixture":true,"label":"سیاست"}\n'.encode() for name in transport.SDK_DATA})
        files[transport.SDK_OPERATOR] = (
            "import json,os,sys\n"
            "assert sys.argv[1] in ('stage','observe','promote','rollback','reapply','recover','recover-reapply',"
            "'reconcile-failed-stamps','seal','seal-readback')\n"
            "assert 'WARPDRIVE_TEST_UNTRUSTED' not in os.environ\n"
            "print(json.dumps({'state':'observed'}))\n").encode()
        manifest = {"kind": "warpdrive-local-installed-web-toolkit-proposal", "version": 1,
            "repositoryHead": "c" * 40, "draft": False, "transferred": False, "deploymentAuthorized": False,
            "stageAcknowledgementEntry": transport.STAGE_ACK, **transport.MODERN_ENTRIES,
            "sdkOperatorEntry": transport.SDK_OPERATOR, "sourceFiles": len(files),
            "pins": {name: sha256(raw).hexdigest() for name, raw in files.items()}}
        raw = current._raw(manifest)
        pin = sha256(raw).hexdigest()
        transport._publish(self.operators / "release-sdk", raw, files, pin)
        return {"destination": "release-sdk", "manifest_sha256": pin}

    def sdk_arguments(self, action="observe"):
        suffix = "d" * 12
        values = {key: None for key in current.SDK_OPTIONAL}
        values.update(action=action, operation=self.private / ("sdk-web-release-" + suffix), first=self.state.parent,
            original=self.original, previous=self.private / "previous", suffix=suffix, revision="d" * 40,
            sdk_admission_sha256="1" * 64, lineage_sha256="2" * 64, lineage_index_sha256="3" * 64,
            first_accepted_operation="web-" + "a" * 12 + "-reapply", first_accepted_plan_sha256="4" * 64)
        for name in ("operation", "previous"):
            values[name].mkdir(mode=0o700, exist_ok=True)
        return values

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

    def test_sdk_dispatch_has_fixed_source_exact_argv_clean_environment_and_unchanged_pointer(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        receipt = self.activate(self.sdk_toolkit())
        before = (self.operators / current.CURRENT).read_bytes()
        runner = Mock(return_value=SimpleNamespace(returncode=0, stdout=b'{"state":"observed"}\n', stderr=b""))
        values = self.sdk_arguments()
        result = current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"], sdk_arguments=values, runner=runner)
        argv = runner.call_args.args[0]
        self.assertEqual(argv[:3], [sys.executable, "-I", "-B"])
        self.assertEqual(argv[5], str(self.operators / "release-sdk" / "source" / transport.SDK_OPERATOR))
        self.assertEqual(argv[6:], current._sdk_argv(self.root, values))
        options = runner.call_args.kwargs
        self.assertEqual(options["timeout"], 1800)
        self.assertEqual(options["env"], {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "LC_ALL": "C", "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertIs(options["stdin"], subprocess.DEVNULL)
        self.assertEqual(options["cwd"], "/")
        self.assertNotIn("shell", options)
        self.assertEqual(result["result"], {"state": "observed"})
        self.assertFalse(result["toolkitStateChanged"])
        self.assertNotIn("applicationStateChanged", result)
        self.assertEqual((self.operators / current.CURRENT).read_bytes(), before)

    def test_sdk_dispatch_is_unavailable_on_unchanged_legacy_modern_manifest(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        receipt = self.activate()
        runner = Mock()
        with self.assertRaisesRegex(current.ToolkitHeld, "no explicitly selected fixed SDK"):
            current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"],
                sdk_arguments=self.sdk_arguments(), runner=runner)
        runner.assert_not_called()

    def test_sdk_argument_contract_rejects_extra_cmd_profile_mutable_pins_and_escaped_paths_before_child(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        receipt = self.activate(self.sdk_toolkit())
        original = self.sdk_arguments()
        changes = ({"command": "sh"}, {"profile": "arbitrary"}, {"action": "build"},
            {"operation": self.private / "wrong-operation"}, {"original": self.root}, {"first": original["operation"]},
            {"suffix": "D" * 12}, {"revision": "main"}, {"sdk_admission_sha256": "sha256:" + "1" * 64},
            {"first_accepted_operation": "arbitrary"}, {"accepted_plan_sha256": "5" * 64},
            {"sealed_index_sha256": "6" * 64}, {"core_activation_operation": "core-activation-" + "7" * 40})
        for change in changes:
            runner = Mock()
            with self.subTest(change=change), self.assertRaises((ValueError, OSError)):
                current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"],
                    sdk_arguments=original | change, runner=runner)
            runner.assert_not_called()

    def test_sdk_actions_require_exact_independent_seal_and_completed_core_pins(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        arguments = self.sdk_arguments("seal")
        with self.assertRaisesRegex(current.ToolkitHeld, "accepted plan"):
            current._sdk_argv(self.root, arguments)
        arguments["accepted_plan_sha256"] = "5" * 64
        self.assertNotIn("--sealed-index-sha256", current._sdk_argv(self.root, arguments))
        arguments["action"] = "seal-readback"
        with self.assertRaisesRegex(current.ToolkitHeld, "independent raw index"):
            current._sdk_argv(self.root, arguments)
        arguments["sealed_index_sha256"] = "6" * 64
        arguments.update(retained_core=arguments["operation"] / "retained-core.json", retained_core_sha256="7" * 64,
            core_activation_operation="core-activation-" + "8" * 40,
            core_activation_lineage_sha256="9" * 64, projected_lineage_sha256="a" * 64)
        argv = current._sdk_argv(self.root, arguments)
        for flag in ("--accepted-plan-sha256", "--sealed-index-sha256", "--retained-core", "--retained-core-sha256",
                     "--core-activation-operation", "--core-activation-lineage-sha256", "--projected-lineage-sha256"):
            self.assertIn(flag, argv)
        arguments["retained_core"] = self.private / "other-core.json"
        with self.assertRaisesRegex(current.ToolkitHeld, "paired retained Core"):
            current._sdk_argv(self.root, arguments)

    def test_sdk_nonzero_timeout_bad_output_and_postlaunch_source_drift_are_unknown_without_retry(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        receipt = self.activate(self.sdk_toolkit())
        before = (self.operators / current.CURRENT).read_bytes()
        for response in (SimpleNamespace(returncode=1, stdout=b"", stderr=b'{"state":"unresolved"}'),
                         SimpleNamespace(returncode=0, stdout=b"{}", stderr=b""),
                         SimpleNamespace(returncode=0, stdout=b'{"state":"observed"}', stderr=b"unexpected"),
                         SimpleNamespace(returncode=0, stdout=b"x" * (current.SDK_MAX_OUTPUT + 1), stderr=b"")):
            runner = Mock(return_value=response)
            with self.subTest(response=response), self.assertRaises(current.ToolkitUnknown):
                current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"],
                    sdk_arguments=self.sdk_arguments(), runner=runner)
            self.assertEqual(runner.call_count, 1)
        runner = Mock(side_effect=subprocess.TimeoutExpired("fixed-sdk", current.SDK_SECONDS))
        with self.assertRaises(current.ToolkitUnknown):
            current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"], sdk_arguments=self.sdk_arguments(), runner=runner)
        self.assertEqual(runner.call_count, 1)
        self.assertEqual((self.operators / current.CURRENT).read_bytes(), before)
        source = self.operators / "release-sdk" / "source" / transport.SDK_OPERATOR
        def drift(*_a, **_k):
            source.write_bytes(b"changed after actual SDK dispatch\n")
            return SimpleNamespace(returncode=0, stdout=b'{"state":"accepted"}', stderr=b"")
        with self.assertRaises(current.ToolkitUnknown):
            current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"],
                sdk_arguments=self.sdk_arguments(), runner=drift)
        self.assertEqual((self.operators / current.CURRENT).read_bytes(), before)

    def test_sdk_pending_activation_wrong_pointer_and_changed_data_hold_before_child(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        receipt = self.activate(self.sdk_toolkit())
        runner = Mock()
        pending = self.operators / current.PENDING
        pending.write_bytes(b"pending activation requires readback\n")
        pending.chmod(0o600)
        with self.assertRaisesRegex(current.ToolkitHeld, "Reconcile pending activation"):
            current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"], sdk_arguments=self.sdk_arguments(), runner=runner)
        pending.unlink()
        with self.assertRaises(current.ToolkitHeld):
            current.run_sdk(self.root, expected_current_sha256="0" * 64, sdk_arguments=self.sdk_arguments(), runner=runner)
        data = self.operators / "release-sdk" / "source" / next(iter(transport.SDK_DATA))
        data.write_bytes(b'{"changed":true}\n')
        with self.assertRaises(ValueError):
            current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"], sdk_arguments=self.sdk_arguments(), runner=runner)
        runner.assert_not_called()

    def test_sdk_lock_context_exit_failure_after_child_is_unknown(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        receipt = self.activate(self.sdk_toolkit())
        original_lock = current._locked
        @contextmanager
        def changed_at_exit(installation):
            with original_lock(installation) as parent:
                yield parent
            raise current.ToolkitHeld("Toolkit directory identity changed at context exit")
        runner = Mock(return_value=SimpleNamespace(returncode=0, stdout=b'{"state":"accepted"}', stderr=b""))
        with patch.object(current, "_locked", changed_at_exit), self.assertRaises(current.ToolkitUnknown):
            current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"],
                sdk_arguments=self.sdk_arguments(), runner=runner)
        self.assertEqual(runner.call_count, 1)

    def test_sdk_final_stdout_failure_is_unknown_after_successful_dispatch(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        arguments = current._sdk_argv(self.root, self.sdk_arguments("stage"))
        argv = ["--installation-root", str(self.root), "sdk-web", "stage", "--expected-current-sha256", "1" * 64,
                *arguments[1:]]
        for phase in ("write", "flush"):
            output = Mock()
            getattr(output, phase).side_effect = BrokenPipeError("lost SDK reply")
            with self.subTest(phase=phase), patch.object(current.os, "geteuid", return_value=0), patch.object(current.os, "umask"), \
                    patch.object(current, "run_sdk", return_value={"result": {"state": "accepted"}}) as run, \
                    patch("sys.stdout", output), patch("sys.stderr", new_callable=io.StringIO) as error:
                result = current.main(argv)
            self.assertEqual(result, 1)
            self.assertEqual(json.loads(error.getvalue()), {"state": "unknown", "errorType": "ToolkitUnknown"})
            self.assertEqual(run.call_count, 1)

    def test_real_sdk_fixture_subprocess_is_isolated_and_never_loads_real_operator(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        receipt = self.activate(self.sdk_toolkit())
        with patch.dict(os.environ, {"WARPDRIVE_TEST_UNTRUSTED": "must not reach fixed child"}):
            result = current.run_sdk(self.root, expected_current_sha256=receipt["currentSha256"],
                                     sdk_arguments=self.sdk_arguments())
        self.assertEqual(result["result"], {"state": "observed"})

    def test_sdk_cli_is_fixed_without_arbitrary_script_command_or_profile_arguments(self):
        self.enterContext(patch.object(current, "SDK_PRIVATE", self.private))
        arguments = current._sdk_argv(self.root, self.sdk_arguments("stage"))
        valid = ["--installation-root", str(self.root), "sdk-web", "stage", "--expected-current-sha256", "1" * 64,
                 *arguments[1:]]
        for extra in ("--script", "--command", "--profile"):
            with self.subTest(extra=extra), patch("sys.stderr"), self.assertRaises(SystemExit):
                current.main([*valid, extra, "/tmp/untrusted.py"])


if __name__ == "__main__":
    unittest.main()
