"""Verify installed lineage seals without touching ingress or a live runtime."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from installed_web_chain import REPOSITORY, admit_installed_web_chain
from installed_web_lineage import seal_first_installed_web_lineage
from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_candidate import ARCHIVE, MANIFEST
from web_publication_gate import CATEGORIES, JOB, WORKFLOW
from web_rollout import _record, _write_state, rollout_web
from web_switch import SwitchConflict, _read, canonical, content_hash


class InstalledWebLineageTests(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.state = Path(root.name).resolve() / "rollout"
        self.output = self.state.with_name("lineage")
        self.output.mkdir(mode=0o700)
        self.operation = "web-123456789abc"
        self.alias = "warpdrive-web-123456789abc"
        old, new = slot("1", "a", "a"), slot("2", "b", "b")
        new["runtime"]["name"] = self.alias
        backend = "3" * 64
        original, current = old["runtime"]["sourceRevision"], new["runtime"]["sourceRevision"]
        origin_a = {"kind": "github-actions", "repository": REPOSITORY, "ref": "refs/heads/main",
                    "event": "push", "runId": 1, "runAttempt": 1}
        origin_b = {**origin_a, "event": "workflow_dispatch", "runId": 2}
        test_a, test_b = "sha256:" + "c" * 64, "sha256:" + "d" * 64
        baseline = {"revision": original, "origin": origin_a, "manifestSha256": "a" * 64,
                    "archiveSha256": "c" * 64, "imageIds": {"web": test_a}}
        provenance = {"bundleManifestSha256": "b" * 64, "archiveSha256": "d" * 64, "archiveSizeBytes": 123}
        admission = {"schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission", "repository": REPOSITORY,
                     "revision": original, "deploymentAuthorized": False,
                     "artifact": {"id": 3, "digest": "sha256:" + "0" * 64},
                     "producer": {key: origin_a[key] for key in ("ref", "event", "runId", "runAttempt")}}
        web = {"schemaVersion": 1, "kind": "warpdrive-web-publication-admission", "repository": REPOSITORY, "revision": current,
               "deploymentAuthorized": False, "workflow": WORKFLOW, "origin": origin_b, "jobId": 3,
               "artifact": {"id": 4, "name": f"web-image-bundle-{current}-2-1", "digest": "sha256:" + "e" * 64, "sizeBytes": 1234},
               "security": {"revision": current, "ref": origin_b["ref"], "tool": "CodeQL", "categories": sorted(CATEGORIES),
                            "main_bound_before_and_after": True, "blocking_alerts": 0},
               "ci": [{"workflow": WORKFLOW, "run_id": 2, "attempt": 1, "jobs": [JOB]}], "baseline": baseline,
               "image": {"sourceRevision": current, "generation": new["route"]["generation"], "imageId": test_b},
               "provenance": provenance}
        original_custody = {"revision": original, "artifactId": 3, "zipDigest": admission["artifact"]["digest"],
                            "runId": 1, "runAttempt": 1, "bundleManifestSha256": baseline["manifestSha256"],
                            "archiveSha256": baseline["archiveSha256"], "imageIds": baseline["imageIds"]}
        original_load = {"kind": "warpdrive-core-image-load", "state": "verified", "deploymentAuthorized": False,
                         "revision": original, "manifestSha256": baseline["manifestSha256"],
                         "testedConfigDigests": baseline["imageIds"], "imageIds": {"web": old["runtime"]["imageId"]}}
        raw_web = canonical(web)
        self.authority = sha256(raw_web).hexdigest()
        artifact = {"origin": origin_b, "baselineRevision": original, "baselineManifestSha256": baseline["manifestSha256"],
                    "bundleManifestSha256": provenance["bundleManifestSha256"], "testedConfigDigest": test_b,
                    "deploymentAuthorized": False}
        imported = {**artifact, "kind": "warpdrive-web-artifact-import", "revision": current, "artifactId": 4,
                    "publicationReceiptSha256": self.authority,
                    "files": {ARCHIVE: {"sha256": provenance["archiveSha256"], "sizeBytes": provenance["archiveSizeBytes"]},
                              MANIFEST: {"sha256": provenance["bundleManifestSha256"], "sizeBytes": 1}}}
        loaded = {**artifact, "kind": "warpdrive-installed-web-image-load", "state": "verified", "sourceRevision": current,
                  "manifestDigest": new["runtime"]["imageId"], "imageId": new["runtime"]["imageId"],
                  "archiveSha256": provenance["archiveSha256"], "archiveSizeBytes": provenance["archiveSizeBytes"],
                  "daemon": {"serverId": "fixture"}}
        bound = {"publicationReceiptSha256": self.authority, "artifactOrigin": origin_b, "daemon": loaded["daemon"],
                 "backend": {"backendFingerprint": backend, "schemaSha256": new["runtime"]["schemaSha256"]},
                 "inputs": {"operationId": self.operation, "candidateAlias": self.alias, "baselineRevision": original,
                            "candidateRevision": current, "bundleManifestSha256": provenance["bundleManifestSha256"],
                            "archiveSha256": provenance["archiveSha256"], "testedConfigDigest": test_b},
                 "incumbent": {"app": {"id": old["runtime"]["runtimeId"], "imageId": old["runtime"]["imageId"]}}}
        self.evidence = {"originalPublication": canonical(admission), "originalCustody": canonical(original_custody),
                         "originalLoad": canonical(original_load),
                         "webPublication": raw_web, "webImport": imported, "webLoad": loaded, "boundRelease": bound}
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": self.operation + "-reapply",
                     "targetKey": "pitant-warpdrive", "before": old, "after": new,
                     "backendFingerprint": backend, "qualificationSha256": content_hash(bound)}
        clock = FakeClock()
        rollout_web(self.plan, state_dir=self.state, target=Target(self.plan), initialize=True,
                    clock=clock.monotonic, sleep=clock.sleep)
        self.pointer = self.state / "accepted-web-generation.json"
        self.journal = self.state / "web-rollouts" / f"{self.plan['operationId']}.json"
        self.observed = {"beforeRuntime": old["runtime"], "afterRuntime": new["runtime"], "backendFingerprint": backend,
                         "route": new["route"], "aliases": {old["route"]["generation"]: "app", new["route"]["generation"]: self.alias},
                         "liveConfigSha256": new["route"]["fingerprint"], "autosaveConfigSha256": new["route"]["fingerprint"],
                         "publicSourceRevision": current, "publicHealthy": True, "ingressReady": True}

    def seal(self, **changes):
        options = {"output_dir": self.output, "expected_operation_id": self.plan["operationId"],
                   "expected_plan_sha256": content_hash(self.plan),
                   "expected_a_authority_sha256": sha256(self.evidence["originalPublication"]).hexdigest(),
                   "expected_a_custody_sha256": sha256(self.evidence["originalCustody"]).hexdigest(),
                   "expected_a_load_sha256": sha256(self.evidence["originalLoad"]).hexdigest(),
                   "expected_b_authority_sha256": self.authority, "evidence": self.evidence,
                   "observe_installed": lambda: deepcopy(self.observed)}
        return seal_first_installed_web_lineage(self.state, **(options | changes))

    def test_sealed_generation_receipts_feed_existing_chain_verifier_and_repeat_is_read_only(self):
        pointer, journal = self.pointer.read_bytes(), self.journal.read_bytes()
        index = self.seal()
        modes = {item.name: item.stat().st_mode & 0o777 for item in self.output.iterdir()}
        self.assertEqual(modes, {"lineage.json": 0o400, "active.json": 0o400, "previous.json": 0o400})
        admitted = admit_installed_web_chain(self.state, plan=self.plan, active=self.output / "active.json",
                    previous=self.output / "previous.json", expected_active_sha256=index["activeSha256"],
                    expected_previous_sha256=index["previousSha256"])
        self.assertEqual(admitted["active"]["provenance"]["authoritySha256"], self.authority)
        self.assertEqual(admitted["previous"]["alias"], "app")
        inodes = [item.stat().st_ino for item in sorted(self.output.iterdir())]
        self.assertEqual(self.seal(), index)
        self.assertEqual([item.stat().st_ino for item in sorted(self.output.iterdir())], inodes)
        self.assertEqual((self.pointer.read_bytes(), self.journal.read_bytes()), (pointer, journal))

    def test_foreign_plan_or_pointer_fails_before_artifacts(self):
        with self.assertRaisesRegex(SwitchConflict, "plan was never accepted"):
            self.seal(expected_plan_sha256="f" * 64)
        _write_state(self.pointer, _record(self.plan, self.plan["before"]), previous=_read(self.pointer))
        with self.assertRaisesRegex(SwitchConflict, "pointer differs"):
            self.seal()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_mismatched_import_or_running_evidence_prevents_seal(self):
        wrong = deepcopy(self.evidence)
        wrong["webImport"]["testedConfigDigest"] = "sha256:" + "f" * 64
        with self.assertRaisesRegex(SwitchConflict, "artifact import differs"):
            self.seal(evidence=wrong)
        self.observed["autosaveConfigSha256"] = "0" * 64
        with self.assertRaisesRegex(SwitchConflict, "public ingress differs"):
            self.seal()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_stale_final_observation_leaves_no_seal_then_exact_readback_can_complete(self):
        snapshots = iter((self.observed, {**self.observed, "publicHealthy": False}))
        with self.assertRaisesRegex(SwitchConflict, "authority changed"):
            self.seal(observe_installed=lambda: next(snapshots))
        self.assertFalse((self.output / "lineage.json").exists())
        self.assertEqual(self.seal()["acceptedOperationId"], self.plan["operationId"])
        (self.output / "active.json").unlink()
        with self.assertRaisesRegex(SwitchConflict, "missing generation evidence"):
            self.seal()
