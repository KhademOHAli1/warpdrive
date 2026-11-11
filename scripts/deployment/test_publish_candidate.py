import json
import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from bundle import ARCHIVE, MANIFEST, METADATA_FILES, create_bundle
from candidate import CandidateError
from publication_history import ReconcileOnly
import publish_candidate as publisher
from test_bundle import FakeDocker, write_candidate
from test_candidate import SHA


class HostedGuardTests(unittest.TestCase):
    def test_requires_trusted_hosted_main_and_exact_source(self):
        environment = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
                       "GITHUB_REPOSITORY": publisher.REPO, "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SHA}
        publisher.require_hosted_main(environment, SHA)
        for key, value in (("GITHUB_ACTIONS", "false"), ("RUNNER_ENVIRONMENT", "self-hosted"),
                           ("GITHUB_REPOSITORY", "fork/repo"), ("GITHUB_REF", "refs/pull/1/merge"),
                           ("GITHUB_SHA", "f" * 40)):
            with self.subTest(key=key), self.assertRaises(CandidateError):
                publisher.require_hosted_main({**environment, key: value}, SHA)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        source = self.root / "source"
        write_candidate(source)
        self.producer = {"runId": 42, "runAttempt": 1, "event": "push", "ref": "refs/heads/main"}
        self.bundle = self.root / "bundle"
        create_bundle(source, self.bundle, expected_revision=SHA, docker=FakeDocker(),
                      origin={"kind": "github-actions", "repository": publisher.REPO, **self.producer})
        archive = self.bundle.with_name(self.bundle.name + ".zip")
        with zipfile.ZipFile(archive, "w") as output:
            for name in (*METADATA_FILES, ARCHIVE, MANIFEST):
                output.write(self.bundle / name, name)
        self.admission = {"schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission",
                          "repository": publisher.REPO, "revision": SHA, "producer": self.producer,
                          "artifact": {"id": 81, "digest": "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest(),
                                       "sizeBytes": archive.stat().st_size}, "deploymentAuthorized": False}
        self.calls = []

        class LoadedDocker:
            def run(inner, args, **kwargs):
                self.calls.append(args)

        self.docker = LoadedDocker()
        self.history = patch.object(publisher, "prior_write_opportunities", return_value=[])
        self.history.start()
        self.addCleanup(self.history.stop)

    def invoke(self):
        return publisher.publish_verified(self.bundle, self.admission, expected_main=SHA,
                                          repository_prefix="ghcr.io/owner/warpdrive", attempt_id="run-42",
                                          journal_path=self.root / "journal.json", output_path=self.root / "result.json",
                                          api=object(), docker=self.docker, adapter=object(),
                                          workflow_run_id=99, workflow_run_attempt=1)

    def test_loads_exact_archive_and_rechecks_source_before_and_after_publication(self):
        with patch.object(publisher, "admit", return_value=self.admission) as gate, \
                patch.object(publisher, "promote_candidate", return_value={"deploymentAuthorized": False}) as promote:
            result = self.invoke()
        self.assertEqual(gate.call_count, 2)
        self.assertEqual(self.calls, [["image", "load", "--input", str((self.bundle / "core-images.tar").resolve())]])
        self.assertEqual(promote.call_args.kwargs["expected_revision"], SHA)
        self.assertEqual(set(promote.call_args.kwargs["bundle_provenance"]), {"archiveSha256", "bundleManifestSha256"})
        self.assertFalse(result["deploymentAuthorized"])
        history = json.loads((self.root / "publication-history.json").read_text())
        self.assertFalse(history["reconcileOnly"])
        self.assertEqual(history["runId"], 99)

    def test_prior_push_opportunity_wraps_the_real_promoter_adapter_for_readback_only(self):
        witness = {"runId": 98, "runAttempt": 1, "jobId": 55, "stepConclusion": "failure"}
        with patch.object(publisher, "admit", return_value=self.admission), \
                patch.object(publisher, "prior_write_opportunities", return_value=[witness]), \
                patch.object(publisher, "promote_candidate", return_value={"deploymentAuthorized": False}) as promote:
            self.invoke()
        self.assertIsInstance(promote.call_args.kwargs["adapter"], ReconcileOnly)
        history = json.loads((self.root / "publication-history.json").read_text())
        self.assertTrue(history["reconcileOnly"])
        self.assertEqual(history["priorWriteOpportunities"], [witness])

    def test_same_attempt_can_reconcile_in_place_without_overwriting_history(self):
        with patch.object(publisher, "admit", return_value=self.admission), \
                patch.object(publisher, "promote_candidate", return_value={"deploymentAuthorized": False}) as promote:
            self.invoke()
            path = self.root / "publication-history.json"
            original = path.read_bytes()
            self.invoke()
        self.assertEqual(promote.call_count, 2)
        self.assertEqual(path.read_bytes(), original)

    def test_changed_history_holds_same_directory_resume_before_loading_again(self):
        with patch.object(publisher, "admit", return_value=self.admission), \
                patch.object(publisher, "promote_candidate", return_value={"deploymentAuthorized": False}) as promote:
            self.invoke()
            path = self.root / "publication-history.json"
            original = path.read_bytes()
            with patch.object(publisher, "prior_write_opportunities", return_value=[{"runId": 98}]), \
                    self.assertRaisesRegex(CandidateError, "history changed"):
                self.invoke()
        self.assertEqual(promote.call_count, 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(path.read_bytes(), original)

    def test_gate_or_origin_change_blocks_before_loading_or_pushing(self):
        for kind in ("source", "origin"):
            changed = {**self.admission, "artifact": {"id": 999}}
            if kind == "origin":
                changed = {**self.admission, "producer": {**self.producer, "runAttempt": 2}}
                self.admission = changed
            with patch.object(publisher, "admit", return_value=changed), \
                    patch.object(publisher, "promote_candidate") as promote:
                with self.subTest(kind=kind), self.assertRaises(CandidateError):
                    self.invoke()
                promote.assert_not_called()
                self.assertEqual(self.calls, [])

    def test_late_main_change_is_held_without_replaying_the_completed_publication(self):
        with patch.object(publisher, "admit", side_effect=[self.admission, publisher.GateError("main moved")]), \
                patch.object(publisher, "promote_candidate", return_value={"deploymentAuthorized": False}) as promote:
            with self.assertRaises(publisher.GateError):
                self.invoke()
            self.assertEqual(promote.call_count, 1)

    def test_self_consistent_same_origin_bundle_substitution_is_rejected(self):
        # Internal hashes and origin still match one another; only the admitted ZIP binds reality.
        path = self.bundle / ARCHIVE
        path.write_bytes(b"substituted archive")
        manifest_path = self.bundle / MANIFEST
        manifest = json.loads(manifest_path.read_text())
        manifest["files"][ARCHIVE] = {"sizeBytes": path.stat().st_size,
                                      "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        manifest_path.write_text(json.dumps(manifest))
        with patch.object(publisher, "admit", return_value=self.admission), \
                patch.object(publisher, "promote_candidate") as promote:
            with self.assertRaises(CandidateError):
                self.invoke()
            promote.assert_not_called()
            self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
