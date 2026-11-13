from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

from candidate import CandidateError
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

    def test_export_attribute_cannot_omit_tracked_input(self):
        (self.root / ".gitattributes").write_text("entry export-ignore\n")
        self.git("add", ".gitattributes")
        self.git("commit", "-qm", "Attribute fixture")
        with self.assertRaisesRegex(CandidateError, "omitted tracked"):
            prepare_context(self.root, self.git("rev-parse", "HEAD").strip(), self.context)
