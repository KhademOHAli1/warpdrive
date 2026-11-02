"""Recover known identities safely when GitHub's issue list briefly lags writes."""

from tracking_model import MARKER, TrackingError


def reconcile_known_issues(gh, base, current, expected):
    """Supplement a duplicate-checked list with independently verified direct GETs.

    A saved issue number is an identity hint, never permission to recreate an
    absent issue. Keep the full current response so operator edits survive.
    """
    direct_reads = 0
    for ident, known in expected.items():
        if any(known.get(key) is None for key in ("number", "id", "node_id")):
            raise TrackingError(f"Incomplete known issue identity for {ident}; manual reconciliation required")
        actual = current.get(ident)
        if actual is None:
            try:
                actual = gh.request("GET", base + f"/issues/{known['number']}")
            except TrackingError as exc:
                raise TrackingError(f"Cannot reconcile known issue {ident} #{known['number']}; no automatic recreation. {exc}") from exc
            direct_reads += 1
        if actual.get("pull_request") or MARKER.findall(actual.get("body") or "") != [ident] or any(actual.get(key) != known[key] for key in ("number", "id", "node_id")):
            raise TrackingError(f"Known issue identity mismatch for {ident} #{known['number']}; manual reconciliation required")
        current[ident] = actual
    return direct_reads


def reconcile_pending_creates(current, checkpoint):
    """Resolve durable creation intents only after a unique remote marker is seen."""
    pending = checkpoint.setdefault("pending_creates", {})
    if not isinstance(pending, dict):
        raise TrackingError("Invalid pending creation checkpoint; manual reconciliation required")
    unresolved = sorted(set(pending) - current.keys())
    if unresolved:
        raise TrackingError("Unresolved pending create: " + ", ".join(unresolved) + ". A prior request may have succeeded. Wait for GitHub to expose its unique marker or perform a verified operator reconciliation; no automatic recreation or other mutation is allowed.")
    for ident, intent in pending.items():
        if intent.get("canonical_id") != ident or not intent.get("spec_sha256"):
            raise TrackingError(f"Invalid pending creation identity for {ident}; manual reconciliation required")
        checkpoint.setdefault("managed_hashes", {}).setdefault(ident, intent["spec_sha256"])
    count = len(pending)
    pending.clear()
    return count
