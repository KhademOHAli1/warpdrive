import unittest
import tempfile
from unittest.mock import patch
from release_support import GateError
import release

REVISION = "a" * 40
EVIDENCE = {"repository": "o/r", "version": "1.4.1", "revision": REVISION, "issues": [{"number": 7}], "milestone": {"number": 1}}

class PublicationAPI:
    def __init__(self):
        self.release = {"id": 9, "draft": False, "prerelease": False, "tag_name": "v1.4.1", "html_url": "https://github.com/o/r/releases/tag/v1.4.1"}
        self.comments, self.labels, self.repo_labels, self.writes = [], [], [], []
        self.milestone = {"number": 1, "state": "open"}
    def pages(self, path, key=None):
        if path.endswith("/labels"):
            return self.repo_labels
        if path.endswith("/comments"):
            return self.comments
        if "/issues?milestone=" in path:
            return [{"number": 7, "state": "closed", "state_reason": "completed"}]
        raise AssertionError(path)
    def request(self, path, method="GET", payload=None):
        if method != "GET":
            self.writes.append((path, method, payload))
        if path.endswith("/releases/9"):
            if payload:
                self.release.update(payload)
            return self.release
        if "/git/ref/tags/" in path:
            return {"object": {"type": "commit", "sha": REVISION}}
        if path.endswith("/labels") and "/issues/" not in path:
            self.repo_labels.append(payload)
            return payload
        if path.endswith("/issues/7/labels"):
            self.labels += [{"name": x} for x in payload["labels"]]
            return self.labels
        if path.endswith("/issues/7/comments"):
            self.comments.append({"body": payload["body"]})
            return self.comments[-1]
        if path.endswith("/issues/7"):
            return {"number": 7, "labels": self.labels}
        if path.endswith("/milestones/1"):
            if payload:
                self.milestone.update(payload)
            return self.milestone
        raise AssertionError((path, method))

class ReleaseAPI(PublicationAPI):
    def __init__(self):
        super().__init__()
        self.release.update(draft=True, assets=[])
        self.flip_prerelease_on_read = False
    def pages(self, path, key=None):
        if path.endswith("/tags"):
            return [{"name": "v1.4.1", "commit": {"sha": REVISION}}]
        if path.endswith("/releases"):
            return [self.release]
        return super().pages(path, key)
    def request(self, path, method="GET", payload=None):
        if path.endswith("/releases/9") and method == "GET" and self.flip_prerelease_on_read:
            self.release["prerelease"] = True
        return super().request(path, method, payload)

class ReleaseAPIForPublished(ReleaseAPI):
    def __init__(self, source):
        self.__dict__ = source.__dict__
        self.flip_prerelease_on_read = False

class PublicationTests(unittest.TestCase):
    def test_reused_prerelease_draft_is_rejected_before_any_release_or_tracking_write(self):
        for mode in ("draft", "publish"):
            with self.subTest(mode=mode):
                api = ReleaseAPI()
                api.release["prerelease"] = True
                with tempfile.TemporaryDirectory() as directory, patch.object(release, "notes", return_value="notes"), patch.object(release, "run"), patch.object(release, "verify_uploaded_assets"), patch.object(release, "trusted_release_policy", return_value={}), patch.object(release, "release_gate", return_value=EVIDENCE), self.assertRaisesRegex(GateError, "prerelease"):
                    release.publish(api, {}, EVIDENCE, directory, mode)
                self.assertEqual(api.writes, [])
    def test_published_prerelease_recovery_has_no_issue_or_milestone_writes(self):
        api = PublicationAPI()
        api.release["prerelease"] = True
        with self.assertRaisesRegex(GateError, "stable"):
            release.record_publication(api, EVIDENCE, 9)
        self.assertEqual(api.writes, [])
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "verify_uploaded_assets"), self.assertRaises(GateError):
            release.publish(ReleaseAPIForPublished(api), {}, EVIDENCE, directory, "publish")
        self.assertEqual(api.writes, [])
    def test_independent_draft_reread_blocks_prerelease_before_stable_publication(self):
        api = ReleaseAPI()
        api.flip_prerelease_on_read = True
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "notes", return_value="notes"), patch.object(release, "run"), patch.object(release, "verify_uploaded_assets"), patch.object(release, "trusted_release_policy", return_value={}), patch.object(release, "release_gate", return_value=EVIDENCE), self.assertRaisesRegex(GateError, "prerelease"):
            release.publish(api, {}, EVIDENCE, directory, "publish")
        self.assertFalse(any(payload.get("draft") is False for _, _, payload in api.writes))
        self.assertFalse(any("/issues/" in path or "/milestones/" in path for path, _, _ in api.writes))

    def test_post_publish_receipts_are_verified_idempotent_and_do_not_accept_or_deploy(self):
        api = PublicationAPI()
        release.record_publication(api, EVIDENCE, 9)
        release.record_publication(api, EVIDENCE, 9)
        self.assertEqual(len(api.comments), 1)
        self.assertEqual([x["name"] for x in api.labels], ["release:published"])
        self.assertEqual(api.milestone["state"], "closed")
        self.assertIn("Deployment", api.comments[0]["body"])
        self.assertFalse(any("accepted" in str(payload.get("labels", [])) for _, _, payload in api.writes))
        self.assertFalse(any(path.endswith("/issues/7") for path, _, _ in api.writes))
    def test_draft_has_no_publication_receipts_or_milestone_mutations(self):
        api = PublicationAPI()
        api.release["draft"] = True
        with self.assertRaises(GateError):
            release.record_publication(api, EVIDENCE, 9)
        self.assertEqual(api.writes, [])
    def test_new_unfinished_milestone_scope_is_not_closed(self):
        api = PublicationAPI()
        original = api.pages
        api.pages = lambda path, key=None: [{"number": 7, "state": "open"}] if "/issues?milestone=" in path else original(path, key)
        with self.assertRaises(GateError):
            release.record_publication(api, EVIDENCE, 9)
        self.assertEqual(api.milestone["state"], "open")

if __name__ == "__main__":
    unittest.main()
