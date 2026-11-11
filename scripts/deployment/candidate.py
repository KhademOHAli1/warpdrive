"""Bind final-image smoke evidence to the exact retained images; never authorize deployment."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

COMPONENTS = ("web", "worker", "realtime", "migrator")
REVISION = re.compile(r"[0-9a-f]{40}")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}")
SMOKE_CHECKS = (
    "final-image-identities",
    "runtime-packaging-and-nonroot",
    "disposable-isolation",
    "canonical-fresh-and-repeat-migration",
    "web-startup-http-assets-and-stability",
    "realtime-unauthenticated-rejection",
    "worker-durable-job-across-restart",
)
PENDING = [
    "exact-main-source-and-security-qualification",
    "registry-digests-and-provenance",
    "supported-populated-upgrade-and-compatibility",
    "authenticated-browser-and-realtime-journeys",
    "staging-promotion-and-failure-rehearsal",
    "installation-and-recovery-acceptance",
]


class CandidateError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CandidateError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(path: Path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"duplicate JSON property: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique)


def create_candidate(revision: str, report: dict, report_digest: str, inspections: dict) -> dict:
    require(bool(REVISION.fullmatch(revision)), "full lowercase source revision required")
    require(isinstance(report, dict) and type(report.get("schemaVersion")) is int
            and report["schemaVersion"] == 1, "invalid smoke report")
    require(isinstance(report_digest, str) and bool(re.fullmatch(r"[0-9a-f]{64}", report_digest)),
            "valid smoke report hash required")
    require(report.get("success") is True, "image smoke did not succeed")
    require(report.get("failure") is None, "smoke retains a failure")
    require(report.get("expectedRevision") == revision, "smoke revision does not match candidate")
    require(isinstance(report.get("cleanup"), dict) and report["cleanup"].get("success") is True,
            "smoke resources were not reclaimed")
    require(report["cleanup"].get("errors") == [], "smoke cleanup evidence is incomplete")
    checks = report.get("checks")
    require(isinstance(checks, list) and len(checks) > 0, "executed checks are missing")
    require(all(isinstance(c, dict) and c.get("status") == "passed"
                and isinstance(c.get("name"), str) and c["name"] for c in checks),
            "smoke has missing or unsuccessful checks")
    names = [c["name"] for c in checks]
    require(tuple(names) == SMOKE_CHECKS, "the complete versioned image smoke check sequence is required")
    require(isinstance(report.get("limitations"), list) and report["limitations"],
            "scope limitations must remain explicit")
    images = report.get("images")
    require(isinstance(images, dict) and set(images) == set(COMPONENTS), "all Core images required")
    require(set(inspections) == set(COMPONENTS), "all image inspections required")
    components = {}
    for name in COMPONENTS:
        image = inspections[name]
        require(isinstance(image, dict), f"{name}: image inspection missing")
        identifier = image.get("Id", "")
        require(isinstance(identifier, str) and bool(IMAGE_ID.fullmatch(identifier)), f"{name}: invalid image ID")
        require(image.get("Os") == "linux" and image.get("Architecture") == "amd64",
                f"{name}: expected native linux/amd64 artifact")
        config = image.get("Config") or {}
        labels = config.get("Labels") or {}
        require(labels.get("org.opencontainers.image.revision") == revision, f"{name}: wrong source revision")
        user = config.get("User")
        require(isinstance(user, str) and user.split(":", 1)[0] not in ("", "root")
                and not (user.split(":", 1)[0].isdigit() and int(user.split(":", 1)[0]) == 0),
                f"{name}: non-root runtime required")
        observed = images[name]
        require(isinstance(observed, dict) and observed.get("id") == identifier
                and observed.get("revision") == revision and observed.get("user") == config.get("User"),
                f"{name}: inspected artifact differs from smoke artifact")
        components[name] = {"imageId": identifier, "runtimeUser": config["User"], "registryRef": None}
    return {
        "schemaVersion": 1,
        "kind": "warpdrive-image-candidate",
        "revision": revision,
        "platform": "linux/amd64",
        "components": components,
        "qualification": {"state": "image-smoke-passed", "reportSha256": report_digest,
                          "checks": names, "limitations": report["limitations"]},
        "compatibility": "unassessed",
        "deploymentAuthorized": False,
        "pendingGates": list(PENDING),
    }


def admit_capacity(*, available: int, candidate: int, migration: int, temporary: int, reserve: int) -> dict:
    """Existing/retained images are already charged against available filesystem bytes."""
    values = (available, candidate, migration, temporary, reserve)
    require(all(type(value) is int and value >= 0 for value in values), "capacity inputs must be nonnegative byte counts")
    require(candidate > 0 and reserve > 0, "candidate peak and operating reserve must be explicit and positive")
    required = candidate + migration + temporary + reserve
    require(available >= required, f"insufficient disk headroom: {available} available, {required} required")
    return {"admitted": True, "availableBytes": available, "requiredBytes": required,
            "remainingBytes": available - required,
            "scope": "disk admission only; memory, CPU, connections and runtime health require separate gates"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    candidate = commands.add_parser("record")
    candidate.add_argument("--revision", required=True)
    candidate.add_argument("--report", required=True, type=Path)
    candidate.add_argument("--inspections", required=True, type=Path)
    candidate.add_argument("--output", required=True, type=Path)
    capacity = commands.add_parser("capacity")
    for key in ("available", "candidate", "migration", "temporary", "reserve"):
        capacity.add_argument(f"--{key}-bytes", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "record":
            inspections = {}
            for name in COMPONENTS:
                rows = load(args.inspections / f"{name}.json")
                require(isinstance(rows, list) and len(rows) == 1, f"{name}: expected exactly one inspected image")
                inspections[name] = rows[0]
            result = create_candidate(args.revision, load(args.report), sha256(args.report), inspections)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x") as output:
                output.write(json.dumps(result, indent=2) + "\n")
        else:
            result = admit_capacity(**{key: getattr(args, f"{key}_bytes") for key in
                                      ("available", "candidate", "migration", "temporary", "reserve")})
            print(json.dumps(result))
    except (CandidateError, OSError, ValueError, TypeError) as error:
        print(f"candidate rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
