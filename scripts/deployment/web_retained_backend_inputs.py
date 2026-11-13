"""Freshly verify the unchanged backend closure for an independently built Web image."""

import argparse
from copy import deepcopy
import os
from pathlib import Path
import re
import sys

import component_inputs as inputs


RETAINED = ("worker", "realtime", "migrator")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
DISCOVER = """
const [, , baseImage, platform, APP_VERSION, NEXT_PUBLIC_WS_URL] = process.argv;
const { generateComponentInputs } = await import('./scripts/deployment/component_inputs.mjs');
const receipt = await generateComponentInputs({
  root: process.cwd(),
  components: ['worker', 'realtime', 'migrator'],
  baseImage,
  platform,
  buildArgs: { APP_VERSION, NEXT_PUBLIC_WS_URL },
});
process.stdout.write(JSON.stringify(receipt));
"""


def verify_retained_backend_inputs(root, *, expected_revision, retained_receipt, expected_retained_sha256):
    """Return a fresh three-component receipt equal to the admitted original backend.

    The caller authenticates the full original receipt's canonical digest using
    release custody. This function verifies inputs and source ownership only.
    """
    root = Path(root)
    inputs.require(root.is_absolute() and root == root.resolve(strict=True) and root.is_dir()
                   and isinstance(expected_revision, str) and REVISION.fullmatch(expected_revision),
                   "Exact canonical backend discovery checkout and source revision required")
    original = deepcopy(retained_receipt)
    inputs.validate_receipt(original)
    inputs.require(isinstance(expected_retained_sha256, str) and inputs.HASH.fullmatch(expected_retained_sha256)
                   and inputs.content_hash(original) == expected_retained_sha256,
                   "Original full component input receipt differs from its admitted digest")
    retained = {**original, "components": {name: original["components"][name] for name in RETAINED}}
    # Prove the exact retained discovery implementation and all original backend
    # inputs before executing any checkout code. The fresh pass then proves closure.
    inputs.verify_source_revision(root, retained, expected_revision)
    context = retained["context"]
    # Both exported modules use argv[1] as a realpath-based CLI guard.
    arguments = ["node", "--input-type=module", "-e", DISCOVER, "--", ".", context["baseImage"], context["platform"],
                 context["buildArgs"]["APP_VERSION"], context["buildArgs"]["NEXT_PUBLIC_WS_URL"]]
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    fresh = inputs.validate_receipt(inputs.decode(inputs._discover(arguments, root, environment)), components=RETAINED)
    inputs.require(inputs.canonical(fresh["context"]) == inputs.canonical(retained["context"])
                   and inputs.canonical(fresh["policy"]) == inputs.canonical(retained["policy"])
                   and fresh["inputPolicySha256"] == retained["inputPolicySha256"],
                   "Immutable backend build context or input policy changed")
    for name in RETAINED:
        inputs.require(inputs.canonical(fresh["components"][name]) == inputs.canonical(retained["components"][name]),
                       f"Fresh {name} graph or complete component input record differs from the original backend")
    inputs.verify_source_revision(root, fresh, expected_revision)
    return fresh


def _write_private(path, receipt):
    path = Path(path)
    parent = path.parent
    inputs.require(path.is_absolute() and parent == parent.resolve(strict=True), "Canonical backend receipt output required")
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "wb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(inputs.canonical(receipt) + b"\n")
        output.flush()
        os.fsync(output.fileno())
    descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--retained-receipt", required=True, type=Path)
    parser.add_argument("--expected-retained-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = verify_retained_backend_inputs(args.root, expected_revision=args.expected_revision,
            retained_receipt=inputs.load_receipt(args.retained_receipt), expected_retained_sha256=args.expected_retained_sha256)
        _write_private(args.output, result)
    except (OSError, ValueError, TypeError, KeyError) as error:
        reason = str(error) if isinstance(error, inputs.InputError) else type(error).__name__
        print(f"Retained backend input verification held. {reason}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
