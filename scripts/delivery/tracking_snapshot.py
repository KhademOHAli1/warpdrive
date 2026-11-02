"""Verified GitHub execution snapshots; specifications and local ledgers are not status."""

import json
from pathlib import Path

from tracking_consistency import reconcile_known_issues
from tracking_model import TrackingError, atomic_json, index_issues, issue_summary, mapping, validate


def known_identities(repository, paths):
    """Saved identities are read hints, never source execution status or rebinding authority."""
    result = {}
    reverse = {}
    for value in paths:
        if value is None or not Path(value).exists():
            continue
        path = Path(value)
        document = json.loads(path.read_text())
        if not isinstance(document, dict) or document.get("schema_version") != 1 or document.get("repository") != repository:
            raise TrackingError(f"Snapshot identity hints have an invalid schema or repository: {path}")
        records = document.get("issues", {})
        if not isinstance(records, dict):
            raise TrackingError(f"Snapshot identity hints must be an object: {path}")
        for ident, record in records.items():
            if not isinstance(record, dict) or any(type(record.get(key)) is not int or record[key] < 1 for key in ("number", "id")) or not isinstance(record.get("node_id"), str) or not record["node_id"]:
                raise TrackingError(f"Incomplete saved issue identity for {ident}: {path}")
            identity = {key: record[key] for key in ("number", "id", "node_id")}
            if ident in result and result[ident] != identity:
                raise TrackingError(f"Conflicting saved issue identity for {ident}; reconcile checkpoint and mapping")
            for key, number in identity.items():
                if (key, number) in reverse and reverse[(key, number)] != ident:
                    raise TrackingError(f"Saved issue identity is shared by {reverse[(key, number)]} and {ident}")
                reverse[(key, number)] = ident
            result[ident] = identity
    return result


def snapshot(manifest, gh, path, checkpoint_path=None, mapping_path=None, allow_partial=False):
    indexed = validate(manifest)
    repository = manifest["repository"]
    known = known_identities(repository, (checkpoint_path, mapping_path))
    issues = index_issues(gh.list(f"repos/{repository}/issues?state=all"))
    recovered = reconcile_known_issues(gh, f"repos/{repository}", issues, known)
    missing = sorted(set(indexed) - set(issues))
    if missing and not allow_partial:
        raise TrackingError(f"Snapshot coverage is incomplete: {len(missing)} of {len(indexed)} canonical issues missing ({', '.join(missing[:10])}); prior output preserved. Use explicit --allow-partial only for a marked partial snapshot.")
    data = mapping(manifest, issues)
    # Keep every approved source row visible even when an explicit partial snapshot
    # cannot resolve its live issue, so missing work never disappears from reports.
    data["sources"] = []
    for item in manifest["items"]:
        live = data["issues"].get(item["id"])
        for ref in item.get("source_tasks", []):
            data["sources"].append({"source": ref["source"], "id": ref["id"], "canonical_id": item["id"], "issue": live["number"] if live else None, "url": live["url"] if live else None})
    mapped_references = sum(row["issue"] is not None for row in data["sources"])
    data["complete"] = not missing
    data["partial"] = bool(missing)
    data["coverage"] = {
        "complete": not missing,
        "partial": bool(missing),
        "expected_items": len(indexed),
        "mapped_items": len(set(indexed) & set(issues)),
        "missing_ids": missing,
        "original_task_references": len(data["sources"]),
        "mapped_original_task_references": mapped_references,
        "known_identity_direct_reads": recovered,
    }
    data["status_source"] = "Generated only from live GitHub API reads at generated_at; saved files supply identity hints only. Issue state, labels, assignees and milestones are live evidence. Acceptance, deployment and provider qualification retain their separate evidence gates."
    data["execution"] = {ident: issue_summary(issue) for ident, issue in issues.items()}
    atomic_json(path, data)
    return {"snapshot": str(path), "issues": len(issues), "source_mappings": len(data["sources"]), "mapped_source_mappings": mapped_references, **data["coverage"]}
