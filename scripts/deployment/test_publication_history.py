import copy
import unittest

from candidate import CandidateError
from publication_history import JOB, STEP, ReconcileOnly, prior_write_opportunities
from registry_candidate import RegistryError

SHA = "a" * 40


class FakeAPI:
    def __init__(self, attempt=1):
        self.current = {"id": 42, "workflow_id": 15, "path": ".github/workflows/image-candidates.yml",
                        "head_sha": SHA, "head_branch": "main", "event": "workflow_dispatch", "run_attempt": attempt,
                        "run_number": 42}
        self.runs = [self.current]
        self.jobs = [{"id": 55, "name": JOB, "status": "completed", "conclusion": "failure",
                      "steps": [{"name": STEP, "status": "completed", "conclusion": "failure"}]}]
        self.attempt_jobs = {}
        self.queried_attempts = []

    def request(self, path):
        if path.endswith("/runs/42"):
            return self.current
        if path.endswith("/workflows/image-candidates.yml"):
            return {"id": 15}
        return {"total_count": len(self.runs), "workflow_runs": self.runs}

    def pages(self, path, key):
        parts = path.split("/")
        identity = (int(parts[parts.index("runs") + 1]), int(parts[parts.index("attempts") + 1]))
        self.queried_attempts.append(identity)
        return self.attempt_jobs.get(identity, self.jobs)


class HistoryTests(unittest.TestCase):
    def test_first_known_attempt_has_no_earlier_write_opportunity(self):
        self.assertEqual(prior_write_opportunities(FakeAPI(), SHA, 42, 1), [])

    def test_rerun_after_failed_or_successful_push_step_is_reconcile_only(self):
        for conclusion in ("failure", "success", "cancelled", "timed_out"):
            api = FakeAPI(attempt=2)
            api.jobs[0]["steps"][0]["conclusion"] = conclusion
            with self.subTest(conclusion=conclusion):
                self.assertEqual(len(prior_write_opportunities(api, SHA, 42, 2)), 1)

    def test_new_workflow_run_cannot_erase_an_earlier_failed_attempt(self):
        api = FakeAPI()
        old = {**api.current, "id": 41, "run_number": 41}
        api.runs.append(old)
        self.assertEqual(prior_write_opportunities(api, SHA, 42, 1)[0]["runId"], 41)

    def test_total_historical_attempt_budget_is_bounded_across_runs(self):
        api = FakeAPI()
        api.runs.extend({**api.current, "id": value, "run_number": value, "run_attempt": 60}
                        for value in (40, 41))
        with self.assertRaisesRegex(CandidateError, "bounded attempt budget"):
            prior_write_opportunities(api, SHA, 42, 1)

    def test_later_queued_run_is_not_mistaken_for_a_previous_write(self):
        api = FakeAPI()
        api.runs.append({**api.current, "id": 43, "run_number": 43, "status": "queued"})
        api.jobs = []
        self.assertEqual(prior_write_opportunities(api, SHA, 42, 1), [])
        self.assertEqual(api.queried_attempts, [(43, 1)])

    def test_older_run_rerun_cannot_erase_a_newer_runs_failed_push(self):
        api = FakeAPI(attempt=2)
        api.runs.append({**api.current, "id": 43, "run_number": 43, "run_attempt": 1,
                         "status": "completed"})
        skipped = copy.deepcopy(api.jobs)
        skipped[0]["steps"][0]["conclusion"] = "skipped"
        api.attempt_jobs[(42, 1)] = skipped
        witnesses = prior_write_opportunities(api, SHA, 42, 2)
        self.assertEqual([(row["runId"], row["runAttempt"]) for row in witnesses], [(43, 1)])
        self.assertEqual(api.queried_attempts, [(42, 1), (43, 1)])

    def test_queued_rerun_still_inspects_its_completed_earlier_attempt(self):
        api = FakeAPI()
        api.runs.append({**api.current, "id": 43, "run_number": 43, "run_attempt": 2,
                         "status": "queued"})
        api.attempt_jobs[(43, 2)] = []
        witnesses = prior_write_opportunities(api, SHA, 42, 1)
        self.assertEqual([(row["runId"], row["runAttempt"]) for row in witnesses], [(43, 1)])
        self.assertEqual(api.queried_attempts, [(43, 1), (43, 2)])

    def test_not_started_latest_publication_job_is_skipped_without_ignoring_earlier_attempts(self):
        api = FakeAPI()
        api.runs.append({**api.current, "id": 43, "run_number": 43, "run_attempt": 2,
                         "status": "in_progress"})
        api.attempt_jobs[(43, 2)] = [{"name": JOB, "status": "queued", "conclusion": None, "steps": []}]
        self.assertEqual(len(prior_write_opportunities(api, SHA, 42, 1)), 1)

    def test_queued_status_does_not_hide_started_or_unknown_publication(self):
        for jobs in ([{"name": JOB, "status": "in_progress"}],
                     [{"name": JOB, "status": "queued", "conclusion": None,
                       "steps": [{"name": STEP, "status": "in_progress"}]}],
                     [{"name": "Admission", "status": "completed", "conclusion": "success", "steps": []}]):
            api = FakeAPI()
            api.runs.append({**api.current, "id": 43, "run_number": 43, "status": "queued"})
            api.jobs = jobs
            with self.subTest(jobs=jobs), self.assertRaises(CandidateError):
                prior_write_opportunities(api, SHA, 42, 1)

    def test_queued_rerun_cannot_hide_missing_previous_attempt_jobs(self):
        api = FakeAPI()
        api.runs.append({**api.current, "id": 43, "run_number": 43, "run_attempt": 2,
                         "status": "queued"})
        api.jobs = []
        with self.assertRaises(CandidateError):
            prior_write_opportunities(api, SHA, 42, 1)

    def test_newer_run_attempts_count_toward_the_total_budget(self):
        api = FakeAPI()
        api.runs.append({**api.current, "id": 43, "run_number": 43, "run_attempt": 100})
        api.current["run_attempt"] = 2
        with self.assertRaisesRegex(CandidateError, "bounded attempt budget"):
            prior_write_opportunities(api, SHA, 42, 2)

    def test_skipped_publication_never_claims_a_write_opportunity(self):
        api = FakeAPI(attempt=2)
        api.jobs[0]["steps"][0]["conclusion"] = "skipped"
        self.assertEqual(prior_write_opportunities(api, SHA, 42, 2), [])
        api.jobs[0]["conclusion"] = "skipped"
        api.jobs[0]["steps"] = []
        self.assertEqual(prior_write_opportunities(api, SHA, 42, 2), [])

    def test_missing_active_or_ambiguous_history_blocks_instead_of_starting_fresh(self):
        for value in ([], [{"name": JOB, "status": "in_progress"}],
                      [{"name": JOB, "status": "completed", "conclusion": "failure", "steps": []}]):
            api = FakeAPI(attempt=2)
            api.jobs = value
            with self.subTest(jobs=value), self.assertRaises(CandidateError):
                prior_write_opportunities(api, SHA, 42, 2)

    def test_reconciliation_wrapper_never_forwards_a_push(self):
        class Adapter:
            def push(self, *args):
                raise AssertionError("must not be called")

            def resolve_tag(self, tag):
                return None
        wrapper = ReconcileOnly(Adapter())
        self.assertIsNone(wrapper.resolve_tag("some-reference"))
        with self.assertRaises(RegistryError):
            wrapper.push("sha256:abc", "some-reference")


if __name__ == "__main__":
    unittest.main()
