"""Full-scope delivery acceptance, canonical dependencies, and exact-revision CI gates."""
import hashlib
import json
from pathlib import PurePosixPath
import re
import urllib.parse
from release_support import ROOT, IDENTITY, ATTESTATION, SHA, GateError, canonical_json, load_json, scope_hash, load_candidate_json, run

def manifest_items(revision=None):
    manifest = load_candidate_json(revision, "docs/delivery/roadmap.json") if revision else load_json(ROOT / "docs/delivery/roadmap.json")
    return {item["id"]: item for item in manifest["items"]}

def item_for_issue(issue, items, allow_parent=False):
    markers = IDENTITY.findall(issue.get("body") or "")
    if len(markers) != 1 or markers[0] not in items:
        raise GateError(f"Issue #{issue['number']} has no unique registered canonical delivery identity")
    item = items[markers[0]]
    if not allow_parent and item["kind"] in ("programme", "program", "package", "work_package", "work-package"):
        raise GateError(f"Issue #{issue['number']} is a parent; select its bounded deliverables")
    if not item.get("acceptance"):
        raise GateError(f"Issue #{issue['number']} lacks canonical acceptance criteria")
    return item

def verify_ci(api, repo, revision, policy, dynamic_codeql_workflow=None):
    evidence = []
    for filename, expected_jobs in policy["required_workflows"].items():
        runs = api.pages(f"repos/{repo}/actions/workflows/{filename}/runs?head_sha={revision}", "workflow_runs")
        def permitted_event(candidate):
            if candidate.get("event") in ("push", "workflow_dispatch"):
                return True
            # GitHub-managed default CodeQL uses dynamic, not a repository workflow push.
            # The technical policy opts in one exact workflow ID; no other dynamic run qualifies.
            return (candidate.get("event") == "dynamic" and filename == dynamic_codeql_workflow
                    and str(candidate.get("workflow_id")) == filename
                    and candidate.get("path") == "dynamic/github-code-scanning/codeql")
        eligible = sorted((r for r in runs if r.get("head_sha") == revision and permitted_event(r) and r.get("head_branch") == "main"), key=lambda r: (r.get("run_number", 0), r.get("run_attempt", 1)), reverse=True)
        if not eligible or eligible[0].get("conclusion") != "success" or eligible[0].get("status") != "completed":
            raise GateError(f"Required workflow {filename} has no latest completed successful main run for {revision}")
        latest = eligible[0]
        jobs = api.pages(f"repos/{repo}/actions/runs/{latest['id']}/jobs?filter=latest", "jobs")
        for name in expected_jobs:
            matches = [j for j in jobs if j["name"] == name]
            if len(matches) != 1 or matches[0].get("conclusion") != "success":
                raise GateError(f"Required exact-revision job {name} did not pass")
        evidence.append({"workflow": filename, "run_id": latest["id"], "url": latest["html_url"], "attempt": latest.get("run_attempt", 1), "jobs": expected_jobs})
    return evidence

TECHNICAL_POLICY = "docs/delivery/technical-acceptance-policy.json"
RELEASE_POLICY = "docs/delivery/release-policy.json"
DIGEST = re.compile(r"^[0-9a-f]{64}$")
SESSION = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
PARENT_KINDS = {"programme", "program", "package", "work_package", "work-package"}
TECHNICAL_KINDS = {"task", "deliverable", "maintenance", "bug"}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def https_evidence(value):
    if not isinstance(value, str) or not value or value.strip() != value or any(ord(c) < 32 for c in value):
        return False
    try:
        url = urllib.parse.urlsplit(value)
        return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        return False


def passed_checks(checks):
    return isinstance(checks, list) and bool(checks) and all(
        isinstance(c, dict) and nonempty(c.get("name")) and c.get("result") == "passed" and https_evidence(c.get("url"))
        for c in checks
    )


def trusted_policy(revision, path, repo):
    """Candidate policy cannot introduce eligibility or roll back today's trusted policy."""
    trusted_revision = run("git", "rev-parse", "HEAD").strip()
    trusted = load_candidate_json(trusted_revision, path)
    candidate = load_candidate_json(revision, path)
    if not isinstance(candidate, dict) or canonical_json(candidate) != canonical_json(trusted) or candidate.get("repository") != repo:
        raise GateError(f"Candidate {path} differs from committed trusted main policy or repository")
    return candidate


def repository_path(value):
    if not nonempty(value) or any(ord(c) < 32 for c in value) or "\\" in value:
        raise GateError("Review evidence requires a canonical repository-relative file path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or path.as_posix() != value or value == ".":
        raise GateError("Review evidence requires a canonical repository-relative file path")
    return value


def agent_identity(value):
    # These are retained Codex provenance declarations, NOT GitHub-authenticated people.
    if not isinstance(value, dict) or set(value) != {"runtime", "session_id", "task_id"} or value.get("runtime") != "codex":
        raise GateError("Agent provenance must identify the actual Codex session and task")
    if not isinstance(value.get("session_id"), str) or not SESSION.fullmatch(value["session_id"]):
        raise GateError("Agent provenance requires a full Codex session ID")
    if not isinstance(value.get("task_id"), str) or not re.fullmatch(r"/root(?:/[a-z0-9_]+)*", value["task_id"]):
        raise GateError("Agent provenance requires its actual Codex task path")
    return value


def technical_review(att, item, revision, eligibility):
    reference = att.get("independent_review")
    if not isinstance(reference, dict) or set(reference) != {"path", "sha256"} or not isinstance(reference.get("sha256"), str) or not DIGEST.fullmatch(reference["sha256"]):
        raise GateError("Agent acceptance requires a pinned independent review artifact")
    path = repository_path(reference.get("path"))
    if not path.startswith("docs/delivery/technical-reviews/") or not path.endswith(".json"):
        raise GateError("Independent review must be a committed technical-review JSON record")
    raw = run("git", "show", f"{revision}:{path}", binary=True)
    if hashlib.sha256(raw).hexdigest() != reference["sha256"]:
        raise GateError("Independent review artifact digest does not match the candidate")
    try:
        review = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise GateError("Independent review artifact is not JSON") from error
    if not isinstance(review, dict) or type(review.get("schema_version")) is not int or review["schema_version"] != 1 or review.get("review_type") != "independent_source_review" or review.get("result") != "accepted" or review.get("canonical_id") != item["id"] or review.get("acceptance_sha256") != scope_hash(item):
        raise GateError("Independent review must accept this entire canonical scope")
    reviewer = agent_identity(review.get("reviewer_agent"))
    accepting = agent_identity(att.get("accepting_agent"))
    if reviewer == accepting:
        raise GateError("Accepting and independently reviewing agents must be distinct")
    if not nonempty(review.get("summary")) or not nonempty(review.get("limitations")):
        raise GateError("Independent review needs its actual scope summary and limitations")
    criteria = review.get("criteria")
    expected = {f"AC{n}" for n in range(1, len(item["acceptance"]) + 1)}
    if not isinstance(criteria, list) or len(criteria) != len(expected) or any(
        not isinstance(c, dict) or c.get("result") != "passed" or not isinstance(c.get("evidence"), list) or not c["evidence"] or not all(https_evidence(u) for u in c["evidence"])
        for c in criteria
    ) or {c.get("id") for c in criteria} != expected:
        raise GateError("Independent review must cover every acceptance clause exactly once")
    reviewed = review.get("reviewed_revision")
    if not isinstance(reviewed, str) or not SHA.fullmatch(reviewed):
        raise GateError("Independent review requires its full reviewed source revision")
    run("git", "merge-base", "--is-ancestor", reviewed, revision)
    pins = review.get("source_pins")
    if not isinstance(pins, list) or not pins:
        raise GateError("Independent review requires unchanged source pins")
    seen = set()
    for pin in pins:
        if not isinstance(pin, dict) or set(pin) != {"path", "sha256"} or not isinstance(pin.get("sha256"), str) or not DIGEST.fullmatch(pin["sha256"]):
            raise GateError("Independent source pins require paths and SHA256 digests")
        source = repository_path(pin.get("path"))
        if source in seen or source == path:
            raise GateError("Independent source pins cannot repeat or pin their own review")
        seen.add(source)
        for cut in dict.fromkeys((reviewed, revision)):
            blob = run("git", "show", f"{cut}:{source}", binary=True)
            if hashlib.sha256(blob).hexdigest() != pin["sha256"]:
                raise GateError(f"Reviewed source changed at {cut}: {source}")
    if not set(eligibility["required_source_paths"]).issubset(seen):
        raise GateError("Independent review omits a required scoped source path")
    return {"path": path, "sha256": reference["sha256"], "reviewer_agent": reviewer, "reviewed_revision": reviewed, "source_pins": pins, "criteria": criteria, "summary": review["summary"], "limitations": review["limitations"]}


def agent_acceptance(api, repo, issue, item, revision, comment, att):
    if not isinstance(revision, str) or not SHA.fullmatch(revision) or item.get("kind") not in TECHNICAL_KINDS:
        raise GateError("Agent completion is restricted to bounded technical leaf items")
    policy = trusted_policy(revision, TECHNICAL_POLICY, repo)
    release_policy = trusted_policy(revision, RELEASE_POLICY, repo)
    if type(policy.get("schema_version")) is not int or policy["schema_version"] != 1 or policy.get("mode") != "delegated_agent_technical_only":
        raise GateError("Unsupported technical acceptance policy")
    if item["id"] in release_policy.get("initial_journey_ids", {}).values() or item["id"] in policy.get("human_only_ids", []):
        raise GateError("This scope retains human acceptance")
    allowed = policy.get("items")
    eligibility = allowed.get(item["id"]) if isinstance(allowed, dict) else None
    if not isinstance(eligibility, dict) or eligibility.get("classification") != "bounded_technical" or eligibility.get("acceptance_sha256") != scope_hash(item) or not nonempty(eligibility.get("rationale")):
        raise GateError("This exact canonical technical scope has no committed agent opt-in")
    required = eligibility.get("required_source_paths")
    if not isinstance(required, list) or not required or any(not isinstance(p, str) for p in required) or len(set(required)) != len(required):
        raise GateError("Technical eligibility must declare its required reviewed source paths")
    for path in required:
        repository_path(path)
    user, actor = comment.get("user", {}), att.get("transport_actor")
    if not isinstance(user, dict) or user.get("type") != "User" or type(user.get("id")) is not int or not nonempty(user.get("login")):
        raise GateError("Agent transport must have a real authenticated GitHub User ID")
    actual = {"id": user["id"], "login": user["login"]}
    delegates = policy.get("delegated_actors")
    if not isinstance(actor, dict) or set(actor) != {"id", "login"} or type(actor.get("id")) is not int or not isinstance(delegates, list) or any(not isinstance(d, dict) or set(d) != {"id", "login"} or type(d.get("id")) is not int or not nonempty(d.get("login")) for d in delegates) or actor != actual or actual not in delegates:
        raise GateError("Agent transport does not match an explicitly delegated GitHub principal")
    permission = api.request(f"repos/{repo}/collaborators/{user['login']}/permission")
    if permission.get("permission") not in ("write", "maintain", "admin"):
        raise GateError("Delegated agent transport no longer has repository write authority")
    if not nonempty(att.get("scope_summary")) or not nonempty(att.get("limitations")):
        raise GateError("Agent acceptance needs a bounded scope summary and actual limitations")
    review = technical_review(att, item, revision, eligibility)
    additional = policy.get("required_workflows")
    if not isinstance(additional, dict) or not additional or any(not nonempty(name) or not isinstance(jobs, list) or not jobs or any(not nonempty(j) for j in jobs) or len(set(jobs)) != len(jobs) for name, jobs in additional.items()):
        raise GateError("Technical acceptance requires its additional exact-revision workflows")
    codeql = policy.get("codeql_workflow_id")
    if not isinstance(codeql, str) or not re.fullmatch(r"[1-9]\d*", codeql) or codeql not in additional:
        raise GateError("Technical acceptance must identify its exact managed CodeQL workflow")
    required_ci = dict(release_policy["required_workflows"])
    for name, jobs in additional.items():
        required_ci[name] = list(dict.fromkeys(required_ci.get(name, []) + jobs))
    ci = verify_ci(api, repo, revision, {"required_workflows": required_ci}, dynamic_codeql_workflow=codeql)
    return {"mode": "delegated_agent", "comment": comment["html_url"], "reviewer": user["login"], "transport_actor": actual, "accepting_agent": att["accepting_agent"], "revision": revision, "acceptance_sha256": scope_hash(item), "checks": att["checks"], "scope_summary": att["scope_summary"], "limitations": att["limitations"], "independent_review": review, "ci": ci, "provenance_limit": "GitHub authenticates the delegated posting principal only; Codex runtime identities and independent process review are retained declarations, not separately authenticated GitHub reviewers."}


def acceptance(api, repo, issue, item, revision, allow_agent=False):
    """Human default; explicit delegated provenance only in opted-in technical completion."""
    comments = api.pages(f"repos/{repo}/issues/{issue['number']}/comments")
    expected_hash = scope_hash(item)
    agent_failures = []
    for comment in reversed(comments):
        body = comment.get("body")
        if not isinstance(body, str):
            continue
        for raw in ATTESTATION.findall(body):
            try:
                att = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(att, dict) or type(att.get("schema_version")) is not int or att.get("verdict") != "accepted" or att.get("revision") != revision or att.get("canonical_id") != item["id"] or att.get("acceptance_sha256") != expected_hash or not passed_checks(att.get("checks")):
                continue
            if att["schema_version"] == 2 and att.get("acceptance_mode") == "delegated_agent":
                if allow_agent:
                    try:
                        return agent_acceptance(api, repo, issue, item, revision, comment, att)
                    except (GateError, ValueError, TypeError) as error:
                        agent_failures.append(str(error))
                continue
            # Explicit agent provenance can never fall back to the human schema.
            if att["schema_version"] != 1 or att.get("acceptance_mode") not in (None, "human") or "accepting_agent" in att or "transport_actor" in att or "independent_review" in att:
                continue
            user = comment.get("user", {})
            if user.get("type") != "User" or not user.get("login"):
                continue
            permission = api.request(f"repos/{repo}/collaborators/{user['login']}/permission")
            if permission.get("permission") not in ("write", "maintain", "admin") or not nonempty(att.get("user_journey")) or not nonempty(att.get("limitations")):
                continue
            return {"mode": "human", "comment": comment["html_url"], "reviewer": user["login"], "revision": revision, "acceptance_sha256": expected_hash, "checks": att["checks"], "user_journey": att["user_journey"], "limitations": att["limitations"]}
    detail = f"; agent proof rejected: {agent_failures[0]}" if agent_failures else ""
    raise GateError(f"Issue #{issue['number']} lacks full-scope permitted acceptance at {revision} (scope SHA256 {expected_hash}){detail}")

def verify_issue(api, repo, number, revision, items, require_closed=True, allow_parent=False, memo=None, trail=(), allow_agent=False):
    memo = {} if memo is None else memo
    if number in trail:
        raise GateError("Native sub-issue hierarchy contains a cycle")
    memo_key = (repo, number, revision, bool(allow_agent))
    if memo_key in memo:
        return memo[memo_key]
    issue = api.request(f"repos/{repo}/issues/{number}")
    if issue.get("pull_request"):
        raise GateError(f"#{number} is a PR; reference its canonical delivery issue")
    if require_closed and (issue.get("state") != "closed" or issue.get("state_reason") != "completed"):
        raise GateError(f"Issue #{number} must be completed through the delivery acceptance gate")
    item = item_for_issue(issue, items, allow_parent=allow_parent)
    children = api.pages(f"repos/{repo}/issues/{number}/sub_issues")
    if children and not allow_parent:
        raise GateError(f"Issue #{number} has child deliverables; release the accepted leaves individually")
    agent_context = allow_agent and not children and item.get("kind") in TECHNICAL_KINDS
    if any(c.get("state") != "closed" or c.get("state_reason") != "completed" for c in children):
        raise GateError(f"Issue #{number} still has unfinished child scope")
    if allow_parent:
        expected_children = {i["id"] for i in items.values() if i.get("parent") == item["id"]}
        actual_children = {item_for_issue(c, items, allow_parent=True)["id"] for c in children}
        if expected_children != actual_children:
            raise GateError(f"Issue #{number} native children do not cover its canonical full scope")
        for child in children:
            verify_issue(api, repo, child["number"], revision, items, allow_parent=True, memo=memo, trail=trail + (number,), allow_agent=agent_context)
    blockers = api.pages(f"repos/{repo}/issues/{number}/dependencies/blocked_by")
    if any(b.get("state") != "closed" or b.get("state_reason") != "completed" for b in blockers):
        raise GateError(f"Issue #{number} has an unfinished blocking dependency")
    actual_dependencies = {item_for_issue(b, items, allow_parent=True)["id"] for b in blockers}
    if not set(item.get("dependencies", [])).issubset(actual_dependencies):
        raise GateError(f"Issue #{number} is missing a canonical blocking dependency on GitHub")
    for blocker in blockers:
        verify_issue(api, repo, blocker["number"], revision, items, allow_parent=True, memo=memo, trail=trail + (number,), allow_agent=agent_context)
    proof = acceptance(api, repo, issue, item, revision, allow_agent=agent_context)
    memo[memo_key] = {"number": number, "id": item["id"], "title": issue["title"], "url": issue["html_url"], "acceptance": proof}
    return memo[memo_key]

