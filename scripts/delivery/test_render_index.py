import unittest

from render_index import render_index
from tracking_model import TrackingError


class IndexTests(unittest.TestCase):
    def fixture(self):
        manifest = {"schema_version": 1, "repository": "KhademOHAli1/warpdrive", "sources": [{"id": "approved", "path": "docs/approved.md", "count": 1}], "items": [{"id": "P", "title": "Programme", "kind": "programme", "module": "sales", "source_tasks": []}, {"id": "A", "title": "Delivery", "kind": "deliverable", "module": "sales", "parent": "P", "source_tasks": [{"source": "approved", "id": "A", "path": "docs/approved.md"}]}]}
        mapping = {"repository": manifest["repository"], "issues": {"P": {"number": 7, "url": "https://github.com/KhademOHAli1/warpdrive/issues/7"}, "A": {"number": 8, "url": "https://github.com/KhademOHAli1/warpdrive/issues/8"}}}
        return manifest, mapping

    def test_index_uses_real_mapping_and_all_sources_views(self):
        manifest, mapping = self.fixture()
        text = render_index(manifest, mapping)
        self.assertIn("[Programme](https://github.com/KhademOHAli1/warpdrive/issues/7)", text)
        self.assertRegex(text, r"\| `approved` +\| +1 +\| +1 +\|")
        for view in range(1, 6):
            self.assertIn(f"projects/3/views/{view}", text)
        self.assertNotIn("%", text)
        self.assertIn("historical", text)

    def test_missing_mapping_fails_without_partial_flag(self):
        manifest, mapping = self.fixture()
        del mapping["issues"]["P"]
        with self.assertRaisesRegex(TrackingError, "Unmapped"):
            render_index(manifest, mapping)
        self.assertIn("Import pending", render_index(manifest, mapping, allow_partial=True))

    def test_mapping_cannot_link_wrong_repository(self):
        manifest, mapping = self.fixture()
        mapping["issues"]["P"]["url"] = "https://example.com/untrusted"
        with self.assertRaisesRegex(TrackingError, "issue URL"):
            render_index(manifest, mapping)

    def test_current_project_is_public_and_configured_metadata_can_change_visibility(self):
        manifest, mapping = self.fixture()
        self.assertIn("The Project is user-owned and public.", render_index(manifest, mapping))
        manifest["project"] = {"url": "https://github.com/users/KhademOHAli1/projects/3", "visibility": "private"}
        self.assertIn("The Project is user-owned and private.", render_index(manifest, mapping))

    def test_generated_programme_table_has_deterministic_formatter_padding(self):
        manifest, mapping = self.fixture()
        text = render_index(manifest, mapping)
        rows = text.split("## Programmes\n\n", 1)[1].split("\n\n", 1)[0].splitlines()
        self.assertEqual(len({len(row) for row in rows}), 1)
        self.assertEqual(rows[0].index("Module"), rows[2].index("sales"))


if __name__ == "__main__":
    unittest.main()
