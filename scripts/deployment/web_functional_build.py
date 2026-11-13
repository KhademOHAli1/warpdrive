"""Prepare exact Web SDK source and dependencies against an admitted backend."""

import argparse
from hashlib import sha1
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

from bundle import INPUT_RECEIPT, MAX_METADATA_BYTES, load_bundle, regular_file
from candidate import REVISION, require
import component_inputs as inputs
from web_build_context import prepare_context, verify_context
from web_extension_inputs import file_bytes, verify_web_extension_candidate
from web_functional_successor_source import verify_web_functional_successor_source
from web_mixed_image_smoke import CRM_SWITCH
from web_retained_backend_inputs import RETAINED
from web_functional_profile import parse_web_functional_profile, verify_web_functional_delta
from web_release_build import checkout, private_destination, read_metadata, write_metadata
from web_release_inputs import _git, _tree, source_policy
from web_structural_source import verify as verify_structural_source


SOURCE = "scripts/deployment/web_functional_source.mjs"
CAPABILITIES = "scripts/deployment/web_functional_capabilities.mjs"
SWITCH_BUILD_TOOLKIT = (
    "scripts/deployment/web_build_context.py",
    "scripts/deployment/web_extension_inputs.py",
    "scripts/deployment/web_functional_build.py",
    "scripts/deployment/web_functional_successor_source.py",
    "scripts/deployment/web_retained_backend_inputs.py",
)
SOURCE_PROGRAM = """
const { verifyWebFunctionalSource } = await import('./scripts/deployment/web_functional_source.mjs');
const [root, baselineRevision, currentRevision, profile] = process.argv.slice(1);
const proof = await verifyWebFunctionalSource({ root, baselineRevision, currentRevision, profile: JSON.parse(profile) });
process.stdout.write(JSON.stringify(proof));
"""


def _profile(path, expected_digest):
    return parse_web_functional_profile(read_metadata(path), expected_sha256=expected_digest)


def _backend(args):
    original = load_bundle(args.core_bundle_dir, expected_revision=args.core_revision)
    candidate, provenance = original["candidate"], original["provenance"]
    require(candidate["schemaVersion"] == 2 and provenance["bundleManifestSha256"] == args.core_manifest_sha256,
            "Original backend bundle differs from independent custody")
    receipt = inputs.load_receipt(regular_file(args.core_bundle_dir, INPUT_RECEIPT, MAX_METADATA_BYTES))
    digest = candidate["inputProvenance"]["receiptSha256"]
    require(digest == inputs.content_hash(receipt), "Original backend inputs differ from tested artifact")
    return receipt, digest


TOOLING_FILES = {
    ".github/workflows/production-images.yml",
    ".github/workflows/web-functional-custody.yml",
    ".github/workflows/web-functional-qualification.yml",
    "docs/deployment-artifact-promotion.md",
    "eslint.config.mjs",
}


def _source_trees(args):
    root, before, current = args.root, args.tooling_revision, args.revision
    selected = (args.active_web_revision, before, current)
    require(all(REVISION.fullmatch(revision) for revision in selected) and len(set(selected)) == 3,
            "Distinct active Web, reviewed tooling and exact candidate sources required")
    checkout(root, current)
    _git(root, "merge-base", "--is-ancestor", args.active_web_revision, before, allow_empty=True)
    _git(root, "merge-base", "--is-ancestor", before, current, allow_empty=True)
    require(source_policy(root, args.active_web_revision) == source_policy(root, current),
            "SDK candidate changed the retained Engine or ingress source policy")
    return _tree(root, before), _tree(root, current)


def _source(args, profile):
    root, before, current = args.root, args.tooling_revision, args.revision
    before_tree, current_tree = _source_trees(args)
    changes = verify_web_functional_delta(before_tree, current_tree, profile)
    verifier_paths = {SOURCE, "scripts/build-workers.mjs", "scripts/deployment/component_inputs.mjs",
                      "scripts/deployment/web_inputs.mjs", "scripts/deployment/web_presentation_policy.mjs"}
    if CAPABILITIES in before_tree or profile["version"] == 2:
        verifier_paths.add(CAPABILITIES)
    for path in verifier_paths:
        script = current_tree[path]
        raw = read_metadata(root / path)
        git_blob = sha1(f"blob {len(raw)}\0".encode() + raw, usedforsecurity=False).hexdigest()
        require(script == before_tree[path] == ("100644", "blob", git_blob),
                "Functional source verifier differs from the reviewed tooling revision")
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    command = ["node", "--input-type=module", "-e", SOURCE_PROGRAM, str(root), before, current,
               inputs.canonical(profile).decode()]
    result = inputs.decode(inputs._discover(command, root, environment, deadline_seconds=90))
    require(result["kind"] == "warpdrive-web-functional-source" and result["schemaVersion"] == profile["version"]
            and (profile["version"] == 1 or inputs.HASH.fullmatch(result.get("capabilityBindingsSha256", "")))
            and result["baselineRevision"] == before and result["currentRevision"] == current
            and result["deploymentAuthorized"] is False and result["profileSha256"] == args.profile_sha256
            and tuple(row["path"] for row in result["changed"]) == changes
            and all(before_tree[row["path"]] == ("100644", "blob", row["baselineBlob"])
                    and current_tree[row["path"]] == ("100644", "blob", row["currentBlob"]) for row in result["changed"]),
            "Functional source proof differs from the selected Git objects")
    return result


def _switch_source(args, retained, retained_pin):
    from web_build_context import _blob_id

    checkout(args.root, args.revision)
    tooling, candidate = (_tree(args.root, revision) for revision in (args.tooling_revision, args.revision))
    for path in SWITCH_BUILD_TOOLKIT:
        raw = file_bytes(args.root / path, MAX_METADATA_BYTES)
        require(tooling.get(path) == candidate.get(path) == ("100644", "blob", _blob_id(raw)),
                "Switch build toolkit differs from protected tooling bytes")
    source = verify_web_functional_successor_source(args.root, active_revision=args.active_web_revision,
        tooling_revision=args.tooling_revision, candidate_revision=args.revision, profile_sha256=args.profile_sha256,
        original_backend_receipt=retained, original_backend_sha256=retained_pin)
    inventory = {path: list(row) for path, row in candidate.items()}
    return source, {"gitInventorySha256": inputs.content_hash(inventory), "fileCount": len(inventory)}


def _verify_switch_evidence(args, source, dependencies, retained, retained_pin):
    projected = {**retained, "components": {name: retained["components"][name] for name in RETAINED}}
    fingerprints = {name: item["componentInputSha256"] for name, item in projected["components"].items()}
    require(source["kind"] == "warpdrive-web-functional-successor-source"
            and type(source["schemaVersion"]) is int and source["schemaVersion"] == 2
            and source["deploymentAuthorized"] is False and source["activeWebRevision"] == args.active_web_revision
            and source["toolingRevision"] == args.tooling_revision and source["candidateRevision"] == args.revision
            and source["profileSha256"] == args.profile_sha256 and source["originalBackendReceiptSha256"] == retained_pin
            and source["retainedComponentInputSha256"] == fingerprints
            and dependencies["kind"] == "warpdrive-web-extension-candidate-inputs"
            and type(dependencies["schemaVersion"]) is int and dependencies["schemaVersion"] == 1
            and dependencies["deploymentAuthorized"] is False and dependencies["sourceRevision"] == args.revision
            and dependencies["baselineRevision"] == args.active_web_revision
            and dependencies["originalBackendReceiptSha256"] == retained_pin
            and dependencies["retainedComponentInputSha256"] == fingerprints
            and dependencies["retainedBackendInputsSha256"] == inputs.content_hash(projected),
            "Switch source and dependency proofs differ from the protected build inputs")


def _structural_source(args, retained, retained_pin):
    tooling, _ = _source_trees(args)
    active = _tree(args.root, args.active_web_revision)
    changes = {path for path in active.keys() | tooling.keys() if active.get(path) != tooling.get(path)}
    require(all(path in TOOLING_FILES or path.startswith("scripts/deployment/") for path in changes),
            "Structural Web tooling overlay includes changes outside approved tooling paths")
    review = SimpleNamespace(root=args.root, baseline_revision=args.tooling_revision, revision=args.revision,
        delta=args.structural_delta, delta_sha256=args.structural_delta_sha256, effects=args.profile,
        effects_sha256=args.profile_sha256, retained_receipt_sha256=retained_pin,
        registry_review_sha256=args.structural_registry_sha256)
    return verify_structural_source(review, original=retained)


def _structural_context(context, paths):
    fields = {"gitInventorySha256": context["gitInventorySha256"], "fileCount": context["fileCount"]}
    if paths:
        require(context["schemaVersion"] == 2 and context["excludedTests"] == paths
                and context["excludedTestCount"] == len(paths)
                and context["excludedTestPathsSha256"] == inputs.content_hash(paths),
                "Build context differs from required structural test exclusions")
        return {**fields, "contextInventorySha256": context["contextInventorySha256"],
                "excludedPathsSha256": context["excludedTestPathsSha256"],
                "excludedTestsSha256": context["excludedTestsSha256"], "excludedFileCount": context["excludedTestCount"]}
    require(context["schemaVersion"] == 1, "Unexpected structural test exclusions")
    return {**fields, "contextInventorySha256": fields["gitInventorySha256"],
            "excludedPathsSha256": inputs.content_hash([]), "excludedTestsSha256": inputs.content_hash({}),
            "excludedFileCount": 0}


def prepare(args):
    if not args.verify:
        private_destination(args.output, args.root, args.context, args.web_projection, args.core_bundle_dir)
    successor = getattr(args, "switch_successor", False)
    require(successor != (args.profile is not None), "Select exactly one protected functional Web profile mode")
    delta = getattr(args, "structural_delta", None)
    delta_sha256 = getattr(args, "structural_delta_sha256", None)
    registry_sha256 = getattr(args, "structural_registry_sha256", None)
    structural = delta is not None
    require(structural == (delta_sha256 is not None) and (structural or registry_sha256 is None)
            and not (structural and successor), "Exact structural review inputs required together with a functional profile")
    retained, retained_pin = _backend(args)
    if successor:
        source, expected_context = _switch_source(args, retained, retained_pin)
    elif structural:
        source = _structural_source(args, retained, retained_pin)
    else:
        source = _source(args, _profile(args.profile, args.profile_sha256))
    dependencies = verify_web_extension_candidate(args.root, expected_revision=args.revision,
        expected_baseline_revision=args.active_web_revision, retained_receipt=retained, expected_retained_sha256=retained_pin,
        web_root=args.web_projection, sdk_archives={"@ui-sdk/core": args.sdk_core, "@ui-sdk/react": args.sdk_react})
    if successor:
        _verify_switch_evidence(args, source, dependencies, retained, retained_pin)
    context_builder = verify_context if args.verify else prepare_context
    excluded_tests = source["excludedBuildTests"] if structural else ()
    context_options = {"exclude_tests": excluded_tests} if structural else {}
    context = context_builder(args.root, args.revision, args.context, **context_options)
    context_fields = {key: context[key] for key in ("gitInventorySha256", "fileCount")}
    facts = {"schemaVersion": 3 if structural else 1, "kind": "warpdrive-functional-web-build-inputs",
             "revision": args.revision, "activeWebRevision": args.active_web_revision, "toolingRevision": args.tooling_revision,
             "originalBackendRevision": args.core_revision, "originalBackendManifestSha256": args.core_manifest_sha256,
             "reviewedProfileSha256": args.profile_sha256, "source": source, "dependencies": dependencies,
             "context": context_fields, "buildComponents": ["web"], "deploymentAuthorized": False}
    if successor:
        require(inputs.canonical(context_fields) == inputs.canonical(expected_context),
                "Switch build context differs from the reviewed Git inventory")
        facts.update(schemaVersion=2, sdkScenario=CRM_SWITCH)
    if structural:
        require(source["retainedBackendInputsSha256"] == dependencies["retainedBackendInputsSha256"],
                "Structural source and dependency proofs disagree on the retained backend")
        facts.update(reviewedDeltaSha256=args.structural_delta_sha256,
                     reviewedRegistrySha256=args.structural_registry_sha256,
                     context=_structural_context(context, excluded_tests))
    if args.verify:
        recorded = inputs.decode(read_metadata(args.output))
        matches = inputs.canonical(recorded) == inputs.canonical(facts) if successor else recorded == facts
        require(matches, "Functional Web build evidence changed after compilation")
    else:
        write_metadata(args.output, facts)
    return {"revision": args.revision, "inputSha256": inputs.content_hash(facts), "buildComponents": ["web"],
            "deploymentAuthorized": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("root", "core-bundle-dir", "web-projection", "sdk-core", "sdk-react", "context", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("revision", "active-web-revision", "tooling-revision", "core-revision", "core-manifest-sha256", "profile-sha256"):
        parser.add_argument("--" + name, required=True)
    profile = parser.add_mutually_exclusive_group(required=True)
    profile.add_argument("--profile", type=Path)
    profile.add_argument("--switch-successor", action="store_true", help="Use the tracked Switch profile from the reviewed tooling revision")
    parser.add_argument("--structural-delta", type=Path)
    parser.add_argument("--structural-delta-sha256")
    parser.add_argument("--structural-registry-sha256")
    parser.add_argument("--verify", action="store_true")
    try:
        result = prepare(parser.parse_args(argv))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print(f"Functional Web input verification held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
