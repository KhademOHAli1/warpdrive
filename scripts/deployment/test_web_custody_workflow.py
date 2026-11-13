"""Offline controls for custody write admission, readback and credential scope."""

from contextlib import nullcontext, redirect_stdout
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from candidate import CandidateError
import web_custody_workflow as custody

SHA = "a" * 40
OLD_SHA = "b" * 40
REPOSITORY_ID = 123
WORKFLOW_ID = 456
IDENTITY = (SHA, 42, 1, 2)
OBJECTS = tuple(custody.selected_objects())


def run(run_id, number, *, attempt=1, revision=OLD_SHA, status="completed", branch="main"):
    return {"id": run_id, "run_number": number, "run_attempt": attempt, "head_sha": revision,
            "status": status, "head_branch": branch, "event": "workflow_dispatch",
            "path": custody.WORKFLOW_PATH, "workflow_id": WORKFLOW_ID,
            "repository": {"id": REPOSITORY_ID}, "head_repository": {"id": REPOSITORY_ID}}


def job(run_id, attempt, revision, *, conclusion="failure", steps=None):
    return {"name": custody.BOOTSTRAP_JOB, "status": "completed", "conclusion": conclusion,
            "run_id": run_id, "run_attempt": attempt, "head_sha": revision, "steps": steps}


def write_step(conclusion):
    return {"name": custody.WRITE_STEP, "status": "completed", "conclusion": conclusion}


class API:
    def __init__(self):
        self.current = run(42, 2, revision=SHA, status="in_progress")
        self.old = run(41, 1)
        self.rows = [self.current, self.old]
        self.jobs = {(41, 1): [job(41, 1, OLD_SHA, steps=[write_step("skipped")])]}

    def request(self, path):
        base = f"repos/{custody.REPO}"
        if path == base:
            return {"id": REPOSITORY_ID, "full_name": custody.REPO}
        if path == f"{base}/actions/workflows/{custody.WORKFLOW}":
            return {"id": WORKFLOW_ID, "path": custody.WORKFLOW_PATH}
        if path == f"{base}/actions/runs/{self.current['id']}":
            return self.current
        if path == f"{base}/actions/workflows/{WORKFLOW_ID}/runs?per_page=100":
            return {"total_count": len(self.rows), "workflow_runs": self.rows}
        for (run_id, attempt), jobs in self.jobs.items():
            if path == f"{base}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=20":
                return {"jobs": jobs, "total_count": len(jobs)}
        raise AssertionError(path)


class HistoryTests(unittest.TestCase):
    def check(self, api):
        custody.require_no_prior_write(api, revision=SHA, run_id=42,
                                       attempt=api.current["run_attempt"], run_number=2)

    def test_failed_before_write_and_prior_read_only_runs_permit_bootstrap(self):
        api = API()
        self.check(api)
        api.jobs[(41, 1)] = [job(41, 1, OLD_SHA, conclusion="skipped", steps=[])]
        self.check(api)

    def test_any_prior_write_opportunity_on_different_source_holds(self):
        for conclusion in ("success", "failure", "cancelled", "timed_out", None):
            with self.subTest(conclusion=conclusion):
                api = API()
                api.jobs[(41, 1)] = [job(41, 1, OLD_SHA, steps=[write_step(conclusion)])]
                with self.assertRaisesRegex(CandidateError, "write boundary"):
                    self.check(api)

    def test_previous_attempt_of_same_run_holds_after_write(self):
        api = API()
        api.current["run_attempt"] = 2
        api.jobs[(42, 1)] = [job(42, 1, SHA, steps=[write_step("failure")])]
        with self.assertRaisesRegex(CandidateError, "write boundary"):
            self.check(api)

    def test_resume_write_opportunity_cannot_be_mistaken_for_skipped_bootstrap(self):
        api = API()
        resume = {"name": custody.RESUME_STEP, "status": "completed", "conclusion": "failure"}
        api.jobs[(41, 1)] = [job(41, 1, OLD_SHA, steps=[write_step("skipped"), resume])]
        with self.assertRaisesRegex(CandidateError, "write boundary"):
            self.check(api)
        resume["conclusion"] = "skipped"
        self.check(api)

    def test_queued_other_run_is_read_only_witness_only_if_never_started(self):
        api = API()
        api.rows.insert(0, run(43, 3, status="pending"))
        api.jobs[(43, 1)] = []
        self.check(api)
        api.jobs[(43, 1)] = [job(43, 1, OLD_SHA, steps=[write_step("failure")])]
        with self.assertRaisesRegex(CandidateError, "write boundary"):
            self.check(api)

    def test_missing_run_or_write_step_and_wrong_repository_fail_closed(self):
        api = API()
        api.rows = [api.current]
        with self.assertRaisesRegex(CandidateError, "missing or ambiguous run identities"):
            self.check(api)
        api = API()
        api.jobs[(41, 1)] = [job(41, 1, OLD_SHA, steps=[{"name": "An unrelated step"}])]
        with self.assertRaisesRegex(CandidateError, "write boundary"):
            self.check(api)
        api = API()
        api.old["head_repository"] = {"id": 999}
        with self.assertRaisesRegex(CandidateError, "Complete bounded"):
            self.check(api)

    def test_current_identity_and_runner_are_exact(self):
        api = API()
        api.current["head_sha"] = OLD_SHA
        with self.assertRaisesRegex(CandidateError, "identity differs"):
            self.check(api)
        environment = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
                       "GITHUB_REPOSITORY": custody.REPO, "GITHUB_REF": "refs/heads/main",
                       "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_SHA": SHA,
                       "GITHUB_WORKFLOW_REF": f"{custody.REPO}/{custody.WORKFLOW_PATH}@refs/heads/main",
                       "GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_RUN_NUMBER": "2"}
        self.assertEqual(custody.require_hosted(environment), IDENTITY)
        for key in ("RUNNER_ENVIRONMENT", "GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_WORKFLOW_REF"):
            with self.subTest(key=key), self.assertRaises(CandidateError):
                custody.require_hosted({**environment, key: "other"})


class CustodyTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.environment = patch.dict(os.environ, {"GITHUB_ACTOR": "runner[bot]", "GH_TOKEN": "synthetic",
                                                   "DOCKER_CONFIG": "/existing-authority"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.pins = {digest: manifest for _, _, digest, _, manifest in OBJECTS}

    def execute(self, mode):
        with redirect_stdout(io.StringIO()):
            custody.execute(API(), IDENTITY, mode, self.root / "oras", self.root, self.evidence)

    def publish(self, _oras, _layout, _source, *, kind, digest, size, observe_only):
        config = Path(os.environ["DOCKER_CONFIG"])
        self.assertEqual(config.parent, self.root)
        self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((config / "config.json").stat().st_mode), 0o600)
        self.assertEqual(set(json.loads((config / "config.json").read_bytes())["auths"]), {"ghcr.io"})
        self.assertTrue(kind in ("archive", "receipt"))
        self.assertGreater(size, 0)
        self.assertIsInstance(observe_only, bool)
        return self.pins[digest]

    def test_observe_has_read_only_calls_no_local_archive_and_no_credentials_left(self):
        with patch.object(custody, "require_selected_main") as main_check,                 patch.object(custody, "verified_bytes") as verified,                 patch.object(custody, "publish", side_effect=self.publish) as publish:
            self.execute("observe")
        main_check.assert_called_once()
        verified.assert_not_called()
        self.assertTrue(all(call.kwargs["observe_only"] for call in publish.call_args_list))
        self.assertEqual(publish.call_count, 3)
        result = json.loads((self.evidence / "result.json").read_bytes())
        self.assertEqual(result["verifiedObjects"], 3)
        self.assertIs(result["deploymentAuthorized"], False)
        self.assertEqual(os.environ["DOCKER_CONFIG"], "/existing-authority")
        self.assertFalse(list(self.root.glob("web-custody-registry.*")))
        self.assertNotIn(b"synthetic", b"".join(path.read_bytes() for path in self.evidence.iterdir()))

    def test_observe_checks_remaining_members_after_an_absent_object(self):
        results = [CandidateError("absent"), self.pins[OBJECTS[1][2]], self.pins[OBJECTS[2][2]]]
        with patch.object(custody, "require_selected_main"), \
                patch.object(custody, "publish", side_effect=results) as publish:
            with self.assertRaisesRegex(CandidateError, "could not be independently verified"):
                self.execute("observe")
        self.assertEqual(publish.call_count, 3)
        self.assertTrue(all(call.kwargs["observe_only"] for call in publish.call_args_list))
        self.assertTrue((self.evidence / "core.zip.held.json").exists())
        self.assertTrue((self.evidence / "web-bundle.zip.verified.json").exists())
        self.assertTrue((self.evidence / "core-admission.json.verified.json").exists())
        self.assertFalse((self.evidence / "result.json").exists())

    def test_all_source_objects_preverified_before_any_publication(self):
        with patch.object(custody, "preflight"),                 patch.object(custody, "require_selected_main"),                 patch.object(custody, "verified_bytes", side_effect=[nullcontext(), nullcontext(), CandidateError("bad")]),                 patch.object(custody, "publish") as publish:
            with self.assertRaisesRegex(CandidateError, "bad"):
                self.execute("bootstrap")
        publish.assert_not_called()
        self.assertFalse(list(self.evidence.iterdir()))

    def test_uncertain_write_stops_remaining_objects_and_keeps_readback_boundary(self):
        result = self.pins[OBJECTS[0][2]]
        with patch.object(custody, "preflight"),                 patch.object(custody, "require_selected_main"),                 patch.object(custody, "verified_bytes", side_effect=lambda *_: nullcontext()),                 patch.object(custody, "publish", side_effect=[result, CandidateError("lost ack")]) as publish:
            with self.assertRaisesRegex(CandidateError, "lost ack"):
                self.execute("bootstrap")
        self.assertEqual(publish.call_count, 2)
        self.assertTrue(all(not call.kwargs["observe_only"] for call in publish.call_args_list))
        self.assertTrue((self.evidence / "core.zip.verified.json").exists())
        self.assertTrue((self.evidence / "web-bundle.zip.started.json").exists())
        self.assertFalse((self.evidence / "core-admission.json.started.json").exists())
        self.assertFalse((self.evidence / "result.json").exists())
        self.assertFalse(list(self.root.glob("web-custody-registry.*")))


if __name__ == "__main__":
    unittest.main()
