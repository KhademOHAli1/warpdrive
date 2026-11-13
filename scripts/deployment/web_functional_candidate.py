"""Retain the native Web SDK image and its exact source, dependency and browser proofs."""

import argparse
import json
import os
from pathlib import Path
import sys

from bundle import load_bundle
from candidate import CandidateError, IMAGE_ID, REVISION, require
from component_inputs import HASH, MAX_FILES, InputError, canonical, content_hash, decode, safe_path
from image_smoke import Docker, SmokeError
from web_candidate import ARCHIVE, MAX_METADATA_BYTES, PLATFORM, _archive, _directory, _input_file, _main_origin, _metadata, _record, _sha, _write
from web_composite_baseline import REPO, RETAINED
from web_functional_profile import MAX_PATH_CHARS
from web_mixed_image_smoke import (
    add_functional_predecessor_options, functional_successor_baseline, functional_successor_mode, read_web_image,
    repeat_assembly, successor_baseline, successor_mode,
)
from web_release_build import origin_for, private_destination
from web_repeat_candidate import validate_repeat_mixed_report
from web_structural_delta import MAX_OPERATIONS, REGISTRY, _admit_path
from web_structural_source import _join as verify_structural_projections


MANIFEST = "web-functional-bundle.json"
INPUTS = "web-functional-inputs.json"
MIXED = "web-functional-mixed-report.json"
FILES = {INPUTS, MIXED, ARCHIVE}
KIND = "warpdrive-tested-functional-web-bundle"
BUILD_FIELDS = {"schemaVersion", "kind", "revision", "activeWebRevision", "toolingRevision", "originalBackendRevision",
                "originalBackendManifestSha256", "reviewedProfileSha256", "source", "dependencies", "context",
                "buildComponents", "deploymentAuthorized"}
STRUCTURAL_BUILD_FIELDS = BUILD_FIELDS | {"reviewedDeltaSha256", "reviewedRegistrySha256"}
SOURCE_FIELDS = {"schemaVersion", "kind", "baselineRevision", "currentRevision", "profileSha256",
                 "protectedSourceSha256", "protectedGraphSha256", "guardedWebPathCount", "changed",
                 "deploymentAuthorized"}
SOURCE_HASH_FIELDS = {"profileSha256", "protectedSourceSha256", "protectedGraphSha256", "capabilityBindingsSha256"}
STRUCTURAL_SOURCE_FIELDS = {"schemaVersion", "kind", "baselineRevision", "currentRevision", "deltaSha256", "effectsSha256",
                            "registryReviewSha256", "changed", "excludedBuildTests", "originalBackendReceiptSha256",
                            "retainedBackendInputsSha256", "protectedSource", "clientEffects", "deploymentAuthorized"}
CONTEXT_FIELDS = {"gitInventorySha256", "fileCount"}
STRUCTURAL_CONTEXT_FIELDS = CONTEXT_FIELDS | {"contextInventorySha256", "excludedPathsSha256", "excludedTestsSha256",
                                              "excludedFileCount"}


def _pins(composite, revision, origin, expected_input_sha256, installed_lineage_sha256):
    web, backend = composite["web"], composite["backend"]
    sources = {web["sourceRevision"], backend["sourceRevision"], revision}
    require(len(sources) == 3 and all(REVISION.fullmatch(source) for source in sources)
            and HASH.fullmatch(expected_input_sha256) and HASH.fullmatch(installed_lineage_sha256)
            and _main_origin(origin)["repository"] == REPO and origin["event"] == "workflow_dispatch"
            and origin["runId"] not in {web["origin"]["runId"], backend["origin"]["runId"]}
            and composite["deploymentAuthorized"] is False and composite["platform"] == PLATFORM
            and set(backend["components"]) == set(RETAINED), "Exact functional Web, baseline and hosted run authority required")
    return {"compositeSha256": content_hash(composite), "installedLineageSha256": installed_lineage_sha256,
            "inputSha256": expected_input_sha256, "activeWebRevision": web["sourceRevision"],
            "originalBackendRevision": backend["sourceRevision"]}


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _functional_source(facts):
    source, context = (facts[key] for key in ("source", "context"))
    version = source.get("schemaVersion") if type(source) is dict else None
    require(type(version) is int and version in {1, 2}
            and set(source) == (SOURCE_FIELDS | {"capabilityBindingsSha256"} if version == 2 else SOURCE_FIELDS)
            and all(isinstance(source[key], str) and HASH.fullmatch(source[key])
                    for key in SOURCE_HASH_FIELDS.intersection(source))
            and type(source["guardedWebPathCount"]) is int and source["guardedWebPathCount"] > 0
            and type(source["changed"]) is list and bool(source["changed"])
            and source["deploymentAuthorized"] is False,
            "Exact functional source proof version and protected hashes required")
    require(type(context) is dict and set(context) == CONTEXT_FIELDS
            and HASH.fullmatch(context["gitInventorySha256"]) and type(context["fileCount"]) is int
            and 0 < context["fileCount"] <= MAX_FILES, "Exact Web Docker context evidence required")
    require(source["kind"] == "warpdrive-web-functional-source" and source["currentRevision"] == facts["revision"]
            and source["baselineRevision"] == facts["toolingRevision"] and source["profileSha256"] == facts["reviewedProfileSha256"],
            "Native functional release source or retained backend inputs differ")


def _structural_paths(value, *, nonempty):
    require(type(value) is list and int(nonempty) <= len(value) <= MAX_OPERATIONS
            and all(isinstance(path, str) and len(path) <= MAX_PATH_CHARS for path in value)
            and value == sorted(set(value)) and len({path.lower() for path in value}) == len(value),
            "Exact sorted structural Web path evidence required")
    try:
        for path in value:
            safe_path(path)
    except InputError as error:
        raise CandidateError("Unsafe structural Web path evidence") from error
    return value


def _structural_context(context, excluded):
    require(type(context) is dict and set(context) == STRUCTURAL_CONTEXT_FIELDS
            and all(_matches(HASH, context[key]) for key in STRUCTURAL_CONTEXT_FIELDS
                    if key.endswith("Sha256"))
            and type(context["fileCount"]) is int and 0 < context["fileCount"] <= MAX_FILES - len(excluded)
            and type(context["excludedFileCount"]) is int and context["excludedFileCount"] == len(excluded)
            and context["excludedPathsSha256"] == content_hash(excluded),
            "Structural Web Docker context differs from the reviewed excluded tests")
    require((context["gitInventorySha256"] != context["contextInventorySha256"]) == bool(excluded)
            and (context["excludedTestsSha256"] != content_hash({})) == bool(excluded),
            "Structural Web Docker context exclusion inventory is inconsistent")


def _structural_source(facts):
    source, dependencies, context = (facts[key] for key in ("source", "dependencies", "context"))
    before, current = (facts[key] for key in ("toolingRevision", "revision"))
    effect, delta, registry = (facts[key] for key in ("reviewedProfileSha256", "reviewedDeltaSha256",
                                                      "reviewedRegistrySha256"))
    require(_matches(REVISION, before) and before not in {current, facts["activeWebRevision"]}
            and _matches(HASH, effect) and _matches(HASH, delta) and (registry is None or _matches(HASH, registry)),
            "Exact reviewed structural Web revision and profile pins required")
    require(type(source) is dict and set(source) == STRUCTURAL_SOURCE_FIELDS
            and type(source["schemaVersion"]) is int and source["schemaVersion"] == 1
            and source["kind"] == "warpdrive-web-structural-source" and source["deploymentAuthorized"] is False
            and source["baselineRevision"] == before and source["currentRevision"] == current
            and source["deltaSha256"] == delta and source["effectsSha256"] == effect
            and source["registryReviewSha256"] == registry,
            "Structural source differs from the reviewed revision or profile pins")
    require(_matches(HASH, source["originalBackendReceiptSha256"])
            and source["originalBackendReceiptSha256"] == dependencies["originalBackendReceiptSha256"]
            and _matches(HASH, source["retainedBackendInputsSha256"])
            and source["retainedBackendInputsSha256"] == dependencies.get("retainedBackendInputsSha256")
            and type(dependencies.get("schemaVersion")) is int and dependencies["schemaVersion"] == 1
            and dependencies.get("deploymentAuthorized") is False
            and dependencies.get("buildIntegrationQualified") is False,
            "Structural source and dependency evidence disagree on retained backend inputs or authority")
    verify_structural_projections({key: source[key] for key in ("protectedSource", "clientEffects")},
                                  before, current, effect)
    changed = _structural_paths(source["changed"], nonempty=True)
    excluded = _structural_paths(source["excludedBuildTests"], nonempty=False)
    require(all(any(_admit_path(path, role, "replace") for role in ("client", "style", "test", "registry-review"))
                for path in changed)
            and (registry is not None) == any(REGISTRY.fullmatch(path) for path in changed)
            and set(excluded) <= set(changed)
            and all(_admit_path(path, "test", "replace") for path in excluded),
            "Structural Web paths disagree with the reviewed registry or excluded test evidence")
    _structural_context(context, excluded)


def _evidence(raw, *, composite, revision, image_id, pins):
    facts, mixed = (decode(raw[name]) for name in (INPUTS, MIXED))
    backend, web = composite["backend"], composite["web"]
    require(IMAGE_ID.fullmatch(image_id) and image_id not in {web["image"]["imageId"],
            *(component["imageId"] for component in backend["components"].values())}, "Distinct tested Web image required")
    version = facts.get("schemaVersion") if type(facts) is dict else None
    require(type(version) is int and version in {1, 2}
            and set(facts) == (BUILD_FIELDS if version == 1 else STRUCTURAL_BUILD_FIELDS)
            and facts["kind"] == "warpdrive-functional-web-build-inputs"
            and facts["revision"] == revision and content_hash(facts) == pins["inputSha256"]
            and facts["activeWebRevision"] == web["sourceRevision"]
            and facts["originalBackendRevision"] == backend["sourceRevision"]
            and facts["originalBackendManifestSha256"] == backend["provenance"]["bundleManifestSha256"]
            and facts["buildComponents"] == ["web"] and facts["deploymentAuthorized"] is False,
            "Functional source, dependency or build context receipt differs")
    dependencies = facts["dependencies"]
    require(type(dependencies) is dict and dependencies.get("kind") == "warpdrive-web-extension-candidate-inputs"
            and dependencies.get("sourceRevision") == revision and dependencies.get("baselineRevision") == web["sourceRevision"]
            and dependencies.get("originalBackendReceiptSha256") == backend["inputReceiptSha256"]
            and dependencies.get("retainedComponentInputSha256") == {name: backend["components"][name]["inputSha256"] for name in RETAINED},
            "Native functional release source or retained backend inputs differ")
    if version == 1:
        _functional_source(facts)
    else:
        _structural_source(facts)
    image = {"imageId": image_id, "sourceRevision": revision, "generation": "wd-" + revision}
    qualification = validate_repeat_mixed_report(mixed, assembly=repeat_assembly(composite, image),
                                                 expected_harness_revision=revision, sdk_keyboard_help=True)
    return image, qualification


def _result(directory, manifest, manifest_sha, image, qualification):
    return {"revision": manifest["revision"], "origin": manifest["origin"], "baseline": manifest["baseline"],
            "image": image, "qualification": {**qualification, "reportSha256": manifest["files"][MIXED]["sha256"]},
            "bundleManifestSha256": manifest_sha, "archive": manifest["files"][ARCHIVE],
            "archivePath": directory / ARCHIVE, "deploymentAuthorized": False}


def create_functional_bundle(directory, *, input_path, mixed_path, composite, revision, origin, image_id,
                             expected_input_sha256, installed_lineage_sha256, docker):
    private_destination(directory)
    pins = _pins(composite, revision, origin, expected_input_sha256, installed_lineage_sha256)
    raw = {INPUTS: _input_file(input_path), MIXED: _input_file(mixed_path)}
    image, qualification = _evidence(raw, composite=composite, revision=revision, image_id=image_id, pins=pins)
    require(read_web_image(docker, image_id, revision) == image, "Native functional Web image differs before save")
    directory.mkdir(mode=0o700)
    docker.run(["image", "save", "--platform", PLATFORM, "--output", str(directory / ARCHIVE), image_id], timeout=600)
    with _directory(directory) as parent:
        require(os.listdir(parent) == [ARCHIVE], "Unexpected functional Web image-save inventory")
        archive, saved = _archive(parent, image_id, revision)
    require(read_web_image(docker, image_id, revision) == image, "Native functional Web image differs after save")
    manifest = {"schemaVersion": 1, "kind": KIND, "revision": revision, "platform": PLATFORM, "origin": origin,
                "baseline": pins, "imageId": image_id,
                "files": {**{name: _record(value) for name, value in raw.items()}, ARCHIVE: archive},
                "deploymentAuthorized": False}
    for name, value in raw.items():
        _write(directory, name, value)
    encoded = canonical(manifest) + b"\n"
    _write(directory, MANIFEST, encoded)
    with _directory(directory) as parent:
        os.fsync(parent)
    return _result(directory, manifest, _sha(encoded), saved, qualification)


def load_functional_bundle(directory, *, composite, revision, origin, expected_manifest_sha256,
                           expected_input_sha256, installed_lineage_sha256):
    pins = _pins(composite, revision, origin, expected_input_sha256, installed_lineage_sha256)
    with _directory(directory) as parent:
        require(set(os.listdir(parent)) == FILES | {MANIFEST}, "Functional Web bundle inventory differs")
        encoded = _metadata(parent, MANIFEST)
        require(HASH.fullmatch(expected_manifest_sha256) and _sha(encoded) == expected_manifest_sha256,
                "Functional Web bundle differs from the authenticated manifest digest")
        manifest = decode(encoded)
        require(set(manifest) == {"schemaVersion", "kind", "revision", "platform", "origin", "baseline", "imageId", "files", "deploymentAuthorized"}
                and type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] == 1 and manifest["kind"] == KIND
                and manifest["revision"] == revision and manifest["platform"] == PLATFORM and manifest["origin"] == origin
                and manifest["baseline"] == pins and manifest["deploymentAuthorized"] is False and set(manifest["files"]) == FILES,
                "Functional Web bundle source, origin or baseline differs")
        raw = {name: _metadata(parent, name) for name in (INPUTS, MIXED)}
        require(all(len(value) <= MAX_METADATA_BYTES and manifest["files"][name] == _record(value) for name, value in raw.items()),
                "Functional Web bundle metadata differs from its manifest")
        image, qualification = _evidence(raw, composite=composite, revision=revision, image_id=manifest["imageId"], pins=pins)
        _, saved = _archive(parent, image["imageId"], revision, expected=manifest["files"][ARCHIVE])
    return _result(directory, manifest, expected_manifest_sha256, saved, qualification)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("bundle-dir", "seed-root", "successor-web-bundle",
                 "successor-web-publication-receipt", "input-path", "mixed-path", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("active-web-bundle", "active-web-publication-receipt"):
        parser.add_argument("--" + name, type=Path)
    parser.add_argument("--active-web-publication-receipt-sha256")
    add_functional_predecessor_options(parser)
    for name in ("baseline-revision", "baseline-manifest-sha256",
                 "successor-web-publication-receipt-sha256", "successor-web-revision", "predecessor-lineage-sha256",
                 "installed-lineage-sha256", "new-web-image-id", "new-web-revision"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    args.browser, args.harness_revision = True, args.new_web_revision
    try:
        origin = origin_for(args.new_web_revision, os.environ)
        functional = functional_successor_mode(args)
        require(functional or successor_mode(args), "Exact retained Web and Core artifacts are required")
        reconstruct = functional_successor_baseline if functional else successor_baseline
        composite = reconstruct(args, load_bundle(args.bundle_dir, expected_revision=args.baseline_revision))
        pin = content_hash(decode(_input_file(args.input_path)))
        result = create_functional_bundle(args.output_dir, input_path=args.input_path, mixed_path=args.mixed_path,
            composite=composite, revision=args.new_web_revision, origin=origin, image_id=args.new_web_image_id,
            expected_input_sha256=pin, installed_lineage_sha256=args.installed_lineage_sha256, docker=Docker())
    except (OSError, ValueError, TypeError, KeyError, SmokeError, RuntimeError) as error:
        print(f"Functional Web bundle held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    print(json.dumps({"revision": result["revision"], "bundleManifestSha256": result["bundleManifestSha256"],
                      "deploymentAuthorized": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
