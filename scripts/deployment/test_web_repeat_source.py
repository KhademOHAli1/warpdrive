"""Check the repeat source boundary with exact, isolated Git commits."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from candidate import CandidateError
from web_repeat_source import verify_repeat_presentation_git


STYLE = "src/components/shell/TopBar.module.css"
TOOLS = "scripts/deployment/web_repeat_source.py"


class WebRepeatSourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        self.write(STYLE, ".topBar {gap: 22px;}\n")
        self.active = self.commit()
        self.write(TOOLS, "# repeat admission\n")
        self.tools = self.commit()
        self.write(STYLE, ".topBar {gap: 20px;}\n")
        self.candidate = self.commit()

    def git(self, *arguments):
        return subprocess.check_output(["git", *arguments], cwd=self.root, text=True).strip()

    def write(self, name, value):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value)

    def commit(self):
        self.git("add", "--all")
        self.git("commit", "-q", "-m", "fixture")
        return self.git("rev-parse", "HEAD")

    def verify(self, tools=None, candidate=None):
        tools, candidate = tools or self.tools, candidate or self.candidate
        proof = {"baselineRevision": tools, "currentRevision": candidate, "changed": [{"path": STYLE,
                 "baselineBlob": self.git("rev-parse", f"{tools}:{STYLE}"),
                 "currentBlob": self.git("rev-parse", f"{candidate}:{STYLE}")}]}
        with patch("web_repeat_source.source_policy", return_value={"stable": True}):
            return verify_repeat_presentation_git(self.root, proof, active_inputs={"components": {}},
                                                 active_revision=self.active, tooling_revision=tools)

    def test_separates_exact_tools_and_presentation_revisions(self):
        result = self.verify()
        self.assertEqual(result["toolingPaths"], [TOOLS])
        self.assertEqual(result["candidateRevision"], self.candidate)

    def test_tools_cannot_change_protected_path(self):
        self.git("checkout", "--detach", self.tools)
        self.write("src/server/protected.ts", "export const protectedLogic = true;\n")
        tools = self.commit()
        self.write(STYLE, ".topBar {gap: 20px;}\n")
        with self.assertRaisesRegex(CandidateError, "protected source"):
            self.verify(tools=tools, candidate=self.commit())

    def test_extra_candidate_change_does_not_pass_as_tooling(self):
        self.write(TOOLS, "# unreviewed change in candidate\n")
        with self.assertRaisesRegex(CandidateError, "exact Git delta"):
            self.verify(candidate=self.commit())
