import unittest
from unittest.mock import patch
from release_test import r, ITEM, ISSUE, REVISION, attestation

class AuditTests(unittest.TestCase):
    def test_untrusted_later_comment_cannot_invalidate_valid_completed_acceptance(self):
        spam_revision = "b" * 40
        class API:
            def __init__(self):
                self.writes = []
            def request(self, path, method="GET", payload=None):
                if method != "GET":
                    self.writes.append((method, path, payload))
                return ISSUE
            def pages(self, path, key=None):
                return [attestation(), attestation(revision=spam_revision)]
        api = API()
        def verify(*args, **kwargs):
            if args[3] != REVISION:
                raise r.GateError("Untrusted or unqualified comment")
        with patch.object(r, "manifest_items", return_value={ITEM["id"]: ITEM}), patch.object(r, "run", return_value=""), patch.object(r, "verify_ci", return_value=[]), patch.object(r, "verify_issue", side_effect=verify):
            result = r.audit_closed(api, 7, {"repository": "o/r"})
        self.assertIn("retains completed status", result)
        self.assertEqual(api.writes, [])

if __name__ == "__main__":
    unittest.main()
