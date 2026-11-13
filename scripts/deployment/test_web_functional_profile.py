from copy import deepcopy
import json
from pathlib import Path
import unittest

from candidate import CandidateError
from component_inputs import canonical, content_hash
from web_functional_profile import (
    MAX_CAPABILITY_BINDINGS, MAX_PROFILE_BYTES, frozen_web_paths, mutable_web_paths, parse_web_functional_profile,
    validate_web_functional_profile, verify_web_functional_delta,
)


ROUTE_VIEW = "src/app/(app)/inbox/[threadId]/InboxView.tsx"
ROUTE_STYLE = "src/app/(app)/inbox/[threadId]/InboxView.module.css"
ROUTE_MOUNT = "src/app/(app)/inbox/[threadId]/page.tsx"
SHELL_VIEW = "src/components/shell/SidebarView.tsx"
SHELL_MOUNT = "src/components/shell/LeftNav.tsx"
CAPABILITY = "src/components/shell/SidebarCapabilities.ts"
LOCK = "bun.lock"


def fixture():
    return {"version": 2, "modules": [ROUTE_VIEW, SHELL_VIEW], "styles": [ROUTE_STYLE],
            "adapters": [ROUTE_MOUNT, SHELL_MOUNT], "capabilities": [
                {"path": CAPABILITY, "exports": [{"name": "SidebarControl", "kind": "component"},
                                                 {"name": "useSidebarReady", "kind": "hook"}],
                 "consumers": [SHELL_VIEW]}
            ]}


def row(number, mode="100644", kind="blob"):
    return mode, kind, f"{number:040x}"


class FunctionalProfileTests(unittest.TestCase):
    def test_existing_v1_profile_keeps_its_shape_and_canonical_digest(self):
        path = Path(__file__).with_name("web-functional-profile.json")
        source = path.read_bytes()
        value = json.loads(source)
        self.assertEqual(parse_web_functional_profile(source, expected_sha256=content_hash(value)), value)
        self.assertEqual(mutable_web_paths(value), set(value["modules"] + value["styles"]))
        self.assertEqual(frozen_web_paths(value), set(value["adapters"]))

    def test_v2_exact_route_leaf_shell_and_frozen_capability(self):
        profile = fixture()
        digest = content_hash(profile)
        self.assertEqual(parse_web_functional_profile(json.dumps(profile, indent=3).encode(), expected_sha256=digest), profile)
        self.assertEqual(mutable_web_paths(profile), {ROUTE_VIEW, ROUTE_STYLE, SHELL_VIEW})
        self.assertEqual(frozen_web_paths(profile), {CAPABILITY, ROUTE_MOUNT, SHELL_MOUNT})
        with self.assertRaisesRegex(CandidateError, "reviewed checksum"):
            parse_web_functional_profile(canonical(profile), expected_sha256="0" * 64)
        profile["capabilities"] = []
        self.assertEqual(validate_web_functional_profile(profile), profile)

    def test_route_tree_supports_parallel_intercepted_and_catchall_client_leaves(self):
        profile = fixture()
        for path in ("src/app/(app)/deals/@modal/(..)deals/[dealId]/DealView.tsx",
                     "src/app/(app)/docs/[[...slug]]/DocsView.tsx",
                     "src/app/(app)/docs/[...slug]/DocsView.tsx",
                     "src/app/(app)/docs/(..)(..)docs/DocsView.tsx"):
            with self.subTest(path=path):
                profile["modules"] = [path, SHELL_VIEW]
                self.assertEqual(validate_web_functional_profile(profile), profile)

    def test_rejects_mutable_server_routes_layouts_auth_and_unsafe_paths(self):
        for path in (ROUTE_MOUNT, "src/app/(app)/layout.tsx", "src/app/(app)/inbox/error.tsx",
                     "src/app/(app)/inbox/default.tsx", "src/app/(app)/inbox/manifest.ts",
                     "src/app/(app)/inbox/opengraph-image2.tsx", "src/app/(app)/inbox/twitter-image2.tsx",
                     "src/app/(app)/auth/LoginView.tsx", "src/app/(app)/(auth)/LoginView.tsx",
                     "src/app/(app)/(.)api/ApiView.tsx", "src/app/api/route.ts",
                     "src/components/shell/actions/Callback.ts", "src/features/deals/actions.ts",
                     "src/features/deals/ui/server/Hidden.ts", "src/features/deals/ui/View.server.tsx",
                     "src/components/shell/View.test.tsx", "src/Components/shell/View.tsx",
                     "src/components/../db/View.ts", "src/components/shell//View.tsx",
                     "src/app/(app)/[...broken/View.tsx", "src/components/é/View.tsx"):
            profile = fixture()
            profile["modules"] = sorted([path, SHELL_VIEW])
            with self.subTest(path=path), self.assertRaises(CandidateError):
                validate_web_functional_profile(profile)
        profile = fixture()
        profile["adapters"] = ["src/app/(app)/inbox/route.ts", SHELL_MOUNT]
        with self.assertRaisesRegex(CandidateError, "adapters path"):
            validate_web_functional_profile(profile)
        profile = fixture()
        profile["capabilities"][0]["path"] = ROUTE_VIEW
        with self.assertRaisesRegex(CandidateError, "capability path"):
            validate_web_functional_profile(profile)

    def test_rejects_ambiguous_or_unbounded_capability_bindings(self):
        for mutate in (
            lambda p: p["capabilities"].append(deepcopy(p["capabilities"][0])),
            lambda p: p["capabilities"][0].update(consumers=[]),
            lambda p: p["capabilities"][0].update(consumers=[SHELL_MOUNT]),
            lambda p: p["capabilities"][0].update(consumers=[SHELL_VIEW, SHELL_VIEW]),
            lambda p: p["capabilities"][0].update(exports=[]),
            lambda p: p["capabilities"][0].update(exports=[{"name": "useSidebar", "kind": "effect"}]),
            lambda p: p["capabilities"][0].update(exports=[{"name": "useSidebar", "kind": "component"}]),
            lambda p: p["capabilities"][0].update(exports=[{"name": "Default", "kind": "hook"}]),
            lambda p: p["capabilities"][0]["exports"][0].update(endpoint="/api/anything"),
            lambda p: p["capabilities"][0]["exports"].append({"name": "useSidebarReady", "kind": "hook"}),
            lambda p: p["capabilities"][0].update(path=SHELL_MOUNT),
            lambda p: p["capabilities"][0].update(path=SHELL_VIEW.lower()),
        ):
            profile = fixture()
            mutate(profile)
            with self.assertRaises(CandidateError):
                validate_web_functional_profile(profile)
        profile = fixture()
        profile["modules"] = [f"src/components/shell/View{number:02d}.tsx" for number in range(33)]
        profile["capabilities"][0].update(consumers=profile["modules"], exports=[
            {"name": f"useFlag{number:02d}", "kind": "hook"} for number in range(16)
        ])
        self.assertGreater(33 * 16, MAX_CAPABILITY_BINDINGS)
        with self.assertRaisesRegex(CandidateError, "total named grants"):
            validate_web_functional_profile(profile)

    def test_rejects_duplicate_json_unknown_fields_or_noncanonical_path_order(self):
        for source in (b'{"version":1,"version":2}', b'\xff', b' ' * (MAX_PROFILE_BYTES + 1),
                       canonical({**fixture(), "deploymentAuthorized": True}), canonical({**fixture(), "version": True}),
                       canonical({**fixture(), "version": 3}),
                       canonical({**fixture(), "modules": [SHELL_VIEW, ROUTE_VIEW]})):
            with self.subTest(prefix=source[:32]), self.assertRaises(CandidateError):
                parse_web_functional_profile(source)

    def test_only_existing_reviewed_renderers_and_styles_may_change(self):
        profile = fixture()
        baseline = {path: row(1) for path in mutable_web_paths(profile) | frozen_web_paths(profile) | {LOCK}}
        candidate = {**baseline, SHELL_VIEW: row(2), ROUTE_STYLE: row(3)}
        self.assertEqual(verify_web_functional_delta(baseline, candidate, profile), (ROUTE_STYLE, SHELL_VIEW))
        for changed in ({**candidate, ROUTE_MOUNT: row(2)}, {**candidate, CAPABILITY: row(2)},
                        {**candidate, SHELL_MOUNT: row(2)}, {**candidate, LOCK: row(2)},
                        {**candidate, SHELL_VIEW: row(2, "100755")},
                        {**candidate, SHELL_VIEW: row(2, "120000")},
                        {**candidate, SHELL_VIEW: ("100644", "blob", "not a Git object")},
                        {**candidate, "src/components/shell/NewView.tsx": row(3)},
                        {key: value for key, value in candidate.items() if key != CAPABILITY}, baseline):
            with self.assertRaises(CandidateError):
                verify_web_functional_delta(baseline, changed, profile)


if __name__ == "__main__":
    unittest.main()
