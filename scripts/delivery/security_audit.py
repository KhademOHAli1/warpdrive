#!/usr/bin/env python3
"""Retain each Bun audit's raw evidence; every nonzero exit fails at every severity."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROJECTS = (".", "site", "docs-site", "tools/browser-smoke", "tools/web-ui")
COMMAND = ("bun", "--no-env-file", "audit", "--json")
SEVERITIES = {"low", "moderate", "high", "critical"}
DOCS_PROJECT = "docs-site"
RENDERER_PATH = ".docs-renderer"
RENDERER_PIN = "docs-site/renderer.lock"


def digest(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Audit input is not a regular committed file: {path.name}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def raw_bytes(value):
    return value if isinstance(value, bytes) else (value or "").encode()


def reported_advisories(stdout):
    """Validate the retained Bun package-to-advisory-list JSON envelope."""
    if not stdout.strip():
        return 0
    try:
        report = json.loads(stdout)
    except (ValueError, UnicodeDecodeError) as failure:
        raise ValueError("Malformed Bun audit JSON") from failure
    if not isinstance(report, dict):
        raise ValueError("Bun audit JSON must be an advisory object")
    count = 0
    for package, advisories in report.items():
        if not package.strip() or not isinstance(advisories, list):
            raise ValueError("Malformed Bun audit advisory collection")
        for advisory in advisories:
            if (not isinstance(advisory, dict) or type(advisory.get("id")) is not int
                    or advisory["id"] < 1 or not isinstance(advisory.get("severity"), str)
                    or advisory["severity"] not in SEVERITIES):
                raise ValueError("Malformed Bun audit advisory identity/severity")
        count += len(advisories)
    return count


def project_directory(root, project):
    directory = root / (RENDERER_PATH if project == DOCS_PROJECT else project)
    if directory.is_symlink() or directory.resolve() != directory.absolute():
        raise ValueError(f"Audit project must stay inside the checkout: {project}")
    return directory


def renderer_commit(root, directory):
    pin = root / RENDERER_PIN
    digest(pin)  # Reject symlinks and missing files before parsing.
    revision = pin.read_text(encoding="ascii").rstrip("\n")
    if not re.fullmatch(r"[0-9a-f]{40}", revision) or revision == "0" * 40:
        raise ValueError("Invalid pinned documentation renderer revision")
    if not (directory / ".git").is_dir() or (directory / ".git").is_symlink():
        raise ValueError("Missing prepared documentation renderer checkout")
    try:
        head = subprocess.check_output(
            ["git", "--no-replace-objects", "rev-parse", "HEAD"], cwd=directory, stderr=subprocess.DEVNULL,
            timeout=15, text=True,
        ).strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as failure:
        raise ValueError("Cannot verify documentation renderer checkout") from failure
    if head != revision:
        raise ValueError("Documentation renderer checkout differs from its pinned revision")
    return revision


def renderer_blob_digest(directory, revision, name):
    try:
        blob = subprocess.check_output(
            ["git", "--no-replace-objects", "show", f"{revision}:{name}"], cwd=directory, stderr=subprocess.DEVNULL,
            timeout=15,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as failure:
        raise ValueError(f"Cannot verify committed documentation renderer {name}") from failure
    return hashlib.sha256(blob).hexdigest()


def run_bun_audit(directory):
    return subprocess.run(COMMAND, cwd=directory, capture_output=True, timeout=60, check=False)


def audit_project(root, project, output):
    directory = project_directory(root, project)
    revision = renderer_commit(root, directory) if project == DOCS_PROJECT else None
    paths = {name: directory / name for name in ("package.json", "bun.lock")}
    before = {name: digest(path) for name, path in paths.items()}
    if revision and any(
        renderer_blob_digest(directory, revision, name) != value
        for name, value in before.items()
    ):
        raise ValueError("Documentation renderer dependency files differ from pinned blobs")
    label = "root" if project == "." else project.replace("/", "-")
    error = None
    try:
        completed = run_bun_audit(directory)
        code, stdout, stderr = completed.returncode, completed.stdout, completed.stderr
    except subprocess.TimeoutExpired as failure:
        code, stdout, stderr, error = None, raw_bytes(failure.stdout), raw_bytes(failure.stderr), "timeout"
    except OSError:
        code, stdout, stderr, error = None, b"", b"", "command-unavailable"
    stdout_path, stderr_path = output / f"{label}.stdout", output / f"{label}.stderr"
    stdout_path.write_bytes(stdout)
    stderr_path.write_bytes(stderr)
    after = {name: digest(path) for name, path in paths.items()}
    unchanged = before == after
    findings = None
    if code == 0:
        try:
            findings = reported_advisories(stdout)
        except ValueError:
            error = "malformed-audit-output"
        else:
            if findings:
                error = "advisories-reported-with-zero-exit"
    # Native zero remains required. Malformed success output or any advisory also
    # fails; no severity threshold, baseline comparison or allowlist is applied.
    return {"project": project, "command": list(COMMAND), "exit_code": code,
            "result": "passed" if code == 0 and unchanged and error is None else "failed", "error": error,
            "advisory_count": findings,
            "input_sha256": before, "inputs_unchanged": unchanged,
            **({"renderer_revision": revision} if revision else {}),
            "stdout": {"path": stdout_path.name, "sha256": hashlib.sha256(stdout).hexdigest(), "bytes": len(stdout)},
            "stderr": {"path": stderr_path.name, "sha256": hashlib.sha256(stderr).hexdigest(), "bytes": len(stderr)}}


def audit_all(root, output):
    root, output = Path(root).resolve(), Path(output)
    output.mkdir(parents=True, exist_ok=False)
    if output.is_symlink():
        raise ValueError("Audit output must be a new directory")
    rows = []
    for project in PROJECTS:
        try:
            rows.append(audit_project(root, project, output))
        except (OSError, ValueError) as failure:
            # Keep the other locks observable even if one input is unavailable.
            rows.append({"project": project, "result": "failed", "error": str(failure)})
    report = {"schema_version": 1, "mode": "all-dependencies-all-severities",
              "passed": all(row["result"] == "passed" for row in rows), "projects": rows,
              "limit": "Native audit status, validated zero-exit JSON and raw outputs only; no runtime or release acceptance claim."}
    (output / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    report = audit_all(ROOT, args.output)
    print(json.dumps(report, indent=2))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write("## Dependency audit\n\n```json\n" + json.dumps(report, indent=2) + "\n```\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as failure:
        raise SystemExit(f"Dependency audit failed closed: {failure}") from failure
