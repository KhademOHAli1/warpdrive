"""Adopt an exact existing intake issue without creating another issue.

The CLI holds the same checkpoint lock used by imports. Adoption never changes
issue state, title, ownership or milestone, and never creates an issue.
"""
import json
from pathlib import Path
import re

from tracking_consistency import reconcile_known_issues
from tracking_model import (
    MARKER, START, END, TrackingError, atomic_json, digest, index_issues,
    issue_summary, labels_for, managed_spec, mapping, stamp, validate,
)


def adopt_existing(manifest, gh, args):
    items = validate(manifest)
    if args.canonical_id not in items or not isinstance(args.issue, int) or args.issue < 1:
        raise TrackingError("Adoption requires a registered canonical ID and an exact positive issue number")
    item = items[args.canonical_id]
    if not item.get("acceptance"):
        raise TrackingError("Register the bounded acceptance scope before adopting an intake issue")
    repository = manifest["repository"]
    base = f"repos/{repository}"
    checkpoint_path = Path(args.checkpoint)
    checkpoint = json.loads(checkpoint_path.read_text()) if checkpoint_path.exists() else {"schema_version": 1, "repository": repository, "managed_hashes": {}}
    if checkpoint.get("repository") != repository:
        raise TrackingError("Checkpoint belongs to a different repository")
    if checkpoint.get("pending_creates"):
        raise TrackingError("Reconcile unresolved create intents before adopting another issue")
    all_issues = gh.list(base + "/issues?state=all")
    issues = index_issues(all_issues)
    known = dict(checkpoint.get("issues", {}))
    mapping_path = Path(args.mapping)
    if mapping_path.exists():
        saved_map = json.loads(mapping_path.read_text())
        if saved_map.get("repository") != repository:
            raise TrackingError("Saved mapping belongs to a different repository")
        for ident, value in saved_map.get("issues", {}).items():
            if ident in known and any(known[ident].get(k) != value.get(k) for k in ("number", "id", "node_id")):
                raise TrackingError("Checkpoint and saved mapping disagree; reconcile identities first")
            known[ident] = value
    reconcile_known_issues(gh, base, issues, known)
    existing = issues.get(args.canonical_id)
    if existing and existing["number"] != args.issue:
        raise TrackingError(f"Canonical identity already belongs to #{existing['number']}; no duplicate adoption")
    for other in all_issues:
        match = re.match(r"^\[([A-Za-z0-9_./:-]+)\]", other.get("title", ""))
        if other["number"] != args.issue and match and match[1] == args.canonical_id:
            raise TrackingError(f"Another intake #{other['number']} already names this canonical ID")
    path = base + f"/issues/{args.issue}"
    issue = gh.request("GET", path)
    markers = MARKER.findall(issue.get("body") or "")
    if "pull_request" in issue or (markers and markers != [args.canonical_id]):
        raise TrackingError("Adoption target is a PR or belongs to another canonical identity")
    source_heads = {source["id"]: source.get("source_head") for source in manifest.get("sources", [])}
    desired = managed_spec(item, repository, source_heads)
    original = issue.get("body") or ""
    if markers:
        if original.count(START) != 1 or original.count(END) != 1 or desired not in original:
            raise TrackingError("Existing managed scope differs; use explicit specification reconciliation")
        body = original
    else:
        body = desired + "\n\n## Original intake and live delivery record\n\n" + original
    result = {"mode": "apply" if args.apply else "dry-run", "adopted": args.apply, "canonical_id": args.canonical_id, "issue": args.issue, "url": issue["html_url"]}
    if not args.apply:
        return result
    fresh = gh.request("GET", path)
    if fresh.get("body") != issue.get("body") or any(fresh.get(k) != issue.get(k) for k in ("number", "id", "node_id")):
        raise TrackingError("Intake changed during adoption; preserved it without mutation")
    if body != original:
        gh.request("PATCH", path, {"body": body})
    missing_labels = set(labels_for(item)) - {label["name"] for label in fresh.get("labels", [])}
    if missing_labels:
        gh.request("POST", path + "/labels", {"labels": sorted(missing_labels)})
    verified = gh.request("GET", path)
    if any(verified.get(k) != issue.get(k) for k in ("number", "id", "node_id")) or verified.get("body") != body or MARKER.findall(verified.get("body") or "") != [args.canonical_id] or not set(labels_for(item)) <= {x["name"] for x in verified.get("labels", [])}:
        raise TrackingError("Adoption verification failed; rerun to reconcile the existing target, never create another issue")
    issues[args.canonical_id] = verified
    checkpoint.setdefault("managed_hashes", {})[args.canonical_id] = digest(desired)
    checkpoint["issues"] = {ident: issue_summary(value) for ident, value in issues.items()}
    checkpoint["updated_at"] = stamp()
    atomic_json(checkpoint_path, checkpoint)
    atomic_json(args.mapping, mapping(manifest, issues))
    return result
