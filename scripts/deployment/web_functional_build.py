"""Prepare exact Web SDK source and dependencies against an admitted backend."""

import argparse
from hashlib import sha1
import json
import os
from pathlib import Path
import sys

from bundle import INPUT_RECEIPT, MAX_METADATA_BYTES, load_bundle, regular_file
from candidate import REVISION, require
import component_inputs as inputs
from web_build_context import prepare_context, verify_context
from web_extension_inputs import verify_web_extension_candidate
from web_functional_profile import parse_web_functional_profile, verify_web_functional_delta
from web_release_build import checkout, private_destination, read_metadata, write_metadata
from web_release_inputs import _git, _tree, source_policy


SOURCE = "scripts/deployment/web_functional_source.mjs"
CAPABILITIES = "scripts/deployment/web_functional_capabilities.mjs"
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


def _source(args, profile):
    root, before, current = args.root, args.tooling_revision, args.revision
    selected = (args.active_web_revision, before, current)
    require(all(REVISION.fullmatch(revision) for revision in selected) and len(set(selected)) == 3,
            "Distinct active Web, reviewed tooling and exact candidate sources required")
    checkout(root, current)
    _git(root, "merge-base", "--is-ancestor", args.active_web_revision, before, allow_empty=True)
    _git(root, "merge-base", "--is-ancestor", before, current, allow_empty=True)
    require(source_policy(root, args.active_web_revision) == source_policy(root, current),
            "SDK candidate changed the retained Engine or ingress source policy")
    before_tree, current_tree = (_tree(root, revision) for revision in (before, current))
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


def prepare(args):
    if not args.verify:
        private_destination(args.output, args.root, args.context, args.web_projection, args.core_bundle_dir)
    profile = _profile(args.profile, args.profile_sha256)
    source = _source(args, profile)
    retained, retained_pin = _backend(args)
    dependencies = verify_web_extension_candidate(args.root, expected_revision=args.revision,
        expected_baseline_revision=args.active_web_revision, retained_receipt=retained, expected_retained_sha256=retained_pin,
        web_root=args.web_projection, sdk_archives={"@ui-sdk/core": args.sdk_core, "@ui-sdk/react": args.sdk_react})
    context = (verify_context if args.verify else prepare_context)(args.root, args.revision, args.context)
    facts = {"schemaVersion": 1, "kind": "warpdrive-functional-web-build-inputs", "revision": args.revision,
             "activeWebRevision": args.active_web_revision, "toolingRevision": args.tooling_revision,
             "originalBackendRevision": args.core_revision, "originalBackendManifestSha256": args.core_manifest_sha256,
             "reviewedProfileSha256": args.profile_sha256, "source": source, "dependencies": dependencies,
             "context": {key: context[key] for key in ("gitInventorySha256", "fileCount")},
             "buildComponents": ["web"], "deploymentAuthorized": False}
    if args.verify:
        require(inputs.decode(read_metadata(args.output)) == facts, "Functional Web build evidence changed after compilation")
    else:
        write_metadata(args.output, facts)
    return {"revision": args.revision, "inputSha256": inputs.content_hash(facts), "buildComponents": ["web"],
            "deploymentAuthorized": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("root", "profile", "core-bundle-dir", "web-projection", "sdk-core", "sdk-react", "context", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("revision", "active-web-revision", "tooling-revision", "core-revision", "core-manifest-sha256", "profile-sha256"):
        parser.add_argument("--" + name, required=True)
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
