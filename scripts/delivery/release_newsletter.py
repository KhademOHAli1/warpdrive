"""Bounded newsletter source qualification and publication for the authorized 1.6.1 release."""
from __future__ import annotations

import hashlib
import json
import re

from release_gates import (
    agent_identity, https_evidence, item_for_issue, manifest_items, nonempty,
    passed_checks, repository_path, verify_ci,
)
from release_mail import classify_history
from release_security import require_selected_main
from release_support import (
    GateError, SHA, canonical_json, load_candidate_json, release_baseline, run,
    scope_hash, validate_release_version,
)
from tracking_model import START, END, managed_spec

POLICY_PATH = "docs/delivery/newsletter-release-policy.json"
PLAN_DIRECTORY = "docs/delivery/releases/newsletter"
QUALIFICATION_PATH = "docs/delivery/newsletter-qualification-1.6.1.json"
VERSION = "1.6.1"
SCOPES = {
    "integration/newsletter-campaign-foundation": 1011,
    "integration/newsletter-crm-consent-and-delivery": 1013,
}
PRIMARY = "integration/newsletter-crm-consent-and-delivery"
PR_BASELINE = "dfa3f3317e186cbb494aee012cb298363e1a89dd"
CONTEXT_BASELINE = "386e31652da094ddcc7daec7003164b5b9c81882"
CODEQL_WORKFLOW = "403980173"
CODEQL_CATEGORIES = frozenset({
    "/language:javascript-typescript", "/language:actions", "/language:python", "/language:go",
})
CODEQL_JOBS = {f"Analyze ({category.removeprefix('/language:')})" for category in CODEQL_CATEGORIES}
FALSE_CLAIMS = ("acceptance_claimed", "user_journey_accepted", "provider_installation_accepted")
DIGEST = re.compile(r"^[0-9a-f]{64}$")


class NewsletterIssueSnapshot:
    """Share each live issue read within one gate, with a fresh snapshot on recheck."""

    def __init__(self, api, repository):
        self.api = api
        self.issue_path = re.compile(rf"repos/{re.escape(repository)}/issues/[1-9][0-9]*")
        self.issues = {}

    def request(self, path, method="GET", payload=None):
        if method == "GET" and payload is None and self.issue_path.fullmatch(path):
            if path not in self.issues:
                self.issues[path] = self.api.request(path)
            return self.issues[path]
        if method == "GET" and payload is None:
            return self.api.request(path)
        return self.api.request(path, method, payload)

    def pages(self, path, key=None):
        return self.api.pages(path, key)


def require(condition, reason):
    if not condition:
        raise GateError(reason)


def validate_policy(policy):
    require(isinstance(policy, dict) and type(policy.get("schema_version")) is int
            and policy.get("schema_version") == 1
            and policy.get("release_track") == "newsletter" and policy.get("version") == VERSION
            and policy.get("mode") == "source_qualified_artifact_publication"
            and policy.get("qualification_path") == QUALIFICATION_PATH
            and policy.get("plan_directory") == PLAN_DIRECTORY,
            "Unsupported newsletter publication policy")
    require(policy.get("pr_integration_baseline") == PR_BASELINE
            and policy.get("unreleased_context_baseline") == CONTEXT_BASELINE,
            "Newsletter publication must preserve the existing source-history baselines")
    paths = policy.get("required_source_paths")
    require(isinstance(paths, list) and bool(paths) and all(isinstance(path, str) for path in paths)
            and len(paths) == len(set(paths)),
            "Newsletter qualification needs unique required source paths")
    for path in paths:
        repository_path(path)
    workflows = policy.get("required_workflows")
    require(isinstance(workflows, dict) and policy.get("codeql_workflow_id", CODEQL_WORKFLOW) == CODEQL_WORKFLOW
            and isinstance(workflows.get(CODEQL_WORKFLOW), list)
            and all(isinstance(job, str) for job in workflows[CODEQL_WORKFLOW])
            and set(workflows[CODEQL_WORKFLOW]) == CODEQL_JOBS,
            "Newsletter publication requires all four managed CodeQL analyses")


def validate_newsletter_proposal(package, plan, archive, items, mapping, policy):
    validate_policy(policy)
    require(type(plan.get("schema_version")) is int and plan.get("schema_version") == 1
            and plan.get("release_track") == "newsletter"
            and plan.get("version") == VERSION and package.get("version") == VERSION,
            "Newsletter plan and package must select the authorized version 1.6.1")
    require({key: value for key, value in plan.items() if key != "revision"} == archive,
            "Newsletter plan must equal its committed per-version plan")
    numbers = plan.get("issues")
    require(plan.get("primary_issue") == SCOPES[PRIMARY] and plan.get("canonical_id") == PRIMARY
            and isinstance(numbers, list) and all(type(number) is int for number in numbers)
            and sorted(numbers) == sorted(SCOPES.values()),
            "Newsletter publication is limited to the two registered integration scopes")
    require(not plan.get("journeys") and plan.get("milestone") is None
            and all(plan.get(key, False) is False for key in FALSE_CLAIMS),
            "Newsletter source publication cannot claim journey acceptance or milestone completion")
    reference = plan.get("qualification")
    require(isinstance(reference, dict) and set(reference) == {"path", "sha256"}
            and reference.get("path") == QUALIFICATION_PATH
            and isinstance(reference.get("sha256"), str) and DIGEST.fullmatch(reference["sha256"]),
            "Newsletter plan must pin its source qualification record")
    for canonical, number in SCOPES.items():
        item = items.get(canonical)
        require(isinstance(item, dict) and item.get("module") == "integrations"
                and item.get("kind") == "deliverable"
                and mapping.get(canonical, {}).get("number") == number,
                "Newsletter scope registration differs from the authorized release")


def qualified_scope(scope, items, reviewed_items):
    canonical = scope.get("canonical_id")
    require(canonical in SCOPES and scope.get("issue") == SCOPES[canonical],
            "Newsletter qualification contains an unrelated scope")
    item, reviewed = items[canonical], reviewed_items.get(canonical)
    require(reviewed is not None and scope.get("scope_sha256") == scope_hash(item) == scope_hash(reviewed),
            "Newsletter canonical scope changed after source qualification")
    expected = {f"AC{index}" for index in range(1, len(item["acceptance"]) + 1)}
    criteria = scope.get("criteria")
    require(isinstance(criteria, list) and len(criteria) == len(expected)
            and all(isinstance(clause, dict) and clause.get("result") == "qualified"
                    and isinstance(clause.get("evidence"), list) and clause["evidence"]
                    and all(https_evidence(url) for url in clause["evidence"]) for clause in criteria)
            and {clause.get("id") for clause in criteria} == expected,
            "Newsletter qualification must cover each canonical criterion with source evidence")
    return {"number": SCOPES[canonical], "id": canonical, "scope_sha256": scope["scope_sha256"],
            "criteria": criteria, "acceptance_claimed": False}


def validate_qualification(record, items, selected_revision, policy, read_blob, is_ancestor):
    validate_policy(policy)
    require(isinstance(record, dict) and record.get("schema_version") == 1
            and record.get("qualification_type") == "newsletter_source_and_isolated_runtime"
            and record.get("result") == "qualified" and record.get("version") == VERSION
            and all(record.get(key) is False for key in FALSE_CLAIMS)
            and record.get("deployment_performed") is False
            and record.get("live_provider_status") == "pending"
            and nonempty(record.get("summary")) and nonempty(record.get("limitations"))
            and passed_checks(record.get("checks")),
            "Newsletter record must state actual source qualification and pending acceptance boundaries")
    agent_identity(record.get("reviewer_agent"))
    reviewed = record.get("reviewed_revision")
    require(isinstance(reviewed, str) and SHA.fullmatch(reviewed)
            and isinstance(selected_revision, str) and SHA.fullmatch(selected_revision)
            and is_ancestor(reviewed, selected_revision),
            "Newsletter qualification must identify an ancestor source revision")
    reviewed_items = {item["id"]: item for item in json.loads(
        read_blob(reviewed, "docs/delivery/roadmap.json"))["items"]}
    scopes = record.get("scopes")
    require(isinstance(scopes, list) and len(scopes) == len(SCOPES)
            and all(isinstance(scope, dict) for scope in scopes)
            and {scope.get("canonical_id") for scope in scopes} == set(SCOPES),
            "Newsletter qualification must cover both registered scopes once")
    rows = [qualified_scope(scope, items, reviewed_items) for scope in scopes]
    pins = record.get("source_pins")
    require(isinstance(pins, list) and bool(pins), "Newsletter qualification needs source blob pins")
    seen = set()
    for pin in pins:
        require(isinstance(pin, dict) and set(pin) == {"path", "sha256"}
                and isinstance(pin.get("sha256"), str) and DIGEST.fullmatch(pin["sha256"]),
                "Newsletter source pin is malformed")
        path = repository_path(pin["path"])
        require(path not in seen and path != QUALIFICATION_PATH,
                "Newsletter source pins must be unique and exclude the qualification record")
        seen.add(path)
        for revision in {reviewed, selected_revision}:
            require(hashlib.sha256(read_blob(revision, path)).hexdigest() == pin["sha256"],
                    f"Newsletter qualified source blob changed at {revision} in {path}")
    require(set(policy["required_source_paths"]).issubset(seen),
            "Newsletter qualification omits a required source path")
    return sorted(rows, key=lambda row: row["number"])


def trusted_newsletter_policy(revision, repository):
    trusted = load_candidate_json(run("git", "rev-parse", "HEAD").strip(), POLICY_PATH)
    policy = load_candidate_json(revision, POLICY_PATH)
    require(canonical_json(trusted) == canonical_json(policy) and policy.get("repository") == repository,
            "Candidate newsletter policy differs from trusted Main")
    validate_policy(policy)
    return policy


def live_qualified_issues(api, repository, items, scopes):
    qualified = []
    for scope in scopes:
        issue = api.request(f"repos/{repository}/issues/{scope['number']}")
        require(not issue.get("pull_request"), "Newsletter source scope must reference a canonical issue")
        item = item_for_issue(issue, items)
        require(item["id"] == scope["id"], "Newsletter issue identity changed")
        body = issue.get("body") or ""
        require(body.count(START) == 1 and body.count(END) == 1,
                "Newsletter issue must retain its unique managed specification")
        start, end = body.index(START), body.index(END) + len(END)
        require(body[start:end] == managed_spec(item, repository),
                "Newsletter live issue specification differs from the qualified canonical scope")
        qualified.append({**scope, "title": issue["title"], "url": issue["html_url"],
                          "source_state": issue.get("state"), "source_state_reason": issue.get("state_reason")})
    return qualified


def newsletter_release_gate(api, plan, core_policy, require_revision, commit_references,
                            allow_published=False):
    repository, revision = core_policy["repository"], plan["revision"]
    api = NewsletterIssueSnapshot(api, repository)
    require_revision(revision)
    require_selected_main(api, repository, revision)
    policy = trusted_newsletter_policy(revision, repository)
    items = manifest_items(revision)
    archive = load_candidate_json(revision, f"{PLAN_DIRECTORY}/{VERSION}.json")
    mapping = load_candidate_json(revision, "docs/delivery/issue-map.json")["issues"]
    validate_newsletter_proposal(load_candidate_json(revision, "package.json"), plan, archive,
                                 items, mapping, policy)
    raw = run("git", "show", f"{revision}:{QUALIFICATION_PATH}", binary=True)
    require(hashlib.sha256(raw).hexdigest() == plan["qualification"]["sha256"],
            "Newsletter qualification record differs from its plan pin")
    record = json.loads(raw)
    scopes = validate_qualification(
        record, items, revision, policy,
        lambda cut, path: run("git", "show", f"{cut}:{path}", binary=True),
        lambda ancestor, descendant: run("git", "merge-base", "--is-ancestor", ancestor, descendant) == "",
    )
    issues = live_qualified_issues(api, repository, items, scopes)
    required = {name: list(jobs) for name, jobs in core_policy["required_workflows"].items()}
    for name, jobs in policy["required_workflows"].items():
        required[name] = list(dict.fromkeys(required.get(name, []) + jobs))
    ci = verify_ci(api, repository, revision, {"required_workflows": required},
                   dynamic_codeql_workflow=CODEQL_WORKFLOW)
    tags, releases = api.pages(f"repos/{repository}/tags"), api.pages(f"repos/{repository}/releases")
    tag_name = "v" + VERSION
    names = [row["name"] for row in tags if row["name"] != tag_name]
    names += [row["tag_name"] for row in releases if row["tag_name"] != tag_name]
    validate_release_version(VERSION, VERSION, names)
    existing_tag = next((row for row in tags if row["name"] == tag_name), None)
    require(existing_tag is None or existing_tag["commit"]["sha"] == revision,
            "Existing newsletter tag points to another revision")
    existing = next((row for row in releases if row["tag_name"] == tag_name), None)
    require(existing is None or existing.get("draft") is True or allow_published,
            "Newsletter version is already published")
    base = release_baseline(releases, tags, tag_name, core_policy["traceability_baseline"])
    commits = commit_references(api, repository, revision, base, plan)
    ledger, context = classify_history(api, repository, commits, set(SCOPES.values()), items, revision,
                                       CONTEXT_BASELINE, allow_fresh_context=True)
    run("git", "merge-base", "--is-ancestor", PR_BASELINE, revision)
    recent = set(run("git", "rev-list", f"{PR_BASELINE}..{revision}").splitlines())
    require(all(row.get("pull_requests") for row in ledger if row["sha"] in recent),
            "Newsletter source publication requires merged PR evidence for new commits")
    for row in ledger:
        row["qualified_issues"] = row.pop("released_issues")
        row["scope_status"] = "unreleased_context"
        if row["qualified_issues"]:
            row["scope_status"] = "qualified_newsletter_source"
            if row["unreleased_issues"] or row["unreleased_contributions"]:
                row["scope_status"] = "mixed_qualified_source_and_unreleased_context"
    return {
        "schema_version": 1, "snapshot_stage": "pre-publication", "release_track": "newsletter",
        "mode": policy["mode"], "repository": repository, "version": VERSION, "revision": revision,
        "base_revision": base, "primary_issue": SCOPES[PRIMARY], "canonical_id": PRIMARY,
        "issues": issues, "commits": ledger, "ci": ci, "unreleased_context": context,
        "qualification": {**plan["qualification"], "record": record}, "close_milestone": False,
        "stages": {"source": True, "integrated": True, "source_qualified": True,
                   "acceptance_claimed": False, "user_journey_accepted": False,
                   "released": False, "deployed": False, "provider_installation_accepted": False},
    }
