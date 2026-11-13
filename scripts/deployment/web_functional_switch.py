"""Qualify an already-built Switch Web image on protected hosted main."""

import argparse
import json
import os
from pathlib import Path
import sys

from bundle import load_bundle
from candidate import IMAGE_ID, require
from component_inputs import HASH, content_hash, decode
from image_smoke import Docker, SmokeError
from web_candidate import _input_file
from web_functional_build import prepare
from web_functional_candidate import create_functional_bundle
from web_mixed_image_smoke import (CRM_SWITCH, add_mixed_options, functional_successor_baseline,
                                  functional_successor_mode, run_native_mixed)
from web_release_build import origin_for


def qualify(args):
    origin = origin_for(args.new_web_revision, os.environ)
    require(origin["event"] == "workflow_dispatch" and args.new_web_revision == args.harness_revision
            and args.browser is True and args.sdk_keyboard_help is True and args.topbar_gaps is None
            and functional_successor_mode(args), "Exact hosted Switch predecessor and native browser required")
    require(IMAGE_ID.fullmatch(args.new_web_image_id) and HASH.fullmatch(args.baseline_manifest_sha256)
            and HASH.fullmatch(args.installed_lineage_sha256) and HASH.fullmatch(args.expected_input_sha256),
            "Exact Switch image, installed lineage and independent build receipt required")
    args.profile, args.switch_successor, args.verify = None, True, True
    args.revision, args.active_web_revision = args.new_web_revision, args.successor_web_revision
    args.core_bundle_dir, args.core_revision = args.bundle_dir, args.baseline_revision
    args.core_manifest_sha256 = args.baseline_manifest_sha256
    browser_dir, args.output = args.output_dir, args.input_path
    before = prepare(args)
    require(before["inputSha256"] == args.expected_input_sha256, "Switch build receipt differs from prebuild admission")
    backend = load_bundle(args.bundle_dir, expected_revision=args.baseline_revision)
    composite = functional_successor_baseline(args, backend)
    require(run_native_mixed(args, sdk_scenario=CRM_SWITCH), "Native Switch browser qualification failed")
    require(content_hash(decode(_input_file(args.input_path))) == before["inputSha256"],
            "Switch build receipt changed during browser qualification")
    return create_functional_bundle(args.bundle_output, input_path=args.input_path, mixed_path=browser_dir / "report.json",
        composite=composite, revision=args.new_web_revision, origin=origin, image_id=args.new_web_image_id,
        expected_input_sha256=before["inputSha256"], installed_lineage_sha256=args.installed_lineage_sha256,
        sdk_scenario=CRM_SWITCH, expected_tooling_revision=args.tooling_revision,
        expected_profile_sha256=args.profile_sha256, docker=Docker())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    add_mixed_options(parser)
    for name in ("root", "context", "web-projection", "sdk-core", "sdk-react", "input-path", "bundle-output"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("tooling-revision", "profile-sha256", "installed-lineage-sha256", "expected-input-sha256"):
        parser.add_argument("--" + name, required=True)
    try:
        result = qualify(parser.parse_args(argv))
    except (OSError, ValueError, TypeError, KeyError, SmokeError, RuntimeError) as error:
        print(f"Functional Switch qualification held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    print(json.dumps({"revision": result["revision"], "bundleManifestSha256": result["bundleManifestSha256"],
                      "deploymentAuthorized": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
