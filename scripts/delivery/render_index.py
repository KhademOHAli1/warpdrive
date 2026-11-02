#!/usr/bin/env python3
"""Render the root roadmap from the source register and verified issue mapping."""

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote

from tracking_model import ROOT, TrackingError, validate

PROJECT = {"url": "https://github.com/users/KhademOHAli1/projects/3", "visibility": "public"}
VIEWS = ((1, "Full roadmap"), (5, "By module"), (2, "Next release"), (3, "Blocked work"), (4, "Maintenance"))


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def markdown_table(headers, rows, right_aligned=()):
    """Match the repository's Markdown table padding without a formatter dependency."""
    widths = [max(3, len(header), *(len(row[index]) for row in rows)) for index, header in enumerate(headers)]
    def line(values, right=()):
        return "| " + " | ".join(value.rjust(widths[index]) if index in right else value.ljust(widths[index]) for index, value in enumerate(values)) + " |"
    separators = ["-" * (width - 1) + ":" if index in right_aligned else "-" * width for index, width in enumerate(widths)]
    return [line(headers), line(separators), *(line(row, right_aligned) for row in rows)]


def render_index(manifest, issue_map, allow_partial=False):
    validate(manifest)
    repository = manifest["repository"]
    project = dict(PROJECT, **manifest.get("project", {}))
    if project["visibility"] not in {"public", "private"} or not re.fullmatch(r"https://github\.com/(?:users|orgs)/[A-Za-z0-9_.-]+/projects/[1-9]\d*", project["url"]):
        raise TrackingError("Invalid Project URL or visibility in roadmap metadata")
    if issue_map.get("repository") != repository:
        raise TrackingError("Issue mapping belongs to another repository")
    mapped = issue_map.get("issues", {})
    expected = {item["id"] for item in manifest["items"]}
    missing = sorted(expected - mapped.keys())
    if missing and not allow_partial:
        raise TrackingError(f"Unmapped roadmap items: {len(missing)}. Finish import or use --allow-partial to show pending items explicitly.")
    for ident in expected & mapped.keys():
        number = mapped[ident].get("number")
        url = mapped[ident].get("url", "")
        if not isinstance(number, int) or not re.fullmatch(rf"https://github\.com/{re.escape(repository)}/issues/{number}", url):
            raise TrackingError(f"Invalid mapped issue URL for {ident}")
    refs = Counter(ref["source"] for item in manifest["items"] for ref in item.get("source_tasks", []))
    linked_refs = Counter(ref["source"] for item in manifest["items"] if item["id"] in mapped for ref in item.get("source_tasks", []))
    lines = ["# Warpdrive roadmap", "", "GitHub issues and the central Project own live execution. Committed specifications retain approved product and technical decisions. Source CSV/JSON ledgers are historical import records; generated snapshots are observations of GitHub at their recorded time.", "", " | ".join(f"[{name}]({project['url']}/views/{number})" for number, name in VIEWS), "", f"The Project is user-owned and {project['visibility']}. Issue links below follow repository visibility. Project visibility is configured separately from repository access.", ""]
    if missing:
        lines.extend([f"Import pending: **{len(missing)}** canonical items have no verified GitHub mapping yet. No placeholder issue URLs are generated.", ""])
    lines.extend(["## Programmes", ""])
    programme_rows = []
    by_id = {item["id"]: item for item in manifest["items"]}
    def root_id(item):
        while item.get("parent"):
            item = by_id[item["parent"]]
        return item["id"]
    programme_counts = Counter()
    for item in manifest["items"]:
        programme_counts[root_id(item)] += len(item.get("source_tasks", []))
    for item in manifest["items"]:
        if item["kind"] != "programme":
            continue
        entry = mapped.get(item["id"])
        title = f"[{cell(item['title'])}]({entry['url']})" if entry else f"{cell(item['title'])} (Import pending)"
        programme_rows.append([title, cell(item['module']), str(programme_counts[item['id']])])
    lines.extend(markdown_table(["Programme", "Module", "Approved task references"], programme_rows))
    lines.extend(["", "## Original roadmap coverage", "", "Counts describe each source namespace, including aliases to the same canonical implementation. Sources overlap. These counts must not be added into a combined completion rate.", ""])
    source_rows = []
    for source in manifest.get("sources", []):
        path = source.get("snapshot_path") or source.get("path") or source.get("ref") or "docs/delivery/roadmap.json"
        if isinstance(path, list):
            path = path[0] if path else "docs/delivery/roadmap.json"
        if path.startswith("/") or "://" in path or ".." in Path(path).parts:
            path = "docs/delivery/roadmap.json"
        url = f"https://github.com/{repository}/blob/main/{quote(path, safe='/#')}"
        source_rows.append([f"`{cell(source['id'])}`", str(refs[source['id']]), str(linked_refs[source['id']]), f"[Source]({url})"])
    lines.extend(markdown_table(["Source namespace", "Original task references", "Mapped references", "Specification / preserved snapshot"], source_rows, right_aligned=(1, 2)))
    lines.extend(["", "## Working and shipping", "", "- [Original-task to canonical-issue mapping](docs/delivery/issue-map.json).", "- [Approved source register and task definitions](docs/delivery/roadmap.json).", "- [Import, reconciliation and snapshot operator guide](docs/delivery/tracking.md).", "- [Delivery and release operator guide](docs/delivery/README.md).", "- [Report a bug, feature or maintenance task](https://github.com/" + repository + "/issues/new/choose).", "", "Source implemented, integrated with required green CI, user journey accepted, released, deployed, and real provider/installation accepted are separate evidence stages. A broad task remains open until all its applicable acceptance criteria are met. Main commits and PRs both link canonical issues. Release publication is an explicit action after revision and milestone gates pass; deployment keeps its separate authorization boundary.", "", "This file is generated by `python3 scripts/delivery/render_index.py`. Refresh it after source reconciliation or issue import; update live delivery status in GitHub.", ""])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(ROOT / "docs/delivery/roadmap.json"))
    parser.add_argument("--mapping", default=str(ROOT / "docs/delivery/issue-map.json"))
    parser.add_argument("--output", default=str(ROOT / "ROADMAP.md"))
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("--check", action="store_true", help="Fail if output differs; do not write")
    args = parser.parse_args()
    try:
        rendered = render_index(json.loads(Path(args.manifest).read_text()), json.loads(Path(args.mapping).read_text()), args.allow_partial)
        output = Path(args.output)
        if args.check:
            if not output.exists() or output.read_text() != rendered:
                raise TrackingError("Roadmap index is stale; regenerate it")
        else:
            output.write_text(rendered)
        print(json.dumps({"output": str(output), "checked": args.check}))
        return 0
    except (TrackingError, OSError, ValueError) as exc:
        print(f"render_index: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
