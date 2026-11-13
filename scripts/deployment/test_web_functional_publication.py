"""Exercise the functional Web API gate and exact off-host artifact readback."""

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import warnings

from candidate import CandidateError
from component_inputs import content_hash
from publication_gate import GateError
from test_web_baseline import API as BaselineAPI
from test_web_functional_candidate import FunctionalCandidateTests as BundleFixture, CURRENT, ORIGIN
from test_web_publication_gate import zip_bytes
import test_web_successor_lineage as lineage_fixture
import web_functional_publication as gate


RUN, ATTEMPT = ORIGIN["runId"], ORIGIN["runAttempt"]


class API(BaselineAPI):
    def __init__(self, payload):
        super().__init__()
        self.revision = self.main = CURRENT
        self.run = {"id": RUN, "workflow_id": 80, "path": f".github/workflows/{gate.WORKFLOW}", "head_sha": CURRENT,
                    "head_branch": "main", "event": "workflow_dispatch", "status": "completed", "conclusion": "success",
                    "run_attempt": ATTEMPT, "run_number": 10, "repository": {"id": self.repository_id},
                    "head_repository": {"id": self.repository_id}, "html_url": f"https://github.com/{gate.REPO}/actions/runs/{RUN}"}
        self.job = {"id": 81, "run_id": RUN, "run_attempt": ATTEMPT, "head_sha": CURRENT, "name": gate.JOB,
                    "status": "completed", "conclusion": "success",
                    "steps": [{"name": name, "status": "completed", "conclusion": "success"} for name in gate.STEPS]}
        self.latest = self.run
        self.artifact_row = self.artifact(RUN, f"web-functional-image-bundle-{CURRENT}-{RUN}-{ATTEMPT}", 82)
        self.payload(payload)
        self.other_jobs, self.workflow_queries, self.alerts = {}, [], []
        self.categories = gate.CATEGORIES.copy()
        self.missing = None

    def payload(self, value):
        self.artifact_row.update(size_in_bytes=len(value), digest="sha256:" + sha256(value).hexdigest())

    def request(self, path):
        endpoint = path.removeprefix(f"repos/{gate.REPO}/")
        if endpoint == "git/ref/heads/main":
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.main}}
        if endpoint == f"actions/workflows/{gate.WORKFLOW}":
            return {"id": self.run["workflow_id"], "path": self.run["path"]}
        if endpoint == f"actions/runs/{RUN}":
            return self.run
        if endpoint.startswith("code-scanning/analyses?"):
            return [{"id": index, "commit_sha": CURRENT, "category": name, "error": "", "tool": {"name": "CodeQL"}}
                    for index, name in enumerate(sorted(self.categories), 1)]
        if endpoint.startswith("code-scanning/alerts?"):
            return self.alerts
        return super().request(path)

    def pages(self, path, key):
        endpoint = path.removeprefix(f"repos/{gate.REPO}/actions/")
        if endpoint in (f"runs/{RUN}/attempts/{ATTEMPT}/jobs", f"runs/{RUN}/jobs?filter=latest"):
            return [self.job]
        if endpoint == f"runs/{RUN}/artifacts":
            return [self.artifact_row]
        if key == "workflow_runs":
            assert endpoint.endswith(f"/runs?head_sha={CURRENT}")
            name = endpoint.split("/")[1]
            self.workflow_queries.append(name)
            if name == gate.WORKFLOW:
                return [self.latest]
            if name == self.missing:
                return []
            workflows = gate.functional_policy()["required_workflows"]
            number = list(workflows).index(name) + 100
            self.other_jobs[number] = workflows[name]
            return [{**self.run, "id": number, "html_url": f"https://github.com/{gate.REPO}/actions/runs/{number}"}]
        if key == "jobs" and endpoint.endswith("/jobs?filter=latest"):
            return [{"name": name, "conclusion": "success"} for name in self.other_jobs[int(endpoint.split("/")[1])]]
        raise AssertionError(f"Unexpected API query {path}")


class FunctionalWebPublicationTests(unittest.TestCase):
    def setUp(self):
        bundle = BundleFixture()
        self.addCleanup(bundle.doCleanups)
        bundle.setUp()
        self.bundle = bundle
        admitted = lineage_fixture.WebSuccessorLineageTests()
        admitted.setUp()
        self.addCleanup(admitted.doCleanups)
        self.composite = bundle.options["composite"]
        active = self.composite["web"]
        installed = admitted.chain["active"]
        accepted = admitted.plan["after"]
        revision = active["sourceRevision"]
        accepted["runtime"].update(sourceRevision=revision, runtimeId="12" * 32)
        accepted["route"].update(generation="wd-" + revision, runtimeId="12" * 32)
        installed["slot"] = deepcopy(accepted)
        installed["provenance"].update(revision=revision, manifestSha256=active["provenance"]["bundleManifestSha256"],
            archiveSha256=active["provenance"]["archiveSha256"], testedConfigDigest=active["image"]["imageId"],
            authoritySha256=active["publicationReceiptSha256"])
        previous = admitted.web["previous"]
        # The bundle fixture's original and active source IDs are reused across
        # tests. Give retained B its own separately authenticated artifact pin.
        old_revision = "9" * 40
        old_slot = admitted.plan["before"]
        old_slot["runtime"]["sourceRevision"] = old_revision
        old_slot["route"]["generation"] = "wd-" + old_revision
        admitted.chain["previous"]["slot"] = deepcopy(old_slot)
        admitted.chain["previous"]["provenance"]["revision"] = old_revision
        previous["sourceRevision"] = previous["image"]["sourceRevision"] = old_revision
        previous["image"]["generation"] = "wd-" + old_revision
        admitted.chain["acceptedPlanSha256"] = content_hash(admitted.plan)
        self.plan, self.lineage, self.previous = admitted.plan, admitted.chain, previous
        self.lineage_sha = content_hash(self.lineage)
        bundle.options["installed_lineage_sha256"] = self.lineage_sha
        self.input_sha = bundle.options["expected_input_sha256"]
        self.expected = bundle.create()
        self.files = {path.name: path.read_bytes() for path in bundle.directory.iterdir()}
        self.payload = zip_bytes(self.files)
        self.api = API(self.payload)
        self.output = bundle.root / "admitted"

    def fetch(self, artifact, path):
        self.assertEqual(artifact["id"], self.api.artifact_row["id"])
        with gate.private_file(path) as stream:
            stream.write(self.payload)

    def retain(self, **overrides):
        options = {"composite": self.composite, "previous_web": self.previous, "installed_lineage": self.lineage,
                   "accepted_plan": self.plan, "expected_installed_lineage_sha256": self.lineage_sha,
                   "expected_input_sha256": self.input_sha, "fetch": self.fetch}
        return gate.retain(self.api, RUN, CURRENT, self.output, **(options | overrides))

    def test_exact_policy_and_hosted_step_names_preserve_full_source_gates(self):
        full = gate.publication_policy()["required_workflows"]
        selected = gate.functional_policy()["required_workflows"]
        self.assertEqual(selected, {**{name: jobs for name, jobs in full.items() if name != gate.FULL_WORKFLOW}, gate.WORKFLOW: [gate.JOB]})
        self.assertEqual((len(selected), sum(map(len, selected.values()))), (7, 18))
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows" / gate.WORKFLOW
        source = workflow.read_text()
        self.assertIn("    name: " + gate.JOB, source)
        self.assertTrue(all("      - name: " + step in source for step in gate.STEPS))

    def test_native_fixture_archive_is_reconstructed_and_kept_private_with_no_runtime_data(self):
        result = self.retain()
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["origin"], ORIGIN)
        self.assertEqual(result["image"], self.expected["image"])
        self.assertEqual(result["qualification"], self.expected["qualification"])
        self.assertEqual(result["baseline"]["installedLineageSha256"], self.lineage_sha)
        self.assertEqual(result["provenance"]["bundleManifestSha256"], self.expected["bundleManifestSha256"])
        self.assertEqual((self.output / gate.ZIP_NAME).read_bytes(), self.payload)
        self.assertEqual(json.loads((self.output / gate.RECEIPT_NAME).read_bytes()), result)
        self.assertEqual(set(self.api.workflow_queries), set(gate.functional_policy()["required_workflows"]))
        self.assertEqual(set(result["security"]["categories"]), gate.CATEGORIES)
        for side in ("active", "previous"):
            self.assertNotIn(self.lineage[side]["alias"], json.dumps(result))
        self.assertNotIn(self.lineage["active"]["slot"]["runtime"]["runtimeId"], json.dumps(result))
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.output / gate.RECEIPT_NAME).stat().st_mode & 0o777, 0o600)
        self.assertEqual({path.name: path.read_bytes() for path in (self.output / "bundle").iterdir()}, self.files)

    def test_bad_private_chain_stops_before_hosted_queries_or_output(self):
        with patch.object(self.api, "request", side_effect=AssertionError("hosted API reached")):
            with self.assertRaises(CandidateError):
                self.retain(previous_web=self.composite["web"])
        self.assertFalse(self.output.exists())

    def test_switch_publication_requires_the_independently_selected_mode_and_profile(self):
        self.bundle.directory = self.bundle.directory.with_name("switch-functional-bundle")
        self.bundle.enable_switch()
        expected = self.bundle.create()
        self.input_sha = self.bundle.options["expected_input_sha256"]
        self.payload = zip_bytes({path.name: path.read_bytes() for path in self.bundle.directory.iterdir()})
        self.api.payload(self.payload)
        with self.assertRaisesRegex(CandidateError, "build context receipt"):
            self.retain()
        self.assertFalse((self.output / gate.RECEIPT_NAME).exists())
        self.output = self.output.with_name("switch-admitted")
        options = {key: self.bundle.options[key] for key in (
            "sdk_scenario", "expected_tooling_revision", "expected_profile_sha256")}
        result = self.retain(**options)
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["qualification"], expected["qualification"])
        self.assertEqual(result["provenance"]["bundleManifestSha256"], expected["bundleManifestSha256"])

    def test_main_attempt_steps_codeql_and_artifact_origin_all_fail_closed(self):
        mutations = (("main", "f" * 40), ("latest", {**self.api.run, "run_attempt": ATTEMPT + 1}),
                     ("categories", gate.CATEGORIES - {"/language:go"}), ("missing", "full-ci.yml"),
                     ("job", {**self.api.job, "steps": self.api.job["steps"][:-1]}),
                     ("artifact_row", {**self.api.artifact_row, "expired": True}))
        for key, value in mutations:
            with self.subTest(key=key), patch.object(self.api, key, value), self.assertRaises((CandidateError, GateError)):
                self.retain()
        self.assertFalse(self.output.exists())

    def test_digest_or_inventory_mismatch_never_creates_admission(self):
        old_payload = self.payload
        self.payload += b"tamper"
        with self.assertRaisesRegex(CandidateError, "size, type or custody differs"):
            self.retain()
        self.assertFalse((self.output / gate.RECEIPT_NAME).exists())
        self.output = self.output.with_name("duplicate")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            self.payload = zip_bytes(self.files, extra=(gate.MANIFEST, b"duplicate"))
        self.api.payload(self.payload)
        with self.assertRaisesRegex(CandidateError, "duplicate or missing functional artifact ZIP members"):
            self.retain()
        self.assertFalse((self.output / gate.RECEIPT_NAME).exists())
        self.assertNotEqual(self.payload, old_payload)

    def test_observed_artifact_change_after_readback_never_creates_admission(self):
        def fetch(artifact, path):
            self.fetch(artifact, path)
            self.api.artifact_row["id"] += 1

        with self.assertRaisesRegex(CandidateError, "changed while verifying"):
            self.retain(fetch=fetch)
        self.assertFalse((self.output / gate.RECEIPT_NAME).exists())
