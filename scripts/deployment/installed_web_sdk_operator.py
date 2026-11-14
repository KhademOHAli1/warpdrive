"""Operate an independently qualified full-SDK Web through installed Web locks.

No download, build, source qualification, migration or arbitrary command is
performed. The caller supplies original full-bundle publication custody and an
independently pinned completed native reuse qualification. Source inequalities
remain inequalities; they never become a legacy retained-input admission.
"""

import argparse
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from hashlib import sha256
from itertools import combinations
import json
import os
from pathlib import Path
import sys
from tarfile import TarError

import bundle as full_bundle
import component_inputs as inputs
from component_inputs import decode
from installed_core_lineage import verify_projected_core_predecessor
from installed_docker import InstalledDocker
import installed_web_functional_operator as existing
from installed_web_chain import _admit_journals, _private_bytes, _state
from installed_web_image import JOURNAL, LocalDocker, WebImageUnknown, _archive_facts, load_verified_web_archive
from installed_web_lineage import _seal
from installed_web_readback_lock import _existing_lock
from installed_web_relay import read_autosave
from installed_web_sdk_admission import (
    build_sdk_release, compare_backend_inputs, validate_newsletter_binding, verify_engine_unchanged,
)
from installed_web_sdk_lineage import (
    KIND as SDK_LINEAGE_KIND, read_installed_web_history, read_sdk_seal_acknowledgement,
    sdk_installed_observer, seal_sdk_installed_web_lineage, successor_sdk_bindings,
)
from installed_web_sdk_successor import InstalledWebSdkSuccessor
from installed_web_seal_readback import _verify_accepted_rollout
from installed_web_stage import read_record
from installed_web_stage_ack import (
    FIRST_OPERATION, PRIVATE, SUFFIX, WATCHED, _directory_under_installation, _observe_native_image,
    _sealed, _verify_stage_load,
)
from publication_gate import MAX_ZIP_BYTES, verify_downloaded
from traefik_web_handoff_state import HandoffHeld
from web_candidate import _directory, _identity, _opened
from web_rollout import _record
from web_switch import HASH, REVISION, SwitchUnknown, _fsync, canonical, content_hash, require


ADMISSION_KIND = "warpdrive-installed-sdk-web-admission"
ADMISSION_KEYS = {"schemaVersion", "kind", "revision", "originalBackendRevision", "originalInputReceiptSha256",
    "sdkInputReceiptSha256", "publicationReceiptSha256", "projectionReceiptSha256", "runtimeBindingSha256",
    "backendComparisonSha256", "backendReuseQualificationSha256", "engineWitnessSha256", "contractReviewSha256",
    "installedChainSha256", "backendFingerprint", "fullBundleManifestSha256", "fullArchiveSha256", "fullArchiveSizeBytes"}
RECORDS = {"original-backend-inputs.json": "originalInputReceiptSha256",
           "backend-comparison.json": "backendComparisonSha256", "runtime-binding.json": "runtimeBindingSha256",
           "backend-reuse-qualification.json": "backendReuseQualificationSha256",
           "engine-witness.json": "engineWitnessSha256", "contract-review.json": "contractReviewSha256"}
ACTIONS = ("stage", "observe", "promote", "rollback", "reapply", "recover", "recover-reapply",
           "reconcile-failed-stamps", "seal", "seal-readback")
READBACK_KIND = "warpdrive-sdk-web-seal-readback"
INSTALLATION_UID = 0


def _digest(value):
    return type(value) is str and HASH.fullmatch(value) is not None


def _validate_args(args):
    hashes = (args.sdk_admission_sha256, args.lineage_sha256, args.lineage_index_sha256,
              args.first_accepted_plan_sha256)
    require(os.geteuid() == INSTALLATION_UID and args.action in ACTIONS and type(args.suffix) is str
            and SUFFIX.fullmatch(args.suffix) and type(args.revision) is str and REVISION.fullmatch(args.revision)
            and type(args.first_accepted_operation) is str and FIRST_OPERATION.fullmatch(args.first_accepted_operation)
            and all(_digest(pin) for pin in hashes), "Exact root-owned SDK release and independent pins required")
    locations = tuple(map(_directory_under_installation, (args.operation, args.first, args.original, args.previous)))
    operation, first, original, previous = locations
    require(operation == PRIVATE / ("sdk-web-release-" + args.suffix)
            and all(not left.is_relative_to(right) and not right.is_relative_to(left)
                    for left, right in combinations(locations, 2)), "Independent fixed private SDK operation directories required")
    require((args.retained_core is None and args.retained_core_sha256 is None)
            or (args.retained_core == operation / "retained-core.json" and _digest(args.retained_core_sha256)),
            "Exact paired retained Core authority required")
    activation = args.core_activation_operation, args.core_activation_lineage_sha256, args.projected_lineage_sha256
    require(activation == (None, None, None) or (args.retained_core is not None and type(activation[0]) is str
            and existing._ACTIVATION_ID.fullmatch(activation[0]) and all(_digest(pin) for pin in activation[1:])),
            "Exact already completed Core projection pins required")
    require((_digest(args.accepted_plan_sha256) if args.action in {"seal", "seal-readback"}
             else args.accepted_plan_sha256 is None), "Independent final plan pin required only for SDK seal actions")
    require((_digest(args.sealed_index_sha256) if args.action == "seal-readback" else args.sealed_index_sha256 is None),
            "Independent raw SDK index pin required only for separate seal-readback")
    return locations


@contextmanager
def _held_file(path, maximum):
    """Hold original full custody without projecting its kind or byte identity."""
    path = Path(path)
    with _directory(path.parent) as directory, _opened(directory, path.name, maximum) as (source, size):
        info = os.fstat(source.fileno())
        require(info.st_uid == os.geteuid() and not (info.st_mode & 0o022), "Owned non-writable-by-peers SDK custody required")
        identity = _identity(info)
        parent_identity = _identity(os.fstat(directory))

        def check():
            require(parent_identity == _identity(os.fstat(directory)) == _identity(path.parent.lstat())
                    and identity == _identity(os.fstat(source.fileno())) == _identity(path.lstat()),
                    "Original SDK custody file or parent changed")

        check()
        yield source, size, check
        check()


def _hold_full_custody(held, bundle):
    paths = [(bundle.with_name(bundle.name + ".zip"), MAX_ZIP_BYTES),
             (bundle / full_bundle.ARCHIVE, full_bundle.MAX_ARCHIVE_BYTES)]
    paths += [(bundle / name, full_bundle.MAX_METADATA_BYTES)
              for name in (full_bundle.MANIFEST, *full_bundle.metadata_files(3))]
    checks = [held.enter_context(_held_file(path, maximum))[2] for path, maximum in paths]

    def check():
        for callback in checks:
            callback()
    return check


def _bytes(path, *, raw_sha256=None):
    with _held_file(path, full_bundle.MAX_METADATA_BYTES) as (source, size, check):
        raw = source.read(size + 1)
        require(len(raw) == size and (raw_sha256 is None or sha256(raw).hexdigest() == raw_sha256),
                "Pinned SDK authority bytes changed")
        check()
        return raw


def _canonical_record(path, expected_sha256, *, require_canonical=True):
    raw = _bytes(path)
    value = decode(raw)
    require(type(value) is dict and _digest(expected_sha256) and inputs.content_hash(value) == expected_sha256
            and (not require_canonical or raw == inputs.canonical(value)), "Pinned canonical SDK authority record differs")
    return value


def _admission(args, operation):
    value = _canonical_record(operation / "sdk-admission.json", args.sdk_admission_sha256)
    require(set(value) == ADMISSION_KEYS and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
            and value["kind"] == ADMISSION_KIND and value["revision"] == args.revision
            and type(value["originalBackendRevision"]) is str and REVISION.fullmatch(value["originalBackendRevision"])
            and all(_digest(value[key]) for key in ADMISSION_KEYS - {
                "schemaVersion", "kind", "revision", "originalBackendRevision", "fullArchiveSizeBytes"})
            and type(value["fullArchiveSizeBytes"]) is int
            and 0 < value["fullArchiveSizeBytes"] <= full_bundle.MAX_ARCHIVE_BYTES,
            "Exact externally pinned full-SDK installation admission required")
    return value


def _materials(args, operation, artifact):
    admission = _admission(args, operation)
    records = {name: _canonical_record(operation / name, admission[key],
                require_canonical=name != "original-backend-inputs.json") for name, key in RECORDS.items()}
    publication = _bytes(artifact / "publication-receipt.json", raw_sha256=admission["publicationReceiptSha256"])
    projection = _canonical_record(artifact / "projection.json", admission["projectionReceiptSha256"])
    return admission, records, publication, projection


def _prior_readback(previous, chain, plan, index_pin):
    index = decode(_sealed(previous / "lineage/lineage.json", index_pin))
    if index.get("kind") != SDK_LINEAGE_KIND:
        return
    raw = _private_bytes(previous / "sdk-seal-readback.json", modes=(0o400,))
    ack = decode(raw)
    require(type(ack) is dict and set(ack) == {"schemaVersion", "kind", "sealedIndexSha256", "acceptedPlanSha256",
                                            "chainSha256", "sourceRevision", "result"}
            and type(ack["schemaVersion"]) is int and ack["schemaVersion"] == 1 and ack["kind"] == READBACK_KIND
            and ack["sealedIndexSha256"] == index_pin and ack["acceptedPlanSha256"] == content_hash(plan)
            and ack["chainSha256"] == content_hash(chain)
            and ack["sourceRevision"] == chain["active"]["slot"]["runtime"]["sourceRevision"]
            and ack["result"] == {"state": "sealed", "sourceRevision": chain["active"]["slot"]["runtime"]["sourceRevision"],
                                   "lineage": index} and raw == canonical(ack),
            "SDK predecessor has no exact completed independently pinned native seal-readback")


def _admitted_chain(args, state, previous, verify_metadata):
    chain, plan, bindings = read_installed_web_history(previous / "lineage",
        expected_chain_sha256=args.lineage_sha256, expected_index_sha256=args.lineage_index_sha256,
        verify_authority=verify_metadata)
    _prior_readback(previous, chain, plan, args.lineage_index_sha256)
    require(_state(state / "web-rollouts" / (plan["operationId"] + ".json")) == {"plan": plan, "state": "accepted"},
            "Historical SDK/legacy predecessor was never accepted")
    if args.core_activation_operation is None:
        return chain, args.lineage_sha256, _record(plan, plan["after"]), plan, bindings
    projected = _state(state / (args.core_activation_operation + "-lineage-projection.json"))["projectedChain"]
    require(content_hash(projected) == args.projected_lineage_sha256, "Independent completed Core projection differs")
    projection = verify_projected_core_predecessor(state, chain=projected,
        activation_operation_id=args.core_activation_operation,
        expected_activation_lineage_sha256=args.core_activation_lineage_sha256)
    require(projection.original_chain_sha256 == args.lineage_sha256 and projection.chain == projected
            and projection.core_authority_sha256 == args.retained_core_sha256,
            "Completed Core projection differs from admitted historical chain or Core")
    return projected, args.projected_lineage_sha256, projection.accepted_pointer, plan, successor_sdk_bindings(projected, bindings)


def _full_source(args, bundle, admission, projection, publication):
    downloaded = verify_downloaded(decode(publication), bundle, expected_revision=args.revision)
    candidate = downloaded["candidate"]
    manifest_raw = _bytes(bundle / full_bundle.MANIFEST)
    manifest = decode(manifest_raw)
    require(type(candidate.get("schemaVersion")) is int and candidate["schemaVersion"] == 3
            and candidate.get("kind") == "warpdrive-image-candidate" and candidate.get("revision") == args.revision
            and set(candidate.get("components", {})) == {"web", "worker", "realtime", "migrator"}
            and candidate.get("deploymentAuthorized") is False
            and type(manifest.get("schemaVersion")) is int and manifest["schemaVersion"] == 3
            and manifest.get("kind") == "warpdrive-tested-image-bundle"
            and manifest.get("releaseRevision") == args.revision and manifest.get("revision") == args.revision
            and sha256(manifest_raw).hexdigest() == admission["fullBundleManifestSha256"]
            and downloaded["provenance"] == {"bundleManifestSha256": admission["fullBundleManifestSha256"],
                                               "archiveSha256": admission["fullArchiveSha256"]}
            and (bundle / full_bundle.ARCHIVE).stat().st_size == admission["fullArchiveSizeBytes"],
            "Original full schema3 bundle/candidate and byte custody differ")
    original, selected = projection["original"], projection["selectedWeb"]
    require(original["kind"] == manifest["kind"] and original["schemaVersion"] == 3
            and original["publicationAdmissionSha256"] == inputs.content_hash(decode(publication))
            and original["origin"] == downloaded["origin"]
            and original["bundleManifestSha256"] == admission["fullBundleManifestSha256"]
            and original["archiveSha256"] == admission["fullArchiveSha256"]
            and original["archiveSizeBytes"] == admission["fullArchiveSizeBytes"]
            and original["testedNativeImageId"] == candidate["components"]["web"]["imageId"]
            and original["candidatePendingGates"] == candidate["pendingGates"]
            and projection["provenance"]["bundleManifestSha256"] == admission["fullBundleManifestSha256"]
            and projection["image"]["imageId"] == selected["configDigest"],
            "Projection detached original native identity, pending gates, config or full custody")
    return _canonical_record(bundle / full_bundle.INPUT_RECEIPT, admission["sdkInputReceiptSha256"], require_canonical=False)


def native_load_view(release, projection):
    """A fixed generic-loader argument view, never a renamed artifact receipt."""
    return {"revision": release["sourceRevision"], "origin": deepcopy(projection["original"]["origin"]),
            "image": deepcopy(release["image"]), "provenance": deepcopy(release["provenance"])}


def _release(args, admission, records, publication, projection, sdk_receipt, chain, chain_sha):
    require(admission["installedChainSha256"] == chain_sha and admission["backendFingerprint"] == chain["backendFingerprint"],
            "SDK admission differs from exact accepted chain/backend")
    validate_newsletter_binding(records["engine-witness.json"], chain)
    comparison = compare_backend_inputs(sdk_receipt, records["original-backend-inputs.json"],
        expected_sdk_sha256=admission["sdkInputReceiptSha256"], expected_original_sha256=admission["originalInputReceiptSha256"],
        original_revision=admission["originalBackendRevision"])
    require(comparison == records["backend-comparison.json"], "Honest original/current backend comparison differs")
    release = build_sdk_release(expected_revision=args.revision,
        publication_bytes=publication, expected_publication_sha256=admission["publicationReceiptSha256"],
        projection=projection, expected_projection_sha256=admission["projectionReceiptSha256"],
        runtime_binding=records["runtime-binding.json"], expected_runtime_binding_sha256=admission["runtimeBindingSha256"],
        backend_comparison=comparison, expected_backend_comparison_sha256=admission["backendComparisonSha256"],
        qualification=records["backend-reuse-qualification.json"],
        expected_qualification_sha256=admission["backendReuseQualificationSha256"],
        installed_chain=chain, expected_chain_sha256=chain_sha, expected_backend_fingerprint=admission["backendFingerprint"],
        expected_engine_witness_sha256=admission["engineWitnessSha256"],
        expected_contract_review_sha256=admission["contractReviewSha256"])
    require(release["sourceRevision"] == args.revision, "SDK admitted release source differs")
    return release


def _operate(args, *, operation, first, previous, held):
    state = _directory_under_installation(first / "rollout")
    artifact = _directory_under_installation(operation / "artifact")
    bundle = _directory_under_installation(artifact / "bundle")
    projected = _directory_under_installation(artifact / "projected-web")
    admission, records, publication, projection = _materials(args, operation, artifact)
    check_full = _hold_full_custody(held, bundle)
    source, size, check_projected = held.enter_context(existing._held_archive(projected))
    core_path, core_sha = args.retained_core, args.retained_core_sha256
    core_raw = _sealed(core_path, core_sha) if core_path is not None else None
    retained_core = decode(core_raw) if core_raw is not None else None
    require(core_raw is None or canonical(retained_core) == core_raw, "Canonical retained Core authority required")

    def verify_metadata():
        check_full()
        check_projected()
        require(_materials(args, operation, artifact) == (admission, records, publication, projection)
                and (core_path is None or _sealed(core_path, core_sha) == core_raw), "SDK release authority files changed")
        return True

    staged_chain = operation / "installed-chain.json"
    preimage_path, image_receipt = operation / "accepted-caddy-preimage.json", operation / "loaded-image.json"
    image_state = operation / "image-load"
    with existing._target_lock(state):
        chain, chain_sha, expected_pointer, predecessor_plan, retained_bindings = _admitted_chain(args, state, previous, verify_metadata)
        binding, binding_sha = existing._original(args, first, state)
        if args.action == "stage":
            _admit_journals(state / "web-rollouts", predecessor_plan)
            require(_state(state / "accepted-web-generation.json") == expected_pointer, "SDK predecessor pointer differs before stage")
            preimage = read_autosave(first / "relay")
            require(not os.path.lexists(staged_chain) or read_record(staged_chain) == chain, "Previously staged SDK chain differs")
            require(not os.path.lexists(preimage_path) or read_record(preimage_path) == preimage, "Previously staged SDK preimage differs")
        else:
            require(read_record(staged_chain) == chain, "Staged SDK chain differs")
            preimage = read_record(preimage_path)
        require(content_hash(preimage) == expected_pointer["slot"]["route"]["fingerprint"], "Exact accepted SDK Caddy preimage differs")

    # All publication/source/custody/qualification admission precedes even native
    # daemon discovery. No locally created flag or equality can replace it.
    sdk_receipt = _full_source(args, bundle, admission, projection, publication)
    release = _release(args, admission, records, publication, projection, sdk_receipt, chain, chain_sha)
    view = native_load_view(release, projection)
    facts = _archive_facts(source, size, release["provenance"], release["image"])
    require(facts["descriptor"]["digest"] == records["runtime-binding.json"]["imageId"]
            == projection["selectedWeb"]["manifestDigest"], "Projected native platform manifest differs")
    verify_metadata()
    native = LocalDocker(containerd_root=Path("/var/lib/containerd"))
    identity = native.identity()
    require(identity == binding["daemon"], "Installed Docker daemon differs")
    docker = InstalledDocker(expected_socket=(identity["socketDevice"], identity["socketInode"]))
    verify_engine_unchanged(docker, records["engine-witness.json"], expected_sha256=admission["engineWitnessSha256"])
    install = InstalledWebSdkSuccessor(docker, first=first, operation=operation, binding=binding,
        expected_binding_sha256=binding_sha, chain=chain, chain_sha256=chain_sha, watched=WATCHED, preimage=canonical(preimage),
        retained_core=retained_core, expected_retained_core_sha256=core_sha,
        core_activation_operation_id=args.core_activation_operation,
        expected_core_activation_lineage_sha256=args.core_activation_lineage_sha256,
        candidate_binding=records["runtime-binding.json"], expected_candidate_binding_sha256=admission["runtimeBindingSha256"],
        expected_candidate_publication_sha256=admission["publicationReceiptSha256"], retained_sdk_bindings=retained_bindings)
    alias = "warpdrive-web-" + args.suffix
    load_authority = None

    def verify_authority():
        verify_metadata()
        require(native.identity() == identity and existing._original(args, first, state) == (binding, binding_sha)
                and _admitted_chain(args, state, previous, verify_metadata) == (
                    chain, chain_sha, expected_pointer, predecessor_plan, retained_bindings), "SDK original/chain/native authority changed")
        verify_engine_unchanged(docker, records["engine-witness.json"], expected_sha256=admission["engineWitnessSha256"])
        require(install.backend()["backendFingerprint"] == chain["backendFingerprint"], "Protected SDK backend changed")
        return True

    def release_authorized(_plan, *, initialize):
        require(not initialize, "SDK release requires initialized Web authority")
        verify_authority()
        require(read_record(staged_chain) == chain and read_record(preimage_path) == preimage, "Staged SDK authority changed")
        if load_authority is not None:
            loaded, native_facts = load_authority
            require(read_record(image_receipt) == loaded, "Exact SDK image-load receipt changed")
            _observe_native_image(native, identity, native_facts)
        verify_authority()
        return True

    verify_authority()
    if args.action == "stage":
        with existing._target_lock(state):
            install._stage_preimage(check_journals=True)
            install._retained()
            verify_authority()
            existing._retain(staged_chain, chain)
            existing._retain(preimage_path, preimage)
            release_authorized(None, initialize=False)
            image_state.mkdir(mode=0o700, exist_ok=True)
            _directory_under_installation(image_state)
            _fsync(operation)
            loaded = load_verified_web_archive(projected, state_dir=image_state, docker=native,
                image=release["image"], provenance=release["provenance"],
                baseline_revision=chain["active"]["provenance"]["revision"],
                baseline_manifest_sha256=chain["active"]["provenance"]["manifestSha256"],
                origin=view["origin"], expected_daemon=identity, reconcile=os.path.lexists(image_state / JOURNAL))
            verify_metadata()
            _verify_stage_load(loaded, view, chain, identity, facts)
            existing._verify_load_journal(image_state, loaded)
            existing._retain(image_receipt, loaded)
            load_authority = loaded, facts
            release_authorized(None, initialize=False)
        staged = install.stage(loaded=loaded, alias=alias, revision=args.revision, release=release)
        release_authorized(None, initialize=False)
        return {"state": "private-ready", "sourceRevision": args.revision, "candidateId": staged["id"],
                "backendFingerprint": chain["backendFingerprint"], "sdkAdmissionSha256": args.sdk_admission_sha256}

    loaded = read_record(image_receipt)
    _directory_under_installation(image_state)
    _verify_stage_load(loaded, view, chain, identity, facts)
    existing._verify_load_journal(image_state, loaded)
    load_authority = loaded, facts
    release_authorized(None, initialize=False)
    controller = install.controller(loaded=loaded, alias=alias, revision=args.revision, release=release,
                                   verify_release=release_authorized)
    if args.action == "observe":
        result = existing._observe(install, controller)
    elif args.action not in {"seal", "seal-readback"}:
        result = controller.run(args.action)
    else:
        plan = controller.plan("reapply")
        require(content_hash(plan) == args.accepted_plan_sha256, "Independent final SDK plan differs")
        authority = lambda: release_authorized(plan, initialize=False)
        observer = sdk_installed_observer(install, plan=plan, loaded=loaded, release=release,
                                         candidate_alias=alias, verify_authority=authority)
        if args.action == "seal-readback":
            result = read_sdk_seal_acknowledgement(install, controller=controller,
                expected_plan_sha256=args.accepted_plan_sha256, expected_index_sha256=args.sealed_index_sha256,
                loaded=loaded, release=release, publication_sha256=admission["publicationReceiptSha256"],
                observe_installed=observer, verify_authority=authority)
            authority()
            acknowledgement = {"schemaVersion": 1, "kind": READBACK_KIND,
                "sealedIndexSha256": args.sealed_index_sha256, "acceptedPlanSha256": args.accepted_plan_sha256,
                "chainSha256": result["lineage"]["chainSha256"], "sourceRevision": result["sourceRevision"], "result": result}
            _seal(operation / "sdk-seal-readback.json", canonical(acknowledgement))
        else:
            output = operation / "lineage"
            with existing._target_lock(state):
                authority()
                _verify_accepted_rollout(state, controller, plan)
                output.mkdir(mode=0o700, exist_ok=True)
            index = seal_sdk_installed_web_lineage(state, output_dir=output, admitted_chain=chain,
                expected_chain_sha256=chain_sha, expected_operation_id=plan["operationId"],
                expected_plan_sha256=args.accepted_plan_sha256, release=release, source_publication_bytes=publication,
                expected_publication_sha256=admission["publicationReceiptSha256"], projection_receipt=projection,
                runtime_binding=records["runtime-binding.json"], expected_runtime_binding_sha256=admission["runtimeBindingSha256"],
                retained_sdk_bindings=retained_bindings, backend_reuse_qualification=records["backend-reuse-qualification.json"],
                loaded=loaded, candidate_alias=alias, observe_installed=observer, verify_authority=authority,
                core_activation_operation_id=args.core_activation_operation,
                core_activation_lineage_sha256=args.core_activation_lineage_sha256)
            result = {"state": "lineage-written-not-readback", "sourceRevision": args.revision, "lineage": index,
                      "readbackRequired": True}
    release_authorized(None, initialize=False)
    return result


def run(args):
    operation, first, original, previous = _validate_args(args)
    with _existing_lock(original / "production-operation.lock", (0o600, 0o644)):
        with _existing_lock(original, (0o700,), directory=True), ExitStack() as held:
            return _operate(args, operation=operation, first=first, previous=previous, held=held)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=ACTIONS)
    for name in ("operation", "first", "original", "previous"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("suffix", "revision", "sdk-admission-sha256", "lineage-sha256", "lineage-index-sha256",
                 "first-accepted-operation", "first-accepted-plan-sha256"):
        parser.add_argument("--" + name, required=True)
    for name in ("accepted-plan-sha256", "sealed-index-sha256", "retained-core-sha256", "core-activation-operation",
                 "core-activation-lineage-sha256", "projected-lineage-sha256"):
        parser.add_argument("--" + name)
    parser.add_argument("--retained-core", type=Path)
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
