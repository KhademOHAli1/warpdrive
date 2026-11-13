"""Activate an independently admitted Core on the existing installed Web relay."""

import argparse
from copy import deepcopy
from itertools import combinations
import json
import os
from pathlib import Path
import sys

from component_inputs import decode
from installed_core_activation import _initial_core_transition, reconcile_initial_core_route, reverse_initial_core_route
from installed_core_lineage_seal import accept_initial_core_lineage, initial_core_lineage_acceptance, seal_initial_core_lineage
from installed_docker import InstalledDocker
from installed_web_functional_operator import _historical, _original
from installed_web_image import LocalDocker
from installed_web_operator import HOST, network_peer, read_direct_web
from installed_web_probe import read_public_core_route
from installed_web_relay import read_autosave
from installed_web_rollout_readback import read_public_web_health
from installed_web_stage_ack import FIRST_OPERATION, WATCHED, _directory_under_installation, _sealed
from installed_web_successor import InstalledWebSuccessor
from web_switch import HASH, SwitchUnknown, canonical, content_hash, require


INSTALLATION_UID = 0


def run(args):
    required = (args.lineage_sha256, args.lineage_index_sha256, args.first_accepted_plan_sha256,
                args.web_preimage_sha256, args.retained_core_sha256, args.core_activation_sha256)
    acceptance = args.projection_sha256, args.acceptance_sha256
    require(os.geteuid() == INSTALLATION_UID and FIRST_OPERATION.fullmatch(args.first_accepted_operation)
            and all(isinstance(value, str) and HASH.fullmatch(value) for value in required)
            and ((args.action in ("activate", "reverse", "seal") and acceptance == (None, None))
                 or (args.action == "accept" and all(isinstance(value, str) and HASH.fullmatch(value) for value in acceptance))),
            "Exact independent installed Core operation pins required")
    original, first, previous, operation = map(_directory_under_installation, (args.original, args.first, args.previous, args.operation))
    paths = (original, first, previous, operation)
    require(all(not left.is_relative_to(right) and not right.is_relative_to(left) for left, right in combinations(paths, 2)),
            "Distinct installed Core operation directories required")
    state = _directory_under_installation(first / "rollout")
    lineage = _directory_under_installation(previous / "lineage")
    web_preimage = operation / "accepted-web-preimage.json"
    profile_path = operation / "retained-core.json"
    raw = _sealed(web_preimage, args.web_preimage_sha256)
    profile = decode(_sealed(profile_path, args.retained_core_sha256))
    require(content_hash(profile) == args.retained_core_sha256, "Canonical retained Core authority required")
    chain, predecessor = _historical(lineage, args.lineage_sha256, args.lineage_index_sha256)
    original_binding, binding_sha = _original(args, first, state)
    ingress = original_binding["inputs"]
    route_args = {"host": HOST, "traefik_ip": ingress["edgeIP"], "relay_alias": ingress["successorRelayAlias"],
                  "core_alias": profile["corePin"]["ingress"]["alias"]}
    backend = original_binding["backend"]
    require(chain["backendFingerprint"] == backend["backendFingerprint"], "Exact original Web-only backend required")
    projected = deepcopy(chain)
    projected["backendFingerprint"] = content_hash({"schemaSha256": backend["schemaSha256"],
        "processes": {**backend["processes"], "core": profile["coreWitness"]}})
    transition = {"expected_chain_sha256": args.lineage_sha256, "installed_bytes": raw,
                  "core_backend_fingerprint": projected["backendFingerprint"], "core_authority_sha256": args.retained_core_sha256,
                  **route_args}
    before, after, binding, activation_id = _initial_core_transition(predecessor, chain, **transition)
    projected["active"]["slot"]["route"]["fingerprint"] = binding["newRouteSha256"]
    activation_sha = content_hash(binding)
    require(activation_sha == args.core_activation_sha256, "Independent Core activation plan digest differs")
    native = LocalDocker(containerd_root=Path("/var/lib/containerd"))
    identity = native.identity()
    require(identity == original_binding["daemon"], "Installed Docker daemon differs")
    docker = InstalledDocker(expected_socket=(identity["socketDevice"], identity["socketInode"]))
    reverse = args.action == "reverse"
    retained_chain, relay_route = (chain, before) if reverse else (projected, after)
    install = InstalledWebSuccessor(docker, first=first, operation=operation, binding=original_binding,
        expected_binding_sha256=binding_sha, chain=retained_chain, chain_sha256=content_hash(retained_chain), watched=WATCHED,
        preimage=canonical(relay_route), retained_core=None if reverse else profile,
        expected_retained_core_sha256=None if reverse else args.retained_core_sha256)

    def verify_authority(selected):
        return (selected == binding and native.identity() == identity
                and _original(args, first, state) == (original_binding, binding_sha)
                and _historical(lineage, args.lineage_sha256, args.lineage_index_sha256) == (chain, predecessor)
                and _sealed(web_preimage, args.web_preimage_sha256) == raw
                and _sealed(profile_path, args.retained_core_sha256) == canonical(profile))

    def observe_core():
        return install._retained()[0]["backendFingerprint"]

    def retained_web_ready():
        for side in ("active", "previous"):
            runtime = chain[side]["slot"]["runtime"]
            row = docker.inspect(runtime["runtimeId"])
            address = network_peer(docker, install.network, row, chain[side]["alias"])
            if not read_direct_web(address, runtime["sourceRevision"], ingress["version"]):
                return False
        return True

    def observe_public(document, core_active):
        if document != (after if core_active else before) or not retained_web_ready():
            return False
        return (read_public_web_health(install, chain["active"]["slot"]["runtime"]["sourceRevision"])
                and read_public_core_route(install.web, active=core_active))

    observer = {"admin": install.admin, "read_durable_config": lambda: read_autosave(install.relay_dir),
                "verify_authority": verify_authority, "observe_public": observe_public}
    if reverse:
        def observe_original_web():
            observed = install._retained()[0]["backendFingerprint"]
            require(retained_web_ready(), "Both original Web generations must be healthy before reversing Core")
            return observed

        return reverse_initial_core_route(original, state, predecessor=predecessor, chain=chain,
            observe_original_web=observe_original_web, **transition, **observer)
    observer["observe_core"] = observe_core
    if args.action == "activate":
        return reconcile_initial_core_route(original, state, predecessor=predecessor, chain=chain,
            **transition, **observer)
    if args.action == "seal":
        seal = seal_initial_core_lineage(original, state, accepted_plan=predecessor, expected_plan_sha256=chain["acceptedPlanSha256"],
            accepted_chain=chain, expected_chain_sha256=args.lineage_sha256, activation_binding=binding,
            expected_activation_operation_id=activation_id, expected_activation_plan_sha256=activation_sha,
            expected_core_authority_sha256=args.retained_core_sha256, expected_core_backend_fingerprint=projected["backendFingerprint"],
            **observer)
        return {"state": "projected", "activationOperationId": activation_id, "projectionSha256": content_hash(seal),
                "acceptanceSha256": content_hash(initial_core_lineage_acceptance(seal, binding)),
                "projectedChainSha256": content_hash(projected)}
    return accept_initial_core_lineage(original, state, activation_operation_id=activation_id,
        expected_projection_seal_sha256=args.projection_sha256, expected_activation_lineage_sha256=args.acceptance_sha256,
        binding=binding, **observer)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("activate", "reverse", "seal", "accept"))
    for name in ("original", "first", "previous", "operation"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("lineage-sha256", "lineage-index-sha256", "first-accepted-operation", "first-accepted-plan-sha256",
                 "web-preimage-sha256", "retained-core-sha256", "core-activation-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--projection-sha256")
    parser.add_argument("--acceptance-sha256")
    os.umask(0o077)
    try:
        print(json.dumps(run(parser.parse_args(argv)), sort_keys=True))
    except SwitchUnknown as error:
        print(json.dumps({"state": "unresolved", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, AttributeError) as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
