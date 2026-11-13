"""Exercise host-independent restore against an actual owned encrypted snapshot."""

from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import shutil
import time
import unittest
from uuid import uuid4

import recovery as r
from restore_recovery_set import _inventory, restore_existing
from test_recovery import Fixture, put


def _fixture_restic(binary, repository, password, *args):
    """Run key management only against repositories owned by the test fixture."""
    return r.Command().run([str(binary), "--repo", str(repository), "--password-file", str(password),
                            "--no-cache", "--json", *args], seconds=30)


def _key_slots(binary, repository, password):
    rows = r.document(_fixture_restic(binary, repository, password, "key", "list"))
    r.require(type(rows) is list and 0 < len(rows) <= 2, "Unexpected fixture key slot inventory")
    r.require(all(type(row) is dict and isinstance(row.get("id"), str) and r.HASH.fullmatch(row["id"])
                  and type(row.get("current")) is bool for row in rows), "Invalid fixture key slot evidence")
    slots = {row["id"] for row in rows}
    current = [row["id"] for row in rows if row["current"]]
    r.require(len(current) == 1 and len(slots) == len(rows), "Exactly one fixture key slot must authenticate")
    return slots, current[0]


def _revoke_key(binary, repository, *, retained, removed, slot):
    _fixture_restic(binary, repository, retained, "key", "remove", slot)
    slots, current = _key_slots(binary, repository, retained)
    r.require(slots == {current} and current != slot, "Fixture key revocation changed the retained slot")
    try:
        _fixture_restic(binary, repository, removed, "cat", "config")
    except r.RecoveryCommandFailure as error:
        r.require(error.exit_code == 12, "Revoked fixture key failed for a reason other than its password")
    else:
        raise AssertionError("Revoked fixture key still authenticates")


def initialize_independent_fixture_keys(fixture, binary, *, seconds, prove_reader_revocation=False):
    """Make distinct passwords and prove which encrypted key each password unlocks."""
    writer, reader = fixture.keys
    put(reader, (secrets.token_hex(32) + "\n").encode())
    fixture.primary = r.Restic(binary, str(fixture.repo), writer, seconds=seconds)
    fixture.reader = r.Restic(binary, str(fixture.repo), reader, seconds=seconds)
    r.require(fixture.primary.key_sha != fixture.reader.key_sha, "Fixture writer and reader passwords must differ")
    _fixture_restic(binary, fixture.repo, writer, "init", "--repository-version", "2")
    _fixture_restic(binary, fixture.repo, writer, "key", "add", "--new-password-file", str(reader),
                    "--user", "fixture-reader", "--host", "warpdrive-test")
    writer_slots, writer_id = _key_slots(binary, fixture.repo, writer)
    reader_slots, reader_id = _key_slots(binary, fixture.repo, reader)
    r.require(writer_slots == reader_slots == {writer_id, reader_id} and writer_id != reader_id,
              "Fixture credentials must authenticate distinct repository key slots")
    if prove_reader_revocation:
        reverse = fixture.root / "reader-revocation-repository"
        shutil.copytree(fixture.repo, reverse)
        try:
            _revoke_key(binary, reverse, retained=writer, removed=reader, slot=reader_id)
        finally:
            shutil.rmtree(reverse)
    fixture.plan["repositoryId"] = fixture.primary.repository_id()
    r.require(fixture.reader.repository_id() == fixture.plan["repositoryId"], "Fixture repository identity differs")
    return writer_id


def revoke_fixture_writer(fixture, binary, writer_id):
    """Remove the owned repository's writer slot after capture, before recovery."""
    writer, reader = fixture.keys
    _revoke_key(binary, fixture.repo, retained=reader, removed=writer, slot=writer_id)
    r.require(fixture.reader.repository_id() == fixture.plan["repositoryId"], "Fixture repository identity differs after revocation")


class RestoreInventoryTests(unittest.TestCase):
    def test_rejects_unowned_members_and_unbounded_file_size(self):
        roots = ["/old-host/data"]
        directory = {"path": roots[0], "kind": "directory", "mode": 0o700, "uid": 1000, "gid": 1000}
        file = {"path": roots[0] + "/leaf", "kind": "file", "mode": 0o600, "uid": 1000, "gid": 1000,
                "bytes": 1, "sha256": "a" * 64}
        budget = {**r.DEFAULT_LIMITS, "fileBytes": 4}
        inventory = {"roots": roots, "entries": [directory, file], "bytes": 1}
        self.assertEqual(_inventory(inventory, budget)[0], [Path(roots[0])])
        with self.assertRaisesRegex(r.RecoveryError, "ancestors"):
            _inventory({**inventory, "entries": [directory, {**file, "path": "/outside/member"}]}, budget)
        with self.assertRaisesRegex(r.RecoveryError, "exceeds its bound"):
            _inventory({**inventory, "entries": [directory, {**file, "bytes": 5}], "bytes": 5}, budget)


@unittest.skipUnless(os.environ.get("WARPDRIVE_RECOVERY_CRYPTO_FIXTURE") == "1", "Explicit owned restic fixture only")
class IndependentRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = Fixture()
        cls.addClassCleanup(cls.fixture.close)
        f = cls.fixture
        cls.binary = Path(os.environ.get("WARPDRIVE_RECOVERY_RESTIC", "/opt/homebrew/bin/restic")).resolve(strict=True)
        writer_id = initialize_independent_fixture_keys(f, cls.binary, seconds=90, prove_reader_revocation=True)
        cls.receipt = f.capture()
        revoke_fixture_writer(f, cls.binary, writer_id)
        original_member = f.journal.path / "recovery-manifest.json"
        cls.retained_manifest = f.root / "retained-manifest.json"
        cls.retained_receipt = f.root / "retained-receipt.json"
        put(cls.retained_manifest, original_member.read_bytes())
        put(cls.retained_receipt, r.canonical(cls.receipt))
        cls.pin = sha256(cls.retained_receipt.read_bytes()).hexdigest()
        cls.member = original_member
        # Simulate the source storage, journal, original credential and prior
        # verification target being inaccessible on the recovery host.
        for name in ("source", "configuration", "state", "restore", "key-primary"):
            (f.root / name).rename(f.root / ("offline-" + name))
        cls.reader = r.Restic(cls.binary, str(f.repo), f.keys[1], seconds=90)

    def restore(self, name, **overrides):
        f = self.fixture
        options = {"expected_receipt_sha256": self.pin, "manifest_path": self.retained_manifest,
                   "original_manifest_member": self.member, "reader": self.reader,
                   "restore_target": f.root / name, "budget": f.plan["limits"]}
        return restore_existing(self.retained_receipt, **(options | overrides))

    def test_real_restore_from_snapshot_with_original_sources_unavailable(self):
        self.assertFalse(self.member.exists())
        result = self.restore("independent")
        target = self.fixture.root / "independent"
        old_file = Path(self.fixture.members["postgres"]) / "encrypted-record.data"
        self.assertFalse(old_file.exists())
        self.assertEqual((target / str(old_file).lstrip("/")).read_bytes(), self.fixture.secret)
        self.assertTrue(result["isolatedRestoreBytesVerified"])
        self.assertFalse(result["writerResumptionAuthorized"])
        self.assertFalse(result["applicationRecoveryAccepted"])
        self.assertEqual(result["snapshotId"], self.receipt["snapshotId"])
        self.assertEqual(self.reader.repository_id(), self.receipt["repositoryId"])

    def test_handoff_binds_original_repository_pin_completion_and_exact_restore(self):
        root = self.fixture.root
        installation = str(uuid4())
        handoff = root / "completed-restore-handoff"
        before = time.time_ns() // 1_000_000
        result = self.restore("monitored-restore", monitor_handoff=handoff, operations_installation_id=installation)
        raw = handoff.read_bytes()
        envelope = json.loads(raw)
        self.assertEqual(raw, r.canonical(envelope))
        self.assertEqual(handoff.stat().st_mode & 0o777, 0o600)
        self.assertEqual(handoff.stat().st_nlink, 1)
        self.assertEqual(envelope["operationsInstallationId"], installation)
        self.assertEqual(envelope["repositoryId"], self.receipt["repositoryId"])
        self.assertEqual(envelope["restore"], result)
        self.assertEqual(envelope["restore"]["receiptSha256"], self.pin)
        self.assertGreaterEqual(envelope["completedAtMs"], before)
        self.assertLessEqual(envelope["completedAtMs"], time.time_ns() // 1_000_000)
        self.assertFalse(list(root.glob(".restore-handoff-*")))
        with self.assertRaisesRegex(r.RecoveryError, "requires a new path"):
            self.restore("handoff-collision", monitor_handoff=handoff, operations_installation_id=installation)
        self.assertFalse((root / "handoff-collision").exists())
        self.assertEqual(handoff.read_bytes(), raw)

    def test_bad_monitor_scope_and_bad_receipt_never_publish_handoff(self):
        root = self.fixture.root
        handoff = root / "inadmissible-restore-handoff"
        options = {"monitor_handoff": handoff, "operations_installation_id": str(uuid4())}
        for overrides, pattern in (({"operations_installation_id": "invalid"}, "installation UUID"),
                                   ({"expected_receipt_sha256": "f" * 64}, "independent checksum")):
            with self.subTest(pattern=pattern), self.assertRaisesRegex(r.RecoveryError, pattern):
                self.restore("inadmissible-restore", **(options | overrides))
        self.assertFalse(handoff.exists())
        self.assertFalse((root / "inadmissible-restore").exists())

    def test_bad_pin_wrong_member_and_existing_target_never_restore(self):
        root = self.fixture.root
        for name, options, message in (
                ("bad-pin", {"expected_receipt_sha256": "f" * 64}, "independent checksum"),
                ("bad-member", {"original_manifest_member": root / "absent/recovery-manifest.json"}, "Snapshot paths")):
            with self.subTest(name=name), self.assertRaisesRegex(r.RecoveryError, message):
                self.restore(name, **options)
            self.assertFalse((root / name).exists())
        occupied = root / "occupied"
        occupied.mkdir(mode=0o700)
        put(occupied / "preserve", b"preserve")
        with self.assertRaisesRegex(r.RecoveryError, "new path"):
            self.restore("occupied")
        self.assertEqual((occupied / "preserve").read_bytes(), b"preserve")

    def test_wrong_key_and_corrupted_repository_do_not_report_success(self):
        root = self.fixture.root
        wrong = root / "wrong-reader-key"
        put(wrong, secrets.token_hex(32).encode())
        wrong_reader = r.Restic(self.binary, str(self.fixture.repo), wrong, seconds=90)
        with self.assertRaises(r.RecoveryError):
            self.restore("wrong-key-target", reader=wrong_reader)
        self.assertFalse((root / "wrong-key-target").exists())
        repository = root / "corrupted-copy"
        shutil.copytree(self.fixture.repo, repository)
        pack = next(path for path in (repository / "data").rglob("*") if path.is_file())
        pack.chmod(0o600)
        content = bytearray(pack.read_bytes())
        content[len(content) // 2] ^= 1
        pack.write_bytes(content)
        reader = r.Restic(self.binary, str(repository), self.fixture.keys[1], seconds=90)
        with self.assertRaises(r.RecoveryError):
            self.restore("corrupted-target", reader=reader)
