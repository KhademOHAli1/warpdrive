"""GitHub API boundary; authentication remains in the existing gh login.

Relationship API references: https://docs.github.com/en/rest/issues/sub-issues
and https://docs.github.com/en/rest/issues/issue-dependencies.
"""

import json
import subprocess
import time

from tracking_model import TrackingError, initial_project_status

class Gh:
    def __init__(self, pause=0.8):
        self.pause = pause
        self.last_write = 0.0

    def request(self, method, path, body=None, paginate=False):
        if method != "GET":
            delay = self.pause - (time.monotonic() - self.last_write)
            if delay > 0:
                time.sleep(delay)
        args = ["gh", "api", path, "--method", method, "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10"]
        if paginate:
            args.extend(["--paginate", "--slurp"])
        data = None
        if body is not None:
            args.extend(["--input", "-"])
            data = json.dumps(body)
        try:
            proc = subprocess.run(args, input=data, capture_output=True, text=True, timeout=90)
        except subprocess.TimeoutExpired as exc:
            raise TrackingError(f"{method} {path} timed out; request outcome is unknown. No automatic retry was performed.") from exc
        if method != "GET":
            self.last_write = time.monotonic()
        if proc.returncode:
            # gh errors contain response text, never request authentication headers.
            raise TrackingError(f"{method} {path} failed: {proc.stderr.strip()[-1600:]}")
        result = json.loads(proc.stdout) if proc.stdout.strip() else None
        if paginate:
            return [row for page in result for row in page]
        if path == "graphql" and result.get("errors"):
            raise TrackingError(f"GraphQL request failed: {result['errors']}")
        return result

    def list(self, path):
        return self.request("GET", path + ("&" if "?" in path else "?") + "per_page=100", paginate=True)

    def graphql(self, query, variables=None):
        return self.request("POST", "graphql", {"query": query, "variables": variables or {}})["data"]


def project_items(gh, project_id):
    values, cursor = {}, None
    query = """query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{items(first:100,after:$cursor){nodes{id content{... on Issue{id number}} fieldValues(first:30){nodes{... on ProjectV2ItemFieldSingleSelectValue{name optionId field{... on ProjectV2SingleSelectField{id name}}}}}}pageInfo{hasNextPage endCursor}}}}}"""
    while True:
        data = gh.graphql(query, {"id": project_id, "cursor": cursor})
        node = data.get("node")
        if not node:
            raise TrackingError("Project cannot be read. Authorize read/write project access or omit --project-config; issue import remains independent.")
        page = node["items"]
        for item in page["nodes"]:
            if item.get("content"):
                values[item["content"]["id"]] = item
        if not page["pageInfo"]["hasNextPage"]:
            return values
        cursor = page["pageInfo"]["endCursor"]


def sync_project(gh, config, manifest, issues, apply, checkpoint):
    project_id = config["id"]
    existing = project_items(gh, project_id)
    additions = 0
    fields_initialized = 0
    verified = 0
    for item in manifest["items"]:
        issue = issues.get(item["id"])
        if not issue:
            continue
        node = existing.get(issue["node_id"])
        if not node:
            additions += 1
            if not apply:
                continue
            try:
                data = gh.graphql("mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}", {"project": project_id, "content": issue["node_id"]})
                node = data["addProjectV2ItemById"]["item"]
            except TrackingError:
                # Ambiguous write: reread before any retry; never duplicate blindly.
                node = project_items(gh, project_id).get(issue["node_id"])
                if not node:
                    raise
            checkpoint()
        if not apply:
            continue
        # A crash after add but before initialization leaves a real existing item.
        # Blank fields can resume safely; nonblank live choices always win.
        query = "query($id:ID!){node(id:$id){... on ProjectV2Item{id content{... on Issue{id}} project{id} fieldValues(first:30){nodes{... on ProjectV2ItemFieldSingleSelectValue{optionId field{... on ProjectV2SingleSelectField{id name}}}}}}}}"
        actual = gh.graphql(query, {"id": node["id"]}).get("node")
        if not actual or actual.get("content", {}).get("id") != issue["node_id"] or (actual.get("project") and actual["project"]["id"] != project_id):
            raise TrackingError(f"Project membership verification failed for {item['id']}")
        values = {value.get("field", {}).get("id"): value.get("optionId") for value in actual.get("fieldValues", {}).get("nodes", []) if value.get("field")}
        for name, value in (("Status", initial_project_status(item)), ("Priority", item.get("priority", "P2"))):
            field = config.get("fields", {}).get(name)
            if not field or values.get(field["id"]):
                continue
            option = field.get("options", {}).get(value)
            if not option:
                raise TrackingError(f"Project config lacks {name} option {value}")
            try:
                gh.graphql("mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}", {"project": project_id, "item": node["id"], "field": field["id"], "option": option})
            except TrackingError:
                after = gh.graphql(query, {"id": node["id"]}).get("node") or {}
                after_values = {entry.get("field", {}).get("id"): entry.get("optionId") for entry in after.get("fieldValues", {}).get("nodes", []) if entry.get("field")}
                if after_values.get(field["id"]) != option:
                    raise
            fields_initialized += 1
            checkpoint()
        after = gh.graphql(query, {"id": node["id"]}).get("node") or {}
        after_values = {entry.get("field", {}).get("id"): entry.get("optionId") for entry in after.get("fieldValues", {}).get("nodes", []) if entry.get("field")}
        for name in ("Status", "Priority"):
            field = config.get("fields", {}).get(name)
            if field and not after_values.get(field["id"]):
                raise TrackingError(f"Project field verification failed for {item['id']}: {name}")
        verified += 1
    return {"project_additions": additions, "project_items_before": len(existing), "project_fields_initialized": fields_initialized, "project_items_verified": verified}


