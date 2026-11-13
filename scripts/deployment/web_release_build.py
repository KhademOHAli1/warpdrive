"""Prepare and qualify an actual Web-only build on hosted main.

The workflow authenticates a historical full bundle and performs the single
Web build. This command verifies those inputs, runs the retained baseline's
native browser fixture, and saves the exact tested Web image without rebuilding.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
from zipfile import BadZipFile

from bundle import INPUT_RECEIPT, MAX_METADATA_BYTES, regular_file
from candidate import CandidateError, admit_capacity
import component_inputs as inputs
from image_smoke import COMPONENTS, Docker, SmokeError
from publication_gate import REPO, verify_downloaded
from web_candidate import BUILD, MAX_ARCHIVE_BYTES, PLATFORM, create_web_bundle
from web_mixed_image_smoke import read_web_image
from web_release_inputs import STYLE_FILE, WebReleaseInputError, qualifies_topbar_browser_pair, verify_web_source_delta


REVISION = re.compile(r"[0-9a-f]{40}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
GIB = 1024**3
PREPARED = "prepared.json"
CURRENT_INPUTS = "candidate-inputs.json"
MIXED = "mixed"
HARNESS = "scripts/deployment/web_mixed_image_smoke.py"
TOOLING = ("scripts/deployment", "scripts/delivery")
BROWSER = ("scripts/browser-web-rollout.mjs", "scripts/browser-realtime-fixture.mjs")


class WebBuildError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise WebBuildError(message)


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def origin_for(revision, environment):
    run_id, attempt = (environment.get(name, "") for name in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    require(matches(REVISION, revision) and environment.get("GITHUB_SHA") == revision
            and environment.get("GITHUB_ACTIONS") == "true" and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("GITHUB_REPOSITORY") == REPO and environment.get("GITHUB_REF") == "refs/heads/main"
            and environment.get("GITHUB_EVENT_NAME") in {"push", "workflow_dispatch"}
            and all(re.fullmatch(r"[1-9][0-9]{0,19}", item) for item in (run_id, attempt)),
            "exact same-repository hosted main workflow required")
    return {"kind": "github-actions", "repository": REPO, "event": environment["GITHUB_EVENT_NAME"],
            "ref": "refs/heads/main", "runId": int(run_id), "runAttempt": int(attempt)}


def read_metadata(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_METADATA_BYTES, "bounded regular metadata required")
        raw = source.read(MAX_METADATA_BYTES + 1)
        after = os.fstat(source.fileno())
    require(len(raw) == info.st_size
            and (info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "metadata changed during read")
    return raw


def write_metadata(path, value):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    with os.fdopen(os.open(path, flags, 0o600), "wb") as output:
        output.write(inputs.canonical(value) + b"\n")
        output.flush()
        os.fsync(output.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def git(root, *arguments, allow_empty=False):
    command = ["git", "--no-replace-objects", "-c", "core.fsmonitor=false", *arguments]
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    return inputs._discover(command, root, environment, allow_empty=allow_empty, deadline_seconds=30)


def checkout(root, revision):
    require(root.is_absolute() and root == root.resolve(strict=True)
            and git(root, "rev-parse", "--show-toplevel").strip() == os.fsencode(root)
            and git(root, "rev-parse", "HEAD").strip() == revision.encode("ascii"),
            "canonical exact checkout root required")


def baseline_bundle(directory, admission_path, admission_sha, origin):
    raw = read_metadata(admission_path)
    require(matches(inputs.HASH, admission_sha) and hashlib.sha256(raw).hexdigest() == admission_sha,
            "historically authenticated baseline admission checksum differs")
    admission = inputs.decode(raw)
    require(isinstance(admission, dict) and matches(REVISION, admission.get("revision")), "exact baseline revision required")
    old = admission["revision"]
    require(directory.is_absolute() and directory == directory.resolve(strict=True), "canonical authenticated bundle directory required")
    loaded = verify_downloaded(admission, directory, expected_revision=old)
    producer = loaded["origin"]
    candidate = loaded["candidate"]
    require(producer["repository"] == origin["repository"] and producer["ref"] == "refs/heads/main"
            and producer["event"] in {"push", "workflow_dispatch"} and producer["runId"] != origin["runId"]
            and candidate["schemaVersion"] == 2, "separately qualified full main baseline required")
    receipt = inputs.load_receipt(regular_file(directory, INPUT_RECEIPT, MAX_METADATA_BYTES))
    require(inputs.content_hash(receipt) == candidate["inputProvenance"]["receiptSha256"],
            "retained baseline inputs differ from the authenticated candidate")
    ids = {name: candidate["components"][name]["imageId"] for name in COMPONENTS}
    require(len(set(ids.values())) == len(COMPONENTS), "distinct tested baseline image IDs required")
    return old, loaded, receipt, ids


def verify_source(args, old, historical, current):
    checkout(args.root, args.expected_revision)
    require(historical["context"]["buildArgs"] == {"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"},
            "Web browser fixture requires the qualified same-origin build arguments")
    source = verify_web_source_delta(args.root, current, expected_revision=args.expected_revision,
                                     baseline_revision=old, baseline_receipt=historical)
    old_css = git(args.root, "cat-file", "blob", f"{old}:{STYLE_FILE}")
    new_css = git(args.root, "cat-file", "blob", f"{args.expected_revision}:{STYLE_FILE}")
    require(source["buildComponents"] == ["web"] and source["changedPresentationPaths"] == [STYLE_FILE]
            and qualifies_topbar_browser_pair(old_css, new_css),
            "this browser fixture qualifies the exact 24px-to-22px TopBar presentation change")
    return source


def private_destination(path, *read_roots):
    require(path.is_absolute() and path.parent == path.parent.resolve(strict=True)
            and not any(path.is_relative_to(root) for root in read_roots) and not os.path.lexists(path),
            "fresh canonical output outside source and baseline required")


def prepared_inputs(args, environment):
    origin = origin_for(args.expected_revision, environment)
    old, loaded, historical, ids = baseline_bundle(args.baseline_dir, args.baseline_admission,
                                                   args.baseline_admission_sha256, origin)
    current = inputs.load_receipt(args.input_receipt)
    delta = verify_source(args, old, historical, current)
    facts = {"sourceDelta": delta, "baselineManifestSha256": loaded["provenance"]["bundleManifestSha256"],
             "baselineArchiveSha256": loaded["provenance"]["archiveSha256"], "baselineImages": ids}
    binding = {"origin": origin, "root": str(args.root), "baselineDirectory": str(args.baseline_dir),
               "baselineAdmissionSha256": args.baseline_admission_sha256, "facts": facts}
    return origin, old, current, binding


def prepare(args, environment):
    private_destination(args.state_dir, args.root, args.baseline_dir)
    _, old, current, binding = prepared_inputs(args, environment)
    capacity = admit_capacity(available=shutil.disk_usage(args.state_dir.parent).free,
                              candidate=MAX_ARCHIVE_BYTES, migration=GIB, temporary=2 * GIB, reserve=4 * GIB)
    args.state_dir.mkdir(mode=0o700)
    write_metadata(args.state_dir / CURRENT_INPUTS, current)
    write_metadata(args.state_dir / PREPARED, {**binding, "capacity": capacity})
    return {"revision": args.expected_revision, "baselineRevision": old, "contextDirectory": str(args.root),
            "dockerfile": str(args.root / "deploy/images/Dockerfile"), "target": "web",
            "platform": PLATFORM, "buildArgs": {**current["context"]["buildArgs"], "APP_COMMIT": args.expected_revision},
            "deploymentAuthorized": False}


def verify_baseline_checkout(root, old):
    checkout(root, old)
    require(not git(root, "diff", "--no-ext-diff", "--no-textconv", "--quiet", "HEAD", "--", allow_empty=True)
            and not git(root, "status", "--porcelain=v1", "--untracked-files=all", allow_empty=True)
            and not git(root, "ls-files", "--others", "--", *TOOLING, *BROWSER, allow_empty=True),
            "historical native fixture checkout must be clean")
    entries = git(root, "ls-tree", "-rz", old, "--", *TOOLING, *BROWSER)
    seen = set()
    for row in entries.rstrip(b"\0").split(b"\0"):
        metadata, path = row.split(b"\t", 1)
        mode, kind, identifier = metadata.decode("ascii").split()
        name = path.decode("utf-8", "strict")
        require(mode in {"100644", "100755"} and kind == "blob", "historical fixture tooling must be regular Git blobs")
        raw = read_metadata(regular_file(root, name, MAX_METADATA_BYTES))
        header = f"blob {len(raw)}\0".encode()
        require(hashlib.sha1(header + raw, usedforsecurity=False).hexdigest() == identifier,
                "historical fixture tooling differs from exact Git blob")
        seen.add(name)
    require({HARNESS, *BROWSER} <= seen, "historical browser harness is incomplete")


def run_native(root, args, old, manifest, output):
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
                   "PLAYWRIGHT_BROWSERS_PATH") if key in os.environ}
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    command = [sys.executable, "-B", str(root / HARNESS), "--bundle-dir", str(args.baseline_dir),
               "--baseline-revision", old, "--baseline-manifest-sha256", manifest,
               "--new-web-image-id", args.new_web_image_id, "--new-web-revision", args.expected_revision,
               "--output-dir", str(output), "--browser"]
    with subprocess.Popen(command, cwd=root, env=environment, stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True) as process:
        try:
            code = process.wait(timeout=900)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            # Let the fixture's own finally close browser groups, relays and containers.
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=60)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            raise WebBuildError("native mixed-image qualification interrupted")
    require(code == 0, "native mixed-image qualification did not pass")


def qualify(args, environment, docker, *, native=run_native):
    state = args.state_dir
    info = state.lstat()
    require(state.is_absolute() and state == state.resolve(strict=True) and stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700
            and not any(state.is_relative_to(root) for root in (args.root, args.baseline_dir, args.baseline_root)),
            "owned private prepared build state required")
    private_destination(args.bundle_output, args.root, args.baseline_root, args.baseline_dir, state)
    require(matches(IMAGE, args.new_web_image_id) and args.baseline_root != args.root,
            "distinct historical checkout and immutable new Web image required")
    origin, old, current, binding = prepared_inputs(args, environment)
    previous = inputs.decode(read_metadata(state / PREPARED))
    require(isinstance(previous, dict) and set(previous) == {*binding, "capacity"}
            and all(inputs.canonical(previous[key]) == inputs.canonical(value) for key, value in binding.items())
            and inputs.canonical(inputs.load_receipt(state / CURRENT_INPUTS)) == inputs.canonical(current),
            "prepared source, baseline or workflow binding changed")
    capacity = previous["capacity"]
    require(isinstance(capacity, dict) and capacity == admit_capacity(available=capacity.get("availableBytes"),
            candidate=MAX_ARCHIVE_BYTES, migration=GIB, temporary=2 * GIB, reserve=4 * GIB), "prepared disk admission differs")
    facts = binding["facts"]
    require(args.new_web_image_id not in facts["baselineImages"].values(), "candidate Web image reuses a baseline image ID")
    read_web_image(docker, args.new_web_image_id, args.expected_revision)
    available = min(shutil.disk_usage(state).free, shutil.disk_usage(args.bundle_output.parent).free)
    admit_capacity(available=available, candidate=MAX_ARCHIVE_BYTES, migration=0, temporary=0, reserve=4 * GIB)
    verify_baseline_checkout(args.baseline_root, old)
    build = {**facts, "capacity": capacity, "candidateWebImageId": args.new_web_image_id,
             "sourceVerifiedAfterBuild": True, "availableDiskBytesAfterBuild": available}
    write_metadata(state / BUILD, build)
    native(args.baseline_root, args, old, facts["baselineManifestSha256"], state / MIXED)
    verify_baseline_checkout(args.baseline_root, old)
    return create_web_bundle(args.root, args.bundle_output, expected_revision=args.expected_revision,
                             baseline_dir=args.baseline_dir, baseline_revision=old,
                             baseline_manifest_sha256=facts["baselineManifestSha256"], input_receipt_path=state / CURRENT_INPUTS,
                             build_evidence_path=state / BUILD, mixed_report_path=state / MIXED / "report.json",
                             origin=origin, docker=docker)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("prepare", "qualify"):
        command = commands.add_parser(action)
        for name in ("root", "baseline-dir", "baseline-admission", "input-receipt", "state-dir"):
            command.add_argument("--" + name, type=Path, required=True)
        for name in ("expected-revision", "baseline-admission-sha256"):
            command.add_argument("--" + name, required=True)
        if action == "qualify":
            command.add_argument("--baseline-root", type=Path, required=True)
            command.add_argument("--new-web-image-id", required=True)
            command.add_argument("--bundle-output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == "prepare":
            result = prepare(args, os.environ)
        else:
            origin_for(args.expected_revision, os.environ)
            result = qualify(args, os.environ, Docker())
    except (WebBuildError, WebReleaseInputError, CandidateError, inputs.InputError, SmokeError) as error:
        print(f"Web-only build held: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError, BadZipFile, subprocess.SubprocessError):
        print("Web-only build held by input, fixture, or filesystem verification", file=sys.stderr)
        return 1
    if args.action == "qualify":
        result = {**result, "archivePath": str(result["archivePath"])}
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
