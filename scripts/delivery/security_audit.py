"""Audit every Bun lockfile; block new high/critical findings and all such release findings."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PROJECTS = (".", "site", "docs-site", "tests/browser")
SHA = re.compile(r"^[0-9a-f]{40}$")
SEVERITIES = {"low", "moderate", "high", "critical"}


def blocking(report):
    if not isinstance(report, dict):
        raise ValueError("Audit did not return an advisory object")
    found = set()
    for package, advisories in report.items():
        if not isinstance(advisories, list):
            raise ValueError("Invalid audit advisory collection")
        for advisory in advisories:
            if not isinstance(advisory, dict) or advisory.get("severity") not in SEVERITIES or not isinstance(advisory.get("id"), int):
                raise ValueError("Invalid advisory identity/severity")
            if advisory["severity"] in {"high", "critical"}:
                found.add((package, advisory["id"], advisory["severity"]))
    return found


def audit(directory):
    completed = subprocess.run(["bun", "--no-env-file", "audit", "--json"], cwd=directory,
                               capture_output=True, text=True, timeout=90)
    if completed.returncode not in (0, 1):
        raise ValueError(f"Audit command failed ({completed.returncode}): {completed.stderr[-500:]}")
    output = completed.stdout.strip()
    report = {} if completed.returncode == 0 and output in ("", "No vulnerabilities found") else json.loads(output)
    blocking(report)
    if completed.returncode == 1 and not report:
        raise ValueError("Audit failed without advisory details")
    return report


def base_audit(revision, project):
    with tempfile.TemporaryDirectory(prefix="warpdrive-base-audit-") as temp:
        for name in ("package.json", "bun.lock"):
            path = name if project == "." else f"{project}/{name}"
            result = subprocess.run(["git", "show", f"{revision}:{path}"], cwd=ROOT, capture_output=True)
            if result.returncode:
                # A genuinely new package has no prior advisories; a partial base fails closed.
                exists = subprocess.run(["git", "cat-file", "-e", f"{revision}:{project}"], cwd=ROOT, capture_output=True)
                if project != "." and exists.returncode:
                    return {}
                raise ValueError(f"Cannot read base {path}")
            (Path(temp) / name).write_bytes(result.stdout)
        return audit(temp)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if not SHA.fullmatch(args.base):
        raise ValueError("Audit baseline must be a full Git SHA")
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    package = json.loads((ROOT / "package.json").read_text())
    plan = json.loads((ROOT / "docs/delivery/releases/next.json").read_text())
    strict = args.strict or package["version"] == plan["version"]
    summaries, failed = [], False
    for project in PROJECTS:
        current = audit(ROOT / project)
        previous = {} if strict else base_audit(args.base, project)
        findings = blocking(current)
        newly_blocking = findings - blocking(previous)
        failures = findings if strict else newly_blocking
        failed |= bool(failures)
        label = "root" if project == "." else project.replace("/", "-")
        (output / f"{label}.json").write_text(json.dumps(current, indent=2) + "\n")
        summaries.append({"project": project, "high_critical": len(findings), "blocking": len(failures)})
    report = {"mode": "release-strict" if strict else "no-new-high-critical", "projects": summaries,
              "customer_release_blocked": any(row["high_critical"] for row in summaries)}
    (output / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write("## Dependency security\n\n```json\n" + json.dumps(report, indent=2) + "\n```\n")
    if failed:
        raise SystemExit("Dependency security gate failed; advisory reports are retained. No finding was suppressed.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.SubprocessError, OSError) as error:
        raise SystemExit(f"Dependency audit failed closed: {error}") from error
