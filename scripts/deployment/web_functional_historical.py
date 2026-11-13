"""Recover the accepted Web image and original backend from verified custody."""

import argparse
from contextlib import nullcontext
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

from candidate import REVISION, require
from component_inputs import HASH, content_hash, decode
from publication_gate import REPO, admitted_artifact, extract_bundle_zip, require_selected_main, verify_downloaded
from web_baseline import load_historical_admission
from web_custody_workflow import registry_auth
from web_functional_publication import extract_verified_zip as extract_functional_zip
from web_functional_successor import authenticate_functional_artifact, original_backend_projection, verify_functional_publication
from web_publication_gate import PublicGitHub, download, private_file
from web_release_build import private_destination, read_metadata, write_metadata
from web_release_custody import retrieve as retrieve_blob
from web_repeat_historical import retrieve as retrieve_predecessor
from web_repeat_publication import extract_verified_zip
from web_repeat_successor import _publication, verify_repeat_successor
from web_successor_custody import admission_bytes, authenticate_c, repository_id


CORE_REVISION = "6b24e23cffb32c09089d7020252cc787e3b5bf51"
TRACKED_HISTORY = re.compile(r"scripts/deployment/web-history/[a-z0-9][a-z0-9-]{0,63}\.(?:json|receipt)\Z")


def _tracked_history(args, path):
    from web_release_build import git

    relative = path.relative_to(args.root).as_posix()
    require(TRACKED_HISTORY.fullmatch(relative), "Exact tracked Web history evidence path required")
    require(git(args.root, "ls-tree", args.revision, "--", relative).startswith(b"100644 blob "),
            "Functional history evidence must be a regular tracked file")
    raw = read_metadata(path)
    require(raw == git(args.root, "cat-file", "blob", f"{args.revision}:{relative}"),
            "Functional history evidence differs from selected main")
    return raw


def _retrieve_original_core(api, args):
    """Retrieve the original tested Core bytes without any earlier Web archive."""
    backend = args.output_dir / "core"
    archive = backend.with_suffix(".zip")
    if args.oras is None:
        raw, _ = load_historical_admission(api, 43350260944, CORE_REVISION)
    else:
        path = args.output_dir / "core-admission.json"
        retrieve_blob(args.oras, path, kind="receipt", digest="sha256:" + args.core_admission_sha256, size=3212)
        raw = read_metadata(path)
    require(sha256(raw).hexdigest() == args.core_admission_sha256, "Original Core admission differs from custody")
    admission = decode(raw)
    artifact = admitted_artifact(admission, CORE_REVISION)
    if args.oras is None:
        download(artifact, archive)
    else:
        retrieve_blob(args.oras, archive, kind="archive", digest=artifact["digest"], size=artifact["sizeBytes"])
    extract_bundle_zip(archive, backend)
    loaded = verify_downloaded(admission, backend, expected_revision=CORE_REVISION)
    require(loaded["provenance"]["bundleManifestSha256"] == args.core_manifest_sha256,
            "Original Core bundle differs from the protected custody pin")
    return original_backend_projection(loaded)


def _retrieve_functional(api, args):
    from web_functional_successor import verify_functional_successor
    from web_release_build import git

    private_destination(args.output_dir, args.root)
    args.output_dir.mkdir(mode=0o700)
    receipt_path = args.output_dir / "active-receipt.json"
    if args.oras is None:
        raw = _tracked_history(args, args.active_publication_file)
        with private_file(receipt_path) as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
    else:
        retrieve_blob(args.oras, receipt_path, kind="receipt", digest="sha256:" + args.active_publication_sha256,
                      size=args.active_publication_bytes)
        raw = read_metadata(receipt_path)
    require(len(raw) == args.active_publication_bytes, "Active functional publication receipt length differs")
    active = decode(raw)["revision"]
    receipt = verify_functional_publication(raw, expected_publication_sha256=args.active_publication_sha256,
                                            expected_revision=active)
    require(active != args.revision, "Functional candidate must differ from the accepted active Web")
    git(args.root, "merge-base", "--is-ancestor", active, args.revision, allow_empty=True)
    predecessor_raw = _tracked_history(args, args.functional_predecessor_composite)
    predecessor = decode(predecessor_raw)
    require(content_hash(predecessor) == args.functional_predecessor_composite_sha256 == receipt["baseline"]["compositeSha256"],
            "Exact earlier functional composite differs from the published bundle")
    artifact = receipt["artifact"]
    require(shutil.disk_usage(args.output_dir).free > 2 * artifact["sizeBytes"] + 7 * 1024**3,
            "Insufficient runner storage for verified Core and active functional Web bytes")
    original = _retrieve_original_core(api, args)
    archive, destination = (args.output_dir / name for name in ("active.zip", "active"))
    if args.oras is None:
        require(authenticate_functional_artifact(api, receipt) == artifact, "Active functional artifact identity differs")
        download(artifact, archive)
        require(authenticate_functional_artifact(api, receipt) == artifact, "Active functional authority changed during download")
    else:
        retrieve_blob(args.oras, archive, kind="archive", digest=artifact["digest"], size=artifact["sizeBytes"])
    require(extract_functional_zip(archive, destination, artifact) == receipt["provenance"]["bundleManifestSha256"],
            "Active functional archive manifest differs from its admitted artifact")
    result = verify_functional_successor(predecessor=predecessor,
        expected_predecessor_sha256=args.functional_predecessor_composite_sha256, original_backend=original,
        functional_bundle_dir=destination, publication_bytes=raw, expected_publication_sha256=args.active_publication_sha256,
        expected_revision=active, predecessor_lineage_sha256=args.predecessor_lineage_sha256)
    write_metadata(args.output_dir / "active-composite.json", result)
    return result


def retrieve(api, args):
    require(REVISION.fullmatch(args.revision) and all(HASH.fullmatch(value) for value in (
        args.core_manifest_sha256, args.core_admission_sha256, args.active_publication_sha256,
        args.predecessor_lineage_sha256)) and type(args.active_publication_bytes) is int
        and 0 < args.active_publication_bytes <= 1024**2, "Exact protected source and custody digests required")
    require_selected_main(api, REPO, args.revision)
    if args.functional_predecessor_composite is not None:
        require(args.previous_web_receipt is None and args.previous_web_receipt_sha256 is None
                and isinstance(args.functional_predecessor_composite_sha256, str)
                and HASH.fullmatch(args.functional_predecessor_composite_sha256)
                and args.functional_predecessor_composite.suffix == ".json"
                and (args.active_publication_file is None or args.active_publication_file.suffix == ".receipt"),
                "Exact functional history mode required")
        result = _retrieve_functional(api, args)
    else:
        require(args.functional_predecessor_composite_sha256 is None and args.previous_web_receipt is not None
                and isinstance(args.previous_web_receipt_sha256, str) and HASH.fullmatch(args.previous_web_receipt_sha256),
                "Exact previous Web receipt required for repeat history")
        result = _retrieve_repeat(api, args)
    require_selected_main(api, REPO, args.revision)
    return result


def _retrieve_repeat(api, args):
    previous_receipt = read_metadata(args.previous_web_receipt)
    predecessor = retrieve_predecessor(api, revision=args.revision, web_receipt=previous_receipt,
        web_receipt_sha256=args.previous_web_receipt_sha256, backend_admission_run=43350260944,
        backend_admission_sha256=args.core_admission_sha256, output_dir=args.output_dir, custody_oras=args.oras,
        backend_admission_bytes=3212)
    require(predecessor["backend"]["provenance"]["bundleManifestSha256"] == args.core_manifest_sha256,
            "Original Core bundle differs from the protected custody pin")
    receipt_path = args.output_dir / "active-receipt.json"
    if args.oras is None:
        raw = read_metadata(args.active_publication_file)
        require(len(raw) == args.active_publication_bytes and sha256(raw).hexdigest() == args.active_publication_sha256,
                "Tracked repeat Web admission differs from the protected custody pin")
        require(raw == admission_bytes(args.root, args.revision, decode(raw)["revision"], args.active_publication_file),
                "Repeat Web admission differs from exact tracked source")
        with private_file(receipt_path) as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
    else:
        retrieve_blob(args.oras, receipt_path, kind="receipt", digest="sha256:" + args.active_publication_sha256,
                      size=args.active_publication_bytes)
    raw = read_metadata(receipt_path)
    active_revision = decode(raw)["revision"]
    require(active_revision != args.revision, "Functional candidate must differ from the accepted active Web")
    publication = _publication(raw, args.active_publication_sha256, active_revision)
    artifact = publication["artifact"]
    require(shutil.disk_usage(args.output_dir).free > 2 * artifact["sizeBytes"] + 4 * 1024 ** 3,
            "Insufficient runner storage for verified active Web bytes")
    archive, destination = (args.output_dir / name for name in ("active.zip", "active"))
    if args.oras is None:
        repo_id = repository_id(api)
        require(authenticate_c(api, repo_id) == artifact, "Active historical Web artifact differs from its exact producer")
        download(artifact, archive)
        require(authenticate_c(api, repo_id) == artifact, "Historical Web artifact authority changed during download")
    else:
        retrieve_blob(args.oras, archive, kind="archive", digest=artifact["digest"], size=artifact["sizeBytes"])
    require(extract_verified_zip(archive, destination, artifact) == publication["provenance"]["bundleManifestSha256"],
            "Active Web custody manifest differs from its admitted artifact")
    composite = verify_repeat_successor(predecessor=predecessor, repeat_bundle_dir=destination,
        publication_bytes=raw, expected_publication_sha256=args.active_publication_sha256,
        expected_revision=active_revision, predecessor_lineage_sha256=args.predecessor_lineage_sha256)
    return composite


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--oras", type=Path)
    source.add_argument("--active-publication-file", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--previous-web-receipt", type=Path)
    parser.add_argument("--previous-web-receipt-sha256")
    parser.add_argument("--functional-predecessor-composite", type=Path)
    parser.add_argument("--functional-predecessor-composite-sha256")
    for name in ("revision", "core-admission-sha256", "core-manifest-sha256",
                 "active-publication-sha256", "predecessor-lineage-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--active-publication-bytes", type=int, required=True)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    try:
        with (registry_auth(args.output_dir.parent) if args.oras is not None else nullcontext()):
            result = retrieve(PublicGitHub(), args)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print(f"Functional Web baseline held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    print(json.dumps({"activeWebRevision": result["web"]["sourceRevision"],
                      "backendRevision": result["backend"]["sourceRevision"], "deploymentAuthorized": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
