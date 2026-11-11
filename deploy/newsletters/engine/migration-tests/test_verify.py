"""Unit checks of runner failure/cleanup/report guards, without PostgreSQL or engine."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location("engine_migration_verify", Path(__file__).with_name("verify.py"))
verify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify)


def bare_fixture():
    # Avoid Fixture.__init__: unit checks must open no engine log or database paths.
    return object.__new__(verify.MigrationFixture)


class MigrationOutcomeTests(unittest.TestCase):
    def test_success_requirement_rejects_nonzero_exit(self):
        fixture = bare_fixture()
        fixture.command = Mock(return_value=subprocess.CompletedProcess([], 1))
        with self.assertRaisesRegex(AssertionError, "explicit migration exit"):
            fixture.migrate()
        fixture.command.assert_called_once_with(["--migrate", "--yes"], "consent")

    def test_failure_requirement_rejects_zero_exit(self):
        fixture = bare_fixture()
        fixture.command = Mock(return_value=subprocess.CompletedProcess([], 0))
        with self.assertRaisesRegex(AssertionError, "accepted an invalid schema"):
            fixture.migrate(success=False)

    def test_matching_outcomes_return_actual_result(self):
        fixture = bare_fixture()
        for code, success in ((0, True), (1, False), (7, False)):
            with self.subTest(code=code):
                result = subprocess.CompletedProcess([], code)
                fixture.command = Mock(return_value=result)
                self.assertIs(fixture.migrate("owned_fixture", success=success), result)


class StartupRejectionTests(unittest.TestCase):
    def fixture_with_process(self, process, snapshots):
        fixture = bare_fixture()
        fixture.serve = process
        fixture.launch = Mock(return_value=process)
        fixture.snapshot = Mock(side_effect=snapshots)
        return fixture

    def test_zero_exit_cannot_prove_rejection(self):
        process = Mock()
        process.wait.return_value = 0
        fixture = self.fixture_with_process(process, [{"state": "before"}])
        with self.assertRaisesRegex(AssertionError, "startup exit"):
            fixture.rejected_start("missing receipt")
        self.assertEqual(fixture.snapshot.call_count, 1)

    def test_nonzero_rejection_still_fails_if_data_changed(self):
        process = Mock()
        process.wait.return_value = 1
        fixture = self.fixture_with_process(process, [{"state": "before"}, {"state": "after"}])
        with self.assertRaisesRegex(AssertionError, "writes nothing"):
            fixture.rejected_start("catalog drift")

    def test_matching_rejection_requires_unchanged_snapshot(self):
        process = Mock()
        process.wait.return_value = 1
        fixture = self.fixture_with_process(process, [{"state": "same"}, {"state": "same"}])
        fixture.rejected_start("future receipt")
        self.assertEqual(fixture.snapshot.call_count, 2)

    def test_timeout_fails_and_terminates_only_owned_process(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired(["owned-engine"], 9), 0]
        fixture = self.fixture_with_process(process, [{"state": "before"}])
        with self.assertRaisesRegex(AssertionError, "did not reject"):
            fixture.rejected_start("startup remained live")
        process.terminate.assert_called_once_with()
        process.kill.assert_not_called()
        self.assertEqual([call.kwargs["timeout"] for call in process.wait.call_args_list], [9, 5])

    def test_timeout_escalation_reaps_only_owned_process(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = [
            subprocess.TimeoutExpired(["owned-engine"], 9),
            subprocess.TimeoutExpired(["owned-engine"], 5), -9,
        ]
        fixture = self.fixture_with_process(process, [{"state": "before"}])
        with self.assertRaisesRegex(AssertionError, "did not reject"):
            fixture.rejected_start("wedged startup")
        process.terminate.assert_called_once_with()
        process.kill.assert_called_once_with()
        self.assertEqual(process.wait.call_count, 3)


class AdvisoryLockCleanupTests(unittest.TestCase):
    def holder(self):
        holder = Mock()
        holder.poll.return_value = None
        holder.wait.return_value = 0
        holder.stdout.readline.return_value = "migration_fixture_locked\n"
        return holder

    def fixture(self):
        return SimpleNamespace(psql_args=lambda: ["owned-psql", "owned-socket"],
                               root=Path("/owned-fixture"), env={"FIXTURE": "true"})

    @contextlib.contextmanager
    def mocked_holder(self, holder):
        with patch.object(verify.subprocess, "Popen", return_value=holder) as launch, \
             patch.object(verify.select, "select", return_value=([holder.stdout], [], [])):
            yield launch

    def assert_released_only_holder(self, holder, launch):
        self.assertEqual(launch.call_count, 1)
        self.assertEqual(launch.call_args.args[0], ["owned-psql", "owned-socket"])
        writes = "".join(call.args[0] for call in holder.stdin.write.call_args_list)
        self.assertIn("pg_advisory_lock(900731613,90)", writes)
        self.assertIn("pg_advisory_unlock(900731613,90)", writes)
        holder.stdin.close.assert_called_once_with()
        holder.stdout.close.assert_called_once_with()

    def test_normal_release_is_verified(self):
        holder = self.holder()
        with self.mocked_holder(holder) as launch:
            with verify.held_lock(self.fixture(), verify.FENCE_KEY) as yielded:
                self.assertIs(yielded, holder)
        holder.wait.assert_called_once_with(timeout=5)
        holder.kill.assert_not_called()
        self.assert_released_only_holder(holder, launch)

    def test_body_exception_still_releases_holder(self):
        holder = self.holder()
        with self.mocked_holder(holder) as launch:
            with self.assertRaisesRegex(RuntimeError, "body failed"):
                with verify.held_lock(self.fixture(), verify.FENCE_KEY):
                    raise RuntimeError("body failed")
        self.assert_released_only_holder(holder, launch)

    def test_nonzero_release_cannot_be_swallowed(self):
        holder = self.holder()
        holder.wait.return_value = 3
        with self.mocked_holder(holder):
            with self.assertRaisesRegex(AssertionError, "lock session exit"):
                with verify.held_lock(self.fixture(), verify.FENCE_KEY):
                    pass
        holder.stdin.close.assert_called_once_with()
        holder.stdout.close.assert_called_once_with()

    def test_early_holder_exit_is_not_a_valid_lifetime_lock(self):
        holder = self.holder()
        holder.poll.return_value = 1
        with self.mocked_holder(holder):
            with self.assertRaisesRegex(AssertionError, "exited before release"):
                with verify.held_lock(self.fixture(), verify.FENCE_KEY):
                    pass

    def test_cleanup_timeout_reaps_holder_and_fails(self):
        holder = self.holder()
        holder.wait.side_effect = [subprocess.TimeoutExpired(["owned-psql"], 5), -9]
        with self.mocked_holder(holder):
            with self.assertRaisesRegex(AssertionError, "forced termination"):
                with verify.held_lock(self.fixture(), verify.FENCE_KEY):
                    pass
        holder.kill.assert_called_once_with()
        self.assertEqual(holder.wait.call_count, 2)

    def test_broken_release_pipe_reaps_holder_and_fails(self):
        holder = self.holder()
        holder.stdin.write.side_effect = [None, BrokenPipeError("owned holder pipe closed")]
        holder.wait.return_value = -9
        with self.mocked_holder(holder):
            with self.assertRaisesRegex(AssertionError, "forced termination"):
                with verify.held_lock(self.fixture(), verify.FENCE_KEY):
                    pass
        holder.kill.assert_called_once_with()
        holder.wait.assert_called_once_with(timeout=5)

    def test_unverified_kill_cleanup_cannot_pass(self):
        holder = self.holder()
        holder.wait.side_effect = [subprocess.TimeoutExpired(["owned-psql"], 5),
                                   subprocess.TimeoutExpired(["owned-psql"], 5)]
        with self.mocked_holder(holder):
            with self.assertRaisesRegex(AssertionError, "Could not verify"):
                with verify.held_lock(self.fixture(), verify.FENCE_KEY):
                    pass
        holder.kill.assert_called_once_with()

    def test_missing_acquisition_marker_still_releases_holder(self):
        holder = self.holder()
        holder.stdout.readline.return_value = "wrong-marker\n"
        with self.mocked_holder(holder) as launch:
            with self.assertRaisesRegex(AssertionError, "Could not acquire"):
                with verify.held_lock(self.fixture(), verify.FENCE_KEY):
                    self.fail("Unacquired lock must not enter body")
        self.assert_released_only_holder(holder, launch)


class RuntimeLockObservationTests(unittest.TestCase):
    def test_early_receipt_rejection_cannot_prove_a_lock_wait(self):
        fixture = SimpleNamespace(sql=Mock())
        process = Mock()
        process.poll.return_value = 1
        with self.assertRaisesRegex(AssertionError, "before an actual shared"):
            verify.wait_for_runtime_lock(fixture, process, "owned_runtime", "owned_migration")
        fixture.sql.assert_not_called()

    def test_live_process_without_observed_owned_lock_cannot_pass(self):
        fixture = SimpleNamespace(sql=Mock(return_value="f"))
        process = Mock()
        process.poll.return_value = None

        def bounded_probe(check, description, seconds):
            self.assertEqual(seconds, 4)
            if not check():
                raise AssertionError("owned wait was absent")

        with patch.object(verify, "wait_until", side_effect=bounded_probe):
            with self.assertRaisesRegex(AssertionError, "owned wait was absent"):
                verify.wait_for_runtime_lock(fixture, process, "owned_runtime", "owned_migration")

    def test_only_database_positive_observation_allows_next_phase(self):
        fixture = SimpleNamespace(sql=Mock(return_value="t"))
        process = Mock()
        process.poll.return_value = None
        with patch.object(verify, "wait_until", side_effect=lambda check, *_args, **_kwargs: self.assertTrue(check())):
            verify.wait_for_runtime_lock(fixture, process, "owned_runtime", "owned_migration")
        fixture.sql.assert_called_once()


class MigrationProcessCleanupTests(unittest.TestCase):
    def test_holder_context_exit_failure_still_reaps_launched_migration(self):
        migration, runtime = Mock(), Mock()
        migration.poll.return_value = None
        migration.wait.return_value = -15
        runtime.wait.return_value = 1
        fixture = SimpleNamespace(
            sql=Mock(return_value="t"), engine=Path("/owned/engine"), root=Path("/owned"),
            env={"SAFE_FIXTURE": "true"}, log=io.StringIO(), snapshot=Mock(return_value={"same": True}),
            launch=Mock(return_value=runtime), stop_engine=Mock(), receipt=Mock(), ready=Mock(),
        )

        @contextlib.contextmanager
        def failing_release(*_args):
            yield
            raise RuntimeError("owned holder context exit failed")

        with patch.object(verify, "held_lock", failing_release), \
             patch.object(verify.subprocess, "Popen", return_value=migration), \
             patch.object(verify, "wait_until", side_effect=lambda check, *_args, **_kwargs: self.assertTrue(check())), \
             patch.object(verify, "wait_for_runtime_lock"), \
             patch.object(verify.secrets, "token_hex", return_value="owned123"):
            with self.assertRaisesRegex(RuntimeError, "context exit failed"):
                verify.prove_migration_excludes_startup(fixture)
        fixture.stop_engine.assert_called_once_with()
        migration.terminate.assert_called_once_with()
        migration.wait.assert_called_once_with(timeout=5)
        migration.kill.assert_not_called()
        fixture.ready.assert_not_called()

    def test_unverified_owned_migration_kill_cannot_pass_cleanup(self):
        migration = Mock()
        migration.poll.return_value = None
        migration.wait.side_effect = [subprocess.TimeoutExpired(["owned"], 5),
                                      subprocess.TimeoutExpired(["owned"], 5)]
        with self.assertRaisesRegex(AssertionError, "Could not verify owned migration"):
            verify.stop_owned_migration(migration)
        migration.terminate.assert_called_once_with()
        migration.kill.assert_called_once_with()

    def test_absent_or_already_reaped_migration_is_untouched(self):
        verify.stop_owned_migration(None)
        migration = Mock()
        migration.poll.return_value = 1
        verify.stop_owned_migration(migration)
        migration.terminate.assert_not_called()
        migration.kill.assert_not_called()


class ReportTests(unittest.TestCase):
    def test_publishes_complete_private_json_without_temporary_files(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "evidence.json"
            expected = {"passed": False, "active_check": "fixture-only"}
            verify.write_report(destination, expected)
            self.assertEqual(json.loads(destination.read_text()), expected)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(Path(folder).iterdir()), [destination])

    def test_existing_report_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "evidence.json"
            destination.write_text("prior evidence")
            with self.assertRaises(FileExistsError):
                verify.write_report(destination, {"passed": True})
            self.assertEqual(destination.read_text(), "prior evidence")
            self.assertEqual(list(Path(folder).iterdir()), [destination])

    def test_racing_symlink_is_not_followed_or_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            protected = Path(folder) / "protected"
            protected.write_text("preserve")
            destination = Path(folder) / "evidence.json"
            destination.symlink_to(protected)
            with self.assertRaises(FileExistsError):
                verify.write_report(destination, {"passed": True})
            self.assertTrue(destination.is_symlink())
            self.assertEqual(protected.read_text(), "preserve")
            self.assertEqual(len(list(Path(folder).iterdir())), 2)

    def test_publication_failure_leaves_no_partial_report(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "evidence.json"
            with patch.object(verify.os, "link", side_effect=OSError("synthetic publication failure")):
                with self.assertRaisesRegex(OSError, "publication failure"):
                    verify.write_report(destination, {"passed": True})
            self.assertEqual(list(Path(folder).iterdir()), [])


class AdmissionPreflightTests(unittest.TestCase):
    def paths(self, folder, raw_schema=b"synthetic pinned schema"):
        root = Path(folder)
        engine = root / "engine"
        engine.write_text("never execute this fixture")
        engine.chmod(0o700)
        pg_bin = root / "pg-bin"
        pg_bin.mkdir()
        for tool in ("initdb", "pg_ctl", "psql", "pg_dump"):
            executable = pg_bin / tool
            executable.write_text("never execute this fixture")
            executable.chmod(0o700)
        source = root / "source"
        source.mkdir()
        (source / "schema.sql").write_bytes(raw_schema)
        return ["verify.py", "--engine", str(engine), "--pg-bin", str(pg_bin),
                "--source", str(source)]

    def assert_preflight_rejection(self, argv, expected_message):
        with patch.object(sys, "argv", argv), \
             patch.object(verify.subprocess, "Popen") as popen, \
             patch.object(verify.subprocess, "run") as run, \
             contextlib.redirect_stderr(io.StringIO()) as error_output:
            with self.assertRaises(SystemExit) as error:
                verify.main()
        self.assertEqual(error.exception.code, 2)
        self.assertIn(expected_message, error_output.getvalue())
        popen.assert_not_called()
        run.assert_not_called()

    def test_unpinned_schema_is_rejected_before_any_subprocess(self):
        with tempfile.TemporaryDirectory() as folder:
            argv = self.paths(folder)
            self.assert_preflight_rejection(argv, "does not match the pinned")

    def test_existing_output_is_rejected_before_any_subprocess(self):
        with tempfile.TemporaryDirectory() as folder:
            argv = self.paths(folder)
            destination = Path(folder) / "retained.json"
            destination.write_text("prior evidence")
            argv += ["--output", str(destination)]
            with patch.object(verify, "UPSTREAM_SCHEMA_SHA256", verify.checksum(b"synthetic pinned schema")):
                self.assert_preflight_rejection(argv, "must be a new evidence file")
            self.assertEqual(destination.read_text(), "prior evidence")

    def test_broken_output_symlink_is_rejected_before_any_subprocess(self):
        with tempfile.TemporaryDirectory() as folder:
            argv = self.paths(folder)
            destination = Path(folder) / "retained.json"
            destination.symlink_to(Path(folder) / "absent-target")
            argv += ["--output", str(destination)]
            with patch.object(verify, "UPSTREAM_SCHEMA_SHA256", verify.checksum(b"synthetic pinned schema")):
                self.assert_preflight_rejection(argv, "must be a new evidence file")
            self.assertTrue(destination.is_symlink())


if __name__ == "__main__":
    unittest.main()
