"""Recover the accepted C Web and original A backend from verified custody."""

import argparse
from contextlib import nullcontext
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

from candidate import REVISION, require
from component_inputs import HASH, decode
from publication_gate import REPO, require_selected_main
from web_custody_workflow import registry_auth
from web_publication_gate import PublicGitHub, download, private_file
from web_release_build import read_metadata
from web_release_custody import retrieve as retrieve_blob
from web_repeat_historical import retrieve as retrieve_predecessor
from web_repeat_publication import extract_verified_zip
from web_repeat_successor import _publication, verify_repeat_successor
from web_successor_custody import admission_bytes, authenticate_c, repository_id


def retrieve(api, args):
    require(REVISION.fullmatch(args.revision) and all(HASH.fullmatch(value) for value in (
        args.core_manifest_sha256, args.core_admission_sha256, args.previous_web_receipt_sha256,
        args.active_publication_sha256, args.predecessor_lineage_sha256)), "Exact protected source and custody digests required")
    require_selected_main(api, REPO, args.revision)
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
    require_selected_main(api, REPO, args.revision)
    return composite


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--oras", type=Path)
    source.add_argument("--active-publication-file", type=Path)
    for name in ("previous-web-receipt", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("revision", "core-admission-sha256", "core-manifest-sha256", "previous-web-receipt-sha256",
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
