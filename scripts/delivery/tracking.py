#!/usr/bin/env python3
"""Resumable GitHub roadmap import (Python standard library and gh).

The importer never closes issues, resets live status, changes milestones or
assignees on existing issues, deletes relationships, or publishes commits.
Dry-run is the default. Rerun a bounded records phase to resume safely.
"""

import argparse
import json
from pathlib import Path
import subprocess
import sys
from collections import Counter

from tracking_api import Gh
from tracking_adopt import adopt_existing
from tracking_import import run_import, snapshot
from tracking_model import (
    ROOT, TrackingError, digest, index_issues, issue_body, load_csv,
    managed_spec, mapping, operation_lock, reconcile_body, validate,
)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "import", "snapshot", "adopt"))
    parser.add_argument("--manifest", default=str(ROOT / "docs/delivery/roadmap.json"))
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", action="store_true", help="Perform idempotent additive mutations")
    modes.add_argument("--dry-run", action="store_true", help="Read-only plan (default)")
    parser.add_argument("--checkpoint", default=str(ROOT / "docs/delivery/import-state.json"))
    parser.add_argument("--mapping", default=str(ROOT / "docs/delivery/issue-map.json"))
    parser.add_argument("--output", default=str(ROOT / "docs/delivery/execution-snapshot.json"))
    parser.add_argument("--max-create", type=int, help="Bound issue creations in this run; resume by rerunning")
    parser.add_argument("--max-writes", type=int, help="Bound all external write requests, including metadata and relationships; stop cleanly and checkpoint")
    parser.add_argument("--canonical-id", help="Registered bounded canonical ID for adopting an existing intake issue")
    parser.add_argument("--issue", type=int, help="Existing issue number for adoption; never creates an issue")
    parser.add_argument("--allow-partial", action="store_true", help="Permit an explicitly labeled partial execution snapshot")
    parser.add_argument("--repair-relationships", action="store_true", help="Explicitly restore approved previously verified relationships missing from GitHub")
    parser.add_argument("--pause", type=float, default=0.8, help="Minimum seconds between write requests; no automatic write retries")
    parser.add_argument("--skip-relationships", action="store_true", help="Import issue records first, reconcile native edges on a later run")
    parser.add_argument("--phase", choices=("all", "records", "relationships", "project"), default="all", help="Resume one stage independently without unnecessary writes")
    parser.add_argument("--refresh-spec", action="store_true", help="Refresh only unchanged importer-managed specification regions")
    parser.add_argument("--project-config", help="Optional Project node/field IDs; needs existing project read/write access")
    args = parser.parse_args()
    if args.pause < 0 or (args.max_create is not None and args.max_create < 0) or (args.max_writes is not None and args.max_writes < 0):
        parser.error("--pause, --max-create and --max-writes must be nonnegative")
    if args.command == "adopt" and (not args.canonical_id or args.issue is None or args.issue < 1):
        parser.error("adopt requires --canonical-id and a positive --issue number")
    try:
        manifest = json.loads(Path(args.manifest).read_text())
        indexed = validate(manifest)
        if args.command == "validate":
            result = {"valid": True, "items": len(indexed), "sources": len(manifest.get("sources", [])), "original_tasks": sum(len(item.get("source_tasks", [])) for item in manifest["items"]), "modules": dict(Counter(item["module"] for item in manifest["items"]))}
        elif args.command == "snapshot":
            result = snapshot(manifest, Gh(args.pause), args.output, checkpoint_path=args.checkpoint, mapping_path=args.mapping, allow_partial=args.allow_partial)
        else:
            action = adopt_existing if args.command == "adopt" else run_import
            if args.apply:
                with operation_lock(Path(args.checkpoint).with_suffix(".lock")):
                    result = action(manifest, Gh(args.pause), args)
            else:
                result = action(manifest, Gh(args.pause), args)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if result.get("conflicts"):
            return 2
        return 0
    except (TrackingError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"tracking: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
