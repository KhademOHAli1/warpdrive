"""Revalidate a hosted functional Web bundle for the next Web-only qualification."""

from hashlib import sha256

from candidate import CandidateError, IMAGE_ID, REVISION, require
from component_inputs import HASH, canonical, decode
from web_baseline import artifact_for_run, successful_main_run
from web_candidate import MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES, PLATFORM, _main_origin
from web_composite_baseline import REPO, RETAINED
from web_functional_candidate import load_functional_bundle
from web_functional_publication import CATEGORIES, JOB, MAX_ZIP_BYTES, STEPS, WORKFLOW, functional_policy
from web_successor_lineage import _original_backend


COMPOSITE_KIND = "warpdrive-web-composite-baseline"
PUBLICATION_KIND = "warpdrive-web-functional-publication-admission"
QUALIFICATION_KEYS = {"reportSha256", "fixtureQualificationSha256", "fixtureBackendFingerprint", "fixtureSchemaSha256"}


def _exact(value, keys):
    return type(value) is dict and set(value) == keys


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _positive(value, maximum=2**53 - 1):
    return type(value) is int and 0 < value <= maximum


def _artifact(artifact, name):
    require(_exact(artifact, {"id", "name", "digest", "sizeBytes"}) and _positive(artifact["id"])
            and artifact["name"] == name and _matches(IMAGE_ID, artifact["digest"])
            and _positive(artifact["sizeBytes"], MAX_ZIP_BYTES),
            "Functional publication artifact differs")


def _hosted_evidence(receipt, origin):
    ci, security = receipt["ci"], receipt["security"]
    require(type(ci) is list and 0 < len(ci) <= 32
            and all(_exact(row, {"workflow", "run_id", "url", "attempt", "jobs"})
                    and isinstance(row["workflow"], str) and _positive(row["run_id"]) and _positive(row["attempt"])
                    and row["url"] == f"https://github.com/{REPO}/actions/runs/{row['run_id']}"
                    and type(row["jobs"]) is list and bool(row["jobs"])
                    and all(isinstance(job, str) and job for job in row["jobs"]) for row in ci),
            "Functional publication lacks bounded hosted CI evidence")
    require(len({row["workflow"] for row in ci}) == len(ci), "Functional publication CI workflows must be distinct")
    selected = [row for row in ci if row["workflow"] == WORKFLOW]
    require(len(selected) == 1 and selected[0]["run_id"] == origin["runId"]
            and selected[0]["attempt"] == origin["runAttempt"] and selected[0]["jobs"] == [JOB],
            "Functional publication CI attempt differs from its artifact origin")
    require({row["workflow"]: row["jobs"] for row in ci} == functional_policy()["required_workflows"],
            "Functional publication does not contain the complete required CI job mapping")
    require(_exact(security, {"tool", "revision", "ref", "analysis_ids", "categories", "open_alerts",
                             "blocking_alerts", "main_bound_before_and_after", "limit"})
            and security["tool"] == "CodeQL" and security["revision"] == receipt["revision"]
            and security["ref"] == origin["ref"] and security["categories"] == sorted(CATEGORIES)
            and type(security["analysis_ids"]) is list and len(CATEGORIES) <= len(security["analysis_ids"]) <= 128
            and all(_positive(value) for value in security["analysis_ids"])
            and security["analysis_ids"] == sorted(set(security["analysis_ids"]))
            and type(security["open_alerts"]) is int and security["open_alerts"] >= 0
            and type(security["blocking_alerts"]) is int and security["blocking_alerts"] == 0
            and security["main_bound_before_and_after"] is True,
            "Functional publication lacks exact-source security evidence")


def verify_functional_publication(publication_bytes, *, expected_publication_sha256, expected_revision):
    """Verify immutable v1 admission bytes against an external receipt pin.

    This historical readback assumes the pin comes from independently admitted
    publication evidence. Current-main security policy and live GitHub queries
    belong to the publication gate that originally produced this receipt.
    """
    require(type(publication_bytes) is bytes and 0 < len(publication_bytes) <= MAX_METADATA_BYTES
            and _matches(HASH, expected_publication_sha256)
            and sha256(publication_bytes).hexdigest() == expected_publication_sha256
            and _matches(REVISION, expected_revision), "Separately pinned functional Web publication bytes required")
    receipt = decode(publication_bytes)
    require(_exact(receipt, {"schemaVersion", "kind", "repository", "revision", "workflow", "origin", "jobId",
                             "artifact", "ci", "security", "baseline", "image", "provenance", "qualification",
                             "deploymentAuthorized"})
            and type(receipt["schemaVersion"]) is int and receipt["schemaVersion"] == 1
            and receipt["kind"] == PUBLICATION_KIND and receipt["repository"] == REPO
            and receipt["revision"] == expected_revision and receipt["workflow"] == WORKFLOW
            and receipt["deploymentAuthorized"] is False and _positive(receipt["jobId"]),
            "Exact hosted functional v1 publication admission required")
    origin = receipt["origin"]
    require(type(origin) is dict and _main_origin(origin)["repository"] == REPO and origin["event"] == "workflow_dispatch",
            "Exact functional publication origin required")
    _artifact(receipt["artifact"], f"web-functional-image-bundle-{expected_revision}-{origin['runId']}-{origin['runAttempt']}")
    _hosted_evidence(receipt, origin)

    baseline, image, provenance, qualification = (receipt[key] for key in ("baseline", "image", "provenance", "qualification"))
    require(_exact(baseline, {"compositeSha256", "installedLineageSha256", "inputSha256", "activeWebRevision", "originalBackendRevision"})
            and all(_matches(HASH, baseline[key]) for key in ("compositeSha256", "installedLineageSha256", "inputSha256"))
            and all(_matches(REVISION, baseline[key]) for key in ("activeWebRevision", "originalBackendRevision"))
            and len({expected_revision, baseline["activeWebRevision"], baseline["originalBackendRevision"]}) == 3,
            "Functional publication baseline differs")
    require(_exact(image, {"imageId", "sourceRevision", "generation", "runtimeUser"})
            and _matches(IMAGE_ID, image["imageId"]) and image["sourceRevision"] == expected_revision
            and image["generation"] == "wd-" + expected_revision
            and isinstance(image["runtimeUser"], str) and 0 < len(image["runtimeUser"]) <= 260,
            "Functional publication image differs")
    require(_exact(provenance, {"bundleManifestSha256", "archiveSha256", "archiveSizeBytes"})
            and all(_matches(HASH, provenance[key]) for key in ("bundleManifestSha256", "archiveSha256"))
            and _positive(provenance["archiveSizeBytes"], MAX_ARCHIVE_BYTES)
            and _exact(qualification, QUALIFICATION_KEYS) and all(_matches(HASH, pin) for pin in qualification.values()),
            "Functional publication archive or qualification pins differ")
    return receipt


def authenticate_functional_artifact(api, receipt, *, repository_id=None):
    """Read the historical exact producer and artifact, reusing a vetted repo ID if supplied."""
    if repository_id is None:
        repository = api.request(f"repos/{REPO}")
        require(type(repository) is dict and repository.get("full_name") == REPO,
                "Canonical functional artifact repository required")
        repository_id = repository.get("id")
    require(_positive(repository_id), "Canonical functional artifact repository ID required")
    origin = receipt["origin"]
    run = successful_main_run(api, WORKFLOW, origin["runId"], receipt["revision"], repository_id,
                              events={"workflow_dispatch"})
    attempt = origin["runAttempt"]
    require(run["run_attempt"] == attempt, "Historical functional producer attempt changed")
    jobs = api.pages(f"repos/{REPO}/actions/runs/{run['id']}/attempts/{attempt}/jobs", "jobs")
    require(type(jobs) is list and all(type(row) is dict for row in jobs), "Exact hosted functional job list required")
    selected = [row for row in jobs if row.get("name") == JOB]
    require(len(selected) == 1, "One exact historical functional qualification job required")
    job = selected[0]
    require(_positive(job.get("id")) and job["id"] == receipt["jobId"]
            and _positive(job.get("run_id")) and job["run_id"] == run["id"]
            and _positive(job.get("run_attempt")) and job["run_attempt"] == attempt
            and job.get("head_sha") == receipt["revision"]
            and job.get("status") == "completed" and job.get("conclusion") == "success",
            "Historical functional job differs from the admitted attempt")
    steps = job.get("steps")
    require(type(steps) is list and all(type(step) is dict for step in steps), "Exact hosted functional steps required")
    for name in STEPS:
        matches = [step for step in steps if step.get("name") == name]
        allowed = {"success", "skipped"} if name == "Install attested ORAS" else {"success"}
        require(len(matches) == 1 and matches[0].get("status") == "completed" and matches[0].get("conclusion") in allowed,
                "Historical functional build, browser or retention step differs")
    expected = receipt["artifact"]
    require(artifact_for_run(api, run, repository_id, expected["name"], maximum=MAX_ZIP_BYTES) == expected,
            "Historical functional artifact differs from the admitted receipt")
    return expected


def original_backend_projection(backend):
    """Project an authenticated full baseline into the retained backend contract."""
    candidate = backend["candidate"]
    require(candidate["schemaVersion"] == 2, "Exact original retained Core bundle required")
    return {"sourceRevision": candidate["revision"], "origin": backend["origin"],
            "components": {name: candidate["components"][name] for name in RETAINED},
            "provenance": backend["provenance"], "inputReceiptSha256": candidate["inputProvenance"]["receiptSha256"]}


def _predecessor(value, pin, backend, baseline):
    require(_matches(HASH, pin) and _exact(value, {"schemaVersion", "kind", "repository", "platform",
                                                "deploymentAuthorized", "web", "backend", "qualification"}),
            "Independently pinned predecessor composite required")
    raw = canonical(value)
    require(len(raw) <= MAX_METADATA_BYTES and sha256(raw).hexdigest() == pin == baseline["compositeSha256"]
            and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
            and value["kind"] == COMPOSITE_KIND and value["repository"] == REPO
            and value["platform"] == PLATFORM and value["deploymentAuthorized"] is False,
            "Functional publication differs from the exact predecessor composite")
    require(_exact(backend, {"sourceRevision", "origin", "components", "provenance", "inputReceiptSha256"})
            and canonical(backend) == canonical(value["backend"])
            and backend["sourceRevision"] == baseline["originalBackendRevision"]
            and _main_origin(backend["origin"])["repository"] == REPO
            and _exact(backend["provenance"], {"bundleManifestSha256", "archiveSha256"}),
            "Separately authenticated original backend differs from the predecessor composite")
    web = value["web"]
    require(type(web) is dict and {"sourceRevision", "origin", "image", "publicationReceiptSha256", "artifact", "provenance"} <= web.keys()
            and web["sourceRevision"] == baseline["activeWebRevision"]
            and _main_origin(web["origin"])["repository"] == REPO
            and _matches(HASH, web["publicationReceiptSha256"])
            and _exact(web["image"], {"imageId", "sourceRevision", "generation", "runtimeUser"})
            and _matches(IMAGE_ID, web["image"]["imageId"]) and web["image"]["sourceRevision"] == web["sourceRevision"]
            and web["image"]["generation"] == "wd-" + web["sourceRevision"]
            and type(web["provenance"]) is dict
            and all(_matches(HASH, web["provenance"].get(key)) for key in ("bundleManifestSha256", "archiveSha256")),
            "Exact predecessor Web artifact projection required")
    return decode(raw)


def verify_functional_successor(
    *, predecessor, expected_predecessor_sha256, original_backend, functional_bundle_dir,
    publication_bytes, expected_publication_sha256, expected_revision, predecessor_lineage_sha256,
):
    """Return a reusable functional Web and original backend composite.

    The predecessor is the already admitted public composite used to qualify the
    functional bundle. The caller supplies its independent canonical SHA-256,
    separately authenticated original backend facts, and the prior installed
    lineage digest that the original qualification used. Only the functional
    archive is reopened. Installed slot admission remains a separate operation.
    """
    receipt = verify_functional_publication(publication_bytes, expected_publication_sha256=expected_publication_sha256,
                                            expected_revision=expected_revision)
    baseline = receipt["baseline"]
    require(_matches(HASH, predecessor_lineage_sha256) and predecessor_lineage_sha256 == baseline["installedLineageSha256"],
            "Functional publication was tested against another installed lineage")
    previous = _predecessor(predecessor, expected_predecessor_sha256, original_backend, baseline)
    old, backend = (previous[key] for key in ("web", "backend"))
    provenance = receipt["provenance"]
    artifact = {"revision": expected_revision, "manifestSha256": provenance["bundleManifestSha256"],
                "archiveSha256": provenance["archiveSha256"], "testedConfigDigest": receipt["image"]["imageId"]}
    old_artifact = {"revision": old["sourceRevision"], "manifestSha256": old["provenance"]["bundleManifestSha256"],
                    "archiveSha256": old["provenance"]["archiveSha256"], "testedConfigDigest": old["image"]["imageId"]}
    require(all(artifact[key] != old_artifact[key] for key in ("manifestSha256", "archiveSha256", "testedConfigDigest"))
            and expected_publication_sha256 != old["publicationReceiptSha256"],
            "Distinct functional and predecessor Web artifacts required")
    _original_backend(backend, (old_artifact, artifact))
    require(all(_exact(component, {"imageId", "runtimeUser", "registryRef", "sourceRevision", "inputSha256", "inputPolicySha256"})
                and component["registryRef"] is None and isinstance(component["runtimeUser"], str)
                and 0 < len(component["runtimeUser"]) <= 260 for component in backend["components"].values()),
            "Exact tested backend artifact projection required")

    try:
        loaded = load_functional_bundle(functional_bundle_dir, composite=previous, revision=expected_revision,
            origin=receipt["origin"], expected_manifest_sha256=provenance["bundleManifestSha256"],
            expected_input_sha256=baseline["inputSha256"], installed_lineage_sha256=predecessor_lineage_sha256)
    except (KeyError, TypeError) as error:
        raise CandidateError("Incomplete functional Web bundle or predecessor evidence") from error
    require(all(canonical(loaded[key]) == canonical(receipt[key]) for key in ("baseline", "image", "qualification"))
            and loaded["bundleManifestSha256"] == provenance["bundleManifestSha256"]
            and loaded["archive"] == {"sha256": provenance["archiveSha256"], "sizeBytes": provenance["archiveSizeBytes"]},
            "Functional publication does not bind the verified archive or qualification")

    return {
        **previous,
        "web": {"sourceRevision": expected_revision, "origin": receipt["origin"], "image": loaded["image"],
                "publicationReceiptSha256": expected_publication_sha256, "artifact": receipt["artifact"],
                "provenance": provenance,
                "inputProvenance": {"kind": "warpdrive-web-functional-build-inputs", "schemaVersion": 1,
                                    "inputSha256": baseline["inputSha256"],
                                    "originalBackendReceiptSha256": backend["inputReceiptSha256"],
                                    "retainedComponentInputSha256": {name: backend["components"][name]["inputSha256"] for name in RETAINED}}},
        "qualification": {**loaded["qualification"], "retainedComponentInputsEqual": True},
    }
