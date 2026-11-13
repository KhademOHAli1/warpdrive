"""Exercise exact-main API admission and bounded local Web artifact retention."""
import hashlib
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

from test_web_baseline import API as BaselineAPI
import test_web_candidate as candidate_fixture
import web_publication_gate as gate


REVISION = candidate_fixture.REVISION
OLD = candidate_fixture.BASELINE_REVISION
ORIGIN = {**candidate_fixture.ORIGIN, "event": "workflow_dispatch"}
RUN_ID, ATTEMPT = ORIGIN["runId"], ORIGIN["runAttempt"]


class API(BaselineAPI):
    def __init__(self, payload):
        super().__init__()
        self.revision = REVISION
        self.current_main = REVISION
        self.run = {
            "id": RUN_ID, "workflow_id": 11, "path": f".github/workflows/{gate.WORKFLOW}",
            "head_sha": REVISION, "head_branch": "main", "event": ORIGIN["event"],
            "status": "completed", "conclusion": "success", "run_attempt": ATTEMPT, "run_number": 10,
            "repository": {"id": self.repository_id}, "head_repository": {"id": self.repository_id},
            "html_url": f"https://github.com/{gate.REPO}/actions/runs/{RUN_ID}",
        }
        self.job = {
            "id": 72, "run_id": RUN_ID, "run_attempt": ATTEMPT, "head_sha": REVISION, "name": gate.JOB,
            "status": "completed", "conclusion": "success",
            "steps": [{"name": step, "status": "completed", "conclusion": "success"} for step in gate.STEPS],
        }
        name = f"web-image-bundle-{REVISION}-{RUN_ID}-{ATTEMPT}"
        self.web_artifact = self.artifact(RUN_ID, name, 73)
        self.web_artifact.update(digest="sha256:" + hashlib.sha256(payload).hexdigest(), size_in_bytes=len(payload))
        self.workflow_queries = []
        self.latest = self.run
        self.missing_ci = None
        self.alerts = []

    def request(self, path):
        endpoint = path.removeprefix(f"repos/{gate.REPO}/")
        if endpoint == f"actions/workflows/{gate.WORKFLOW}":
            return {"id": self.run["workflow_id"], "path": self.run["path"]}
        if endpoint == f"actions/runs/{RUN_ID}":
            return self.run
        if endpoint == "git/ref/heads/main":
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.current_main}}
        if endpoint.startswith("code-scanning/analyses?"):
            return [{"id": index, "commit_sha": REVISION, "category": name, "error": "", "tool": {"name": "CodeQL"}}
                    for index, name in enumerate(sorted(gate.CATEGORIES), 1)]
        if endpoint.startswith("code-scanning/alerts?"):
            return self.alerts
        return super().request(path)

    def pages(self, path, key):
        endpoint = path.removeprefix(f"repos/{gate.REPO}/actions/")
        if endpoint == f"runs/{RUN_ID}/attempts/{ATTEMPT}/jobs" or endpoint == f"runs/{RUN_ID}/jobs?filter=latest":
            return [self.job]
        if endpoint == f"runs/{RUN_ID}/artifacts":
            return [self.web_artifact]
        if key == "workflow_runs":
            self.assert_main_revision(endpoint)
            filename = endpoint.split("/")[1]
            self.workflow_queries.append(filename)
            if filename == gate.WORKFLOW:
                return [self.latest]
            if filename == self.missing_ci:
                return []
            jobs = gate.web_policy()["required_workflows"][filename]
            number = list(gate.web_policy()["required_workflows"]).index(filename) + 200
            self.workflows[number] = jobs
            return [{**self.run, "id": number, "html_url": f"https://github.com/{gate.REPO}/actions/runs/{number}"}]
        if key == "jobs" and endpoint.endswith("/jobs?filter=latest"):
            return [{"name": name, "conclusion": "success"} for name in self.workflows[int(endpoint.split("/")[1])]]
        raise AssertionError(f"Unexpected API query {path}")

    def assert_main_revision(self, endpoint):
        if not endpoint.endswith(f"/runs?head_sha={REVISION}"):
            raise AssertionError(f"Workflow query does not select exact revision {endpoint}")


def zip_bytes(files, *, extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in files.items():
            archive.writestr(name, raw)
        if extra is not None:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(*extra)
    return output.getvalue()


class WebPublicationTests(unittest.TestCase):
    def setUp(self):
        fixture = candidate_fixture.WebCandidateTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.packed = fixture.pack(origin=ORIGIN)
        self.files = {item.name: item.read_bytes() for item in fixture.output.iterdir()}
        self.payload = zip_bytes(self.files)
        self.api = API(self.payload)
        self.root = fixture.private
        self.destination = self.root / "retained"
        self.baseline_sha = self.packed["candidate"]["baseline"]["manifestSha256"]

    def fetch(self, artifact, path):
        self.assertEqual(artifact["id"], self.api.web_artifact["id"])
        with gate.private_file(path) as output:
            output.write(self.payload)

    def retain(self, *, fetch=None, baseline_sha=None):
        return gate.retain(self.api, RUN_ID, REVISION, OLD, baseline_sha or self.baseline_sha, self.destination,
                           fetch=fetch or self.fetch)

    def test_uses_existing_source_policy_except_full_image_jobs(self):
        standard = gate.publication_policy()["required_workflows"]
        selected = gate.web_policy()["required_workflows"]
        self.assertEqual(selected, {**{k: v for k, v in standard.items() if k != gate.FULL_WORKFLOW}, gate.WORKFLOW: [gate.JOB]})
        self.assertIn(gate.FULL_WORKFLOW, standard)

    def test_retains_exact_original_zip_and_verified_single_image(self):
        receipt = self.retain()
        self.assertEqual((self.destination / gate.ZIP_NAME).read_bytes(), self.payload)
        self.assertEqual(json.loads((self.destination / gate.RECEIPT_NAME).read_bytes()), receipt)
        self.assertEqual(receipt["origin"], ORIGIN)
        self.assertEqual(receipt["jobId"], self.api.job["id"])
        self.assertEqual(receipt["image"], self.packed["candidate"]["image"])
        self.assertEqual(receipt["baseline"], self.packed["candidate"]["baseline"])
        self.assertEqual(receipt["provenance"], self.packed["provenance"])
        self.assertEqual(receipt["security"]["categories"], sorted(gate.CATEGORIES))
        self.assertEqual(self.api.workflow_queries, list(gate.web_policy()["required_workflows"]) * 2)
        self.assertFalse(receipt["deploymentAuthorized"])
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)
        for path in (self.destination / "bundle").iterdir():
            self.assertEqual(path.read_bytes(), self.files[path.name])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        with self.assertRaisesRegex(gate.CandidateError, "fresh canonical"):
            self.retain()

    def test_refuses_wrong_run_latest_attempt_and_skipped_required_step(self):
        variants = (
            (self.api.run, "event", "pull_request"),
            (self.api.job, "run_attempt", ATTEMPT + 1),
            (self.api.job["steps"][0], "conclusion", "skipped"),
            (self.api.job["steps"][1], "conclusion", "skipped"),
            (self.api.__dict__, "latest", {**self.api.run, "run_attempt": ATTEMPT + 1}),
        )
        for record, key, new in variants:
            with self.subTest(key=key, new=new), patch.dict(record, {key: new}), self.assertRaises(gate.CandidateError):
                self.retain()
            self.assertFalse(self.destination.exists())

    def test_refuses_missing_full_source_and_blocking_codeql(self):
        self.api.missing_ci = "full-quality.yml"
        with self.assertRaisesRegex(gate.GateError, "full-quality.yml"):
            self.retain()
        self.api.missing_ci = None
        self.api.alerts = [{"state": "open", "tool": {"name": "CodeQL"},
                            "rule": {"severity": "warning", "security_severity_level": "high"}}]
        with self.assertRaisesRegex(gate.GateError, "blocking CodeQL"):
            self.retain()
        self.assertFalse(self.destination.exists())

    def test_refuses_moved_main_and_changed_artifact_after_transfer(self):
        for mutation in (lambda: setattr(self.api, "current_main", OLD),
                         lambda: self.api.web_artifact.update(id=74)):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory(dir=self.root) as temporary:
                self.destination = Path(temporary) / "retained"

                def fetch(artifact, path):
                    self.fetch(artifact, path)
                    mutation()

                with self.assertRaises((gate.GateError, gate.CandidateError)):
                    self.retain(fetch=fetch)
                self.assertFalse((self.destination / gate.RECEIPT_NAME).exists())
                self.api = API(self.payload)

    def test_wrong_baseline_pin_does_not_create_receipt(self):
        with self.assertRaises(gate.CandidateError):
            self.retain(baseline_sha="0" * 64)
        self.assertFalse((self.destination / gate.RECEIPT_NAME).exists())

    def test_changed_zip_and_unsafe_inventories_refuse_extraction(self):
        symlink = zipfile.ZipInfo(gate.ARCHIVE)
        symlink.create_system = 3
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        cases = (
            (self.payload[:-1] + bytes([self.payload[-1] ^ 1]), "digest differs", False),
            (zip_bytes(self.files, extra=("../foreign", b"x")), "artifact members", True),
            (zip_bytes(self.files, extra=(gate.MANIFEST, b"x")), "artifact members", True),
            (zip_bytes({name: data for name, data in self.files.items() if name != gate.ARCHIVE},
                       extra=(symlink, b"foreign")), "unsafe or oversized", True),
            (zip_bytes({name: data for name, data in self.files.items() if name != gate.MANIFEST}),
             "artifact members", True),
        )
        original = self.payload
        for raw, message, update in cases:
            with self.subTest(message=message), tempfile.TemporaryDirectory(dir=self.root) as temporary:
                self.destination = Path(temporary) / "retained"
                self.api = API(raw if update else original)
                self.payload = raw
                with self.assertRaisesRegex(gate.CandidateError, message):
                    self.retain()
                self.assertFalse((self.destination / gate.RECEIPT_NAME).exists())
                self.assertFalse((self.destination / "bundle").exists())

    def test_bounded_download_keeps_exact_bytes_and_refuses_excess_stdout(self):
        source = self.destination.with_suffix(".payload")
        source.write_bytes(self.payload)
        artifact = {"id": 73, "sizeBytes": len(self.payload), "digest": self.api.web_artifact["digest"]}
        runner = gate.subprocess.Popen
        with patch.object(gate.subprocess, "Popen", side_effect=lambda _, **options: runner(["cat", str(source)], **options)) as popen:
            gate.download(artifact, self.destination)
            self.assertEqual(self.destination.read_bytes(), self.payload)
            self.assertEqual(popen.call_args.args[0][-2:], ["GET", f"repos/{gate.REPO}/actions/artifacts/73/zip"])
            self.destination.unlink()
            source.write_bytes(self.payload + b"excess")
            with self.assertRaisesRegex(gate.CandidateError, "exceeds its authenticated byte count"):
                gate.download(artifact, self.destination)
            self.assertEqual(self.destination.stat().st_size, len(self.payload))


if __name__ == "__main__":
    unittest.main()
