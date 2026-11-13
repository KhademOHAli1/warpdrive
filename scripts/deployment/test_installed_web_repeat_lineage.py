"""Seal an accepted repeat pair with real journal and v2 receipt validation."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from installed_web_chain import REPOSITORY, admit_installed_web_chain
from installed_web_lineage import _generation
from installed_web_repeat_image import ARCHIVE, MANIFEST, METADATA
from installed_web_repeat_lineage import seal_repeat_installed_web_lineage
from test_caddy_web_repeat import A, B, C
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_rollout import _record, _write_state, rollout_web
from web_switch import SwitchConflict, _read, canonical, content_hash


def record(raw):
    return {"sha256": sha256(raw).hexdigest(), "sizeBytes": len(raw)}


class InstalledWebRepeatLineageTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        root = Path(scratch.name).resolve()
        self.state, self.output, self.bundle, self.prior_output = (root / name for name in ("state", "lineage", "bundle", "prior"))
        for path in (self.output, self.bundle, self.prior_output):
            path.mkdir(mode=0o700)
        self.clock = FakeClock()
        a, b, c = (slot(i, name, name) for i, name in zip("123", "abc"))
        b["runtime"]["name"], c["runtime"]["name"] = B.target, C.target
        common = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "targetKey": "installed", "backendFingerprint": "a" * 64}
        self.first = {**common, "operationId": "web-bbbbbbbbbbbb-reapply", "before": a, "after": b, "qualificationSha256": "b" * 64}
        self.accept(self.first, initialize=True)
        prior_provenance = []
        for name, side, generation, digit in (("previous", "before", A, "d"), ("active", "after", B, "e")):
            evidence = {"repository": REPOSITORY, "revision": generation.deployment_id.removeprefix("wd-"), "manifestSha256": digit * 64,
                        "archiveSha256": digit * 64, "testedConfigDigest": "sha256:" + digit * 64, "authoritySha256": digit * 64}
            path = self.prior_output / (name + ".json")
            raw = canonical(_generation(self.first, side, generation.target, evidence)) + b"\n"
            path.write_bytes(raw)
            path.chmod(0o400)
            prior_provenance.append(record(raw)["sha256"])
        self.chain = admit_installed_web_chain(self.state, plan=self.first, active=self.prior_output / "active.json",
                    previous=self.prior_output / "previous.json", expected_active_sha256=prior_provenance[1],
                    expected_previous_sha256=prior_provenance[0])
        self.chain_pin = content_hash(self.chain)
        previous = self.chain["active"]["provenance"]
        baseline = {"installedLineageSha256": self.chain_pin, "activeWeb": {
            "revision": previous["revision"], "bundleManifestSha256": previous["manifestSha256"],
            "archiveSha256": previous["archiveSha256"], "imageId": previous["testedConfigDigest"],
            "publicationReceiptSha256": previous["authoritySha256"]}}
        origin = {"repository": REPOSITORY, "ref": "refs/heads/main", "event": "workflow_dispatch", "runId": 3, "runAttempt": 1}
        revision = c["runtime"]["sourceRevision"]
        image = {"imageId": "sha256:" + "f" * 64, "sourceRevision": revision, "generation": C.deployment_id, "runtimeUser": "1000:1000"}
        files = {}
        for name in (ARCHIVE, *METADATA):
            raw = name.encode()
            files[name] = record(raw)
            self.write_member(name, raw)
        manifest = {"schemaVersion": 2, "kind": "warpdrive-tested-repeat-web-bundle", "revision": revision, "platform": "linux/amd64",
                    "origin": origin, "baseline": baseline, "imageId": image["imageId"], "harnessRevision": "1" * 40,
                    "deploymentAuthorized": False, "files": files}
        manifest_bytes = canonical(manifest) + b"\n"
        self.write_member(MANIFEST, manifest_bytes)
        manifest_hash = record(manifest_bytes)["sha256"]
        self.receipt = {"schemaVersion": 2, "kind": "warpdrive-web-repeat-publication-admission", "repository": REPOSITORY,
                        "revision": revision, "workflow": "web-repeat-qualification.yml", "deploymentAuthorized": False,
                        "security": {"blocking_alerts": 0}, "baseline": baseline, "artifact": {"id": 4}, "origin": origin,
                        "harnessRevision": manifest["harnessRevision"], "image": image, "provenance": {
                        "bundleManifestSha256": manifest_hash, "archiveSha256": files[ARCHIVE]["sha256"],
                        "archiveSizeBytes": files[ARCHIVE]["sizeBytes"]}}
        self.publication = canonical(self.receipt)
        self.publication_pin = record(self.publication)["sha256"]
        self.imported = {"schemaVersion": 2, "kind": "warpdrive-web-repeat-artifact-import", "revision": revision,
                         "publicationReceiptSha256": self.publication_pin, "origin": origin, "artifactId": 4, "baseline": baseline,
                         "bundleManifestSha256": manifest_hash, "testedConfigDigest": image["imageId"],
                         "files": {MANIFEST: record(manifest_bytes), **files}, "deploymentAuthorized": False}
        self.loaded = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
                       "deploymentAuthorized": False, "sourceRevision": revision, "origin": origin,
                       "baselineRevision": previous["revision"], "baselineManifestSha256": previous["manifestSha256"],
                       **self.receipt["provenance"], "testedConfigDigest": image["imageId"],
                       "manifestDigest": c["runtime"]["imageId"], "imageId": c["runtime"]["imageId"]}
        qualification = content_hash({"installedChainSha256": self.chain_pin, "releaseQualificationSha256": content_hash(self.receipt)})
        self.plan = {**common, "operationId": "web-cccccccccccc", "before": b, "after": c, "qualificationSha256": qualification}
        self.accept(self.plan)
        self.journal = self.state / "web-rollouts" / (self.plan["operationId"] + ".json")
        self.pointer = self.state / "accepted-web-generation.json"
        self.observed = {"beforeRuntime": b["runtime"], "afterRuntime": c["runtime"], "backendFingerprint": common["backendFingerprint"],
                         "route": c["route"], "aliases": {B.deployment_id: B.target, C.deployment_id: C.target},
                         "liveConfigSha256": c["route"]["fingerprint"], "autosaveConfigSha256": c["route"]["fingerprint"],
                         "publicSourceRevision": revision, "publicHealthy": True, "ingressReady": True}

    def write_member(self, name, raw):
        path = self.bundle / name
        path.write_bytes(raw)
        path.chmod(0o600)

    def accept(self, plan, *, initialize=False):
        result = rollout_web(plan, state_dir=self.state, target=Target(plan), initialize=initialize,
                             clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.assertEqual(result["state"], "accepted")

    def seal(self, **overrides):
        options = {"output_dir": self.output, "admitted_chain": self.chain, "expected_chain_sha256": self.chain_pin,
                   "expected_operation_id": self.plan["operationId"], "expected_plan_sha256": content_hash(self.plan),
                   "bundle_dir": self.bundle, "publication_bytes": self.publication, "expected_publication_sha256": self.publication_pin,
                   "import_record": self.imported, "loaded": self.loaded, "candidate_alias": C.target,
                   "observe_installed": lambda: deepcopy(self.observed)}
        return seal_repeat_installed_web_lineage(self.state, **(options | overrides))

    def test_current_chain_c_and_b_without_live_a_preserves_immutable_receipts(self):
        original = {p.name: p.read_bytes() for p in self.prior_output.iterdir()}
        pointer = self.pointer.read_bytes()
        result = self.seal()
        next_chain = admit_installed_web_chain(self.state, plan=self.plan, active=self.output / "active.json",
            previous=self.output / "previous.json", expected_active_sha256=result["activeSha256"],
            expected_previous_sha256=result["previousSha256"])
        self.assertEqual(next_chain["active"]["slot"], self.plan["after"])
        self.assertEqual(next_chain["previous"]["slot"], self.plan["before"])
        self.assertEqual(result["previousSha256"], self.chain["active"]["receiptSha256"])
        self.assertEqual((self.output / "previous.json").read_bytes(), original["active.json"])
        self.assertEqual({p.name: p.read_bytes() for p in self.prior_output.iterdir()}, original)
        self.assertEqual(self.pointer.read_bytes(), pointer)
        inodes = {p.name: p.stat().st_ino for p in self.output.iterdir()}
        self.assertEqual(self.seal(), result)
        self.assertEqual({p.name: p.stat().st_ino for p in self.output.iterdir()}, inodes)

    def test_wrong_native_load_or_accepted_pointer_holds_without_sealing(self):
        with self.assertRaisesRegex(SwitchConflict, "native Web load receipt differs"):
            self.seal(loaded={**self.loaded, "manifestDigest": "sha256:" + "0" * 64})
        _write_state(self.pointer, _record(self.first, self.first["after"]), previous=_read(self.pointer))
        with self.assertRaisesRegex(SwitchConflict, "pointer differs"):
            self.seal()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_bad_predecessor_or_unresolved_journal_holds_without_writing(self):
        with self.assertRaisesRegex(SwitchConflict, "predecessor Web chain"):
            self.seal(expected_chain_sha256="0" * 64)
        _write_state(self.journal.with_name("another.json"), {"plan": {**self.plan, "operationId": "another"}, "state": "switch-intent"})
        with self.assertRaisesRegex(SwitchConflict, "unresolved Web rollout"):
            self.seal()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_accepted_healthy_reapply_can_reseal_pair_with_alternate_before_route(self):
        candidate, retained = self.plan["after"], self.plan["before"]
        reversed_retained = {**retained, "route": {**retained["route"], "fingerprint": "8" * 64}}
        self.accept({**self.plan, "operationId": self.plan["operationId"] + "-rollback", "before": candidate, "after": reversed_retained})
        self.plan = {**self.plan, "operationId": self.plan["operationId"] + "-reapply", "before": reversed_retained}
        self.accept(self.plan)
        index = self.seal()
        self.assertEqual(index["acceptedOperationId"], self.plan["operationId"])
        self.assertEqual(index["previousSha256"], self.chain["active"]["receiptSha256"])
        self.assertNotEqual(self.plan["before"]["route"], self.chain["active"]["slot"]["route"])

    def test_second_live_readback_failure_leaves_no_index(self):
        snapshots = iter((self.observed, {**self.observed, "autosaveConfigSha256": "0" * 64}))
        with self.assertRaisesRegex(SwitchConflict, "route or protected backend changed"):
            self.seal(observe_installed=lambda: next(snapshots))
        self.assertFalse((self.output / "lineage.json").exists())
        self.assertEqual(self.seal()["acceptedOperationId"], self.plan["operationId"])
