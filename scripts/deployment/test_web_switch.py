"""Real filesystem/lock/crash-boundary tests; adapters model only isolated external state."""
import copy
import fcntl
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import web_switch as switch


class Crash(BaseException):
    pass


class FakeClock:
    def __init__(self):
        self.now = 10.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def runtime(identifier="1", name="accepted-web"):
    return {"runtimeId": identifier * 64, "name": name, "imageId": "sha256:" + "a" * 64,
            "sourceRevision": "b" * 40, "configSha256": "c" * 64, "schemaSha256": "d" * 64,
            "restartCount": 0, "running": True}


def accepted():
    return {"schemaVersion": 1, "kind": "warpdrive-accepted-web", "scope": switch.SCOPE,
            "targetKey": "isolated-fixture", "runtime": runtime(), "unrelatedFingerprint": "e" * 64,
            "route": {"generation": "generation-old", "fingerprint": "f" * 64, "runtimeId": "1" * 64}}


def plan(before, operation="switch-one"):
    return {"schemaVersion": 1, "kind": "warpdrive-isolated-web-switch", "scope": switch.SCOPE,
            "operationId": operation, "targetKey": before["targetKey"],
            "acceptedSha256": switch.content_hash(before), "candidateName": operation + "-candidate",
            "desiredGeneration": "generation-" + operation, "desiredRouteFingerprint": "9" * 64,
            "unrelatedFingerprint": before["unrelatedFingerprint"],
            **{key: before["runtime"][key] for key in ("imageId", "sourceRevision", "configSha256", "schemaSha256")}}


class FileAdapter:
    """The independent runtime file survives controller reconstruction after interruption."""
    def __init__(self, path, before=None):
        self.path = path
        self.create_outcome = self.switch_outcome = None
        self.observations = []
        if before is not None:
            self.write({"accepted": before["runtime"], "candidate": None, "route": before["route"],
                        "unrelated": before["unrelatedFingerprint"], "healthy": True,
                        "creates": 0, "applies": 0})

    def read(self):
        return json.loads(self.path.read_text())

    def write(self, value):
        self.path.write_text(json.dumps(value))

    def inspect(self, accepted_runtime, candidate_name):
        value = self.read()
        return {"acceptedRuntime": value["accepted"], "candidateRuntime": value["candidate"] if candidate_name else None,
                "route": value["route"], "unrelatedFingerprint": value["unrelated"]}

    def create_candidate(self, value):
        state = self.read()
        state["creates"] += 1
        self.write(state)
        if self.create_outcome == "reject":
            raise switch.DefiniteRejected("fixed create rejection")
        if self.create_outcome == "unknown-before":
            raise TimeoutError("create result unavailable")
        state["candidate"] = {**runtime("2", value["candidateName"]), "ownerOperation": value["operationId"]}
        self.write(state)
        if self.create_outcome == "crash-after":
            raise Crash()

    def candidate_ready(self, value):
        return self.read().get("candidateReady", True)

    def apply_route(self, value, expected_route_fingerprint):
        state = self.read()
        if state["route"]["fingerprint"] != expected_route_fingerprint:
            raise switch.DefiniteRejected("route compare-and-swap rejected")
        state["applies"] += 1
        self.write(state)
        if self.switch_outcome == "reject":
            raise switch.DefiniteRejected("fixed route rejection")
        if self.switch_outcome == "unknown-before":
            raise TimeoutError("route result unavailable")
        self.finish_delayed_apply(value)
        if self.switch_outcome == "crash-after":
            raise Crash()
        if self.switch_outcome == "unknown-after":
            raise TimeoutError("successful route response lost")

    def finish_delayed_apply(self, value):
        state = self.read()
        state["route"] = {"generation": value["desiredGeneration"], "fingerprint": value["desiredRouteFingerprint"],
                          "runtimeId": state["candidate"]["runtimeId"]}
        self.write(state)

    def observe_route(self, value):
        state = self.read()
        observation = self.observations.pop(0) if self.observations else {**state["route"], "healthy": state["healthy"]}
        return observation


class WebSwitchTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.state = self.root / "state"
        self.before = accepted()
        self.plan = plan(self.before)
        self.adapter = FileAdapter(self.root / "runtime.json", self.before)
        self.clock = FakeClock()
        switch.initialize_rehearsal(self.state, self.before, self.adapter)
        self.accepted_bytes = (self.state / "accepted.json").read_bytes()

    def run_switch(self, value=None, adapter=None):
        return switch.rehearse_web_switch(value or self.plan, state_dir=self.state, adapter=adapter or self.adapter,
                                          clock=self.clock.monotonic, sleep=self.clock.sleep)

    def journal(self):
        directory = self.state / "operations" / self.plan["operationId"]
        return [switch._read(path) for path in sorted(directory.glob("[0-9]*.json"))]

    def assert_old_accepted(self):
        self.assertEqual((self.state / "accepted.json").read_bytes(), self.accepted_bytes)
        self.assertEqual(self.adapter.read()["accepted"], self.before["runtime"])

    def test_seed_checks_actual_route_and_never_replaces_existing_file(self):
        other = self.root / "other"
        other.mkdir()
        (other / "accepted.json").write_text("unrelated")
        with self.assertRaises(switch.SwitchConflict):
            switch.initialize_rehearsal(other, self.before, self.adapter)
        self.assertEqual((other / "accepted.json").read_text(), "unrelated")
        state = self.adapter.read()
        state["route"]["fingerprint"] = "0" * 64
        self.adapter.write(state)
        with self.assertRaises(switch.SwitchConflict):
            switch.initialize_rehearsal(self.root / "wrong-route", self.before, self.adapter)
        self.assertFalse((self.root / "wrong-route" / "accepted.json").exists())

    def test_real_target_lock_blocks_even_a_different_operation(self):
        with (self.state / "target.lock").open("w") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(switch.SwitchConflict):
                self.run_switch(plan(self.before, "other-operation"))
        self.assertEqual(self.adapter.read()["creates"], 0)
        self.assert_old_accepted()

    def test_success_preserves_old_runtime_and_repeated_plan_only_reads(self):
        result = self.run_switch()
        self.assertEqual(result["state"], "COMPLETED")
        self.assertFalse(result["deploymentAuthorized"])
        self.assertGreaterEqual(result["sustainedSeconds"], 2.0)
        self.assertGreaterEqual(self.clock.now, 14.0)
        self.assertEqual(self.adapter.read()["accepted"], self.before["runtime"])
        self.assertEqual(switch._read(self.state / "accepted.json")["runtime"]["runtimeId"], "2" * 64)
        journal_bytes = {path: path.read_bytes() for path in (self.state / "operations" / self.plan["operationId"]).iterdir()}
        repeated = self.run_switch(adapter=FileAdapter(self.adapter.path))
        self.assertEqual(repeated["acceptedSha256"], result["acceptedSha256"])
        self.assertEqual((self.adapter.read()["creates"], self.adapter.read()["applies"]), (1, 1))
        self.assertEqual({path: path.read_bytes() for path in journal_bytes}, journal_bytes)

    def test_changed_image_configuration_or_schema_rejects_before_creation(self):
        for key in ("imageId", "configSha256", "schemaSha256", "sourceRevision"):
            changed = copy.deepcopy(self.plan)
            changed[key] = "sha256:" + "0" * 64 if key == "imageId" else "0" * (40 if key == "sourceRevision" else 64)
            with self.subTest(key=key), self.assertRaises(switch.SwitchConflict):
                self.run_switch(changed)
        self.assertEqual(self.adapter.read()["creates"], 0)
        self.assert_old_accepted()

    def test_creation_intent_is_durable_before_external_mutation(self):
        actual = self.adapter.create_candidate
        def create(value):
            self.assertEqual(self.journal()[-1]["state"], "CREATE_INTENT")
            actual(value)
        self.adapter.create_candidate = create
        self.run_switch()

    def test_failed_intent_fsync_prevents_any_external_mutation(self):
        actual = switch._Operation.append
        def append(operation, state, **values):
            if state == "CREATE_INTENT":
                with patch.object(switch.os, "fsync", side_effect=OSError("disk flush failed")):
                    actual(operation, state, **values)
            else:
                actual(operation, state, **values)
        with patch.object(switch._Operation, "append", new=append):
            with self.assertRaises(OSError):
                self.run_switch()
        self.assertEqual(self.adapter.read()["creates"], 0)
        self.assert_old_accepted()

    def test_switch_intent_is_durable_before_external_mutation(self):
        actual = self.adapter.apply_route
        def apply(value, expected):
            event = self.journal()[-1]
            self.assertEqual(event["state"], "SWITCH_INTENT")
            self.assertEqual(event["candidateRuntime"]["runtimeId"], "2" * 64)
            actual(value, expected)
        self.adapter.apply_route = apply
        self.run_switch()

    def test_existing_next_journal_file_is_never_overwritten(self):
        actual = self.adapter.create_candidate
        collision = self.state / "operations" / self.plan["operationId"] / "0003.json"
        def create(value):
            actual(value)
            collision.write_text("foreign-existing-file")
        self.adapter.create_candidate = create
        with self.assertRaises(FileExistsError):
            self.run_switch()
        self.assertEqual(collision.read_text(), "foreign-existing-file")
        with self.assertRaises(switch.SwitchConflict):
            self.run_switch(adapter=FileAdapter(self.adapter.path))
        self.assertEqual((self.adapter.read()["creates"], self.adapter.read()["applies"]), (1, 0))
        self.assert_old_accepted()

    def test_definite_rejection_preserves_accepted_record_and_never_replays(self):
        self.adapter.switch_outcome = "reject"
        with self.assertRaises(switch.DefiniteRejected):
            self.run_switch()
        with self.assertRaises(switch.DefiniteRejected):
            self.run_switch(adapter=FileAdapter(self.adapter.path))
        self.assertEqual(self.journal()[-1]["state"], "REJECTED")
        self.assertEqual(self.adapter.read()["applies"], 1)
        self.assert_old_accepted()

    def test_unready_candidate_never_switches_or_updates_accepted_pointer(self):
        state = self.adapter.read()
        state["candidateReady"] = False
        self.adapter.write(state)
        with self.assertRaises(switch.DefiniteRejected):
            self.run_switch()
        self.assertEqual(self.adapter.read()["applies"], 0)
        self.assert_old_accepted()

    def test_create_timeout_and_crash_hold_all_subsequent_mutations(self):
        for outcome in ("unknown-before", "crash-after"):
            with self.subTest(outcome=outcome):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    adapter = FileAdapter(root / "runtime.json", self.before)
                    switch.initialize_rehearsal(root / "state", self.before, adapter)
                    adapter.create_outcome = outcome
                    with self.assertRaises((switch.SwitchUnknown, Crash)):
                        switch.rehearse_web_switch(self.plan, state_dir=root / "state", adapter=adapter,
                                                   clock=self.clock.monotonic, sleep=self.clock.sleep)
                    with self.assertRaises(switch.SwitchUnknown):
                        switch.rehearse_web_switch(self.plan, state_dir=root / "state", adapter=FileAdapter(adapter.path),
                                                   clock=self.clock.monotonic, sleep=self.clock.sleep)
                    self.assertEqual((adapter.read()["creates"], adapter.read()["applies"]), (1, 0))

    def test_old_route_after_timeout_never_permits_retry_or_rollback_but_late_apply_can_finish(self):
        self.adapter.switch_outcome = "unknown-before"
        with self.assertRaises(switch.SwitchUnknown):
            self.run_switch()
        self.assert_old_accepted()
        for _ in range(2):
            with self.assertRaises(switch.SwitchHeld):
                self.run_switch(adapter=FileAdapter(self.adapter.path))
        with self.assertRaises(switch.SwitchConflict):
            self.run_switch(plan(self.before, "different-operation"))
        self.assertEqual((self.adapter.read()["creates"], self.adapter.read()["applies"]), (1, 1))
        self.assert_old_accepted()
        self.adapter.finish_delayed_apply(self.plan)
        result = self.run_switch(adapter=FileAdapter(self.adapter.path))
        self.assertEqual(result["state"], "COMPLETED")
        self.assertEqual(self.adapter.read()["applies"], 1)

    def test_crash_after_actual_route_apply_reconciles_without_reapplying(self):
        self.adapter.switch_outcome = "crash-after"
        with self.assertRaises(Crash):
            self.run_switch()
        self.assertEqual(self.journal()[-1]["state"], "SWITCH_INTENT")
        self.assert_old_accepted()
        self.run_switch(adapter=FileAdapter(self.adapter.path))
        self.assertEqual((self.adapter.read()["creates"], self.adapter.read()["applies"]), (1, 1))

    def test_crash_between_accepted_pointer_and_completion_reconciles_both_files(self):
        replace = switch._replace_accepted
        def crash_after(*arguments):
            replace(*arguments)
            raise Crash()
        with patch.object(switch, "_replace_accepted", side_effect=crash_after):
            with self.assertRaises(Crash):
                self.run_switch()
        self.assertEqual(self.journal()[-1]["state"], "SWITCH_INTENT")
        self.assertEqual(switch._read(self.state / "accepted.json")["runtime"]["runtimeId"], "2" * 64)
        self.run_switch(adapter=FileAdapter(self.adapter.path))
        self.assertEqual(self.journal()[-1]["state"], "COMPLETED")
        self.assertEqual(self.adapter.read()["applies"], 1)

    def test_unhealthy_postswitch_holds_without_rollback_or_pointer_change(self):
        state = self.adapter.read()
        state["healthy"] = False
        self.adapter.write(state)
        with self.assertRaises(switch.SwitchHeld):
            self.run_switch()
        self.assertEqual(self.journal()[-1]["state"], "HOLD")
        self.assertEqual(self.adapter.read()["route"]["generation"], self.plan["desiredGeneration"])
        self.assertEqual(self.adapter.read()["applies"], 1)
        self.assert_old_accepted()

    def test_later_independent_proxy_failure_prevents_accepting_an_initial_success(self):
        desired = {"generation": self.plan["desiredGeneration"], "fingerprint": self.plan["desiredRouteFingerprint"],
                   "runtimeId": "2" * 64}
        self.adapter.observations = [{**desired, "healthy": True}, {**desired, "healthy": False}]
        with self.assertRaises(switch.SwitchHeld):
            self.run_switch()
        self.assertEqual(self.journal()[-1]["state"], "HOLD")
        self.assertEqual(self.adapter.read()["applies"], 1)
        self.assert_old_accepted()

    def test_generation_without_exact_route_fingerprint_and_target_cannot_accept(self):
        for key, value in (("fingerprint", "0" * 64), ("runtimeId", "3" * 64)):
            with self.subTest(key=key):
                state = self.adapter.read()
                state["healthy"] = False
                self.adapter.write(state)
                if state["applies"] == 0:
                    with self.assertRaises(switch.SwitchHeld):
                        self.run_switch()
                state = self.adapter.read()
                state["route"][key] = value
                state["healthy"] = True
                self.adapter.write(state)
                with self.assertRaises(switch.SwitchHeld):
                    self.run_switch()
                self.assert_old_accepted()

    def test_observation_must_sustain_health_and_not_just_report_three_instantaneous_samples(self):
        with self.assertRaises(switch.DefiniteRejected):
            switch.rehearse_web_switch(self.plan, state_dir=self.state, adapter=self.adapter,
                                       clock=lambda: 10, sleep=lambda seconds: None)
        self.assertEqual(self.adapter.read()["applies"], 0)
        self.assert_old_accepted()

    def test_conflicting_plan_and_tampered_journal_fail_before_any_more_mutations(self):
        self.adapter.switch_outcome = "unknown-before"
        with self.assertRaises(switch.SwitchUnknown):
            self.run_switch()
        changed = {**self.plan, "candidateName": "other-candidate"}
        with self.assertRaises(switch.SwitchConflict):
            self.run_switch(changed)
        event_path = self.state / "operations" / self.plan["operationId"] / "0005.json"
        envelope = json.loads(event_path.read_text())
        envelope["payload"]["state"] = "COMPLETED"
        event_path.write_text(json.dumps(envelope))
        with self.assertRaises(switch.SwitchConflict):
            self.run_switch()
        self.assertEqual(self.adapter.read()["applies"], 1)
        self.assert_old_accepted()

    def test_changed_unrelated_services_or_old_runtime_cannot_be_accepted(self):
        self.adapter.switch_outcome = "unknown-after"
        with self.assertRaises(switch.SwitchUnknown):
            self.run_switch()
        state = self.adapter.read()
        state["accepted"]["restartCount"] += 1
        self.adapter.write(state)
        with self.assertRaises(switch.SwitchHeld):
            self.run_switch()
        self.assertEqual((self.state / "accepted.json").read_bytes(), self.accepted_bytes)
        state["accepted"] = copy.deepcopy(self.before["runtime"])
        state["unrelated"] = "0" * 64
        self.adapter.write(state)
        with self.assertRaises(switch.SwitchHeld):
            self.run_switch()
        self.assert_old_accepted()

    def test_prepared_restart_refuses_a_candidate_without_creation_intent(self):
        actual = switch._Operation.append
        def append(operation, state, **values):
            actual(operation, state, **values)
            if state == "PREPARED":
                raise Crash()
        with patch.object(switch._Operation, "append", new=append):
            with self.assertRaises(Crash):
                self.run_switch()
        state = self.adapter.read()
        state["candidate"] = {**runtime("2", self.plan["candidateName"]), "ownerOperation": self.plan["operationId"]}
        self.adapter.write(state)
        with self.assertRaises(switch.SwitchConflict):
            self.run_switch()
        self.assertEqual((self.adapter.read()["creates"], self.adapter.read()["applies"]), (0, 0))
        self.assert_old_accepted()


if __name__ == "__main__":
    unittest.main()
