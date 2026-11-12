"""Prepare one real presentation-only Git delta for the isolated native Web-image rehearsal."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

from bundle import INPUT_RECEIPT, MAX_METADATA_BYTES, load_bundle, regular_file
from candidate import CandidateError, admit_capacity
import component_inputs as inputs
from image_smoke import Docker, SmokeError, image_metadata
from web_release_inputs import STYLE_FILE, WebReleaseInputError, verify_web_source_delta

OWNED_MARKER = b"warpdrive-web-release-rehearsal-v1\n"


class RehearsalError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise RehearsalError(message)


def git(root, *arguments):
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    result = subprocess.run(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c",
                             "commit.gpgsign=false", "-c", "user.name=Warpdrive fixture", "-c",
                             "user.email=warpdrive-fixture@example.invalid", *arguments],
                            cwd=root, env=environment, capture_output=True, timeout=30, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 64 * 1024, "owned Git operation failed")
    return result.stdout.decode("utf-8", "strict").strip()


def _hosted_baseline(bundle_dir, revision, manifest_sha):
    event = os.environ.get("GITHUB_EVENT_NAME")
    ref = os.environ.get("GITHUB_REF", "")
    origin = {"kind": "github-actions", "repository": os.environ.get("GITHUB_REPOSITORY"),
              "runId": int(os.environ.get("GITHUB_RUN_ID", "0")),
              "runAttempt": int(os.environ.get("GITHUB_RUN_ATTEMPT", "0")),
              "event": event, "ref": ref}
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_SHA") == revision
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and ((event == "workflow_dispatch" and ref.startswith("refs/heads/"))
                 or (event == "pull_request" and re.fullmatch(r"refs/pull/[1-9][0-9]*/merge", ref)))
            and re.fullmatch(r"[a-f0-9]{64}", manifest_sha), "same-run hosted staging baseline required")
    bundle = load_bundle(bundle_dir, expected_revision=revision)
    require(bundle["origin"] == origin and bundle["provenance"]["bundleManifestSha256"] == manifest_sha
            and bundle["candidate"]["schemaVersion"] == 2, "same-run source-bound v2 baseline bundle required")
    baseline = inputs.validate_receipt(inputs.decode(regular_file(bundle_dir, INPUT_RECEIPT, MAX_METADATA_BYTES).read_bytes()))
    require(inputs.content_hash(baseline) == bundle["candidate"]["inputProvenance"]["receiptSha256"],
            "baseline receipt differs from the retained qualification")
    return bundle, baseline


def prepare(root: Path, scratch: Path, bundle_dir: Path, revision: str, manifest_sha: str) -> dict:
    require(root == root.resolve() and scratch == scratch.resolve() and not scratch.is_relative_to(root),
            "rehearsal requires owned scratch outside the checkout")
    require(re.fullmatch(r"[a-f0-9]{40}", revision) and git(root, "rev-parse", "HEAD") == revision,
            "the baseline bundle must match the checked out revision")
    require(not scratch.exists() and not scratch.is_symlink(), "scratch directory already exists")
    bundle, baseline = _hosted_baseline(bundle_dir, revision, manifest_sha)
    context = baseline["context"]
    require(context["buildArgs"] == {"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"},
            "this native rehearsal uses the ordinary production-image build arguments")
    capacity = admit_capacity(available=shutil.disk_usage(scratch.parent).free, candidate=3 * 1024**3,
                              migration=1024**3, temporary=2 * 1024**3, reserve=4 * 1024**3)
    scratch.mkdir(mode=0o700)
    with (scratch / ".warpdrive-web-rehearsal").open("xb") as marker:
        marker.write(OWNED_MARKER)
    source = scratch / "source"
    try:
        git(root, "worktree", "add", "--detach", str(source), revision)
        (source / "node_modules").symlink_to((root / "node_modules").resolve(strict=True), target_is_directory=True)
        style = source / STYLE_FILE
        old = style.read_bytes()
        require(old.count(b"  gap: 24px;\n") == 1, "reviewed UI delta requires its original CSS declaration")
        style.write_bytes(old.replace(b"  gap: 24px;\n", b"  gap: 22px;\n", 1))
        git(source, "add", "--", STYLE_FILE)
        git(source, "commit", "--quiet", "-m", "Exercise independent Web release in native staging")
        changed = git(source, "rev-parse", "HEAD")
        command = ["node", "scripts/deployment/component_inputs.mjs", "--base-image", context["baseImage"],
                   "--platform", context["platform"], "--build-arg", "NEXT_PUBLIC_WS_URL=same-origin"]
        environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
        current = inputs.validate_receipt(inputs.decode(inputs._discover(command, source, environment,
                                                                           deadline_seconds=90)))
        proof = verify_web_source_delta(source, current, expected_revision=changed,
                                        baseline_revision=revision, baseline_receipt=baseline)
        require(proof["buildComponents"] == ["web"] and proof["changedPresentationPaths"] == [STYLE_FILE],
                "native staging proof must select exactly Web")
        result = {"sourceDelta": proof, "baselineManifestSha256": manifest_sha,
                  "baselineArchiveSha256": bundle["provenance"]["archiveSha256"],
                  "baselineImages": {name: row["imageId"] for name, row in bundle["candidate"]["components"].items()},
                  "capacity": capacity}
        with (scratch / "candidate-inputs.json").open("xb") as receipt:
            receipt.write(inputs.canonical(current))
        with (scratch / "source-delta.json").open("x", encoding="utf-8") as report:
            json.dump(result, report, indent=2, sort_keys=True, allow_nan=False)
            report.write("\n")
        return result
    except BaseException:
        cleanup(root, scratch)
        raise


def _registered(root, source):
    record = f"worktree {source}"
    return record in git(root, "worktree", "list", "--porcelain", "-z").split("\0")


def _owned(root, scratch):
    require(root == root.resolve() and scratch == scratch.resolve() and not scratch.is_relative_to(root),
            "rehearsal requires its owned scratch directory")
    marker = scratch / ".warpdrive-web-rehearsal"
    metadata = scratch.stat()
    require(metadata.st_uid == os.geteuid() and stat.S_IMODE(metadata.st_mode) == 0o700
            and not marker.is_symlink() and marker.is_file() and marker.stat().st_size == len(OWNED_MARKER)
            and marker.read_bytes() == OWNED_MARKER, "owned rehearsal marker required")


def cleanup(root: Path, scratch: Path):
    if not scratch.exists() and not scratch.is_symlink():
        return
    _owned(root, scratch)
    source = scratch / "source"
    registered = _registered(root, source)
    if not source.exists() and not source.is_symlink() and not registered:
        return
    require(registered and not source.is_symlink(), "owned registered rehearsal worktree required")
    # Git also verifies that the path is a registered worktree of this checkout.
    git(root, "worktree", "remove", "--force", str(source))
    require(not source.exists() and not _registered(root, source), "rehearsal worktree cleanup did not settle")


def verify_built(root, scratch, bundle_dir, revision, manifest_sha, image_id):
    _owned(root, scratch)
    source = scratch / "source"
    require(_registered(root, source) and source == source.resolve(), "owned candidate checkout required")
    bundle, baseline = _hosted_baseline(bundle_dir, revision, manifest_sha)
    before = inputs.decode(regular_file(scratch, "source-delta.json", MAX_METADATA_BYTES).read_bytes())
    retained_inputs = inputs.decode(regular_file(scratch, "candidate-inputs.json", MAX_METADATA_BYTES).read_bytes())
    candidate_revision = before["sourceDelta"]["releaseRevision"]
    after = verify_web_source_delta(source, retained_inputs, expected_revision=candidate_revision,
                                    baseline_revision=revision, baseline_receipt=baseline)
    baseline_ids = {name: row["imageId"] for name, row in bundle["candidate"]["components"].items()}
    require(after == before["sourceDelta"] and manifest_sha == before["baselineManifestSha256"]
            and bundle["provenance"]["archiveSha256"] == before["baselineArchiveSha256"]
            and baseline_ids == before["baselineImages"],
            "build context or baseline changed during compilation")
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", image_id), "immutable candidate image ID required")
    docker = Docker()
    candidate = image_metadata(docker.json(["image", "inspect", image_id]), candidate_revision)
    require(candidate["id"] == image_id and image_id not in before["baselineImages"].values(),
            "new Web image does not have a distinct immutable identity")
    for baseline_id in baseline_ids.values():
        original = image_metadata(docker.json(["image", "inspect", baseline_id]), revision)
        require(original["id"] == baseline_id,
                "retained baseline image changed during compilation")
    remaining = shutil.disk_usage(scratch).free
    require(remaining >= 4 * 1024**3, "native staging disk reserve unavailable after Web build")
    return {**before, "candidateWebImageId": image_id, "sourceVerifiedAfterBuild": True,
            "availableDiskBytesAfterBuild": remaining}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--scratch", required=True, type=Path)
    parser.add_argument("--bundle-dir", type=Path)
    parser.add_argument("--expected-revision")
    parser.add_argument("--baseline-manifest-sha256")
    parser.add_argument("--verify-built-image")
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.cleanup:
            cleanup(args.root, args.scratch)
        else:
            require(args.bundle_dir is not None and args.expected_revision is not None
                    and args.baseline_manifest_sha256 is not None, "baseline bundle, revision and manifest required")
            arguments = (args.root, args.scratch, args.bundle_dir, args.expected_revision, args.baseline_manifest_sha256)
            if args.verify_built_image:
                print(json.dumps(verify_built(*arguments, args.verify_built_image), indent=2, sort_keys=True))
            else:
                result = prepare(*arguments)
                print(result["sourceDelta"]["releaseRevision"])
    except (CandidateError, inputs.InputError, WebReleaseInputError, RehearsalError, SmokeError) as error:
        print(f"Isolated Web release rehearsal held: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired):
        print("Isolated Web release worktree preparation or cleanup failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
