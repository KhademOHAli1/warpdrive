"""Offline authority and exact write-boundary controls for the first custody recovery."""

from contextlib import nullcontext
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

from candidate import CandidateError
import web_custody_resume as recovery


IDENTITY = ("a" * 40, 700, 1, 4)


def run(run_id, number, revision, *, status="completed", attempt=1):
    return {"id": run_id, "run_number": number, "run_attempt": attempt, "head_sha": revision,
            "status": status, "conclusion": "failure" if status == "completed" else None, "head_branch": "main",
            "event": "workflow_dispatch", "path": recovery.WORKFLOW_PATH, "workflow_id": recovery.WORKFLOW_ID,
            "repository": {"id": recovery.REPOSITORY_ID}, "head_repository": {"id": recovery.REPOSITORY_ID}}


def job(run_row, name, job_id, steps, *, conclusion="failure"):
    return {"id": job_id, "name": name, "status": "completed", "conclusion": conclusion,
            "run_id": run_row["id"], "run_attempt": run_row["run_attempt"], "head_sha": run_row["head_sha"],
            "steps": [{"name": name, "status": "completed", "conclusion": status} for name, status in steps]}


class HistoryFixture:
    def __init__(self):
        self.current = run(IDENTITY[1], IDENTITY[3], IDENTITY[0], status="in_progress")
        self.first = run(recovery.FIRST_RUN, 1, recovery.FIRST_REVISION)
        self.observe = run(600, 2, recovery.FIRST_REVISION)
        self.diagnostic = run(recovery.DIAGNOSTIC_RUN, 3, recovery.DIAGNOSTIC_REVISION)
        self.rows = [self.current, self.diagnostic, self.observe, self.first]
        self.jobs = {
            (self.first["id"], 1): [job(self.first, recovery.BOOTSTRAP_JOB, recovery.FIRST_JOB, (
                ("Verify authenticated provider state without writing", "success"),
                (recovery.WRITE_STEP, "failure"), ("Retain sanitized custody outcome", "success")))],
            (self.observe["id"], 1): [job(self.observe, recovery.BOOTSTRAP_JOB, 1, (), conclusion="skipped")],
            (self.diagnostic["id"], 1): [job(self.diagnostic, recovery.BOOTSTRAP_JOB, 2, (), conclusion="skipped"),
                                       job(self.diagnostic, recovery.OBSERVE_JOB, recovery.DIAGNOSTIC_JOB, (
                                           ("Diagnose the exact registry references without writing", "success"),
                                           ("Retain sanitized registry diagnostics", "success")))],
        }

    def request(self, path):
        base = f"repos/{recovery.REPO}"
        if path == base:
            return {"id": recovery.REPOSITORY_ID, "full_name": recovery.REPO}
        if path == f"{base}/actions/workflows/{recovery.WORKFLOW}":
            return {"id": recovery.WORKFLOW_ID, "path": recovery.WORKFLOW_PATH}
        if path == f"{base}/actions/runs/{self.current['id']}":
            return self.current
        if path == f"{base}/actions/workflows/{recovery.WORKFLOW_ID}/runs?per_page={recovery.MAX_HISTORY}":
            return {"total_count": len(self.rows), "workflow_runs": self.rows}
        for (run_id, attempt), jobs in self.jobs.items():
            if path == f"{base}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=20":
                return {"total_count": len(jobs), "jobs": jobs}
        raise AssertionError(path)


class HistoryTests(unittest.TestCase):
    def test_exact_first_and_independent_diagnostic_are_the_only_exception(self):
        api = HistoryFixture()
        self.assertEqual(recovery._history(api, IDENTITY), (api.first, api.diagnostic))
        api.first["run_attempt"] = 2
        with self.assertRaisesRegex(CandidateError, "partial bootstrap"):
            recovery._history(api, IDENTITY)

    def test_another_attempt_can_only_follow_an_explicitly_skipped_resume_step(self):
        api = HistoryFixture()
        api.current["run_attempt"] = 2
        selected = (IDENTITY[0], IDENTITY[1], 2, IDENTITY[3])
        previous = {**api.current, "run_attempt": 1}
        api.jobs[(previous["id"], 1)] = [job(previous, recovery.BOOTSTRAP_JOB, 77,
                                            ((recovery.WRITE_STEP, "skipped"), (recovery.RESUME_STEP, "failure")))]
        with self.assertRaisesRegex(CandidateError, "write or evidence step"):
            recovery._history(api, selected)
        api.jobs[(previous["id"], 1)][0]["steps"].pop()
        with self.assertRaisesRegex(CandidateError, "write or evidence step"):
            recovery._history(api, selected)
        api.jobs[(previous["id"], 1)] = [job(previous, recovery.BOOTSTRAP_JOB, 77,
                                            ((recovery.WRITE_STEP, "skipped"), (recovery.RESUME_STEP, "skipped")))]
        recovery._history(api, selected)

    def test_mismatched_evidence_job_or_missing_run_holds(self):
        api = HistoryFixture()
        api.jobs[(api.diagnostic["id"], 1)][1]["id"] = 41
        with self.assertRaisesRegex(CandidateError, "diagnostic job differs"):
            recovery._history(api, IDENTITY)
        api.rows.remove(api.observe)
        with self.assertRaisesRegex(CandidateError, "bounded custody workflow history"):
            recovery._history(api, IDENTITY)


class EvidenceTests(unittest.TestCase):
    def test_archives_require_exact_inventory_and_partial_status(self):
        for expected in (recovery._first_records(), recovery._diagnostic_records()):
            for modification in ("valid", "changed", "duplicate", "oversized"):
                data = io.BytesIO()
                with zipfile.ZipFile(data, "w") as target, warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    for name, value in expected.items():
                        raw = json.dumps({**value, "deploymentAuthorized": True} if modification == "changed" else value)
                        target.writestr(name, raw if modification != "oversized" else "x" * 4097)
                        if modification == "duplicate":
                            target.writestr(name, raw)
                with self.subTest(modification=modification):
                    if modification == "valid":
                        recovery._check_records(data, expected)
                    else:
                        with self.assertRaises(CandidateError):
                            recovery._check_records(data, expected)

    def test_artifact_api_identity_is_checked_before_any_download(self):
        wrong = {"id": recovery.FIRST_ZIP[0], "sizeBytes": 99, "digest": recovery.FIRST_ZIP[2], "name": "retained"}
        with (patch.object(recovery, "artifact_for_run", return_value=wrong), patch.object(recovery, "download") as download,
              self.assertRaisesRegex(CandidateError, "artifact differs")):
            recovery._verify_artifact(None, None, Path("/fixture"), "retained", recovery.FIRST_ZIP, recovery._first_records())
        download.assert_not_called()


class ResumeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.calls = []
        self.present = {recovery.CORE[0]}
        self.items = (recovery.CORE, *recovery.REMAINING)
        self.failure = None
        self.override = None
        for name, replacement in (
            ("verify_resume_authority", lambda *_: None), ("_history", lambda *_: None),
            ("verified_bytes", lambda *_: nullcontext()), ("require_selected_main", lambda *_: None),
            ("registry_auth", lambda *_: nullcontext()), ("_verify_anonymous_denied", lambda pin: self.calls.append(("private", pin))),
            ("diagnose", self.diagnose), ("publish", self.publish),
        ):
            mock = patch.object(recovery, name, side_effect=replacement)
            mock.start()
            self.addCleanup(mock.stop)
        disk = patch.object(recovery.shutil, "disk_usage", return_value=type("Disk", (), {"free": 4 * 1024**3})())
        disk.start()
        self.addCleanup(disk.stop)

    def diagnose(self, *, environment):
        values = [recovery._diagnostic_record(item, present=item[0] in self.present) for item in self.items]
        if self.override:
            values[1].update(self.override)
        return {"authorization": "token-obtained", "emptyConfig": "exact-blob-headers", "objects": values}

    def publish(self, oras, layout, path, *, kind, digest, size, observe_only):
        item = next(item for item in self.items if item[0] == path.name)
        self.calls.append((path.name, observe_only))
        self.assertEqual((kind, digest, size), item[1:4])
        if path.name == self.failure:
            raise CandidateError("write outcome unknown")
        self.present.add(path.name)
        return item[4]

    def execute(self):
        recovery.resume(None, IDENTITY, self.root / "oras", self.root, self.evidence)

    def test_core_is_only_read_then_exact_two_writes_and_private_checks(self):
        self.execute()
        self.assertEqual(self.calls, [("core.zip", True), ("private", recovery.WEB[4]), ("web-bundle.zip", False),
                                     ("private", recovery.ADMISSION[4]), ("core-admission.json", False)])
        result = json.loads((self.evidence / "result.json").read_bytes())
        self.assertEqual((result["mode"], result["verifiedObjects"], result["deploymentAuthorized"]), ("resume", 3, False))

    def test_ambiguous_missing_objects_hold_without_any_write(self):
        for ambiguity in ({"digest": "not-found-unclassified"}, {"tag": "exact-manifest"}, {"payload": "exact-blob-headers"}):
            with self.subTest(ambiguity=ambiguity):
                self.override = ambiguity
                with self.assertRaisesRegex(CandidateError, "reviewed partial write"):
                    self.execute()
                self.assertEqual(self.calls, [("core.zip", True)])
                self.calls.clear()
                for path in self.evidence.iterdir():
                    path.unlink()

    def test_failed_core_read_or_uncertain_first_new_write_stops_remaining_work(self):
        for filename in ("core.zip", "web-bundle.zip"):
            with self.subTest(filename=filename):
                self.failure = filename
                with self.assertRaisesRegex(CandidateError, "outcome unknown"):
                    self.execute()
                self.assertNotIn(("core-admission.json", False), self.calls)
                self.assertFalse((self.evidence / "result.json").exists())
                self.assertFalse((self.evidence / f"{filename}.verified.json").exists())
                self.calls.clear()
                for path in self.evidence.iterdir():
                    path.unlink()


if __name__ == "__main__":
    unittest.main()
