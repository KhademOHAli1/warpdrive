"""Keep full image qualification for ambiguous or non-presentation pushes."""
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from component_inputs import InputError
from web_push_scope import FUNCTIONAL_PROFILE, FUNCTIONAL_WORKFLOW, functional_web_push, independent_web_push
from web_release_inputs import STYLE_FILE


class PushScopeTests(TestCase):
    def test_functional_profile_keeps_backend_source_and_reviewed_adapters_fixed(self):
        module = "src/components/shell/FeatureView.tsx"
        adapter = "src/components/shell/FeatureAdapter.tsx"
        record = ("100644", "blob", "1" * 40)
        old = dict.fromkeys((FUNCTIONAL_PROFILE, FUNCTIONAL_WORKFLOW, module, adapter, "src/server/protected.ts"), record)
        changed = ("100644", "blob", "2" * 40)
        candidate = {**old, module: changed}
        profile = b'{"version":1,"modules":["src/components/shell/FeatureView.tsx"],"styles":[],"adapters":["src/components/shell/FeatureAdapter.tsx"]}'
        with patch("web_push_scope._blob", return_value=("100644", profile)):
            self.assertTrue(functional_web_push(Path("/source"), old, candidate))
            for protected in (FUNCTIONAL_PROFILE, FUNCTIONAL_WORKFLOW, adapter, "src/server/protected.ts"):
                with self.subTest(protected=protected):
                    self.assertFalse(functional_web_push(Path("/source"), old, {**candidate, protected: changed}))
            self.assertFalse(functional_web_push(Path("/source"), old, {**candidate, module: ("100755", "blob", "2" * 40)}))

    def test_known_presentation_only(self):
        with patch("web_push_scope._tree", side_effect=[{"old": 1}, {"new": 2}]), \
                patch("web_push_scope._git"), \
                patch("web_push_scope._blob", side_effect=[("100644", b"  gap: 24px;\n"), ("100644", b"  gap: 22px;\n")]), \
                patch("web_push_scope._presentation_delta", return_value=([STYLE_FILE], [])) as delta:
            self.assertTrue(independent_web_push(Path("/source"), "a" * 40, "b" * 40))
        delta.assert_called_once_with(Path("/source"), {"old": 1}, {"new": 2})

    def test_release_tool_change_keeps_full_qualification(self):
        with patch("web_push_scope._tree", return_value={}), \
                patch("web_push_scope._git"), \
                patch("web_push_scope._presentation_delta", return_value=(["layout.css"], ["release-tool"])):
            self.assertFalse(independent_web_push(Path("/source"), "a" * 40, "b" * 40))

    def test_missing_history_or_rejected_scope_keeps_full_qualification(self):
        with patch("web_push_scope._tree", side_effect=InputError("missing Git object")):
            self.assertFalse(independent_web_push(Path("/source"), "a" * 40, "b" * 40))
        with patch("web_push_scope._tree", return_value={}), \
                patch("web_push_scope._git"), \
                patch("web_push_scope._presentation_delta", side_effect=ValueError("shared input changed")):
            self.assertFalse(independent_web_push(Path("/source"), "a" * 40, "b" * 40))

    def test_other_reviewed_presentation_keeps_full_until_native_fixture_covers_it(self):
        with patch("web_push_scope._tree", return_value={}), patch("web_push_scope._git"), \
                patch("web_push_scope._presentation_delta", return_value=(["table-copy.json"], [])):
            self.assertFalse(independent_web_push(Path("/source"), "a" * 40, "b" * 40))

    def test_repeat_profile_requires_existing_unchanged_qualification_and_baseline(self):
        workflow = ".github/workflows/web-repeat-qualification.yml"
        custody = "scripts/deployment/first-web-publication.receipt"
        active = {workflow: ("100644", "blob", "1" * 40), custody: ("100644", "blob", "2" * 40)}
        for before, after, expected in ((active, active, True), ({}, active, False), (active, {}, False)):
            with self.subTest(expected=expected), patch("web_push_scope._tree", side_effect=[before, after]), \
                    patch("web_push_scope._git"), \
                    patch("web_push_scope._blob", side_effect=[("100644", b"  gap: 22px;\n"), ("100644", b"  gap: 20px;\n")]), \
                    patch("web_push_scope._presentation_delta", return_value=([STYLE_FILE], [])):
                self.assertIs(independent_web_push(Path("/source"), "a" * 40, "b" * 40), expected)
