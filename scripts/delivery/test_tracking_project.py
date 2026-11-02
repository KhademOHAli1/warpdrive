import copy
import unittest

from tracking_api import sync_project
from tracking_model import TrackingError


class ProjectGh:
    def __init__(self, nodes=None):
        self.nodes = nodes or []
        self.writes = []
        self.drop_add = False
        self.drop_update = False

    def graphql(self, query, variables):
        if query.startswith("query"):
            if "cursor" in variables:
                return {"node": {"items": {"nodes": copy.deepcopy(self.nodes), "pageInfo": {"hasNextPage": False}}}}
            return {"node": copy.deepcopy(next((node for node in self.nodes if node["id"] == variables["id"]), None))}
        self.writes.append(copy.deepcopy(variables))
        if "addProjectV2ItemById" in query:
            node = {"id": "PVTI1", "content": {"id": variables["content"], "number": 1}, "fieldValues": {"nodes": []}}
            if not self.drop_add:
                self.nodes.append(node)
            return {"addProjectV2ItemById": {"item": {"id": node["id"]}}}
        if not self.drop_update:
            node = next(node for node in self.nodes if node["id"] == variables["item"])
            node["fieldValues"]["nodes"].append({"optionId": variables["option"], "field": {"id": variables["field"]}})
        return {"updateProjectV2ItemFieldValue": {"projectV2Item": {"id": variables["item"]}}}


class ProjectTests(unittest.TestCase):
    config = {"id": "PVT1", "fields": {"Status": {"id": "status", "options": {"Todo": "todo"}}, "Priority": {"id": "priority", "options": {"P2": "p2"}}}}
    manifest = {"items": [{"id": "A", "priority": "P2"}]}
    issues = {"A": {"node_id": "I1"}}

    def test_add_membership_and_fields_independently_verified(self):
        gh = ProjectGh()
        gh.drop_add = True
        with self.assertRaisesRegex(TrackingError, "membership verification"):
            sync_project(gh, self.config, self.manifest, self.issues, True, lambda: None)

    def test_missing_field_write_does_not_claim_success(self):
        gh = ProjectGh()
        gh.drop_update = True
        with self.assertRaisesRegex(TrackingError, "field verification"):
            sync_project(gh, self.config, self.manifest, self.issues, True, lambda: None)

    def test_resume_fills_blanks_preserves_live_nonblank_fields(self):
        node = {"id": "PVTI1", "content": {"id": "I1", "number": 1}, "fieldValues": {"nodes": [{"optionId": "in-progress", "field": {"id": "status"}}]}}
        gh = ProjectGh([node])
        sync_project(gh, self.config, self.manifest, self.issues, True, lambda: None)
        self.assertEqual([write["field"] for write in gh.writes], ["priority"])
        self.assertEqual(node["fieldValues"]["nodes"][0]["optionId"], "in-progress")
        writes = len(gh.writes)
        sync_project(gh, self.config, self.manifest, self.issues, True, lambda: None)
        self.assertEqual(len(gh.writes), writes)

    def test_dry_run_does_not_write_project(self):
        gh = ProjectGh()
        result = sync_project(gh, self.config, self.manifest, self.issues, False, lambda: None)
        self.assertEqual(result["project_additions"], 1)
        self.assertEqual(gh.writes, [])

    def test_initial_active_status_uses_in_progress_without_acceptance_inference(self):
        config = copy.deepcopy(self.config)
        config["fields"]["Status"]["options"]["In Progress"] = "in-progress"
        gh = ProjectGh()
        sync_project(gh, config, {"items": [{"id": "A", "observed_status": "active"}]}, self.issues, True, lambda: None)
        status = next(write["option"] for write in gh.writes if write.get("field") == "status")
        self.assertEqual(status, "in-progress")

    def test_explicit_waiting_external_initializes_blocked_only_when_field_blank(self):
        config = copy.deepcopy(self.config)
        config["fields"]["Status"]["options"]["Blocked"] = "blocked"
        gh = ProjectGh()
        sync_project(gh, config, {"items": [{"id": "A", "observed_status": "waiting-external"}]}, self.issues, True, lambda: None)
        status = next(write["option"] for write in gh.writes if write.get("field") == "status")
        self.assertEqual(status, "blocked")


if __name__ == "__main__":
    unittest.main()
