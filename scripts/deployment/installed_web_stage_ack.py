"""Observe an already completed functional Web stage under existing native locks.

Invoke from the reviewed, separately authenticated toolkit source. All mutable
state remains under the existing private installation root.
"""

import argparse
from contextlib import contextmanager, ExitStack
from hashlib import sha256
from itertools import combinations
import json
import os
from pathlib import Path
import re
import sys

from component_inputs import decode
from installed_core_lineage import verify_projected_core_predecessor
from installed_docker import InstalledDocker
from installed_web_chain import _directory as private_directory, _generation, _private_bytes, _state
from installed_web_functional_image import verify_received_functional
from installed_web_image import UNTAGGED, LocalDocker, _archive_facts, _inspect
from installed_web_readback_lock import installed_web_readback_locks
from installed_web_stage import read_record
from installed_web_stage_readback import read_stage_acknowledgement
from installed_web_successor import InstalledWebSuccessor
from web_candidate import ARCHIVE, MAX_ARCHIVE_BYTES, _directory, _opened
from web_rollout import _validate
from web_switch import HASH, REVISION, canonical, content_hash, require


PRIVATE = Path("/root/warpdrive-deployment/private")
WATCHED = Path("/root/traefik/dynamic")
SUFFIX = re.compile(r"[a-f0-9]{12}\Z")
FIRST_OPERATION = re.compile(r"web-[a-f0-9]{12}-reapply\Z")


def _directory_under_installation(path):
    require(path != PRIVATE and path.is_relative_to(PRIVATE), "Exact private installed release directory required")
    private_directory(path)
    return path


def _sealed(path, digest):
    require(isinstance(digest, str) and HASH.fullmatch(digest), "Exact installed release receipt SHA-256 required")
    raw = _private_bytes(path, modes=(0o400, 0o600))
    require(sha256(raw).hexdigest() == digest, "Exact installed release receipt digest differs")
    return raw


@contextmanager
def _pinned_archive(directory, release):
    with _directory(directory) as parent, _opened(parent, ARCHIVE, MAX_ARCHIVE_BYTES) as (source, size):
        info = os.fstat(source.fileno())
        require(info.st_uid == os.geteuid() and info.st_mode & 0o7777 in (0o400, 0o600),
                "Exact private functional Web archive required")
        yield _archive_facts(source, size, release["provenance"], release["image"])


def _verify_stage_load(loaded, release, chain, identity, facts):
    active = chain["active"]["provenance"]
    digest = facts["descriptor"]["digest"]
    expected = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
                "sourceRevision": release["revision"], "bundleManifestSha256": release["provenance"]["bundleManifestSha256"],
                "baselineRevision": active["revision"], "baselineManifestSha256": active["manifestSha256"],
                "origin": release["origin"], "archiveSha256": release["provenance"]["archiveSha256"],
                "archiveSizeBytes": release["provenance"]["archiveSizeBytes"], "testedConfigDigest": release["image"]["imageId"],
                "manifestDigest": digest, "daemon": identity, "imageId": digest, "deploymentAuthorized": False}
    inventory_pins = {"beforeInventorySha256", "afterInventorySha256"}
    require(type(loaded) is dict and set(loaded) == set(expected) | inventory_pins
            and canonical({name: loaded[name] for name in expected}) == canonical(expected)
            and all(isinstance(loaded[name], str) and HASH.fullmatch(loaded[name]) for name in inventory_pins),
            "Verified load receipt differs from exact admitted Web artifact and daemon")


def _observe_native_image(native, identity, facts):
    digest = facts["descriptor"]["digest"]
    require(native.identity() == identity and native.inventory().get(digest) in UNTAGGED,
            "Exact native untagged Web image and daemon required")
    _inspect(native, facts)
    require(native.identity() == identity and native.inventory().get(digest) in UNTAGGED,
            "Native Web image or daemon changed during observation")


def run(args):
    core_path, core_sha = args.retained_core, args.retained_core_sha256
    activation_id = getattr(args, "core_activation_operation", None)
    activation_sha = getattr(args, "core_activation_lineage_sha256", None)
    projected_sha = getattr(args, "projected_lineage_sha256", None)
    checksums = (args.lineage_sha256, args.lineage_index_sha256, args.first_accepted_plan_sha256,
                 args.publication_sha256, args.import_sha256, args.loaded_image_sha256)
    require(os.geteuid() == 0 and SUFFIX.fullmatch(args.suffix)
            and REVISION.fullmatch(args.revision) and FIRST_OPERATION.fullmatch(args.first_accepted_operation)
            and all(HASH.fullmatch(pin) for pin in checksums), "Exact root-owned functional Web stage pins required")
    locations = args.operation, args.first, args.original, args.previous
    operation, first, original, previous = map(_directory_under_installation, locations)
    require(operation == PRIVATE / ("functional-web-release-" + args.suffix)
            and all(not left.is_relative_to(right) and not right.is_relative_to(left)
                    for left, right in combinations(locations, 2)), "Independent private operation directories required")
    require((core_path is None and core_sha is None)
            or (core_path == operation / "retained-core.json" and isinstance(core_sha, str) and HASH.fullmatch(core_sha)),
            "Exact paired retained Core authority required")
    require((activation_id is None and activation_sha is None and projected_sha is None)
            or (core_path is not None and isinstance(activation_id, str) and all(isinstance(pin, str) and HASH.fullmatch(pin)
                    for pin in (activation_sha, projected_sha))), "Exact projected Core lineage pins required")
    state = _directory_under_installation(first / "rollout")
    with installed_web_readback_locks(original, state), ExitStack() as held:
        lineage = _directory_under_installation(previous / "lineage")
        chain_raw = _sealed(lineage / "chain.json", args.lineage_sha256)
        index_raw = _sealed(lineage / "lineage.json", args.lineage_index_sha256)
        historical_chain, index = decode(chain_raw), decode(index_raw)
        chain = historical_chain
        accepted_raw = _sealed(lineage / "accepted-plan.json", historical_chain["acceptedPlanSha256"])
        accepted = decode(accepted_raw)
        _validate(accepted)
        require(index["acceptedOperationId"] == chain["acceptedOperationId"] == accepted["operationId"]
                and index["acceptedPlanSha256"] == chain["acceptedPlanSha256"]
                and ((index.get("kind") == "warpdrive-repeat-installed-web-lineage" and "chainSha256" not in index)
                     or index.get("chainSha256") == args.lineage_sha256) and accepted["targetKey"] == chain["targetKey"]
                and chain["backendFingerprint"] == index["backendFingerprint"] == accepted["backendFingerprint"]
                and content_hash(chain) == args.lineage_sha256, "Exact accepted functional predecessor required")
        generation_pins = {"active": index["activeSha256"], "previous": index["previousSha256"]}

        def check_generations():
            for name, side in (("active", "after"), ("previous", "before")):
                observed = _generation(lineage / f"{name}.json", generation_pins[name], accepted, side)
                require(observed == historical_chain[name], "Exact accepted generation receipt required")

        check_generations()
        staged_chain = operation / "installed-chain.json"
        current_lineage_sha = args.lineage_sha256
        if activation_id is not None:
            chain = read_record(staged_chain)
            current_lineage_sha = projected_sha
            require(content_hash(chain) == current_lineage_sha, "Exact staged projected Core chain required")

        def check_projection():
            if activation_id is not None:
                projected = verify_projected_core_predecessor(state, chain=chain, activation_operation_id=activation_id,
                    expected_activation_lineage_sha256=activation_sha)
                require(projected.original_chain_sha256 == args.lineage_sha256 and projected.core_authority_sha256 == core_sha,
                        "Projected Core chain differs from the pinned historical generation receipts")

        check_projection()
        original_binding = first / "bound-release.json"
        original_journal = state / "web-rollouts" / (args.first_accepted_operation + ".json")
        binding, initial = read_record(original_binding), _state(original_journal)
        require(read_record(staged_chain) == chain and initial["state"] == "accepted"
                and initial["plan"]["operationId"] == args.first_accepted_operation
                and content_hash(initial["plan"]) == args.first_accepted_plan_sha256
                and content_hash(binding) == initial["plan"]["qualificationSha256"],
                "Exact staged chain and protected original installation authority required")
        core_raw = _sealed(core_path, core_sha) if core_path is not None else None
        retained_core = decode(core_raw) if core_raw is not None else None
        require(core_raw is None or canonical(retained_core) == core_raw, "Canonical retained Core authority required")

        native = LocalDocker(containerd_root=Path("/var/lib/containerd"))
        identity = native.identity()
        require(identity == binding["daemon"], "Installed Docker daemon differs")
        docker = InstalledDocker(expected_socket=(identity["socketDevice"], identity["socketInode"]))
        imported = _directory_under_installation(operation / "artifact")
        publication_path = imported / "publication-receipt.json"
        import_path = imported / "import-receipt.json"
        loaded_path = operation / "loaded-image.json"
        publication = _sealed(publication_path, args.publication_sha256)
        imported_raw = _sealed(import_path, args.import_sha256)
        loaded_raw = _sealed(loaded_path, args.loaded_image_sha256)
        loaded = decode(loaded_raw)
        bundle = imported / "bundle"
        release = verify_received_functional(bundle, publication, expected_publication_sha256=args.publication_sha256,
            expected_lineage_sha256=current_lineage_sha, expected_revision=args.revision,
            installed_chain=chain, import_record=decode(imported_raw))
        facts = held.enter_context(_pinned_archive(bundle, release))
        _verify_stage_load(loaded, release, chain, identity, facts)

        def check_authority():
            for path, pin, raw in ((lineage / "chain.json", args.lineage_sha256, chain_raw),
                    (lineage / "lineage.json", args.lineage_index_sha256, index_raw),
                    (lineage / "accepted-plan.json", historical_chain["acceptedPlanSha256"], accepted_raw),
                    (publication_path, args.publication_sha256, publication), (import_path, args.import_sha256, imported_raw),
                    (loaded_path, args.loaded_image_sha256, loaded_raw)):
                require(_sealed(path, pin) == raw, "Functional Web stage authority changed during readback")
            require(read_record(staged_chain) == chain and read_record(original_binding) == binding
                    and _state(original_journal) == initial, "Protected installation authority changed during readback")
            if core_path is not None:
                require(_sealed(core_path, core_sha) == core_raw, "Retained Core authority changed during readback")
            check_generations()
            check_projection()
            _observe_native_image(native, identity, facts)

        check_authority()
        install = InstalledWebSuccessor(docker, first=first, operation=operation, binding=binding,
            expected_binding_sha256=initial["plan"]["qualificationSha256"], chain=chain, chain_sha256=current_lineage_sha,
            watched=WATCHED, preimage=canonical(read_record(operation / "accepted-caddy-preimage.json")),
            retained_core=retained_core, expected_retained_core_sha256=core_sha, core_activation_operation_id=activation_id,
            expected_core_activation_lineage_sha256=activation_sha)
        result = read_stage_acknowledgement(install, loaded=loaded, alias="warpdrive-web-" + args.suffix,
                                            revision=args.revision, release=release)
        check_authority()
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage-ack",))
    for name in ("operation", "first", "original", "previous"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("suffix", "revision", "publication-sha256", "import-sha256", "lineage-sha256", "lineage-index-sha256",
                 "first-accepted-operation", "first-accepted-plan-sha256", "loaded-image-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--retained-core", type=Path)
    parser.add_argument("--retained-core-sha256")
    parser.add_argument("--core-activation-operation")
    parser.add_argument("--core-activation-lineage-sha256")
    parser.add_argument("--projected-lineage-sha256")
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), sort_keys=True))
        return 0
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, AttributeError) as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
