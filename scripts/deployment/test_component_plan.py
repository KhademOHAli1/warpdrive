"""Advisory selection controls; no Next, image, registry, provider or deployment is run."""
import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from candidate import create_candidate
import component_inputs as inputs
import component_plan as planner
from test_candidate import fixture as candidate_fixture
from test_component_inputs import fixture as input_fixture, rehash

CURRENT = "2" * 40
ORIGINAL = "1" * 40


class ComponentPlanTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.historical = input_fixture(self.root)
        (self.root / "bun.lock").write_bytes(b"original shared lock")
        lock = {"path": "bun.lock", "sha256": hashlib.sha256(b"original shared lock").hexdigest(), "bytes": 20}
        self.historical["policy"]["sharedFiles"].append("bun.lock")
        for component in self.historical["components"].values():
            component["inputs"] = sorted([*component["inputs"], lock.copy()], key=lambda item: item["path"])
        rehash(self.historical)
        self.current = copy.deepcopy(self.historical)
        report, inspected = candidate_fixture()
        self.original = create_candidate(ORIGINAL, report, "d" * 64, inspected, input_receipt=self.historical)

    def change(self, path, content, names):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        record = {"path": path, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
        for name in names:
            component = self.current["components"][name]
            component["inputs"] = sorted([item for item in component["inputs"] if item["path"] != path] + [record.copy()],
                                          key=lambda item: item["path"])
            if path not in self.current["policy"]["sharedFiles"]:
                component["graphInputs"] = sorted(set([*component["graphInputs"], path]))
        rehash(self.current)

    def plan(self, historical=True, candidate=True):
        # Exercise the real file verification and fresh-discovery comparison. The tiny
        # fixture does not execute a compiler; exact Git calls are asserted separately.
        with patch.object(inputs, "_discover", return_value=inputs.canonical(self.current)), \
             patch.object(inputs, "verify_source_revision") as source:
            result = planner.create_plan(self.root, self.current,
                self.historical if historical else None, self.original if candidate else None,
                expected_revision=CURRENT)
        self.assertEqual(source.call_count, 4)
        for call in source.call_args_list:
            self.assertEqual(call.args, (self.root, self.current, CURRENT))
        return result

    def test_worker_only_change_builds_only_worker_without_next_and_keeps_original_identity(self):
        original = copy.deepcopy(self.original)
        self.change("src/worker.ts", b"changed worker only", ["worker"])
        result = self.plan()
        self.assertEqual(result["buildComponents"], ["worker"])
        self.assertEqual(result["retainCandidates"], ["web", "realtime", "migrator"])
        self.assertFalse(result["nextBuildRequired"])
        self.assertEqual(self.original, original)
        for name, component in result["components"].items():
            declared = component["declaredOriginalImage"]
            self.assertEqual(declared["sourceRevision"], ORIGINAL)
            self.assertEqual(declared["imageId"], original["components"][name]["imageId"])
            self.assertEqual(declared["runtimeUser"], original["components"][name]["runtimeUser"])
            self.assertIsNone(declared["registryRef"])
        self.assertEqual(result["releaseRevision"], CURRENT)

    def test_ui_only_change_builds_only_web(self):
        self.change("src/web.ts", b"new UI copy", ["web"])
        result = self.plan()
        self.assertEqual(result["buildComponents"], ["web"])
        self.assertEqual(result["retainCandidates"], ["worker", "realtime", "migrator"])
        self.assertTrue(result["nextBuildRequired"])

    def test_equal_inputs_are_only_unqualified_candidates_with_all_admission_still_pending(self):
        result = self.plan()
        self.assertEqual(result["buildComponents"], [])
        self.assertEqual(result["retainCandidates"], list(inputs.COMPONENTS))
        self.assertFalse(result["nextBuildRequired"])
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["state"], "advisory-only")
        self.assertEqual(result["retentionQualification"], "not-assessed")
        self.assertEqual(result["originalIdentityAuthority"], "unverified-declaration-only")
        self.assertEqual(result["pendingGates"], list(planner.PENDING_GATES))
        self.assertIn("authenticated-original-provenance-and-finalized-qualification", result["pendingGates"])
        self.assertIn("durable-authenticated-original-custody", result["pendingGates"])
        self.assertIn("mixed-assembly-current-release-qualification", result["pendingGates"])
        self.assertIn("current-main-and-latest-full-ci-admission", result["pendingGates"])
        self.assertIn("current-codeql-and-blocking-findings-admission", result["pendingGates"])
        self.assertEqual(result["extensionsPending"], ["engine", "ingress"])

    def test_shared_lock_change_forces_all_builds(self):
        self.change("bun.lock", b"changed global lock", inputs.COMPONENTS)
        result = self.plan()
        self.assertEqual(result["buildComponents"], list(inputs.COMPONENTS))
        self.assertEqual({item["reason"] for item in result["components"].values()}, {"shared-inputs-changed"})

    def test_base_build_arguments_and_policy_changes_invalidate_all(self):
        for mutation in ("base", "version", "ws-url", "policy", "policy-source"):
            with self.subTest(mutation=mutation):
                current = copy.deepcopy(self.current)
                if mutation == "base":
                    current["context"]["baseImage"] = "oven/bun@sha256:" + "f" * 64
                elif mutation in {"version", "ws-url"}:
                    key = "APP_VERSION" if mutation == "version" else "NEXT_PUBLIC_WS_URL"
                    current["context"]["buildArgs"][key] = "changed-semantic-build-input"
                elif mutation == "policy":
                    current["policy"]["esbuild"] = {"format": "changed"}
                else:
                    path = sorted(inputs.POLICY_SOURCES)[0]
                    content = (self.root / path).read_bytes() + b" changed"
                    (self.root / path).write_bytes(content)
                    record = {"path": path, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
                    current["policy"]["policySources"] = [record if item["path"] == path else item for item in current["policy"]["policySources"]]
                    for component in current["components"].values():
                        component["inputs"] = [record if item["path"] == path else item for item in component["inputs"]]
                rehash(current)
                with patch.object(inputs, "verify_current") as current_check:
                    result = planner.create_plan(self.root, current, self.historical, self.original, expected_revision=CURRENT)
                self.assertEqual(current_check.call_count, 2)
                self.assertEqual(result["buildComponents"], list(inputs.COMPONENTS))
                self.assertEqual(result["retainCandidates"], [])

    def test_unsupported_platform_or_policy_version_fails_closed(self):
        for target in ("current", "historical"):
            for dimension in ("platform", "policy"):
                current, historical = copy.deepcopy(self.current), copy.deepcopy(self.historical)
                changed = current if target == "current" else historical
                if dimension == "platform":
                    changed["context"]["platform"] = "linux/arm64"
                else:
                    changed["policy"]["version"] = 999
                rehash(changed)
                with self.subTest(target=target, dimension=dimension), self.assertRaises(inputs.InputError):
                    planner.create_plan(self.root, current, historical, self.original, expected_revision=CURRENT)

    def test_missing_or_unsupported_historical_eligibility_requires_builds(self):
        for history, candidate in ((None, None), (self.historical, None),
                                   (self.historical, {"schemaVersion": 1}), (self.historical, {"schemaVersion": 3})):
            with self.subTest(history=history is None, candidate=candidate), patch.object(inputs, "verify_current"):
                result = planner.create_plan(self.root, self.current, history, candidate, expected_revision=CURRENT)
            self.assertEqual(result["buildComponents"], list(inputs.COMPONENTS))
            self.assertEqual(result["retainCandidates"], [])
            self.assertTrue(all(item["declaredOriginalImage"] is None for item in result["components"].values()))
        with self.assertRaises(planner.PlanError):
            planner.create_plan(self.root, self.current, None, self.original, expected_revision=CURRENT)

    def test_corrupt_incomplete_or_caller_trust_assertions_cannot_create_eligibility(self):
        mutations = (
            lambda item: item["components"]["worker"].update(sourceRevision=CURRENT),
            lambda item: item["components"]["web"].update(imageId="mutable:tag"),
            lambda item: item["components"]["web"].update(registryRef="registry.example/app:latest"),
            lambda item: item["components"]["web"].update(runtimeUser=" root"),
            lambda item: item["components"]["web"].update(runtimeUser="0000:1000"),
            lambda item: item["components"].pop("migrator"),
            lambda item: item["inputProvenance"].update(receiptSha256="0" * 64),
            lambda item: item.update(deploymentAuthorized=True),
            lambda item: item.update(trusted=True),
            lambda item: item.update(pendingGates=[]),
        )
        for mutate in mutations:
            original = copy.deepcopy(self.original)
            mutate(original)
            with self.subTest(mutation=mutate), self.assertRaises(planner.PlanError):
                planner.create_plan(self.root, self.current, self.historical, original, expected_revision=CURRENT)

    def test_corrupt_or_incomplete_receipt_is_rejected_before_source_discovery(self):
        for target in ("current", "historical"):
            for corruption in ("digest", "missing-component", "trusted"):
                current, old = copy.deepcopy(self.current), copy.deepcopy(self.historical)
                changed = current if target == "current" else old
                if corruption == "digest":
                    changed["components"]["worker"]["componentInputSha256"] = "0" * 64
                elif corruption == "missing-component":
                    del changed["components"]["realtime"]
                else:
                    changed["trusted"] = True
                with self.subTest(target=target, corruption=corruption), patch.object(inputs, "verify_current") as discover:
                    with self.assertRaises(inputs.InputError):
                        planner.create_plan(self.root, current, old, self.original, expected_revision=CURRENT)
                    discover.assert_not_called()

    def test_new_discovered_import_cannot_hide_behind_an_unchanged_declared_receipt(self):
        fresh = copy.deepcopy(self.current)
        (self.root / "src/new.ts").write_bytes(b"new transitive application dependency")
        component = fresh["components"]["worker"]
        component["inputs"].append({"path": "src/new.ts", "sha256": hashlib.sha256(b"new transitive application dependency").hexdigest(), "bytes": len(b"new transitive application dependency")})
        component["inputs"].sort(key=lambda item: item["path"])
        component["graphInputs"] = sorted([*component["graphInputs"], "src/new.ts"])
        rehash(fresh)
        with patch.object(inputs, "_discover", return_value=inputs.canonical(fresh)), patch.object(inputs, "verify_source_revision"):
            with self.assertRaisesRegex(inputs.InputError, "fresh dependency discovery differs"):
                planner.create_plan(self.root, self.current, self.historical, self.original, expected_revision=CURRENT)

    def test_new_input_is_built_when_included_in_fresh_current_receipt(self):
        self.change("src/new.ts", b"new dependency", ["worker"])
        self.assertEqual(self.plan()["buildComponents"], ["worker"])

    def test_changed_source_after_initial_check_or_exact_head_failure_cannot_emit_advice(self):
        for failure in (inputs.InputError("wrong HEAD"), inputs.InputError("new import after first pass")):
            with self.subTest(failure=str(failure)), patch.object(inputs, "verify_current", side_effect=[self.current, failure]):
                with self.assertRaises(inputs.InputError):
                    planner.create_plan(self.root, self.current, self.historical, self.original, expected_revision=CURRENT)
        with patch.object(inputs, "verify_source_revision", side_effect=inputs.InputError("wrong HEAD")), \
             patch.object(inputs, "_discover") as discovery:
            with self.assertRaisesRegex(inputs.InputError, "wrong HEAD"):
                planner.create_plan(self.root, self.current, self.historical, self.original, expected_revision=CURRENT)
            discovery.assert_not_called()

    def test_result_is_deterministic_without_mutating_receipts_or_original_candidate(self):
        before = copy.deepcopy((self.current, self.historical, self.original))
        first, second = self.plan(), self.plan()
        self.assertEqual(inputs.canonical(first), inputs.canonical(second))
        self.assertEqual((self.current, self.historical, self.original), before)
        first["components"]["worker"]["declaredOriginalImage"]["sourceRevision"] = "f" * 40
        self.assertEqual(self.original["components"]["worker"]["sourceRevision"], ORIGINAL)

    def test_direct_metadata_calls_enforce_byte_and_complexity_bounds(self):
        oversized = {"padding": "x" * (inputs.MAX_JSON_BYTES + 1)}
        with self.assertRaises(planner.PlanError):
            planner.bounded_metadata(oversized)
        cyclic = []
        cyclic.append(cyclic)
        with self.assertRaises(planner.PlanError):
            planner.bounded_metadata(cyclic)

    def test_cli_is_stdout_only_and_cannot_skip_existing_exact_git_verifier(self):
        current_path = self.root / "current.json"
        historical_path = self.root / "historical.json"
        candidate_path = self.root / "candidate.json"
        for path, value in ((current_path, self.current), (historical_path, self.historical), (candidate_path, self.original)):
            path.write_text(json.dumps(value))
        before = set(self.root.rglob("*"))
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr), patch.object(inputs, "verify_current") as verify:
            code = planner.main(["--root", str(self.root), "--current-receipt", str(current_path),
                "--historical-receipt", str(historical_path), "--historical-candidate", str(candidate_path),
                "--expected-revision", CURRENT])
        self.assertEqual(code, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(verify.call_count, 2)
        for call in verify.call_args_list:
            self.assertEqual(call.kwargs, {"expected_revision": CURRENT})
        self.assertEqual(json.loads(stdout.getvalue())["retainCandidates"], list(inputs.COMPONENTS))
        self.assertEqual(set(self.root.rglob("*")), before)
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr), patch.object(inputs, "verify_current", side_effect=inputs.InputError("private diagnostics")):
            self.assertEqual(planner.main(["--root", str(self.root), "--current-receipt", str(current_path), "--expected-revision", CURRENT]), 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "Component build plan rejected\n")


class PlanMetadataLoaderTests(unittest.TestCase):
    def test_duplicate_incomplete_or_oversized_json_is_never_silently_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "receipt.json"
            for content in ('{"x":1,"x":2}', '{"missing":', "x" * (inputs.MAX_JSON_BYTES + 1)):
                path.write_text(content)
                with self.subTest(content=content[:30]), self.assertRaises((inputs.InputError, planner.PlanError)):
                    planner.load_metadata(path)

    def test_regular_file_control_and_no_follow_file_or_ancestor_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            real = root / "real"
            real.mkdir()
            target = real / "receipt.json"
            target.write_text('{"finite":"metadata"}')
            self.assertEqual(planner.load_metadata(target), {"finite": "metadata"})
            direct = root / "alias.json"
            direct.symlink_to(target)
            alias = root / "alias"
            alias.symlink_to(real, target_is_directory=True)
            for path in (direct, alias / "receipt.json"):
                with self.subTest(path=path.name), self.assertRaises((OSError, planner.PlanError)):
                    planner.load_metadata(path)

    def test_fifo_or_directory_is_rejected_without_blocking(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            fifo = root / "fifo.json"
            os.mkfifo(fifo)
            for path in (root, fifo):
                with self.subTest(path=path.name), self.assertRaises((OSError, planner.PlanError)):
                    planner.load_metadata(path)


if __name__ == "__main__":
    unittest.main()
