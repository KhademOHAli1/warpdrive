"""Additive native graph reconciliation that preserves verified operator history."""

from collections import Counter

from tracking_budget import WriteBudgetReached
from tracking_model import TrackingError


def reconcile_relationships(manifest, gh, issues, checkpoint, apply, save, repair=False):
    """Verify graph history before writes and checkpoint each independently read edge.

    Unknown unimported targets defer. Previously verified endpoints must remain
    identifiable, so a partial map cannot conceal an operator-deleted edge.
    """
    counts = Counter()
    desired = {"subissues": {}, "dependencies": {}}
    prior = checkpoint.get("verified_relationships", {})
    if not isinstance(prior, dict):
        raise TrackingError("Malformed verified relationship checkpoint")

    for item in manifest["items"]:
        ident, parent = item["id"], item.get("parent")
        if parent:
            if ident not in issues or parent not in issues:
                counts["subissues_deferred"] += 1
            else:
                desired["subissues"].setdefault(parent, set()).add(ident)
        for dependency in item.get("dependencies", []):
            if ident not in issues or dependency not in issues:
                counts["dependencies_deferred"] += 1
            else:
                desired["dependencies"].setdefault(ident, set()).add(dependency)

    for kind in desired:
        history = prior.get(kind, {})
        if not isinstance(history, dict):
            raise TrackingError(f"Malformed verified {kind} checkpoint")
        for owner, targets in history.items():
            if not isinstance(targets, list) or any(not isinstance(target, str) for target in targets):
                raise TrackingError(f"Malformed verified {kind} history for {owner}")
            if owner not in issues or any(target not in issues for target in targets):
                raise TrackingError(f"Cannot identify previously verified {kind} endpoints for {owner}; reconcile the issue mapping before graph writes")
            desired[kind].setdefault(owner, set()).update(targets)

    def path_for(kind, owner):
        suffix = "sub_issues" if kind == "subissues" else "dependencies/blocked_by"
        return f"repos/{manifest['repository']}/issues/{issues[owner]['number']}/{suffix}"

    def read(kind, owner):
        return {entry["id"] for entry in gh.list(path_for(kind, owner))}

    def missing_prior(kind, owner, actual):
        return [target for target in checkpoint.get("verified_relationships", {}).get(kind, {}).get(owner, []) if issues[target]["id"] not in actual]

    # Complete preflight prevents a missing dependency discovered late in the
    # manifest from being silently restored after earlier graph mutations.
    live = {kind: {owner: read(kind, owner) for owner in groups} for kind, groups in desired.items()}
    conflicts = [(kind, owner, target) for kind, groups in live.items() for owner, actual in groups.items() for target in missing_prior(kind, owner, actual)]
    if conflicts and not repair:
        detail = "; ".join(f"{kind} {owner} -> {target}" for kind, owner, target in conflicts[:10])
        raise TrackingError(f"Previously verified relationship removed: {detail}. Review operator intent and use explicit repair only when restoration is authorized.")
    counts["relationship_repairs"] = len(conflicts)

    def record(kind, owner, actual):
        deleted = missing_prior(kind, owner, actual)
        if deleted and not repair:
            raise TrackingError(f"Previously verified relationship removed during reconciliation: {kind} {owner} -> {deleted[0]}; review before explicit repair")
        state = checkpoint.setdefault("verified_relationships", {"subissues": {}, "dependencies": {}})
        verified = [target for target in desired[kind][owner] if issues[target]["id"] in actual]
        # Keep missing prior entries until repaired; never erase deletion evidence.
        verified += state.get(kind, {}).get(owner, [])
        state.setdefault(kind, {})[owner] = sorted(set(verified))
        state.setdefault("subissues", {})
        state.setdefault("dependencies", {})
        save()

    for kind, groups in desired.items():
        for owner, targets in groups.items():
            actual = live[kind][owner]
            for target in sorted(targets):
                target_id = issues[target]["id"]
                if target_id in actual:
                    continue
                counts["subissues_add" if kind == "subissues" else "dependencies_add"] += 1
                if not apply:
                    continue
                payload = {"sub_issue_id" if kind == "subissues" else "issue_id": target_id}
                try:
                    gh.request("POST", path_for(kind, owner), payload)
                except WriteBudgetReached:
                    raise
                except TrackingError:
                    actual = read(kind, owner)
                    record(kind, owner, actual)
                    if target_id not in actual:
                        raise
                else:
                    actual = read(kind, owner)
                    record(kind, owner, actual)
                if target_id not in actual:
                    label = "Sub-issue" if kind == "subissues" else "Dependency"
                    raise TrackingError(f"{label} verification failed for {owner} -> {target}")
            if apply:
                missing = [target for target in targets if issues[target]["id"] not in actual]
                if missing:
                    raise TrackingError(f"Relationship verification incomplete for {kind} {owner}: {missing[0]}")
                record(kind, owner, actual)
                counts["subissues_verified" if kind == "subissues" else "dependencies_verified"] += len(targets)
    return dict(counts)
