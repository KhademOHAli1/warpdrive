"""Retrieve exact historical Web and retained Core artifacts under reviewed custody pins."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

from candidate import CandidateError, REVISION, require
from component_inputs import HASH, decode
from publication_gate import (
    GateError, REPO, admitted_artifact, extract_bundle_zip, require_selected_main, verify_downloaded,
)
from web_baseline import MAX_ADMISSION, artifact_for_run, load_historical_admission, successful_main_run
from web_composite_baseline import _receipt, verify_web_composite_baseline
from web_publication_gate import JOB, MAX_ZIP_BYTES, STEPS, WORKFLOW, PublicGitHub, download, extract_verified_zip, private_file
from web_release_build import private_destination, read_metadata, write_metadata
from web_release_custody import retrieve as retrieve_from_custody


def active_web_artifact(api, raw_receipt, pin):
    """Authenticate the already-admitted Web origin without requiring historical B to be main now."""
    publication = _receipt(raw_receipt, pin)
    revision, origin = publication["revision"], publication["origin"]
    repository = api.request(f"repos/{REPO}")
    require(repository.get("full_name") == REPO and type(repository.get("id")) is int and repository["id"] > 0,
            "Canonical repeat qualification repository required")
    run = successful_main_run(api, WORKFLOW, origin["runId"], revision, repository["id"], events={"workflow_dispatch"})
    attempt = origin["runAttempt"]
    require(run["run_attempt"] == attempt, "Historical Web producer attempt changed")
    jobs = api.pages(f"repos/{REPO}/actions/runs/{run['id']}/attempts/{attempt}/jobs", "jobs")
    matches = [job for job in jobs if job.get("name") == JOB]
    require(len(matches) == 1, "Unique historical Web qualification job required")
    job = matches[0]
    require(job.get("id") == publication["jobId"] and job.get("run_id") == run["id"]
            and job.get("run_attempt") == attempt and job.get("head_sha") == revision
            and job.get("status") == "completed" and job.get("conclusion") == "success",
            "Historical Web job differs from the admitted exact attempt")
    for name in STEPS:
        steps = [row for row in job.get("steps", []) if row.get("name") == name]
        require(len(steps) == 1 and steps[0].get("status") == "completed" and steps[0].get("conclusion") == "success",
                "Historical Web qualification or retention step differs")
    expected = publication["artifact"]
    require(artifact_for_run(api, run, repository["id"], expected["name"], maximum=MAX_ZIP_BYTES) == expected,
            "Historical Web artifact differs from protected publication evidence")
    return publication


def _retained_backend_admission(path, raw):
    with private_file(path) as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())


def _source_authority(backend, web, *, backend_admission_sha256, backend_revision):
    require(hashlib.sha256(backend).hexdigest() == backend_admission_sha256,
            "Historical Core admission does not match the independently retained checksum")
    record = decode(backend)
    artifact = admitted_artifact(record, backend_revision)
    origin = {"kind": "github-actions", "repository": REPO, **record["producer"]}
    require(origin == web["baseline"]["origin"], "Retained Core admission and Web baseline identify different producers")
    return record, artifact


def retrieve(api, *, revision, web_receipt, web_receipt_sha256, backend_admission_run, backend_admission_sha256,
             output_dir, retain_backend_admission=False, custody_oras=None, backend_admission_bytes=None):
    require(isinstance(revision, str) and REVISION.fullmatch(revision) and HASH.fullmatch(backend_admission_sha256),
            "Exact selected main and retained Core admission digest required")
    private_destination(output_dir)
    require_selected_main(api, REPO, revision)
    web = (active_web_artifact(api, web_receipt, web_receipt_sha256) if custody_oras is None
           else _receipt(web_receipt, web_receipt_sha256))
    old = web["baseline"]["revision"]
    require(revision not in (old, web["revision"]), "A distinct current candidate is required")
    output_dir.mkdir(mode=0o700)
    backend_dir, web_dir, archive = (output_dir / name for name in ("core", "web", "web-bundle.zip"))
    admission_path = output_dir / "core-admission.json"
    if custody_oras is None:
        raw, _ = load_historical_admission(api, backend_admission_run, old)
    else:
        require(type(backend_admission_bytes) is int and 0 < backend_admission_bytes <= MAX_ADMISSION,
                "Exact retained Core admission byte count required")
        retrieve_from_custody(custody_oras, admission_path, kind="receipt",
                              digest="sha256:" + backend_admission_sha256, size=backend_admission_bytes)
        raw = read_metadata(admission_path)
    backend, backend_artifact = _source_authority(raw, web, backend_admission_sha256=backend_admission_sha256,
                                                  backend_revision=old)
    if retain_backend_admission and custody_oras is None:
        _retained_backend_admission(admission_path, raw)
    require(shutil.disk_usage(output_dir).free > 2 * (backend_artifact["sizeBytes"] + web["artifact"]["sizeBytes"]),
            "Insufficient space for retained archives and bundle extraction")
    backend_archive = backend_dir.with_suffix(".zip")
    for artifact, destination in ((backend_artifact, backend_archive), (web["artifact"], archive)):
        if custody_oras is None:
            download(artifact, destination)
        else:
            retrieve_from_custody(custody_oras, destination, kind="archive", digest=artifact["digest"],
                                  size=artifact["sizeBytes"])
    extract_bundle_zip(backend_archive, backend_dir)
    verify_downloaded(backend, backend_dir, expected_revision=old)
    require(extract_verified_zip(archive, web_dir, web["artifact"]) == web["provenance"]["bundleManifestSha256"],
            "Historical Web manifest differs from protected evidence")
    composite = verify_web_composite_baseline(web_receipt=web_receipt, expected_web_receipt_sha256=web_receipt_sha256,
        web_bundle_dir=web_dir, backend_bundle_dir=backend_dir,
        expected_backend_manifest_sha256=web["baseline"]["manifestSha256"])
    require(custody_oras is not None or active_web_artifact(api, web_receipt, web_receipt_sha256) == web,
            "Historical Web authority changed during the download")
    require_selected_main(api, REPO, revision)
    write_metadata(output_dir / "composite.json", composite)
    return composite


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--web-receipt", type=Path, required=True)
    parser.add_argument("--web-receipt-sha256", required=True)
    parser.add_argument("--backend-admission-run", type=int, required=True)
    parser.add_argument("--backend-admission-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--retain-backend-admission", action="store_true")
    parser.add_argument("--custody-oras", type=Path)
    parser.add_argument("--backend-admission-bytes", type=int)
    args = parser.parse_args(argv)
    try:
        composite = retrieve(PublicGitHub(), revision=args.revision, web_receipt=read_metadata(args.web_receipt),
            web_receipt_sha256=args.web_receipt_sha256, backend_admission_run=args.backend_admission_run,
            backend_admission_sha256=args.backend_admission_sha256, output_dir=args.output_dir,
            retain_backend_admission=args.retain_backend_admission, custody_oras=args.custody_oras,
            backend_admission_bytes=args.backend_admission_bytes)
        retained = decode((args.output_dir / "composite.json").read_bytes())
        require(retained == composite, "Durable composite evidence differs")
    except (CandidateError, GateError, OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile,
            subprocess.SubprocessError) as error:
        print(f"Repeat baseline held ({type(error).__name__}): {str(error)[:180]}", file=sys.stderr)
        return 1
    print(json.dumps({"activeWebRevision": composite["web"]["sourceRevision"],
                      "backendRevision": composite["backend"]["sourceRevision"], "deploymentAuthorized": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
