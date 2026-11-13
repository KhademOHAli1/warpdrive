import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from candidate import CandidateError
from component_inputs import canonical, content_hash
from web_release_inputs import _tree
from web_structural_delta import (
    KIND, MAX_ENVELOPE_BYTES, MAX_OPERATIONS, parse_web_structural_delta, structural_registry_review,
    verify_web_structural_delta,
)


BASELINE = "a" * 40
CANDIDATE = "b" * 40
HOOK = "src/features/deals/useBoardCurrency.ts"
RENDERER = "src/features/deal-workspace/DealStatusBadge.tsx"
VIEW = "src/app/(app)/contacts/[id]/LinkedDealRow.tsx"
STYLE = "src/components/shell/LeftNav.module.css"
TEST = "src/components/ConfirmDialog.focus.test.tsx"
ASSET = "public/images/deals/EmptyBoard.webp"
REGISTRY = "src/features/privacy/registryIdsCrm2.ts"
PROTECTED = "src/server/trpc/context.ts"


def git_row(number, mode="100644", kind="blob"):
    return mode, kind, f"{number:040x}"


def endpoint(number, mode="100644"):
    return None if number is None else {"mode": mode, "blob": git_row(number)[2]}


def operation(path, role, action, before, after):
    return {"path": path, "role": role, "operation": action, "before": endpoint(before), "after": endpoint(after)}


def envelope(*operations):
    return {
        "kind": KIND,
        "version": 1,
        "baselineRevision": BASELINE,
        "candidateRevision": CANDIDATE,
        "operations": sorted(operations, key=lambda item: item["path"]),
    }


def fixture():
    before = {RENDERER: git_row(1), VIEW: git_row(2), STYLE: git_row(3), PROTECTED: git_row(4)}
    after = {
        HOOK: git_row(5), VIEW: git_row(6), STYLE: git_row(7), PROTECTED: git_row(4),
        TEST: git_row(8), ASSET: git_row(9),
    }
    return before, after, envelope(
        operation(HOOK, "client", "add", None, 5),
        operation(RENDERER, "client", "remove", 1, None),
        operation(VIEW, "client", "replace", 2, 6),
        operation(STYLE, "style", "replace", 3, 7),
        operation(TEST, "test", "add", None, 8),
        operation(ASSET, "asset", "add", None, 9),
    )


def verify(before, after, review, **overrides):
    arguments = {
        "baseline_revision": BASELINE,
        "candidate_revision": CANDIDATE,
        "expected_sha256": content_hash(review),
        "protected_paths": {PROTECTED},
    }
    return verify_web_structural_delta(before, after, review, **(arguments | overrides))


class WebStructuralDeltaTests(unittest.TestCase):
    def test_admits_explicit_structural_ui_delta(self):
        before, after, review = fixture()
        formatted = json.dumps(review, indent=2).encode("utf-8")
        parsed = parse_web_structural_delta(formatted, expected_sha256=content_hash(review))
        self.assertEqual(parsed, review)
        self.assertEqual(verify(before, after, parsed), tuple(sorted({HOOK, RENDERER, VIEW, STYLE, TEST, ASSET})))
        self.assertIsNone(structural_registry_review(parsed))

    def test_rechecks_reviewed_digest_and_exact_revisions_at_use(self):
        before, after, review = fixture()
        pin = content_hash(review)
        parsed = parse_web_structural_delta(canonical(review), expected_sha256=pin)
        parsed["candidateRevision"] = "c" * 40
        with self.assertRaisesRegex(CandidateError, "reviewed digest"):
            verify(before, after, parsed, expected_sha256=pin)
        with self.assertRaisesRegex(CandidateError, "different Git revisions"):
            verify(before, after, parsed)
        with self.assertRaisesRegex(CandidateError, "reviewed digest"):
            parse_web_structural_delta(canonical(review), expected_sha256=None)

    def test_requires_exact_diff_in_both_directions_and_exact_blob_ids(self):
        before, after, review = fixture()
        with self.assertRaisesRegex(CandidateError, "exact Git tree changes"):
            verify(before, {**after, "src/components/Unreviewed.tsx": git_row(10)}, review)
        with self.assertRaisesRegex(CandidateError, "exact Git tree changes"):
            verify(before, {**after, RENDERER: before[RENDERER]}, review)
        with self.assertRaisesRegex(CandidateError, "exact Git tree changes"):
            verify(before, after, {**review, "operations": review["operations"][:-1]})
        with self.assertRaisesRegex(CandidateError, "Git endpoint"):
            verify(before, {**after, HOOK: git_row(11)}, review)
        with self.assertRaisesRegex(CandidateError, "Git endpoint"):
            verify({**before, RENDERER: git_row(12)}, after, review)

    def test_external_protection_vetoes_reviewed_or_unreviewed_operations(self):
        before, after, review = fixture()
        with self.assertRaisesRegex(CandidateError, "independently protected"):
            verify(before, after, review, protected_paths={HOOK})
        with self.assertRaisesRegex(CandidateError, "independently protected"):
            verify(before, {**after, PROTECTED: git_row(10)}, review)
        with self.assertRaisesRegex(CandidateError, "protected path inventory"):
            verify(before, after, review, protected_paths=None)

    def test_registry_repin_requires_its_own_digest_and_stays_protected_when_pinned(self):
        before, after, review = fixture()
        row = operation(REGISTRY, "registry-review", "replace", 10, 11)
        review["operations"] = sorted([*review["operations"], row], key=lambda item: item["path"])
        before[REGISTRY] = git_row(10)
        after[REGISTRY] = git_row(11)
        registry_review = structural_registry_review(review)
        self.assertEqual(registry_review["operations"], [row])
        pin = content_hash(registry_review)
        registry_review["operations"][0]["after"]["blob"] = "c" * 40
        self.assertEqual(row["after"], endpoint(11))
        for invalid_pin in (None, content_hash(review), "c" * 64):
            with self.subTest(pin=invalid_pin), self.assertRaisesRegex(CandidateError, "registry re-pin"):
                verify(before, after, review, expected_registry_review_sha256=invalid_pin)
        self.assertIn(REGISTRY, verify(before, after, review, expected_registry_review_sha256=pin))
        with self.assertRaisesRegex(CandidateError, "independently protected"):
            verify(before, after, review, protected_paths={REGISTRY}, expected_registry_review_sha256=pin)
        with self.assertRaisesRegex(CandidateError, "Unexpected independent"):
            verify(*fixture(), expected_registry_review_sha256=pin)

    def test_cannot_reclassify_protected_files_or_executable_content_as_ui(self):
        disallowed = (
            ("src/app/(app)/contacts/page.tsx", "client"),
            ("src/app/(app)/contacts/layout.tsx", "client"),
            ("src/app/(app)/contacts/route.ts", "client"),
            ("src/app/(app)/contacts/manifest.ts", "client"),
            ("src/app/(app)/contacts/page.test.tsx", "test"),
            ("src/app/(app)/contacts/ContactView.server.test.tsx", "test"),
            ("src/app/(app)/contacts/error.tsx", "client"),
            ("src/app/(app)/contacts/icon2.tsx", "client"),
            ("src/app/(app)/@pane/(.)auth/LoginView.tsx", "client"),
            ("src/app/(app)/[api]/View.tsx", "client"),
            ("src/app/(auth)/LoginView.tsx", "client"),
            ("src/components/AuthGate.tsx", "client"),
            ("src/components/ServerSentView.tsx", "client"),
            ("src/components/SessionView.module.css", "style"),
            ("src/components/Foo.test.ts", "client"),
            ("src/features/deals/actions/Change.ts", "client"),
            ("src/features/deals/server-utils/Change.ts", "client"),
            ("src/features/deals/View.server.tsx", "client"),
            ("src/features/auth/SignInScreen.tsx", "client"),
            ("src/features/privacy/registry.ts", "registry-review"),
            ("src/features/privacy/registryIdsCRM.ts", "client"),
            ("src/app/globals.css", "style"),
            ("src/components/Global.css", "style"),
            ("public/sitemap.xml", "asset"),
            ("public/images/provider.svg", "asset"),
            ("public/assets/service-worker.js", "asset"),
            ("public/images/.well-known/token.png", "asset"),
            ("public/images/auth/login.png", "asset"),
            ("deploy/images/Web.Dockerfile", "asset"),
            ("bun.lock", "client"),
        )
        for path, role in disallowed:
            review = envelope(operation(path, role, "replace", 1, 2))
            with self.subTest(path=path, role=role), self.assertRaisesRegex(CandidateError, "cannot be written"):
                parse_web_structural_delta(canonical(review), expected_sha256=content_hash(review))
        review = envelope(operation(REGISTRY, "registry-review", "add", None, 1))
        with self.assertRaisesRegex(CandidateError, "cannot be written"):
            parse_web_structural_delta(canonical(review), expected_sha256=content_hash(review))

    def test_rejects_executable_symlink_gitlink_or_absence_as_a_regular_endpoint(self):
        before, after, review = fixture()
        for mode, kind in (("100755", "blob"), ("120000", "blob"), ("160000", "commit")):
            with self.subTest(mode=mode), self.assertRaisesRegex(CandidateError, "Git endpoint"):
                verify(before, {**after, HOOK: git_row(5, mode, kind)}, review)
            declared = envelope(operation(HOOK, "client", "add", None, 1))
            declared["operations"][0]["after"]["mode"] = mode
            with self.subTest(mode=mode), self.assertRaisesRegex(CandidateError, "non-executable"):
                parse_web_structural_delta(canonical(declared), expected_sha256=content_hash(declared))
        for action, left, right in (("add", 1, 2), ("remove", 1, 2), ("replace", None, 2),
                                    ("replace", 2, None), ("replace", 1, 1)):
            declared = envelope(operation(HOOK, "client", action, left, right))
            with self.subTest(action=action, left=left, right=right), self.assertRaises(CandidateError):
                parse_web_structural_delta(canonical(declared), expected_sha256=content_hash(declared))

    def test_rejects_case_and_directory_aliases_even_against_an_unchanged_path(self):
        before, after, review = fixture()
        aliases = (
            HOOK.lower(),
            "src/features/Deals/Existing.ts",
            "src/features/deals/useBoardCurrency.ts/Existing.ts",
            "src/features/deals",
        )
        for path in aliases:
            with self.subTest(path=path), self.assertRaisesRegex(CandidateError, "case or path collision"):
                verify({**before, path: git_row(10)}, {**after, path: git_row(10)}, review)
        with self.assertRaisesRegex(CandidateError, "case or path collision"):
            verify(before, after, review, protected_paths={HOOK.lower()})
        unicode_before = {**before, "docs/café/a.md": git_row(10)}
        unicode_after = {**after, "docs/café/a.md": git_row(10), "docs/cafe\u0301/b.md": git_row(11)}
        with self.assertRaisesRegex(CandidateError, "case or path collision"):
            verify(unicode_before, unicode_after, review)

    def test_rejects_noncanonical_roles_duplicate_fields_paths_and_excessive_inputs(self):
        _, _, review = fixture()
        bad = [
            {**review, "operations": []},
            {**review, "version": True},
            {**review, "authorized": True},
            {**review, "operations": review["operations"][::-1]},
            {**review, "operations": [review["operations"][0]] * 2},
            envelope(*(operation(f"src/components/View{index:03d}.tsx", "client", "add", None, index)
                       for index in range(MAX_OPERATIONS + 1))),
            envelope(operation("src/components/../db/Save.ts", "client", "add", None, 1)),
            envelope(operation("src/components//Save.ts", "client", "add", None, 1)),
            envelope(operation("src/components/" + "A" * 241 + ".ts", "client", "add", None, 1)),
            envelope(operation(HOOK, "asset", "add", None, 1)),
            envelope(operation(HOOK, "client", "copy", None, 1)),
        ]
        for value in bad:
            with self.subTest(kind=value.get("version")), self.assertRaises(CandidateError):
                parse_web_structural_delta(canonical(value), expected_sha256=content_hash(value))
        for raw in (b"", b" " * (MAX_ENVELOPE_BYTES + 1), b"\xff", b'{"version":1,"version":1}'):
            with self.subTest(prefix=raw[:40]), self.assertRaises(CandidateError):
                parse_web_structural_delta(raw, expected_sha256=content_hash(review))

    def test_matches_actual_git_tree_records_across_an_add_remove_and_replace(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch).resolve()
            environment = {
                "PATH": os.environ["PATH"],
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CONFIG_NOSYSTEM": "1",
            }

            def git(*args):
                return subprocess.run(
                    ("git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Web Test",
                     "-c", "user.email=web@example.invalid", *args),
                    cwd=root, env=environment, capture_output=True, check=True, timeout=8,
                ).stdout.decode().strip()

            def write(path, source):
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(source, encoding="utf-8")

            git("init", "-q", "--object-format=sha1")
            write(RENDERER, "export const oldBadge = true;\n")
            write(STYLE, ".main { gap: 24px; }\n")
            git("add", ".")
            git("commit", "-qm", "baseline")
            baseline = git("rev-parse", "HEAD")
            write(HOOK, "export const useBoardCurrency = () => 'EUR';\n")
            write(STYLE, ".main { gap: 22px; }\n")
            (root / RENDERER).unlink()
            git("add", "-A")
            git("commit", "-qm", "candidate")
            candidate = git("rev-parse", "HEAD")
            before, after = _tree(root, baseline), _tree(root, candidate)
            review = envelope(
                operation(HOOK, "client", "add", None, int(after[HOOK][2], 16)),
                operation(RENDERER, "client", "remove", int(before[RENDERER][2], 16), None),
                operation(STYLE, "style", "replace", int(before[STYLE][2], 16), int(after[STYLE][2], 16)),
            )
            review.update(baselineRevision=baseline, candidateRevision=candidate)
            self.assertEqual(verify(before, after, review, baseline_revision=baseline, candidate_revision=candidate),
                             tuple(sorted({HOOK, RENDERER, STYLE})))


if __name__ == "__main__":
    unittest.main()
