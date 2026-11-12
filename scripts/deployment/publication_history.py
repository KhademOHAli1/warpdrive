"""Use retained off-host workflow steps as a conservative cross-attempt push-intent witness."""
from __future__ import annotations

from candidate import require
from publication_gate import REPO
from registry_candidate import RegistryError

WORKFLOW = "image-candidates.yml"
JOB = "Publish tested image candidates"
STEP = "Publish exact retained image IDs and verify immutable manifests"
NOT_STARTED = {"queued", "pending", "requested", "waiting"}


def prior_write_opportunities(api, revision: str, run_id: int, attempt: int) -> list[dict]:
    for value in (run_id, attempt):
        require(type(value) is int and 0 < value <= 10 ** 15, "valid publication workflow identity required")
    current = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    workflow = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW}")
    require(isinstance(current, dict) and isinstance(workflow, dict)
            and type(workflow.get("id")) is int and workflow["id"] > 0
            and current.get("id") == run_id and current.get("workflow_id") == workflow["id"]
            and current.get("path") == f".github/workflows/{WORKFLOW}"
            and current.get("head_sha") == revision and current.get("head_branch") == "main"
            and current.get("event") == "workflow_dispatch" and current.get("run_attempt") == attempt,
            "publication workflow identity changed")
    require(type(current.get("run_number")) is int and current["run_number"] > 0,
            "publication run ordering unavailable")
    history = api.request(f"repos/{REPO}/actions/workflows/{WORKFLOW}/runs?head_sha={revision}&per_page=100")
    require(isinstance(history, dict) and type(history.get("total_count")) is int
            and 0 < history["total_count"] <= 100 and isinstance(history.get("workflow_runs"), list)
            and len(history["workflow_runs"]) == history["total_count"],
            "complete bounded publication history required")
    rows = history["workflow_runs"]
    require(all(isinstance(row, dict) and type(row.get("id")) is int for row in rows)
            and len({row["id"] for row in rows}) == len(rows)
            and any(row["id"] == run_id for row in rows), "publication history is incomplete or ambiguous")
    witnesses = []
    total_attempts = 0
    for row in rows:
        require(row.get("head_sha") == revision and row.get("workflow_id") == workflow["id"],
                "publication history source mismatch")
        require(type(row.get("run_number")) is int and row["run_number"] > 0, "publication run ordering unavailable")
        # Dispatch order is not execution order: an older run can be rerun after
        # a newer run reached the push step. Inspect every other run at this SHA.
        if row.get("head_branch") != "main":
            continue
        require(row.get("event") == "workflow_dispatch", "unknown historical publication trigger")
        last = attempt - 1 if row["id"] == run_id else row.get("run_attempt")
        minimum = 0 if row["id"] == run_id else 1
        require(type(last) is int and minimum <= last <= 100, "bounded historical attempts required")
        total_attempts += last
        require(total_attempts <= 100, "publication history exceeds the bounded attempt budget")
        for old_attempt in range(1, last + 1):
            jobs = api.pages(f"repos/{REPO}/actions/runs/{row['id']}/attempts/{old_attempt}/jobs", "jobs")
            require(isinstance(jobs, list) and all(isinstance(job, dict) for job in jobs), "publication jobs unavailable")
            matches = [job for job in jobs if job.get("name") == JOB]
            latest_other = row["id"] != run_id and old_attempt == last
            if not matches and latest_other and row.get("status") in NOT_STARTED:
                # A queued rerun can still have earlier attempts with write
                # opportunities; only its latest, observably unstarted attempt
                # may be skipped. Earlier attempts are inspected above as usual.
                require(all(job.get("status") in NOT_STARTED and job.get("conclusion") is None
                            and job.get("steps") in (None, []) for job in jobs),
                        "queued publication attempt has evidence of started jobs")
                continue
            require(len(matches) == 1, "historical publication job is missing or ambiguous")
            job = matches[0]
            if latest_other and job.get("status") in NOT_STARTED:
                require(job.get("conclusion") is None and job.get("steps") in (None, []),
                        "queued publication job has evidence of started steps")
                continue
            require(job.get("status") == "completed", "previous publication job remains active or unknown")
            if job.get("conclusion") == "skipped":
                continue
            steps = job.get("steps")
            require(isinstance(steps, list), "historical publication steps unavailable")
            matches = [step for step in steps if isinstance(step, dict) and step.get("name") == STEP]
            require(len(matches) == 1 and matches[0].get("status") == "completed"
                    and matches[0].get("conclusion") in {"success", "failure", "cancelled", "timed_out", "skipped"},
                    "historical push opportunity is unknown")
            if matches[0]["conclusion"] != "skipped":
                witnesses.append({"runId": row["id"], "runAttempt": old_attempt,
                                  "jobId": job.get("id"), "stepConclusion": matches[0]["conclusion"]})
    return witnesses


class ReconcileOnly:
    """Later workflow attempts may adopt verified existing refs, never blindly push again."""

    def __init__(self, adapter):
        self.adapter = adapter

    def inspect_local(self, image_id):
        return self.adapter.inspect_local(image_id)

    def resolve_tag(self, tag):
        return self.adapter.resolve_tag(tag)

    def fetch_manifest(self, reference):
        return self.adapter.fetch_manifest(reference)

    def push(self, image_id, tag):
        raise RegistryError("earlier workflow had a push opportunity; only independent readback is permitted")
