"""Keep full image qualification for ambiguous or non-presentation pushes."""
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from component_inputs import InputError
from web_push_scope import independent_web_push
from web_release_inputs import STYLE_FILE


class PushScopeTests(TestCase):
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
