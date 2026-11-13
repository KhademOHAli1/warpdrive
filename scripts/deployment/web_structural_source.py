"""Join exact Git operations with protected source and client effect proofs."""

import argparse
from hashlib import sha1
import json
import os
from pathlib import Path
import sys

from candidate import REVISION, require
import component_inputs as inputs
from web_release_build import checkout, private_destination, read_metadata, write_metadata
from web_release_inputs import _git, _tree, source_policy
from web_retained_backend_inputs import RETAINED, verify_retained_backend_inputs
from web_structural_delta import parse_web_structural_delta, verify_web_structural_delta


VERIFIERS = (
    "scripts/build-workers.mjs",
    "scripts/deployment/component_inputs.mjs",
    "scripts/deployment/web_inputs.mjs",
    "scripts/deployment/web_presentation_policy.mjs",
    "scripts/deployment/web_functional_source.mjs",
    "scripts/deployment/web_functional_capabilities.mjs",
    "scripts/deployment/web_protected_projection.mjs",
    "scripts/deployment/web_client_effect_projection.mjs",
    "scripts/deployment/web_retained_backend_inputs.py",
    "scripts/deployment/web_structural_source.py",
    "scripts/deployment/web_structural_delta.py",
    "scripts/deployment/web_functional_profile.py",
)
PROGRAM = """
import { readFileSync } from 'node:fs';
import { verifyWebProtectedProjection } from './scripts/deployment/web_protected_projection.mjs';
import { verifyWebClientEffectProjection } from './scripts/deployment/web_client_effect_projection.mjs';
const [root, baselineRevision, currentRevision, profilePath, reviewedSha256] = process.argv.slice(1);
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const protectedSource = await verifyWebProtectedProjection({
    root, baselineRevision, currentRevision, rendererCuts: profile.rendererCuts,
});
const clientEffects = await verifyWebClientEffectProjection({ root, baselineRevision, currentRevision, profile });
if (clientEffects.profileSha256 !== reviewedSha256) throw new Error('Client effect profile changed during read');
process.stdout.write(JSON.stringify({ protectedSource, clientEffects }));
"""
PROTECTED_FIELDS = {"schemaVersion", "kind", "baselineRevision", "currentRevision", "rendererCutsSha256",
                    "protectedProjectionSha256", "protectedRoots", "protectedFiles", "deploymentAuthorized"}
EFFECT_FIELDS = {"schemaVersion", "kind", "baselineRevision", "currentRevision", "profileSha256", "rendererCutsSha256",
                 "effectSha256", "capabilitySourceSha256", "rendererContractSha256", "baselineSubtreeSha256",
                 "candidateSubtreeSha256", "capabilityUses", "deploymentAuthorized"}


def _match(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _profile_coverage(envelope, profile):
    require(type(profile) is dict and all(type(profile.get(key)) is list for key in (
        "beforeModules", "afterModules", "beforeStyles", "afterStyles")), "Exact reviewed client effect profile required")
    pairs = {"client": ("beforeModules", "afterModules"), "style": ("beforeStyles", "afterStyles")}
    for row in envelope["operations"]:
        role, path = row["role"], row["path"]
        if role in pairs:
            for endpoint, key in zip(("before", "after"), pairs[role], strict=True):
                require((path in profile[key]) == (row[endpoint] is not None),
                        "A structural client or stylesheet operation is outside the reviewed client subtree")
        elif role == "asset":
            require(False, "Asset content and URL admission are required before structural asset changes")
        elif role == "test":
            require(False, "Effective Web build context exclusion is required before structural test changes")


def _pin_verifiers(root, before, after):
    for path in VERIFIERS:
        raw = read_metadata(root / path)
        digest = sha1(f"blob {len(raw)}\0".encode() + raw, usedforsecurity=False).hexdigest()
        require(before.get(path) == after.get(path) == ("100644", "blob", digest),
                "Structural source verifier differs from the exact reviewed tooling")


def _join(result, before, current, effect_sha256):
    require(type(result) is dict and set(result) == {"protectedSource", "clientEffects"}, "Exact joined structural source proof required")
    protected, effects = result["protectedSource"], result["clientEffects"]
    for row, keys, kind in ((protected, PROTECTED_FIELDS, "warpdrive-web-protected-source-projection"),
                            (effects, EFFECT_FIELDS, "warpdrive-web-client-effect-projection")):
        require(type(row) is dict and set(row) == keys and type(row["schemaVersion"]) is int and row["schemaVersion"] == 1
                and row["kind"] == kind and row["baselineRevision"] == before and row["currentRevision"] == current
                and row["deploymentAuthorized"] is False
                and all(_match(inputs.HASH, value) for key, value in row.items() if key.endswith("Sha256")),
                "Structural source proof does not bind both exact selected revisions")
    require(protected["rendererCutsSha256"] == effects["rendererCutsSha256"] and effects["profileSha256"] == effect_sha256
            and all(type(protected[key]) is int and 0 < protected[key] <= inputs.MAX_FILES for key in ("protectedRoots", "protectedFiles"))
            and type(effects["capabilityUses"]) is int and 0 <= effects["capabilityUses"] <= 512,
            "Protected and client effect proofs disagree on the reviewed renderer interface")
    return result


def verify(args, *, original):
    root, before, current = args.root, args.baseline_revision, args.revision
    require(all(_match(REVISION, value) for value in (before, current)) and before != current,
            "Distinct exact structural source revisions required")
    checkout(root, current)
    _git(root, "merge-base", "--is-ancestor", before, current, allow_empty=True)
    require(source_policy(root, before) == source_policy(root, current), "Structural Web changed retained Engine or ingress source policy")
    baseline, candidate = (_tree(root, revision) for revision in (before, current))
    envelope = parse_web_structural_delta(read_metadata(args.delta), expected_sha256=args.delta_sha256)
    profile = inputs.decode(read_metadata(args.effects))
    require(_match(inputs.HASH, args.effects_sha256) and inputs.content_hash(profile) == args.effects_sha256,
            "Client effect profile differs from the reviewed checksum")
    retained_paths = {row["path"] for name in RETAINED for row in original["components"][name]["inputs"]}
    operations = verify_web_structural_delta(baseline, candidate, envelope, baseline_revision=before,
        candidate_revision=current, expected_sha256=args.delta_sha256, protected_paths=retained_paths,
        expected_registry_review_sha256=args.registry_review_sha256)
    _profile_coverage(envelope, profile)
    _pin_verifiers(root, baseline, candidate)
    retained = verify_retained_backend_inputs(root, expected_revision=current, retained_receipt=original,
                                              expected_retained_sha256=args.retained_receipt_sha256)
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    command = ["node", "--input-type=module", "-e", PROGRAM, str(root), before, current,
               str(args.effects), args.effects_sha256]
    joined = _join(inputs.decode(inputs._discover(command, root, environment, deadline_seconds=120)),
                   before, current, args.effects_sha256)
    return {"schemaVersion": 1, "kind": "warpdrive-web-structural-source", "baselineRevision": before,
            "currentRevision": current, "deltaSha256": args.delta_sha256, "effectsSha256": args.effects_sha256,
            "registryReviewSha256": args.registry_review_sha256, "changed": list(operations),
            "originalBackendReceiptSha256": args.retained_receipt_sha256,
            "retainedBackendInputsSha256": inputs.content_hash(retained), **joined,
            "deploymentAuthorized": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("root", "delta", "effects", "retained-receipt", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("baseline-revision", "revision", "delta-sha256", "effects-sha256", "retained-receipt-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--registry-review-sha256")
    args = parser.parse_args(argv)
    try:
        private_destination(args.output, args.root)
        original = inputs.load_receipt(args.retained_receipt)
        facts = verify(args, original=original)
        write_metadata(args.output, facts)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError) as error:
        print(f"Structural Web source held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    print(json.dumps({"revision": args.revision, "structuralSourceSha256": inputs.content_hash(facts),
                      "deploymentAuthorized": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
