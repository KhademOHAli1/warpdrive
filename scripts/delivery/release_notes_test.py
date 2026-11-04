import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import release
import release_artifacts as artifacts
from release_publication_test import EVIDENCE, ReleaseAPI
from release_support import GateError


def evidence():
    return {
        "repository": "o/r", "version": "1.5.1", "revision": "a" * 40,
        "release_track": "mail", "mail_mode": "incremental", "primary_issue": 7,
        "canonical_id": "integration/MAIL-001",
        "milestone": {"number": 2, "title": "MAIL task", "url": "https://github.com/o/r/milestone/2"},
        "issues": [{"number": 7, "id": "integration/MAIL-001", "title": "Inventory",
                    "url": "https://github.com/o/r/issues/7",
                    "acceptance": {"comment": "https://github.com/o/r/issues/7#issuecomment-1"}}],
        "commits": [], "ci": [], "unreleased_context": [],
    }


class PublicationNotesTests(unittest.TestCase):
    def test_normal_notes_are_unchanged(self):
        selected = evidence()
        self.assertEqual(artifacts.publication_notes(selected), artifacts.notes(selected))

    def test_utf8_byte_limit_includes_exact_boundary(self):
        selected = evidence()
        for text in ("a" * 120000, "é" * 60000):
            with self.subTest(bytes=len(text.encode("utf-8"))), patch.object(artifacts, "notes", return_value=text):
                self.assertEqual(artifacts.publication_notes(selected), text)
        text = "é" * 60001
        self.assertLess(len(text), 120000)
        with patch.object(artifacts, "notes", return_value=text):
            summary = artifacts.publication_notes(selected)
        self.assertLessEqual(len(summary.encode("utf-8")), 120000)
        self.assertNotEqual(summary, text)

    def test_oversized_summary_preserves_selected_scope_and_source_disclosure(self):
        selected = evidence()
        selected["issues"].append(dict(selected["issues"][0], number=8, id="ops/support", url="https://github.com/o/r/issues/8"))
        selected["unreleased_context"] = [{"number": 999, "source_context_origins": ["newly_integrated"]}]
        with patch.object(artifacts, "notes", return_value="x" * 120001):
            summary = artifacts.publication_notes(selected)
        self.assertIn("primary issue #7", summary)
        self.assertIn("integration/MAIL-001", summary)
        self.assertIn("ops/support", summary)
        self.assertIn("https://github.com/o/r/issues/8", summary)
        self.assertIn(selected["revision"], summary)
        self.assertIn("physically includes", summary)
        self.assertIn("newly integrated", summary)
        self.assertIn("not accepted", summary)
        self.assertIn("does not accept the full MAIL programme", summary)
        for name in ("release-notes.md", "traceability.json"):
            self.assertIn("https://github.com/o/r/releases/download/v1.5.1/" + name, summary)
        self.assertLessEqual(len(summary.encode("utf-8")), 120000)

    def test_programme_and_core_summaries_do_not_deny_their_accepted_scope(self):
        for track, mode in (("mail", "programme"), ("core", None)):
            with self.subTest(track=track):
                selected = evidence()
                selected.update(release_track=track, mail_mode=mode)
                with patch.object(artifacts, "notes", return_value="x" * 120001):
                    summary = artifacts.publication_notes(selected)
                self.assertNotIn("does not accept the full MAIL programme", summary)

    def test_incremental_summary_preserves_selected_human_journey_support(self):
        for journey_stage in (False, True):
            with self.subTest(journey_stage=journey_stage):
                selected = evidence()
                selected["stages"] = {"user_journey_accepted": journey_stage}
                selected["issues"].append({
                    "number": 83, "id": "ops/journey-calendar-reminders",
                    "url": "https://github.com/o/r/issues/83",
                    "acceptance": {"mode": "human", "comment": "https://github.com/o/r/issues/83#issuecomment-1"},
                })
                with patch.object(artifacts, "notes", return_value="x" * 120001):
                    summary = artifacts.publication_notes(selected)
                self.assertIn("ops/journey-calendar-reminders", summary)
                self.assertIn("does not accept the full MAIL programme.", summary)
                self.assertIn("Technical acceptance alone is not human user-journey acceptance.", summary)
                self.assertNotIn("or a human user journey", summary)

    def test_summary_cannot_silently_truncate_accepted_deliveries(self):
        selected = evidence()
        selected["issues"] = [dict(selected["issues"][0], number=n, id="canonical/" + "a" * 160)
                              for n in range(1, 1001)]
        with patch.object(artifacts, "notes", return_value="x" * 120001), self.assertRaisesRegex(GateError, "summary exceeds"):
            artifacts.publication_notes(selected)

    def test_full_notes_and_traceability_artifacts_remain_untruncated(self):
        selected = evidence()
        subject = "آ" * 70000
        selected["commits"] = [{"sha": "b" * 40, "subject": subject,
                                "url": "https://github.com/o/r/commit/" + "b" * 40,
                                "released_issues": [7], "unreleased_issues": [],
                                "unreleased_contributions": []}]
        full = artifacts.notes(selected)
        self.assertGreater(len(full.encode("utf-8")), 120000)
        with tempfile.TemporaryDirectory() as directory, patch.object(artifacts, "run", return_value=b"archive"):
            artifacts.artifacts(selected, directory)
            self.assertEqual((Path(directory) / "release-notes.md").read_text(), full)
            self.assertEqual(json.loads((Path(directory) / "traceability.json").read_text()), selected)
            summary = artifacts.publication_notes(selected)
            self.assertLessEqual(len(summary.encode("utf-8")), 120000)
            self.assertNotEqual(summary, full)


class PublicationBodyGuardTests(unittest.TestCase):
    def test_draft_body_uses_bounded_notes_without_changing_full_notes(self):
        api = ReleaseAPI()
        selected = evidence()
        selected.update(version="1.4.1", release_track="core")
        full = "large complete notes" * 7000
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "notes", return_value=full), patch.object(release, "run"), patch.object(release, "verify_uploaded_assets"):
            release.publish(api, {}, selected, directory, "draft")
        body = next(payload["body"] for _, method, payload in api.writes if method == "PATCH" and "body" in payload)
        self.assertLessEqual(len(body.encode("utf-8")), 120000)
        self.assertNotEqual(body, full)
        self.assertIn("releases/download/v1.4.1/release-notes.md", body)

    def test_body_failure_precedes_new_tag_and_existing_draft_writes(self):
        class FreshAPI(ReleaseAPI):
            def pages(self, path, key=None):
                if path.endswith(("/tags", "/releases")):
                    return []
                return super().pages(path, key)

        for api in (FreshAPI(), ReleaseAPI()):
            with self.subTest(existing_draft=type(api) is ReleaseAPI):
                with tempfile.TemporaryDirectory() as directory, patch.object(release, "publication_notes", create=True, side_effect=GateError("Publication summary exceeds limit")), patch.object(release, "notes", return_value="full"), patch.object(release, "verify_release_code_scanning", return_value={}), patch.object(release, "run"), patch.object(release, "verify_uploaded_assets"), self.assertRaisesRegex(GateError, "summary exceeds"):
                    release.publish(api, {}, EVIDENCE, directory, "draft")
                self.assertEqual(api.writes, [])

    def test_real_summary_overflow_leaves_new_tag_uncreated(self):
        class FreshAPI(ReleaseAPI):
            def pages(self, path, key=None):
                if path.endswith(("/tags", "/releases")):
                    return []
                return super().pages(path, key)

        selected = evidence()
        selected["issues"] = [dict(selected["issues"][0], number=n, id="canonical/" + "a" * 160)
                              for n in range(1, 1001)]
        api = FreshAPI()
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "notes", return_value="x" * 120001), patch.object(release, "verify_release_code_scanning", return_value={}), self.assertRaisesRegex(GateError, "summary exceeds"):
            release.publish(api, {}, selected, directory, "draft")
        self.assertEqual(api.writes, [])

    def test_published_receipt_repair_does_not_render_or_change_body(self):
        api = ReleaseAPI()
        api.release["draft"] = False
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "publication_notes", create=True, side_effect=AssertionError("Immutable body must not be rendered")) as render, patch.object(release, "notes", side_effect=AssertionError("Full body must not be rendered")), patch.object(release, "verify_uploaded_assets"), patch.object(release, "record_publication", return_value="verified"):
            self.assertEqual(release.publish(api, {}, EVIDENCE, directory, "publish"), "verified")
        render.assert_not_called()
        self.assertEqual(api.writes, [])


if __name__ == "__main__":
    unittest.main()
