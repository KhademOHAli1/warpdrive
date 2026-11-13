"""Admit exact Web-only inputs against a separately verified composite baseline."""

from copy import deepcopy

from candidate import IMAGE_ID, REVISION, require
import component_inputs as inputs
from web_composite_baseline import REPO, RETAINED


_PRESENTATION_KEYS = {"schemaVersion", "kind", "profileSha256", "baselineRevision", "currentRevision",
                      "protectedSourceSha256", "guardedWebPathsSha256", "guardedWebPathCount", "changed",
                      "deploymentAuthorized"}
_COMPOSITE_KEYS = {"schemaVersion", "kind", "repository", "platform", "deploymentAuthorized", "web", "backend", "qualification"}
_FIXTURE_HASHES = ("reportSha256", "fixtureQualificationSha256", "fixtureBackendFingerprint", "fixtureSchemaSha256")


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _presentation_paths(presentation, *, profile, before, after):
    require(type(presentation) is dict and set(presentation) == _PRESENTATION_KEYS
            and type(presentation["schemaVersion"]) is int and presentation["schemaVersion"] == 1
            and presentation["kind"] == "warpdrive-web-presentation-source" and presentation["deploymentAuthorized"] is False
            and _matches(inputs.HASH, profile) and presentation["profileSha256"] == profile
            and presentation["baselineRevision"] == before and presentation["currentRevision"] == after
            and all(_matches(inputs.HASH, presentation[key]) for key in ("protectedSourceSha256", "guardedWebPathsSha256"))
            and type(presentation["guardedWebPathCount"]) is int
            and 0 < presentation["guardedWebPathCount"] <= inputs.MAX_FILES,
            "Presentation proof differs from the selected source or reviewed profile")
    changed = presentation["changed"]
    require(type(changed) is list and 0 < len(changed) <= min(128, presentation["guardedWebPathCount"]),
            "Bounded changed presentation paths required")
    paths = []
    for row in changed:
        require(type(row) is dict and set(row) == {"path", "kind", "baselineBlob", "currentBlob"}
                and row["kind"] in ("style", "copy", "component")
                and all(_matches(REVISION, row[key]) for key in ("baselineBlob", "currentBlob"))
                and row["baselineBlob"] != row["currentBlob"], "Exact changed presentation Git blobs required")
        paths.append(inputs.safe_path(row["path"]))
    require(paths == sorted(set(paths)), "Unique ordered presentation paths required")
    return paths


def verify_web_repeat_inputs(
    *, composite: dict, active_inputs: dict, candidate_inputs: dict, presentation: dict,
    expected_candidate_revision: str, expected_profile_sha256: str, tooling: dict | None = None,
) -> dict:
    """Check trusted presentation and artifact evidence against fresh component inputs.

    The caller supplies a verified composite baseline, fresh input discovery
    checked at each exact source revision, and the output of the reviewed Git
    presentation policy, which establishes ancestry. This helper runs no source
    discovery and grants no publication or deployment authority.
    """
    inputs.validate_receipt(active_inputs)
    inputs.validate_receipt(candidate_inputs)
    require(type(composite) is dict and set(composite) == _COMPOSITE_KEYS and type(composite["schemaVersion"]) is int
            and composite["schemaVersion"] == 1 and composite["kind"] == "warpdrive-web-composite-baseline"
            and composite["repository"] == REPO and composite["deploymentAuthorized"] is False,
            "Verified composite Web baseline required")
    web, backend, qualification = (composite[key] for key in ("web", "backend", "qualification"))
    require(all(type(item) is dict for item in (web, backend, qualification)), "Complete composite baseline evidence required")
    old, original = web.get("sourceRevision"), backend.get("sourceRevision")
    revisions = (old, original, expected_candidate_revision)
    require(all(_matches(REVISION, revision) for revision in revisions) and len(set(revisions)) == 3,
            "Distinct exact active Web, original backend and candidate source required")
    require(all(_matches(inputs.HASH, qualification.get(key)) for key in _FIXTURE_HASHES)
            and qualification.get("retainedComponentInputsEqual") is True,
            "Composite fixture schema and backend proof required")
    old_image = web.get("image")
    require(type(old_image) is dict and old_image.get("sourceRevision") == old and old_image.get("generation") == "wd-" + old
            and _matches(IMAGE_ID, old_image.get("imageId"))
            and _matches(inputs.HASH, web.get("publicationReceiptSha256"))
            and _matches(inputs.HASH, backend.get("inputReceiptSha256")), "Composite active Web artifact evidence differs")
    active_hash, candidate_hash = map(inputs.content_hash, (active_inputs, candidate_inputs))
    require(web.get("inputReceiptSha256") == active_hash and inputs.canonical(web.get("inputReceipt")) == inputs.canonical(active_inputs),
            "Fresh active Web inputs differ from the admitted Web artifact")
    require(active_inputs["context"]["platform"] == composite["platform"] == "linux/amd64"
            and inputs.canonical(active_inputs["context"]) == inputs.canonical(candidate_inputs["context"])
            and active_inputs["inputPolicySha256"] == candidate_inputs["inputPolicySha256"]
            and inputs.canonical(active_inputs["policy"]) == inputs.canonical(candidate_inputs["policy"]),
            "Immutable Web build context or component discovery policy changed")

    retained = backend.get("components")
    require(type(retained) is dict and set(retained) == set(RETAINED), "Exact retained backend artifact inventory required")
    old_components, new_components = active_inputs["components"], candidate_inputs["components"]
    for name in RETAINED:
        image = retained[name]
        require(type(image) is dict and image.get("sourceRevision") == original and _matches(IMAGE_ID, image.get("imageId"))
                and image.get("inputPolicySha256") == active_inputs["inputPolicySha256"]
                and image.get("inputSha256") == old_components[name]["componentInputSha256"]
                and inputs.canonical(old_components[name]) == inputs.canonical(new_components[name]),
                "A retained backend artifact or its exact component inputs changed")
    require(len({old_image["imageId"], *(retained[name]["imageId"] for name in RETAINED)}) == 4,
            "Distinct active Web and retained backend artifact identities required")

    before = old
    tooling_paths = []
    if tooling is not None:
        require(type(tooling) is dict and set(tooling) == {"activeWebRevision", "toolingRevision", "candidateRevision",
                "toolingPaths", "toolingSourceSha256"} and tooling["activeWebRevision"] == old
                and tooling["candidateRevision"] == expected_candidate_revision and _matches(REVISION, tooling["toolingRevision"])
                and _matches(inputs.HASH, tooling["toolingSourceSha256"]), "Exact verified repeat tooling transition required")
        before = tooling["toolingRevision"]
        tooling_paths = tooling["toolingPaths"]
        require(before not in revisions and type(tooling_paths) is list and 0 < len(tooling_paths) <= 128
                and tooling_paths == sorted({inputs.safe_path(path) for path in tooling_paths}), "Invalid repeat tooling paths")
    paths = _presentation_paths(presentation, profile=expected_profile_sha256, before=before, after=expected_candidate_revision)
    require(set(paths).isdisjoint(tooling_paths), "Repeat tooling overlaps the presentation delta")
    previous, current = old_components["web"], new_components["web"]
    before_records = {row["path"]: row for row in previous["inputs"]}
    after_records = {row["path"]: row for row in current["inputs"]}
    require(all(previous[key] == current[key] for key in previous.keys() - {"inputs", "componentInputSha256"})
            and previous["componentInputSha256"] != current["componentInputSha256"]
            and before_records.keys() <= after_records.keys()
            and sorted(path for path in after_records if before_records.get(path) != after_records[path]) == sorted(paths + tooling_paths)
            and all(path in before_records and path in after_records for path in paths)
            and all(before_records[path]["sha256"] != after_records[path]["sha256"] for path in paths),
            "Web graph or exact changed input paths differ from presentation proof")

    admission = {"schemaVersion": 1 if tooling is None else 2, "kind": "warpdrive-web-repeat-input-admission", "repository": REPO,
            "activeWebRevision": old, "originalBackendRevision": original, "candidateRevision": expected_candidate_revision,
            "compositeSha256": inputs.content_hash(composite), "presentationSha256": inputs.content_hash(presentation),
            "presentationProfileSha256": expected_profile_sha256, "activeInputReceiptSha256": active_hash,
            "candidateInputReceiptSha256": candidate_hash, "candidateWebInputSha256": current["componentInputSha256"],
            "buildContextSha256": inputs.content_hash(active_inputs["context"]),
            "inputPolicySha256": active_inputs["inputPolicySha256"], "changedPresentationPaths": paths,
            "retainedComponents": deepcopy(retained), "buildComponents": ["web"], "deploymentAuthorized": False}
    if tooling is not None:
        admission["toolingTransition"] = deepcopy(tooling)
    return admission
