import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

from candidate import CandidateError
from component_inputs import InputError, content_hash
from web_build_context import prepare_context, verify_context


class WebBuildContextTests(unittest.TestCase):
    def setUp(self):
        scratch = self.enterContext(TemporaryDirectory(prefix="web-build-context-"))
        self.root = Path(scratch).resolve() / "repo"
        self.root.mkdir()
        self.context = self.root.parent / "context"
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Web context fixture")
        recipe = self.root / "deploy/images/Web.Dockerfile"
        recipe.parent.mkdir(parents=True)
        recipe.write_text("FROM scratch\nCOPY . .\n")
        (self.root / ".dockerignore").write_text(".git\nnode_modules\n")
        (self.root / ".gitignore").write_text("ignored.log\n")
        (self.root / "entry").write_text("exact source\n")
        (self.root / "entry").chmod(0o755)
        self.git("add", ".")
        self.git("commit", "-qm", "Exact context")
        self.revision = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True)

    def commit_sources(self, sources):
        for path, text in sources.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        self.git("add", ".")
        self.git("commit", "-qm", "Test selection fixture")
        return self.git("rev-parse", "HEAD").strip()

    def test_context_contains_only_exact_git_blobs_and_modes(self):
        (self.root / "ignored.log").write_text("must stay outside context")
        (self.root / "entry").write_text("a dirty checkout cannot replace a Git object\n")
        record = prepare_context(self.root, self.revision, self.context)
        self.assertEqual(record, verify_context(self.root, self.revision, self.context))
        self.assertEqual(record["fileCount"], 4)
        self.assertEqual((self.context / "entry").read_text(), "exact source\n")
        self.assertEqual((self.context / "entry").stat().st_mode & 0o777, 0o755)
        self.assertFalse((self.context / "ignored.log").exists())
        self.assertFalse((self.context / ".git").exists())

    def test_mutation_and_untracked_addition_fail_reverification(self):
        prepare_context(self.root, self.revision, self.context)
        extra = self.context / "ignored.log"
        extra.touch()
        with self.assertRaisesRegex(CandidateError, "Untracked file"):
            verify_context(self.root, self.revision, self.context)
        extra.unlink()
        (self.context / "entry").write_text("changed source\n")
        with self.assertRaisesRegex(CandidateError, "bytes differ"):
            verify_context(self.root, self.revision, self.context)

    def test_context_subdirectories_stay_traversable_under_private_umask(self):
        previous = os.umask(0o077)
        try:
            prepare_context(self.root, self.revision, self.context)
        finally:
            os.umask(previous)
        self.assertEqual(self.context.stat().st_mode & 0o777, 0o700)
        for path in (self.context / "deploy", self.context / "deploy/images"):
            self.assertEqual(path.stat().st_mode & 0o777, 0o755)
        (self.context / "deploy/images").chmod(0o700)
        with self.assertRaisesRegex(CandidateError, "directory or mode"):
            verify_context(self.root, self.revision, self.context)

    def test_export_attribute_cannot_omit_tracked_input(self):
        (self.root / ".gitattributes").write_text("entry export-ignore\n")
        self.git("add", ".gitattributes")
        self.git("commit", "-qm", "Attribute fixture")
        with self.assertRaisesRegex(CandidateError, "omitted tracked"):
            prepare_context(self.root, self.git("rev-parse", "HEAD").strip(), self.context)

    def test_explicit_test_omission_changes_only_materialized_context(self):
        deep = "src/fixture/deep/only.test.ts"
        mixed = "src/mixed/view.test.tsx"
        retained = "src/mixed/keep.test.ts"
        revision = self.commit_sources({deep: "deep\n", mixed: "mixed\n", retained: "keep\n"})
        full_path = self.context.with_name("full-context")
        full = prepare_context(self.root, revision, full_path)
        self.assertEqual(full, verify_context(self.root, revision, full_path, exclude_tests=[]))
        self.assertEqual(set(full), {"schemaVersion", "kind", "sourceRevision", "gitInventorySha256", "fileCount",
                                    "contextDirectory", "dockerfile", "deploymentAuthorized"})

        result = prepare_context(self.root, revision, self.context, exclude_tests=(mixed, deep))
        self.assertEqual(result, verify_context(self.root, revision, self.context, exclude_tests=[deep, mixed]))
        self.assertEqual(result["schemaVersion"], 2)
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["gitInventorySha256"], full["gitInventorySha256"])
        self.assertEqual(result["fileCount"], full["fileCount"] - 2)
        self.assertEqual(result["excludedTests"], [deep, mixed])
        self.assertEqual(result["excludedTestCount"], 2)
        self.assertEqual(result["excludedTestPathsSha256"], content_hash([deep, mixed]))
        tree = {path: metadata.split() for metadata, path in (
            row.split("\t", 1) for row in self.git("ls-tree", "-r", revision).splitlines())}
        self.assertEqual(result["excludedTestsSha256"], content_hash({path: tree[path] for path in (deep, mixed)}))
        self.assertEqual(result["contextInventorySha256"], content_hash({path: row for path, row in tree.items()
                                                                      if path not in (deep, mixed)}))
        self.assertTrue((full_path / deep).is_file())
        self.assertTrue((full_path / mixed).is_file())
        self.assertFalse((self.context / "src/fixture").exists())
        self.assertFalse((self.context / mixed).exists())
        self.assertEqual((self.context / retained).read_text(), "keep\n")
        self.assertEqual((self.context / "src/mixed").stat().st_mode & 0o777, 0o755)

        with self.assertRaisesRegex(CandidateError, "inventory changed"):
            verify_context(self.root, revision, self.context, exclude_tests=[deep])
        (self.context / mixed).write_text("mixed\n")
        with self.assertRaisesRegex(CandidateError, "Excluded test entered"):
            verify_context(self.root, revision, self.context, exclude_tests=[deep, mixed])
        (self.context / mixed).unlink()
        (self.context / "src/fixture").mkdir(mode=0o755)
        with self.assertRaisesRegex(CandidateError, "Unexpected Web context directory"):
            verify_context(self.root, revision, self.context, exclude_tests=[deep, mixed])

    def test_invalid_selection_is_rejected_before_creating_context(self):
        test = "src/selected.test.ts"
        executable = "src/executable.test.tsx"
        self.commit_sources({test: "selected\n", executable: "executable\n", "src/not-a-test.ts": "source\n",
                             "tools/fixture.test.ts": "out of scope\n"})
        (self.root / executable).chmod(0o755)
        self.git("add", executable)
        self.git("commit", "-qm", "Executable test fixture")
        revision = self.git("rev-parse", "HEAD").strip()
        for selection in ([test, test], [executable], ["src/not-a-test.ts"], ["tools/fixture.test.ts"],
                          ["src/removed.test.tsx"], test):
            with self.subTest(selection=selection), self.assertRaises(CandidateError):
                prepare_context(self.root, revision, self.context, exclude_tests=selection)
            self.assertFalse(self.context.exists())
        with self.assertRaises(InputError):
            prepare_context(self.root, revision, self.context, exclude_tests=["src/../tools/fixture.test.ts"])
        self.assertFalse(self.context.exists())

    def test_selected_test_must_still_be_present_in_git_archive(self):
        test = "src/test-fixture/omitted.test.ts"
        revision = self.commit_sources({test: "test\n", ".gitattributes": f"{test} export-ignore\n"})
        with self.assertRaisesRegex(CandidateError, "omitted tracked"):
            prepare_context(self.root, revision, self.context, exclude_tests=[test])
        self.assertFalse((self.context / "src").exists())

    def test_selected_test_archive_bytes_are_verified_even_without_extraction(self):
        test = "src/test-fixture/modified.test.tsx"
        revision = self.commit_sources({test: "$Format:%H$\n", ".gitattributes": f"{test} export-subst\n"})
        with self.assertRaisesRegex(CandidateError, "Git archive changed tracked input bytes"):
            prepare_context(self.root, revision, self.context, exclude_tests=[test])
        self.assertFalse((self.context / "src").exists())
