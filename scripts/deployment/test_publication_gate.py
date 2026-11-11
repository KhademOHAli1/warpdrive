import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import publication_gate as gate
from bundle import ARCHIVE, MANIFEST, METADATA_FILES, create_bundle, metadata_files
from candidate import CandidateError
from test_bundle import FakeDocker, write_candidate
from test_candidate import SHA


class FakeAPI:
    def __init__(self):
        self.main = SHA
        self.main_reads = 0
        self.change_main_after_first_read = False
        self.run = {"id": 42, "workflow_id": 15, "path": ".github/workflows/production-images.yml",
                    "head_sha": SHA, "head_branch": "main", "event": "push", "status": "completed",
                    "conclusion": "success", "repository": {"id": 7}, "head_repository": {"id": 7},
                    "run_attempt": 2}
        self.artifacts = [{"id": 81, "name": f"image-bundle-{SHA}-42-2", "expired": False,
                           "size_in_bytes": 123, "digest": "sha256:" + "a" * 64,
                           "workflow_run": {"id": 42, "head_sha": SHA, "head_branch": "main",
                                            "repository_id": 7, "head_repository_id": 7}}]

    def request(self, path):
        if path.endswith("/git/ref/heads/main"):
            self.main_reads += 1
            sha = "f" * 40 if self.change_main_after_first_read and self.main_reads > 1 else self.main
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": sha}}
        if path == f"repos/{gate.REPO}":
            return {"id": 7, "full_name": gate.REPO}
        if path.endswith("/workflows/production-images.yml"):
            return {"id": 15}
        if path.endswith("/runs/42"):
            return self.run
        raise AssertionError(path)

    def pages(self, path, key):
        if path.endswith("/runs/42/artifacts") and key == "artifacts":
            return self.artifacts
        raise AssertionError(path)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeAPI()
        self.ci = patch.object(gate, "verify_ci", return_value=[{"workflow": gate.WORKFLOW, "run_id": 42}])
        self.security = patch.object(gate, "verify_release_code_scanning", return_value={"blocking_alerts": 0})
        self.ci_mock, self.security_mock = self.ci.start(), self.security.start()
        self.addCleanup(self.ci.stop)
        self.addCleanup(self.security.stop)

    def test_exact_main_candidate_uses_existing_full_policy_and_security_gate(self):
        result = gate.admit(self.api, 42, SHA)
        policy = self.ci_mock.call_args.args[3]["required_workflows"]
        self.assertIn("CRM full checks", policy["full-ci.yml"])
        self.assertIn("Full browser smoke checks", policy["full-quality.yml"])
        self.assertIn("Delivery traceability", policy["delivery.yml"])
        self.assertEqual(policy[gate.WORKFLOW], ["Deployment tooling checks", "Final production image smoke"])
        self.assertEqual(self.security_mock.call_args.kwargs["categories"], {
            "/language:javascript-typescript", "/language:actions", "/language:python", "/language:go"})
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["artifact"]["id"], 81)

    def test_branch_pr_failed_wrong_source_fork_or_workflow_run_cannot_publish(self):
        for field, value in (("head_branch", "feature"), ("event", "pull_request"), ("head_sha", "f" * 40),
                             ("conclusion", "failure"), ("status", "in_progress"), ("workflow_id", 99),
                             ("head_repository", {"id": 999}), ("run_attempt", True)):
            api = FakeAPI()
            api.run[field] = value
            with self.subTest(field=field), self.assertRaises(CandidateError):
                gate.admit(api, 42, SHA)

    def test_missing_expired_ambiguous_unhashed_or_wrong_origin_artifacts_reject(self):
        for field, value in (("expired", True), ("digest", None), ("size_in_bytes", 0),
                             ("workflow_run", {"id": 42, "head_sha": "f" * 40})):
            api = FakeAPI()
            api.artifacts[0][field] = value
            with self.subTest(field=field), self.assertRaises(CandidateError):
                gate.admit(api, 42, SHA)
        for rows in ([], self.api.artifacts * 2):
            self.api.artifacts = rows
            with self.assertRaises(CandidateError):
                gate.admit(self.api, 42, SHA)

    def test_changed_main_failed_ci_or_security_never_admits(self):
        self.api.change_main_after_first_read = True
        with self.assertRaises(gate.GateError):
            gate.admit(self.api, 42, SHA)
        for function in ("verify_ci", "verify_release_code_scanning"):
            with patch.object(gate, function, side_effect=gate.GateError("required check failed")):
                with self.subTest(function=function), self.assertRaises(gate.GateError):
                    gate.admit(FakeAPI(), 42, SHA)

    def test_older_image_attempt_cannot_replace_latest_qualification(self):
        self.ci_mock.return_value = [{"workflow": gate.WORKFLOW, "run_id": 43}]
        with self.assertRaises(CandidateError):
            gate.admit(self.api, 42, SHA)


class DownloadTests(unittest.TestCase):
    def test_v2_api_bound_archive_retains_input_receipts_and_rejects_self_consistent_substitution(self):
        source = self.root / "v2-source"
        write_candidate(source, version=2)
        producer = self.admission["producer"]
        bundle = self.root / "v2-bundle"
        create_bundle(source, bundle, expected_revision=SHA, docker=FakeDocker(),
                      origin={"kind": "github-actions", "repository": gate.REPO, **producer})
        archive = self.root / "v2-source.zip"
        with zipfile.ZipFile(archive, "w") as output:
            for name in (*metadata_files(2), ARCHIVE, MANIFEST):
                output.write(bundle / name, name)
        self.raw = archive.read_bytes()
        self.admission["artifact"].update({"digest": "sha256:" + hashlib.sha256(self.raw).hexdigest(), "sizeBytes": len(self.raw)})
        destination = self.root / "v2-downloaded"
        loaded = gate.download_verified(self.admission, destination, expected_revision=SHA, runner=self.runner)
        self.assertEqual(loaded["candidate"]["schemaVersion"], 2)
        self.assertTrue((destination / "component-inputs.json").is_file())
        manifest = json.loads((destination / MANIFEST).read_text())
        manifest["releaseRevision"] = "f" * 40
        (destination / MANIFEST).write_text(json.dumps(manifest))
        with self.assertRaises(CandidateError):
            gate.verify_downloaded(self.admission, destination, expected_revision=SHA)

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.source = self.root / "source"
        write_candidate(self.source)
        producer = {"runId": 42, "runAttempt": 2, "event": "push", "ref": "refs/heads/main"}
        self.bundle = self.root / "bundle"
        create_bundle(self.source, self.bundle, expected_revision=SHA, docker=FakeDocker(),
                      origin={"kind": "github-actions", "repository": gate.REPO, **producer})
        archive = self.root / "source.zip"
        with zipfile.ZipFile(archive, "w") as output:
            for name in (*METADATA_FILES, ARCHIVE, MANIFEST):
                output.write(self.bundle / name, name)
        self.raw = archive.read_bytes()
        self.admission = {"schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission",
                          "repository": gate.REPO, "revision": SHA, "producer": producer,
                          "artifact": {"id": 81, "digest": "sha256:" + hashlib.sha256(self.raw).hexdigest(),
                                       "sizeBytes": len(self.raw)}, "deploymentAuthorized": False}

    def runner(self, command, **options):
        self.assertEqual(command, ["gh", "api", f"repos/{gate.REPO}/actions/artifacts/81/zip"])
        options["stdout"].write(self.raw)
        return subprocess.CompletedProcess(command, 0)

    def test_download_is_hash_bound_and_loaded_without_executing_archive_code(self):
        result = gate.download_verified(self.admission, self.root / "download", expected_revision=SHA, runner=self.runner)
        self.assertEqual(result["candidate"]["revision"], SHA)
        self.assertFalse(result["candidate"]["deploymentAuthorized"])

    def test_transport_or_digest_change_never_extracts_payload(self):
        for kind in ("transport", "digest", "size"):
            bad = copy.deepcopy(self.admission)
            destination = self.root / kind
            runner = self.runner
            if kind == "digest":
                bad["artifact"]["digest"] = "sha256:" + "f" * 64
            elif kind == "size":
                bad["artifact"]["sizeBytes"] += 1
            else:
                runner = lambda *a, **k: subprocess.CompletedProcess(a[0], 1)
            with self.subTest(kind=kind), self.assertRaises(CandidateError):
                gate.download_verified(bad, destination, expected_revision=SHA, runner=runner)
            self.assertFalse(destination.exists())

    def test_origin_claim_must_match_admitted_producer(self):
        self.admission["producer"]["runAttempt"] = 3
        with self.assertRaises(CandidateError):
            gate.download_verified(self.admission, self.root / "wrong-origin", expected_revision=SHA, runner=self.runner)

    def test_zip_path_traversal_duplicates_symlinks_and_extra_code_are_rejected(self):
        for name, symlink in (("../escape", False), ("candidate.json", False), ("secret-link", True), ("run.py", False)):
            archive = self.root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as output:
                for member in (*METADATA_FILES, ARCHIVE, MANIFEST):
                    output.write(self.bundle / member, member)
                info = zipfile.ZipInfo(name)
                if symlink:
                    info.external_attr = 0o120777 << 16
                output.writestr(info, b"untrusted")
            destination = self.root / "unsafe-output"
            with self.subTest(name=name), self.assertRaises(CandidateError):
                gate.extract_bundle_zip(archive, destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
