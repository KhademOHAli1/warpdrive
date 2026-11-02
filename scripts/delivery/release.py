#!/usr/bin/env python3
"""Main-first delivery gates and repeatable GitHub releases. Python standard library only."""
from __future__ import annotations
import argparse
import re
import json
from pathlib import Path
import sys

from release_support import (
    ROOT, IDENTITY, SHA, VERSION, ATTESTATION, GateError, GitHub, run, load_json,
    canonical_json, scope_hash, version_tuple, select_version, validate_release_version,
    prepare_package_version, load_candidate_json, published_stable_releases, release_baseline,
)

from release_links import load_commit_links
from release_publication import record_publication

def require_revision(revision):
    if not SHA.fullmatch(revision):
        raise GateError("Revision must be an immutable full lowercase 40-character commit SHA")
    run("git", "merge-base", "--is-ancestor", revision, "origin/main")

from release_gates import manifest_items, item_for_issue, verify_ci, https_evidence, acceptance, verify_issue

def commit_references(api, repo, revision, base, overrides=None):
    links = load_commit_links(ROOT, overrides, document=load_candidate_json(revision, "docs/delivery/commit-links.json"))
    registered = manifest_items(revision)
    run("git", "merge-base", "--is-ancestor", base, revision)
    commits = run("git", "rev-list", "--reverse", f"{base}..{revision}").splitlines()
    rows = []
    for sha in commits:
        message = run("git", "show", "-s", "--format=%B", sha)
        refs = sorted(set(map(int, re.findall(r"(?<![\w/])#([1-9]\d*)\b", message))) | set(links["commit_issues"].get(sha, [])))
        valid = []
        for number in refs:
            issue = api.request(f"repos/{repo}/issues/{number}")
            identities = IDENTITY.findall(issue.get("body") or "")
            if not issue.get("pull_request") and len(identities) == 1 and identities[0] in registered:
                valid.append(number)
        original = valid
        scope = links["delivery_scope"].get(sha)
        broad = []
        if scope:
            valid, broad = scope["delivery_issues"], scope["contributes_to"]
            if not set(original).issubset(set(valid) | set(broad)):
                raise GateError(f"Commit {sha} delivery scope leaves original canonical references unaccounted for")
            for number in valid + broad:
                issue = api.request(f"repos/{repo}/issues/{number}")
                item_for_issue(issue, registered, allow_parent=number in broad)
        if not valid:
            raise GateError(f"Commit {sha} has no canonical delivery issue: add Refs #N / Delivery-Issues: #N, or a committed commit-links mapping")
        pulls = [{"number": p["number"], "title": p["title"], "url": p["html_url"]} for p in api.pages(f"repos/{repo}/commits/{sha}/pulls") if p.get("merged_at")]
        rows.append({"original_issues": original, "contributes_to": broad, "pull_requests": pulls, "sha": sha, "subject": message.splitlines()[0], "issues": valid, "url": f"https://github.com/{repo}/commit/{sha}"})
    return rows

def release_gate(api, plan, policy, allow_published=False):
    repo, revision = policy["repository"], plan["revision"]
    require_revision(revision)
    items = manifest_items(revision)
    if plan.get("schema_version") != 1:
        raise GateError("Unsupported release-plan schema")
    milestones = api.pages(f"repos/{repo}/milestones?state=all")
    milestone = next((m for m in milestones if m["number"] == plan["milestone"]), None)
    if not milestone:
        raise GateError("Selected release milestone does not exist")
    issues = api.pages(f"repos/{repo}/issues?milestone={milestone['number']}&state=all")
    issue_numbers = sorted(i["number"] for i in issues if not i.get("pull_request"))
    if not issue_numbers or sorted(plan["issues"]) != issue_numbers:
        raise GateError("Release plan must include every issue in its nonempty milestone exactly once")
    tags = api.pages(f"repos/{repo}/tags")
    releases = api.pages(f"repos/{repo}/releases")
    initial = not published_stable_releases(releases, "v" + plan["version"]) or milestone["number"] == policy.get("initial_milestone_number")
    required = policy["initial_journeys"] if initial else plan.get("required_journeys", [])
    journeys = plan.get("journeys", {})
    if any(not journeys.get(j) or not set(journeys[j]).issubset(issue_numbers) for j in required):
        raise GateError("Release journey gates are missing accepted issues")
    ci = verify_ci(api, repo, revision, policy)
    accepted = [verify_issue(api, repo, n, revision, items) for n in issue_numbers]
    accepted_ids = {i["number"]: i["id"] for i in accepted}
    if initial:
        for journey, canonical_id in policy["initial_journey_ids"].items():
            if canonical_id not in [accepted_ids[n] for n in journeys.get(journey, [])]:
                raise GateError(f"Initial journey {journey} requires its canonical full-journey issue {canonical_id}")
    existing_release = next((r for r in releases if r["tag_name"] == "v" + plan["version"]), None)
    other_versions = [t["name"] for t in tags if t["name"] != "v" + plan["version"]] + [r["tag_name"] for r in releases if r["tag_name"] != "v" + plan["version"]]
    validate_release_version(load_candidate_json(revision, "package.json")["version"], plan["version"], other_versions)
    same_tag = next((t for t in tags if t["name"] == "v" + plan["version"]), None)
    if same_tag and same_tag["commit"]["sha"] != revision:
        raise GateError("Existing version tag points to a different commit")
    if existing_release and not existing_release["draft"] and not allow_published:
        raise GateError("Version is already published; select the next version")
    base = release_baseline(releases, tags, "v" + plan["version"], policy["traceability_baseline"])
    commits = commit_references(api, repo, revision, base, plan)
    if any(not set(c["issues"]).issubset(issue_numbers) for c in commits):
        raise GateError("Every included commit's canonical issues must be accepted in the selected release milestone")
    return {"schema_version": 1, "snapshot_stage": "pre-publication", "repository": repo, "version": plan["version"], "revision": revision, "base_revision": base, "milestone": {"number": milestone["number"], "title": milestone["title"], "url": milestone["html_url"]}, "journeys": journeys, "issues": accepted, "commits": commits, "ci": ci, "stages": {"source": True, "integrated": True, "user_journey_accepted": True, "released": False, "deployed": False, "provider_installation_accepted": False}}

from release_artifacts import notes, artifacts, verify_uploaded_assets

def trusted_release_policy(revision):
    require_revision(revision)
    trusted_revision = run("git", "rev-parse", "HEAD").strip()
    trusted = load_candidate_json(trusted_revision, "docs/delivery/release-policy.json")
    candidate = load_candidate_json(revision, "docs/delivery/release-policy.json")
    if canonical_json(candidate) != canonical_json(trusted):
        raise GateError("Candidate policy differs from the committed trusted main policy")
    return candidate

def publish(api, plan, evidence, directory, mode):
    repo, revision, tag = evidence["repository"], evidence["revision"], "v" + evidence["version"]
    releases = api.pages(f"repos/{repo}/releases")
    current = next((r for r in releases if r["tag_name"] == tag), None)
    if current and current.get("prerelease") is not False:
        raise GateError("Existing release is a prerelease or lacks explicit stable classification")
    # gh release --verify-tag prevents GitHub from silently tagging the default branch tip.
    refs = api.pages(f"repos/{repo}/tags")
    if not any(t["name"] == tag for t in refs):
        api.request(f"repos/{repo}/git/refs", "POST", {"ref": "refs/tags/" + tag, "sha": revision})
    exact = api.request(f"repos/{repo}/git/ref/tags/{tag}")
    if exact["object"]["type"] != "commit" or exact["object"]["sha"] != revision:
        raise GateError("Release tag no longer points directly to the selected commit")
    if current and not current["draft"]:
        if mode != "publish":
            raise GateError("Refusing to modify an already published release")
        verify_uploaded_assets(directory, current["assets"])
        return record_publication(api, evidence, current["id"])
    body = notes(evidence)
    if not current:
        current = api.request(f"repos/{repo}/releases", "POST", {"tag_name": tag, "target_commitish": revision, "name": f"Warpdrive {evidence['version']}", "body": body, "draft": True, "prerelease": False})
    else:
        api.request(f"repos/{repo}/releases/{current['id']}", "PATCH", {"name": f"Warpdrive {evidence['version']}", "body": body})
    run("gh", "release", "upload", tag, *[str(p) for p in sorted(Path(directory).iterdir()) if p.is_file()], "--repo", repo, "--clobber")
    reread = api.request(f"repos/{repo}/releases/{current['id']}")
    if reread.get("prerelease") is not False:
        raise GateError("Independent release reread must confirm prerelease:false before stable publication")
    verify_uploaded_assets(directory, reread["assets"])
    if mode == "publish":
        # Recheck live acceptance/CI/milestone immediately before the irreversible publish call.
        latest = release_gate(api, plan, trusted_release_policy(revision))
        if canonical_json(latest) != canonical_json(evidence):
            raise GateError("Release evidence changed during preparation; rerun the draft action")
        api.request(f"repos/{repo}/releases/{current['id']}", "PATCH", {"draft": False, "prerelease": False, "make_latest": "true"})
    reread = api.request(f"repos/{repo}/releases/{current['id']}")
    if reread["draft"] != (mode != "publish") or reread["tag_name"] != tag or reread.get("prerelease") is not False:
        raise GateError("Release verification failed")
    return record_publication(api, evidence, current["id"]) if mode == "publish" else reread["html_url"]

def audit_closed(api, number, policy):
    repo = policy["repository"]
    issue = api.request(f"repos/{repo}/issues/{number}")
    if issue.get("pull_request") or not IDENTITY.search(issue.get("body") or "") or issue.get("state") != "closed" or issue.get("state_reason") != "completed":
        return "No completed canonical issue to audit"
    try:
        items = manifest_items()
        item = item_for_issue(issue, items, allow_parent=True)
        candidates = []
        for c in api.pages(f"repos/{repo}/issues/{number}/comments"):
            for raw in ATTESTATION.findall(c.get("body", "")):
                try:
                    a = json.loads(raw)
                    if isinstance(a, dict) and isinstance(a.get("revision"), str) and SHA.fullmatch(a["revision"]) and a.get("canonical_id") == item["id"] and a.get("acceptance_sha256") == scope_hash(item):
                        candidates.append(a["revision"])
                except ValueError:
                    pass
        if not candidates:
            raise GateError("No acceptance attestation")
        failures = []
        for revision in dict.fromkeys(reversed(candidates)):
            try:
                run("git", "merge-base", "--is-ancestor", revision, "origin/main")
                verify_issue(api, repo, number, revision, items, allow_parent=True)
                verify_ci(api, repo, revision, policy)
                return f"Issue #{number} retains completed status with verified acceptance at {revision}"
            except GateError as failure:
                failures.append(str(failure))
        raise GateError("No qualifying acceptance revision: " + failures[0])
    except GateError as error:
        api.request(f"repos/{repo}/issues/{number}", "PATCH", {"state": "open"})
        marker = "<!-- warpdrive:delivery-gate-reopen -->"
        message = f"{marker}\nCompletion requires exact-main CI and authenticated maintainer acceptance covering the full canonical scope. Reopened: {error}. Follow docs/delivery/release-operations.md."
        comments = api.pages(f"repos/{repo}/issues/{number}/comments")
        prior = next((c for c in comments if marker in c.get("body", "") and c.get("user", {}).get("type") == "Bot"), None)
        if prior:
            api.request(f"repos/{repo}/issues/comments/{prior['id']}", "PATCH", {"body": message})
        else:
            api.request(f"repos/{repo}/issues/{number}/comments", "POST", {"body": message})
        return f"Reopened #{number}: {error}"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    version = sub.add_parser("next-version")
    version.add_argument("--bump", choices=["patch", "minor", "major"], default="patch")
    bump = sub.add_parser("bump-version")
    bump.add_argument("--version", required=True)
    bump.add_argument("--apply", action="store_true", help="Write only package/Bun root version fields")
    preflight = sub.add_parser("preflight")
    preflight.add_argument("--revision", required=True)
    verify = sub.add_parser("verify-commits")
    verify.add_argument("--base", required=True)
    verify.add_argument("--revision", required=True)
    verify.add_argument("--plan")
    scope = sub.add_parser("scope")
    scope.add_argument("canonical_id")
    audit = sub.add_parser("audit-closed")
    audit.add_argument("--issue", type=int, required=True)
    for command in ("check", "prepare", "draft", "publish"):
        cmd = sub.add_parser(command)
        cmd.add_argument("--plan", required=True)
        cmd.add_argument("--revision", required=True, help="Exact main SHA read as committed data by trusted release tooling")
        cmd.add_argument("--output", default="work/release")
    args = parser.parse_args()
    if args.command == "preflight":
        require_revision(args.revision)
        print(f"Verified main ancestor: {args.revision}")
        return
    policy = trusted_release_policy(args.revision) if args.command in ("check", "prepare", "draft", "publish") else load_json(ROOT / "docs/delivery/release-policy.json")
    api, repo = GitHub(), policy["repository"]
    if args.command == "next-version":
        names = [t["name"] for t in api.pages(f"repos/{repo}/tags")] + [r["tag_name"] for r in api.pages(f"repos/{repo}/releases")]
        print(select_version(load_json(ROOT / "package.json")["version"], names, bump=args.bump))
    elif args.command == "bump-version":
        names = [t["name"] for t in api.pages(f"repos/{repo}/tags")] + [r["tag_name"] for r in api.pages(f"repos/{repo}/releases")]
        validate_release_version(args.version, args.version, names)
        print(json.dumps({"applied": args.apply, "files": prepare_package_version(ROOT, args.version, apply=args.apply)}))
    elif args.command == "scope":
        print(scope_hash(manifest_items()[args.canonical_id]))
    elif args.command == "audit-closed":
        print(audit_closed(api, args.issue, policy))
    elif args.command == "verify-commits":
        require_revision(args.revision)
        base = policy["traceability_baseline"] if set(args.base) == {"0"} else args.base
        overrides = load_candidate_json(args.revision, args.plan) if args.plan else {}
        print(json.dumps(commit_references(api, repo, args.revision, base, overrides), indent=2))
    else:
        plan = load_candidate_json(args.revision, args.plan)
        if plan.get("revision") and plan["revision"] != args.revision:
            raise GateError("Plan revision conflicts with selected revision")
        plan["revision"] = args.revision
        evidence = release_gate(api, plan, policy, allow_published=args.command == "publish")
        if args.command == "check":
            print(json.dumps(evidence, indent=2))
            return
        directory = artifacts(evidence, args.output)
        if args.command in ("draft", "publish"):
            print(publish(api, plan, evidence, directory, args.command))
        else:
            print(f"Verified release artifacts: {directory}")

if __name__ == "__main__":
    try:
        main()
    except (GateError, KeyError, ValueError) as error:
        print(f"Release gate failed: {error}", file=sys.stderr)
        sys.exit(1)
