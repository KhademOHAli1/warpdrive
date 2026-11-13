"""Offline evidence for stage response recovery without replaying mutations."""

from copy import deepcopy
from hashlib import sha256
import io
import os
from pathlib import Path
import stat
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import installed_web_stage
from installed_docker import DockerNativeError
from installed_web_runtime import WebRuntimeError, verify_candidate
from installed_web_stage import read_record, start_private, write_record
from installed_web_stage_readback import read_stage_acknowledgement
from test_installed_web_operator import ALIAS, CONTAINER_ID, INGRESS, NETWORK_IDS, RUNTIME_SECRET, DockerReadback, candidate_fixture
from web_switch import SwitchHeld


class InstalledWebStageReadbackTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.operation = self.root / "operation"
        self.candidate = self.operation / "candidate"
        self.state = self.root / "rollout"
        self.journals = self.state / "web-rollouts"
        self.candidate.mkdir(mode=0o700, parents=True)
        self.journals.mkdir(mode=0o700, parents=True)
        for directory in (self.operation, self.state):
            directory.chmod(0o700)
        self.document, self.row = candidate_fixture()
        self.revision = "b" * 40
        self.backend = {"backendFingerprint": "d" * 64}
        self.loaded = {"imageId": self.row["Image"]}
        self.release = {"revision": self.revision, "fixture": "one"}
        self.docker = DockerReadback(self.row)
        self.inspect = Mock(wraps=self.docker.inspect)
        self.docker.inspect = self.inspect
        self.docker.create = Mock(side_effect=AssertionError("Docker create must never run during readback"))
        self.docker.start = Mock(side_effect=AssertionError("Docker start must never run during readback"))
        self.docker.load = Mock(side_effect=AssertionError("Docker load must never run during readback"))
        self.install = SimpleNamespace(
            operation=self.operation, state=self.state, docker=self.docker,
            network=NETWORK_IDS[INGRESS], inputs={"networkIds": NETWORK_IDS, "runtimeSecret": RUNTIME_SECRET, "version": "1.6.1"},
            _candidate_document=Mock(return_value=(self.document, self.backend)),
            _retained=Mock(return_value=(self.backend, {})), _stage_preimage=Mock(),
        )
        # Keep native candidate, network-peer, lock, and receipt checks real.
        # Substitute only the direct health transport and fixture owner UID.
        self.peer = self.enterContext(patch("installed_web_operator.read_direct_web", return_value=True))
        self.enterContext(patch("installed_web_stage.OWNER_UID", os.geteuid()))

    def stage_fixture(self):
        created = deepcopy(self.row)
        created["State"].update(Status="created", Running=False)
        docker = Mock()
        docker.create.return_value = CONTAINER_ID
        docker.inspect.side_effect = (created, self.row)
        return docker, created

    def run_stage(self, docker, created):
        return start_private(docker, operation=self.candidate, alias=ALIAS, document=self.document,
                             qualification=self.release, verify_created=lambda row: row == created,
                             ready=lambda row: verify_candidate(row, self.document, alias=ALIAS,
                                                                network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET))

    def stage_with_lost_reply(self):
        stage, created = self.stage_fixture()
        with self.assertRaises(BrokenPipeError):
            self.run_stage(stage, created)
            raise BrokenPipeError("synthetic lost SSH reply after native receipt")
        stage.create.assert_called_once_with(ALIAS, self.document)
        stage.start.assert_called_once_with(CONTAINER_ID)

    def verify(self):
        return read_stage_acknowledgement(self.install, loaded=self.loaded, alias=ALIAS,
                                          revision=self.revision, release=self.release)

    def snapshot(self):
        return {path.relative_to(self.root): (path.stat().st_mode, path.stat().st_mtime_ns,
                                              sha256(path.read_bytes()).hexdigest() if path.is_file() else None)
                for path in self.root.rglob("*")}

    def assert_read_only(self):
        self.docker.create.assert_not_called()
        self.docker.start.assert_not_called()
        self.docker.load.assert_not_called()

    def test_terminal_native_receipt_recovers_response_after_lost_ack_without_replay(self):
        self.stage_with_lost_reply()
        before = self.snapshot()
        with patch("installed_web_stage.write_record", side_effect=AssertionError("readback wrote stage evidence")):
            self.assertEqual(self.verify(), {"state": "private-ready", "sourceRevision": self.revision,
                                            "candidateId": CONTAINER_ID, "backendFingerprint": self.backend["backendFingerprint"]})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.peer.call_count, 2)
        self.assertEqual(self.install._stage_preimage.call_count, 2)
        self.assertTrue(all(call.kwargs == {"check_journals": True} for call in self.install._stage_preimage.call_args_list))
        self.assert_read_only()

    def test_optional_created_record_can_be_absent_but_must_match_if_present(self):
        self.stage_with_lost_reply()
        created = self.candidate / "stage-created.json"
        record = read_record(created)
        created.unlink()
        self.assertEqual(self.verify()["candidateId"], CONTAINER_ID)
        write_record(created, {**record, "id": "a" * 64})
        with self.assertRaisesRegex(WebRuntimeError, "creation differs"):
            self.verify()
        self.assert_read_only()

    def test_nonterminal_missing_or_untrusted_stage_receipts_hold(self):
        self.stage_with_lost_reply()
        ready = self.candidate / "stage-ready.json"
        terminal = read_record(ready)
        ready.unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()
        write_record(ready, {**terminal, "qualificationSha256": "a" * 64})
        with self.assertRaisesRegex(WebRuntimeError, "terminal private Web stage"):
            self.verify()
        ready.unlink()
        ready.symlink_to("stage-intent.json")
        with self.assertRaises(OSError):
            self.verify()
        self.assert_read_only()

    def test_exact_same_operation_route_journals_hold_even_when_terminal(self):
        self.stage_with_lost_reply()
        suffix = ALIAS.removeprefix("warpdrive-web-")
        for phase in ("", "-rollback", "-reapply", "-restore"):
            with self.subTest(phase=phase):
                journal = self.journals / f"web-{suffix}{phase}.json"
                write_record(journal, {"state": "accepted"})
                with self.assertRaisesRegex(WebRuntimeError, "route phase already belongs"):
                    self.verify()
                journal.unlink()
        self.peer.assert_not_called()
        self.assert_read_only()

    def test_candidate_or_preimage_drift_cannot_produce_a_stage_ack(self):
        self.stage_with_lost_reply()
        self.peer.return_value = False
        with self.assertRaisesRegex(WebRuntimeError, "direct health differs"):
            self.verify()
        self.peer.return_value = True
        self.install._retained.return_value = ({"backendFingerprint": "e" * 64}, {})
        with self.assertRaisesRegex(WebRuntimeError, "Protected backend changed"):
            self.verify()
        self.install._retained.return_value = (self.backend, {})
        self.install._stage_preimage.side_effect = (None, SwitchHeld("persisted predecessor changed"))
        with self.assertRaisesRegex(SwitchHeld, "persisted predecessor changed"):
            self.verify()
        self.install._stage_preimage.side_effect = None
        self.docker.row["State"]["Running"] = False
        with self.assertRaisesRegex(WebRuntimeError, "direct health differs"):
            self.verify()
        self.assert_read_only()

    def test_restarted_pid_after_first_health_sample_is_held(self):
        self.stage_with_lost_reply()

        def changed_process(*_args):
            self.docker.row["State"]["Pid"] += 1
            return True

        self.peer.side_effect = changed_process
        with self.assertRaisesRegex(WebRuntimeError, "stage changed during readback"):
            self.verify()
        self.assert_read_only()

    def test_native_read_failure_never_replays_stage(self):
        self.stage_with_lost_reply()
        self.inspect.side_effect = DockerNativeError("synthetic unavailable readback")
        with self.assertRaises(DockerNativeError):
            self.verify()
        self.assert_read_only()

    def test_partial_receipt_write_never_exposes_intent_or_invokes_docker(self):
        class ShortWrite(io.BufferedWriter):
            def write(self, data):
                return super().write(data[:4])

        stage, created = self.stage_fixture()
        with patch("installed_web_stage.os.fdopen", side_effect=lambda fd, mode: ShortWrite(io.FileIO(fd, mode))):
            with self.assertRaisesRegex(OSError, "Incomplete stage receipt write"):
                self.run_stage(stage, created)
        self.assertEqual(list(self.candidate.iterdir()), [])
        self.assertEqual(stage.mock_calls, [])
        ready = self.run_stage(stage, created)
        self.assertEqual(ready["id"], CONTAINER_ID)
        stage.create.assert_called_once_with(ALIAS, self.document)
        stage.start.assert_called_once_with(CONTAINER_ID)

    def test_failed_intent_directory_sync_holds_without_issuing_or_replaying_create(self):
        stage, created = self.stage_fixture()
        original_sync = os.fsync

        def interrupt_sync(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError("synthetic interrupted directory sync")
            original_sync(fd)

        with patch("installed_web_stage.os.fsync", side_effect=interrupt_sync):
            with self.assertRaisesRegex(OSError, "interrupted directory sync"):
                self.run_stage(stage, created)
        intent = self.candidate / "stage-intent.json"
        self.assertEqual(read_record(intent)["alias"], ALIAS)
        self.assertEqual(stage.mock_calls, [])
        stage.inspect.side_effect = DockerNativeError("alias absent")
        with self.assertRaisesRegex(DockerNativeError, "alias absent"):
            self.run_stage(stage, created)
        stage.inspect.assert_called_once_with(ALIAS)
        stage.create.assert_not_called()
        stage.start.assert_not_called()

    def test_ready_publication_interruption_recovers_only_from_observed_runtime(self):
        stage, created = self.stage_fixture()
        original_sync = os.fsync
        ready = self.candidate / "stage-ready.json"

        def interrupt_sync(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode) and ready.exists():
                raise OSError("synthetic interrupted directory sync")
            original_sync(fd)

        with patch("installed_web_stage.os.fsync", side_effect=interrupt_sync):
            with self.assertRaisesRegex(OSError, "interrupted directory sync"):
                self.run_stage(stage, created)
        self.assertEqual(ready.stat().st_nlink, 1)
        self.assertEqual(list(self.candidate.glob(".web-stage-*")), [])
        with patch("installed_web_stage.os.fsync", wraps=original_sync) as sync:
            self.assertEqual(self.verify()["candidateId"], CONTAINER_ID)
        self.assertGreaterEqual(sync.call_count, 2)
        stage.inspect.side_effect = (self.row,)
        self.assertEqual(self.run_stage(stage, created), read_record(ready))
        stage.create.assert_called_once_with(ALIAS, self.document)
        stage.start.assert_called_once_with(CONTAINER_ID)

    def test_create_with_lost_response_keeps_stopped_slot_on_readback(self):
        stage, created = self.stage_fixture()
        stage.create.side_effect = DockerNativeError("synthetic lost create response")
        with self.assertRaisesRegex(DockerNativeError, "lost create response"):
            self.run_stage(stage, created)
        self.assertFalse((self.candidate / "stage-created.json").exists())
        stage.inspect.side_effect = (created, created)
        with self.assertRaisesRegex(DockerNativeError, "not running"):
            self.run_stage(stage, created)
        self.assertEqual([call.args for call in stage.inspect.call_args_list], [(ALIAS,), (CONTAINER_ID,)])
        self.assertFalse((self.candidate / "stage-ready.json").exists())
        stage.create.assert_called_once_with(ALIAS, self.document)
        stage.start.assert_not_called()

    def test_start_with_lost_response_reconciles_running_slot_once(self):
        stage, created = self.stage_fixture()
        stage.start.side_effect = DockerNativeError("synthetic lost start response")
        with self.assertRaisesRegex(DockerNativeError, "lost start response"):
            self.run_stage(stage, created)
        self.assertEqual(read_record(self.candidate / "stage-created.json")["id"], CONTAINER_ID)
        self.assertFalse((self.candidate / "stage-ready.json").exists())
        stage.inspect.side_effect = (self.row,)
        self.assertEqual(self.run_stage(stage, created)["id"], CONTAINER_ID)
        stage.create.assert_called_once_with(ALIAS, self.document)
        stage.start.assert_called_once_with(CONTAINER_ID)

    def test_final_receipt_excludes_existing_entries_and_rejects_extra_links(self):
        path = self.candidate / "stage-intent.json"
        original_publish = installed_web_stage._publish_record

        def competing_publication(directory, temporary, name):
            with path.open("xb") as competitor:
                os.fchmod(competitor.fileno(), 0o600)
                competitor.write(b'{"first":true}')
            original_publish(directory, temporary, name)

        with patch("installed_web_stage._publish_record", side_effect=competing_publication):
            with self.assertRaises(FileExistsError):
                write_record(path, {"first": False})
        self.assertEqual(read_record(path), {"first": True})
        self.assertEqual(list(self.candidate.glob(".web-stage-*")), [])
        os.link(path, self.candidate / "other-link")
        with self.assertRaisesRegex(WebRuntimeError, "Private bounded stage receipt"):
            read_record(path)

    def test_abandoned_temporary_bytes_are_ignored_and_parallel_stage_cannot_start(self):
        abandoned = self.candidate / ".web-stage-0123456789abcdef01234567"
        abandoned.write_bytes(b'{"part')
        abandoned.chmod(0o600)
        stage, created = self.stage_fixture()
        with installed_web_stage.exclusive(self.candidate), self.assertRaises(BlockingIOError):
            self.run_stage(stage, created)
        self.assertEqual(stage.mock_calls, [])
        self.assertEqual(self.run_stage(stage, created)["id"], CONTAINER_ID)
        self.assertEqual(abandoned.read_bytes(), b'{"part')
        self.assertEqual(self.verify()["candidateId"], CONTAINER_ID)
