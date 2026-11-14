"""Daemon-free admission, import custody, aggregate-budget and held-lifecycle tests."""

from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import local_native_fixture as fixture
import native_image_identity as native
from test_native_image_identity import archive_bytes, encoded, fixture as image_fixture


REVISION = "a" * 40
PARENT = "warpdrivequalification0123456789ab.slice"


def pin(path):
    raw = path.read_bytes()
    return {"path": str(path), "sha256": sha256(raw).hexdigest(), "bytes": len(raw)}


class FakeDocker:
    endpoint = "unix:///var/run/docker.sock"

    def __init__(self, rows=None, *, available=True, after_load=True, failure=None):
        self.rows = rows or {}
        self.available, self.after_load, self.failure = available, after_load, failure
        self.calls = []

    def run(self, argv, **options):
        self.calls.append(argv)
        if argv[:2] == ["image", "inspect"]:
            row = self.rows.get(argv[2]) if self.available else None
            return SimpleNamespace(returncode=0 if row else 1, stdout=json.dumps([row]) if row else "")
        if argv[:2] == ["image", "load"]:
            if self.failure:
                raise self.failure
            self.available = self.after_load
            return SimpleNamespace(returncode=0, stdout="loaded")
        if argv[:1] == ["info"]:
            return SimpleNamespace(returncode=0, stdout="systemd\n")
        raise AssertionError(argv)


class NativeFixtureTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        return path

    def graph(self, count=1, *, partial=False, legacy=False, name="images.tar"):
        files, expected, rows, ids = image_fixture(count, legacy=legacy)
        if partial:
            index = json.loads(files["index.json"])
            index["manifests"] = index["manifests"][:1]
            files["index.json"] = encoded(index)
        path = self.write(name, archive_bytes(files))
        graph = native.verify_archive(path, expected_sha256=pin(path)["sha256"], expected_bytes=path.stat().st_size,
                                      expected_images=expected, archive_mode="docker-save-compatibility")
        return files, expected, rows, ids, graph, path

    def test_independent_file_bytes_and_closed_pins_are_required(self):
        path = self.write("pin.json", b'{"finite":true}')
        self.assertEqual(fixture._record(pin(path), contents=True), {"finite": True})
        for change in ({"sha256": "f" * 64}, {"bytes": True}, {"extra": "forbidden"}):
            record = {**pin(path), **change}
            with self.subTest(change=change), self.assertRaises(fixture.LocalFixtureError):
                fixture._record(record)

    def test_docker_journal_persists_safe_intent_before_action_and_returns_same_result(self):
        receipt, snapshots = {}, []

        def persisted():
            snapshots.append(json.loads(json.dumps(receipt)))
        original = SimpleNamespace(returncode=0, stdout="unchanged stdout", stderr="private stderr")

        def operation(arguments, **options):
            self.assertEqual(snapshots[-1]["dockerOperations"][-1]["state"], "intent")
            self.assertEqual(snapshots[-1]["currentDockerOpcode"], "image.load")
            self.assertEqual(options, {"timeout": 45, "check": False, "input_bytes": b"private stdin"})
            return original

        docker = Mock()
        docker.run.side_effect = operation
        journal = fixture.JournalDocker(docker, receipt, persisted)
        result = journal.run(["image", "load", "--input", "/private/source/image.tar"], timeout=45, input_bytes=b"private stdin")
        self.assertIs(result, original)
        self.assertEqual(receipt["dockerOperations"], [{"sequence": 1, "opcode": "image.load", "state": "completed", "exitCode": 0}])
        self.assertEqual(len(snapshots), 2)
        for value in ("/private", "private stdin", "private stderr", "unchanged stdout"):
            self.assertNotIn(value, json.dumps(receipt))

    def test_docker_journal_retains_check_false_and_nonzero_exit_semantics_without_payloads(self):
        receipt = {}
        result = SimpleNamespace(returncode=7, stdout="SECRET_OUTPUT", stderr="SECRET_ERROR")
        docker = SimpleNamespace(run=Mock(return_value=result))
        journal = fixture.JournalDocker(docker, receipt, lambda: None)
        command = ["exec", "SECRET_CONTAINER", "du", "-sk", "/var/lib/registry"]
        self.assertIs(journal.run(command, check=False), result)
        with self.assertRaisesRegex(fixture.SmokeError, r"^registry.capacity.du failed \(exit 7\)$"):
            journal.run(command)
        self.assertEqual(receipt["dockerOperations"][-1]["exitCode"], 7)
        self.assertEqual(receipt["dockerOperations"][-1]["state"], "nonzero")
        self.assertNotIn("SECRET", json.dumps(receipt))

    def test_docker_json_journal_preserves_decoding_and_marks_invalid_json_safely(self):
        receipt = {}
        docker = SimpleNamespace(run=Mock(return_value=SimpleNamespace(returncode=0, stdout='{"Running":true}')))
        journal = fixture.JournalDocker(docker, receipt, lambda: None)
        command = ["container", "inspect", "SECRET_NAME", "--format", "{{json .State}}"]
        self.assertEqual(journal.json(command, timeout=5), {"Running": True})
        docker.run.assert_called_once_with(command, timeout=5, check=False, input_bytes=None)
        docker.run.return_value = SimpleNamespace(returncode=0, stdout="SECRET_INVALID_JSON")
        with self.assertRaisesRegex(fixture.SmokeError, "container.inspect.state returned invalid JSON"):
            journal.json(command)
        self.assertEqual(receipt["dockerOperations"][-1], {"sequence": 2, "opcode": "container.inspect.state", "state": "invalid-json", "exitCode": 0})
        self.assertNotIn("SECRET", json.dumps(receipt))

    def test_docker_journal_uses_fixed_opcodes_and_keeps_only_sixteen_finite_entries(self):
        receipt = {}
        docker = SimpleNamespace(run=Mock(return_value=SimpleNamespace(returncode=0, stdout="PRIVATE_PAYLOAD")))
        journal = fixture.JournalDocker(docker, receipt, lambda: None)
        for index in range(20):
            journal.run(["SECRET_OPCODE_" + str(index), "/secret/argument", "TOKEN=private"])
        self.assertEqual(len(receipt["dockerOperations"]), 16)
        self.assertEqual(receipt["dockerOperations"][0]["sequence"], 5)
        self.assertEqual(receipt["currentDockerOpcode"], "docker.other")
        for value in ("SECRET", "/secret", "TOKEN", "private", "PRIVATE_PAYLOAD"):
            self.assertNotIn(value, json.dumps(receipt))

    def test_docker_journal_propagates_unknown_and_interrupt_unchanged(self):
        for failure in (fixture.FreshCommandUnknown("SECRET_UNKNOWN"), KeyboardInterrupt()):
            receipt = {}
            docker = SimpleNamespace(run=Mock(side_effect=failure))
            journal = fixture.JournalDocker(docker, receipt, lambda: None)
            try:
                journal.run(["push", "PRIVATE_TAG"])
            except BaseException as caught:
                self.assertIs(caught, failure)
            else:
                self.fail("The original failure must propagate")
            self.assertEqual(receipt["dockerOperations"][-1]["state"], "raised")
            self.assertNotIn("SECRET", json.dumps(receipt))
            self.assertNotIn("PRIVATE", json.dumps(receipt))

    def test_file_symlink_and_hardlink_cannot_substitute_pinned_record(self):
        path = self.write("original", b"owned bytes")
        link = self.root / "link"
        link.symlink_to(path)
        with self.assertRaises((ValueError, OSError)):
            fixture._record({**pin(path), "path": str(link)})
        link.unlink()
        os.link(path, link)
        with self.assertRaises(ValueError):
            fixture._record(pin(path))

    def source(self):
        files = {}
        for name in ("scripts/deployment/local_native_fixture.py", "scripts/deployment/native_image_identity.py"):
            record = pin(self.write(name, b"pinned source\n"))
            files[name] = {key: record[key] for key in ("sha256", "bytes")}
        return {"root": str(self.root), "baseRevision": REVISION, "capsule": pin(self.write("source.tar", b"capsule")), "files": files}

    def test_source_ownership_uses_actual_base_and_complete_dirty_inventory(self):
        source = self.source()
        with patch.object(fixture, "ROOT", self.root), patch.object(fixture, "_git", side_effect=[REVISION, "scripts/deployment/native_image_identity.py", ""]):
            self.assertRegex(fixture.verify_source(source), r"^[a-f0-9]{64}$")
        for results in (["b" * 40, "", ""], [REVISION, "foreign.py", ""], [REVISION, "", "unowned.py"]):
            with self.subTest(results=results), patch.object(fixture, "ROOT", self.root), patch.object(fixture, "_git", side_effect=results):
                with self.assertRaises(fixture.LocalFixtureError):
                    fixture.verify_source(source)

    def test_pinned_source_bytes_are_rechecked_before_git_observation(self):
        source = self.source()
        self.write("scripts/deployment/native_image_identity.py", b"changed source")
        with patch.object(fixture, "ROOT", self.root), patch.object(fixture, "_git") as git:
            with self.assertRaises(fixture.LocalFixtureError):
                fixture.verify_source(source)
            git.assert_not_called()

    def budget(self):
        directory = self.root / PARENT
        directory.mkdir()
        for name, content in {"cpu.max": "200000 100000", "memory.max": str(7 * fixture.GIB), "memory.current": "0", "cgroup.procs": ""}.items():
            (directory / name).write_text(content)
        return {"parent": PARENT, "cpuQuota": 200000, "cpuPeriod": 100000,
                "memoryMaxBytes": 7 * fixture.GIB, "hostReserveBytes": fixture.GIB}

    def test_existing_systemd_slice_requires_exact_budget_and_host_reserve(self):
        budget = self.budget()
        with patch.object(fixture, "CGROUP_ROOT", self.root), patch.object(fixture, "_host_memory", return_value=8 * fixture.GIB):
            proof = fixture.verify_budget(budget, FakeDocker(), initial=True)
            self.assertEqual(proof["memoryMaxBytes"], 7 * fixture.GIB)
            for name, value in (("cpu.max", "max 100000"), ("memory.max", str(8 * fixture.GIB)), ("cgroup.procs", "999999")):
                path = self.root / PARENT / name
                previous = path.read_text()
                path.write_text(value)
                with self.subTest(name=name), self.assertRaises(fixture.LocalFixtureError):
                    fixture.verify_budget(budget, FakeDocker(), initial=True)
                path.write_text(previous)
            with patch.object(fixture, "_host_memory", return_value=7 * fixture.GIB), self.assertRaises(fixture.LocalFixtureError):
                fixture.verify_budget(budget, FakeDocker(), initial=True)
            (self.root / PARENT / "foreign-child").mkdir()
            with self.assertRaises(fixture.LocalFixtureError):
                fixture.verify_budget(budget, FakeDocker(), initial=True)

    def test_coordinator_moves_only_its_pid_to_child_not_slice_root(self):
        budget = self.budget()
        with patch.object(fixture, "CGROUP_ROOT", self.root), patch.object(fixture, "_birth", return_value="123456"), \
                patch.object(fixture, "_self_cgroup", return_value=[f"0::/{PARENT}/coordinator"]):
            proof = fixture.move_self(budget)
            self.assertEqual(proof["pid"], os.getpid())
            self.assertEqual((self.root / PARENT / "cgroup.procs").read_text(), "")
            self.assertEqual((self.root / PARENT / "coordinator/cgroup.procs").read_text(), str(os.getpid()) + "\n")
            with self.assertRaises(fixture.LocalFixtureError):
                fixture.move_self(budget)

    def test_coordinator_move_does_not_claim_success_for_wrong_membership_or_reused_pid(self):
        budget = self.budget()
        with patch.object(fixture, "CGROUP_ROOT", self.root), patch.object(fixture, "_birth", side_effect=["1", "2"]), \
                patch.object(fixture, "_self_cgroup", return_value=[f"0::/{PARENT}/coordinator"]):
            with self.assertRaises(fixture.LocalFixtureError):
                fixture.move_self(budget)

    def test_transport_projection_requires_identical_payload_and_complete_real_roots(self):
        files, expected, _, _, original, _ = self.graph(4, partial=True, legacy=True)
        full_files, _, _, _ = image_fixture(4, legacy=True)
        files["index.json"] = full_files["index.json"]
        path = self.write("complete-index.tar", archive_bytes(files))
        graph = fixture.verify_load_archive(original, pin(path), expected)
        self.assertEqual(graph["payloadBlobs"], original["payloadBlobs"])
        self.assertEqual(len(graph["ociRootConfigDigests"]), 4)
        self.assertNotEqual(graph["archiveIndexDigest"], original["archiveIndexDigest"])
        self.assertEqual(graph["dockerManifestSha256"], original["dockerManifestSha256"])

    def test_transport_projection_rejects_partial_index_or_changed_compatibility_metadata(self):
        files, expected, _, _, original, path = self.graph(4, partial=True, legacy=True)
        with self.assertRaisesRegex(fixture.LocalFixtureError, "all selected"):
            fixture.verify_load_archive(original, pin(path), expected)
        full_files, _, _, _ = image_fixture(4, legacy=True)
        files["index.json"] = full_files["index.json"]
        entries = json.loads(files["manifest.json"])
        entries[0]["RepoTags"] = ["changed:metadata"]
        files["manifest.json"] = encoded(entries)
        path = self.write("changed-tags.tar", archive_bytes(files))
        with self.assertRaisesRegex(fixture.LocalFixtureError, "inventory"):
            fixture.verify_load_archive(original, pin(path), expected)

    def test_transport_projection_rejects_changed_blob_bytes_even_with_new_external_pin(self):
        files, expected, _, _, original, _ = self.graph(4, partial=True, legacy=True)
        full_files, _, _, _ = image_fixture(4, legacy=True)
        files["index.json"] = full_files["index.json"]
        layer = json.loads(files["manifest.json"])[0]["Layers"][0]
        files[layer] = b"x" * len(files[layer])
        path = self.write("altered-payload.tar", archive_bytes(files))
        with self.assertRaises(native.IdentityError):
            fixture.verify_load_archive(original, pin(path), expected)

    def test_all_preloaded_native_identities_are_reused_without_archive_load(self):
        _, _, rows, ids, graph, path = self.graph(4)
        docker = FakeDocker({ids[role]["manifest"]: row for role, row in rows.items()})
        proof, loads = fixture.preload(docker, path, graph, load_allowed=True)
        self.assertEqual(loads, 0)
        self.assertEqual(len(proof), 4)
        self.assertFalse(any(call[:2] == ["image", "load"] for call in docker.calls))

    def test_one_explicit_archive_load_is_journaled_and_all_actual_readbacks_are_required(self):
        _, _, rows, ids, graph, path = self.graph(4)
        docker = FakeDocker({ids[role]["manifest"]: row for role, row in rows.items()}, available=False)
        observed = []
        proof, loads = fixture.preload(docker, path, graph, load_allowed=True,
                                      before_load=lambda: observed.append(len(docker.calls)))
        self.assertEqual(loads, 1)
        self.assertEqual(len(proof), 4)
        self.assertEqual(len(observed), 1)
        self.assertEqual(docker.calls[observed[0]], ["image", "load", "--input", str(path)])

    def test_partial_preload_is_held_without_import_or_retry(self):
        _, _, rows, ids, graph, path = self.graph(4)
        docker = FakeDocker({ids["web"]["manifest"]: rows["web"]})
        with self.assertRaisesRegex(fixture.LocalFixtureError, "partially"):
            fixture.preload(docker, path, graph, load_allowed=True)
        self.assertFalse(any(call[:2] == ["image", "load"] for call in docker.calls))

    def test_import_failure_or_missing_native_readback_never_replays(self):
        _, _, rows, ids, graph, path = self.graph()
        for docker in (FakeDocker(available=False, failure=fixture.FreshCommandUnknown("unknown load")),
                       FakeDocker(available=False, failure=RuntimeError("nonzero image load")),
                       FakeDocker({ids["web"]["manifest"]: rows["web"]}, available=False, after_load=False)):
            with self.subTest(docker=docker), self.assertRaises(fixture.FreshCommandUnknown):
                fixture.preload(docker, path, graph, load_allowed=True)
            self.assertEqual(sum(call[:2] == ["image", "load"] for call in docker.calls), 1)

    def execution(self, *, recovery=True):
        output = self.root / "output"
        output.mkdir(mode=0o700)
        roles = {"baseline": ("web", "worker", "realtime", "migrator"), "web": ("candidate_web",), "engine": ("engine",)}
        graphs = {name: {"images": {role: {} for role in names}} for name, names in roles.items()}
        ids = {role: "sha256:" + str(index + 1) * 64 for index, role in enumerate(role for names in roles.values() for role in names)}
        handoff = {"dockerEndpoint": FakeDocker.endpoint, "cgroup": {"parent": PARENT}, "source": {}, "storageClientBin": "mcli",
                   "baseline": {"bundleDir": str(self.root), "revision": REVISION, "loadAllowed": True},
                   "web": {"archive": {"path": str(self.root / "web.tar")}, "nativeImageId": ids["candidate_web"], "loadAllowed": True},
                   "engine": {"archive": {"path": str(self.root / "engine.tar")}, "loadAllowed": True},
                   "recovery": {"restic": {"path": "/tools/restic", "sha256": "a" * 64},
                                "pgControl": {"path": "/tools/pg_controldata", "sha256": "b" * 64}} if recovery else None}
        admitted = {"sourcePin": "a" * 64, "baseline": {}, "graphs": graphs, "baselineLoadArchive": self.root / "transport.tar",
                    "baselineTransport": {"payloadBytesUnchanged": True}}
        supports = {role: {"nativeImageId": "sha256:" + hex(index + 10)[2:] * 64, "reference": role + "@sha256:" + "a" * 64}
                    for index, role in enumerate(fixture.SUPPORT)}
        events = []
        registry = SimpleNamespace(prefix="owned-registry", cleanup=Mock(side_effect=lambda: events.append("registry-cleanup") or []))
        patches = {
            "admit": Mock(return_value=admitted), "verify_source": Mock(return_value="a" * 64), "verify_budget": Mock(return_value={}),
            "support_images": Mock(return_value=supports), "move_self": Mock(return_value={"cgroup": "coordinator"}),
            "preload": Mock(side_effect=lambda docker, archive, graph, **opts: ({role: {"nativeImageId": ids[role]} for role in graph["images"]}, 0)),
            "publish": Mock(return_value=({role: role + "@sha256:" + "a" * 64 for role in ids}, {})),
        }
        self.enterContext(patch.multiple(fixture, **patches))
        fresh = Mock(side_effect=lambda *args, **kwargs: events.append("fresh") or {"success": True, "cleanupSuccess": True})
        cold = Mock(side_effect=lambda *args, **kwargs: events.append("recovery") or {"success": True, "cleanupSuccess": True})
        options = {"docker_factory": Mock(return_value=FakeDocker()), "registry_factory": Mock(return_value=registry), "fresh": fresh, "cold": cold}
        return handoff, output, patches, options, registry, events

    def test_fresh_then_recovery_finish_before_owned_registry_cleanup(self):
        handoff, output, _, options, registry, events = self.execution()
        result = fixture.execute(handoff, output, move=True, **options)
        self.assertTrue(result["success"])
        self.assertEqual(events, ["fresh", "recovery", "registry-cleanup"])
        self.assertFalse(result["deploymentAuthorized"])
        self.assertFalse(result["releaseProfileAdmitted"])
        self.assertEqual(options["fresh"].call_args.kwargs, {"storage_client_bin": "mcli", "cgroup_parent": PARENT})
        self.assertEqual(options["cold"].call_args.kwargs["output_parent"], output)
        registry.cleanup.assert_called_once_with()

    def test_unknown_archive_load_is_manual_hold_even_before_registry_exists(self):
        handoff, output, patches, options, registry, _ = self.execution()
        journal = []

        def unknown_load(*args, **kwargs):
            kwargs["before_load"]()
            journal.append(json.loads((output / "report.json").read_bytes())["phase"])
            raise fixture.FreshCommandUnknown("unknown load")

        patches["preload"].side_effect = unknown_load
        result = fixture.execute(handoff, output, **options)
        self.assertEqual(journal, ["archive-load-intent"])
        self.assertTrue(result["manualReconciliationRequired"])
        options["registry_factory"].assert_not_called()
        registry.cleanup.assert_not_called()

    def test_unknown_publish_keeps_registry_and_never_invokes_fixtures(self):
        handoff, output, patches, options, registry, _ = self.execution()
        journal = []

        def unknown_publish(*args):
            journal.append(json.loads((output / "report.json").read_bytes())["phase"])
            raise fixture.FreshCommandUnknown("unknown push")

        patches["publish"].side_effect = unknown_publish
        result = fixture.execute(handoff, output, **options)
        self.assertEqual(journal, ["registry-intent"])
        self.assertTrue(result["manualReconciliationRequired"])
        registry.cleanup.assert_not_called()
        options["fresh"].assert_not_called()

    def test_nonzero_registry_mutation_keeps_registry_and_requires_manual_reconciliation(self):
        handoff, output, patches, options, registry, _ = self.execution()
        patches["publish"].side_effect = RuntimeError("nonzero volume/network/run/tag/push")
        result = fixture.execute(handoff, output, **options)
        self.assertTrue(result["manualReconciliationRequired"])
        self.assertTrue(result["mutationOutcomeUnknown"])
        registry.cleanup.assert_not_called()
        options["fresh"].assert_not_called()

    def test_journal_nonzero_publication_keeps_pending_hold_without_exposing_arguments(self):
        handoff, output, patches, options, registry, _ = self.execution()
        options["docker_factory"].return_value = SimpleNamespace(endpoint=FakeDocker.endpoint,
            run=Mock(return_value=SimpleNamespace(returncode=42, stdout="PRIVATE_OUTPUT", stderr="PRIVATE_ERROR")))
        patches["publish"].side_effect = lambda registry, docker, *args: docker.run(["push", "PRIVATE_TAG"])
        result = fixture.execute(handoff, output, **options)
        self.assertTrue(result["manualReconciliationRequired"])
        self.assertTrue(result["mutationOutcomeUnknown"])
        self.assertEqual(result["currentDockerOpcode"], "image.push")
        self.assertEqual(result["dockerOperations"][-1], {"sequence": 1, "opcode": "image.push", "state": "nonzero", "exitCode": 42})
        self.assertNotIn("PRIVATE", json.dumps(result))
        registry.cleanup.assert_not_called()

    def test_interrupt_after_load_intent_is_held_before_registry_creation(self):
        handoff, output, patches, options, registry, _ = self.execution()

        def interrupted(*args, **kwargs):
            kwargs["before_load"]()
            raise KeyboardInterrupt()

        patches["preload"].side_effect = interrupted
        result = fixture.execute(handoff, output, **options)
        self.assertTrue(result["manualReconciliationRequired"])
        self.assertTrue(result["mutationOutcomeUnknown"])
        options["registry_factory"].assert_not_called()
        registry.cleanup.assert_not_called()

    def test_fixture_manual_hold_retains_registry_and_recovery_never_starts(self):
        handoff, output, _, options, registry, _ = self.execution()
        options["fresh"].side_effect = None
        options["fresh"].return_value = {"success": False, "cleanupSuccess": False, "manualReconciliationRequired": True}
        result = fixture.execute(handoff, output, **options)
        self.assertTrue(result["manualReconciliationRequired"])
        registry.cleanup.assert_not_called()
        options["cold"].assert_not_called()

    def test_deterministic_fixture_failure_with_confirmed_cleanup_cleans_registry(self):
        handoff, output, _, options, registry, _ = self.execution()
        options["fresh"].side_effect = None
        options["fresh"].return_value = {"success": False, "cleanupSuccess": True}
        result = fixture.execute(handoff, output, **options)
        self.assertFalse(result["success"])
        self.assertFalse(result["manualReconciliationRequired"])
        registry.cleanup.assert_called_once_with()

    def test_post_fixture_source_drift_holds_registry_despite_claimed_fixture_cleanup(self):
        handoff, output, patches, options, registry, _ = self.execution()
        patches["verify_source"].side_effect = ["a" * 64, "a" * 64, fixture.LocalFixtureError("source changed")]
        result = fixture.execute(handoff, output, **options)
        self.assertTrue(result["manualReconciliationRequired"])
        registry.cleanup.assert_not_called()

    def test_failed_admission_precedes_docker_or_registry_mutation(self):
        handoff, output, patches, options, registry, _ = self.execution()
        patches["admit"].side_effect = fixture.LocalFixtureError("closed admission failed")
        result = fixture.execute(handoff, output, **options)
        self.assertFalse(result["success"])
        self.assertFalse(result["manualReconciliationRequired"])
        options["docker_factory"].assert_not_called()
        registry.cleanup.assert_not_called()

    def test_registry_cleanup_failure_is_manual_hold(self):
        handoff, output, _, options, registry, _ = self.execution(recovery=False)
        registry.cleanup.side_effect = RuntimeError("cleanup unknown")
        result = fixture.execute(handoff, output, **options)
        self.assertTrue(result["manualReconciliationRequired"])
        self.assertFalse(result["success"])


if __name__ == "__main__":
    unittest.main()
