"""Retrieve exact historical Web and retained Core artifacts under reviewed custody pins."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

from candidate import CandidateError, REVISION, require
from component_inputs import HASH, decode
from publication_gate import GateError, REPO, download_verified, require_selected_main
from web_baseline import artifact_for_run, load_historical_admission, successful_main_run
from web_composite_baseline import _receipt, verify_web_composite_baseline
from web_publication_gate import JOB, MAX_ZIP_BYTES, STEPS, WORKFLOW, PublicGitHub, download, extract_verified_zip
from web_release_build import private_destination, read_metadata, write_metadata


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


def retrieve(api, *, revision, web_receipt, web_receipt_sha256, backend_admission_run, backend_admission_sha256, output_dir):
    require(isinstance(revision, str) and REVISION.fullmatch(revision) and HASH.fullmatch(backend_admission_sha256),
            "Exact selected main and retained Core admission digest required")
    private_destination(output_dir)
    require_selected_main(api, REPO, revision)
    web = active_web_artifact(api, web_receipt, web_receipt_sha256)
    old = web["baseline"]["revision"]
    require(revision not in (old, web["revision"]), "A distinct current candidate is required")
    raw, backend = load_historical_admission(api, backend_admission_run, old)
    require(hashlib.sha256(raw).hexdigest() == backend_admission_sha256,
            "Historical Core admission does not match the independently retained checksum")
    output_dir.mkdir(mode=0o700)
    backend_dir, web_dir, archive = (output_dir / name for name in ("core", "web", "web-bundle.zip"))
    download_verified(backend, backend_dir, expected_revision=old)
    download(web["artifact"], archive)
    require(extract_verified_zip(archive, web_dir, web["artifact"]) == web["provenance"]["bundleManifestSha256"],
            "Historical Web manifest differs from protected evidence")
    composite = verify_web_composite_baseline(web_receipt=web_receipt, expected_web_receipt_sha256=web_receipt_sha256,
        web_bundle_dir=web_dir, backend_bundle_dir=backend_dir,
        expected_backend_manifest_sha256=web["baseline"]["manifestSha256"])
    require(active_web_artifact(api, web_receipt, web_receipt_sha256) == web,
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
    args = parser.parse_args(argv)
    try:
        composite = retrieve(PublicGitHub(), revision=args.revision, web_receipt=read_metadata(args.web_receipt),
            web_receipt_sha256=args.web_receipt_sha256, backend_admission_run=args.backend_admission_run,
            backend_admission_sha256=args.backend_admission_sha256, output_dir=args.output_dir)
        retained = decode((args.output_dir / "composite.json").read_bytes())
        require(retained == composite, "Durable composite evidence differs")
    except (CandidateError, GateError, OSError, ValueError, TypeError, KeyError) as error:
        print(f"Repeat baseline held ({type(error).__name__}): {str(error)[:180]}", file=sys.stderr)
        return 1
    print(json.dumps({"activeWebRevision": composite["web"]["sourceRevision"],
                      "backendRevision": composite["backend"]["sourceRevision"], "deploymentAuthorized": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
