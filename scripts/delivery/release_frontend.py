"""Bounded frontend 1.7.1.5 source publication; product acceptance stays independent."""
from __future__ import annotations

import hashlib
import json
import re

from release_gates import (
    agent_identity, item_for_issue, manifest_items, nonempty, passed_checks,
    repository_path, verify_ci,
)
from release_mail import classify_history
from release_security import require_selected_main
from release_support import (
    GateError, SHA, canonical_json, load_candidate_json, release_baseline, run, version_tuple,
)

VERSION = "1.7.1.5"
POLICY_PATH = "docs/delivery/frontend-release-policy.json"
PLAN_DIRECTORY = "docs/delivery/releases/frontend"
QUALIFICATION_PATH = "docs/delivery/frontend-qualification-1.7.1.5.json"
FOOTER_PATH = "src/components/shell/SidebarMenu.tsx"
SOURCE_PATHS = frozenset({
    "src/app/(app)/layout.tsx", "src/app/(app)/settings/SettingsNav.tsx",
    "src/components/shell/LeftNav.module.css", FOOTER_PATH,
    "src/features/release/ui/VersionBanner.tsx",
})
CONTRIBUTIONS = {"integration/UX-010": 119, "integration/UX-014": 123}
ORIGINAL_HEADS = frozenset({
    "fc07b5d835518fe3569541973a509dd40d40dada",
    "37df6d0a4e8a6bf7480316f9afd7c13ea1fe62ea",
    "9d73e62785e44c9c57491246b58efad764889407",
    "7d2f652e2323d1ddcc933b5434e0fae306303538",
})
# Retain the existing history boundaries; this track does not move or hide them.
PR_BASELINE = "dfa3f3317e186cbb494aee012cb298363e1a89dd"
CONTEXT_BASELINE = "386e31652da094ddcc7daec7003164b5b9c81882"
CODEQL_WORKFLOW = "403980173"
CODEQL_JOBS = frozenset({
    "Analyze (javascript-typescript)", "Analyze (actions)", "Analyze (python)", "Analyze (go)",
})
CHECKS = frozenset({
    "main-content-scroll", "sidebar-scroll-containment", "settings-navigation-scroll-containment",
    "keyboard-scroll", "mobile-navigation", "rtl-scroll", "release-notes-scroll",
})
FALSE_CLAIMS = (
    "acceptance_claimed", "user_journey_accepted", "provider_installation_accepted",
    "deployment_performed",
)
DIGEST = re.compile(r"^[0-9a-f]{64}$")
FRONTEND_VERSION = re.compile(r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
FOOTER = re.compile(rb'^const FRONTEND_VERSION = "([^"\r\n]+)";$', re.M)


def require(condition, reason):
    if not condition:
        raise GateError(reason)


def validate_policy(policy):
    require(isinstance(policy, dict) and type(policy.get("schema_version")) is int
            and policy["schema_version"] == 1 and policy.get("release_track") == "frontend"
            and policy.get("version") == VERSION
            and policy.get("mode") == "source_qualified_artifact_publication"
            and policy.get("plan_directory") == PLAN_DIRECTORY
            and policy.get("qualification_path") == QUALIFICATION_PATH,
            "Unsupported bounded frontend publication policy")
    require(policy.get("pr_integration_baseline") == PR_BASELINE
            and policy.get("unreleased_context_baseline") == CONTEXT_BASELINE,
            "Frontend publication must preserve the existing source-history boundaries")
    require(policy.get("contributions") == CONTRIBUTIONS,
            "Frontend publication must retain its registered contribution identities")
    heads = policy.get("original_integrated_revisions")
    require(isinstance(heads, list) and all(isinstance(head, str) for head in heads)
            and len(heads) == len(ORIGINAL_HEADS) and set(heads) == ORIGINAL_HEADS,
            "Frontend publication must retain the original requested branch revisions")
    paths = policy.get("required_source_paths")
    require(isinstance(paths, list) and all(isinstance(path, str) for path in paths)
            and len(paths) == len(SOURCE_PATHS) and set(paths) == SOURCE_PATHS,
            "Frontend qualification must pin every scoped source path")
    workflows = policy.get("required_workflows")
    require(isinstance(workflows, dict) and set(workflows) == {CODEQL_WORKFLOW}
            and isinstance(workflows[CODEQL_WORKFLOW], list)
            and all(isinstance(job, str) for job in workflows[CODEQL_WORKFLOW])
            and len(workflows[CODEQL_WORKFLOW]) == len(CODEQL_JOBS)
            and set(workflows[CODEQL_WORKFLOW]) == CODEQL_JOBS,
            "Frontend publication requires all four managed CodeQL analyses")


def validate_proposal(plan, archive, policy):
    validate_policy(policy)
    require(isinstance(plan, dict) and type(plan.get("schema_version")) is int
            and plan["schema_version"] == 1 and plan.get("release_track") == "frontend"
            and plan.get("version") == VERSION,
            "Frontend plan must select the authorized frontend version 1.7.1.5")
    allowed = {"schema_version", "release_track", "version", "qualification",
               "required_integrated_revisions", "revision", "commit_issues", "delivery_scope"}
    require(set(plan).issubset(allowed), "Frontend plan cannot declare issue acceptance or milestone scope")
    require({key: value for key, value in plan.items() if key != "revision"} == archive,
            "Frontend plan must equal its committed per-version plan")
    reference = plan.get("qualification")
    require(isinstance(reference, dict) and set(reference) == {"path", "sha256"}
            and reference.get("path") == QUALIFICATION_PATH
            and isinstance(reference.get("sha256"), str) and DIGEST.fullmatch(reference["sha256"]),
            "Frontend plan must pin a completed qualification record")
    heads = plan.get("required_integrated_revisions")
    require(isinstance(heads, list) and len(heads) >= len(ORIGINAL_HEADS)
            and all(isinstance(head, str) and SHA.fullmatch(head) and head != "0" * 40 for head in heads)
            and len(set(heads)) == len(heads) and ORIGINAL_HEADS.issubset(heads),
            "Frontend plan must retain the original requested revisions and unique additional branch pins")


def validate_qualification(record, revision, policy, read_blob, is_ancestor):
    validate_policy(policy)
    require(isinstance(record, dict) and type(record.get("schema_version")) is int
            and record["schema_version"] == 1
            and record.get("qualification_type") == "frontend_source_and_isolated_runtime"
            and record.get("result") == "qualified" and record.get("version") == VERSION
            and all(record.get(field) is False for field in FALSE_CLAIMS)
            and nonempty(record.get("summary")) and nonempty(record.get("limitations")),
            "Frontend qualification must state actual results and pending acceptance boundaries")
    agent_identity(record.get("reviewer_agent"))
    reviewed = record.get("reviewed_revision")
    require(isinstance(reviewed, str) and SHA.fullmatch(reviewed) and reviewed != "0" * 40
            and isinstance(revision, str) and SHA.fullmatch(revision)
            and is_ancestor(reviewed, revision),
            "Frontend qualification must identify an ancestor source revision")
    checks = record.get("checks")
    require(passed_checks(checks) and len(checks) == len(CHECKS)
            and {check["name"] for check in checks} == CHECKS,
            "Frontend qualification must retain every actual scrolling and navigation check")
    pins = record.get("source_pins")
    require(isinstance(pins, list) and bool(pins), "Frontend qualification needs source blob pins")
    seen = set()
    for pin in pins:
        require(isinstance(pin, dict) and set(pin) == {"path", "sha256"}
                and isinstance(pin.get("sha256"), str) and DIGEST.fullmatch(pin["sha256"]),
                "Frontend source pin is malformed")
        path = repository_path(pin.get("path"))
        require(path not in seen and path != QUALIFICATION_PATH,
                "Frontend pins must be unique and cannot pin the qualification record itself")
        seen.add(path)
        for cut in {reviewed, revision}:
            require(hashlib.sha256(read_blob(cut, path)).hexdigest() == pin["sha256"],
                    f"Frontend qualified source blob changed at {cut}: {path}")
    require(SOURCE_PATHS.issubset(seen), "Frontend qualification omits a required source path")
    matches = FOOTER.findall(read_blob(revision, FOOTER_PATH))
    require(matches == [VERSION.encode("ascii")],
            "Committed frontend footer must exactly match the frontend release version")


def trusted_frontend_policy(revision, repository):
    trusted = load_candidate_json(run("git", "rev-parse", "HEAD").strip(), POLICY_PATH)
    policy = load_candidate_json(revision, POLICY_PATH)
    require(canonical_json(trusted) == canonical_json(policy) and policy.get("repository") == repository,
            "Candidate frontend policy differs from trusted Main")
    validate_policy(policy)
    return policy


def frontend_release_gate(api, plan, core_policy, require_revision, commit_references,
                          allow_published=False):
    repository, revision = core_policy["repository"], plan["revision"]
    require_revision(revision)
    require_selected_main(api, repository, revision)
    policy = trusted_frontend_policy(revision, repository)
    archive = load_candidate_json(revision, f"{PLAN_DIRECTORY}/{VERSION}.json")
    validate_proposal(plan, archive, policy)
    for head in plan["required_integrated_revisions"]:
        run("git", "merge-base", "--is-ancestor", head, revision)
    raw = run("git", "show", f"{revision}:{QUALIFICATION_PATH}", binary=True)
    require(hashlib.sha256(raw).hexdigest() == plan["qualification"]["sha256"],
            "Frontend qualification record differs from its plan pin")
    record = json.loads(raw)
    validate_qualification(
        record, revision, policy,
        lambda cut, path: run("git", "show", f"{cut}:{path}", binary=True),
        lambda ancestor, descendant: run("git", "merge-base", "--is-ancestor", ancestor, descendant) == "",
    )
    items = manifest_items(revision)
    mapping = load_candidate_json(revision, "docs/delivery/issue-map.json")["issues"]
    contributions = []
    for canonical, number in CONTRIBUTIONS.items():
        require(mapping.get(canonical, {}).get("number") == number,
                "Frontend contribution mapping changed")
        issue = api.request(f"repos/{repository}/issues/{number}")
        require(not issue.get("pull_request") and item_for_issue(issue, items)["id"] == canonical,
                "Frontend contribution must retain its canonical issue identity")
        contributions.append({"number": number, "id": canonical, "title": issue["title"],
                              "url": issue["html_url"], "source_state": issue.get("state"),
                              "acceptance_claimed": False})
    required = {name: list(jobs) for name, jobs in core_policy["required_workflows"].items()}
    for name, jobs in policy["required_workflows"].items():
        required[name] = list(dict.fromkeys(required.get(name, []) + jobs))
    ci = verify_ci(api, repository, revision, {"required_workflows": required},
                   dynamic_codeql_workflow=CODEQL_WORKFLOW)
    tags, releases = api.pages(f"repos/{repository}/tags"), api.pages(f"repos/{repository}/releases")
    tag_name = "v" + VERSION
    selected = tuple(map(int, VERSION.split(".")))
    names = [row["name"] for row in tags if row["name"] != tag_name]
    names += [row["tag_name"] for row in releases if row["tag_name"] != tag_name]
    require(all(selected > tuple(map(int, match.groups())) for name in names
                if (match := FRONTEND_VERSION.fullmatch(name))),
            "Frontend version must exceed every other reserved four-part version")
    existing_tag = next((row for row in tags if row["name"] == tag_name), None)
    require(existing_tag is None or existing_tag["commit"]["sha"] == revision,
            "Existing frontend tag points to another revision")
    existing = next((row for row in releases if row["tag_name"] == tag_name), None)
    require(existing is None or existing.get("draft") is True or allow_published,
            "Frontend version is already published")
    base = release_baseline(releases, tags, tag_name, core_policy["traceability_baseline"])
    commits = commit_references(api, repository, revision, base, plan)
    # Broad canonical scopes stay unaccepted. The qualified visual contribution is
    # recorded separately; the whole source archive does not complete those scopes.
    ledger, context = classify_history(api, repository, commits, set(), items, revision,
                                       CONTEXT_BASELINE, allow_fresh_context=True)
    run("git", "merge-base", "--is-ancestor", PR_BASELINE, revision)
    recent = set(run("git", "rev-list", f"{PR_BASELINE}..{revision}").splitlines())
    require(all(row.get("pull_requests") for row in ledger if row["sha"] in recent),
            "Frontend source publication requires merged PR evidence for new commits")
    product_version = load_candidate_json(revision, "package.json")["version"]
    version_tuple(product_version)  # Frontend counters cannot replace product SemVer.
    require_selected_main(api, repository, revision)
    return {
        "schema_version": 1, "snapshot_stage": "pre-publication", "release_track": "frontend",
        "mode": policy["mode"], "repository": repository, "version": VERSION,
        "product_version": product_version, "revision": revision, "base_revision": base,
        "contributions": contributions, "issues": [], "commits": ledger, "ci": ci,
        "unreleased_context": context, "required_integrated_revisions": plan["required_integrated_revisions"],
        "qualification": {**plan["qualification"], "record": record}, "close_milestone": False,
        "stages": {"source": True, "integrated": True, "source_qualified": True,
                   "acceptance_claimed": False, "user_journey_accepted": False, "released": False,
                   "deployed": False, "provider_installation_accepted": False},
    }
