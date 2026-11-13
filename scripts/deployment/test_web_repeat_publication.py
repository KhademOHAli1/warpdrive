"""Test the repeat hosted admission and actual local bundle readback."""
from pathlib import Path
import hashlib
import json
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from candidate import CandidateError
from test_component_inputs import rehash
from test_web_baseline import API as BaselineAPI
from test_web_publication_gate import zip_bytes
import test_web_repeat_candidate as fixture
import web_repeat_publication as gate


REVISION, ORIGIN = fixture.CURRENT, fixture.ORIGIN
RUN, ATTEMPT = ORIGIN["runId"], ORIGIN["runAttempt"]


class API(BaselineAPI):
    def __init__(self, payload):
        super().__init__()
        self.revision = self.main = REVISION
        self.run = {"id": RUN, "workflow_id": 80, "path": f".github/workflows/{gate.WORKFLOW}",
                    "head_sha": REVISION, "head_branch": "main", "event": "workflow_dispatch",
                    "status": "completed", "conclusion": "success", "run_attempt": ATTEMPT, "run_number": 10,
                    "repository": {"id": self.repository_id}, "head_repository": {"id": self.repository_id},
                    "html_url": f"https://github.com/{gate.REPO}/actions/runs/{RUN}"}
        self.job = {"id": 81, "run_id": RUN, "run_attempt": ATTEMPT, "head_sha": REVISION, "name": gate.JOB,
                    "status": "completed", "conclusion": "success",
                    "steps": [{"name": name, "status": "completed", "conclusion": "success"} for name in gate.STEPS]}
        self.repeat_artifact = self.artifact(RUN, f"web-repeat-image-bundle-{REVISION}-{RUN}-{ATTEMPT}", 82)
        self.repeat_artifact.update(size_in_bytes=len(payload), digest="sha256:" + hashlib.sha256(payload).hexdigest())
        self.latest = self.run
        self.missing = None
        self.alerts = []
        self.workflow_queries = []
        self.other_jobs = {}

    def request(self, path):
        endpoint = path.removeprefix(f"repos/{gate.REPO}/")
        if endpoint == "git/ref/heads/main":
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.main}}
        if endpoint == f"actions/workflows/{gate.WORKFLOW}":
            return {"id": self.run["workflow_id"], "path": self.run["path"]}
        if endpoint == f"actions/runs/{RUN}":
            return self.run
        if endpoint.startswith("code-scanning/analyses?"):
            return [{"id": index, "commit_sha": REVISION, "category": name, "error": "", "tool": {"name": "CodeQL"}}
                    for index, name in enumerate(sorted(gate.CATEGORIES), 1)]
        if endpoint.startswith("code-scanning/alerts?"):
            return self.alerts
        return super().request(path)

    def pages(self, path, key):
        endpoint = path.removeprefix(f"repos/{gate.REPO}/actions/")
        if endpoint in (f"runs/{RUN}/attempts/{ATTEMPT}/jobs", f"runs/{RUN}/jobs?filter=latest"):
            return [self.job]
        if endpoint == f"runs/{RUN}/artifacts":
            return [self.repeat_artifact]
        if key == "workflow_runs":
            assert endpoint.endswith(f"/runs?head_sha={REVISION}")
            name = endpoint.split("/")[1]
            self.workflow_queries.append(name)
            if name == gate.WORKFLOW:
                return [self.latest]
            if name == self.missing:
                return []
            workflows = gate.repeat_policy()["required_workflows"]
            number = list(workflows).index(name) + 100
            self.other_jobs[number] = workflows[name]
            return [{**self.run, "id": number, "html_url": f"https://github.com/{gate.REPO}/actions/runs/{number}"}]
        if key == "jobs" and endpoint.endswith("/jobs?filter=latest"):
            return [{"name": name, "conclusion": "success"} for name in self.other_jobs[int(endpoint.split("/")[1])]]
        raise AssertionError(f"Unexpected API query {path}")


class RepeatWebPublicationTests(unittest.TestCase):
    def setUp(self):
        setup = fixture.RepeatWebCandidateTests()
        self.addCleanup(setup.doCleanups)
        setup.setUp()
        path = "scripts/deployment/web_repeat_publication.py"
        rows = setup.current["components"]["web"]["inputs"]
        rows.append({"path": path, "bytes": 32, "sha256": "1" * 64})
        rows.sort(key=lambda row: row["path"])
        rehash(setup.current)
        setup.inputs_path.write_bytes(fixture.encoded(setup.current))
        setup.presentation["baselineRevision"] = fixture.TOOLS
        tooling = {"activeWebRevision": setup.assembly["activeWebRevision"], "toolingRevision": fixture.TOOLS,
                   "candidateRevision": REVISION, "toolingPaths": [path], "toolingSourceSha256": "4" * 64}
        self.expected = setup.create(tooling=tooling, expected_tooling_revision=fixture.TOOLS)
        self.root, self.lineage, self.lineage_sha, self.composite = setup.private, setup.lineage, setup.lineage_sha, setup.composite
        self.files = {path.name: path.read_bytes() for path in setup.output.iterdir()}
        self.payload = zip_bytes(self.files)
        self.api = API(self.payload)
        self.destination = self.root / "retained"

    def fetch(self, artifact, archive):
        self.assertEqual(artifact["id"], self.api.repeat_artifact["id"])
        with gate.private_file(archive) as out:
            out.write(self.payload)

    def retain(self, **overrides):
        options = {"composite": self.composite, "installed_lineage": self.lineage,
                   "expected_installed_lineage_sha256": self.lineage_sha, "expected_profile_sha256": fixture.PROFILE,
                   "expected_harness_revision": fixture.TOOLS, "expected_tooling_revision": fixture.TOOLS, "fetch": self.fetch}
        return gate.retain(self.api, RUN, REVISION, self.destination, **(options | overrides))

    def test_publication_policy_preserves_six_full_source_workflows(self):
        old, new = (policy()["required_workflows"] for policy in (gate.publication_policy, gate.repeat_policy))
        self.assertEqual(new, {**{name: jobs for name, jobs in old.items() if name != gate.FULL_WORKFLOW}, gate.WORKFLOW: [gate.JOB]})
        self.assertEqual((len(new), sum(map(len, new.values()))), (7, 18))

    def test_actual_repeat_archive_reconstructs_and_preserves_bytes(self):
        receipt = self.retain()
        self.assertEqual((self.destination / gate.ZIP_NAME).read_bytes(), self.payload)
        self.assertEqual(json.loads((self.destination / gate.RECEIPT_NAME).read_bytes()), receipt)
        self.assertEqual(receipt["origin"], ORIGIN)
        self.assertEqual(receipt["jobId"], self.api.job["id"])
        self.assertEqual(receipt["baseline"], self.expected["candidate"]["baseline"])
        self.assertEqual(receipt["image"], self.expected["candidate"]["image"])
        self.assertEqual(receipt["provenance"], self.expected["provenance"])
        self.assertEqual(receipt["qualification"], self.expected["candidate"]["qualification"])
        self.assertFalse(receipt["deploymentAuthorized"])
        self.assertEqual(self.api.workflow_queries, list(gate.repeat_policy()["required_workflows"]) * 2)
        self.assertNotIn("private-edge-identity", json.dumps(receipt))
        for path in (self.destination / "bundle").iterdir():
            self.assertEqual(path.read_bytes(), self.files[path.name])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        with self.assertRaises(CandidateError):
            self.retain()

    def test_refuses_bad_attempt_or_any_required_step_skip(self):
        updates = [(self.api.run, "event", "pull_request"),
                   (self.api.job, "run_attempt", ATTEMPT + 1),
                   (self.api.__dict__, "latest", {**self.api.run, "run_attempt": ATTEMPT + 1})]
        updates += [(row, "conclusion", "skipped") for row in self.api.job["steps"]]
        for record, key, value in updates:
            with self.subTest(key=key, value=value), patch.dict(record, {key: value}), self.assertRaises(CandidateError):
                self.retain()
            self.assertFalse(self.destination.exists())

    def test_missing_full_workflow_or_high_codeql_cannot_retain(self):
        self.api.missing = "full-quality.yml"
        with self.assertRaisesRegex(gate.GateError, "full-quality.yml"):
            self.retain()
        self.api.missing = None
        self.api.alerts = [{"state": "open", "tool": {"name": "CodeQL"},
                            "rule": {"severity": "warning", "security_severity_level": "high"}}]
        with self.assertRaisesRegex(gate.GateError, "blocking CodeQL"):
            self.retain()
        self.assertFalse(self.destination.exists())

    def test_requires_full_pinned_lineage_and_exact_tooling(self):
        for lineage in (None, {**self.lineage, "acceptedPlanSha256": "0" * 64}):
            with self.subTest(lineage=lineage is not None), self.assertRaisesRegex(CandidateError, "full installed Web lineage"):
                self.retain(installed_lineage=lineage)
            self.assertFalse(self.destination.exists())
        with self.assertRaisesRegex(CandidateError, "tooling source differs"):
            self.retain(expected_tooling_revision="e" * 40)
        self.assertFalse((self.destination / gate.RECEIPT_NAME).exists())

    def test_move_main_or_artifact_during_download_leaves_no_receipt(self):
        for change in (lambda: setattr(self.api, "main", "0" * 40), lambda: self.api.repeat_artifact.update(id=83)):
            with tempfile.TemporaryDirectory(dir=self.root) as directory:
                self.destination = Path(directory) / "retained"

                def fetch(artifact, target):
                    self.fetch(artifact, target)
                    change()

                with self.assertRaises((CandidateError, gate.GateError)):
                    self.retain(fetch=fetch)
                self.assertFalse((self.destination / gate.RECEIPT_NAME).exists())
                self.api = API(self.payload)

    def test_rejects_wrong_hash_and_extra_duplicate_unsafe_or_legacy_members(self):
        alias = zipfile.ZipInfo(gate.ARCHIVE)
        alias.create_system = 3
        alias.external_attr = (stat.S_IFLNK | 0o777) << 16
        original = self.payload
        extra = {name: raw for name, raw in self.files.items() if name != gate.ARCHIVE}
        legacy = {("web-bundle.json" if name == gate.MANIFEST else name): raw for name, raw in self.files.items()}
        cases = ((original[:-1] + bytes([original[-1] ^ 1]), "ZIP digest", False),
                 (zip_bytes(self.files, extra=("../foreign", b"x")), "ZIP members", True),
                 (zip_bytes(self.files, extra=(gate.MANIFEST, b"x")), "ZIP members", True),
                 (zip_bytes(extra, extra=(alias, b"outside")), "oversized repeat ZIP member", True),
                 (zip_bytes(legacy), "ZIP members", True))
        for raw, error, authenticate in cases:
            with self.subTest(error=error), tempfile.TemporaryDirectory(dir=self.root) as directory:
                self.destination = Path(directory) / "retained"
                self.payload = raw
                self.api = API(raw if authenticate else original)
                with self.assertRaisesRegex(CandidateError, error):
                    self.retain()
                self.assertFalse((self.destination / "bundle").exists())
                self.assertFalse((self.destination / gate.RECEIPT_NAME).exists())


if __name__ == "__main__":
    unittest.main()
