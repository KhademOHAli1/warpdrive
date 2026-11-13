"""Offline verification of functional Web custody admission and write ownership."""
from contextlib import nullcontext
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from candidate import CandidateError
from component_inputs import canonical, decode
import test_web_functional_publication as fixture
from test_web_publication_gate import zip_bytes
import web_functional_custody as custody


MAIN = "a" * 40
OTHER = "e" * 40
SOURCE = fixture.CURRENT
IDENTITY = (MAIN, 42, 1, 2)
REPO_ID = 101
WORKFLOW_ID = 202


def custody_run(identifier, sequence, *, status="completed", attempt=1):
    return {"id": identifier, "run_number": sequence, "run_attempt": attempt, "workflow_id": WORKFLOW_ID,
            "head_sha": MAIN, "head_branch": "main", "path": custody.WORKFLOW_PATH, "event": "workflow_dispatch",
            "status": status, "repository": {"id": REPO_ID}, "head_repository": {"id": REPO_ID}}


def custody_job(run, *, source=SOURCE, conclusion="skipped", attempt=1, include_step=True):
    return {"id": 17, "name": custody.PUBLISH_JOB, "run_id": run["id"], "run_attempt": attempt,
            "head_sha": run["head_sha"], "status": "completed", "conclusion": "failure" if include_step else "skipped",
            "steps": ([{"name": custody.WRITE_STEP + source, "status": "completed", "conclusion": conclusion}]
                      if include_step else [])}


class HistoryAPI:
    def __init__(self):
        self.current, self.previous = custody_run(42, 2, status="in_progress"), custody_run(41, 1)
        self.rows = [self.current, self.previous]
        self.jobs = {(41, 1): [custody_job(self.previous)]}

    def request(self, path):
        endpoint = path.removeprefix(f"repos/{custody.REPO}/actions/")
        if endpoint == f"workflows/{custody.WORKFLOW}":
            return {"id": WORKFLOW_ID, "path": custody.WORKFLOW_PATH}
        if endpoint == "runs/42":
            return self.current
        if endpoint == f"workflows/{WORKFLOW_ID}/runs?per_page={custody.MAX_HISTORY}":
            return {"total_count": len(self.rows), "workflow_runs": self.rows}
        for (run, attempt), jobs in self.jobs.items():
            if endpoint == f"runs/{run}/attempts/{attempt}/jobs?per_page=20":
                return {"total_count": len(jobs), "jobs": jobs}
        raise AssertionError(path)


class FunctionalCustodyTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.evidence = self.root / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.fixture = fixture.FunctionalWebPublicationTests()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.receipt = self.fixture.retain()
        self.raw = (self.fixture.output / custody.RECEIPT).read_bytes()
        self.api = self.fixture.api
        self.pin = sha256(self.raw).hexdigest()

    def test_protected_tracked_publication_is_independent_of_installed_generation_receipt(self):
        history = self.root / custody.HISTORY
        history.mkdir(parents=True)
        path = history / (SOURCE + ".receipt")
        path.write_bytes(self.raw)

        def git(root, command, *args, **kwargs):
            self.assertEqual(root, self.root)
            if command == "merge-base":
                self.assertEqual(args, ("--is-ancestor", SOURCE, MAIN))
                return b""
            if command == "ls-tree":
                return b"100644 blob fixture"
            self.assertEqual(args, ("blob", f"{MAIN}:{custody.HISTORY}/{SOURCE}.receipt"))
            return self.raw

        with patch.object(custody, "git", side_effect=git):
            self.assertEqual(custody.admitted_receipt(self.root, MAIN, SOURCE, self.pin), (self.raw, self.receipt))
            with self.assertRaisesRegex(CandidateError, "Separately pinned"):
                custody.admitted_receipt(self.root, MAIN, SOURCE, "f" * 64)
            path.write_bytes(canonical({"kind": "warpdrive-installed-web-generation"}))
            with self.assertRaisesRegex(CandidateError, "protected tracked bytes"):
                custody.admitted_receipt(self.root, MAIN, SOURCE, self.pin)

    def test_edited_ci_security_or_lineage_cannot_masquerade_as_an_admitted_release(self):
        for mutate in (lambda row: row["ci"].pop(), lambda row: row["ci"][0].update(url="https://example.invalid"),
                       lambda row: row["ci"][0]["jobs"].pop(),
                       lambda row: row["security"].update(blocking_alerts=1),
                       lambda row: row["security"].update(analysis_ids=[1, 2, 3, 3]),
                       lambda row: row["baseline"].update(activeWebRevision=SOURCE),
                       lambda row: row["image"].update(generation="foreign"),
                       lambda row: row.update(deploymentAuthorized=True)):
            receipt = deepcopy(self.receipt)
            mutate(receipt)
            raw = canonical(receipt)
            with self.assertRaises(CandidateError):
                custody.verify_functional_publication(raw, expected_publication_sha256=sha256(raw).hexdigest(),
                                                      expected_revision=SOURCE)

    def test_original_run_attempt_job_steps_and_artifact_are_reauthenticated(self):
        def authenticate():
            return custody.authenticate_functional_artifact(self.api, self.receipt, repository_id=self.api.repository_id)

        with patch.object(self.api, "request", wraps=self.api.request) as request:
            self.assertEqual(authenticate(), self.receipt["artifact"])
            self.assertNotIn(f"repos/{custody.REPO}", [call.args[0] for call in request.call_args_list])
        self.assertEqual(custody.authenticate_functional_artifact(self.api, self.receipt), self.receipt["artifact"])
        self.api.job["steps"][0]["conclusion"] = "skipped"
        with self.assertRaisesRegex(CandidateError, "retention step differs"):
            authenticate()
        self.api.job["steps"][0]["conclusion"] = "success"
        self.api.artifact_row["expired"] = True
        with self.assertRaisesRegex(CandidateError, "Artifact origin"):
            authenticate()

    def test_full_original_zip_and_archive_are_verified(self):
        archive = self.fixture.output / custody.ZIP
        custody.verify_archive(archive, self.root / "good", self.receipt)
        for filename in (custody.ARCHIVE, custody.INPUTS):
            files = {**self.fixture.files, filename: b"wrong bytes"}
            raw = zip_bytes(files)
            path = self.root / (filename + ".zip")
            path.write_bytes(raw)
            receipt = deepcopy(self.receipt)
            receipt["artifact"].update(sizeBytes=len(raw), digest="sha256:" + sha256(raw).hexdigest())
            with self.assertRaises(CandidateError):
                custody.verify_archive(path, self.root / (filename + "-extracted"), receipt)

    def test_history_prevents_second_write_for_same_release_and_allows_a_distinct_release(self):
        api = HistoryAPI()
        custody.no_prior_write(api, REPO_ID, IDENTITY, SOURCE)
        api.jobs[(41, 1)] = [custody_job(api.previous, conclusion="failure")]
        with self.assertRaisesRegex(CandidateError, "earlier run"):
            custody.no_prior_write(api, REPO_ID, IDENTITY, SOURCE)
        custody.no_prior_write(api, REPO_ID, IDENTITY, OTHER)
        api.jobs[(41, 1)] = [custody_job(api.previous, source="invalid", conclusion="success")]
        with self.assertRaisesRegex(CandidateError, "source is unresolved"):
            custody.no_prior_write(api, REPO_ID, IDENTITY, OTHER)
        api.rows = [api.current]
        with self.assertRaisesRegex(CandidateError, "Complete functional custody workflow history"):
            custody.no_prior_write(api, REPO_ID, IDENTITY, OTHER)

    def test_observe_reads_both_even_if_one_object_is_held_and_never_opens_publish(self):
        def readback(_oras, _layout, source, *, kind, digest, size, observe_only):
            self.assertTrue(observe_only)
            if source.name == custody.ZIP:
                raise CandidateError("fixture held")
            return custody.manifest_digest(custody.custody_manifest(kind, digest, size))

        with (patch.object(custody, "registry_auth", return_value=nullcontext()),
              patch.object(custody, "require_selected_main"), patch.object(custody, "provider_check") as precheck,
              patch.object(custody, "publish", side_effect=readback) as transport):
            with self.assertRaisesRegex(CandidateError, "Both immutable"):
                custody.execute(self.api, IDENTITY, "observe", self.root / "oras", self.root, self.evidence,
                                self.raw, self.receipt)
        self.assertEqual(transport.call_count, 2)
        precheck.assert_not_called()
        result = decode((self.evidence / "result.json").read_bytes())
        self.assertEqual((result["state"], result["verifiedObjects"]), ("held", 1))
        self.assertTrue((self.evidence / (custody.ZIP + ".held.json")).is_file())
        self.assertTrue((self.evidence / (custody.RECEIPT + ".verified.json")).is_file())

    def test_provider_evidence_binds_same_attempt_and_both_exact_object_states(self):
        prepared = self.root / custody.SOURCE
        prepared.mkdir(mode=0o700)
        (prepared / "prepared.json").write_bytes(canonical(custody._prepared(IDENTITY, self.raw, self.receipt)) + b"\n")
        states = {custody.ZIP: "present", custody.RECEIPT: "absent"}
        with (patch.object(custody, "registry_auth", return_value=nullcontext()), patch.object(custody, "repository_id"),
              patch.object(custody, "no_prior_write"), patch.object(custody, "require_selected_main"),
              patch.object(custody, "provider_check", return_value=states)):
            custody.check_provider(self.api, IDENTITY, self.root, self.evidence, self.raw, self.receipt)
        custody.require_provider_observation(self.evidence, IDENTITY, self.raw, self.receipt)
        other_attempt = (IDENTITY[0], IDENTITY[1], 2, IDENTITY[3])
        with self.assertRaisesRegex(CandidateError, "Exact authenticated provider observation"):
            custody.require_provider_observation(self.evidence, other_attempt, self.raw, self.receipt)

    def test_publish_verifies_preparation_and_stops_after_first_uncertain_write(self):
        prepared = self.root / custody.SOURCE
        prepared.mkdir(mode=0o700)
        (prepared / custody.ZIP).write_bytes(self.fixture.payload)
        (prepared / custody.RECEIPT).write_bytes(self.raw)
        record = prepared / "prepared.json"
        record.write_bytes(canonical(custody._prepared(IDENTITY, self.raw, self.receipt)) + b"\n")
        with (patch.object(custody, "registry_auth", return_value=nullcontext()), patch.object(custody, "repository_id"),
              patch.object(custody, "no_prior_write"), patch.object(custody, "require_selected_main"),
              patch.object(custody, "authenticate_functional_artifact", return_value=self.receipt["artifact"]),
              patch.object(custody, "provider_check") as precheck,
              patch.object(custody, "publish", side_effect=CandidateError("fixture held")) as transport):
            record.write_bytes(canonical({"runAttempt": 2}))
            with self.assertRaisesRegex(CandidateError, "exact custody attempt"):
                custody.execute(self.api, IDENTITY, "publish", self.root / "oras", self.root, self.evidence,
                                self.raw, self.receipt)
            precheck.assert_not_called()
            transport.assert_not_called()
            record.write_bytes(canonical(custody._prepared(IDENTITY, self.raw, self.receipt)) + b"\n")
            with self.assertRaisesRegex(CandidateError, "Both immutable"):
                custody.execute(self.api, IDENTITY, "publish", self.root / "oras", self.root, self.evidence,
                                self.raw, self.receipt)
            precheck.assert_called_once_with(self.raw, self.receipt)
            self.assertFalse(transport.call_args.kwargs["observe_only"])
            self.assertEqual(transport.call_count, 1)
        self.assertFalse((self.evidence / (custody.RECEIPT + ".started.json")).exists())


if __name__ == "__main__":
    unittest.main()
