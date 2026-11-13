"""Retain the native Web SDK image and its exact source, dependency and browser proofs."""

import argparse
import json
import os
from pathlib import Path
import sys

from bundle import load_bundle
from candidate import IMAGE_ID, REVISION, require
from component_inputs import HASH, canonical, content_hash, decode
from image_smoke import Docker, SmokeError
from web_candidate import ARCHIVE, MAX_METADATA_BYTES, PLATFORM, _archive, _directory, _input_file, _main_origin, _metadata, _record, _sha, _write
from web_composite_baseline import REPO, RETAINED
from web_mixed_image_smoke import CRM_SWITCH, read_web_image, repeat_assembly, successor_baseline, successor_mode
from web_release_build import origin_for, private_destination
from web_repeat_candidate import validate_repeat_mixed_report
from web_functional_successor_source import SWITCH, SWITCH_ENTRY, SWITCH_EXPORTS


MANIFEST = "web-functional-bundle.json"
INPUTS = "web-functional-inputs.json"
MIXED = "web-functional-mixed-report.json"
FILES = {INPUTS, MIXED, ARCHIVE}
KIND = "warpdrive-tested-functional-web-bundle"
INPUT_FIELDS = {"schemaVersion", "kind", "revision", "activeWebRevision", "toolingRevision",
                "originalBackendRevision", "originalBackendManifestSha256", "reviewedProfileSha256",
                "source", "dependencies", "context", "buildComponents", "deploymentAuthorized"}
SWITCH_SOURCE_FIELDS = {"schemaVersion", "kind", "activeWebRevision", "toolingRevision", "candidateRevision",
                        "profileSha256", "toolingChanges", "carriedWebChanges", "changed", "runtimePolicySha256",
                        "engineContextTreeSha256", "originalBackendReceiptSha256", "retainedComponentInputSha256",
                        "webInputSha256", "importPolicySha256", "sdkBindings", "deploymentAuthorized"}


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


def _verify_switch_source(source, facts, dependencies, *, tooling_revision, profile_sha256):
    require(type(source) is dict and set(source) == SWITCH_SOURCE_FIELDS and type(source["schemaVersion"]) is int
            and source["schemaVersion"] == 2 and source["kind"] == "warpdrive-web-functional-successor-source"
            and source["activeWebRevision"] == facts["activeWebRevision"]
            and source["candidateRevision"] == facts["revision"]
            and source["toolingRevision"] == facts["toolingRevision"] == tooling_revision
            and source["profileSha256"] == facts["reviewedProfileSha256"] == profile_sha256
            and source["originalBackendReceiptSha256"] == dependencies["originalBackendReceiptSha256"]
            and source["retainedComponentInputSha256"] == dependencies["retainedComponentInputSha256"]
            and source["deploymentAuthorized"] is False
            and all(isinstance(source[key], str) and HASH.fullmatch(source[key]) for key in (
                "runtimePolicySha256", "engineContextTreeSha256", "webInputSha256", "importPolicySha256")),
            "Exact Switch source, profile and retained backend proof required")
    rows = source["changed"]
    require(type(rows) is list and len(rows) == 1 and type(rows[0]) is dict
            and set(rows[0]) == {"path", "beforeBlob", "afterBlob"} and rows[0]["path"] == SWITCH
            and rows[0]["beforeBlob"] != rows[0]["afterBlob"]
            and all(isinstance(rows[0][key], str) and REVISION.fullmatch(rows[0][key])
                    for key in ("beforeBlob", "afterBlob")), "Exact canonical Switch Git change required")
    bindings = source["sdkBindings"].get(SWITCH) if type(source["sdkBindings"]) is dict else None
    require(type(bindings) is list and len(bindings) == len(SWITCH_EXPORTS)
            and all(type(row) is dict and set(row) == {"specifier", "exported", "local"}
                    and row["specifier"] == SWITCH_ENTRY and row["exported"] in SWITCH_EXPORTS
                    and isinstance(row["local"], str) and row["local"] for row in bindings)
            and sorted(row["exported"] for row in bindings) == SWITCH_EXPORTS
            and len({row["local"] for row in bindings}) == len(bindings), "Exact named Switch bindings required")


def _evidence(raw, *, composite, revision, image_id, pins, sdk_scenario=None,
              expected_tooling_revision=None, expected_profile_sha256=None):
    facts, mixed = (decode(raw[name]) for name in (INPUTS, MIXED))
    backend, web = composite["backend"], composite["web"]
    switch = sdk_scenario == CRM_SWITCH
    require((sdk_scenario is None and expected_tooling_revision is None and expected_profile_sha256 is None)
            or (switch and isinstance(expected_tooling_revision, str) and REVISION.fullmatch(expected_tooling_revision)
                and expected_tooling_revision not in {revision, web["sourceRevision"], backend["sourceRevision"]}
                and isinstance(expected_profile_sha256, str) and HASH.fullmatch(expected_profile_sha256)),
            "Independent Switch tooling and profile authority required")
    fields = INPUT_FIELDS | {"sdkScenario"} if switch else INPUT_FIELDS
    require(IMAGE_ID.fullmatch(image_id) and image_id not in {web["image"]["imageId"],
            *(component["imageId"] for component in backend["components"].values())}, "Distinct tested Web image required")
    require(type(facts) is dict and set(facts) == fields and facts.get("sdkScenario") == sdk_scenario
            and facts.get("kind") == "warpdrive-functional-web-build-inputs"
            and type(facts.get("schemaVersion")) is int and facts["schemaVersion"] == (2 if switch else 1)
            and facts.get("revision") == revision and content_hash(facts) == pins["inputSha256"]
            and facts["activeWebRevision"] == web["sourceRevision"]
            and facts["originalBackendRevision"] == backend["sourceRevision"]
            and facts["originalBackendManifestSha256"] == backend["provenance"]["bundleManifestSha256"]
            and facts["buildComponents"] == ["web"] and facts["deploymentAuthorized"] is False,
            "Functional source, dependency or build context receipt differs")
    dependencies, source, context = (facts[key] for key in ("dependencies", "source", "context"))
    require(type(context) is dict and set(context) == {"gitInventorySha256", "fileCount"}
            and HASH.fullmatch(context["gitInventorySha256"]) and type(context["fileCount"]) is int
            and 0 < context["fileCount"] <= 20_000, "Exact Web Docker context evidence required")
    require(dependencies["kind"] == "warpdrive-web-extension-candidate-inputs" and dependencies["sourceRevision"] == revision
            and dependencies["baselineRevision"] == web["sourceRevision"]
            and dependencies["originalBackendReceiptSha256"] == backend["inputReceiptSha256"]
            and dependencies["retainedComponentInputSha256"] == {name: backend["components"][name]["inputSha256"] for name in RETAINED},
            "Native functional release source or retained backend inputs differ")
    if switch:
        _verify_switch_source(source, facts, dependencies, tooling_revision=expected_tooling_revision,
                              profile_sha256=expected_profile_sha256)
    else:
        require(source["kind"] == "warpdrive-web-functional-source" and source["currentRevision"] == revision
                and source["baselineRevision"] == facts["toolingRevision"] and source["profileSha256"] == facts["reviewedProfileSha256"]
                and bool(source["changed"]), "Native functional release source or retained backend inputs differ")
    image = {"imageId": image_id, "sourceRevision": revision, "generation": "wd-" + revision}
    qualification = validate_repeat_mixed_report(mixed, assembly=repeat_assembly(composite, image),
                                                 expected_harness_revision=revision, sdk_keyboard_help=True,
                                                 sdk_scenario=sdk_scenario)
    return image, qualification


def _result(directory, manifest, manifest_sha, image, qualification):
    return {"revision": manifest["revision"], "origin": manifest["origin"], "baseline": manifest["baseline"],
            "image": image, "qualification": {**qualification, "reportSha256": manifest["files"][MIXED]["sha256"]},
            "bundleManifestSha256": manifest_sha, "archive": manifest["files"][ARCHIVE],
            "archivePath": directory / ARCHIVE, "deploymentAuthorized": False}


def create_functional_bundle(directory, *, input_path, mixed_path, composite, revision, origin, image_id,
                             expected_input_sha256, installed_lineage_sha256, docker, sdk_scenario=None,
                             expected_tooling_revision=None, expected_profile_sha256=None):
    private_destination(directory)
    pins = _pins(composite, revision, origin, expected_input_sha256, installed_lineage_sha256)
    raw = {INPUTS: _input_file(input_path), MIXED: _input_file(mixed_path)}
    image, qualification = _evidence(raw, composite=composite, revision=revision, image_id=image_id, pins=pins,
        sdk_scenario=sdk_scenario, expected_tooling_revision=expected_tooling_revision,
        expected_profile_sha256=expected_profile_sha256)
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
                           expected_input_sha256, installed_lineage_sha256, sdk_scenario=None,
                           expected_tooling_revision=None, expected_profile_sha256=None):
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
        image, qualification = _evidence(raw, composite=composite, revision=revision, image_id=manifest["imageId"], pins=pins,
            sdk_scenario=sdk_scenario, expected_tooling_revision=expected_tooling_revision,
            expected_profile_sha256=expected_profile_sha256)
        _, saved = _archive(parent, image["imageId"], revision, expected=manifest["files"][ARCHIVE])
    return _result(directory, manifest, expected_manifest_sha256, saved, qualification)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("bundle-dir", "active-web-bundle", "active-web-publication-receipt", "seed-root", "successor-web-bundle",
                 "successor-web-publication-receipt", "input-path", "mixed-path", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("baseline-revision", "baseline-manifest-sha256", "active-web-publication-receipt-sha256",
                 "successor-web-publication-receipt-sha256", "successor-web-revision", "predecessor-lineage-sha256",
                 "installed-lineage-sha256", "new-web-image-id", "new-web-revision"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    args.browser, args.harness_revision = True, args.new_web_revision
    try:
        origin = origin_for(args.new_web_revision, os.environ)
        successor_mode(args)
        composite = successor_baseline(args, load_bundle(args.bundle_dir, expected_revision=args.baseline_revision))
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
