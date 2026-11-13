"""Prepare and qualify a single repeat Web image with the retained backend artifacts."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys

import component_inputs as inputs
from candidate import CandidateError, admit_capacity, require
from image_smoke import Docker, SmokeError
from web_candidate import MAX_ARCHIVE_BYTES
from web_composite_baseline import verify_web_composite_baseline
from web_release_build import GIB, HARNESS, checkout, git, matches, origin_for, private_destination, read_metadata, write_metadata
from web_repeat_inputs import verify_web_repeat_inputs
from web_repeat_source import verify_repeat_presentation_git


def _composite(args):
    return verify_web_composite_baseline(web_receipt=read_metadata(args.web_receipt),
        expected_web_receipt_sha256=args.web_receipt_sha256, web_bundle_dir=args.retained / "web",
        backend_bundle_dir=args.retained / "core", expected_backend_manifest_sha256=args.core_manifest_sha256)


def _prepare_facts(args, environment):
    origin = origin_for(args.revision, environment)
    checkout(args.root, args.revision)
    require(not git(args.root, "status", "--porcelain=v1", "--untracked-files=all", allow_empty=True),
            "Repeat build needs a clean exact source checkout")
    composite = _composite(args)
    active = composite["web"]["sourceRevision"]
    source = subprocess.run(["node", str(args.root / "scripts/deployment/web_repeat_presentation.mjs"),
        str(args.root), args.tooling_revision, args.revision], cwd=args.root, capture_output=True, timeout=90, check=False)
    require(source.returncode == 0, "Repeat candidate did not pass the reviewed presentation profile")
    presentation = inputs.decode(source.stdout)
    before = composite["web"]["inputReceipt"]
    tooling = verify_repeat_presentation_git(args.root, presentation, active_inputs=before,
        active_revision=active, tooling_revision=args.tooling_revision)
    current = inputs.load_receipt(args.input_receipt)
    inputs.verify_current(args.root, current, expected_revision=args.revision)
    admission = verify_web_repeat_inputs(composite=composite, active_inputs=before, candidate_inputs=current,
        presentation=presentation, expected_candidate_revision=args.revision, expected_profile_sha256=presentation["profileSha256"],
        tooling=tooling if tooling["toolingPaths"] else None)
    require(matches(inputs.HASH, args.lineage_sha256), "An independently retained installed-lineage digest is required")
    facts = {"origin": origin, "root": str(args.root), "toolingRevision": args.tooling_revision,
             "retainedDirectory": str(args.retained), "webReceiptSha256": args.web_receipt_sha256,
             "lineageSha256": args.lineage_sha256, "presentation": presentation, "inputAdmission": admission}
    return facts, composite, current


def prepare(args, environment):
    private_destination(args.state_dir, args.root, args.retained)
    facts, _, current = _prepare_facts(args, environment)
    capacity = admit_capacity(available=shutil.disk_usage(args.state_dir.parent).free,
                              candidate=MAX_ARCHIVE_BYTES, migration=GIB, temporary=2 * GIB, reserve=4 * GIB)
    args.state_dir.mkdir(mode=0o700)
    write_metadata(args.state_dir / "prepared.json", {"facts": facts, "capacity": capacity})
    write_metadata(args.state_dir / "component-inputs.json", current)
    return {"revision": args.revision, "buildComponents": ["web"], "profileSha256": facts["presentation"]["profileSha256"],
            "deploymentAuthorized": False}


def _native(args, composite):
    core = composite["backend"]
    checkout(args.seed_root, core["sourceRevision"])
    command = [sys.executable, "-B", str(args.root / HARNESS), "--bundle-dir", str(args.retained / "core"),
        "--baseline-revision", core["sourceRevision"], "--baseline-manifest-sha256", args.core_manifest_sha256,
        "--active-web-bundle", str(args.retained / "web"), "--active-web-publication-receipt", str(args.web_receipt),
        "--active-web-publication-receipt-sha256", args.web_receipt_sha256, "--seed-root", str(args.seed_root),
        "--harness-revision", args.revision, "--new-web-image-id", args.new_web_image_id,
        "--new-web-revision", args.revision, "--output-dir", str(args.state_dir / "mixed"), "--browser"]
    allowed = ("PATH", "HOME", "TMPDIR", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "PLAYWRIGHT_BROWSERS_PATH")
    environment = {key: os.environ[key] for key in allowed if key in os.environ}
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    with subprocess.Popen(command, cwd=args.root, env=environment, stdin=subprocess.DEVNULL, start_new_session=True) as fixture:
        try:
            require(fixture.wait(timeout=900) == 0, "Repeat native mixed-image qualification failed")
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            fixture.send_signal(signal.SIGINT)
            try:
                fixture.wait(timeout=60)
            except subprocess.TimeoutExpired:
                os.killpg(fixture.pid, signal.SIGKILL)
                fixture.wait(timeout=5)
            raise CandidateError("Repeat native fixture was interrupted") from None


def qualify(args, environment, docker):
    from web_repeat_candidate import create_repeat_web_bundle

    private_destination(args.bundle_output, args.root, args.retained, args.state_dir, args.seed_root)
    facts, composite, current = _prepare_facts(args, environment)
    saved = inputs.decode(read_metadata(args.state_dir / "prepared.json"))
    require(saved["facts"] == facts and inputs.load_receipt(args.state_dir / "component-inputs.json") == current,
            "Exact repeat source, input, or artifact admission changed after the build")
    available = shutil.disk_usage(args.bundle_output.parent).free
    admit_capacity(available=available, candidate=MAX_ARCHIVE_BYTES, migration=GIB, temporary=GIB, reserve=4 * GIB)
    _native(args, composite)
    return create_repeat_web_bundle(args.root, args.bundle_output, expected_revision=args.revision,
        composite=composite, expected_installed_lineage_sha256=args.lineage_sha256,
        presentation=facts["presentation"], expected_profile_sha256=facts["presentation"]["profileSha256"],
        expected_harness_revision=args.revision, input_receipt_path=args.state_dir / "component-inputs.json",
        mixed_report_path=args.state_dir / "mixed/report.json", candidate_web_image_id=args.new_web_image_id,
        origin=facts["origin"], docker=docker, expected_tooling_revision=args.tooling_revision)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("prepare", "qualify"):
        command = commands.add_parser(action)
        for name in ("root", "retained", "web-receipt", "input-receipt", "state-dir"):
            command.add_argument("--" + name, type=Path, required=True)
        for name in ("revision", "tooling-revision", "core-manifest-sha256", "web-receipt-sha256", "lineage-sha256"):
            command.add_argument("--" + name, required=True)
        if action == "qualify":
            command.add_argument("--seed-root", type=Path, required=True)
            command.add_argument("--bundle-output", type=Path, required=True)
            command.add_argument("--new-web-image-id", required=True)
    args = parser.parse_args(argv)
    try:
        origin_for(args.revision, os.environ)
        result = prepare(args, os.environ) if args.action == "prepare" else qualify(args, os.environ, Docker())
    except (OSError, ValueError, TypeError, KeyError, SmokeError, subprocess.SubprocessError) as error:
        print(f"Repeat Web build held ({type(error).__name__}): {str(error)[:200]}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
