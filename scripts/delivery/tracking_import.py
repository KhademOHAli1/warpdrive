"""Additive reconciliation and generated GitHub execution snapshots."""

import json
from pathlib import Path
import re
from collections import Counter

from tracking_api import sync_project
from tracking_budget import BudgetedGh, WriteBudgetReached
from tracking_consistency import reconcile_known_issues, reconcile_pending_creates
from tracking_snapshot import snapshot
from tracking_relationships import reconcile_relationships
from tracking_model import (
    MARKER, TrackingError, atomic_json, digest, index_issues, issue_body,
    issue_summary, labels_for, managed_spec, mapping, reconcile_body, stamp, validate,
)

def run_import(manifest, gh, args):
    gh = BudgetedGh(gh, getattr(args, "max_writes", None))
    validate(manifest)
    repository = manifest["repository"]
    source_heads = {source["id"]: source.get("source_head") for source in manifest.get("sources", [])}
    base = f"repos/{repository}"
    all_issues = gh.list(base + "/issues?state=all")
    issues = index_issues(all_issues)
    desired_ids = {item["id"] for item in manifest["items"]}
    for issue in all_issues:
        if issue.get("pull_request") or MARKER.search(issue.get("body") or ""):
            continue
        possible_id = re.match(r"^\[([A-Za-z0-9_./:-]+)\]", issue.get("title", ""))
        if possible_id and possible_id[1] in desired_ids:
            raise TrackingError(f"Unmanaged issue #{issue['number']} has roadmap ID {possible_id[1]} in its title. Restore/adopt its identity before importing.")
    labels = {label["name"]: label for label in gh.list(base + "/labels")}
    milestones = {entry["title"]: entry for entry in gh.list(base + "/milestones?state=all")}
    checkpoint_path = Path(args.checkpoint)
    checkpoint = json.loads(checkpoint_path.read_text()) if checkpoint_path.exists() else {"schema_version": 1, "repository": repository, "managed_hashes": {}}
    if checkpoint.get("repository") != repository:
        raise TrackingError("Checkpoint belongs to a different repository")
    recovered = reconcile_known_issues(gh, base, issues, checkpoint.get("issues", {}))
    pending_adopted = reconcile_pending_creates(issues, checkpoint)
    counts = Counter(existing=len(issues), unrelated=sum(1 for issue in all_issues if not issue.get("pull_request") and not MARKER.search(issue.get("body") or "")), known_direct_reads=recovered, pending_adopted=pending_adopted)
    conflicts = []

    def save():
        checkpoint["updated_at"] = stamp()
        checkpoint["issues"] = {ident: issue_summary(issue) for ident, issue in issues.items()}
        atomic_json(checkpoint_path, checkpoint)
        atomic_json(args.mapping, mapping(manifest, issues))

    if getattr(args, "phase", "all") == "all" and checkpoint.get("verified_relationships") and not args.skip_relationships:
        # An operator-deleted verified edge must not be discovered after unrelated
        # metadata or record writes in a combined run.
        reconcile_relationships(manifest, gh, issues, checkpoint, False, save, repair=getattr(args, "repair_relationships", False))

    def perform():
        nonlocal issues, labels, milestones
        wanted_labels = {label for item in manifest["items"] for label in labels_for(item)}
        records_phase = getattr(args, "phase", "all") in {"all", "records"}
        for label in sorted(wanted_labels - labels.keys()) if records_phase else []:
            counts["labels_create"] += 1
            if args.apply:
                try:
                    labels[label] = gh.request("POST", base + "/labels", {"name": label, "color": "1d76db", "description": "Warpdrive delivery tracking"})
                except WriteBudgetReached:
                    raise
                except TrackingError:
                    labels = {row["name"]: row for row in gh.list(base + "/labels")}
                    if label not in labels:
                        raise
                save()
        for milestone in manifest.get("milestones", []) if records_phase else []:
            title = milestone["title"]
            if title not in milestones:
                counts["milestones_create"] += 1
                if args.apply:
                    try:
                        milestones[title] = gh.request("POST", base + "/milestones", {"title": title, "description": milestone.get("description", ""), "state": "open"})
                    except WriteBudgetReached:
                        raise
                    except TrackingError:
                        milestones = {row["title"]: row for row in gh.list(base + "/milestones?state=all")}
                        if title not in milestones:
                            raise
                    save()
    
        created = 0
        for item in manifest["items"] if records_phase else []:
            ident = item["id"]
            desired = managed_spec(item, repository, source_heads)
            issue = issues.get(ident)
            if not issue:
                counts["issues_create"] += 1
                if not args.apply:
                    continue
                if args.max_create is not None and created >= args.max_create:
                    counts["creation_deferred"] += 1
                    continue
                body = {"title": f"[{ident}] {item['title']}"[:256], "body": issue_body(item, repository, source_heads), "labels": labels_for(item), "assignees": [item.get("owner", "KhademOHAli1")]}
                release = item.get("milestone") or item.get("release")
                if release and release in milestones:
                    body["milestone"] = milestones[release]["number"]
                gh.check_write_available()
                checkpoint["pending_creates"][ident] = {"canonical_id": ident, "spec_sha256": digest(desired), "created_at": stamp()}
                save()
                try:
                    issue = gh.request("POST", base + "/issues", body)
                except WriteBudgetReached:
                    raise
                except TrackingError:
                    recovered = index_issues(gh.list(base + "/issues?state=all"))
                    if ident not in recovered:
                        save()
                        raise
                    issue = recovered[ident]
                issues[ident] = issue
                checkpoint.setdefault("managed_hashes", {})[ident] = digest(desired)
                checkpoint["pending_creates"].pop(ident)
                created += 1
                save()
                print(json.dumps({"created": ident, "number": issue["number"], "created_this_run": created}), flush=True)
            else:
                try:
                    updated_body = reconcile_body(issue.get("body") or "", desired, checkpoint.get("managed_hashes", {}).get(ident))
                except TrackingError as exc:
                    conflicts.append({"id": ident, "number": issue["number"], "reason": str(exc)})
                    continue
                if updated_body != issue.get("body"):
                    counts["spec_updates_available"] += 1
                    if args.apply and args.refresh_spec:
                        # Re-read directly before replacing the managed region.
                        current = gh.request("GET", base + f"/issues/{issue['number']}")
                        if current.get("body") != issue.get("body"):
                            conflicts.append({"id": ident, "number": issue["number"], "reason": "Issue body changed during reconciliation; preserved"})
                            continue
                        issue = gh.request("PATCH", base + f"/issues/{issue['number']}", {"body": updated_body})
                        issues[ident] = issue
                        checkpoint.setdefault("managed_hashes", {})[ident] = digest(desired)
                        counts["spec_updates_applied"] += 1
                        save()
                elif args.apply:
                    checkpoint.setdefault("managed_hashes", {})[ident] = digest(desired)
    
        if not args.skip_relationships and getattr(args, "phase", "all") in {"all", "relationships"}:
            counts.update(reconcile_relationships(manifest, gh, issues, checkpoint, args.apply, save, repair=getattr(args, "repair_relationships", False)))

        if args.project_config and getattr(args, "phase", "all") in {"all", "project"}:
            config = json.loads(Path(args.project_config).read_text())
            counts.update(sync_project(gh, config, manifest, issues, args.apply, save))
        if args.apply:
            # The verification read is independent of checkpoint state and detects duplicate writes.
            verified = index_issues(gh.list(base + "/issues?state=all"))
            counts["verification_direct_reads"] = reconcile_known_issues(gh, base, verified, issues)
            issues = verified
            if records_phase:
                verified_labels = {label["name"] for label in gh.list(base + "/labels")}
                if not wanted_labels <= verified_labels:
                    raise TrackingError("Created labels failed independent verification")
                verified_milestones = {entry["title"] for entry in gh.list(base + "/milestones?state=all")}
                if not {entry["title"] for entry in manifest.get("milestones", [])} <= verified_milestones:
                    raise TrackingError("Created milestones failed independent verification")
            save()
        return {"mode": "apply" if args.apply else "dry-run", "writes_used": gh.used, "counts": dict(counts), "manifest_items": len(manifest["items"]), "mapped_items": len(set(issues) & {item['id'] for item in manifest['items']}), "conflicts": conflicts, "complete": all(item["id"] in issues for item in manifest["items"])}

    try:
        return perform()
    except WriteBudgetReached:
        if args.apply:
            save()
        return {"mode": "apply" if args.apply else "dry-run", "complete": False, "stopped_reason": "write-budget", "writes_used": gh.used, "counts": dict(counts), "manifest_items": len(manifest["items"]), "mapped_items": len(set(issues) & {item["id"] for item in manifest["items"]}), "conflicts": conflicts}


