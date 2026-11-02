"""Idempotent publication receipts after independently verifying the actual GitHub release."""
from release_support import GateError

def record_publication(api, evidence, release_id):
    repo, version, revision = evidence["repository"], evidence["version"], evidence["revision"]
    tag = "v" + version
    published = api.request(f"repos/{repo}/releases/{release_id}")
    ref = api.request(f"repos/{repo}/git/ref/tags/{tag}")
    if published.get("draft") is not False or published.get("prerelease") is not False or published.get("tag_name") != tag or ref["object"].get("type") != "commit" or ref["object"].get("sha") != revision:
        raise GateError("Publication receipts require an independently verified stable published release and exact commit tag")
    milestone = evidence["milestone"]["number"]
    current = [i for i in api.pages(f"repos/{repo}/issues?milestone={milestone}&state=all") if not i.get("pull_request")]
    if {i["number"] for i in current} != {i["number"] for i in evidence["issues"]} or any(i.get("state") != "closed" or i.get("state_reason") != "completed" for i in current):
        raise GateError("Published release is verified, but milestone scope changed or is unfinished; no milestone closure")
    label = "release:published"
    if label not in {x["name"] for x in api.pages(f"repos/{repo}/labels")}:
        api.request(f"repos/{repo}/labels", "POST", {"name": label, "color": "0e8a16", "description": "Included in a verified published release; deployment remains separate"})
        if label not in {x["name"] for x in api.pages(f"repos/{repo}/labels")}:
            raise GateError("Published label creation could not be verified")
    body = f"<!-- warpdrive:release:{tag} -->\nPublished in [Warpdrive {version}]({published['html_url']}) at `{revision}`. This receipt records publication only. Acceptance remains in the original review evidence. Deployment and real provider/installation acceptance remain separate."
    for item in evidence["issues"]:
        number = item["number"]
        issue = api.request(f"repos/{repo}/issues/{number}")
        if label not in {x["name"] for x in issue.get("labels", [])}:
            api.request(f"repos/{repo}/issues/{number}/labels", "POST", {"labels": [label]})
            if label not in {x["name"] for x in api.request(f"repos/{repo}/issues/{number}").get("labels", [])}:
                raise GateError("Publication issue label could not be verified")
        if not any(c.get("body") == body for c in api.pages(f"repos/{repo}/issues/{number}/comments")):
            api.request(f"repos/{repo}/issues/{number}/comments", "POST", {"body": body})
            if not any(c.get("body") == body for c in api.pages(f"repos/{repo}/issues/{number}/comments")):
                raise GateError("Publication receipt comment could not be verified")
    if api.request(f"repos/{repo}/milestones/{milestone}").get("state") != "closed":
        api.request(f"repos/{repo}/milestones/{milestone}", "PATCH", {"state": "closed"})
    if api.request(f"repos/{repo}/milestones/{milestone}").get("state") != "closed":
        raise GateError("Published milestone closure could not be verified")
    return published["html_url"]
