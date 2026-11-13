"""Offline successor custody authority, transport and recovery controls."""

from contextlib import nullcontext
from hashlib import sha256
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from candidate import CandidateError
from web_custody_workflow import selected_objects
import web_successor_custody as custody

MAIN = "a" * 40
REPO_ID = 101
WORKFLOW_ID = 202
IDENTITY = (MAIN, 42, 1, 2)
ORIGINAL = {"id": 100, "head_sha": "b" * 40, "run_attempt": 1}


def evidence_zip(mode, replacement=None):
    base = {"schemaVersion": 1, "kind": "warpdrive-web-custody-workflow", "repository": custody.REPOSITORY,
            "revision": ORIGINAL["head_sha"], "runId": ORIGINAL["id"], "runAttempt": ORIGINAL["run_attempt"],
            "mode": mode, "status": "verified", "deploymentAuthorized": False}
    rows = {"result.json": {**base, "verifiedObjects": 3}}
    for name, kind, digest, size, manifest in selected_objects():
        record = {**base, "filename": name, "kind": kind, "digest": digest, "bytes": size,
                  "reference": f"{custody.REPOSITORY}@{manifest}"}
        rows[f"{name}.verified.json"] = record
        rows[f"{name}.started.json"] = {**record, "status": "readback-pending"}
    if replacement is not None:
        name, fields = replacement
        rows[name].update(fields)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, row in rows.items():
            archive.writestr(name, json.dumps(row))
    stream.seek(0)
    return stream


def run(run_id, number, *, revision=MAIN, attempt=1, status="completed"):
    return {"id": run_id, "run_number": number, "run_attempt": attempt,
            "head_sha": revision, "head_branch": "main", "status": status, "event": "workflow_dispatch",
            "path": f".github/workflows/{custody.WORKFLOW}", "workflow_id": WORKFLOW_ID,
            "repository": {"id": REPO_ID}, "head_repository": {"id": REPO_ID}}


def job(parent, *, name=custody.PUBLISH_JOB, conclusion="failure", steps=(), attempt=None):
    return {"id": 17, "name": name, "run_id": parent["id"], "head_sha": parent["head_sha"],
            "run_attempt": parent["run_attempt"] if attempt is None else attempt,
            "status": "completed", "conclusion": conclusion, "steps": list(steps)}


def step(name, conclusion="success"):
    return {"name": name, "status": "completed", "conclusion": conclusion}


class API:
    def __init__(self):
        self.current = run(42, 2, status="in_progress")
        self.old = run(41, 1, revision="d" * 40)
        self.rows = [self.current, self.old]
        self.jobs = {(41, 1): [job(self.old, steps=[step(custody.WRITE_STEP, "skipped")])]}

    def request(self, path):
        base = f"repos/{custody.REPO}/actions"
        if path == f"{base}/workflows/{custody.WORKFLOW}":
            return {"path": self.current["path"], "id": WORKFLOW_ID}
        if path == f"{base}/runs/42":
            return self.current
        if path == f"{base}/workflows/{WORKFLOW_ID}/runs?per_page=100":
            return {"total_count": len(self.rows), "workflow_runs": self.rows}
        for (identifier, attempt), jobs in self.jobs.items():
            if path == f"{base}/runs/{identifier}/attempts/{attempt}/jobs?per_page=20":
                return {"total_count": len(jobs), "jobs": jobs}
        raise AssertionError(path)


class SuccessorCustodyTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.evidence = self.root / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.source = self.root / "web-successor-custody-source"
        self.source.mkdir(mode=0o700)
        self.oras = self.root / "oras"

    def test_exact_original_bootstrap_and_read_only_evidence_required(self):
        for mode in ("bootstrap", "observe"):
            custody.original_evidence(evidence_zip(mode), mode, ORIGINAL)
        for replacement in (
            ("core.zip.verified.json", {"reference": "foreign"}),
            ("web-bundle.zip.started.json", {"status": "verified"}),
            ("result.json", {"deploymentAuthorized": 0}),
        ):
            with self.subTest(replacement=replacement), self.assertRaisesRegex(CandidateError, "immutable object"):
                custody.original_evidence(evidence_zip("observe", replacement), "observe", ORIGINAL)

    def test_original_run_requires_completed_observe_or_bootstrap_and_uploaded_evidence(self):
        for name, operation, mode in (
            (custody.BOOTSTRAP_JOB, custody.ORIGINAL_WRITE_STEP, "bootstrap"),
            (custody.ORIGINAL_OBSERVE_JOB, custody.ORIGINAL_OBSERVE_STEP, "observe"),
        ):
            parent = {**run(100, 1, revision=ORIGINAL["head_sha"]), **ORIGINAL}
            api = unittest.mock.Mock()
            api.request.return_value = parent
            completed = job(parent, name=name, conclusion="success",
                            steps=[step(operation), step(custody.RETAIN_STEP)])
            with (
                patch.object(custody, "successful_main_run", return_value=parent),
                patch.object(custody, "run_jobs", return_value=[completed]),
                patch.object(custody, "git") as git,
                patch.object(custody, "artifact_for_run", return_value={"id": 55}) as artifact,
            ):
                self.assertEqual(custody.original_run(api, REPO_ID, 100, self.root, MAIN),
                                 (mode, parent, {"id": 55}))
                git.assert_called_once_with(self.root, "merge-base", "--is-ancestor",
                                            parent["head_sha"], MAIN, allow_empty=True)
                artifact.assert_called_once_with(api, parent, REPO_ID, "web-release-custody-100-1",
                                                maximum=custody.MAX_EVIDENCE_ZIP)
                completed["steps"][1]["conclusion"] = "skipped"
                with self.assertRaisesRegex(CandidateError, "retain evidence"):
                    custody.original_run(api, REPO_ID, 100, self.root, MAIN)

    def test_prior_cross_revision_write_and_missing_history_hold(self):
        api = API()
        custody.no_prior_write(api, REPO_ID, IDENTITY)
        for outcome in ("success", "failure", "cancelled", None):
            api.jobs[(41, 1)][0]["steps"][0]["conclusion"] = outcome
            with self.subTest(outcome=outcome), self.assertRaisesRegex(CandidateError, "write boundary"):
                custody.no_prior_write(api, REPO_ID, IDENTITY)
        api.rows.pop()
        with self.assertRaisesRegex(CandidateError, "Complete successor custody history"):
            custody.no_prior_write(api, REPO_ID, IDENTITY)

    def test_older_attempt_of_current_run_can_block_fresh_write(self):
        api = API()
        api.current["run_attempt"] = 2
        api.jobs[(42, 1)] = [job(api.current, attempt=1, steps=[step(custody.WRITE_STEP, "failure")])]
        with self.assertRaisesRegex(CandidateError, "write boundary"):
            custody.no_prior_write(api, REPO_ID, (MAIN, 42, 2, 2))

    def test_c_producer_readback_holds_skipped_step_or_artifact_substitution(self):
        parent = run(custody.RUN_ID, 1, revision=custody.SOURCE)
        api = API()
        successful = job(parent, name=custody.JOB, conclusion="success",
                         steps=[step(name) for name in custody.STEPS])
        successful["id"] = custody.JOB_ID
        with (
            patch.object(custody, "successful_main_run", return_value=parent) as admission,
            patch.object(custody, "run_jobs", return_value=[successful]),
            patch.object(custody, "artifact_for_run", return_value=custody.ARTIFACT) as artifact,
        ):
            self.assertEqual(custody.authenticate_c(api, REPO_ID), custody.ARTIFACT)
            admission.assert_called_once_with(api, custody.REPEAT_WORKFLOW, custody.RUN_ID, custody.SOURCE,
                                              REPO_ID, events={"workflow_dispatch"})
            artifact.return_value = {**custody.ARTIFACT, "id": 999}
            with self.assertRaisesRegex(CandidateError, "artifact differs"):
                custody.authenticate_c(api, REPO_ID)
            successful["steps"][-1]["conclusion"] = "skipped"
            with self.assertRaisesRegex(CandidateError, "producer job"):
                custody.authenticate_c(api, REPO_ID)

    def test_tracked_receipt_pins_and_c_ancestry_checked_before_admission(self):
        leaf = self.root / custody.RECEIPT
        leaf.parent.mkdir(parents=True)
        raw = b'{"already":"admitted"}'
        leaf.write_bytes(raw)
        document = {"origin": custody.ORIGIN, "jobId": custody.JOB_ID, "artifact": custody.ARTIFACT,
                    "baseline": {"installedLineageSha256": custody.LINEAGE_SHA},
                    "ci": [{"workflow": name, "jobs": jobs}
                           for name, jobs in custody.repeat_policy()["required_workflows"].items()]}
        with (
            patch.object(custody, "RECEIPT_BYTES", len(raw)),
            patch.object(custody, "RECEIPT_SHA", sha256(raw).hexdigest()),
            patch.object(custody, "git", side_effect=[b"", raw, b"", b"changed"]) as git,
            patch.object(custody, "_publication", return_value=document),
        ):
            self.assertEqual(custody.admission_bytes(self.root, MAIN, custody.SOURCE, leaf), raw)
            self.assertEqual(git.call_args_list[0].args, (self.root, "merge-base", "--is-ancestor", custody.SOURCE, MAIN))
            with self.assertRaisesRegex(CandidateError, "tracked receipt"):
                custody.admission_bytes(self.root, MAIN, custody.SOURCE, leaf)
            with self.assertRaisesRegex(CandidateError, "exact reviewed C"):
                custody.admission_bytes(self.root, MAIN, MAIN, leaf)

    def test_observe_reads_both_even_after_partial_failure_without_actions(self):
        statuses = [CandidateError("unknown"), custody.manifest_digest(custody.custody_manifest(*custody.OBJECTS[1][1:]))]
        with (
            patch.object(custody, "registry_auth", return_value=nullcontext()),
            patch.object(custody, "publish", side_effect=statuses) as transport,
            patch.object(custody, "authenticate_c") as actions,
        ):
            with self.assertRaisesRegex(CandidateError, "both verified"):
                custody.execute(API(), IDENTITY, "observe", self.oras, self.root, self.evidence)
        actions.assert_not_called()
        self.assertTrue(all(call.kwargs["observe_only"] for call in transport.call_args_list))
        self.assertEqual(transport.call_count, 2)
        self.assertTrue((self.evidence / "web-repeat-bundle.zip.held.json").is_file())
        self.assertTrue((self.evidence / "receipt.json.verified.json").is_file())
        self.assertFalse((self.evidence / "result.json").exists())

    def test_publish_admits_both_bytes_before_any_write_and_stops_after_unknown(self):
        custody.write_metadata(self.source / "prepared.json", custody.prepared_record(IDENTITY, ORIGINAL["id"]))
        with (
            patch.object(custody, "repository_id", return_value=REPO_ID),
            patch.object(custody, "no_prior_write"),
            patch.object(custody, "registry_auth", return_value=nullcontext()),
            patch.object(custody, "require_selected_main"),
            patch.object(custody, "verified_bytes", side_effect=[nullcontext(), CandidateError("bad receipt")]) as verified,
            patch.object(custody, "publish") as transport,
        ):
            with self.assertRaisesRegex(CandidateError, "bad receipt"):
                custody.execute(API(), IDENTITY, "publish", self.oras, self.root, self.evidence, original_run_id=ORIGINAL["id"])
            transport.assert_not_called()
            verified.side_effect = [nullcontext(), nullcontext()]
            transport.side_effect = CandidateError("lost acknowledgement")
            with self.assertRaisesRegex(CandidateError, "lost acknowledgement"):
                custody.execute(API(), IDENTITY, "publish", self.oras, self.root, self.evidence, original_run_id=ORIGINAL["id"])
            transport.assert_called_once()
            self.assertFalse(transport.call_args.kwargs["observe_only"])
        self.assertFalse((self.evidence / "receipt.json.started.json").exists())
        self.assertFalse((self.evidence / "result.json").exists())


if __name__ == "__main__":
    unittest.main()
