"""Run an independently admitted functional Web release under the installed locks."""

import argparse
from contextlib import ExitStack, contextmanager
from itertools import combinations
import json
import os
from pathlib import Path
import re
import sys
from tarfile import TarError

from component_inputs import decode
from installed_core_lineage import verify_projected_core_predecessor
from installed_docker import InstalledDocker
from installed_web_chain import _admit_journals, _generation, _state
from installed_web_functional_image import load_installed_functional_image, verify_received_functional
from installed_web_functional_lineage import functional_installed_observer, seal_functional_installed_web_lineage
from installed_web_image import JOURNAL, LocalDocker, WebImageUnknown, _archive_facts, _journal_read, _state_directory
from installed_web_readback_lock import _existing_lock
from installed_web_relay import read_autosave
from installed_web_seal_readback import _verify_accepted_rollout, read_seal_acknowledgement
from installed_web_stage import read_record, write_record
from installed_web_stage_ack import (
    FIRST_OPERATION, PRIVATE, SUFFIX, WATCHED, _directory_under_installation, _observe_native_image,
    _sealed, _verify_stage_load,
)
from installed_web_successor import InstalledWebSuccessor
from traefik_web_handoff_state import HandoffHeld
from web_candidate import ARCHIVE, MAX_ARCHIVE_BYTES, _directory, _identity, _opened
from web_rollout import STATES, _record, _validate
from web_switch import HASH, NAME, REVISION, SwitchUnknown, _fsync, canonical, content_hash, require


_ACTIVATION_ID = re.compile(r"core-activation-[a-f0-9]{40}\Z")
_INDEX_KEYS = {"schemaVersion", "kind", "targetKey", "acceptedOperationId", "acceptedPlanSha256",
               "predecessorChainSha256", "backendFingerprint", "liveConfigSha256", "activeSha256",
               "previousSha256"}
_INDEX_EXTRAS = {"warpdrive-repeat-installed-web-lineage": set(),
                 "warpdrive-functional-installed-web-lineage": {"chainSha256"}}
_PHASES = ("promote", "rollback", "reapply")
_ACTIONS = ("stage", "observe", *_PHASES, "recover", "recover-reapply", "reconcile-failed-stamps", "seal")
_INSTALLATION_UID = 0


def _digest(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None


def _validate_args(args):
    hashes = (args.lineage_sha256, args.lineage_index_sha256, args.first_accepted_plan_sha256,
              args.publication_sha256, args.import_sha256)
    require(os.geteuid() == _INSTALLATION_UID and args.action in _ACTIONS and SUFFIX.fullmatch(args.suffix)
            and REVISION.fullmatch(args.revision) and FIRST_OPERATION.fullmatch(args.first_accepted_operation)
            and all(_digest(pin) for pin in hashes), "Exact root-owned functional Web release pins required")
    locations = tuple(map(_directory_under_installation, (args.operation, args.first, args.original, args.previous)))
    operation, first, original, previous = locations
    require(operation == PRIVATE / ("functional-web-release-" + args.suffix)
            and all(not left.is_relative_to(right) and not right.is_relative_to(left)
                    for left, right in combinations(locations, 2)), "Independent private operation directories required")
    require((args.retained_core is None and args.retained_core_sha256 is None)
            or (args.retained_core == operation / "retained-core.json" and _digest(args.retained_core_sha256)),
            "Exact paired retained Core authority required")
    activation = args.core_activation_operation, args.core_activation_lineage_sha256, args.projected_lineage_sha256
    require(activation == (None, None, None) or (args.retained_core is not None and isinstance(activation[0], str)
            and _ACTIVATION_ID.fullmatch(activation[0]) and all(_digest(pin) for pin in activation[1:])),
            "Exact projected Core lineage pins required")
    require((args.action == "seal" and _digest(args.accepted_plan_sha256))
            or (args.action != "seal" and args.accepted_plan_sha256 is None), "Independent final plan pin required for sealing")
    return operation, first, original, previous


def _historical(lineage, chain_sha, index_sha):
    chain_raw = _sealed(lineage / "chain.json", chain_sha)
    index_raw = _sealed(lineage / "lineage.json", index_sha)
    chain, index = decode(chain_raw), decode(index_raw)
    require(type(chain) is dict and set(chain) == {"targetKey", "acceptedOperationId", "acceptedPlanSha256", "backendFingerprint",
                                                   "active", "previous"}, "Exact accepted functional Web chain required")
    accepted_raw = _sealed(lineage / "accepted-plan.json", chain["acceptedPlanSha256"])
    accepted = decode(accepted_raw)
    _validate(accepted)
    require(type(index) is dict and isinstance(index.get("kind"), str) and index["kind"] in _INDEX_EXTRAS
            and set(index) == _INDEX_KEYS | _INDEX_EXTRAS[index["kind"]] and type(index["schemaVersion"]) is int
            and index["schemaVersion"] == 1
            and index["acceptedOperationId"] == chain["acceptedOperationId"] == accepted["operationId"]
            and index["acceptedPlanSha256"] == chain["acceptedPlanSha256"]
            and index["targetKey"] == accepted["targetKey"] == chain["targetKey"]
            and index["backendFingerprint"] == chain["backendFingerprint"] == accepted["backendFingerprint"]
            and index["liveConfigSha256"] == accepted["after"]["route"]["fingerprint"]
            and _digest(index["predecessorChainSha256"]) and index.get("chainSha256", chain_sha) == chain_sha
            and chain_raw == canonical(chain) and accepted_raw == canonical(accepted)
            and index_raw == canonical(index) + b"\n", "Exact accepted functional predecessor and index required")
    for name, side in (("active", "after"), ("previous", "before")):
        require(_generation(lineage / f"{name}.json", index[name + "Sha256"], accepted, side) == chain[name],
                "Exact historical Web generation receipt required")
    active, previous = chain["active"], chain["previous"]
    require(active["alias"] != previous["alias"] and all(active["provenance"][key] != previous["provenance"][key]
            for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256")),
            "Historical Web generations share an alias or artifact")
    return chain, accepted


def _admitted_chain(args, state, lineage):
    historical, plan = _historical(lineage, args.lineage_sha256, args.lineage_index_sha256)
    require(_state(state / "web-rollouts" / (plan["operationId"] + ".json")) == {"plan": plan, "state": "accepted"},
            "Historical Web generation was never accepted")
    if args.core_activation_operation is None:
        return historical, args.lineage_sha256, _record(plan, plan["after"]), plan
    seal = _state(state / (args.core_activation_operation + "-lineage-projection.json"))
    chain = seal["projectedChain"]
    require(content_hash(chain) == args.projected_lineage_sha256, "Independent projected Web lineage pin differs")
    projection = verify_projected_core_predecessor(state, chain=chain, activation_operation_id=args.core_activation_operation,
        expected_activation_lineage_sha256=args.core_activation_lineage_sha256)
    require(projection.original_chain_sha256 == args.lineage_sha256 and projection.chain == chain
            and projection.core_authority_sha256 == args.retained_core_sha256,
            "Core activation differs from the historical Web lineage or admitted Core authority")
    return chain, args.projected_lineage_sha256, projection.accepted_pointer, plan


def _original(args, first, state):
    binding = read_record(first / "bound-release.json")
    journal = _state(state / "web-rollouts" / (args.first_accepted_operation + ".json"))
    plan = journal["plan"]
    _validate(plan)
    require(journal == {"plan": plan, "state": "accepted"} and plan["operationId"] == args.first_accepted_operation
            and content_hash(plan) == args.first_accepted_plan_sha256 and content_hash(binding) == plan["qualificationSha256"],
            "Original protected installation authority differs")
    return binding, plan["qualificationSha256"]


def _retain(path, value):
    if not os.path.lexists(path):
        write_record(path, value)
    require(read_record(path) == value, "Protected stage receipt differs")


def _target_lock(state):
    return _existing_lock(state / "target.lock", (0o600,))


@contextmanager
def _held_archive(directory):
    with _directory(directory) as parent, _opened(parent, ARCHIVE, MAX_ARCHIVE_BYTES) as (source, size):
        parent_identity = _identity(os.fstat(parent))
        info = os.fstat(source.fileno())
        require(info.st_uid == os.geteuid() and info.st_mode & 0o7777 in (0o400, 0o600),
                "Exact private functional Web archive required")
        archive_identity = _identity(info)

        def check():
            require(parent_identity == _identity(os.fstat(parent)) == _identity(directory.lstat()),
                    "Functional Web bundle directory changed during operation")
            named = os.stat(ARCHIVE, dir_fd=parent, follow_symlinks=False)
            require(archive_identity == _identity(os.fstat(source.fileno())) == _identity(named),
                    "Functional Web archive changed during operation")

        check()
        yield source, size, check


def _verify_load_journal(image_state, loaded):
    keys = ("sourceRevision", "bundleManifestSha256", "baselineRevision", "baselineManifestSha256", "origin",
            "archiveSha256", "archiveSizeBytes", "testedConfigDigest", "manifestDigest", "daemon")
    with _state_directory(image_state) as directory:
        journal = _journal_read(directory, {key: loaded[key] for key in keys})
        # A reconciled lost acknowledgement can retain an intent journal. Its
        # independently re-read image and loaded receipt remain mandatory.
        require(content_hash(journal["before"]) == loaded["beforeInventorySha256"],
                "Native Web load receipt differs from its exact load journal")


def _observe(install, controller):
    """Read only exact route documents, pointer, and this release's journal states."""
    state = install.state
    with _target_lock(state):
        plans = {phase: controller.plan(phase) for phase in _PHASES}
        require(controller.verify_predecessor(), "Functional Web predecessor changed")
        slots = {content_hash(slot): slot for plan in plans.values() for slot in (plan["before"], plan["after"])}
        pointers = [_record(plans["promote"], slot) for slot in slots.values()]
        current = _state(state / "accepted-web-generation.json")
        require(current in pointers, "Accepted Web pointer is outside the exact qualified generation slots")
        live, etag = install.admin.config()
        persisted = read_autosave(install.relay_dir)
        require(live == persisted, "Live and persisted functional Web routes differ")
        fingerprint = content_hash(live)
        require(fingerprint in {slot["route"]["fingerprint"] for slot in slots.values()},
                "Functional installed route is outside the qualified configurations")
        journals = {}
        own_ids = {plan["operationId"] for plan in plans.values()}
        final = plans["reapply"]
        recovery_id = final["operationId"] + "-route"
        for index, path in enumerate((state / "web-rollouts").iterdir()):
            require(index < 1000 and path.suffix == ".json" and NAME.fullmatch(path.stem),
                    "Unexpected functional Web journal inventory")
            if path.stem == recovery_id:
                saved = _state(path)
                recovery = {"schemaVersion": 1, "kind": "warpdrive-installed-web-route-reconciliation", "operationId": recovery_id,
                            "sourcePlanSha256": content_hash(final), "before": _record(final, final["before"]),
                            "after": _record(final, plans["promote"]["before"])}
                require(saved in ({**recovery, "state": "switch-intent"}, {**recovery, "state": "accepted"}),
                        "Exact route-only reconciliation journal differs")
                journals[recovery_id] = saved["state"]
            elif path.stem not in own_ids:
                journal = _state(path)
                require(type(journal) is dict and set(journal) == {"plan", "state"}
                        and journal["state"] in ("accepted", "rolled-back", "rejected"),
                        "A different or unqualified operation holds functional Web observation")
                _validate(journal["plan"])
                require(journal["plan"]["operationId"] == path.stem
                        and journal["plan"]["targetKey"] == current["targetKey"], "Foreign functional Web journal")
        for plan in plans.values():
            name = plan["operationId"]
            path = state / "web-rollouts" / (name + ".json")
            if os.path.lexists(path):
                saved = _state(path)
                require(type(saved) is dict and set(saved) == {"plan", "state"}
                        and saved["plan"] == plan and saved["state"] in STATES,
                        "Functional Web phase journal differs")
                journals[name] = saved["state"]
        revision = next(slot["runtime"]["sourceRevision"] for slot in slots.values()
                        if slot["route"]["fingerprint"] == fingerprint)
        identity = install.web("GET", "/api/runtime/web-identity", {}, read_body=True)
        public = decode(identity.body).get("sourceRevision") if identity.status == 200 else None
        require(identity.status != 200 or public == revision, "Public Web identity differs from the exact live route")
        backend = install.backend()["backendFingerprint"]
        require(backend == current["backendFingerprint"] and install.admin.config() == (live, etag)
                and read_autosave(install.relay_dir) == persisted and _state(state / "accepted-web-generation.json") == current,
                "Functional Web route or authority changed during observation")
        return {"state": "observed", "acceptedRevision": current["slot"]["runtime"]["sourceRevision"],
                "acceptedRouteSha256": current["slot"]["route"]["fingerprint"], "liveRouteSha256": fingerprint,
                "publicSourceRevision": public, "backendFingerprint": backend, "journals": journals}


def _operate(args, *, operation, first, previous, held):
    state = _directory_under_installation(first / "rollout")
    lineage = _directory_under_installation(previous / "lineage")
    imported = _directory_under_installation(operation / "artifact")
    bundle = _directory_under_installation(imported / "bundle")
    core_path, core_sha = args.retained_core, args.retained_core_sha256
    core_raw = _sealed(core_path, core_sha) if core_path is not None else None
    retained_core = decode(core_raw) if core_raw is not None else None
    require(core_raw is None or canonical(retained_core) == core_raw, "Canonical retained Core authority required")
    pub_path, import_path = imported / "publication-receipt.json", imported / "import-receipt.json"
    publication, imported_raw = _sealed(pub_path, args.publication_sha256), _sealed(import_path, args.import_sha256)
    import_record = decode(imported_raw)
    staged_chain = operation / "installed-chain.json"
    preimage_path, image_receipt = operation / "accepted-caddy-preimage.json", operation / "loaded-image.json"
    image_state = operation / "image-load"

    with _target_lock(state):
        chain, chain_sha, expected_pointer, predecessor_plan = _admitted_chain(args, state, lineage)
        binding, binding_sha = _original(args, first, state)
        if args.action == "stage":
            _admit_journals(state / "web-rollouts", predecessor_plan)
            require(_state(state / "accepted-web-generation.json") == expected_pointer,
                    "Current Web pointer differs before stage admission")
            preimage = read_autosave(first / "relay")
            require(not os.path.lexists(staged_chain) or read_record(staged_chain) == chain,
                    "Previously staged Web chain differs")
            require(not os.path.lexists(preimage_path) or read_record(preimage_path) == preimage,
                    "Previously staged Caddy preimage differs")
        else:
            require(read_record(staged_chain) == chain, "Staged installed Web chain differs")
            preimage = read_record(preimage_path)
        require(content_hash(preimage) == expected_pointer["slot"]["route"]["fingerprint"],
                "Retained accepted Caddy preimage differs from the admitted Web chain")

    pins = {"expected_publication_sha256": args.publication_sha256, "expected_lineage_sha256": chain_sha,
            "expected_revision": args.revision, "installed_chain": chain, "import_record": import_record}
    source, size, check_archive = held.enter_context(_held_archive(bundle))
    release = verify_received_functional(bundle, publication, **pins)
    check_archive()
    native = LocalDocker(containerd_root=Path("/var/lib/containerd"))
    identity = native.identity()
    require(identity == binding["daemon"], "Installed Docker daemon differs")
    docker = InstalledDocker(expected_socket=(identity["socketDevice"], identity["socketInode"]))
    install = InstalledWebSuccessor(docker, first=first, operation=operation, binding=binding,
        expected_binding_sha256=binding_sha, chain=chain, chain_sha256=chain_sha, watched=WATCHED, preimage=canonical(preimage),
        retained_core=retained_core, expected_retained_core_sha256=core_sha,
        core_activation_operation_id=args.core_activation_operation,
        expected_core_activation_lineage_sha256=args.core_activation_lineage_sha256)
    alias = "warpdrive-web-" + args.suffix
    load_authority = None

    def verify_authority():
        check_archive()
        require(_sealed(pub_path, args.publication_sha256) == publication
                and _sealed(import_path, args.import_sha256) == imported_raw and native.identity() == identity
                and _original(args, first, state) == (binding, binding_sha)
                and _admitted_chain(args, state, lineage)[:2] == (chain, chain_sha)
                and (core_path is None or _sealed(core_path, core_sha) == core_raw),
                "Exact functional release authority changed")

    def release_authorized(_plan, *, initialize):
        require(not initialize, "Functional release requires initialized Web authority")
        verify_authority()
        require(read_record(staged_chain) == chain and read_record(preimage_path) == preimage,
                "Exact staged Web authority changed")
        if load_authority is not None:
            loaded, facts = load_authority
            require(read_record(image_receipt) == loaded, "Exact loaded Web image receipt changed")
            _observe_native_image(native, identity, facts)
        check_archive()
        return True

    if args.action == "stage":
        with _target_lock(state):
            install._stage_preimage(check_journals=True)
            install._retained()
            verify_authority()
            check_archive()
            _retain(staged_chain, chain)
            _retain(preimage_path, preimage)
            release_authorized(None, initialize=False)
            image_state.mkdir(mode=0o700, exist_ok=True)
            _directory_under_installation(image_state)
            _fsync(operation)
            loaded = load_installed_functional_image(bundle, publication_bytes=publication, state_dir=image_state,
                docker=native, expected_daemon=identity, reconcile=os.path.lexists(image_state / JOURNAL), **pins)
            check_archive()
            _retain(image_receipt, loaded)
        check_archive()
        staged = install.stage(loaded=loaded, alias=alias, revision=args.revision, release=release)
        return {"state": "private-ready", "sourceRevision": args.revision, "candidateId": staged["id"],
                "backendFingerprint": chain["backendFingerprint"]}

    loaded = read_record(image_receipt)
    _directory_under_installation(image_state)
    facts = _archive_facts(source, size, release["provenance"], release["image"])
    _verify_stage_load(loaded, release, chain, identity, facts)
    _verify_load_journal(image_state, loaded)
    load_authority = loaded, facts
    release_authorized(None, initialize=False)
    controller = install.controller(loaded=loaded, alias=alias, revision=args.revision, release=release,
                                    verify_release=release_authorized)
    if args.action == "observe":
        return _observe(install, controller)
    if args.action != "seal":
        return controller.run(args.action)

    plan = controller.plan("reapply")
    require(content_hash(plan) == args.accepted_plan_sha256, "Final functional Web plan differs")
    observe_installed = functional_installed_observer(install, plan=plan, loaded=loaded, release=release, candidate_alias=alias)

    def observer(*options, **kwargs):
        release_authorized(plan, initialize=False)
        return observe_installed(*options, **kwargs)

    output = operation / "lineage"
    with _target_lock(state):
        release_authorized(plan, initialize=False)
        _verify_accepted_rollout(state, controller, plan)
        check_archive()
        output.mkdir(mode=0o700, exist_ok=True)
    seal_functional_installed_web_lineage(state, output_dir=output, admitted_chain=chain, expected_chain_sha256=chain_sha,
        expected_operation_id=plan["operationId"], expected_plan_sha256=args.accepted_plan_sha256, bundle_dir=bundle,
        publication_bytes=publication, expected_publication_sha256=args.publication_sha256, import_record=import_record,
        loaded=loaded, candidate_alias=alias, observe_installed=observer, core_activation_operation_id=args.core_activation_operation,
        core_activation_lineage_sha256=args.core_activation_lineage_sha256)
    with _target_lock(state):
        release_authorized(plan, initialize=False)
        return read_seal_acknowledgement(install, controller=controller, expected_plan_sha256=args.accepted_plan_sha256,
            loaded=loaded, release=release, publication_sha256=args.publication_sha256, observe_installed=observer)


def run(args):
    operation, first, original, previous = _validate_args(args)
    with _existing_lock(original / "production-operation.lock", (0o600, 0o644)):
        with _existing_lock(original, (0o700,), directory=True), ExitStack() as held:
            return _operate(args, operation=operation, first=first, previous=previous, held=held)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=_ACTIONS)
    for name in ("operation", "first", "original", "previous"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("suffix", "revision", "publication-sha256", "import-sha256", "lineage-sha256", "lineage-index-sha256",
                 "first-accepted-operation", "first-accepted-plan-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--accepted-plan-sha256")
    parser.add_argument("--retained-core", type=Path)
    parser.add_argument("--retained-core-sha256")
    parser.add_argument("--core-activation-operation")
    parser.add_argument("--core-activation-lineage-sha256")
    parser.add_argument("--projected-lineage-sha256")
    os.umask(0o077)
    try:
        print(json.dumps(run(parser.parse_args(argv)), sort_keys=True))
    except (SwitchUnknown, HandoffHeld, WebImageUnknown) as error:
        print(json.dumps({"state": "unresolved", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, AttributeError, TarError) as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
