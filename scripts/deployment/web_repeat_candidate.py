"""Retain the tested repeat Web image under separately admitted A, B and C facts."""
from __future__ import annotations

import os
from pathlib import Path
import re

from bundle import INPUT_RECEIPT
from candidate import CandidateError, IMAGE_ID, REVISION, require
import component_inputs as inputs
from web_candidate import (
    ARCHIVE, CHECKS, MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES, PLATFORM, _archive, _directory,
    _input_file, _main_origin, _matches, _metadata, _record, _sha, _write,
)
from web_composite_baseline import REPO, RETAINED
from web_mixed_image_smoke import REPEAT_BROWSER_PROFILE, REPEAT_LIMITATIONS, browser_message, read_web_image
from web_repeat_inputs import verify_web_repeat_inputs
from web_repeat_source import verify_repeat_presentation_git
from web_rollout import _validate as validate_rollout
from web_switch import NAME, SwitchConflict, content_hash as runtime_hash


MANIFEST = "web-repeat-bundle.json"
PRESENTATION = "web-presentation-source.json"
ADMISSION = "web-repeat-input-admission.json"
MIXED = "web-repeat-mixed-report.json"
METADATA = (INPUT_RECEIPT, PRESENTATION, ADMISSION, MIXED)
SCHEMA_VERSION = 2
REPORT_KEYS = {"schemaVersion", "kind", "scope", "revision", "success", "startedAt", "finishedAt", "checks", "images",
               "limitations", "failure", "diagnostics", "cleanup", "deploymentAuthorized", "browserContinuityQualified",
               "browserProfile"}


def _same(first, second):
    return inputs.canonical(first) == inputs.canonical(second)


def _exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def _image(image_id, revision):
    return {"imageId": image_id, "sourceRevision": revision, "generation": "wd-" + revision}


def _plan(operation, target, before, after, backend, qualification):
    return {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": operation, "targetKey": target,
            "before": before, "after": after, "backendFingerprint": backend, "qualificationSha256": qualification}


def _validate_plan(plan):
    try:
        validate_rollout(plan)
    except (SwitchConflict, KeyError, TypeError) as error:
        raise CandidateError("Exact repeat Web rollout plan differs") from error


def _authority(composite, lineage_sha256, lineage, expected_revision, expected_harness_revision, origin):
    require(_matches(REVISION, expected_revision) and _matches(REVISION, expected_harness_revision)
            and _matches(inputs.HASH, lineage_sha256)
            and _main_origin(origin)["repository"] == REPO and origin["event"] == "workflow_dispatch",
            "Exact C source, protected harness, installed lineage pin and hosted dispatch origin required")
    require(_exact(composite, {"schemaVersion", "kind", "repository", "platform", "deploymentAuthorized", "web", "backend",
                               "qualification"}) and type(composite["schemaVersion"]) is int and composite["schemaVersion"] == 1
            and composite["kind"] == "warpdrive-web-composite-baseline" and composite["repository"] == REPO
            and composite["platform"] == PLATFORM and composite["deploymentAuthorized"] is False,
            "Independently reconstructed composite baseline required")
    web, backend = composite["web"], composite["backend"]
    require(type(web) is dict and type(backend) is dict and type(web.get("image")) is dict
            and type(backend.get("components")) is dict and set(backend["components"]) == set(RETAINED)
            and all(type(backend["components"][name]) is dict for name in RETAINED),
            "Separate active Web and original backend provenance required")
    old, original = web.get("sourceRevision"), backend.get("sourceRevision")
    require(all(_matches(REVISION, revision) for revision in (old, original))
            and len({old, original, expected_revision}) == 3, "Distinct A, B and C source pins required")
    provenance = (web.get("provenance"), backend.get("provenance"))
    require(all(type(row) is dict and all(_matches(inputs.HASH, row.get(key)) for key in
                ("bundleManifestSha256", "archiveSha256")) for row in provenance)
            and _matches(inputs.HASH, web.get("publicationReceiptSha256"))
            and _matches(IMAGE_ID, web["image"].get("imageId")), "Independently pinned A and B artifact provenance required")
    origins = [_main_origin(row.get("origin")) for row in (web, backend)]
    require(all(item["repository"] == REPO for item in origins)
            and len({origin["runId"], *(item["runId"] for item in origins)}) == 3,
            "Distinct same-repository A, B and C workflow origins required")
    if lineage is not None:
        _verify_lineage(lineage, lineage_sha256, web, backend)
    # Installed runtime identities and the privately admitted chain stay external.
    return {"compositeSha256": inputs.content_hash(composite), "installedLineageSha256": lineage_sha256,
            "activeWeb": {"revision": old, "imageId": web["image"]["imageId"], "origin": web["origin"],
                          "publicationReceiptSha256": web["publicationReceiptSha256"],
                          **{key: provenance[0][key] for key in ("bundleManifestSha256", "archiveSha256")}},
            "originalBackend": {"revision": original, "origin": backend["origin"],
                                **{key: provenance[1][key] for key in ("bundleManifestSha256", "archiveSha256")}}}


def _verify_lineage(lineage, lineage_sha256, web, backend):
    require(_exact(lineage, {"targetKey", "backendFingerprint", "acceptedOperationId", "acceptedPlanSha256",
                             "active", "previous"})
            and all(_matches(NAME, lineage[name]) for name in ("targetKey", "acceptedOperationId"))
            and all(_matches(inputs.HASH, lineage[name]) for name in ("backendFingerprint", "acceptedPlanSha256"))
            and inputs.content_hash(lineage) == lineage_sha256,
            "Independently admitted installed lineage required")
    for key, bundle in (("active", web), ("previous", backend)):
        item = lineage[key]
        revision = bundle["sourceRevision"]
        require(_exact(item, {"slot", "alias", "provenance", "receiptSha256"})
                and _matches(NAME, item["alias"]) and _matches(inputs.HASH, item["receiptSha256"])
                and _exact(item["slot"], {"route", "runtime"}) and type(item["slot"]["runtime"]) is dict
                and _exact(item["provenance"], {"repository", "revision", "manifestSha256", "archiveSha256",
                                                "testedConfigDigest", "authoritySha256"}),
                "Installed generation custody is incomplete")
        installed, runtime = item["provenance"], item["slot"]["runtime"]
        require(installed["repository"] == REPO and installed["revision"] == revision
                and installed["manifestSha256"] == bundle["provenance"]["bundleManifestSha256"]
                and installed["archiveSha256"] == bundle["provenance"]["archiveSha256"]
                and _matches(inputs.HASH, installed["authoritySha256"]) and _matches(IMAGE_ID, installed["testedConfigDigest"])
                and runtime.get("sourceRevision") == revision and runtime.get("name") == item["alias"],
                "Installed generation differs from independently reconstructed artifact custody")
        if key == "active":
            require(installed["authoritySha256"] == web["publicationReceiptSha256"]
                    and installed["testedConfigDigest"] == web["image"]["imageId"],
                    "Installed B differs from the authenticated active Web artifact")
    previous, active = (lineage[key] for key in ("previous", "active"))
    require(previous["receiptSha256"] != active["receiptSha256"] and previous["alias"] != active["alias"]
            and previous["provenance"]["testedConfigDigest"] != active["provenance"]["testedConfigDigest"],
            "Installed A and B must be independently retained")
    _validate_plan(_plan(lineage["acceptedOperationId"], lineage["targetKey"], previous["slot"], active["slot"],
                         lineage["backendFingerprint"], "0" * 64))


def _assembly(composite, baseline, image):
    web, backend = baseline["activeWeb"], baseline["originalBackend"]
    return {"activeWebRevision": web["revision"], "activeWebImage": _image(web["imageId"], web["revision"]),
            "activeWebManifestSha256": web["bundleManifestSha256"], "activeWebArchiveSha256": web["archiveSha256"],
            "activeWebPublicationReceiptSha256": web["publicationReceiptSha256"], "originalBackendRevision": backend["revision"],
            "originalBackendManifestSha256": backend["bundleManifestSha256"],
            "originalBackendArchiveSha256": backend["archiveSha256"],
            "retainedBackendImages": {name: composite["backend"]["components"][name]["imageId"] for name in RETAINED},
            "newWeb": image, "fixtureBuilds": 0, "compositeSha256": baseline["compositeSha256"]}


def _phase(value, expected):
    try:
        return browser_message(value, repeat=True)["phase"] == expected
    except (KeyError, TypeError, ValueError, RuntimeError):
        return False


def _exact_number(value, expected):
    return type(value) is int and value == expected


def _identity(value, revision):
    return (_exact(value, {"contract", "component", "version", "sourceRevision"})
            and value["contract"] == "warpdrive.web.identity.v1" and value["component"] == "web"
            and value["sourceRevision"] == revision and isinstance(value["version"], str)
            and re.fullmatch(r"[A-Za-z0-9.+-]{1,128}", value["version"]))


def _native_runtime(detail, assembly):
    migrations = detail.get("migrations")
    schema = detail.get("schemaSha256")
    require(_matches(inputs.HASH, schema) and _matches(inputs.HASH, detail.get("commonWebConfigSha256"))
            and detail.get("migratorImageId") == assembly["retainedBackendImages"]["migrator"]
            and _exact(migrations, {"successfulRuns", "canonicalMigrationCount", "emptyFiles", "runtimeRole",
                                    "ownerCredentialsRuntime", "deniedDdl"})
            and _exact_number(migrations["successfulRuns"], 2) and _exact_number(migrations["deniedDdl"], 5)
            and type(migrations["canonicalMigrationCount"]) is int and migrations["canonicalMigrationCount"] > 0
            and migrations["emptyFiles"] is True and migrations["runtimeRole"] == "smoke_runtime"
            and migrations["ownerCredentialsRuntime"] is False, "Repeat fixture retained migration or schema proof differs")
    return schema


def _native_qualification(detail, assembly, schema):
    qualification = detail.get("qualification")
    require(_exact(qualification, {"assembly", "protectedRuntimes", "backendFingerprint", "webStartTimes", "web", "slots"})
            and _same(qualification["assembly"], assembly)
            and detail.get("qualificationSha256") == runtime_hash(qualification), "Repeat fixture qualification differs")
    protected = qualification["protectedRuntimes"]
    require(_exact(protected, {"postgres", "worker", "realtime", "caddy"})
            and all(_exact(row, {"runtimeId", "imageId", "restartCount", "startedAt", "configSha256"})
                    and _matches(inputs.HASH, row["runtimeId"]) and _matches(inputs.HASH, row["configSha256"])
                    and _matches(IMAGE_ID, row["imageId"]) and _exact_number(row["restartCount"], 0)
                    and isinstance(row["startedAt"], str) and re.fullmatch(r"20\d\d-\d\d-\d\dT[0-9:.]{8,24}Z", row["startedAt"])
                    for row in protected.values())
            and all(protected[name]["imageId"] == assembly["retainedBackendImages"][name] for name in ("worker", "realtime"))
            and len({row["runtimeId"] for row in protected.values()}) == 4
            and qualification["backendFingerprint"] == runtime_hash(protected), "Protected repeat fixture backend differs")
    images = (assembly["activeWebImage"], assembly["newWeb"])
    generations = [image["generation"] for image in images]
    slots, direct, starts = (qualification[key] for key in ("slots", "web", "webStartTimes"))
    require(_exact(slots, generations) and _exact(direct, generations) and type(starts) is dict and len(starts) == 2,
            "Exact repeat fixture Web slots and direct observations required")
    for generation, image in zip(generations, images):
        slot, observed = slots[generation], direct[generation]
        require(_exact(slot, {"runtime", "route"}) and type(slot["runtime"]) is dict and type(slot["route"]) is dict
                and slot["runtime"].get("imageId") == image["imageId"]
                and slot["runtime"].get("sourceRevision") == image["sourceRevision"]
                and slot["runtime"].get("schemaSha256") == schema
                and _exact_number(slot["runtime"].get("restartCount"), 0)
                and _exact(observed, {"identity", "pageAssetCount", "assets"})
                and _identity(observed["identity"], image["sourceRevision"])
                and type(observed["pageAssetCount"]) is int and 2 <= observed["pageAssetCount"] <= 512
                and _exact(observed["assets"], {"css", "js"}), "Exact repeat Web identity, source or asset proof differs")
        for kind, asset in observed["assets"].items():
            require(_exact(asset, {"path", "bytes", "sha256"}) and _matches(inputs.HASH, asset["sha256"])
                    and type(asset["bytes"]) is int and 0 < asset["bytes"] <= 4 * 1024**2
                    and isinstance(asset["path"], str) and len(asset["path"]) <= 1024
                    and re.fullmatch(r"/_next/static/[A-Za-z0-9_.@()+%~/\[\]-]+\." + kind + r"\?dpl=" + generation,
                                     asset["path"]), "Repeat Web asset readback differs")
    _validate_plan(_plan("validate", "fixture", slots[generations[0]], slots[generations[1]],
                         qualification["backendFingerprint"], detail["qualificationSha256"]))
    require(set(starts) == {slot["runtime"]["name"] for slot in slots.values()}
            and all(isinstance(value, str) and re.fullmatch(r"20\d\d-\d\d-\d\dT[0-9:.]{8,24}Z", value)
                    for value in starts.values())
            and not ({row["runtimeId"] for row in protected.values()} & {slot["runtime"]["runtimeId"] for slot in slots.values()}),
            "Repeat fixture Web process identities differ")
    return qualification, generations


def _transition(detail, *, state, operation, generation, assets, writes, schema, qualification):
    receipt, ingress = (detail.get(key) for key in ("receipt", "ingress"))
    backend = qualification["backendFingerprint"]
    old, new = (qualification["assembly"][key]["generation"] for key in ("activeWebImage", "newWeb"))
    before, after = (new, old) if operation == "rollback" else (old, new)
    slots = qualification["slots"]
    target = slots[old]["runtime"]["name"].removesuffix("-web-a")
    plan = _plan(operation, target, slots[before], slots[after], backend, runtime_hash(qualification))
    require(_exact_number(detail.get("routeWrites"), writes) and detail.get("repeatReadOnly") is True
            and _exact(receipt, {"schemaVersion", "kind", "operationId", "planSha256", "state", "backendFingerprint",
                                 "acceptedGeneration"})
            and _exact_number(receipt["schemaVersion"], 1) and receipt["kind"] == "warpdrive-web-rollout-receipt"
            and receipt["operationId"] == operation and receipt["planSha256"] == runtime_hash(plan)
            and receipt["state"] == state and receipt["acceptedGeneration"] == generation
            and receipt["backendFingerprint"] == backend
            and _exact(ingress, {"activeGeneration", "identity", "verifiedAssetGenerations", "verifiedAssetsPerGeneration",
                                 "unknownGenerationStatus", "backendFingerprint", "schemaSha256"})
            and ingress["activeGeneration"] == generation and ingress["identity"] == qualification["web"][generation]["identity"]
            and ingress["verifiedAssetGenerations"] == assets and _exact_number(ingress["verifiedAssetsPerGeneration"], 2)
            and _exact_number(ingress["unknownGenerationStatus"], 409)
            and ingress["backendFingerprint"] == backend and ingress["schemaSha256"] == schema,
            "Repeat forward, reversal or automatic rollback proof differs")


def validate_repeat_mixed_report(report, *, assembly, expected_harness_revision):
    """Validate exact B/C continuity, protected A runtimes and rollback in owned staging."""
    profile = {"kind": REPEAT_BROWSER_PROFILE, "harnessRevision": expected_harness_revision,
               "seedRevision": assembly["originalBackendRevision"]}
    require(_exact(report, REPORT_KEYS) and _exact_number(report["schemaVersion"], SCHEMA_VERSION)
            and report["kind"] == "warpdrive-native-repeat-web-smoke" and report["scope"] == "owned-native-staging-fixture"
            and report["revision"] == assembly["activeWebRevision"] and report["success"] is True and report["failure"] is None
            and report["deploymentAuthorized"] is False and report["browserContinuityQualified"] is True
            and all(isinstance(report[key], str) and re.fullmatch(
                r"20\d\d-\d\d-\d\dT[0-9:.]{8,24}(?:Z|\+00:00)", report[key]) for key in ("startedAt", "finishedAt"))
            and report["diagnostics"] == [] and report["limitations"] == REPEAT_LIMITATIONS
            and _same(report["images"], assembly) and _same(report["browserProfile"], profile),
            "Exact native repeat Web assembly and browser profile required")
    checks = report["checks"]
    require(type(checks) is list and len(checks) == len(CHECKS)
            and all(_exact(row, {"name", "status", "detail"}) and row["name"] == name
                    and row["status"] == "passed" and type(row["detail"]) is dict for row, name in zip(checks, CHECKS)),
            "Complete ordered native repeat Web checks required")
    loaded, runtimes, caddy, initial, forward, browser, reverse, automatic = [row["detail"] for row in checks]
    require(_same(loaded, assembly), "Native repeat image inspection differs")
    schema = _native_runtime(runtimes, assembly)
    qualification, generations = _native_qualification(caddy, assembly, schema)
    old, new = generations
    old_name = qualification["slots"][old]["runtime"]["name"]
    new_name = qualification["slots"][new]["runtime"]["name"]
    require(re.fullmatch(r"wd-image-smoke-[a-f0-9]{12}-web-a", old_name)
            and new_name == old_name.removesuffix("-a") + "-b", "Repeat fixture Web slot ownership differs")
    require(_phase(initial.get("initial"), "initial-ready") and initial.get("freshBoundBaselineSeed") is True
            and initial.get("forgedSession") is False and _exact_number(initial.get("matchingActivityRows"), 0)
            and _phase(browser.get("preSwitch"), "pre-switch-ready") and _phase(browser.get("complete"), "complete")
            and _exact_number(browser.get("matchingActivityRows"), 1) and browser.get("generatedLoopbackTls") is True,
            "Repeat browser continuity and exactly-one durable Activity write required")
    for detail, operation, state, generation, assets, writes in (
        (forward, "forward", "accepted", new, generations, 1),
        (reverse, "rollback", "accepted", old, generations, 1),
        (automatic, "candidate-fault", "rolled-back", old, [old], 2),
    ):
        _transition(detail, state=state, operation=operation, generation=generation, assets=assets, writes=writes,
                    schema=schema, qualification=qualification)
    require(automatic.get("candidateStopped") is True, "Automatic reversal must observe stopped C")
    cleanup = report["cleanup"]
    require(_exact(cleanup, {"success", "errors", "fixtureResourcesAbsent", "closedRelays"})
            and cleanup["success"] is True and cleanup["errors"] == [] and cleanup["fixtureResourcesAbsent"] is True
            and type(cleanup["closedRelays"]) is list and len(cleanup["closedRelays"]) == 5
            and all(type(row) is dict and row.get("closed") is True and all(_exact_number(row.get(key), 0)
                    for key in ("openSockets", "activeConnections", "ownershipFailures", "streamLimitReached"))
                    for row in cleanup["closedRelays"]), "Repeat Web fixture cleanup is incomplete")
    return {"fixtureQualificationSha256": caddy["qualificationSha256"],
            "fixtureBackendFingerprint": qualification["backendFingerprint"], "fixtureSchemaSha256": schema}


def _check_source(root, revision, composite, candidate_inputs, presentation, tooling_revision):
    active = composite["web"]
    tooling = verify_repeat_presentation_git(root, presentation, active_inputs=active["inputReceipt"],
                                              active_revision=active["sourceRevision"], tooling_revision=tooling_revision)
    inputs.verify_current(root, candidate_inputs, expected_revision=revision)
    return tooling if tooling_revision is not None else None


def _admission(composite, revision, profile, current, presentation, tooling):
    return verify_web_repeat_inputs(composite=composite, active_inputs=composite["web"]["inputReceipt"],
                                    candidate_inputs=current, presentation=presentation,
                                    expected_candidate_revision=revision, expected_profile_sha256=profile, tooling=tooling)


def _evidence(raw, composite, lineage, baseline, revision, profile, harness, image_id, tooling_revision):
    require(_matches(IMAGE_ID, image_id) and image_id not in {
        baseline["activeWeb"]["imageId"],
        *(composite["backend"]["components"][name]["imageId"] for name in RETAINED),
    } and (lineage is None or image_id != lineage["previous"]["provenance"]["testedConfigDigest"]),
            "Distinct immutable C Web image required")
    current, presentation, admission, mixed = (inputs.decode(raw[name]) for name in METADATA)
    require(type(admission) is dict, "Exact repeat input admission required")
    tooling = admission.get("toolingTransition")
    require((tooling_revision is None and tooling is None)
            or (_matches(REVISION, tooling_revision) and type(tooling) is dict
                and tooling.get("toolingRevision") == tooling_revision),
            "Repeat candidate tooling source differs from its external pin")
    expected = _admission(composite, revision, profile, current, presentation, tooling)
    require(_same(admission, expected), "Repeat candidate input admission differs")
    image = _image(image_id, revision)
    qualification = validate_repeat_mixed_report(mixed, assembly=_assembly(composite, baseline, image),
                                                 expected_harness_revision=harness)
    return image, expected, qualification


def _result(directory, manifest, manifest_sha, image, admission, qualification):
    files = manifest["files"]
    return {"candidate": {"schemaVersion": SCHEMA_VERSION, "kind": "warpdrive-tested-repeat-web-candidate",
                          "releaseRevision": manifest["revision"], "platform": PLATFORM, "image": image,
                          "baseline": manifest["baseline"], "inputProvenance": admission,
                          "qualification": {"state": "native-repeat-web-browser-passed", "checks": list(CHECKS),
                                            "reportSha256": files[MIXED]["sha256"], **qualification,
                                            "limitations": list(REPEAT_LIMITATIONS)},
                          "deploymentAuthorized": False},
            "origin": manifest["origin"], "archivePath": directory / ARCHIVE,
            "provenance": {"archiveSha256": files[ARCHIVE]["sha256"], "archiveSizeBytes": files[ARCHIVE]["sizeBytes"],
                           "bundleManifestSha256": manifest_sha, "inputReceiptFileSha256": files[INPUT_RECEIPT]["sha256"],
                           "presentationFileSha256": files[PRESENTATION]["sha256"],
                           "admissionFileSha256": files[ADMISSION]["sha256"]}}


def create_repeat_web_bundle(
    root: Path, output_dir: Path, *, expected_revision: str, composite: dict, expected_installed_lineage_sha256: str,
    presentation: dict, expected_profile_sha256: str, expected_harness_revision: str, input_receipt_path: Path,
    mixed_report_path: Path, candidate_web_image_id: str, origin: dict, docker, installed_lineage: dict | None = None,
    expected_tooling_revision: str | None = None,
) -> dict:
    """Package the same immutable C image observed by the hosted native fixture."""
    baseline = _authority(composite, expected_installed_lineage_sha256, installed_lineage, expected_revision,
                          expected_harness_revision, origin)
    root, output_dir = Path(root), Path(output_dir)
    require(root.is_absolute() and root == root.resolve(strict=True) and output_dir.is_absolute()
            and output_dir.parent == output_dir.parent.resolve(strict=True) and not output_dir.is_relative_to(root)
            and not os.path.lexists(output_dir), "Fresh repeat bundle directory outside exact source required")
    raw = {INPUT_RECEIPT: _input_file(input_receipt_path), MIXED: _input_file(mixed_report_path),
           PRESENTATION: inputs.canonical(presentation) + b"\n"}
    current = inputs.decode(raw[INPUT_RECEIPT])
    tooling = _check_source(root, expected_revision, composite, current, presentation, expected_tooling_revision)
    raw[ADMISSION] = inputs.canonical(_admission(composite, expected_revision, expected_profile_sha256,
                                                current, presentation, tooling)) + b"\n"
    image, admission, qualification = _evidence(raw, composite, installed_lineage, baseline, expected_revision,
                                               expected_profile_sha256, expected_harness_revision, candidate_web_image_id,
                                               expected_tooling_revision)
    require(read_web_image(docker, candidate_web_image_id, expected_revision) == image, "Native tested C image changed")
    output_dir.mkdir(mode=0o700)
    docker.run(["image", "save", "--platform", PLATFORM, "--output", str(output_dir / ARCHIVE), candidate_web_image_id], timeout=600)
    with _directory(output_dir) as parent:
        require(os.listdir(parent) == [ARCHIVE], "Unexpected repeat Web image-save inventory")
        archive, saved = _archive(parent, candidate_web_image_id, expected_revision)
    require(read_web_image(docker, candidate_web_image_id, expected_revision) == image, "Saved tested C image changed")
    inputs.verify_source_revision(root, current, expected_revision)
    manifest = {"schemaVersion": SCHEMA_VERSION, "kind": "warpdrive-tested-repeat-web-bundle",
                "revision": expected_revision, "platform": PLATFORM, "origin": origin, "baseline": baseline,
                "harnessRevision": expected_harness_revision, "imageId": candidate_web_image_id,
                "files": {**{name: _record(value) for name, value in raw.items()}, ARCHIVE: archive},
                "deploymentAuthorized": False}
    for name, value in raw.items():
        _write(output_dir, name, value)
    encoded = inputs.canonical(manifest) + b"\n"
    _write(output_dir, MANIFEST, encoded)
    with _directory(output_dir) as parent:
        os.fsync(parent)
    return _result(output_dir, manifest, _sha(encoded), saved, admission, qualification)


def load_repeat_web_bundle(
    directory: Path, *, expected_revision: str, expected_manifest_sha256: str, composite: dict,
    expected_installed_lineage_sha256: str, expected_profile_sha256: str, expected_harness_revision: str,
    expected_origin: dict, installed_lineage: dict | None = None, expected_tooling_revision: str | None = None,
) -> dict:
    """Verify an exact repeat candidate from external artifact, lineage and origin pins."""
    baseline = _authority(composite, expected_installed_lineage_sha256, installed_lineage, expected_revision,
                          expected_harness_revision, expected_origin)
    require(_matches(inputs.HASH, expected_manifest_sha256), "External repeat manifest digest required")
    directory = Path(directory)
    with _directory(directory) as parent:
        require(set(os.listdir(parent)) == {MANIFEST, ARCHIVE, *METADATA}, "Unexpected repeat Web bundle inventory")
        encoded = _metadata(parent, MANIFEST)
        require(_sha(encoded) == expected_manifest_sha256, "Repeat bundle manifest differs from its external pin")
        manifest = inputs.decode(encoded)
        require(_exact(manifest, {"schemaVersion", "kind", "revision", "platform", "origin", "baseline",
                                  "harnessRevision", "imageId", "files", "deploymentAuthorized"})
                and _exact_number(manifest["schemaVersion"], SCHEMA_VERSION)
                and manifest["kind"] == "warpdrive-tested-repeat-web-bundle" and manifest["platform"] == PLATFORM
                and manifest["deploymentAuthorized"] is False and manifest["revision"] == expected_revision
                and manifest["harnessRevision"] == expected_harness_revision and _same(manifest["baseline"], baseline)
                and _same(manifest["origin"], expected_origin), "Repeat Web manifest authority differs")
        files = manifest["files"]
        require(_exact(files, {ARCHIVE, *METADATA}) and all(
            _exact(row, {"sha256", "sizeBytes"}) and _matches(inputs.HASH, row["sha256"])
            and type(row["sizeBytes"]) is int and 0 < row["sizeBytes"] <= (MAX_ARCHIVE_BYTES if name == ARCHIVE else MAX_METADATA_BYTES)
            for name, row in files.items()), "Exact bounded repeat bundle file records required")
        raw = {name: _metadata(parent, name) for name in METADATA}
        require(all(_record(value) == files[name] for name, value in raw.items()), "Repeat bundle metadata changed")
        image, admission, qualification = _evidence(raw, composite, installed_lineage, baseline, expected_revision,
                                                   expected_profile_sha256, expected_harness_revision, manifest["imageId"],
                                                   expected_tooling_revision)
        _, saved = _archive(parent, image["imageId"], expected_revision, expected=files[ARCHIVE])
    return _result(directory, manifest, expected_manifest_sha256, saved, admission, qualification)
