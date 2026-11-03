"""Explicit, full-scope MAIL patch and programme release gates."""
from __future__ import annotations

from release_gates import item_for_issue, manifest_items, verify_ci, verify_issue
from release_support import (
    GateError, IDENTITY, SHA, VERSION, canonical_json, load_candidate_json, release_baseline,
    run, validate_release_version, version_tuple,
)

POLICY_PATH = "docs/delivery/mail-release-policy.json"
PLAN_DIRECTORY = "docs/delivery/releases/mail"


def is_mail_version(value):
    """Reserved MAIL versions cannot bypass their track through the core gate."""
    major, minor, _ = version_tuple(value)
    return (major, minor) == (1, 5) or version_tuple(value) == (1, 6, 0)


def next_mail_patch(existing):
    reserved = [version_tuple(v)[2] for v in existing
                if VERSION.fullmatch(v) and version_tuple(v)[:2] == (1, 5)]
    return f"1.5.{max([0] + reserved) + 1}"


def trusted_mail_policy(revision, repository):
    trusted = load_candidate_json(run("git", "rev-parse", "HEAD").strip(), POLICY_PATH)
    candidate = load_candidate_json(revision, POLICY_PATH)
    if canonical_json(trusted) != canonical_json(candidate):
        raise GateError("Candidate MAIL policy differs from committed trusted main policy")
    if (candidate.get("schema_version") != 1 or candidate.get("repository") != repository
            or candidate.get("release_track") != "mail"
            or candidate.get("patch_series") != "1.5"
            or candidate.get("programme_version") != "1.6.0"
            or candidate.get("programme_id") != "programme/mail"
            or candidate.get("plan_directory") != PLAN_DIRECTORY
            or not isinstance(candidate.get("pr_integration_baseline"), str)
            or not SHA.fullmatch(candidate["pr_integration_baseline"])
            or not isinstance(candidate.get("unreleased_context_baseline"), str)
            or not SHA.fullmatch(candidate["unreleased_context_baseline"])
            or candidate.get("assignment") != "completion_order"):
        raise GateError("Unsupported MAIL release policy")
    return candidate


def published_mail_plans(releases, tags, current_tag):
    """Read prior task identities from their immutable tagged committed plans."""
    plans = []
    for release in releases:
        name = release.get("tag_name", "")
        if (release.get("draft") is not False or release.get("prerelease") is True
                or name == current_tag or not VERSION.fullmatch(name)
                or version_tuple(name)[:2] != (1, 5)):
            continue
        if release.get("prerelease") is not False:
            raise GateError("Published MAIL history requires explicit stable classification")
        tag = next((t for t in tags if t["name"] == name), None)
        if not tag:
            raise GateError("Published MAIL release is missing its immutable tag")
        version = name.removeprefix("v")
        plan = load_candidate_json(tag["commit"]["sha"], f"{PLAN_DIRECTORY}/{version}.json")
        if (plan.get("release_track") != "mail" or plan.get("mail_mode") != "incremental"
                or plan.get("version") != version or type(plan.get("primary_issue")) is not int
                or not isinstance(plan.get("canonical_id"), str) or not plan["canonical_id"]):
            raise GateError("Published MAIL release lacks its matching committed task plan")
        plans.append(plan)
    primaries = [p["canonical_id"] for p in plans]
    if len(primaries) != len(set(primaries)):
        raise GateError("Published MAIL history releases the same task more than once")
    return plans


def programme_issues(api, repo, items):
    """Find full canonical coverage without moving previously released milestones."""
    required = {item["id"] for item in items.values() if item.get("module") == "mail"}
    found = {}
    for issue in api.pages(f"repos/{repo}/issues?state=all"):
        if issue.get("pull_request"):
            continue
        identities = IDENTITY.findall(issue.get("body") or "")
        matched = set(identities) & required
        if not matched:
            continue
        if len(identities) != 1 or identities[0] in found:
            raise GateError("MAIL programme coverage has duplicate or ambiguous canonical issues")
        item_for_issue(issue, items, allow_parent=True)
        found[identities[0]] = issue
    if set(found) != required:
        raise GateError("Version 1.6.0 requires every canonical MAIL item in verified programme coverage")
    return sorted(found.values(), key=lambda i: i["number"])


def classify_history(api, repo, commits, numbers, items, revision, context_baseline):
    """Keep the complete ledger while distinguishing released and unreleased scope."""
    run("git", "merge-base", "--is-ancestor", context_baseline, revision)
    historical = set(run("git", "rev-list", context_baseline).splitlines())
    ledger, context_numbers = [], set()
    selected = set(numbers)
    for commit in commits:
        released = sorted(set(commit["issues"]) & selected)
        unreleased = sorted(set(commit["issues"]) - selected)
        contributions = sorted(set(commit.get("contributes_to", [])))
        unreleased_contributions = sorted(set(contributions) - selected)
        if unreleased and commit["sha"] not in historical:
            paths = run("git", "show", "--format=", "--name-only", "--first-parent", commit["sha"]).splitlines()
            if any(path.startswith(("src/", "drizzle/")) for path in paths):
                raise GateError("Fresh production delivery cannot be hidden as historical unreleased context")
        context_numbers.update(unreleased + unreleased_contributions)
        ledger.append(dict(commit, released_issues=released, unreleased_issues=unreleased,
                           unreleased_contributions=unreleased_contributions,
                           scope_status="released_scope" if released and not unreleased and not unreleased_contributions else
                           "mixed_released_and_unreleased_context" if released else "unreleased_context"))
    context = []
    for number in sorted(context_numbers):
        issue = api.request(f"repos/{repo}/issues/{number}")
        item = item_for_issue(issue, items, allow_parent=True)
        context.append({"number": number, "id": item["id"], "title": issue["title"],
                        "url": issue["html_url"], "source_state": issue.get("state"),
                        "release_status": "not_released_by_this_publication",
                        "acceptance_claimed": False})
    return ledger, context


def mail_release_gate(api, plan, core_policy, require_revision, commit_references,
                      allow_published=False):
    repo, revision = core_policy["repository"], plan["revision"]
    require_revision(revision)
    policy = trusted_mail_policy(revision, repo)
    if plan.get("schema_version") != 1 or plan.get("release_track") != "mail":
        raise GateError("Unsupported MAIL release plan")
    mode, version = plan.get("mail_mode"), plan["version"]
    committed = load_candidate_json(revision, f"{PLAN_DIRECTORY}/{version}.json")
    if canonical_json({k: v for k, v in plan.items() if k != "revision"}) != canonical_json(committed):
        raise GateError("MAIL plan must match its committed per-version plan exactly")
    if (mode == "incremental" and (version_tuple(version)[:2] != (1, 5)
                                    or version_tuple(version)[2] < 1)):
        raise GateError("Individual MAIL releases use 1.5.x starting at 1.5.1")
    if mode == "programme" and version != policy["programme_version"]:
        raise GateError("Full MAIL programme publication uses reserved version 1.6.0")
    if mode not in ("incremental", "programme"):
        raise GateError("MAIL release plan requires incremental or programme mode")
    primary = plan.get("primary_issue")
    if type(primary) is not int or primary < 1:
        raise GateError("MAIL plan requires one canonical primary issue")
    planned = plan.get("issues")
    if (not isinstance(planned, list) or not planned
            or any(type(n) is not int or n < 1 for n in planned)
            or len(planned) != len(set(planned))):
        raise GateError("MAIL plan issues must be unique positive integer issue numbers")
    milestones = api.pages(f"repos/{repo}/milestones?state=all")
    milestone = next((m for m in milestones if m["number"] == plan.get("milestone")), None)
    if not milestone:
        raise GateError("Select an actual dedicated MAIL release milestone before checking")
    issues = [i for i in api.pages(f"repos/{repo}/issues?milestone={milestone['number']}&state=all")
              if not i.get("pull_request")]
    numbers = sorted(i["number"] for i in issues)
    if not numbers or sorted(planned) != numbers or primary not in numbers:
        raise GateError("MAIL plan must include every milestone issue exactly once, including its primary")
    items = manifest_items(revision)
    selected = {i["number"]: item_for_issue(i, items, allow_parent=mode == "programme")
                for i in issues}
    primary_item = selected[primary]
    if plan.get("canonical_id") != primary_item["id"]:
        raise GateError("MAIL plan primary issue does not match its canonical identity")
    if mode == "incremental":
        mail = [n for n, item in selected.items() if item.get("module") == "mail"]
        if mail != [primary] or primary_item.get("kind") not in ("task", "deliverable", "maintenance", "bug"):
            raise GateError("A MAIL patch releases exactly one mail deliverable, with accepted support scope only")
    else:
        if primary_item["id"] != policy["programme_id"] or primary_item.get("kind") != "programme":
            raise GateError("Version 1.6.0 requires the canonical full MAIL programme")
    tags, releases = api.pages(f"repos/{repo}/tags"), api.pages(f"repos/{repo}/releases")
    tag_name = "v" + version
    existing = next((r for r in releases if r["tag_name"] == tag_name), None)
    names = [t["name"] for t in tags if t["name"] != tag_name]
    names += [r["tag_name"] for r in releases if r["tag_name"] != tag_name]
    if mode == "incremental":
        if version != next_mail_patch(names):
            raise GateError("Select the next unreserved 1.5.x patch in completion order")
        if primary_item["id"] in {p["canonical_id"] for p in published_mail_plans(releases, tags, tag_name)}:
            raise GateError("This MAIL task already has a published patch release")
    validate_release_version(load_candidate_json(revision, "package.json")["version"], version, names)
    same_tag = next((t for t in tags if t["name"] == tag_name), None)
    if same_tag and same_tag["commit"]["sha"] != revision:
        raise GateError("Existing version tag points to a different commit")
    if existing and not existing["draft"] and not allow_published:
        raise GateError("Version is already published; select the next version")
    required_ci = {name: list(jobs) for name, jobs in core_policy["required_workflows"].items()}
    codeql = policy.get("codeql_workflow_id")
    additional = policy.get("required_workflows", {})
    expected_codeql = {"Analyze (javascript-typescript)", "Analyze (actions)", "Analyze (python)"}
    if (not isinstance(codeql, str) or codeql not in additional
            or set(additional[codeql]) != expected_codeql):
        raise GateError("MAIL release policy must retain its exact managed CodeQL workflow")
    for name, jobs in additional.items():
        required_ci[name] = list(dict.fromkeys(required_ci.get(name, []) + jobs))
    ci = verify_ci(api, repo, revision, {"required_workflows": required_ci},
                   dynamic_codeql_workflow=codeql)
    # This invokes the existing per-ID/full-scope agent policy. Parents and protected
    # human/provider journeys still use human acceptance. Each recursive leaf retains
    # its own explicit eligibility; the parent never inherits agent acceptance.
    memo = {}
    accepted = [verify_issue(api, repo, n, revision, items, allow_agent=True,
                             allow_parent=mode == "programme", memo=memo) for n in numbers]
    coverage = []
    if mode == "programme":
        coverage = [verify_issue(api, repo, issue["number"], revision, items,
                                 allow_agent=True, allow_parent=True, memo=memo)
                    for issue in programme_issues(api, repo, items)]
    base = release_baseline(releases, tags, tag_name, core_policy["traceability_baseline"])
    commits = commit_references(api, repo, revision, base, plan)
    released_scope = set(numbers) | {i["number"] for i in coverage}
    commits, context = classify_history(api, repo, commits, released_scope, items, revision,
                                         policy["unreleased_context_baseline"])
    pr_base = policy["pr_integration_baseline"]
    run("git", "merge-base", "--is-ancestor", pr_base, revision)
    new_commits = set(run("git", "rev-list", f"{pr_base}..{revision}").splitlines())
    if any(c["sha"] in new_commits and not c.get("pull_requests") for c in commits):
        raise GateError("New MAIL release commits require merged pull-request evidence")
    accepted_by_number = {i["number"]: i for i in accepted}
    journey = next((i for i in accepted + coverage if i["id"] == policy["journey_id"]), None)
    return {
        "schema_version": 1, "snapshot_stage": "pre-publication", "release_track": "mail",
        "mail_mode": mode, "primary_issue": primary, "canonical_id": primary_item["id"],
        "repository": repo, "version": version, "revision": revision, "base_revision": base,
        "milestone": {"number": milestone["number"], "title": milestone["title"], "url": milestone["html_url"]},
        "close_milestone": mode == "programme", "journeys": plan.get("journeys", {}),
        "issues": accepted, "commits": commits, "ci": ci, "unreleased_context": context,
        "programme_coverage": coverage, "unreleased_context_baseline": policy["unreleased_context_baseline"],
        "primary_acceptance_mode": accepted_by_number[primary]["acceptance"].get("mode", "human"),
        "stages": {"source": True, "integrated": True, "technical_scope_accepted": True,
                   "user_journey_accepted": bool(journey and journey["acceptance"].get("mode", "human") == "human"),
                   "mail_programme_accepted": mode == "programme", "released": False,
                   "deployed": False, "provider_installation_accepted": False},
    }
