"""Exercise the binding of Git changes to client and protected graph proofs."""

from copy import deepcopy
import unittest

from candidate import CandidateError
from web_structural_source import EFFECT_FIELDS, PROTECTED_FIELDS, _join, _profile_coverage


RENDERER = "src/components/shell/KeyboardHelp.tsx"
STYLE = "src/components/shell/KeyboardHelp.module.css"
BASELINE = "a" * 40
CANDIDATE = "b" * 40
PROFILE = "c" * 64


def projection(fields, kind, **extra):
    return {**{key: "d" * 64 for key in fields if key.endswith("Sha256")},
            "schemaVersion": 1, "kind": kind, "baselineRevision": BASELINE,
            "currentRevision": CANDIDATE, "deploymentAuthorized": False, **extra}


class StructuralSourceTests(unittest.TestCase):
    def test_paths_must_be_in_each_affected_side_of_the_effect_profile(self):
        profile = {"beforeModules": [RENDERER], "afterModules": [RENDERER],
                   "beforeStyles": [], "afterStyles": [STYLE]}
        delta = {"operations": [{"role": "client", "path": RENDERER, "before": {}, "after": {}},
                                {"role": "style", "path": STYLE, "before": None, "after": {}}]}
        _profile_coverage(delta, profile)
        for changes in ({"beforeStyles": [STYLE]}, {"afterModules": []}, {"beforeModules": []}):
            with self.subTest(changes=changes), self.assertRaisesRegex(CandidateError, "reviewed client subtree"):
                _profile_coverage(delta, profile | changes)

    def test_holds_files_without_effective_context_or_content_admission(self):
        profile = {"beforeModules": [], "afterModules": [], "beforeStyles": [], "afterStyles": []}
        for role, path, reason in (
                ("test", "src/components/KeyboardHelp.test.tsx", "build context exclusion"),
                ("asset", "public/images/preview.webp", "Asset content and URL")):
            with self.subTest(role=role), self.assertRaisesRegex(CandidateError, reason):
                _profile_coverage({"operations": [{"role": role, "path": path}]}, profile)

    def test_graph_proofs_must_agree_on_revisions_cut_and_effect_profile(self):
        evidence = {
            "protectedSource": projection(PROTECTED_FIELDS, "warpdrive-web-protected-source-projection",
                                          protectedRoots=10, protectedFiles=20),
            "clientEffects": projection(EFFECT_FIELDS, "warpdrive-web-client-effect-projection",
                                        profileSha256=PROFILE, capabilityUses=0),
        }
        self.assertEqual(_join(evidence, BASELINE, CANDIDATE, PROFILE), evidence)
        for key, value in (("rendererCutsSha256", "e" * 64), ("profileSha256", "e" * 64),
                           ("currentRevision", BASELINE), ("deploymentAuthorized", True), ("capabilityUses", True)):
            tampered = deepcopy(evidence)
            tampered["clientEffects"][key] = value
            with self.subTest(key=key), self.assertRaises(CandidateError):
                _join(tampered, BASELINE, CANDIDATE, PROFILE)
