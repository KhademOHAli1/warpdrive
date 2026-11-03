"""Validate release PR metadata without executing application code or publishing anything."""
import argparse
import json
import re
import subprocess

STABLE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
SHA = re.compile(r"^[0-9a-f]{40}$")
AUTOMATION_PREFIXES = (".github/", "scripts/delivery/", "docs/delivery/", "tests/browser/")
AUTOMATION_FILES = {"AGENTS.md", "ciWorkflow.test.ts", ".gitignore", "eslint.config.mjs"}


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def document(revision, path):
    return json.loads(git("show", f"{revision}:{path}"))


def version(value):
    if not isinstance(value, str) or not STABLE.fullmatch(value):
        raise ValueError("Release versions must use stable MAJOR.MINOR.PATCH")
    return tuple(map(int, value.split(".")))


def validate(base_package, package, plan, paths, notes, registered):
    """Automation maintenance can land without falsely declaring a customer release."""
    if not paths:
        raise ValueError("No changed files to validate")
    current, selected = version(base_package["version"]), version(package["version"])
    automation = all(p in AUTOMATION_FILES or p.startswith(AUTOMATION_PREFIXES) for p in paths)
    if automation and selected == current:
        return "automation-maintenance"
    if selected <= current:
        raise ValueError("Product changes to main require an increasing release version")
    if plan.get("schema_version") != 1 or plan.get("version") != package["version"]:
        raise ValueError("The committed release plan must match the package version")
    issues = plan.get("issues")
    if not isinstance(issues, list) or not issues or any(type(n) is not int or n <= 0 for n in issues) or len(set(issues)) != len(issues):
        raise ValueError("Release scope needs unique canonical issue numbers")
    if not set(issues).issubset(registered):
        raise ValueError("Release scope contains an unregistered issue")
    if type(plan.get("milestone")) is not int or plan["milestone"] <= 0:
        raise ValueError("Release scope needs its milestone")
    if not isinstance(notes, str) or len(notes.strip()) < 80:
        raise ValueError("A release needs reviewed scope, verification and known limitations in its release notes")
    return "customer-release"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    if not SHA.fullmatch(args.base) or not SHA.fullmatch(args.head):
        raise ValueError("Base and head must be immutable full SHAs")
    paths = git("diff", "--name-only", "--no-renames", args.base, args.head).splitlines()
    package = document(args.head, "package.json")
    mapping = document(args.head, "docs/delivery/issue-map.json")
    # issue-map.json uses canonical IDs as keys; never guess identities from PR numbers.
    entries = mapping.get("issues", {})
    registered = {entry["number"] for entry in entries.values()}
    notes_path = f"docs/delivery/releases/{package['version']}.md"
    notes = git("show", f"{args.head}:{notes_path}") if notes_path in git("ls-tree", "-r", "--name-only", args.head).splitlines() else ""
    outcome = validate(document(args.base, "package.json"), package,
                       document(args.head, "docs/delivery/releases/next.json"), paths, notes, registered)
    from release import commit_references
    from release_support import GitHub
    from release_gates import RELEASE_POLICY
    policy = document(args.head, RELEASE_POLICY)
    commit_references(GitHub(), policy["repository"], args.head, args.base)
    print(f"Release PR classification: {outcome}; {len(paths)} changed files")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Release PR gate failed: {error}") from error
