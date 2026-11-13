"""Verify received repeat Web metadata and load the admitted native image once."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re

from component_inputs import HASH, decode
from installed_web_image import load_verified_web_archive, require
from web_candidate import ARCHIVE, MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES, PLATFORM, _directory, _metadata, _record


MANIFEST = "web-repeat-bundle.json"
METADATA = ("component-inputs.json", "web-presentation-source.json", "web-repeat-input-admission.json", "web-repeat-mixed-report.json")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
IMAGE = re.compile(r"sha256:[a-f0-9]{64}\Z")


def _checked(record, *, maximum):
    require(type(record) is dict and set(record) == {"sha256", "sizeBytes"} and HASH.fullmatch(record["sha256"])
            and type(record["sizeBytes"]) is int and 0 < record["sizeBytes"] <= maximum,
            "Exact bounded repeat Web member required")
    return record


def verify_received_repeat(directory, publication_bytes, *, expected_publication_sha256, expected_lineage_sha256,
                           expected_revision, expected_active_revision, import_record=None):
    """Authenticate the locally admitted v2 receipt and the received metadata against exact pins."""
    require(type(publication_bytes) is bytes and 0 < len(publication_bytes) <= MAX_METADATA_BYTES
            and HASH.fullmatch(expected_publication_sha256) and hashlib.sha256(publication_bytes).hexdigest() == expected_publication_sha256
            and HASH.fullmatch(expected_lineage_sha256) and REVISION.fullmatch(expected_revision)
            and REVISION.fullmatch(expected_active_revision) and expected_revision != expected_active_revision,
            "Exact repeat Web publication, lineage and source pins required")
    receipt = decode(publication_bytes)
    require(receipt["kind"] == "warpdrive-web-repeat-publication-admission" and receipt["schemaVersion"] == 2
            and receipt["repository"] == "KhademOHAli1/warpdrive" and receipt["revision"] == expected_revision
            and receipt["workflow"] == "web-repeat-qualification.yml" and receipt["deploymentAuthorized"] is False
            and receipt["security"]["blocking_alerts"] == 0 and receipt["baseline"]["installedLineageSha256"] == expected_lineage_sha256
            and receipt["baseline"]["activeWeb"]["revision"] == expected_active_revision,
            "Repeat Web publication differs from current installation authority")
    image, provenance, origin = (receipt[name] for name in ("image", "provenance", "origin"))
    require(image["sourceRevision"] == expected_revision and image["generation"] == "wd-" + expected_revision
            and IMAGE.fullmatch(image["imageId"]) and image["imageId"] != receipt["baseline"]["activeWeb"]["imageId"]
            and origin["repository"] == receipt["repository"] and origin["event"] == "workflow_dispatch"
            and origin["ref"] == "refs/heads/main", "Exact repeat Web image and hosted origin required")
    with _directory(Path(directory)) as parent:
        require(set(os.listdir(parent)) == {MANIFEST, ARCHIVE, *METADATA}, "Unexpected repeat Web bundle inventory")
        manifest_bytes = _metadata(parent, MANIFEST)
        require(hashlib.sha256(manifest_bytes).hexdigest() == provenance["bundleManifestSha256"],
                "Received repeat Web manifest differs from publication")
        manifest = decode(manifest_bytes)
        require(manifest["schemaVersion"] == 2 and manifest["kind"] == "warpdrive-tested-repeat-web-bundle"
                and manifest["revision"] == expected_revision and manifest["platform"] == PLATFORM
                and manifest["origin"] == origin and manifest["baseline"] == receipt["baseline"]
                and manifest["harnessRevision"] == receipt["harnessRevision"] and manifest["imageId"] == image["imageId"]
                and manifest["deploymentAuthorized"] is False and set(manifest["files"]) == {ARCHIVE, *METADATA},
                "Received repeat Web manifest authority differs")
        files = manifest["files"]
        for name in METADATA:
            require(_record(_metadata(parent, name)) == _checked(files[name], maximum=MAX_METADATA_BYTES),
                    "Received repeat Web metadata differs")
        require(_checked(files[ARCHIVE], maximum=MAX_ARCHIVE_BYTES) == {
            "sha256": provenance["archiveSha256"], "sizeBytes": provenance["archiveSizeBytes"]},
            "Received repeat Web archive pin differs")
        if import_record is not None:
            require(import_record == {"schemaVersion": 2, "kind": "warpdrive-web-repeat-artifact-import",
                "revision": expected_revision, "publicationReceiptSha256": expected_publication_sha256,
                "origin": origin, "artifactId": receipt["artifact"]["id"], "baseline": receipt["baseline"],
                "bundleManifestSha256": provenance["bundleManifestSha256"], "testedConfigDigest": image["imageId"],
                "files": {MANIFEST: _record(manifest_bytes), **files}, "deploymentAuthorized": False},
                "Received repeat artifact import receipt differs")
    return receipt


def load_installed_repeat_image(directory, *, publication_bytes, state_dir, docker, expected_publication_sha256,
                                expected_lineage_sha256, expected_revision, expected_active_revision, expected_daemon,
                                reconcile=False, import_record=None):
    """Keep the same Docker load journal and exact OCI readback for v2 repeat artifacts."""
    receipt = verify_received_repeat(directory, publication_bytes, expected_publication_sha256=expected_publication_sha256,
        expected_lineage_sha256=expected_lineage_sha256, expected_revision=expected_revision,
        expected_active_revision=expected_active_revision, import_record=import_record)
    return load_verified_web_archive(directory, state_dir=state_dir, docker=docker,
        image=receipt["image"], provenance=receipt["provenance"], baseline_revision=expected_active_revision,
        baseline_manifest_sha256=receipt["baseline"]["activeWeb"]["bundleManifestSha256"], origin=receipt["origin"],
        expected_daemon=expected_daemon, reconcile=reconcile)
