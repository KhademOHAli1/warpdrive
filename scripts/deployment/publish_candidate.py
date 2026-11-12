"""Publish only a verified main image bundle from the hosted manual candidate workflow."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from candidate import CandidateError, load, require
from image_smoke import Docker, SmokeError
from publication_gate import GitHub, GateError, REPO, admit, verify_downloaded
from publication_history import ReconcileOnly, prior_write_opportunities
from registry_candidate import DockerRegistryAdapter, RegistryError, promote_candidate


def require_hosted_main(environment: dict, revision: str) -> None:
    require(environment.get("GITHUB_ACTIONS") == "true"
            and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("GITHUB_REPOSITORY") == REPO
            and environment.get("GITHUB_REF") == "refs/heads/main"
            and environment.get("GITHUB_SHA") == revision,
            "candidate publication runs only from exact trusted main on a hosted runner")


def publish_verified(bundle_dir: Path, admission: dict, *, expected_main: str,
                     repository_prefix: str, attempt_id: str, journal_path: Path,
                     output_path: Path, api, docker, adapter,
                     workflow_run_id: int, workflow_run_attempt: int) -> dict:
    fresh = admit(api, admission["producer"]["runId"], expected_main)
    for key in ("repository", "revision", "producer", "artifact"):
        require(admission.get(key) == fresh[key], "admitted artifact changed before publication")
    loaded = verify_downloaded(fresh, bundle_dir, expected_revision=expected_main)
    require(loaded["origin"] == {"kind": "github-actions", "repository": REPO, **fresh["producer"]},
            "bundle producer differs from admitted main workflow")
    previous = prior_write_opportunities(api, expected_main, workflow_run_id, workflow_run_attempt)
    history_path = journal_path.with_name("publication-history.json")
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history = {"schemaVersion": 1, "revision": expected_main,
               "runId": workflow_run_id, "runAttempt": workflow_run_attempt,
               "priorWriteOpportunities": previous, "reconcileOnly": bool(previous)}
    encoded = json.dumps(history, sort_keys=True, indent=2) + "\n"
    if history_path.exists():
        require(not history_path.is_symlink() and history_path.is_file()
                and 0 < history_path.stat().st_size <= 4 * 1024 ** 2,
                "existing publication history is invalid")
        require(json.dumps(load(history_path), sort_keys=True, indent=2) + "\n" == encoded,
                "publication history changed; preserve previous receipts and reconcile independently")
    else:
        with history_path.open("x") as output:
            output.write(encoded)
    if previous:
        adapter = ReconcileOnly(adapter)
        print("An earlier publication step ran; this attempt permits independent readback only.")
    docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=600)
    result = promote_candidate(loaded["candidate"], expected_revision=expected_main,
                               bundle_provenance=loaded["provenance"], repository_prefix=repository_prefix,
                               attempt_id=attempt_id, journal_path=journal_path,
                               output_path=output_path, adapter=adapter)
    # A later main/CI change holds publication acceptance; preserve actual registry receipts.
    admit(api, admission["producer"]["runId"], expected_main)
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("bundle-dir", "admission", "journal", "output"):
        parser.add_argument(f"--{key}", type=Path, required=True)
    for key in ("expected-main", "repository-prefix", "attempt-id"):
        parser.add_argument(f"--{key}", required=True)
    args = parser.parse_args(argv)
    try:
        require_hosted_main(dict(os.environ), args.expected_main)
        docker = Docker()
        publish_verified(args.bundle_dir, load(args.admission), expected_main=args.expected_main,
                         repository_prefix=args.repository_prefix, attempt_id=args.attempt_id,
                         journal_path=args.journal, output_path=args.output,
                         api=GitHub(), docker=docker, adapter=DockerRegistryAdapter(docker),
                         workflow_run_id=int(os.environ.get("GITHUB_RUN_ID", "0")),
                         workflow_run_attempt=int(os.environ.get("GITHUB_RUN_ATTEMPT", "0")))
        print("Verified registry candidate recorded; deployment and installation acceptance remain separate.")
    except (CandidateError, GateError, SmokeError, RegistryError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"candidate publication held: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
