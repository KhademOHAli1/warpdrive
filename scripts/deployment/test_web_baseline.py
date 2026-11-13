"""Test admission of an already qualified baseline after main advances."""
import copy
import json
import unittest

import web_baseline as baseline
from candidate import CandidateError
from publication_gate import REPO, WORKFLOW, publication_policy


class API:
    def __init__(self):
        self.revision = "a" * 40
        self.admission_id = 701
        self.image_id = 602
        self.repository_id = 113
        self.workflows = {baseline.ADMISSION_WORKFLOW: 10, WORKFLOW: 12}
        self.artifact_sha = "sha256:" + "b" * 64
        self.job = {"name": baseline.ADMISSION_JOB, "conclusion": "success",
                    "steps": [{"name": baseline.INSPECT_STEP, "conclusion": "success"}]}
        self.image_artifact = self.artifact(self.image_id, f"image-bundle-{self.revision}-{self.image_id}-1", 56)
        self.admission_artifact = self.artifact(self.admission_id, f"candidate-admission-{self.admission_id}-1", 57)
        self.doc = {
            "schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission",
            "repository": REPO, "revision": self.revision, "deploymentAuthorized": False,
            "producer": {"runId": self.image_id, "runAttempt": 1, "event": "push", "ref": "refs/heads/main"},
            "artifact": {"id": 56, "name": self.image_artifact["name"], "digest": self.artifact_sha, "sizeBytes": 100},
            "ci": [{"workflow": workflow, "jobs": jobs} for workflow, jobs in
                   publication_policy()["required_workflows"].items()],
            "security": {},
        }

    def artifact(self, run_id, name, artifact_id):
        return {"id": artifact_id, "name": name, "digest": self.artifact_sha, "size_in_bytes": 100, "expired": False,
                "workflow_run": {"id": run_id, "head_sha": self.revision, "head_branch": "main",
                                 "repository_id": self.repository_id, "head_repository_id": self.repository_id}}

    def request(self, path):
        if path == f"repos/{REPO}":
            return {"id": self.repository_id, "full_name": REPO}
        if "/actions/workflows/" in path:
            filename = path.rsplit("/", 1)[1]
            return {"id": self.workflows[filename], "path": ".github/workflows/" + filename}
        if "/actions/runs/" in path:
            number = int(path.rsplit("/", 1)[1])
            assert number in (self.admission_id, self.image_id)
            is_admission = number == self.admission_id
            workflow = baseline.ADMISSION_WORKFLOW if is_admission else WORKFLOW
            return {"id": number, "workflow_id": self.workflows[workflow], "path": ".github/workflows/" + workflow,
                    "head_sha": self.revision, "head_branch": "main", "event": "workflow_dispatch" if is_admission else "push",
                    "status": "completed", "conclusion": "success", "run_attempt": 1,
                    "repository": {"id": self.repository_id}, "head_repository": {"id": self.repository_id}}
        raise AssertionError(f"Unexpected API request {path}")

    def pages(self, path, key):
        if key == "jobs":
            assert path.endswith(f"/runs/{self.admission_id}/attempts/1/jobs")
            return [self.job]
        if path.endswith(f"/runs/{self.admission_id}/artifacts"):
            return [self.admission_artifact]
        if path.endswith(f"/runs/{self.image_id}/artifacts"):
            return [self.image_artifact]
        raise AssertionError(f"Unexpected API request {path}")

    def fetch(self, artifact):
        assert artifact["id"] == self.admission_artifact["id"]
        return json.dumps(self.doc).encode()


class WebBaselineTests(unittest.TestCase):
    def test_historical_inspection_does_not_require_historical_sha_as_current_main(self):
        api = API()
        raw, result = baseline.load_historical_admission(api, api.admission_id, api.revision, fetch=api.fetch)
        self.assertEqual(json.loads(raw), api.doc)
        self.assertEqual(result, api.doc)

    def test_rejects_failed_or_skipped_inspection(self):
        api = API()
        api.job["steps"][0]["conclusion"] = "skipped"
        with self.assertRaisesRegex(CandidateError, "downloaded and verified"):
            baseline.load_historical_admission(api, api.admission_id, api.revision, fetch=api.fetch)

    def test_rejects_mismatched_artifacts(self):
        api = API()
        for change in ({"digest": "sha256:" + "f" * 64}, {"expired": True},
                       {"workflow_run": {"id": api.image_id, "head_sha": "f" * 40}}):
            with self.subTest(change=change):
                original = copy.deepcopy(api.image_artifact)
                api.image_artifact.update(change)
                with self.assertRaises(CandidateError):
                    baseline.load_historical_admission(api, api.admission_id, api.revision, fetch=api.fetch)
                api.image_artifact = original

    def test_rejects_narrowed_source_policy(self):
        api = API()
        api.doc["ci"].pop()
        with self.assertRaisesRegex(CandidateError, "full source policy"):
            baseline.load_historical_admission(api, api.admission_id, api.revision, fetch=api.fetch)
