"""Render live progress without modifying the immutable 96-task planning baseline."""
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASELINE = ROOT / "baseline-plan"


def render():
    manifest = json.loads((BASELINE / "MANIFEST.json").read_text())
    for name, metadata in manifest["files"].items():
        assert hashlib.sha256((BASELINE / name).read_bytes()).hexdigest() == metadata["sha256"], name
    tasks = json.loads((BASELINE / "TASKS.json").read_text())
    with (BASELINE / "TASKS.csv").open(newline="") as source:
        assert tasks == list(csv.DictReader(source)), "Baseline CSV/JSON disagreement"
    ids = {task["id"] for task in tasks}
    assert len(ids) == len(tasks) == 96
    assert len({task["project"] for task in tasks}) == 12
    progress = json.loads((ROOT / "progress.json").read_text())
    assert set(progress["tasks"]) <= ids
    seen, visiting = set(), set()
    by_id = {task["id"]: task for task in tasks}

    def visit(task_id):
        assert task_id in ids, task_id
        assert task_id not in visiting, "Cyclic dependency: " + task_id
        if task_id in seen:
            return
        visiting.add(task_id)
        for dependency in filter(None, by_id[task_id]["dependencies"].split(";")):
            visit(dependency)
        visiting.remove(task_id)
        seen.add(task_id)

    for task in tasks:
        visit(task["id"])
        task.update(progress["tasks"].get(task["id"], {
            "status": "planned", "evidence": "Not implemented or qualified",
            "remaining": "Original outcome, dependencies and applicable acceptance tests remain",
            "accepted": False,
        }))
        assert task["status"] in {"planned", "active", "source-verified", "runtime-verified", "blocked", "accepted"}
        assert task["accepted"] == (task["status"] == "accepted")
    (ROOT / "TASKS.live.json").write_text(json.dumps(tasks, indent=2, ensure_ascii=False) + "\n")
    with (ROOT / "TASKS.live.csv").open("w", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(tasks[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(tasks)
    rows = ["# Agency Projects live task and evidence ledger", "",
            "All 96 original IDs, outcomes, tests and dependencies are retained in the live CSV/JSON.",
            "Status describes evidence level. Source/unit evidence is not task acceptance.", "",
            "| ID | Task | Status | Accepted | Evidence | Remaining |", "| --- | --- | --- | --- | --- | --- |"]
    for task in tasks:
        values = [task["id"], task["title"], task["status"], str(task["accepted"]).lower(), task["evidence"], task["remaining"]]
        rows.append("| " + " | ".join(value.replace("|", "\\|").replace("\n", " ") for value in values) + " |")
    (ROOT / "TASKS.live.md").write_text("\n".join(rows) + "\n")
    print(json.dumps({"tasks": len(tasks), "workPackages": 12, "dagValid": True,
                      "baselineHashesValid": True, "accepted": sum(task["accepted"] for task in tasks)}))


if __name__ == "__main__":
    render()
