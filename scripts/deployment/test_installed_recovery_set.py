"""Verify the installed profile contract through owned encrypted snapshot rehearsal."""

from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
import os
import unittest

import recovery as r
from restore_recovery_set import _inventory, restore_existing
from test_recovery import Fixture, put
from test_restore_recovery_set import initialize_independent_fixture_keys, revoke_fixture_writer


class InstalledFixture(Fixture):
    def __init__(self):
        super().__init__()
        self.route_bytes = b'{"http":{"routers":{"fixture-route":{}}}}\n'
        self.watched = self.root / "watched" / "warpdrive-web-relay.yaml"
        put(self.watched, self.route_bytes, 0o644)
        self.autosave = self.root / "relay" / "config" / "caddy" / "autosave.json"
        put(self.autosave, b'{"fixture":true}')
        secret_paths = {}
        for name in r.INSTALLED_SECRET_NAMES:
            secret_path = self.root / "installed-secrets" / ("runtime-database-url" if name == "database_url" else name)
            put(secret_path, self.secret, 0o400)
            secret_paths[name] = str(secret_path)
        self.sources = {"postgres": self.members["postgres"], "objects": self.members["objects"],
                        "newsletterMedia": {"engine-media": self.members["newsletterMedia"]},
                        "relayAutosave": str(self.autosave), "secrets": secret_paths,
                        "protectedState": {"accepted-pointer": str(self.configuration)}}
        self.plan = {**{key: self.plan[key] for key in ("operationId", "installationId", "repositoryId", "limits")},
                     "schemaVersion": 2, "kind": r.INSTALLED_PLAN_KIND,
                     "members": {**deepcopy(self.sources), "ingressRoute": str(self.journal.path / r.INSTALLED_INGRESS_COPY)},
                     "watchedIngress": str(self.watched), "ingressRouteSha256": r.digest(self.route_bytes)}
        self.observer = InstalledObserver(self)

    def capture(self, *, reconcile=False, target=None):
        return r.capture_installed(self.plan, self.journal, self.observer, self.primary, self.reader,
                                   target or self.root / "restore", reconcile=reconcile)


class InstalledObserver:
    def __init__(self, fixture):
        self.fixture = fixture
        self.active = False
        self.reads = 0
        self.drift = {}

    @contextmanager
    def hold(self, plan):
        r.require(not self.active, "Fixture hold reentered")
        self.active = True
        try:
            yield
        finally:
            self.active = False

    def observe_installed(self, plan):
        r.require(self.active, "Fixture hold released during readback")
        self.reads += 1
        fixture = self.fixture
        observation = r.InstalledColdObservation(
            deepcopy(fixture.sources), str(fixture.watched), fixture.watched.read_bytes(),
            {"runtime": {"syntheticSecret": fixture.secret.decode()}}, "d" * 64,
        )
        return replace(observation, **self.drift.get(self.reads, {}))


class InstalledRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = InstalledFixture()
        self.addCleanup(self.fixture.close)

    def test_typed_capture_holds_for_backup_and_restore_and_does_not_write_watched_route(self):
        f = self.fixture
        original = f.watched.stat()
        f.store.mutate = lambda: self.assertTrue(f.observer.active)
        restore = f.reader.restore

        def held_restore(*args, **kwargs):
            self.assertTrue(f.observer.active)
            return restore(*args, **kwargs)

        f.reader.restore = held_restore
        receipt = f.capture()
        self.assertEqual(f.observer.reads, 5)
        self.assertFalse(f.observer.active)
        self.assertEqual(receipt["schemaVersion"], 2)
        self.assertEqual(receipt["kind"], r.INSTALLED_RECEIPT_KIND)
        self.assertFalse(receipt["writerResumptionAuthorized"])
        self.assertNotIn(f.secret, r.canonical(receipt))
        manifest = r.document((f.journal.path / "recovery-manifest.json").read_bytes())
        self.assertEqual(manifest["kind"], r.INSTALLED_MANIFEST_KIND)
        self.assertEqual(manifest["members"], f.plan["members"])
        self.assertEqual(manifest["scope"], r.INSTALLED_SCOPE)
        self.assertNotIn(str(f.watched), manifest["inventory"]["roots"])
        self.assertEqual(f.watched.read_bytes(), f.route_bytes)
        self.assertEqual(f.watched.stat().st_ino, original.st_ino)
        self.assertEqual(Path(f.plan["members"]["ingressRoute"]).read_bytes(), f.route_bytes)
        self.assertEqual(f.capture(), receipt)
        self.assertEqual(f.store.backups, 1)

    def test_stock_schema_and_alias_or_role_changes_hold_before_backup(self):
        f = self.fixture
        with self.assertRaises(r.RecoveryError):
            r.capture(f.plan, f.journal, f.observer, f.primary, f.reader, f.root / "unrecognized")
        accepted = deepcopy(f.plan["members"])
        for overrides in ({"objects": accepted["postgres"]},
                          {"objects": accepted["postgres"] + "/nested"},
                          {"relayAutosave": accepted["ingressRoute"]},
                          {"secrets": {}}, {"protectedState": {}},
                          {"ingressRoute": str(f.watched)}):
            with self.subTest(overrides=overrides), self.assertRaises(r.RecoveryError):
                f.plan["members"] = accepted | overrides
                f.capture()
        f.plan["members"] = accepted
        f.observer.drift[1] = {"source_members": f.sources | {"objects": f.sources["postgres"]}}
        with self.assertRaisesRegex(r.RecoveryError, "observation differs"):
            f.capture()
        self.assertEqual(f.store.backups, 0)

    def test_installed_file_hardlink_or_wrong_inventory_kind_holds(self):
        f = self.fixture
        alias = f.root / "foreign-source-alias"
        alias.hardlink_to(f.autosave)
        with self.assertRaisesRegex(r.RecoveryError, "another hardlink"):
            f.capture()
        self.assertEqual(f.store.backups, 0)
        alias.unlink()
        f.journal = r.Journal(f.root / "new-state")
        f.plan["members"]["ingressRoute"] = str(f.journal.path / r.INSTALLED_INGRESS_COPY)
        f.autosave.unlink()
        f.autosave.mkdir()
        with self.assertRaisesRegex(r.RecoveryError, "typed roots"):
            f.capture()
        self.assertEqual(f.store.backups, 0)

    def test_observation_drift_before_intent_and_after_backup_holds(self):
        f = self.fixture
        f.observer.drift[2] = {"native_fingerprint": "0" * 64}
        with self.assertRaisesRegex(r.RecoveryError, "changed during preparation"):
            f.capture()
        self.assertEqual(f.store.backups, 0)
        with self.assertRaisesRegex(r.RecoveryError, "Incomplete prepared"):
            f.capture(reconcile=True)
        f.journal = r.Journal(f.root / "new-state")
        f.plan["members"]["ingressRoute"] = str(f.journal.path / r.INSTALLED_INGRESS_COPY)
        f.observer.reads = 0
        f.observer.drift = {4: {"private_configuration": {"changed": True}}}
        with self.assertRaises(r.RecoveryUnknown):
            f.capture()
        self.assertEqual(f.store.backups, 1)
        self.assertFalse((f.root / "restore").exists())
        with f.journal.lock():
            self.assertEqual(f.journal.read()[-1]["state"], "UNKNOWN")
        f.observer.drift.clear()
        self.assertTrue(f.capture(reconcile=True)["isolatedRestoreBytesVerified"])
        self.assertEqual(f.store.backups, 1)

    def test_manifest_requires_all_and_only_typed_roots_with_ingress_digest(self):
        f = self.fixture
        f.capture()
        member = f.journal.path / "recovery-manifest.json"
        manifest = r.document(member.read_bytes())
        for mutation in ("extra-root", "nested-ingress", "wrong-ingress", "wrong-kind"):
            with self.subTest(mutation=mutation):
                value = deepcopy(manifest)
                inventory = value["inventory"]
                if mutation == "extra-root":
                    extra = str(f.root / "foreign")
                    inventory["roots"].append(extra)
                    inventory["entries"].append({"path": extra, "kind": "directory", "mode": 0o700, "uid": 0, "gid": 0})
                elif mutation == "nested-ingress":
                    inventory["roots"].remove(f.plan["members"]["ingressRoute"])
                elif mutation == "wrong-ingress":
                    entry = next(row for row in inventory["entries"] if row["path"] == f.plan["members"]["ingressRoute"])
                    entry["sha256"] = "a" * 64
                else:
                    entry = next(row for row in inventory["entries"] if row["path"] == f.plan["members"]["relayAutosave"])
                    inventory["bytes"] -= entry.pop("bytes")
                    entry.pop("sha256")
                    entry["kind"] = "directory"
                with self.assertRaises(r.RecoveryError):
                    _inventory(inventory, f.plan["limits"], max_roots=r.INSTALLED_MAX_ROOTS + 1)
                    r._validate_installed_manifest(value, f.plan, member, inventory)


@unittest.skipUnless(os.environ.get("WARPDRIVE_RECOVERY_INSTALLED_CRYPTO_FIXTURE") == "1", "Explicit installed Restic fixture only")
class InstalledCryptoTests(unittest.TestCase):
    def test_actual_encrypted_capture_then_independent_restore_without_source_or_writer(self):
        f = InstalledFixture()
        self.addCleanup(f.close)
        binary = Path(os.environ.get("WARPDRIVE_RECOVERY_RESTIC", "/opt/homebrew/bin/restic")).resolve(strict=True)
        expected_sha256 = os.environ.get("WARPDRIVE_RECOVERY_RESTIC_SHA256")
        self.assertIsNotNone(expected_sha256, "Pin the exact installed fixture Restic binary")
        self.assertEqual(r.digest(binary.read_bytes()), expected_sha256)
        writer = initialize_independent_fixture_keys(f, binary, seconds=90)
        receipt = f.capture()
        revoke_fixture_writer(f, binary, writer)
        member = f.journal.path / "recovery-manifest.json"
        retained_manifest, retained_receipt = f.root / "retained-manifest.json", f.root / "retained-receipt.json"
        put(retained_manifest, member.read_bytes())
        raw_receipt = r.canonical(receipt)
        put(retained_receipt, raw_receipt)
        for path in ("source", "state", "key-primary", "configuration", "relay", "installed-secrets", "watched"):
            (f.root / path).rename(f.root / ("offline-" + path))
        reader = r.Restic(binary, str(f.repo), f.keys[1], seconds=90)
        target = f.root / "independent"
        options = {"expected_receipt_sha256": r.digest(raw_receipt), "manifest_path": retained_manifest,
                   "original_manifest_member": member, "reader": reader, "restore_target": target, "budget": f.plan["limits"]}
        with self.assertRaises(r.RecoveryError):
            restore_existing(retained_receipt, **options)
        with self.assertRaises(r.RecoveryError):
            restore_existing(retained_receipt, **options, installed_plan={**f.plan, "operationId": "different"})
        self.assertFalse(target.exists())
        result = restore_existing(retained_receipt, **options, installed_plan=f.plan)
        self.assertEqual(result["schemaVersion"], 2)
        self.assertEqual(result["kind"], "warpdrive-independent-installed-recovery-restore")
        self.assertEqual(result["planSha256"], receipt["planSha256"])
        self.assertFalse(result["applicationRecoveryAccepted"])
        for path, expected in ((f.plan["members"]["ingressRoute"], f.route_bytes),
                               (f.plan["members"]["secrets"]["auth_secret"], f.secret)):
            self.assertEqual((target / path.lstrip("/")).read_bytes(), expected)


if __name__ == "__main__":
    unittest.main()
