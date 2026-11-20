"""Qualify one exact Web image against retained Core on disposable PostgreSQL."""

import argparse
from pathlib import Path
import re
import sys

from headless_image_smoke import RETAINED_WEB_FIRST_CORE_REVISION, HeadlessImageSmoke
from image_smoke import COMPONENTS, Docker, SmokeError, image_metadata, validate_reference, validate_revision


STABLE_VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")
IMAGE_CONFIG_ID = re.compile(r"sha256:[a-f0-9]{64}")


def validate_web_version(value: str) -> str:
    if not STABLE_VERSION.fullmatch(value):
        raise argparse.ArgumentTypeError("Web version must be a stable major.minor.patch version")
    return value


def validate_core_image_id(value: str) -> str:
    if not IMAGE_CONFIG_ID.fullmatch(value):
        raise argparse.ArgumentTypeError("Exact retained Core config image ID required")
    return value


def validate_baseline_web_image_id(value: str) -> str:
    if not IMAGE_CONFIG_ID.fullmatch(value):
        raise argparse.ArgumentTypeError("Exact baseline Web config image ID required")
    return value


class HeadlessWebSmoke(HeadlessImageSmoke):
    def __init__(self, docker, images, core_image_id, output, revision, retained_revision, web_version,
                 *, baseline_web=None, baseline_web_version=None):
        core_image_id = validate_core_image_id(core_image_id)
        web_version = validate_web_version(web_version)
        self.retained_revision = validate_revision(retained_revision)
        if self.retained_revision == revision:
            raise ValueError("The Web candidate and retained backend require distinct source pins")
        if (baseline_web is None) != (baseline_web_version is None):
            raise ValueError("Baseline Web requires an image ID, revision, and version")
        if baseline_web is not None:
            image_id, baseline_revision = baseline_web
            baseline_web = (validate_baseline_web_image_id(image_id), validate_revision(baseline_revision))
            baseline_web_version = validate_web_version(baseline_web_version)
            if baseline_revision == revision:
                raise ValueError("The candidate and baseline Web require distinct source pins")
        super().__init__(docker, images, core_image_id, output, revision,
                         web_version=web_version, expect_inbox_workspace=True,
                         baseline_web=baseline_web, baseline_web_version=baseline_web_version,
                         historical_web_first=self.retained_revision == RETAINED_WEB_FIRST_CORE_REVISION)
        self.report.update(kind="warpdrive-headless-web-only-image-smoke",
                           retainedRevision=self.retained_revision, expectedWebVersion=self.web_version)
        self.report["limitations"] = [
            "Exact Web and retained Core images exercised on fresh disposable PostgreSQL and an internal Docker bridge.",
            "Worker, Realtime and Migrator are fixtures built at the retained source revision.",
            "Realtime rejects unauthenticated traffic. Worker processes one empty-database file reaper job after restart.",
            "Additional generation combinations, installed ingress, populated upgrades, external providers and "
            "production acceptance require separate evidence.",
        ]

    def inspect_images(self):
        local_ids = set()
        for role, reference in {**self.images, "core": self.core_image}.items():
            raw = self.docker.json(["image", "inspect", reference])
            revision = self.expected_revision if role == "web" else self.retained_revision
            identity = image_metadata(raw, revision)
            if role == "core" and identity["id"] != self.core_image:
                raise SmokeError("Core image differs from the admitted config digest")
            if raw[0].get("Os") != "linux" or raw[0].get("Architecture") != "amd64":
                raise SmokeError(f"{role} image must be linux/amd64")
            if identity["id"] in local_ids:
                raise SmokeError("Final images must have distinct immutable IDs")
            local_ids.add(identity["id"])
            if role == "core":
                self.report["coreImage"] = identity
            else:
                self.report["images"][role] = identity
        if self.baseline_web is not None:
            self.inspect_baseline_web(local_ids)
        return {
            "webRevision": self.expected_revision,
            "retainedRevision": self.retained_revision,
            "components": [*COMPONENTS, "core"],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for component in COMPONENTS:
        parser.add_argument(f"--{component}-image", required=True, type=validate_reference)
    parser.add_argument("--core-image-id", required=True, type=validate_core_image_id)
    parser.add_argument("--expected-revision", required=True, type=validate_revision)
    parser.add_argument("--retained-revision", required=True, type=validate_revision)
    parser.add_argument("--web-version", required=True, type=validate_web_version)
    parser.add_argument("--baseline-web-image", type=validate_baseline_web_image_id)
    parser.add_argument("--baseline-web-revision", type=validate_revision)
    parser.add_argument("--baseline-web-version", type=validate_web_version)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    baseline_pins = (args.baseline_web_image, args.baseline_web_revision, args.baseline_web_version)
    if any(baseline_pins) and not all(baseline_pins):
        parser.error("Baseline Web requires an image ID, revision, and version")
    baseline = baseline_pins[:2] if all(baseline_pins) else None
    images = {component: getattr(args, f"{component}_image") for component in COMPONENTS}
    try:
        smoke = HeadlessWebSmoke(Docker(), images, args.core_image_id, args.output_dir,
                                 args.expected_revision, args.retained_revision, args.web_version,
                                 baseline_web=baseline, baseline_web_version=args.baseline_web_version)
        return 0 if smoke.run() else 1
    except (SmokeError, ValueError, OSError, argparse.ArgumentTypeError) as error:
        print(f"Headless Web smoke admission failed ({type(error).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
