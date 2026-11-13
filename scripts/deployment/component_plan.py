"""Advisory Core build planning; retained images are unqualified candidates only.

Compare freshly verified current inputs with declared historical v2 inputs/identity.
This module performs no image, network, build, publication or deployment operation.
Historical authentication/custody and current release admission remain mandatory.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

import component_inputs as inputs
from candidate import COMPONENTS, IMAGE_ID, PENDING, REVISION, SMOKE_CHECKS

PENDING_GATES = (*PENDING,
    "authenticated-original-provenance-and-finalized-qualification",
    "durable-authenticated-original-custody",
    "immutable-original-image-config-and-source-readback",
    "mixed-assembly-current-release-qualification",
    "current-main-and-latest-full-ci-admission",
    "current-codeql-and-blocking-findings-admission",
    "independently-qualified-component-reuse",
    "v3-selection-and-promotion-integration",
    "engine-and-ingress-planning-and-qualification")
CANDIDATE_KEYS = {"schemaVersion", "kind", "revision", "releaseRevision", "platform", "components",
                  "qualification", "compatibility", "deploymentAuthorized", "pendingGates", "inputProvenance"}
IMAGE_KEYS = {"imageId", "runtimeUser", "registryRef", "sourceRevision", "inputSha256", "inputPolicySha256"}
RUNTIME_USER = re.compile(r"(?:[A-Za-z_][A-Za-z0-9_.-]{0,127}|[0-9]{1,10})(?::(?:[A-Za-z_][A-Za-z0-9_.-]{0,127}|[0-9]{1,10}))?\Z")


class PlanError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise PlanError(message)


def bounded_metadata(value):
    # Bound direct Python callers too, before canonical serialization or schema walking.
    stack, nodes, text_bytes = [(value, 0)], 0, 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        require(nodes <= 1_000_000 and depth <= 32, "plan metadata complexity exceeds bound")
        if isinstance(item, dict):
            require(len(item) <= 100_000, "plan metadata object exceeds bound")
            stack.extend((child, depth + 1) for pair in item.items() for child in pair)
        elif isinstance(item, list):
            require(len(item) <= 100_000, "plan metadata list exceeds bound")
            stack.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            text_bytes += len(item.encode("utf-8", "strict"))
            require(text_bytes <= inputs.MAX_JSON_BYTES, "plan metadata bytes exceed bound")
    raw = inputs.canonical(value)
    require(0 < len(raw) <= inputs.MAX_JSON_BYTES, "plan metadata bytes exceed bound")
    return value


def load_metadata(path: Path):
    """Read one finite regular JSON file without following any path-component symlink."""
    path = Path(path)
    require(path.name != "" and all(part not in {".", ".."} for part in path.parts), "unsafe plan metadata path")
    pieces = path.parts[1:] if path.is_absolute() else path.parts
    require(0 < len(pieces) <= 128, "plan metadata path exceeds bound")
    with ExitStack() as opened:
        parent = os.open(path.anchor if path.is_absolute() else ".", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        opened.callback(os.close, parent)
        for piece in pieces[:-1]:
            parent = os.open(piece, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            opened.callback(os.close, parent)
        descriptor = os.open(pieces[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(descriptor, "rb") as source:
            before = os.fstat(source.fileno())
            require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= inputs.MAX_JSON_BYTES,
                    "bounded regular plan metadata required")
            raw = source.read(inputs.MAX_JSON_BYTES + 1)
            after = os.fstat(source.fileno())
            require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                    "plan metadata changed while reading")
    return bounded_metadata(inputs.decode(raw))


def historical_identity(candidate, receipt):
    """Structural binding only: caller JSON never authenticates its historical origin."""
    if candidate is None:
        return None
    bounded_metadata(candidate)
    require(isinstance(candidate, dict), "historical candidate object required")
    if type(candidate.get("schemaVersion")) is int and candidate["schemaVersion"] != 2:
        return None  # Older/unknown lineage needs a build, never inferred input eligibility.
    require(set(candidate) == CANDIDATE_KEYS and type(candidate["schemaVersion"]) is int
            and candidate["schemaVersion"] == 2 and candidate["kind"] == "warpdrive-image-candidate",
            "complete historical v2 candidate required")
    revision = candidate["revision"]
    require(isinstance(revision, str) and REVISION.fullmatch(revision)
            and candidate["releaseRevision"] == revision and candidate["platform"] == receipt["context"]["platform"],
            "historical source or platform differs")
    require(candidate["deploymentAuthorized"] is False and candidate["compatibility"] == "unassessed"
            and candidate["pendingGates"] == [*PENDING, "independently-qualified-component-reuse"],
            "historical candidate cannot assert release authority")
    require(candidate["inputProvenance"] == {"state": "current-source-inputs-bound",
        "receiptSha256": inputs.content_hash(receipt), "inputPolicySha256": receipt["inputPolicySha256"]},
        "historical candidate input receipt binding differs")
    qualification = candidate["qualification"]
    require(isinstance(qualification, dict) and set(qualification) == {"state", "reportSha256", "checks", "limitations"}
            and qualification["state"] == "image-smoke-passed" and isinstance(qualification["reportSha256"], str)
            and inputs.HASH.fullmatch(qualification["reportSha256"]) and qualification["checks"] == list(SMOKE_CHECKS),
            "historical candidate evidence declaration is incomplete")
    limitations = qualification["limitations"]
    require(isinstance(limitations, list) and 0 < len(limitations) <= 16
            and all(isinstance(item, str) and 0 < len(item) <= 2048 for item in limitations),
            "bounded historical qualification limitations required")
    require(isinstance(candidate["components"], dict) and set(candidate["components"]) == set(COMPONENTS),
            "all historical Core identities required")
    for name in COMPONENTS:
        image = candidate["components"][name]
        require(isinstance(image, dict) and set(image) == IMAGE_KEYS, "exact historical image fields required")
        user = image["runtimeUser"]
        require(isinstance(image["imageId"], str) and IMAGE_ID.fullmatch(image["imageId"])
                and isinstance(user, str) and RUNTIME_USER.fullmatch(user) and user.split(":", 1)[0] not in {"", "root"}
                and not (user.split(":", 1)[0].isdigit() and int(user.split(":", 1)[0]) == 0),
                "immutable historical image ID and nonroot identity required")
        require(image["registryRef"] is None, "v2 planner cannot infer provenance from a registry tag or reference")
        require(image["sourceRevision"] == revision
                and image["inputSha256"] == receipt["components"][name]["componentInputSha256"]
                and image["inputPolicySha256"] == receipt["inputPolicySha256"], "historical component input/source differs")
    return candidate


def _shared_records(receipt):
    records = {item["path"]: item for item in receipt["components"]["web"]["inputs"]}
    return [records[path] for path in sorted(receipt["policy"]["sharedFiles"])]


def create_plan(root: Path, current_receipt: dict, historical_receipt: dict | None = None,
                historical_candidate: dict | None = None, *, expected_revision: str) -> dict:
    require(isinstance(expected_revision, str) and REVISION.fullmatch(expected_revision), "full current Git revision required")
    inputs.validate_receipt(bounded_metadata(current_receipt))
    original = None
    if historical_receipt is not None:
        inputs.validate_receipt(bounded_metadata(historical_receipt))
        original = historical_identity(historical_candidate, historical_receipt)
    else:
        require(historical_candidate is None, "historical identity without its input receipt is not eligible")
    # No caller flag/JSON field can replace fresh graph discovery and exact raw HEAD binding.
    inputs.verify_current(root, current_receipt, expected_revision=expected_revision)
    global_reason = None
    if historical_receipt is None:
        global_reason = "historical-input-receipt-unavailable"
    elif original is None:
        global_reason = "historical-v2-image-identity-unavailable"
    elif current_receipt["context"] != historical_receipt["context"]:
        global_reason = "build-context-changed"
    elif current_receipt["inputPolicySha256"] != historical_receipt["inputPolicySha256"]:
        global_reason = "input-policy-changed"
    elif _shared_records(current_receipt) != _shared_records(historical_receipt):
        global_reason = "shared-inputs-changed"
    components, builds, retained = {}, [], []
    for name in COMPONENTS:
        current = current_receipt["components"][name]
        reason = global_reason
        if reason is None and current != historical_receipt["components"][name]:
            reason = "component-input-or-discovery-metadata-changed"
        decision = "build" if reason is not None else "retain-candidate"
        (builds if decision == "build" else retained).append(name)
        # Copy exact declared original values, never rewrite sourceRevision to the new release.
        image = ({**original["components"][name], "platform": original["platform"]}
                 if original is not None else None)
        components[name] = {"decision": decision,
            "reason": reason or "equal-inputs-only-original-authentication-and-assembly-pending",
            "currentInputSha256": current["componentInputSha256"], "declaredOriginalImage": image}
    # Re-discover after selection too: a concurrent source/graph change invalidates this advice.
    inputs.verify_current(root, current_receipt, expected_revision=expected_revision)
    return {"schemaVersion": 1, "kind": "warpdrive-advisory-core-build-plan", "state": "advisory-only",
        "releaseRevision": expected_revision, "platform": current_receipt["context"]["platform"],
        "currentReceiptSha256": inputs.content_hash(current_receipt),
        "historicalReceiptSha256": inputs.content_hash(historical_receipt) if historical_receipt is not None else None,
        "declaredHistoricalCandidateSha256": inputs.content_hash(original) if original is not None else None,
        "inputPolicySha256": current_receipt["inputPolicySha256"], "components": components,
        "buildComponents": builds, "retainCandidates": retained, "nextBuildRequired": "web" in builds,
        "originalIdentityAuthority": "unverified-declaration-only", "retentionQualification": "not-assessed",
        "deploymentAuthorized": False, "pendingGates": list(PENDING_GATES), "extensionsPending": ["engine", "ingress"]}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--current-receipt", required=True, type=Path)
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--historical-receipt", type=Path)
    parser.add_argument("--historical-candidate", type=Path)
    args = parser.parse_args(argv)
    try:
        current = load_metadata(args.current_receipt)
        historical = load_metadata(args.historical_receipt) if args.historical_receipt is not None else None
        candidate = load_metadata(args.historical_candidate) if args.historical_candidate is not None else None
        result = create_plan(args.root, current, historical, candidate, expected_revision=args.expected_revision)
        print(json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False))
    except (PlanError, inputs.InputError, OSError, ValueError, TypeError, KeyError, UnicodeError,
            RecursionError, subprocess.TimeoutExpired):
        # No raw source paths, provider configuration, arbitrary JSON fields or commands in diagnostics.
        print("Component build plan rejected", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
