"""Offline evidence for stage response recovery without replaying mutations."""

from contextlib import nullcontext
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import stat
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from installed_docker import DockerNativeError
from installed_web_runtime import WebRuntimeError, verify_candidate
from installed_web_stage import start_private, write_record
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
        # Keep native candidate/profile and network-peer validation real. Replace
        # only the transport for direct health/identity and the root-owned file
        # reader's UID assumption so the test can run without sudo.
        self.peer = self.enterContext(patch("installed_web_operator.read_direct_web", return_value=True))
        self.enterContext(patch("installed_web_stage_readback.read_record", side_effect=self.fixture_read_record))

    @staticmethod
    def fixture_read_record(path):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise WebRuntimeError("Exact private regular stage receipt required")
        return json.loads(path.read_bytes())

    def stage_with_lost_reply(self):
        created_row = deepcopy(self.row)
        created_row["State"].update(Status="created", Running=False)
        runtime = verify_candidate(self.row, self.document, alias=ALIAS, network_ids=NETWORK_IDS,
                                   runtime_secret=RUNTIME_SECRET)
        stage = Mock()
        stage.create.return_value = CONTAINER_ID
        stage.inspect.side_effect = (created_row, self.row)

        def lost_reply():
            start_private(stage, operation=self.candidate, alias=ALIAS, document=self.document, qualification=self.release,
                          verify_created=lambda row: row == created_row, ready=lambda row: runtime)
            raise BrokenPipeError("synthetic lost SSH reply after native receipt")

        with patch("installed_web_stage.exclusive", return_value=nullcontext()):
            with self.assertRaises(BrokenPipeError):
                lost_reply()
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
        record = self.fixture_read_record(created)
        created.unlink()
        self.assertEqual(self.verify()["candidateId"], CONTAINER_ID)
        write_record(created, {**record, "id": "a" * 64})
        with self.assertRaisesRegex(WebRuntimeError, "creation differs"):
            self.verify()
        self.assert_read_only()

    def test_nonterminal_missing_or_untrusted_stage_receipts_hold(self):
        self.stage_with_lost_reply()
        ready = self.candidate / "stage-ready.json"
        terminal = self.fixture_read_record(ready)
        ready.unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()
        write_record(ready, {**terminal, "qualificationSha256": "a" * 64})
        with self.assertRaisesRegex(WebRuntimeError, "terminal private Web stage"):
            self.verify()
        ready.unlink()
        ready.symlink_to("stage-intent.json")
        with self.assertRaisesRegex(WebRuntimeError, "private regular stage receipt"):
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
