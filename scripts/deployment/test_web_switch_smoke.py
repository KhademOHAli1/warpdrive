"""Admission, real adapter boundaries and recovery tests; these do not qualify native Caddy."""
import copy
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import web_switch as engine
import web_switch_smoke as smoke
from test_web_switch import FakeClock, accepted, plan, runtime


def caddy_config(name="owned-web-a", generation="generation-a"):
    return {"admin": {"listen": "0.0.0.0:2019", "config": {"persist": False}},
            "apps": {"http": {"servers": {"srv0": {"listen": [":8080"], "routes": [{"handle": [
                {"handler": "request_body", "max_size": 83886080},
                {"handler": "headers", "response": {"set": {smoke.GENERATION_HEADER: [generation]}}},
                {"handler": "subroute", "routes": [{"match": [{"path": ["/_ws*"]}], "handle": [
                    {"handler": "reverse_proxy", "upstreams": [{"dial": "owned-realtime:8080"}]}]}]},
                {"handler": "reverse_proxy", "upstreams": [{"dial": name + ":3000"}],
                 "headers": {"request": {"set": {"X-Real-Ip": ["{http.request.remote.host}"]}}}},
            ]}]}}}}}


class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status, self.headers = status, headers or {}


class Opener:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class HTTPTests(unittest.TestCase):
    def test_fixed_loopback_config_path_cas_header_and_bounded_transport(self):
        opener = Opener([Response(b'{}', headers={"Etag": '"/config/ abc"'}), Response(b'', status=412)])
        ownership = []
        client = smoke.FixtureHTTP("127.0.0.1:49152", lambda: ownership.append(True), admin=True, opener=opener)
        config, etag = client.config()
        status, _, _ = client.request("PATCH", value=config, etag=etag)
        self.assertEqual(status, 412)
        self.assertEqual(len(ownership), 2)
        self.assertEqual([request.full_url for request, _ in opener.calls], ["http://127.0.0.1:49152/config/"] * 2)
        self.assertTrue(all(timeout == 4 for _, timeout in opener.calls))
        for request, _ in opener.calls:
            self.assertEqual(request.get_header("Host"), "localhost:2019")
            self.assertEqual(request.get_header("Origin"), "http://localhost:2019")
        request = opener.calls[1][0]
        self.assertEqual(request.get_method(), "PATCH")
        self.assertEqual(request.get_header("If-match"), etag)
        self.assertEqual(json.loads(request.data), {})

    def test_ownership_failure_prevents_even_reading_the_endpoint(self):
        opener = Opener([])
        def foreign():
            raise smoke.WebSwitchSmokeError("foreign owner")
        client = smoke.FixtureHTTP("127.0.0.1:49152", foreign, admin=True, opener=opener)
        with self.assertRaises(smoke.WebSwitchSmokeError):
            client.config()
        self.assertEqual(opener.calls, [])

    def test_no_arbitrary_authority_method_redirect_or_large_response_is_admitted(self):
        for authority in ("example.com:5000", "127.0.0.1:5000/path", "user@127.0.0.1:5000"):
            with self.subTest(authority=authority), self.assertRaises(smoke.SmokeError):
                smoke.FixtureHTTP(authority, lambda: None)
        client = smoke.FixtureHTTP("127.0.0.1:49152", lambda: None,
                                   opener=Opener([Response(b"x" * (smoke.MAX_HTTP_BYTES + 1))]))
        with self.assertRaises(smoke.WebSwitchSmokeError):
            client.request("POST")
        with self.assertRaises(smoke.WebSwitchSmokeError):
            client.health()
        with self.assertRaises(smoke.WebSwitchSmokeError):
            smoke.NoRedirect().redirect_request(None, None, 302, None, None, "http://example.com")


class RouteTests(unittest.TestCase):
    def test_desired_full_config_changes_only_web_upstream_and_generation(self):
        before = caddy_config()
        desired = smoke.desired_config(before, "owned-web-a", "owned-web-b", "generation-a", "generation-b")
        self.assertEqual(smoke.route_values(desired), ("owned-web-b", "generation-b"))
        self.assertEqual(smoke.desired_config(desired, "owned-web-b", "owned-web-a", "generation-b", "generation-a"), before)
        self.assertEqual(smoke.route_values(before), ("owned-web-a", "generation-a"))
        self.assertNotEqual(engine.content_hash(desired), engine.content_hash(before))

    def test_ambiguous_web_upstream_or_generation_is_rejected(self):
        for duplicate in ({"handler": "reverse_proxy", "upstreams": [{"dial": "extra:3000"}]},
                          {smoke.GENERATION_HEADER: ["generation-a"]}):
            config = caddy_config()
            config["extra"] = duplicate
            with self.assertRaises(smoke.WebSwitchSmokeError):
                smoke.desired_config(config, "owned-web-a", "owned-web-b", "generation-a", "generation-b")


class MemoryAdmin:
    def __init__(self):
        self.current = caddy_config("accepted-web")
        self.status = 200
        self.patches = []

    def config(self):
        return copy.deepcopy(self.current), '"/config/ current"'

    def request(self, method, *, value=None, etag=None):
        self.patches.append((method, copy.deepcopy(value), etag))
        if self.status == 200:
            self.current = copy.deepcopy(value)
        return self.status, {}, b""


class MemoryHarness:
    """Independent runtime/config stores let the actual adapter and controller reconcile."""
    def __init__(self):
        self.admin = MemoryAdmin()
        self.web_names = {"accepted-web", "switch-one-candidate"}
        self.runtimes = {"accepted-web": runtime()}
        self.traffic = SimpleNamespace(health=lambda: (True, smoke.route_values(self.admin.current)[1]))

    def runtime(self, name, allow_absent=False, candidate=False):
        value = self.runtimes.get(name)
        if value is None:
            if allow_absent:
                return None
            raise AssertionError("missing runtime")
        return copy.deepcopy(value)

    def unrelated(self):
        return {"postgres": {"id": "3" * 64, "restarts": 0}}

    def actual_route(self):
        name, generation = smoke.route_values(self.admin.current)
        return {"generation": generation, "fingerprint": engine.content_hash(self.admin.current),
                "runtimeId": self.runtimes[name]["runtimeId"]}

    def start_web(self, name, operation):
        self.runtimes[name] = {**runtime("2", name), "ownerOperation": operation}

    def wait_web(self, name):
        pass

    def owned(self, name):
        return self.runtimes[name]


class AdapterTests(unittest.TestCase):
    def fixture(self):
        harness = MemoryHarness()
        before = accepted()
        before["route"] = harness.actual_route()
        before["unrelatedFingerprint"] = engine.content_hash(harness.unrelated())
        value = plan(before)
        desired = smoke.desired_config(harness.admin.current, "accepted-web", value["candidateName"],
                                       before["route"]["generation"], value["desiredGeneration"])
        value["desiredRouteFingerprint"] = engine.content_hash(desired)
        return harness, before, value, desired

    def test_actual_adapter_cas_rejection_is_definite_and_preserves_active_config(self):
        harness, _, value, desired = self.fixture()
        original = copy.deepcopy(harness.admin.current)
        harness.admin.status = 412
        adapter = smoke.CaddySwitchAdapter(harness, value, desired)
        with self.assertRaises(engine.DefiniteRejected):
            adapter.apply_route(value, engine.content_hash(original))
        self.assertEqual(harness.admin.current, original)
        self.assertEqual(len(harness.admin.patches), 1)
        self.assertEqual(harness.admin.patches[0][2], '"/config/ current"')

    def test_precondition_drift_or_conflicting_plan_never_sends_patch(self):
        harness, _, value, desired = self.fixture()
        adapter = smoke.CaddySwitchAdapter(harness, value, desired)
        with self.assertRaises(engine.DefiniteRejected):
            adapter.apply_route(value, "0" * 64)
        with self.assertRaises(smoke.WebSwitchSmokeError):
            adapter.apply_route({**value, "candidateName": "foreign"}, engine.content_hash(harness.admin.current))
        self.assertEqual(harness.admin.patches, [])

    def test_real_adapter_lost_ack_after_apply_is_reconciled_by_engine_without_second_patch(self):
        harness, before, value, desired = self.fixture()
        harness.docker = SimpleNamespace(run=lambda *args, **kwargs: SimpleNamespace(returncode=0))
        adapter = smoke.CaddySwitchAdapter(harness, value, desired, lose_ack=True)
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine.initialize_rehearsal(root, before, adapter)
            original = (root / "accepted.json").read_bytes()
            with self.assertRaises(engine.SwitchUnknown):
                engine.rehearse_web_switch(value, state_dir=root, adapter=adapter, clock=clock.monotonic, sleep=clock.sleep)
            self.assertEqual((root / "accepted.json").read_bytes(), original)
            self.assertEqual(harness.admin.current, desired)
            result = engine.rehearse_web_switch(value, state_dir=root, adapter=adapter, clock=clock.monotonic, sleep=clock.sleep)
            self.assertEqual(result["state"], "COMPLETED")
            self.assertEqual((adapter.created, adapter.patch_attempts), (1, 1))
            self.assertEqual(len(harness.admin.patches), 1)

    def test_route_runtime_identity_comes_from_active_upstream_not_a_plan_id(self):
        harness, _, value, desired = self.fixture()
        harness.runtimes[value["candidateName"]] = {**runtime("7", value["candidateName"]), "ownerOperation": value["operationId"]}
        harness.admin.current = desired
        adapter = smoke.CaddySwitchAdapter(harness, value, desired)
        observed = adapter.observe_route(value)
        self.assertEqual(observed["runtimeId"], "7" * 64)
        self.assertEqual(observed["fingerprint"], engine.content_hash(desired))
        self.assertTrue(observed["healthy"])


class DockerRuntimeIdentityTests(unittest.TestCase):
    def fixture(self):
        names = ("owned-web-a", "owned-web-rejected")
        rows = {}
        for index, name in enumerate(names, 1):
            rows[name] = {"Id": str(index) * 64, "Name": "/" + name, "Image": "sha256:" + "a" * 64,
                          "Config": {"Hostname": str(index) * 12, "Image": "sha256:" + "a" * 64,
                                     "Cmd": ["bun", "--bun", "next", "start"], "Entrypoint": ["/usr/local/bin/docker-entrypoint.sh"],
                                     "Env": ["NODE_ENV=production", "PRIVATE_CONFIG_VALUE=not-for-evidence"],
                                     "User": "bun", "WorkingDir": "/app", "Labels": {smoke.OWNER_LABEL: "owned", "org.opencontainers.image.revision": "a" * 40}},
                          "HostConfig": {"Memory": 1536 * smoke.MIB, "MemorySwap": 1536 * smoke.MIB,
                                         "NanoCpus": 1_000_000_000, "PidsLimit": 192, "NetworkMode": "owned-network",
                                         "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges"], "ReadonlyRootfs": False},
                          "Mounts": [], "RestartCount": 0, "State": {"Running": True, "OOMKilled": False, "Paused": index == 2}}
        rows[names[1]]["Config"]["Labels"][smoke.OPERATION_LABEL] = "rejected-readiness"
        def run(arguments, **options):
            return SimpleNamespace(returncode=0, stdout=json.dumps([rows[arguments[2]]]))
        harness = smoke.WebSwitchSmoke(SimpleNamespace(run=run), Path("unused"), "a" * 40, Path("unused"))
        harness.fixture = SimpleNamespace(prefix="owned")
        harness.web_names = set(names)
        harness.web_image = "sha256:" + "a" * 64
        harness.schema = lambda: "d" * 64
        harness.unrelated = lambda: {"worker": {"id": "3" * 64, "restarts": 0}}
        before = accepted()
        before["runtime"] = harness.runtime(names[0])
        before["route"]["runtimeId"] = before["runtime"]["runtimeId"]
        before["unrelatedFingerprint"] = engine.content_hash(harness.unrelated())
        harness.actual_route = lambda: copy.deepcopy(before["route"])
        value = plan(before, "rejected-readiness")
        value["candidateName"] = names[1]
        adapter = smoke.CaddySwitchAdapter(harness, value, {})
        return harness, rows, before, value, adapter

    def test_actual_docker_shapes_keep_same_config_across_owned_names_labels_and_pause_state(self):
        harness, rows, before, value, adapter = self.fixture()
        candidate = engine._inspect(adapter, before, value, route=before["route"])
        self.assertEqual(candidate["configSha256"], before["runtime"]["configSha256"])
        self.assertNotEqual(candidate["runtimeId"], before["runtime"]["runtimeId"])
        self.assertEqual(candidate["ownerOperation"], value["operationId"])
        self.assertTrue(rows[value["candidateName"]]["State"]["Paused"])
        self.assertNotIn("identityDiagnostics", harness.report)

    def test_unique_environment_permutation_retains_exact_config_identity_and_safe_native_evidence(self):
        harness, rows, before, value, adapter = self.fixture()
        rows[value["candidateName"]]["Config"]["Env"].reverse()
        candidate = engine._inspect(adapter, before, value, route=before["route"])
        self.assertEqual(candidate["configSha256"], before["runtime"]["configSha256"])
        evidence = harness.report["environmentComparisons"][value["candidateName"]]
        self.assertEqual(evidence, {"entryCount": 2, "sameUniqueEntriesAsInitial": True, "sameEntryOrderAsInitial": False,
                                    "sameNonEnvironmentConfigurationAsInitial": True})
        self.assertNotIn("not-for-evidence", json.dumps(harness.report))
        self.assertNotIn("identityDiagnostics", harness.report)

    def test_environment_canonicalization_never_discards_duplicate_names_or_invalid_bindings(self):
        for entries in (None, {}, [None], ["MISSING_VALUE"], ["=empty-name"], ["A=one", "A=two"],
                        ["A=same", "A=same"], ["A=bad\0value"], ["A=" + "x" * 65536]):
            with self.subTest(entries=entries), self.assertRaises(smoke.WebSwitchSmokeError):
                smoke.canonical_environment(entries)
        self.assertEqual(smoke.canonical_environment(["Z=one=two", "A=", "a= whitespace "]),
                         ["A=", "Z=one=two", "a= whitespace "])

    def test_changed_value_after_permutation_still_rejects_candidate(self):
        harness, rows, before, value, adapter = self.fixture()
        rows[value["candidateName"]]["Config"]["Env"] = ["PRIVATE_CONFIG_VALUE=actually-changed", "NODE_ENV=production"]
        with self.assertRaises(engine.SwitchConflict):
            engine._inspect(adapter, before, value, route=before["route"])
        evidence = harness.report["environmentComparisons"][value["candidateName"]]
        self.assertFalse(evidence["sameUniqueEntriesAsInitial"])
        self.assertNotIn("actually-changed", json.dumps(harness.report))

    def test_added_removed_or_empty_environment_value_changes_still_reject_candidate(self):
        for entries in (["NODE_ENV=production"], ["NODE_ENV=production", "PRIVATE_CONFIG_VALUE="],
                        ["NODE_ENV=production", "PRIVATE_CONFIG_VALUE=not-for-evidence", "EXTRA="]):
            harness, rows, before, value, adapter = self.fixture()
            rows[value["candidateName"]]["Config"]["Env"] = entries
            with self.subTest(entries=entries), self.assertRaises(engine.SwitchConflict):
                engine._inspect(adapter, before, value, route=before["route"])

    def test_command_entrypoint_and_mount_drift_remain_order_sensitive(self):
        for field in ("Cmd", "Entrypoint", "Mounts"):
            harness, rows, before, value, adapter = self.fixture()
            candidate = rows[value["candidateName"]]
            if field == "Cmd":
                candidate["Config"][field].reverse()
            elif field == "Entrypoint":
                candidate["Config"][field].append("different-entrypoint")
            else:
                candidate[field].append({"Type": "tmpfs", "Destination": "/extra"})
            with self.subTest(field=field), self.assertRaises(engine.SwitchConflict):
                engine._inspect(adapter, before, value, route=before["route"])
            self.assertFalse(harness.report["environmentComparisons"][value["candidateName"]]["sameNonEnvironmentConfigurationAsInitial"])

    def test_real_environment_and_memory_drift_still_reject_with_only_hashes_and_field_paths(self):
        for section in ("environment", "memory"):
            harness, rows, before, value, adapter = self.fixture()
            if section == "environment":
                rows[value["candidateName"]]["Config"]["Env"][1] = "PRIVATE_CONFIG_VALUE=changed-not-for-evidence"
                path = "Config.Env[1]"
            else:
                rows[value["candidateName"]]["HostConfig"]["Memory"] += smoke.MIB
                path = "HostConfig.Memory"
            with self.subTest(section=section), self.assertRaises(engine.SwitchConflict):
                engine._inspect(adapter, before, value, route=before["route"])
            diagnostic = harness.report["identityDiagnostics"][-1]
            self.assertIn("configSha256", diagnostic["candidateChangedFields"])
            self.assertEqual(diagnostic["candidateConfigChangedFields"], [path])
            self.assertNotEqual(diagnostic["expectedConfigSha256"], diagnostic["observedConfigSha256"])
            self.assertNotIn("not-for-evidence", json.dumps(diagnostic))

    def test_owner_or_schema_mismatch_is_not_hidden_by_config_normalization(self):
        for field in ("owner", "schema"):
            harness, rows, before, value, adapter = self.fixture()
            if field == "owner":
                rows[value["candidateName"]]["Config"]["Labels"][smoke.OPERATION_LABEL] = "foreign-owner-not-for-evidence"
                path = "ownerOperation"
            else:
                snapshots = iter(["e" * 64, "d" * 64])
                harness.schema = lambda: next(snapshots)
                path = "schemaSha256"
            with self.subTest(field=field), self.assertRaises(engine.SwitchConflict):
                engine._inspect(adapter, before, value, route=before["route"])
            diagnostic = harness.report["identityDiagnostics"][-1]
            self.assertIn(path, diagnostic["candidateChangedFields"])
            self.assertNotIn("not-for-evidence", json.dumps(diagnostic))


class OwnershipAndEvidenceTests(unittest.TestCase):
    def test_cause_chain_keeps_fixed_identity_guard_but_never_raw_secret_messages(self):
        inner = engine.SwitchConflict("candidate differs from owned same-version plan")
        outer = engine.SwitchUnknown("candidate creation could not be independently reconciled")
        outer.__cause__ = inner
        self.assertEqual(smoke.safe_causes(outer), [
            {"type": "SwitchUnknown", "message": "candidate creation could not be independently reconciled"},
            {"type": "SwitchConflict", "message": "candidate differs from owned same-version plan"},
        ])
        raw = RuntimeError("credential=private-do-not-retain")
        outer.__cause__ = raw
        causes = smoke.safe_causes(outer)
        self.assertEqual(causes[-1], {"type": "RuntimeError"})
        self.assertNotIn("private-do-not-retain", json.dumps(causes))
        for _ in range(6):
            next_error = RuntimeError("private-do-not-retain")
            raw.__cause__ = next_error
            raw = next_error
        self.assertEqual(len(smoke.safe_causes(outer)), 4)
        raw.__cause__ = raw
        self.assertEqual(smoke.safe_causes(raw), [{"type": "RuntimeError"}])

    def test_native_memory_budget_charges_every_overlap_limit_and_one_gib_reserve(self):
        required = sum(smoke.MEMORY_LIMITS_MIB.values()) * smoke.MIB + 1024 ** 3
        admitted = smoke.memory_budget(f"MemTotal: 16777216 kB\nMemAvailable: {required // 1024} kB\n")
        self.assertTrue(admitted["admitted"])
        self.assertEqual(admitted["requiredBytes"], required)
        self.assertEqual(admitted["hostReserveBytes"], 1024 ** 3)
        self.assertEqual(admitted["configuredPeakLimitsBytes"]["web-rejected"], 1536 * smoke.MIB)
        self.assertEqual(len(admitted["configuredPeakLimitsBytes"]), 9)
        held = smoke.memory_budget(f"MemAvailable: {required // 1024 - 1} kB\n")
        self.assertFalse(held["admitted"])
        self.assertEqual(held["requiredBytes"], required)

    def test_unknown_ambiguous_or_wrong_unit_host_memory_cannot_be_admitted(self):
        for text in ("", "MemTotal: 99999999 kB\n", "MemAvailable: 0 kB\n", "MemAvailable: 123 MB\n",
                     "MemAvailable: 123 kB\nMemAvailable: 456 kB\n", "MemAvailable: 123 kB\nMemAvailable: unknown\n"):
            with self.subTest(text=text), self.assertRaises(smoke.WebSwitchSmokeError):
                smoke.memory_budget(text)

    def test_insufficient_native_memory_blocks_before_any_fixture_creation(self):
        created = []
        harness = smoke.WebSwitchSmoke(object(), Path("unused"), "a" * 40, Path("unused"))
        harness.fixture = SimpleNamespace(create_environment=lambda: created.append(True))
        with patch.object(smoke.sys, "platform", "linux"), \
                patch.object(Path, "open", return_value=io.StringIO("MemAvailable: 1024 kB\n")):
            with self.assertRaisesRegex(smoke.WebSwitchSmokeError, "fixture peak limits"):
                harness.setup()
        self.assertEqual(created, [])
        self.assertFalse(harness.report["memoryAdmission"]["admitted"])
        self.assertEqual(harness.report["memoryAdmission"]["availableBytes"], 1024 ** 2)

    def test_cgroup_peak_unknown_is_explicitly_null_instead_of_zero(self):
        self.assertEqual(smoke.memory_peak(SimpleNamespace(returncode=0, stdout="123456\n")),
                         {"status": "observed", "bytes": 123456})
        for result in (SimpleNamespace(returncode=1, stdout=""), SimpleNamespace(returncode=0, stdout="unsupported")):
            self.assertEqual(smoke.memory_peak(result), {"status": "unavailable", "bytes": None})

    def test_caddy_storage_requires_both_bounded_tmpfs_and_rejects_any_volume_mount(self):
        expected = {item.split(":", 1)[0]: item.split(":", 1)[1] for item in smoke.CADDY_TMPFS}
        row = {"HostConfig": {"ReadonlyRootfs": True, "Tmpfs": expected},
               "Mounts": [{"Type": "bind", "Destination": "/etc/caddy/Caddyfile", "RW": False},
                          {"Type": "tmpfs", "Destination": "/data"}, {"Type": "tmpfs", "Destination": "/config"}]}
        self.assertEqual(smoke.caddy_storage(row)["anonymousVolumeMounts"], 0)
        self.assertEqual(set(smoke.caddy_storage(row)["boundedTmpfs"]), {"/data", "/config"})
        missing = copy.deepcopy(row)
        del missing["HostConfig"]["Tmpfs"]["/config"]
        unbounded = copy.deepcopy(row)
        unbounded["HostConfig"]["Tmpfs"]["/data"] = "rw"
        volume = copy.deepcopy(row)
        volume["Mounts"].append({"Type": "volume", "Destination": "/anonymous"})
        for invalid in (missing, unbounded, volume):
            with self.subTest(row=invalid), self.assertRaises(smoke.WebSwitchSmokeError):
                smoke.caddy_storage(invalid)

    def test_image_volume_declarations_are_checked_before_creating_caddy(self):
        calls = []
        image = {"Id": "sha256:" + "a" * 64, "Os": "linux", "Architecture": "amd64",
                 "Config": {"Volumes": {"/data": {}, "/config": {}}}}
        def run(arguments, **options):
            calls.append(arguments)
            return SimpleNamespace(returncode=0, stdout=json.dumps([image]))
        docker = SimpleNamespace(run=run)
        self.assertEqual(smoke.caddy_image(docker), image["Id"])
        image["Config"]["Volumes"]["/unexpected"] = {}
        with self.assertRaises(smoke.WebSwitchSmokeError):
            smoke.caddy_image(docker)
        self.assertEqual(calls, [["image", "inspect", "caddy:2-alpine"]] * 2)

    def test_generated_admin_origin_matches_fixed_client_host_without_wildcard_origin(self):
        generated = smoke.fixture_caddyfile("owned-web-a", "owned-realtime")
        self.assertIn("origins localhost:2019\n enforce_origin", generated)
        self.assertNotIn("origins *", generated)
        self.assertIn("persist_config off", generated)

    def test_foreign_container_metadata_cannot_be_used_for_runtime_or_route_proof(self):
        row = {"Id": "1" * 64, "Name": "/owned-web-a", "Config": {"Labels": {smoke.OWNER_LABEL: "foreign"}}}
        docker = SimpleNamespace(run=lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=json.dumps([row])))
        harness = smoke.WebSwitchSmoke(docker, Path("unused"), "a" * 40, Path("unused"))
        harness.fixture = SimpleNamespace(prefix="owned")
        with self.assertRaises(smoke.WebSwitchSmokeError):
            harness.owned("owned-web-a")

    def test_native_case_failure_and_cleanup_failure_cannot_be_reported_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "result"
            harness = smoke.WebSwitchSmoke(object(), Path("unused"), "a" * 40, root)
            harness.fixture = SimpleNamespace(failure_diagnostics=lambda: [], cleanup=lambda: ["owned cleanup failed"])
            def fail():
                raise smoke.WebSwitchSmokeError("native fixture did not pass")
            harness.load = fail
            self.assertFalse(harness.run())
            report = json.loads((root / "report.json").read_text())
            self.assertEqual(report["failure"], "native fixture did not pass")
            self.assertFalse(report["cleanup"]["success"])
            self.assertEqual(report["checks"], [{"name": "verified-native-tested-bundle", "status": "failed"}])
            with self.assertRaises(FileExistsError):
                harness.run()


if __name__ == "__main__":
    unittest.main()
