"""Validate the agency planning package, not application behavior."""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REQUIRED = {
    "README.md", "PRD-Warpdrive-Agency-Projects.md", "PROJECTS.md", "TASKS.csv",
    "TASKS.json", "ARCHITECTURE.md", "COORDINATION.md", "TEST-MATRIX.md",
    "DECISIONS.md", "HANDOFF.md", "BRANCH-SNAPSHOT.json", "build_plan.py",
    "validate_plan.py",
}


def validate():
    for name in REQUIRED:
        assert (ROOT / name).is_file(), f"Missing file: {name}"
    tasks = json.loads((ROOT / "TASKS.json").read_text())
    with (ROOT / "TASKS.csv").open(newline="") as file:
        csv_tasks = list(csv.DictReader(file))
    assert tasks == csv_tasks, "CSV and JSON task register differ"
    known = {task["id"] for task in tasks}
    projects = {task["project"] for task in tasks}
    assert len(tasks) == len(known) == 96
    assert len(projects) == 12
    for project in projects:
        assert sum(task["project"] == project for task in tasks) == 8
    md = (ROOT / "PROJECTS.md").read_text()
    for task in tasks:
        assert sum(line.startswith(f"| {task['id']} |") for line in md.splitlines()) == 1, task["id"]
        assert task["expected_outcome"] and task["expected_passing_tests"]
        assert task["status"] == "planned", "Original planning register must remain an immutable baseline"
    test_doc = (ROOT / "TEST-MATRIX.md").read_text()
    families = set(re.findall(r"\| (T\d{2}) ", test_doc))
    assert families == {f"T{i:02d}" for i in range(36)}
    for task in tasks:
        assert set(re.findall(r"T\d{2}", task["expected_passing_tests"])) <= families
    graph = {task["id"]: task["dependencies"].split(";") if task["dependencies"] else [] for task in tasks}
    done, active = set(), set()
    def visit(key):
        assert key in known, f"Unknown dependency: {key}"
        assert key not in active, f"Dependency cycle: {key}"
        if key in done:
            return
        active.add(key)
        for dep in graph[key]:
            visit(dep)
        active.remove(key)
        done.add(key)
    for key in graph:
        visit(key)
    for path in ROOT.glob("*.md"):
        text = path.read_text()
        assert not any(value in text for value in ["[Your Name]", "[Name]", "TODO", "TBD"]), path.name
        for target in re.findall(r"\]\(([^)]+)\)", text):
            if "://" in target or target.startswith("#"):
                continue
            assert (path.parent / target.split("#", 1)[0]).exists(), f"Broken local link: {target}"
    return dict(work_packages=len(projects), tasks=len(tasks), test_families=len(families),
        csv_json_equal=True, dependency_dag_valid=True, outcome_test_coverage_complete=True,
        application_tests_executed_by_planning_chat=False)


def files():
    return sorted(path for path in ROOT.iterdir() if path.is_file() and path.name != "MANIFEST.json")


if __name__ == "__main__":
    checks = validate()
    if "--write-manifest" in sys.argv:
        manifest = dict(version=1, prepared_date="2026-10-31", timezone="Europe/Berlin",
            scope="Agency Projects planning package; not release qualification", validation=checks,
            files={path.name: {"bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in files()})
        (ROOT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    else:
        manifest = json.loads((ROOT / "MANIFEST.json").read_text())
        assert set(manifest["files"]) == {path.name for path in files()}, "File set changed"
        for path in files():
            assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest["files"][path.name]["sha256"], f"Changed artifact: {path.name}"
    print(json.dumps(checks, indent=2))
