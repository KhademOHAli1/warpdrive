"""Bind final-image smoke evidence to the exact retained images; never authorize deployment."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

from component_inputs import InputError, content_hash as input_hash, load_receipt, validate_receipt, verify_current

COMPONENTS = ("web", "worker", "realtime", "migrator")
HEADLESS_VERSION = 4
HEADLESS_COMPONENTS = (*COMPONENTS, "core-api")
HEADLESS_SMOKE_KIND = "warpdrive-headless-final-image-smoke"
CORE_INPUT_POLICY = {"recipe": "deploy/images/Core.Dockerfile", "context": "exact-tracked-source"}
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
HEADLESS_SMOKE_CHECKS = (
    *SMOKE_CHECKS[:4],
    "private-core-readiness-without-web",
    "web-local-health-and-identity",
    "web-login-assets-and-stability",
    "native-session-ssr-and-durable-write-through-web",
    *SMOKE_CHECKS[5:],
    "independent-core-drain",
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


def components_for_version(version):
    require(type(version) is int and version in {1, 2, 3, HEADLESS_VERSION}, "unsupported bundle/candidate version")
    return HEADLESS_COMPONENTS if version == HEADLESS_VERSION else COMPONENTS


def core_input_facts(receipt, revision):
    return {"sourceRevision": revision, "inputPolicySha256": input_hash(CORE_INPUT_POLICY),
            "inputSha256": receipt["web"]["gitInventorySha256"]}


def create_candidate(revision: str, report: dict, report_digest: str, inspections: dict,
                     *, input_receipt: dict | None = None) -> dict:
    sdk = isinstance(input_receipt, dict) and input_receipt.get("kind") == "warpdrive-web-sdk-full-inputs"
    headless = isinstance(report, dict) and report.get("kind") == HEADLESS_SMOKE_KIND
    roles = HEADLESS_COMPONENTS if headless else COMPONENTS
    require(not headless or sdk, "headless qualification requires exact SDK Web and tracked source inputs")
    require(bool(REVISION.fullmatch(revision)), "full lowercase source revision required")
    require(isinstance(report, dict) and type(report.get("schemaVersion")) is int
            and report["schemaVersion"] == 1, "invalid smoke report")
    require(not headless or report.get("platform") == "linux/amd64",
            "headless publication requires completed native linux/amd64 smoke")
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
    require(tuple(names) == (HEADLESS_SMOKE_CHECKS if headless else SMOKE_CHECKS),
            "the complete versioned image smoke check sequence is required")
    require(isinstance(report.get("limitations"), list) and report["limitations"],
            "scope limitations must remain explicit")
    images = report.get("images")
    require(isinstance(images, dict) and set(images) == set(COMPONENTS), "all smoke image identities required")
    require(set(inspections) == set(roles), "all image inspections required")
    if headless:
        images = {**images, "core-api": report.get("coreImage")}
    if input_receipt is not None and not sdk:
        try:
            validate_receipt(input_receipt)
        except (InputError, TypeError, KeyError) as error:
            raise CandidateError("component input receipt is not valid") from error
    components = {}
    for name in roles:
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
        if name == "core-api":
            require(labels.get("org.opencontainers.image.title") == "Warpdrive Core API"
                    and config.get("Cmd") == ["bun", "--no-env-file", "dist/core-api.mjs"]
                    and config.get("WorkingDir") == "/app" and config.get("ExposedPorts") == {"3010/tcp": {}}
                    and not config.get("Volumes"), "Core inspection differs from the standalone runtime profile")
        if input_receipt is not None and not sdk:
            components[name].update({"sourceRevision": revision,
                                     "inputSha256": input_receipt["components"][name]["componentInputSha256"],
                                     "inputPolicySha256": input_receipt["inputPolicySha256"]})
    if headless:
        require(len({component["imageId"] for component in components.values()}) == len(roles),
                "headless component images must have distinct IDs")
    result = {
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
    if sdk:
        from web_sdk_full_receipt import bind_web_sdk_full_candidate

        bind_web_sdk_full_candidate(result, revision, inspections, input_receipt=input_receipt)
        if headless:
            # Core runs from the same staged exact Git inventory used by Web.
            # The inventory is full-source provenance, with reuse qualified separately.
            core = core_input_facts(input_receipt, revision)
            components["core-api"].update(core)
            result["inputProvenance"]["coreInputPolicySha256"] = core["inputPolicySha256"]
            result["schemaVersion"] = HEADLESS_VERSION
    elif input_receipt is not None:
        result.update({"schemaVersion": 2, "releaseRevision": revision,
                       "inputProvenance": {"state": "current-source-inputs-bound",
                                           "receiptSha256": input_hash(input_receipt),
                                           "inputPolicySha256": input_receipt["inputPolicySha256"]}})
        # This first v2 producer binds fresh builds. Old images must not be relabeled
        # as current: retained-component origin and mixed-assembly admission are separate.
        result["pendingGates"].append("independently-qualified-component-reuse")
    return result


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
    candidate.add_argument("--inputs", type=Path)
    candidate.add_argument("--web-context", type=Path)
    capacity = commands.add_parser("capacity")
    for key in ("available", "candidate", "migration", "temporary", "reserve"):
        capacity.add_argument(f"--{key}-bytes", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "record":
            report = load(args.report)
            roles = HEADLESS_COMPONENTS if isinstance(report, dict) and report.get("kind") == HEADLESS_SMOKE_KIND else COMPONENTS
            inspections = {}
            for name in roles:
                rows = load(args.inspections / f"{name}.json")
                require(isinstance(rows, list) and len(rows) == 1, f"{name}: expected exactly one inspected image")
                inspections[name] = rows[0]
            receipt = load(args.inputs) if args.inputs else None
            root = Path(__file__).resolve().parents[2]
            sdk = isinstance(receipt, dict) and receipt.get("kind") == "warpdrive-web-sdk-full-inputs"
            require(sdk == (args.web_context is not None), "SDK receipt and exact staged Web context must be supplied together")
            if sdk:
                from web_sdk_full_receipt import verify_current_web_sdk_full_receipt

                verify_current_web_sdk_full_receipt(root, receipt, expected_revision=args.revision, web_context=args.web_context)
            elif args.inputs:
                receipt = load_receipt(args.inputs)
                verify_current(root, receipt, expected_revision=args.revision)
            result = create_candidate(args.revision, report, sha256(args.report), inspections,
                                      input_receipt=receipt)
            if receipt is not None:
                inputs_path = args.output.parent / "component-inputs.json"
                require(inputs_path.resolve() == args.inputs.resolve(), "input receipt must be retained beside candidate")
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
