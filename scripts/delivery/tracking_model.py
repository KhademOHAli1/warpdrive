"""Validated roadmap model and lossless generated specification regions."""

from __future__ import annotations

import csv
from contextlib import contextmanager
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
MARKER = re.compile(r"<!-- warpdrive:delivery-id:([A-Za-z0-9_./:-]+) -->")
START = "<!-- warpdrive:spec:start -->"
END = "<!-- warpdrive:spec:end -->"


class TrackingError(RuntimeError):
    pass


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


@contextmanager
def operation_lock(path):
    """Serialize writers sharing a checkpoint, including separate processes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise TrackingError("An importer is already running for this checkpoint") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def load_csv(text):
    """Strict RFC-compatible CSV helper for future specification adapters."""
    rows = list(csv.DictReader(io.StringIO(text), strict=True))
    if any(None in row for row in rows):
        raise TrackingError("CSV has rows with more columns than its header")
    return rows


def validate(manifest):
    if manifest.get("schema_version") != 1:
        raise TrackingError("Unsupported roadmap schema_version (expected 1)")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", manifest.get("repository", "")):
        raise TrackingError("Invalid repository")
    items = manifest.get("items", [])
    if not items:
        raise TrackingError("Roadmap contains no items")
    indexed = {}
    refs = {}
    children = Counter()
    source_counts = Counter()
    declared_sources = {source["id"] for source in manifest.get("sources", [])}
    if len(declared_sources) != len(manifest.get("sources", [])):
        raise TrackingError("Duplicate source namespace")
    for item in items:
        ident = item.get("id", "")
        if not re.fullmatch(r"[A-Za-z0-9_./:-]+", ident) or ident in indexed:
            raise TrackingError(f"Invalid or duplicate canonical ID: {ident}")
        if not item.get("title") or item.get("kind") not in {"programme", "package", "deliverable", "journey", "maintenance"}:
            raise TrackingError(f"Missing title or invalid kind: {ident}")
        if not item.get("module"):
            raise TrackingError(f"Missing module: {ident}")
        if not isinstance(item.get("acceptance", []), list):
            raise TrackingError(f"Acceptance must be an array: {ident}")
        for field in ("dependencies", "source_tasks", "labels", "evidence"):
            if not isinstance(item.get(field, []), list):
                raise TrackingError(f"{field} must be an array: {ident}")
        indexed[ident] = item
        for ref in item.get("source_tasks", []):
            key = (ref.get("source"), str(ref.get("id", "")))
            if not all(key):
                raise TrackingError(f"Missing source namespace/original ID: {ident}")
            if key[0] not in declared_sources:
                raise TrackingError(f"Unknown source namespace {key[0]}: {ident}")
            if key in refs:
                raise TrackingError(f"Source task maps more than once: {key} ({refs[key]}, {ident})")
            refs[key] = ident
            source_counts[key[0]] += 1
    blocking_counts = Counter()
    for item in items:
        ident = item["id"]
        parent = item.get("parent")
        if parent:
            if parent not in indexed or parent == ident:
                raise TrackingError(f"Invalid parent of {ident}: {parent}")
            children[parent] += 1
        dependencies = item.get("dependencies", [])
        unique_dependencies = set(dependencies)
        if len(dependencies) != len(unique_dependencies):
            raise TrackingError(f"Duplicate dependency ID in {ident}")
        if len(unique_dependencies) > 50:
            raise TrackingError(f"Issue {ident} exceeds GitHub's 50 blocking dependencies limit: {len(unique_dependencies)}")
        for dependency in unique_dependencies:
            if dependency not in indexed or dependency == ident:
                raise TrackingError(f"Invalid dependency of {ident}: {dependency}")
            blocking_counts[dependency] += 1
    for dependency, count in blocking_counts.items():
        if count > 50:
            raise TrackingError(f"Issue {dependency} exceeds GitHub's 50 blocked issues limit: {count}")
    for parent, count in children.items():
        if count > 100:
            raise TrackingError(f"Parent {parent} exceeds GitHub's 100 immediate sub-issue limit: {count}")
    parent_depths, parent_active = {}, set()
    def parent_depth(ident):
        if ident in parent_active:
            raise TrackingError(f"Cycle in parent at {ident}")
        if ident in parent_depths:
            return parent_depths[ident]
        if len(parent_active) > 8:
            raise TrackingError(f"Hierarchy exceeds eight parent levels: {ident}")
        parent_active.add(ident)
        parent = indexed[ident].get("parent")
        depth = 1 + parent_depth(parent) if parent else 0
        parent_active.remove(ident)
        if depth > 8:
            raise TrackingError(f"Hierarchy exceeds eight parent levels: {ident}")
        parent_depths[ident] = depth
        return depth
    for ident in indexed:
        parent_depth(ident)
    active, visited = set(), set()
    def visit_dependency(ident):
        if ident in active:
            raise TrackingError(f"Cycle in dependencies at {ident}")
        if ident in visited:
            return
        active.add(ident)
        for target in indexed[ident].get("dependencies", []):
            visit_dependency(target)
        active.remove(ident)
        visited.add(ident)
    for ident in indexed:
        visit_dependency(ident)
    for source in manifest.get("sources", []):
        expected = source.get("count")
        # Count must describe original source-task rows, never programme wrappers.
        if expected is not None and source_counts[source["id"]] != expected:
            raise TrackingError(f"Incomplete source mapping for {source['id']}: expected {expected}, mapped {source_counts[source['id']]}")
    return indexed


def index_issues(issues):
    result = {}
    for issue in issues:
        if issue.get("pull_request"):
            continue
        identities = MARKER.findall(issue.get("body") or "")
        if len(identities) > 1:
            raise TrackingError(f"Issue #{issue['number']} has multiple delivery identities")
        for ident in identities:
            if ident in result:
                raise TrackingError(f"Duplicate GitHub delivery identity {ident}: #{result[ident]['number']} and #{issue['number']}")
            result[ident] = issue
    return result


def clean_text(value):
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def source_link(repository, ref, source_heads=None):
    path = ref.get("path") or ref.get("ref") or ""
    if path.startswith("https://github.com/"):
        return path
    if path.startswith(("/", "file:", "http:")) or ".." in Path(path).parts:
        return "Specification snapshot (see roadmap source register)"
    revision = (source_heads or {}).get(ref.get("source")) or "main"
    if path.startswith("docs/delivery/"):
        revision = "main"
    return f"https://github.com/{repository}/blob/{quote(revision, safe='')}/{quote(path, safe='/#')}" if path else "Source register"


def managed_spec(item, repository, source_heads=None):
    lines = [START, f"<!-- warpdrive:delivery-id:{item['id']} -->", f"## Approved scope: {item['id']}", "",
             f"Module: **{item['module']}** · Type: **{item['kind']}**",
             f"Coordinating owner: @{item.get('owner', 'KhademOHAli1')}"]
    if item.get("owner_role"):
        lines.append(f"Implementation responsibility: {item['owner_role']}")
    lines.extend(["", "### Original roadmap references", ""])
    for ref in item.get("source_tasks", []):
        lines.append(f"- `{ref['source']} / {ref['id']}`: [specification]({source_link(repository, ref, source_heads)})")
    if not item.get("source_tasks"):
        lines.append("- Programme/work-package wrapper; original tasks are linked through its sub-issues.")
    flags = []
    flag_keys = ("status", "classification", "sourceMatched", "sourceMatchStatus", "providerGate", "accepted", "implementationCompletion", "scopeRetained", "scopeDisposition", "sourceMatchQualification", "citationQualification")
    for ref in item.get("source_tasks", []):
        original = ref.get("original", {})
        qualification = {key: original[key] for key in flag_keys if key in original}
        if qualification:
            flags.append(f"- `{ref['source']} / {ref['id']}`: {json.dumps(qualification, ensure_ascii=False, sort_keys=True)}")
    if flags:
        lines.extend(["", "<details><summary>Historical source qualification flags</summary>", "", *flags, "", "</details>", "", f"All original records, notes, source bindings and limitations remain in the [preserved roadmap register](https://github.com/{repository}/blob/main/docs/delivery/roadmap.json). False source-match and acceptance flags remain limitations."])
    lines.extend(["", "### Acceptance criteria", ""])
    for index, criterion in enumerate(item.get("acceptance", []), 1):
        lines.append(f"- **AC{index}**: {clean_text(criterion)}")
    if not item.get("acceptance"):
        lines.append("Acceptance scope must be confirmed against the linked specification before this issue can be accepted.")
    if item.get("dependencies"):
        lines.extend(["", "### Blocking deliverables", "", *[f"- `{dep}` (native GitHub blocking relationship after reconciliation)" for dep in item["dependencies"]]])
    lines.extend(["", "### Historical import observation", "",
                  f"Observed source status: **{item.get('observed_status', 'unclassified')}**; observed stage: **{item.get('observed_stage', 'unclassified')}**.",
                  "This observation is historical evidence, not acceptance, release, deployment, or provider/installation qualification. Live execution is maintained on this issue and its Project item."])
    if item.get("evidence"):
        lines.extend(["", "Supporting evidence (retain its stated limitations):", "", *[f"- {clean_text(value)}" for value in item["evidence"]]])
    if item.get("notes"):
        lines.extend(["", "### Source notes", "", clean_text(item["notes"])])
    if item.get("remaining_gates"):
        lines.extend(["", "### Remaining gates", "", *[f"- {clean_text(gate)}" for gate in item["remaining_gates"]]])
    lines.extend([END])
    return "\n".join(lines)


def issue_body(item, repository, source_heads=None):
    return managed_spec(item, repository, source_heads) + "\n\n## Live delivery record\n\n" + (
        "Maintain updates below this heading. The importer preserves this section and GitHub status, assignee, milestone, labels and comments.\n\n"
        "- [ ] Source implemented: link exact source revision and focused evidence.\n"
        "- [ ] Integrated: required CI passed for the included main revision.\n"
        "- [ ] User journey accepted: record applicable AC IDs, revision, reviewer and evidence.\n"
        "- [ ] Released: link the published version and release manifest.\n"
        "- [ ] Deployed: link separately authorized deployment evidence, if applicable.\n"
        "- [ ] Provider/installation accepted: record real target/provider evidence, if applicable.\n\n"
        "Do not close this issue from a subset, synthetic tests, generated packets or failed-first diagnostics.\n"
    )


def reconcile_body(existing, desired, previous_hash=None):
    if existing.count(START) != 1 or existing.count(END) != 1:
        raise TrackingError("Existing identity has no unique managed specification region; manual reconciliation required")
    start, end = existing.index(START), existing.index(END) + len(END)
    if end < start:
        raise TrackingError("Malformed managed specification region")
    old = existing[start:end]
    if old == desired:
        return existing
    if previous_hash is None or digest(old) != previous_hash:
        raise TrackingError("Managed specification was edited or has no baseline; preserve it and reconcile explicitly")
    return existing[:start] + desired + existing[end:]


def mapping(manifest, issues):
    output = {"schema_version": 1, "repository": manifest["repository"], "generated_at": stamp(), "issues": {}, "sources": []}
    for item in manifest["items"]:
        issue = issues.get(item["id"])
        if not issue:
            continue
        entry = {"number": issue["number"], "id": issue["id"], "node_id": issue["node_id"], "url": issue["html_url"]}
        output["issues"][item["id"]] = entry
        for ref in item.get("source_tasks", []):
            output["sources"].append({"source": ref["source"], "id": ref["id"], "canonical_id": item["id"], "issue": entry["number"], "url": entry["url"]})
    return output


def labels_for(item):
    labels = ["roadmap", f"module:{item['module']}", f"kind:{item['kind']}"] + item.get("labels", [])
    if item.get("release") == "next" or (item["kind"] == "journey" and item.get("release")):
        labels.append("release:next")
    observed = str(item.get("observed_status", "")).lower().replace("_", "-").replace(" ", "-")
    if observed in {"active", "in-progress"}:
        labels.append("import:active")
    elif observed == "source-verified":
        labels.append("import:source-verified")
    elif observed in {"blocked", "waiting-external"}:
        labels.append("import:blocked")
    return sorted(set(labels))


def initial_project_status(item):
    labels = labels_for(dict(item, kind=item.get("kind", "deliverable"), module=item.get("module", "operations")))
    if "import:active" in labels:
        return "In Progress"
    if "import:source-verified" in labels:
        return "Source verified"
    if "import:blocked" in labels:
        return "Blocked"
    return "Todo"


def issue_summary(issue):
    return {key: issue.get(key) for key in ("number", "id", "node_id", "html_url", "state", "state_reason", "title", "updated_at", "closed_at", "milestone", "assignees", "labels")}


