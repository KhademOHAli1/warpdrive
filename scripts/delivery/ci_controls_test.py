import unittest
from release_pr import validate
from security_audit import blocking
from release_gates import verify_ci
from release_support import GateError
from unittest.mock import patch
from release_test import r, REVISION


class ReleasePRTests(unittest.TestCase):
    def validate(self, **changes):
        data = dict(base_package={"version": "1.4.0"}, package={"version": "1.5.0"},
                    plan={"schema_version": 1, "version": "1.5.0", "issues": [7], "milestone": 1},
                    paths=["src/app/page.tsx", "package.json"], notes="Release scope, exercised checks and supported limitations. " * 3, registered={7})
        data.update(changes)
        return validate(**data)

    def test_customer_release(self):
        self.assertEqual(self.validate(), "customer-release")

    def test_infrastructure_does_not_claim_a_customer_version(self):
        self.assertEqual(self.validate(package={"version": "1.4.0"}, paths=[".github/workflows/ci.yml"]), "automation-maintenance")

    def test_product_changes_cannot_use_maintenance_exception(self):
        for path in ["src/app/page.tsx", "package.json", "bun.lock", "Dockerfile", "site/package.json"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.validate(package={"version": "1.4.0"}, paths=[path])

    def test_invalid_scope_version_and_notes_fail_closed(self):
        for change in [{"package": {"version": "1.5.0-rc.1"}}, {"notes": ""}, {"registered": set()},
                       {"plan": {"schema_version": 1, "version": "1.4.1", "issues": [7], "milestone": 1}},
                       {"plan": {"schema_version": 1, "version": "1.5.0", "issues": [7, 7], "milestone": 1}}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.validate(**change)


class SecurityAuditTests(unittest.TestCase):
    def test_thresholds_keep_all_findings_but_only_block_high_critical(self):
        self.assertEqual(blocking({"a": [{"id": 1, "severity": "moderate"}, {"id": 2, "severity": "high"}]}), {("a", 2, "high")})
        self.assertEqual(blocking({"a": [{"id": 3, "severity": "critical"}]}), {("a", 3, "critical")})
        self.assertEqual(blocking({}), set())

    def test_network_error_or_malformed_output_is_never_a_clean_audit(self):
        for report in [[], {"error": "unavailable"}, {"a": [{"id": 1, "severity": "unknown"}]}, {"a": [{"severity": "high"}]}]:
            with self.subTest(report=report), self.assertRaises(ValueError):
                blocking(report)


class ReleaseSecurityResultsTests(unittest.TestCase):
    def test_security_findings_block_even_when_analysis_succeeded(self):
        class API:
            def pages(self, path):
                return [{"rule": {"security_severity_level": "high"}}]
        with self.assertRaises(GateError):
            verify_ci(API(), "owner/repo", "a" * 40, {"required_workflows": {}, "require_security_results": True})

    def test_alternate_plan_cannot_reuse_a_maintenance_audit_as_release_proof(self):
        plan = {"revision": REVISION, "version": "1.4.0"}
        policy = {"repository": "owner/repo", "require_security_results": True}
        with patch.object(r, "require_revision"), patch.object(r, "load_candidate_json", return_value={"version": "1.5.0"}), self.assertRaisesRegex(GateError, "strict dependency CI"):
            r.release_gate(None, plan, policy)

    def test_clean_exact_revision_results_pass(self):
        class API:
            def pages(self, path):
                self.path = path
                return []
        api = API()
        verify_ci(api, "owner/repo", "a" * 40, {"required_workflows": {}, "require_security_results": True})
        self.assertIn("ref=" + "a" * 40, api.path)


if __name__ == "__main__":
    unittest.main()
