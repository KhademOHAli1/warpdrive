from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from web_release_rehearsal import OWNED_MARKER, RehearsalError, _registered, cleanup, git, prepare


class RehearsalOwnershipTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        base = Path(directory.name).resolve()
        self.root, self.scratch = base / "repository", base / "scratch"
        self.root.mkdir()
        git(self.root, "init", "--quiet")
        git(self.root, "commit", "--allow-empty", "--quiet", "-m", "baseline")
        self.revision = git(self.root, "rev-parse", "HEAD")

    def test_cleanup_removes_only_the_owned_registered_worktree(self):
        self.scratch.mkdir(mode=0o700)
        source = self.scratch / "source"
        git(self.root, "worktree", "add", "--detach", str(source), self.revision)
        with self.assertRaisesRegex(RehearsalError, "marker"):
            cleanup(self.root, self.scratch)
        self.assertTrue(_registered(self.root, source))
        (self.scratch / ".warpdrive-web-rehearsal").write_bytes(OWNED_MARKER)
        cleanup(self.root, self.scratch)
        self.assertFalse(source.exists())
        self.assertFalse(_registered(self.root, source))
        cleanup(self.root, self.scratch)

    def test_requires_actual_same_run_origin_before_opening_scratch(self):
        with patch.dict("os.environ", {"GITHUB_ACTIONS": "false"}, clear=False):
            with self.assertRaisesRegex(RehearsalError, "same-run"):
                prepare(self.root, self.scratch, self.root / "bundle", self.revision, "0" * 64)
        self.assertFalse(self.scratch.exists())
