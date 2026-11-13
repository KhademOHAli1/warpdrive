"""Control/admission/secret guards only; actual Chromium CI must qualify the user journey."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

try:
    from . import browser_realtime_smoke as smoke
except ImportError:
    import browser_realtime_smoke as smoke

SHA = "a" * 40


def profile():
    return {"revision": SHA, "baseUrl": "https://127.0.0.1:49000", "databasePort": 49001,
            "email": "synthetic@example.invalid", "password": "synthetic-password-only-2026",
            "adminEmail": "admin@example.invalid", "adminPassword": "synthetic-admin-password-2026",
            "actorId": "00000000-0000-4000-8000-000000000001", "adminId": "00000000-0000-4000-8000-000000000002",
            "pipelineId": "00000000-0000-4000-8000-000000000003", "permissionId": "00000000-0000-4000-8000-000000000004"}


def environment():
    return {"DATABASE_URL": "postgres://smoke_runtime:synthetic@127.0.0.1:49001/warpdrive_image_smoke",
            "NODE_ENV": "production", "BUN_OPTIONS": "--no-env-file", "AUTH_GOOGLE_ENABLED": "false",
            "NEWSLETTER_DELIVERY_ENABLED": "false", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false",
            "DISABLE_TELEMETRY": "true", "DISABLE_UPDATE_CHECK": "true", "AUTH_SMTP_HOST": "127.0.0.1", "AUTH_SMTP_PORT": "9",
            "MIGRATION_DATABASE_URL": "", "MIGRATION_DATABASE_URL_FILE": ""}


def result():
    return {"schemaVersion": 1, "success": True, "revision": SHA, "nativePasswordLogin": True,
            "persistentDocumentAndMounts": True, "freshRealTicketAndAuth": True,
            "missedNoticeRecoveredAfterAckRefetch": True, "resumedRealNotificationFrame": True,
            "unread": 2, "maxActiveSockets": 1, "notificationFrameCount": 1,
            "metrics": {"pageErrors": 0, "blockedRequests": 0, "blockedWebSockets": 0, "loginResponses": 1,
                        "ticketRequests": 2, "ticketResponses": 2, "mainNavigations": 2, "notificationRequests": 6},
            "operations": {**dict.fromkeys(smoke.OPERATIONS_FLAGS, True), "forbiddenResponses": 4, "readResponses": 8, "regrantIdleWindowMs": 65000},
            "limitations": ["Synthetic fixture only"]}


class Process:
    def __init__(self, output="", code=0):
        self.stdin, self.stdout, self.stderr = io.StringIO(), io.StringIO(output), io.StringIO("")
        self.returncode, self.pid = code, 987654321

    def poll(self):
        return self.returncode

    def wait(self, **options):
        return self.returncode


class AdmissionTests(unittest.TestCase):
    def test_legacy_bundle_cannot_qualify_current_application_producer(self):
        with patch.object(smoke, "load_input_receipt") as load, patch.object(smoke, "verify_current_inputs") as verify:
            with self.assertRaisesRegex(smoke.BrowserRealtimeError, "Version2"):
                smoke.admit_bundle_source(Path("/source"), Path("/bundle"), {"schemaVersion": 1}, SHA)
            load.assert_not_called()
            verify.assert_not_called()

    def test_retained_receipt_requires_fresh_graph_and_raw_head_verification(self):
        receipt = {"inputPolicySha256": "a" * 64, "context": {"buildArgs": {"APP_VERSION": "fixture"}}}
        candidate = {"schemaVersion": 2, "inputProvenance": {"state": "current-source-inputs-bound",
                     "receiptSha256": smoke.input_receipt_hash(receipt), "inputPolicySha256": "a" * 64}}
        with patch.object(smoke, "load_input_receipt", return_value=receipt) as load, patch.object(smoke, "verify_current_inputs") as verify:
            result = smoke.admit_bundle_source(Path("/source"), Path("/bundle"), candidate, SHA)
            load.assert_called_once_with(Path("/bundle/component-inputs.json"))
            verify.assert_called_once_with(Path("/source"), receipt, expected_revision=SHA)
            self.assertEqual(result, {"freshInputReceipt": True, "rawHeadBlobBinding": True})
            verify.side_effect = RuntimeError("changed input")
            with self.assertRaisesRegex(RuntimeError, "changed input"):
                smoke.admit_bundle_source(Path("/source"), Path("/bundle"), candidate, SHA)

    def test_replaced_self_consistent_receipt_cannot_change_retained_build_context(self):
        original = {"inputPolicySha256": "a" * 64, "context": {"buildArgs": {"APP_VERSION": "original"}}}
        replacement = {"inputPolicySha256": "b" * 64, "context": {"buildArgs": {"APP_VERSION": "replacement"}}}
        candidate = {"schemaVersion": 2, "inputProvenance": {"state": "current-source-inputs-bound",
                     "receiptSha256": smoke.input_receipt_hash(original), "inputPolicySha256": "a" * 64}}
        with patch.object(smoke, "load_input_receipt", return_value=replacement), patch.object(smoke, "verify_current_inputs") as verify:
            with self.assertRaisesRegex(smoke.BrowserRealtimeError, "retained candidate"):
                smoke.admit_bundle_source(Path("/source"), Path("/bundle"), candidate, SHA)
            verify.assert_not_called()
        candidate["inputProvenance"]["receiptSha256"] = smoke.input_receipt_hash(replacement)
        with patch.object(smoke, "load_input_receipt", return_value=replacement), patch.object(smoke, "verify_current_inputs") as verify:
            with self.assertRaisesRegex(smoke.BrowserRealtimeError, "retained candidate"):
                smoke.admit_bundle_source(Path("/source"), Path("/bundle"), candidate, SHA)
            verify.assert_not_called()

    def test_cli_imports_do_not_create_unknown_python_source_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "scripts/deployment"
            target.mkdir(parents=True)
            for source in Path(smoke.__file__).parent.glob("*.py"):
                shutil.copyfile(source, target / source.name)
            for path in smoke.SOURCE_HARNESS:
                file = root / path
                if not file.exists():
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_text("committed synthetic fixture placeholder\n")
            def host(arguments):
                return subprocess.run(arguments, cwd=root, capture_output=True, text=True, timeout=10, check=True).stdout
            host(["git", "init", "--quiet"])
            host(["git", "add", "."])
            host(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "synthetic source"])
            env = {key: value for key, value in os.environ.items() if key != "PYTHONDONTWRITEBYTECODE"}
            subprocess.run([sys.executable, str(target / "browser_realtime_smoke.py"), "--help"], cwd=root,
                           env=env, capture_output=True, text=True, timeout=10, check=True)
            self.assertEqual(list(root.rglob("__pycache__")), [])
            smoke.admit_source(host, host(["git", "rev-parse", "HEAD"]).strip())

    def test_exact_source_rejects_untracked_substitution_including_ignored_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def host(arguments):
                result = subprocess.run(arguments, cwd=root, capture_output=True, text=True, timeout=10)
                if result.returncode:
                    raise smoke.BrowserRealtimeError("Fixture git command rejected")
                return result.stdout
            host(["git", "init", "--quiet"])
            for path in smoke.SOURCE_HARNESS:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("committed synthetic fixture placeholder\n")
            (root / ".gitignore").write_text("src/ignored.ts\n")
            host(["git", "add", "."])
            host(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "synthetic source"])
            revision = host(["git", "rev-parse", "HEAD"]).strip()
            smoke.admit_source(host, revision)
            for path in ("scripts/untracked-producer.mjs", "src/ignored.ts"):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("untracked replacement must not qualify\n")
                # The old diff-only admission incorrectly succeeds for both forms.
                host(["git", "diff", "--quiet", "HEAD", "--"])
                with self.subTest(path=path), self.assertRaises(smoke.BrowserRealtimeError):
                    smoke.admit_source(host, revision)
                target.unlink()
            smoke.admit_source(host, revision)

    def test_only_loopback_synthetic_source_profile_is_accepted(self):
        smoke.admit_profile(profile(), environment())
        cases = [({**profile(), "baseUrl": "https://production.example.com"}, environment()),
                 ({**profile(), "baseUrl": "http://127.0.0.1:49000"}, environment()),
                 (profile(), {**environment(), "DATABASE_URL": "postgres://production:secret@127.0.0.1:49001/live"}),
                 (profile(), {**environment(), "DATABASE_URL_FILE": "/private/production"}),
                 (profile(), {**environment(), "DATABASE_URL": "postgres://smoke:synthetic@127.0.0.1:49001/warpdrive_image_smoke"}),
                 (profile(), {**environment(), "MIGRATION_DATABASE_URL": "postgres://smoke:private@127.0.0.1:49001/warpdrive_image_smoke"}),
                 (profile(), {**environment(), "MIGRATION_DATABASE_URL_FILE": "/private/owner"}),
                 (profile(), {**environment(), "AUTH_SMTP_HOST": "provider.example.com"}),
                 (profile(), {**environment(), "NEWSLETTER_DELIVERY_ENABLED": "true"}),
                 ({**profile(), "adminEmail": "admin@production.example.com"}, environment()),
                 ({**profile(), "adminPassword": "short"}, environment()),
                 ({**profile(), "adminId": profile()["actorId"]}, environment()),
                 ({**profile(), "adminEmail": profile()["email"]}, environment())]
        for value, env in cases:
            with self.subTest(value=value, env=env), self.assertRaises(smoke.BrowserRealtimeError):
                smoke.admit_profile(value, env)
        for key in ("MIGRATION_DATABASE_URL", "MIGRATION_DATABASE_URL_FILE"):
            missing = environment()
            del missing[key]
            with self.subTest(missing=key), self.assertRaises(smoke.BrowserRealtimeError):
                smoke.admit_profile(profile(), missing)

    def test_source_forwarder_keeps_fixed_runtime_identity_and_removes_owner_credentials(self):
        application = {**environment(), "DATABASE_URL": "postgres://smoke_runtime:synthetic@postgres:5432/warpdrive_image_smoke",
                       "MIGRATION_DATABASE_URL": "postgres://smoke:owner-private@postgres:5432/warpdrive_image_smoke",
                       "MIGRATION_DATABASE_URL_FILE": "/private/owner-url"}
        forwarded = smoke.source_runtime_environment({"MIGRATION_DATABASE_URL": "host-owner-private"}, application, 49001)
        self.assertEqual(forwarded["DATABASE_URL"], environment()["DATABASE_URL"])
        self.assertEqual(forwarded["MIGRATION_DATABASE_URL"], "")
        self.assertEqual(forwarded["MIGRATION_DATABASE_URL_FILE"], "")
        smoke.admit_profile(profile(), forwarded)
        for username in ("smoke", "postgres", "other_runtime"):
            with self.subTest(username=username), self.assertRaises(smoke.BrowserRealtimeError):
                smoke.source_runtime_environment({}, {**application, "DATABASE_URL": f"postgres://{username}:private@postgres:5432/warpdrive_image_smoke"}, 49001)

    def test_phase_requires_complete_proof_and_refuses_credentials_or_payload_fields(self):
        for phase, facts in smoke.PHASES.items():
            message = {"phase": phase, **facts}
            smoke.admit_message(message)
            for key in facts:
                incomplete = dict(message)
                del incomplete[key]
                with self.subTest(phase=phase, missing=key), self.assertRaises(smoke.BrowserRealtimeError):
                    smoke.admit_message(incomplete)
            for key in ("cookie", "ticket", "framePayload", "postData", "storageState"):
                with self.subTest(phase=phase, secret=key), self.assertRaises(smoke.BrowserRealtimeError):
                    smoke.admit_message({**message, key: "must-not-be-retained"})

    def test_browser_result_cannot_omit_resync_or_stream_proof_or_hide_errors(self):
        smoke.admit_result(result(), SHA)
        for key, value in (("missedNoticeRecoveredAfterAckRefetch", False), ("resumedRealNotificationFrame", False),
                           ("persistentDocumentAndMounts", False), ("maxActiveSockets", 2), ("unread", 1),
                           ("revision", "b" * 40), ("schemaVersion", True)):
            with self.subTest(key=key), self.assertRaises(smoke.BrowserRealtimeError):
                smoke.admit_result({**result(), key: value}, SHA)
        for key in ("pageErrors", "blockedRequests", "blockedWebSockets"):
            bad = result()
            bad["metrics"][key] = 1
            with self.subTest(metric=key), self.assertRaises(smoke.BrowserRealtimeError):
                smoke.admit_result(bad, SHA)
        with self.assertRaises(smoke.BrowserRealtimeError):
            smoke.admit_result({**result(), "cookies": ["private"]}, SHA)

    def test_operations_result_requires_all_observed_guards_and_no_private_details(self):
        for key in smoke.OPERATIONS_FLAGS:
            for missing in (True, False):
                value = result()
                if missing:
                    del value["operations"][key]
                else:
                    value["operations"][key] = False
                with self.subTest(key=key, missing=missing), self.assertRaises(smoke.BrowserRealtimeError):
                    smoke.admit_result(value, SHA)
        for key, value in (("forbiddenResponses", 3), ("forbiddenResponses", True), ("readResponses", 7), ("readResponses", True), ("regrantIdleWindowMs", 64999), ("regrantIdleWindowMs", True), ("regrantIdleWindowMs", 75001), ("actorId", "private"), ("receiptPayload", "private")):
            candidate = result()
            candidate["operations"][key] = value
            with self.subTest(key=key), self.assertRaises(smoke.BrowserRealtimeError):
                smoke.admit_result(candidate, SHA)

    def test_fixture_actions_need_exact_finite_proof_and_reject_uncommitted_authority(self):
        fixtures = {
            "seed": {"nativePasswordIdentity": True, "nativeAdminPasswordIdentity": True, "forgedSession": False},
            "offline": {"actualProducer": True, "notificationCount": 1, "emailEnabled": False},
            "online": {"actualProducer": True, "notificationCount": 2, "emailEnabled": False},
            "operations-seed": {"actualOperationsRepository": True, "enrolledSources": 2, "receipts": 4, "currentObservations": 4, "recoveredIncidents": 1},
            "operations-revoke": {"committedAuthorityChange": True, "nativeMfaSession": True, "admin": False, "fixtureMutationOnly": True},
            "operations-regrant": {"committedAuthorityChange": True, "nativeMfaSession": True, "admin": True, "fixtureMutationOnly": True},
        }
        for action, facts in fixtures.items():
            value = {"ok": True, "action": action, "sourceRevision": SHA, **facts}
            smoke.admit_fixture_result(value, action, SHA)
            for key in facts:
                incomplete = dict(value)
                del incomplete[key]
                with self.subTest(action=action, key=key), self.assertRaises(smoke.BrowserRealtimeError):
                    smoke.admit_fixture_result(incomplete, action, SHA)
            for extra in ("adminPassword", "sourceBinding", "rawPayload", "cookie"):
                with self.subTest(action=action, extra=extra), self.assertRaises(smoke.BrowserRealtimeError):
                    smoke.admit_fixture_result({**value, extra: "private"}, action, SHA)
        with self.assertRaises(smoke.BrowserRealtimeError):
            smoke.admit_fixture_result({"ok": True, "action": "operations-revoke", "sourceRevision": SHA,
                                        "committedAuthorityChange": False, "nativeMfaSession": True, "admin": False, "fixtureMutationOnly": True}, "operations-revoke", SHA)

    def test_native_authenticator_uses_rfc6238_vectors_and_rejects_invalid_inputs(self):
        module = (smoke.ROOT / "scripts/browser-operations.mjs").as_uri()
        script = f"""import assert from 'node:assert/strict';
const {{operationsTotp,operationsProgressStage}} = await import({json.dumps(module)});
const key='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
for(const [seconds,code] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']])
  assert.equal(operationsTotp(key,seconds*1000),code);
for(const invalid of ['',null,'bad key','A'.repeat(129)]) assert.throws(()=>operationsTotp(invalid,59000));
for(const invalid of [-1,NaN,Infinity,1.5]) assert.throws(()=>operationsTotp(key,invalid));
assert.equal(operationsProgressStage('operations-admin-setup-key-visible'),'operations-admin-setup-key-visible');
for(const invalid of ['private-password', 'otpauth://private', null, {{secret:'private'}}]) {{
  assert.throws(()=>operationsProgressStage(invalid),error=>error.message==='Unknown operations browser progress' && error.cause===undefined);
}}
"""
        tested = subprocess.run(["node", "--input-type=module", "--eval", script], capture_output=True, text=True, timeout=10)
        self.assertEqual(tested.returncode, 0, "Native authenticator vector control failed")
        self.assertEqual(tested.stdout, "")

    def test_actual_browser_failure_writer_discards_secret_bearing_playwright_error(self):
        source = (smoke.ROOT / "scripts/browser-realtime.mjs").read_text()
        start = source.index('try {\n  const { chromium } = await import(')
        handler = source.rindex('} catch {')
        self.assertLess(start, handler)
        private = "synthetic-private-password-TOTP-recovery-value"
        # Fault before importing Chromium. Keep actual admission, catch/report and
        # finally code; no browser, application server or mocked UI is exercised.
        injected = source[:start] + 'try {\nstage=operationsProgressStage("operations-admin-setup-key-visible");\nthrow Object.assign(new Error(' + json.dumps("locator.fill call log " + private) + '),{cause:new Error(' + json.dumps(private) + '),stack:' + json.dumps("private Playwright stack " + private) + '});\n' + source[handler:]
        injected = injected.replace('"./browser-operations.mjs"', json.dumps((smoke.ROOT / "scripts/browser-operations.mjs").as_uri()))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            output.mkdir()
            script = root / "injected-browser.mjs"
            script.write_text(injected)
            bound = root / "private-profile.json"
            bound.write_text(json.dumps({**profile(), "outputDir": str(output)}))
            bound.chmod(0o600)
            tested = subprocess.run(["node", str(script)], env={**os.environ, "BROWSER_REALTIME_PROFILE": str(bound)}, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
            self.assertEqual(tested.returncode, 1)
            self.assertEqual(tested.stdout, "")
            self.assertEqual(tested.stderr.strip(), '{"event":"browser.realtime.failed","stage":"operations-admin-setup-key-visible"}')
            raw = (output / "browser.json").read_text()
            self.assertNotIn(private, raw)
            self.assertNotIn("cause", raw)
            self.assertNotIn("stack", raw)
            recorded = json.loads(raw)
            self.assertEqual(set(recorded), {"schemaVersion", "success", "revision", "stage", "failure", "metrics"})
            self.assertFalse(recorded["success"])
            self.assertEqual(recorded["stage"], "operations-admin-setup-key-visible")
            self.assertEqual(recorded["failure"], "Required persistent-tab realtime stage failed")
            self.assertEqual(recorded["metrics"], dict.fromkeys(result()["metrics"], 0))
            self.assertEqual(sorted(path.name for path in output.iterdir()), ["browser.json"])



class ProcessGuardTests(unittest.TestCase):
    def test_browser_uses_owned_session_and_secret_free_protocol_only(self):
        initial = {"phase": "initial-ready", **smoke.PHASES["initial-ready"]}
        process = Process(json.dumps(initial) + "\n")
        calls = []

        def runner(arguments, **options):
            calls.append((arguments, options))
            return process

        browser = smoke.BrowserProcess({"BROWSER_REALTIME_PROFILE": "/owned/private-profile.json"}, runner)
        self.assertEqual(browser.wait("initial-ready", 1), initial)
        self.assertTrue(calls[0][1]["start_new_session"])
        self.assertFalse(calls[0][1].get("shell", False))
        browser.finished()
        self.assertEqual(browser.close(), [])

    def test_unsafe_stdout_is_rejected_without_retaining_its_secret_value(self):
        process = Process('{"phase":"complete","cookie":"private-cookie-value"}\n')
        browser = smoke.BrowserProcess({}, lambda *args, **options: process)
        for reader in browser.readers:
            reader.join(1)
        with self.assertRaises(smoke.BrowserRealtimeError) as error:
            browser.wait("complete", 1)
        self.assertNotIn("private-cookie-value", str(error.exception))
        self.assertEqual(list(browser.errors), [])
        browser.close()

    def test_success_message_cannot_mask_nonzero_browser_exit(self):
        process = Process("", code=1)
        browser = smoke.BrowserProcess({}, lambda *args, **options: process)
        with self.assertRaises(smoke.BrowserRealtimeError):
            browser.finished()
        browser.close()

    def test_coordination_cannot_inject_arbitrary_browser_commands(self):
        process = Process()
        browser = smoke.BrowserProcess({}, lambda *args, **options: process)
        with self.assertRaises(smoke.BrowserRealtimeError):
            browser.send("navigate-to-production")
        self.assertEqual(process.stdin.getvalue(), "")
        browser.close()


class ReportingTests(unittest.TestCase):
    @staticmethod
    def no_op_phases(value):
        for name in ("load", "setup", "seed", "journey", "verify_source_inputs"):
            setattr(value, name, lambda: {"unitFixture": True})

    def test_failure_does_not_claim_browser_recovery_and_previous_evidence_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            value = smoke.BrowserRealtimeSmoke(None, Path("bundle"), SHA, Path(directory) / "run")
            self.no_op_phases(value)

            def fail():
                raise smoke.BrowserRealtimeError("Fresh real ticket/recovery not observed")

            value.journey = fail
            self.assertFalse(value.run())
            self.assertEqual(value.report["checks"][-1]["status"], "failed")
            self.assertFalse(value.report["success"])
            with self.assertRaises(FileExistsError):
                value.run()

    def test_cleanup_failure_prevents_success_even_when_browser_proof_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            value = smoke.BrowserRealtimeSmoke(None, Path("bundle"), SHA, Path(directory) / "run")
            self.no_op_phases(value)
            value.cleanup = lambda: ["owned browser relay cleanup failed"]
            self.assertFalse(value.run())
            self.assertFalse(value.report["cleanup"]["success"])
            self.assertTrue(all(row["status"] == "passed" for row in value.report["checks"]))

    def test_source_change_after_browser_prevents_success(self):
        with tempfile.TemporaryDirectory() as directory:
            value = smoke.BrowserRealtimeSmoke(None, Path("bundle"), SHA, Path(directory) / "run")
            self.no_op_phases(value)
            def changed():
                raise smoke.BrowserRealtimeError("Source inputs changed after browser")
            value.verify_source_inputs = changed
            self.assertFalse(value.run())
            self.assertEqual(value.report["checks"][-1],
                             {"name": "source-inputs-unchanged-after-browser", "status": "failed"})
            self.assertTrue(value.report["cleanup"]["success"])
            self.assertFalse(value.report["success"])


class OperationsControllerTests(unittest.TestCase):
    def test_role_changes_commit_before_browser_refresh_and_require_both_hidden_then_recovered(self):
        calls = []
        value = smoke.BrowserRealtimeSmoke(None, Path("bundle"), SHA, Path("unused"))
        value.produce = lambda action: calls.append(("produce", action))

        class Browser:
            def send(self, command):
                calls.append(("send", command))

            def wait(self, phase, timeout):
                calls.append(("wait", phase))

        value.browser = Browser()
        value.operations_journey()
        self.assertEqual(calls, [
            ("produce", "operations-seed"), ("send", "operations-seeded"), ("wait", "operations-ready"),
            ("produce", "operations-revoke"), ("send", "operations-revoked"), ("wait", "operations-denied"),
            ("produce", "operations-regrant"), ("send", "operations-regranted"), ("wait", "operations-restored"),
        ])

    def test_failed_revoke_never_instructs_browser_or_attempts_regrant(self):
        calls = []
        value = smoke.BrowserRealtimeSmoke(None, Path("bundle"), SHA, Path("unused"))

        def produce(action):
            calls.append(action)
            if action == "operations-revoke":
                raise smoke.BrowserRealtimeError("Fixture authority commit failed")

        class Browser:
            def send(self, command):
                calls.append(command)

            def wait(self, phase, timeout):
                calls.append(phase)

        value.produce, value.browser = produce, Browser()
        with self.assertRaises(smoke.BrowserRealtimeError):
            value.operations_journey()
        self.assertEqual(calls, ["operations-seed", "operations-seeded", "operations-ready", "operations-revoke"])

    def test_unproven_api403_hiding_blocks_regrant_and_recovery_claim(self):
        calls = []
        value = smoke.BrowserRealtimeSmoke(None, Path("bundle"), SHA, Path("unused"))
        value.produce = lambda action: calls.append(action)

        class Browser:
            def send(self, command):
                calls.append(command)

            def wait(self, phase, timeout):
                calls.append(phase)
                if phase == "operations-denied":
                    raise smoke.BrowserRealtimeError("Both mounted sections did not hide private facts")

        value.browser = Browser()
        with self.assertRaises(smoke.BrowserRealtimeError):
            value.operations_journey()
        self.assertEqual(calls, ["operations-seed", "operations-seeded", "operations-ready",
                                "operations-revoke", "operations-revoked", "operations-denied"])


if __name__ == "__main__":
    unittest.main()
