"""Check protected generation and journal bindings without runtime operations."""

from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import tempfile
import unittest

from installed_web_chain import REPOSITORY, admit_installed_web_chain
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_rollout import _record, _write_state, rollout_web
from web_switch import SwitchConflict, _lock, _read, canonical, content_hash


class InstalledWebChainTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name).resolve()
        self.state = self.root / "state"
        self.receipts = self.root / "receipts"
        self.receipts.mkdir(mode=0o700)
        self.active, self.previous = (self.receipts / f"{side}.json" for side in ("active", "previous"))
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "first-web", "targetKey": "installed",
                     "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                     "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        clock = FakeClock()
        rollout_web(self.plan, state_dir=self.state, target=Target(self.plan), initialize=True,
                    clock=clock.monotonic, sleep=clock.sleep)
        self.pointer = self.state / "accepted-web-generation.json"
        self.operations = self.state / "web-rollouts"
        self.journal = self.operations / "first-web.json"
        self.previous_receipt = self.generation("before", "app", "a")
        self.active_receipt = self.generation("after", "warpdrive-web-" + "b" * 12, "b")
        self.old_sha = self.write(self.previous, self.previous_receipt)
        self.new_sha = self.write(self.active, self.active_receipt)

    def generation(self, side, alias, digest):
        runtime = deepcopy(self.plan[side]["runtime"])
        return {"schemaVersion": 1, "kind": "warpdrive-installed-web-generation", "targetKey": self.plan["targetKey"],
                "backendFingerprint": self.plan["backendFingerprint"], "runtime": runtime, "alias": alias,
                "provenance": {"repository": REPOSITORY, "revision": runtime["sourceRevision"], "manifestSha256": digest * 64,
                               "archiveSha256": digest * 64, "testedConfigDigest": "sha256:" + digest * 64,
                               "authoritySha256": digest * 64}}

    @staticmethod
    def write(path, value):
        raw = canonical(value) + b"\n"
        path.write_bytes(raw)
        path.chmod(0o400)
        return sha256(raw).hexdigest()

    def read(self, **overrides):
        arguments = {"plan": self.plan, "active": self.active, "previous": self.previous,
                     "expected_active_sha256": self.new_sha, "expected_previous_sha256": self.old_sha}
        return admit_installed_web_chain(self.state, **(arguments | overrides))

    def test_returns_exact_slots_aliases_and_artifact_provenance(self):
        accepted = self.read()
        self.assertEqual(accepted["active"]["slot"], self.plan["after"])
        self.assertEqual(accepted["previous"]["slot"], self.plan["before"])
        self.assertEqual(accepted["active"]["alias"], self.active_receipt["alias"])
        self.assertEqual(accepted["previous"]["alias"], "app")
        self.assertEqual(accepted["active"]["provenance"], self.active_receipt["provenance"])
        self.assertEqual(accepted["previous"]["receiptSha256"], self.old_sha)
        self.assertEqual(accepted["acceptedPlanSha256"], content_hash(self.plan))
        accepted["active"]["slot"]["runtime"]["running"] = False
        self.assertTrue(self.read()["active"]["slot"]["runtime"]["running"])

    def test_state_requires_exact_terminal_predecessor_and_current_pointer(self):
        original = _read(self.journal)
        pending = {**original, "state": "switch-intent"}
        _write_state(self.journal, pending, previous=original)
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            self.read()
        _write_state(self.journal, original, previous=pending)
        wrong = {**self.plan, "qualificationSha256": "f" * 64}
        with self.assertRaisesRegex(SwitchConflict, "never accepted"):
            self.read(plan=wrong)
        _write_state(self.pointer, _record(self.plan, self.plan["before"]), previous=_read(self.pointer))
        with self.assertRaisesRegex(SwitchConflict, "pointer differs"):
            self.read()

    def test_other_in_progress_or_foreign_journal_holds_admission(self):
        other = self.operations / "pending.json"
        record = {"plan": {**self.plan, "operationId": "pending"}, "state": "rollback-intent"}
        _write_state(other, record)
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            self.read()
        foreign = {"plan": {**record["plan"], "targetKey": "foreign"}, "state": "accepted"}
        _write_state(other, foreign, previous=record)
        with self.assertRaisesRegex(SwitchConflict, "journal scope differs"):
            self.read()

    def test_checks_exact_immutable_pins_and_canonical_runtime_types(self):
        with self.assertRaisesRegex(SwitchConflict, "receipt SHA-256 differs"):
            self.read(expected_active_sha256="f" * 64)
        for field, value in (("runtimeId", "3" * 64), ("running", 1), ("schemaSha256", "f" * 64)):
            with self.subTest(field=field):
                changed = deepcopy(self.active_receipt)
                changed["runtime"][field] = value
                self.active.chmod(0o600)
                digest = self.write(self.active, changed)
                with self.assertRaisesRegex(SwitchConflict, "runtime differs"):
                    self.read(expected_active_sha256=digest)

    def test_rejects_scope_source_and_artifact_substitution(self):
        mutations = (
            ({"targetKey": "foreign"}, "scope"),
            ({"backendFingerprint": "d" * 64}, "scope"),
            ({"provenance": {**self.active_receipt["provenance"], "revision": "c" * 40}}, "provenance"),
            ({"provenance": {**self.active_receipt["provenance"], "repository": "untrusted/warpdrive"}}, "provenance"),
            ({"provenance": {**self.active_receipt["provenance"], "testedConfigDigest": self.previous_receipt["provenance"]["testedConfigDigest"]}}, "same alias or artifact"),
            ({"alias": "app"}, "same alias or artifact"),
        )
        for changed, message in mutations:
            with self.subTest(changed=changed):
                self.active.chmod(0o600)
                digest = self.write(self.active, self.active_receipt | changed)
                with self.assertRaisesRegex(SwitchConflict, message):
                    self.read(expected_active_sha256=digest)

    def test_owner_only_paths_and_shared_target_lock(self):
        with _lock(self.state), self.assertRaisesRegex(SwitchConflict, "owns this target"):
            self.read()
        self.active.chmod(0o644)
        with self.assertRaisesRegex(SwitchConflict, "private installed Web chain file"):
            self.read()
        self.active.chmod(0o400)
        link = self.receipts / "copy.json"
        os.link(self.active, link)
        with self.assertRaisesRegex(SwitchConflict, "private installed Web chain file"):
            self.read()
        link.unlink()
        link.symlink_to(self.active)
        with self.assertRaises(OSError):
            self.read(active=link)


if __name__ == "__main__":
    unittest.main()
