"""Prove that the next qualification can recover a functional predecessor."""

from hashlib import sha256
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from candidate import CandidateError
from component_inputs import canonical, content_hash
import test_web_functional_publication as fixture
import web_functional_historical as historical
from web_functional_successor import authenticate_functional_artifact
from web_release_build import git


class FunctionalHistoryTests(unittest.TestCase):
    def setUp(self):
        hosted = fixture.FunctionalWebPublicationTests()
        self.addCleanup(hosted.doCleanups)
        hosted.setUp()
        self.receipt = hosted.retain()
        self.api, self.payload = hosted.api, hosted.payload
        self.raw = (hosted.output / "receipt.json").read_bytes()
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name).resolve()
        repo = root / "source"
        repo.mkdir()
        self.git(repo, "init", "--quiet")
        self.git(repo, "commit", "--allow-empty", "--quiet", "-m", "initial")
        self.active_revision = self.git(repo, "rev-parse", "HEAD").decode().strip()
        history = repo / "scripts/deployment/web-history"
        history.mkdir(parents=True)
        predecessor = history / "predecessor.json"
        predecessor.write_bytes(canonical(hosted.composite))
        receipt = history / "functional.receipt"
        receipt.write_bytes(self.raw)
        self.git(repo, "add", "scripts")
        self.git(repo, "commit", "--quiet", "-m", "history")
        revision = self.git(repo, "rev-parse", "HEAD").decode().strip()
        self.args = SimpleNamespace(root=repo, revision=revision, output_dir=root / "verified", oras=None,
            core_admission_sha256="2" * 64, core_manifest_sha256="3" * 64, active_publication_file=receipt,
            active_publication_sha256=sha256(self.raw).hexdigest(), active_publication_bytes=len(self.raw),
            predecessor_lineage_sha256=hosted.lineage_sha, functional_predecessor_composite=predecessor,
            functional_predecessor_composite_sha256=content_hash(hosted.composite), previous_web_receipt=None,
            previous_web_receipt_sha256=None)
        self.backend = hosted.composite["backend"]

    @staticmethod
    def git(root, *args):
        return subprocess.check_output(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                                        "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args],
                                       cwd=root, timeout=10)

    def test_hosted_authority_is_verified_on_both_sides_of_retrieval(self):
        # The source checkout fixture has synthetic commits. Exercise the real
        # artifact authority and the real archive reader, substituting that one ancestry check.
        active = self.receipt["revision"]
        def ancestry(root, *args, **kwargs):
            if args == ("merge-base", "--is-ancestor", active, self.args.revision):
                return git(root, "merge-base", "--is-ancestor", self.active_revision, self.args.revision, **kwargs)
            return git(root, *args, **kwargs)

        def fetch(artifact, path):
            self.assertEqual(artifact, self.receipt["artifact"])
            with historical.private_file(path) as output:
                output.write(self.payload)

        with (patch("web_release_build.git", side_effect=ancestry),
              patch.object(historical, "require_selected_main") as main,
              patch.object(historical, "_retrieve_original_core", return_value=self.backend),
              patch.object(historical, "download", side_effect=fetch) as download,
              patch.object(historical, "authenticate_functional_artifact", wraps=authenticate_functional_artifact) as auth):
            result = historical.retrieve(self.api, self.args)
        self.assertEqual(auth.call_count, 2)
        self.assertEqual(main.call_count, 2)
        self.assertEqual(download.call_count, 1)
        self.assertEqual(result["web"]["image"], self.receipt["image"])
        self.assertEqual(result["backend"], self.backend)
        self.assertEqual((self.args.output_dir / "active-composite.json").read_bytes(), canonical(result) + b"\n")
        self.assertFalse((self.args.output_dir / "web").exists())

    def test_working_copy_receipt_cannot_replace_the_selected_git_blob(self):
        self.args.active_publication_file.write_bytes(self.raw + b" ")
        with patch.object(historical, "require_selected_main"):
            with self.assertRaisesRegex(CandidateError, "differs from selected main"):
                historical.retrieve(self.api, self.args)
        self.assertFalse((self.args.output_dir / "active.zip").exists())

    def test_historical_job_with_an_untrusted_steps_list_is_rejected(self):
        self.api.job["steps"] = None
        with self.assertRaisesRegex(CandidateError, "Exact hosted functional steps required"):
            authenticate_functional_artifact(self.api, self.receipt)
