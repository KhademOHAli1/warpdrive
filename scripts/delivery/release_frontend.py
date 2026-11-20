"""Explicitly authorized frontend source publications; product acceptance stays independent."""
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
    GateError, SHA, canonical_json, load_candidate_json, release_baseline, run,
    validate_release_version,
)

VERSION = "1.7.2"
POLICY_PATH = "docs/delivery/frontend-release-policy.json"
PLAN_DIRECTORY = "docs/delivery/releases/frontend"
QUALIFICATION_PATH = "docs/delivery/frontend-qualification-1.7.2.json"
FOOTER_PATH = "src/components/shell/SidebarMenu.tsx"
PACKAGE_PATH = "package.json"
SOURCE_PATHS = frozenset({
    "src/app/(app)/layout.tsx", "src/app/(app)/settings/SettingsNav.tsx",
    "src/components/shell/LeftNav.module.css", FOOTER_PATH, PACKAGE_PATH,
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
# The historical 1.7.2 contract stays fixed. The user separately authorized the
# complete headless extraction as 1.8.1; both reuse the same publication gates.
HEADLESS_VERSION = "1.8.1"
HEADLESS_SOURCE_PATHS = frozenset({
    PACKAGE_PATH, FOOTER_PATH, "src/app/layout.tsx", "src/app/(app)/layout.tsx",
    "src/config/env.ts", "src/contracts/auth.ts", "src/contracts/actionEffects.ts",
    "src/frontend/config.ts", "src/frontend/headers.ts", "src/frontend/proxy.ts",
    "src/frontend/trpc.ts", "src/frontend/context.ts", "src/frontend/actions.ts",
    "src/frontend/reads.ts", "src/frontend/version.ts", "src/instrumentation.ts",
    "src/server/actions/registry.ts", "src/server/actions/router.ts",
    "src/server/frontend/router.ts", "src/server/http/handler.ts",
    "src/server/http/proxyAuthority.ts", "src/server/http/routes.ts",
    "src/server/request.ts", "src/server/locale.ts", "src/server/trpc/context.ts",
    "src/server/trpc/core-runtime.ts", "src/server/trpc/core-service.ts",
    "src/server/trpc/http.ts", "src/server/trpc/root.ts", "src/server/trpc/trpc.ts",
    "src/features/auth/csrf.ts", "src/features/auth/session.ts",
    "src/features/i18n/server.ts", "docker-compose.yml", "docker-compose.newsletters.yml",
    "deploy/images/Dockerfile", "deploy/images/Web.Dockerfile",
})
HEADLESS_CHECKS = frozenset({
    "credential-free-frontend-build", "emitted-frontend-boundary", "authenticated-ssr",
    "server-action-cookie-roundtrip", "native-auth-relay", "backend-command-authority",
    "native-drain-and-cleanup", "independent-source-review",
})
INBOX_VERSION = "1.8.2"
INBOX_SOURCE_PATHS = frozenset({
    PACKAGE_PATH, FOOTER_PATH, "scripts/browser-shell-scroll.mjs",
    "src/app/(app)/layout.tsx", "src/app/(app)/inbox/InboxShell.tsx",
    "src/app/globals.css", "src/components/shell/LeftNav.module.css",
    "src/components/shell/SidebarChrome.tsx", "src/components/shell/TopBar.module.css",
    "src/features/email/inboxWorkspace.module.css",
})
INBOX_CHECKS = frozenset({
    "shell-header-sidebar-alignment", "inbox-panel-spacing", "inbox-responsive-navigation",
    "rtl-shell-and-inbox", "independent-source-review",
})
HEADLESS_ROLLOUT_VERSION = "1.9.1"
HEADLESS_ROLLOUT_SOURCE_PATHS = frozenset({
    PACKAGE_PATH, FOOTER_PATH, ".env.web.example", "bun.lock", "bunfig.toml",
    ".github/actions/install-custody-oras/action.yml",
    ".github/workflows/headless-web-qualification.yml", ".github/workflows/production-images.yml",
    "deploy/images/Core.Dockerfile", "deploy/images/Dockerfile", "deploy/images/Web.Dockerfile",
    "deploy/images/compose.core.yml",
    "deploy/images/compose.web.yml", "deploy/images/compose.yml", "docker-compose.yml",
    "docs/delivery/module-versions.json", "docs/deployment-headless.md",
    "scripts/deployment/bundle.py", "scripts/deployment/candidate.py",
    "scripts/deployment/component_boundaries.mjs", "scripts/deployment/core_runtime_monitor.py",
    "docs/deployment-evidence/headless-web-rollout-20261120.json",
    "scripts/deployment/headless-web-baseline.json", "scripts/deployment/headless_fixture.py",
    "scripts/deployment/headless_image_smoke.py", "scripts/deployment/headless_web_custody.py",
    "scripts/deployment/headless_web_qualification_inputs.py", "scripts/deployment/headless_web_smoke.py",
    "scripts/deployment/image_smoke.py", "scripts/deployment/install-web-ui.mjs",
    "scripts/deployment/native_image_identity.py", "scripts/deployment/registry_candidate.py",
    "scripts/deployment/registry_smoke.py", "scripts/deployment/web_extension_inputs.py",
    "scripts/deployment/web_rollout_monitor.py", "scripts/deployment/web_sdk_archive.py",
    "scripts/deployment/web_sdk_full_inputs.mjs", "scripts/deployment/web_sdk_full_receipt.py",
    "tools/web-ui/bun.lock", "tools/web-ui/package.json",
    "src/app/api/health/route.ts", "src/app/api/readyz/route.ts", "src/app/api/trpc/[trpc]/route.ts",
    "src/config/coreEnv.ts", "src/contracts/coreDiagnostics.ts", "src/entrypoints/core-api.ts",
    "src/features/operations/contracts.ts", "src/features/operations/reads.ts",
    "src/features/operations/router.ts", "src/features/operations/ui/OperationsLogs.tsx",
    "src/frontend/config.ts", "src/frontend/proxy.ts", "src/frontend/readiness.ts",
    "src/server/runtime/coreDiagnostics.ts", "src/server/trpc/core-runtime.ts",
    "src/server/trpc/core-service.ts",
})
HEADLESS_ROLLOUT_CHECKS = frozenset({
    "independent-frontend-development", "headless-amd64-web-rollout", "required-core-bundle",
    "core-runtime-diagnostics", "independent-source-review",
})
HEADLESS_ROLLOUT_WORKFLOWS = {
    "425440847": ("headless-web-qualification.yml", "Qualify headless Web with retained Core"),
    "414961940": ("production-images.yml", "Final production image smoke"),
}
SCOPES = {
    VERSION: {"version": VERSION, "qualification_path": QUALIFICATION_PATH,
              "source_paths": SOURCE_PATHS, "contributions": CONTRIBUTIONS,
              "heads": ORIGINAL_HEADS, "checks": CHECKS},
    HEADLESS_VERSION: {"version": HEADLESS_VERSION,
                      "qualification_path": "docs/delivery/frontend-qualification-1.8.1.json",
                      "source_paths": HEADLESS_SOURCE_PATHS,
                      "contributions": {"integration/OPS-002": 483},
                      "heads": frozenset({"22fbef5623cf8a13472b124e13c019632ff2c02e"}),
                      "checks": HEADLESS_CHECKS},
    INBOX_VERSION: {"version": INBOX_VERSION,
                    "qualification_path": "docs/delivery/frontend-qualification-1.8.2.json",
                    "source_paths": INBOX_SOURCE_PATHS,
                    "contributions": {"integration/UX-010": 119},
                    "heads": frozenset({"842d7022090ce355215bfae3e82f3e9a471279d9"}),
                    "checks": INBOX_CHECKS},
    HEADLESS_ROLLOUT_VERSION: {
        "version": HEADLESS_ROLLOUT_VERSION,
        "qualification_path": "docs/delivery/frontend-qualification-1.9.1.json",
        "source_paths": HEADLESS_ROLLOUT_SOURCE_PATHS,
        "contributions": {"integration/OPS-002": 483, "integration/OPS-004": 485,
                          "integration/OPS-011": 492, "integration/OSS-011": 529},
        "heads": frozenset({"f4ca71162a9b6dd49a53f8afc729439b3d235334",
                            "cf811ecba8ea3718132632709c255dd04873c21d"}),
        "checks": HEADLESS_ROLLOUT_CHECKS,
        "hosted_workflows": HEADLESS_ROLLOUT_WORKFLOWS,
    },
}

FALSE_CLAIMS = (
    "acceptance_claimed", "user_journey_accepted", "provider_installation_accepted",
    "deployment_performed",
)
DIGEST = re.compile(r"^[0-9a-f]{64}$")
FOOTER = re.compile(rb'^const FRONTEND_VERSION = "([^"\r\n]+)";$', re.M)


def require(condition, reason):
    if not condition:
        raise GateError(reason)


def frontend_scope(version):
    require(isinstance(version, str) and version in SCOPES,
            "Unsupported authorized frontend release version")
    return SCOPES[version]


def validate_policy(policy):
    require(isinstance(policy, dict), "Frontend policy must be an object")
    scope = frontend_scope(policy.get("version"))
    require(isinstance(policy, dict) and type(policy.get("schema_version")) is int
            and policy["schema_version"] == 1 and policy.get("release_track") == "frontend"
            and policy.get("version") == scope["version"]
            and policy.get("mode") == "source_qualified_artifact_publication"
            and policy.get("plan_directory") == PLAN_DIRECTORY
            and policy.get("qualification_path") == scope["qualification_path"],
            "Unsupported bounded frontend publication policy")
    require(policy.get("pr_integration_baseline") == PR_BASELINE
            and policy.get("unreleased_context_baseline") == CONTEXT_BASELINE,
            "Frontend publication must preserve the existing source-history boundaries")
    require(policy.get("contributions") == scope["contributions"],
            "Frontend publication must retain its registered contribution identities")
    heads = policy.get("original_integrated_revisions")
    require(isinstance(heads, list) and all(isinstance(head, str) for head in heads)
            and len(heads) == len(scope["heads"]) and set(heads) == scope["heads"],
            "Frontend publication must retain the original requested branch revisions")
    paths = policy.get("required_source_paths")
    require(isinstance(paths, list) and all(isinstance(path, str) for path in paths)
            and len(paths) == len(scope["source_paths"]) and set(paths) == scope["source_paths"],
            "Frontend qualification must pin every scoped source path")
    workflows = policy.get("required_workflows")
    require(isinstance(workflows, dict) and isinstance(workflows.get(CODEQL_WORKFLOW), list)
            and all(isinstance(job, str) for job in workflows[CODEQL_WORKFLOW])
            and len(workflows[CODEQL_WORKFLOW]) == len(CODEQL_JOBS)
            and set(workflows[CODEQL_WORKFLOW]) == CODEQL_JOBS,
            "Frontend publication requires all four managed CodeQL analyses")
    hosted_workflows = scope.get("hosted_workflows", {})
    require(set(workflows) == {CODEQL_WORKFLOW, *hosted_workflows}
            and all(workflows[workflow_id] == [job]
                    for workflow_id, (_, job) in hosted_workflows.items()),
            "Frontend publication requires the exact scoped hosted qualification jobs")
    return scope


def validate_proposal(plan, archive, policy):
    scope = validate_policy(policy)
    require(isinstance(plan, dict) and type(plan.get("schema_version")) is int
            and plan["schema_version"] == 1 and plan.get("release_track") == "frontend"
            and plan.get("version") == scope["version"],
            "Frontend plan must select the authorized scoped frontend version")
    allowed = {"schema_version", "release_track", "version", "qualification",
               "required_integrated_revisions", "revision", "commit_issues", "delivery_scope"}
    require(set(plan).issubset(allowed), "Frontend plan cannot declare issue acceptance or milestone scope")
    require({key: value for key, value in plan.items() if key != "revision"} == archive,
            "Frontend plan must equal its committed per-version plan")
    reference = plan.get("qualification")
    require(isinstance(reference, dict) and set(reference) == {"path", "sha256"}
            and reference.get("path") == scope["qualification_path"]
            and isinstance(reference.get("sha256"), str) and DIGEST.fullmatch(reference["sha256"]),
            "Frontend plan must pin a completed qualification record")
    heads = plan.get("required_integrated_revisions")
    require(isinstance(heads, list) and len(heads) >= len(scope["heads"])
            and all(isinstance(head, str) and SHA.fullmatch(head) and head != "0" * 40 for head in heads)
            and len(set(heads)) == len(heads) and scope["heads"].issubset(heads),
            "Frontend plan must retain the original requested revisions and unique additional branch pins")


def validate_qualification(record, revision, policy, read_blob, is_ancestor):
    scope = validate_policy(policy)
    require(isinstance(record, dict) and type(record.get("schema_version")) is int
            and record["schema_version"] == 1
            and record.get("qualification_type") == "frontend_source_and_isolated_runtime"
            and record.get("result") == "qualified" and record.get("version") == scope["version"]
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
    require(passed_checks(checks) and len(checks) == len(scope["checks"])
            and {check["name"] for check in checks} == scope["checks"],
            "Frontend qualification must retain every scoped runtime and source check")
    pins = record.get("source_pins")
    require(isinstance(pins, list) and bool(pins), "Frontend qualification needs source blob pins")
    seen = set()
    for pin in pins:
        require(isinstance(pin, dict) and set(pin) == {"path", "sha256"}
                and isinstance(pin.get("sha256"), str) and DIGEST.fullmatch(pin["sha256"]),
                "Frontend source pin is malformed")
        path = repository_path(pin.get("path"))
        require(path not in seen and path != scope["qualification_path"],
                "Frontend pins must be unique and cannot pin the qualification record itself")
        seen.add(path)
        for cut in {reviewed, revision}:
            require(hashlib.sha256(read_blob(cut, path)).hexdigest() == pin["sha256"],
                    f"Frontend qualified source blob changed at {cut}: {path}")
    require(scope["source_paths"].issubset(seen), "Frontend qualification omits a required source path")
    matches = FOOTER.findall(read_blob(revision, FOOTER_PATH))
    require(matches == [scope["version"].encode("ascii")],
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
    scope = frontend_scope(policy["version"])
    archive = load_candidate_json(revision, f"{PLAN_DIRECTORY}/{scope['version']}.json")
    validate_proposal(plan, archive, policy)
    for head in plan["required_integrated_revisions"]:
        run("git", "merge-base", "--is-ancestor", head, revision)
    raw = run("git", "show", f"{revision}:{scope['qualification_path']}", binary=True)
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
    for canonical, number in scope["contributions"].items():
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
    for workflow_id, (filename, _) in scope.get("hosted_workflows", {}).items():
        workflow = api.request(f"repos/{repository}/actions/workflows/{workflow_id}")
        require(isinstance(workflow, dict) and str(workflow.get("id")) == workflow_id
                and workflow.get("path") == f".github/workflows/{filename}"
                and workflow.get("state") == "active",
                f"Frontend hosted qualification workflow identity differs: {filename}")
    ci = verify_ci(api, repository, revision, {"required_workflows": required},
                   dynamic_codeql_workflow=CODEQL_WORKFLOW)
    tags, releases = api.pages(f"repos/{repository}/tags"), api.pages(f"repos/{repository}/releases")
    tag_name = "v" + scope["version"]
    names = [row["name"] for row in tags if row["name"] != tag_name]
    names += [row["tag_name"] for row in releases if row["tag_name"] != tag_name]
    product_version = load_candidate_json(revision, PACKAGE_PATH)["version"]
    # Stable publication uses the same canonical SemVer contract as the package.
    # Historical four-part display counters remain outside that version grammar.
    validate_release_version(product_version, scope["version"], names)
    existing_tag = next((row for row in tags if row["name"] == tag_name), None)
    require(existing_tag is None or existing_tag["commit"]["sha"] == revision,
            "Existing frontend tag points to another revision")
    existing = next((row for row in releases if row["tag_name"] == tag_name), None)
    require(existing is None or existing.get("draft") is True or allow_published,
            "Frontend version is already published")
    base = release_baseline(releases, tags, tag_name, core_policy["traceability_baseline"])
    commits = commit_references(api, repository, revision, base, plan)
    # Broad canonical scopes stay unaccepted. The qualified source contribution is
    # recorded separately; the whole source archive does not complete those scopes.
    ledger, context = classify_history(api, repository, commits, set(), items, revision,
                                       CONTEXT_BASELINE, allow_fresh_context=True)
    run("git", "merge-base", "--is-ancestor", PR_BASELINE, revision)
    recent = set(run("git", "rev-list", f"{PR_BASELINE}..{revision}").splitlines())
    require(all(row.get("pull_requests") for row in ledger if row["sha"] in recent),
            "Frontend source publication requires merged PR evidence for new commits")
    require_selected_main(api, repository, revision)
    return {
        "schema_version": 1, "snapshot_stage": "pre-publication", "release_track": "frontend",
        "mode": policy["mode"], "repository": repository, "version": scope["version"],
        "product_version": product_version, "revision": revision, "base_revision": base,
        "contributions": contributions, "issues": [], "commits": ledger, "ci": ci,
        "unreleased_context": context, "required_integrated_revisions": plan["required_integrated_revisions"],
        "qualification": {**plan["qualification"], "record": record}, "close_milestone": False,
        "stages": {"source": True, "integrated": True, "source_qualified": True,
                   "acceptance_claimed": False, "user_journey_accepted": False, "released": False,
                   "deployed": False, "provider_installation_accepted": False},
    }
