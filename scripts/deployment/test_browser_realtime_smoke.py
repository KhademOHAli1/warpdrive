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

try:
    from . import browser_realtime_smoke as smoke
except ImportError:
    import browser_realtime_smoke as smoke

SHA = "a" * 40


def profile():
    return {"revision": SHA, "baseUrl": "https://127.0.0.1:49000", "databasePort": 49001,
            "email": "synthetic@example.invalid", "password": "synthetic-password-only-2026"}


def environment():
    return {"DATABASE_URL": "postgres://smoke:synthetic@127.0.0.1:49001/warpdrive_image_smoke",
            "NODE_ENV": "production", "BUN_OPTIONS": "--no-env-file", "AUTH_GOOGLE_ENABLED": "false",
            "NEWSLETTER_DELIVERY_ENABLED": "false", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false",
            "DISABLE_TELEMETRY": "true", "DISABLE_UPDATE_CHECK": "true", "AUTH_SMTP_HOST": "127.0.0.1", "AUTH_SMTP_PORT": "9"}


def result():
    return {"schemaVersion": 1, "success": True, "revision": SHA, "nativePasswordLogin": True,
            "persistentDocumentAndMounts": True, "freshRealTicketAndAuth": True,
            "missedNoticeRecoveredAfterAckRefetch": True, "resumedRealNotificationFrame": True,
            "unread": 2, "maxActiveSockets": 1, "notificationFrameCount": 1,
            "metrics": {"pageErrors": 0, "blockedRequests": 0, "blockedWebSockets": 0, "loginResponses": 1,
                        "ticketRequests": 2, "ticketResponses": 2, "mainNavigations": 2, "notificationRequests": 6},
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
                 (profile(), {**environment(), "AUTH_SMTP_HOST": "provider.example.com"}),
                 (profile(), {**environment(), "NEWSLETTER_DELIVERY_ENABLED": "true"})]
        for value, env in cases:
            with self.subTest(value=value, env=env), self.assertRaises(smoke.BrowserRealtimeError):
                smoke.admit_profile(value, env)

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
        for name in ("load", "setup", "seed", "journey"):
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


if __name__ == "__main__":
    unittest.main()
