"""Sample public health once and attempt one retained alert on the observer host."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess

from check_public_availability import _hostname, check, record_observation
from deliver_public_availability import deliver_next


_HELD = (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError)


def tick(directory, hostname, config, *, threshold=2, curl="/usr/bin/curl", run=subprocess.run):
    """Return bounded states even if either of the two independent steps is held."""
    _hostname(hostname)
    if type(threshold) is not int or not 1 <= threshold <= 10:
        raise ValueError("Availability threshold must be between 1 and 10")
    result = {
        "schemaVersion": 1, "kind": "warpdrive-public-availability-tick",
        "sample": "unknown", "record": "held", "delivery": "held", "observerStale": None,
    }
    try:
        sample = check(hostname, curl=curl, run=run)
        result["sample"] = sample["state"]
        record_observation(directory, hostname, sample, threshold=threshold)
        result["record"] = "recorded"
    except _HELD:
        pass

    try:
        delivery = deliver_next(directory, hostname, config, curl=curl, run=run)
        result["delivery"] = delivery["state"]
        result["observerStale"] = delivery["observerStale"]
    except _HELD:
        pass
    return result


def _exit_status(result):
    if result["delivery"] == "held":
        return 1
    if result["record"] == "held" or result["observerStale"] is not False or result["sample"] == "unknown":
        return 2
    return 1 if result["sample"] == "failed" else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hostname")
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--failure-threshold", type=int, default=2)
    args = parser.parse_args(argv)
    try:
        result = tick(args.state_dir, args.hostname, args.config, threshold=args.failure_threshold,
                      curl=shutil.which("curl") or "/usr/bin/curl")
    except ValueError:
        parser.exit(2, "Invalid availability hostname or threshold.\n")
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return _exit_status(result)


if __name__ == "__main__":
    raise SystemExit(main())
