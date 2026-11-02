"""Full-scope delivery acceptance, canonical dependencies, and exact-revision CI gates."""
import json
import urllib.parse
from release_support import ROOT, IDENTITY, ATTESTATION, GateError, load_json, scope_hash, load_candidate_json

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

def verify_ci(api, repo, revision, policy):
    evidence = []
    for filename, expected_jobs in policy["required_workflows"].items():
        runs = api.pages(f"repos/{repo}/actions/workflows/{filename}/runs?head_sha={revision}", "workflow_runs")
        eligible = sorted((r for r in runs if r.get("head_sha") == revision and r.get("event") in ("push", "workflow_dispatch") and r.get("head_branch") == "main"), key=lambda r: (r.get("run_number", 0), r.get("run_attempt", 1)), reverse=True)
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

def https_evidence(value):
    url = urllib.parse.urlsplit(value)
    return url.scheme == "https" and bool(url.netloc) and not url.username and not url.password

def acceptance(api, repo, issue, item, revision):
    """Only a human with current repository write authority can attest acceptance."""
    comments = api.pages(f"repos/{repo}/issues/{issue['number']}/comments")
    expected_hash = scope_hash(item)
    for comment in reversed(comments):
        for raw in ATTESTATION.findall(comment.get("body", "")):
            try:
                att = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(att, dict) or att.get("schema_version") != 1 or att.get("verdict") != "accepted" or att.get("revision") != revision or att.get("canonical_id") != item["id"] or att.get("acceptance_sha256") != expected_hash:
                continue
            user = comment.get("user", {})
            if user.get("type") != "User" or not user.get("login"):
                continue
            permission = api.request(f"repos/{repo}/collaborators/{user['login']}/permission")
            if permission.get("permission") not in ("write", "maintain", "admin"):
                continue
            checks = att.get("checks", [])
            if not checks or not all(isinstance(c, dict) and c.get("name") and c.get("result") == "passed" and https_evidence(c.get("url", "")) for c in checks):
                continue
            if not att.get("user_journey") or not att.get("limitations"):
                continue
            return {"comment": comment["html_url"], "reviewer": user["login"], "revision": revision, "acceptance_sha256": expected_hash, "checks": checks, "user_journey": att["user_journey"], "limitations": att["limitations"]}
    raise GateError(f"Issue #{issue['number']} lacks full-scope maintainer acceptance at {revision} (scope SHA256 {expected_hash})")

def verify_issue(api, repo, number, revision, items, require_closed=True, allow_parent=False, memo=None, trail=()):
    memo = {} if memo is None else memo
    if number in trail:
        raise GateError("Native sub-issue hierarchy contains a cycle")
    if number in memo:
        return memo[number]
    issue = api.request(f"repos/{repo}/issues/{number}")
    if issue.get("pull_request"):
        raise GateError(f"#{number} is a PR; reference its canonical delivery issue")
    if require_closed and (issue.get("state") != "closed" or issue.get("state_reason") != "completed"):
        raise GateError(f"Issue #{number} must be completed through the delivery acceptance gate")
    item = item_for_issue(issue, items, allow_parent=allow_parent)
    children = api.pages(f"repos/{repo}/issues/{number}/sub_issues")
    if children and not allow_parent:
        raise GateError(f"Issue #{number} has child deliverables; release the accepted leaves individually")
    if any(c.get("state") != "closed" or c.get("state_reason") != "completed" for c in children):
        raise GateError(f"Issue #{number} still has unfinished child scope")
    if allow_parent:
        expected_children = {i["id"] for i in items.values() if i.get("parent") == item["id"]}
        actual_children = {item_for_issue(c, items, allow_parent=True)["id"] for c in children}
        if expected_children != actual_children:
            raise GateError(f"Issue #{number} native children do not cover its canonical full scope")
        for child in children:
            verify_issue(api, repo, child["number"], revision, items, allow_parent=True, memo=memo, trail=trail + (number,))
    blockers = api.pages(f"repos/{repo}/issues/{number}/dependencies/blocked_by")
    if any(b.get("state") != "closed" or b.get("state_reason") != "completed" for b in blockers):
        raise GateError(f"Issue #{number} has an unfinished blocking dependency")
    actual_dependencies = {item_for_issue(b, items, allow_parent=True)["id"] for b in blockers}
    if not set(item.get("dependencies", [])).issubset(actual_dependencies):
        raise GateError(f"Issue #{number} is missing a canonical blocking dependency on GitHub")
    for blocker in blockers:
        verify_issue(api, repo, blocker["number"], revision, items, allow_parent=True, memo=memo, trail=trail + (number,))
    proof = acceptance(api, repo, issue, item, revision)
    memo[number] = {"number": number, "id": item["id"], "title": issue["title"], "url": issue["html_url"], "acceptance": proof}
    return memo[number]

