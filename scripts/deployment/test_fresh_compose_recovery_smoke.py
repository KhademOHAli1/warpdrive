"""Daemon-free failure regressions; these do not qualify native Docker recovery."""

from copy import deepcopy
from hashlib import sha256
from itertools import permutations
import json
from pathlib import Path
import shutil
import stat
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import fresh_compose_recovery_smoke as smoke
from fresh_compose_admission import IMAGES
from fresh_compose_smoke import FreshSmoke, LONG_RUNNING
from image_smoke import SmokeError
import recovery as r
from test_recovery import FakeRestic, Fixture, put
from web_switch import SwitchConflict


def references():
    baseline = {service: "example.invalid/" + service + "@sha256:" + f"{index:064x}"
                for index, names in enumerate(IMAGES.values(), 1) for service in names}
    return baseline, {**baseline, "app": "example.invalid/new-web@sha256:" + "a" * 64}


def runtime_rows(services, *, running=True):
    return {name: {"Id": f"{index:064x}", "Image": "sha256:" + f"{index + 30:064x}", "RestartCount": 0,
                   "Name": "/fixture-" + name, "State": {"Running": running and name in LONG_RUNNING,
                   "Status": "running" if running and name in LONG_RUNNING else "exited", "ExitCode": 0,
                   "Paused": False, "Restarting": False, "Dead": False, "OOMKilled": False,
                   "Pid": index if running and name in LONG_RUNNING else 0, "Error": "",
                   "FinishedAt": "" if running and name in LONG_RUNNING else "2026-11-14T00:01:00Z",
                   "StartedAt": "2026-11-14T00:00:00Z", "Health": {"Status": "healthy"}},
                   "Config": {"Hostname": name, "Env": ["FIXTURE_ONLY=true"]},
                   "HostConfig": {"PortBindings": {}}, "Mounts": []}
            for index, name in enumerate(sorted(services), 1)}


class RecoveryCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory(prefix="wd-cold-unit-"))).resolve()
        self.baseline, self.candidate = references()

    def test_non_native_host_is_refused_before_files_or_docker(self):
        with patch("fresh_compose_smoke.platform.system", return_value="Darwin"), patch.object(smoke, "FixtureDocker") as docker:
            with self.assertRaisesRegex(SwitchConflict, "Linux AMD64 host"):
                smoke.run(self.baseline, self.candidate, restic=Path("/missing"), restic_pin="a" * 64,
                          pg_control=Path("/missing-pg"), pg_control_pin="b" * 64, output_parent=self.directory)
        docker.assert_not_called()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_invalid_recovery_storage_client_is_refused_before_native_admission(self):
        with patch.object(smoke, "_native_root_host") as host, patch.object(smoke, "FixtureDocker") as docker:
            with self.assertRaisesRegex(SwitchConflict, "must be mc or mcli"):
                smoke.run(self.baseline, self.candidate, restic=Path("/missing"), restic_pin="a" * 64,
                          pg_control=Path("/missing-pg"), pg_control_pin="b" * 64, output_parent=self.directory,
                          storage_client_bin="sh --unreviewed")
        host.assert_not_called()
        docker.assert_not_called()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_invalid_recovery_parent_is_refused_before_native_admission(self):
        with patch.object(smoke, "_native_root_host") as host, patch.object(smoke, "FixtureDocker") as docker:
            with self.assertRaisesRegex(SwitchConflict, "flat unique"):
                smoke.run(self.baseline, self.candidate, restic=Path("/missing"), restic_pin="a" * 64,
                          pg_control=Path("/missing-pg"), pg_control_pin="b" * 64, output_parent=self.directory,
                          cgroup_parent="system.slice")
        host.assert_not_called()
        docker.assert_not_called()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_pin_changes_are_detected_before_and_after_a_command(self):
        executable = self.directory / "tool"
        put(executable, b"fixture-executable", 0o700)
        pin = sha256(executable.read_bytes()).hexdigest()
        command = smoke.PinnedCommand({executable: pin})
        with patch.object(r.Command, "_run", return_value=b"ok") as run:
            self.assertEqual(command.run([str(executable), "version"]), b"ok")
            put(executable, b"changed-executable", 0o700)
            with self.assertRaisesRegex(r.RecoveryError, "differs"):
                command.run([str(executable), "version"])
        run.assert_called_once()
        put(executable, b"fixture-executable", 0o700)
        with patch.object(r.Command, "_run", side_effect=lambda *_args, **_kwargs: put(executable, b"changed", 0o700)):
            with self.assertRaisesRegex(r.RecoveryError, "differs"):
                command.run([str(executable), "version"])

    def test_cold_docker_keeps_binary_pins_around_owned_process_execution(self):
        executable = self.directory / "docker-fixture"
        put(executable, b"fixture-docker", 0o700)
        pin = sha256(executable.read_bytes()).hexdigest()
        result = SimpleNamespace(returncode=0, stdout="fixture")
        options = {"timeout": 2, "capture_output": True, "text": True, "check": False, "env": {}}
        with patch.object(smoke.IsolatedDocker, "__init__", return_value=None) as initialize, \
                patch.object(smoke, "run_owned_fixture_command", return_value=result) as owned:
            smoke.FixtureDocker(self.directory / "docker", executable, pin)
            runner = initialize.call_args.kwargs["runner"]
            self.assertIs(runner(["docker", "version"], **options), result)
            owned.assert_called_once_with([str(executable), "version"], **options)
            put(executable, b"changed-docker", 0o700)
            with self.assertRaisesRegex(r.RecoveryError, "differs"):
                runner(["docker", "version"], **options)
            self.assertEqual(owned.call_count, 1)
            put(executable, b"fixture-docker", 0o700)
            owned.side_effect = lambda *_args, **_kwargs: put(executable, b"changed-after-launch", 0o700)
            with self.assertRaisesRegex(r.RecoveryError, "differs"):
                runner(["docker", "version"], **options)

    def test_observer_uses_actual_explicit_context_and_same_local_endpoint(self):
        binary, pg = Path("/fixture/docker"), Path("/fixture/pg_controldata")
        pins = {binary: "a" * 64, pg: "b" * 64}
        with patch.object(smoke.PinnedCommand, "_run", return_value=b"[]") as command:
            observer = smoke.ObserverCommand(SimpleNamespace(endpoint="unix:///fixture/docker.sock"), binary, pg, pins,
                                             self.directory / "observer-config")
            observer.run([str(binary), "context", "inspect"])
            observer.run([str(binary), "ps", "-aq"])
            observer.run([str(pg), "--version"])
        calls = [item.args[0] for item in command.call_args_list]
        self.assertEqual(calls[0], [str(binary), "--config", str(self.directory / "observer-config"), "context", "create",
                                    "warpdrive-recovery", "--docker", "host=unix:///fixture/docker.sock"])
        self.assertEqual(calls[1][-3:], ["context", "inspect", "warpdrive-recovery"])
        self.assertEqual(calls[2][-4:], ["--host", "unix:///fixture/docker.sock", "ps", "-aq"])
        self.assertEqual(calls[3], [str(pg), "--version"])

    def test_clean_stop_uses_exact_ids_in_ingress_workload_storage_order(self):
        rows = runtime_rows(self.baseline)
        docker = Mock()

        def stop(arguments, **_options):
            selected = next(row for row in rows.values() if row["Id"] == arguments[-1])
            selected["State"].update(Running=False, Status="exited", Pid=0, FinishedAt="2026-11-14T00:01:00Z")
        docker.run.side_effect = stop
        fixture = SimpleNamespace(docker=docker, _ready_rows=Mock(return_value=deepcopy(rows)),
                                  _rows=lambda: deepcopy(rows), _witness=FreshSmoke._witness,
                                  project="fresh-unit", receipt={"checks": {}})
        observed = smoke._stop(fixture)
        expected = [service for wave in smoke.STOP_WAVES for service in wave]
        self.assertEqual([item.args[0][-1] for item in docker.run.call_args_list], [rows[name]["Id"] for name in expected])
        worker = docker.run.call_args_list[expected.index("worker")]
        self.assertEqual(worker.args[0][1:3], ["--time", "75"])
        self.assertEqual(worker.kwargs["timeout"], 85)
        self.assertTrue(all(not row["State"]["Running"] for row in observed.values()))

    def test_cold_stop_accepts_only_pinned_next143_and_reports_actual_status(self):
        rows = runtime_rows(self.baseline)
        app = rows["app"]
        revision, project = "a" * 40, "fresh-unit"
        app["Config"].update(User="bun", WorkingDir="/app", Cmd=list(r.NEXT_WEB_COMMAND),
            Entrypoint=["/usr/local/bin/docker-entrypoint.sh"],
            Labels={"com.docker.compose.project": project, "com.docker.compose.service": "app",
                    "org.opencontainers.image.revision": revision},
            Env=["APP_COMMIT=" + revision, "NEXT_DEPLOYMENT_ID=wd-" + revision])
        fixture = SimpleNamespace(docker=Mock(), _ready_rows=Mock(return_value=deepcopy(rows)),
            _rows=lambda: deepcopy(rows), _witness=FreshSmoke._witness, project=project, receipt={"checks": {}},
            images={"baseline": {"app": app["Image"]}}, revisions={"baseline": revision})

        def stop(arguments, **_options):
            row = next(row for row in rows.values() if row["Id"] == arguments[-1])
            row["State"].update(Running=False, Status="exited", Pid=0, FinishedAt="2026-11-14T00:01:00Z",
                                ExitCode=143 if row is app else 0)

        fixture.docker.run.side_effect = stop
        observed = smoke._stop(fixture)
        self.assertEqual(observed["app"]["State"]["ExitCode"], 143)
        self.assertEqual(fixture.receipt["checks"]["coldStop"]["app"], {"exitCode": 143, "contract": r.NEXT_WEB_STOP_KIND})

    def test_cold_stop_rejects_wrong143_command_service_revision_and_other_nonzero(self):
        for change, code, service in (("command", 143, "app"), ("revision", 143, "app"),
                                      ("service", 143, "worker"), ("crash", 137, "app"), ("error", 2, "app")):
            rows = runtime_rows(self.baseline)
            app = rows["app"]
            revision, project = "a" * 40, "fresh-unit"
            app["Config"].update(User="bun", WorkingDir="/app", Cmd=list(r.NEXT_WEB_COMMAND),
                Entrypoint=["/usr/local/bin/docker-entrypoint.sh"],
                Labels={"com.docker.compose.project": project, "com.docker.compose.service": "app",
                        "org.opencontainers.image.revision": "b" * 40 if change == "revision" else revision},
                Env=["APP_COMMIT=" + revision, "NEXT_DEPLOYMENT_ID=wd-" + revision])
            if change == "command":
                app["Config"]["Cmd"] = ["bun", "unreviewed.mjs"]
            fixture = SimpleNamespace(docker=Mock(), _ready_rows=Mock(return_value=deepcopy(rows)),
                _rows=lambda: deepcopy(rows), _witness=FreshSmoke._witness, project=project, receipt={"checks": {}},
                images={"baseline": {"app": app["Image"]}}, revisions={"baseline": revision})

            def stop(arguments, **_options):
                row = next(row for row in rows.values() if row["Id"] == arguments[-1])
                row["State"].update(Running=False, Status="exited", Pid=0, FinishedAt="2026-11-14T00:01:00Z",
                                    ExitCode=code if row is rows[service] else 0)

            fixture.docker.run.side_effect = stop
            with self.subTest(change=change), self.assertRaises(r.RecoveryError):
                smoke._stop(fixture)
            self.assertTrue(rows["postgres"]["State"]["Running"])

    def test_lost_stop_acknowledgement_is_not_retried_and_storage_stays_running(self):
        rows = runtime_rows(self.baseline)
        fixture = SimpleNamespace(docker=Mock(), _ready_rows=Mock(return_value=deepcopy(rows)),
                                  _rows=lambda: deepcopy(rows), _witness=FreshSmoke._witness)
        fixture.docker.run.side_effect = SmokeError("unknown stop outcome; fixture secret must stay private")
        with self.assertRaises(SmokeError):
            smoke._stop(fixture)
        fixture.docker.run.assert_called_once()
        self.assertTrue(rows["postgres"]["State"]["Running"])

    def test_frozen_plan_has_exact_five_volumes_and_configuration(self):
        fixture = FreshSmoke(Mock(), self.directory, self.baseline, self.candidate)
        source = self.directory / "frozen.yml"
        put(source, b"synthetic frozen configuration")
        fixture.configuration_pins = {source: sha256(source.read_bytes()).hexdigest()}
        plan = smoke._plan(fixture, runtime_rows(self.baseline, running=False), "e" * 64)
        self.assertEqual(set(plan["volumes"]), set(r.VOLUMES))
        self.assertEqual(plan["configurationFiles"], [str(self.directory)])
        put(source, b"changed")
        with self.assertRaisesRegex(SwitchConflict, "configuration changed"):
            smoke._plan(fixture, runtime_rows(self.baseline, running=False), "e" * 64)

    def test_writer_key_is_removed_only_after_exact_slot_revocation_and_password_rejection(self):
        writer, reader = self.directory / "writer", self.directory / "reader"
        put(reader, b"synthetic-reader-password-" + b"b" * 32 + b"\n")
        for outcome in (0, 4, 12):
            put(writer, b"synthetic-writer-password-" + b"a" * 32 + b"\n")
            responses = [b"", b"{}" if outcome == 0 else r.RecoveryCommandFailure(outcome)]
            with patch.object(smoke, "_key_command", side_effect=responses), \
                    patch.object(smoke, "_key_slots", return_value=({"b" * 64}, "b" * 64)):
                if outcome == 12:
                    smoke._revoke_writer(Mock(), Path("/fixture/restic"), self.directory / "repository", writer, reader, "a" * 64)
                    self.assertFalse(writer.exists())
                else:
                    with self.assertRaises(r.RecoveryError):
                        smoke._revoke_writer(Mock(), Path("/fixture/restic"), self.directory / "repository", writer, reader, "a" * 64)
                    self.assertTrue(writer.exists())

    def test_unresolved_or_foreign_volume_creation_never_advances_to_another_volume(self):
        fixture = FreshSmoke(Mock(), self.directory, self.baseline, self.candidate)
        fixture._require_empty = Mock()
        fixture._verify_volume = Mock()
        plan = {"volumes": {role: fixture.project + "_" + logical for role, logical in r.VOLUMES.items()}}
        fixture.docker.json.return_value = {"OSType": "linux", "DockerRootDir": str(self.directory)}
        fixture.docker.run.side_effect = SmokeError("unknown create outcome")
        with self.assertRaises(SmokeError):
            smoke._volume_roots(fixture, plan)
        fixture.docker.run.assert_called_once()
        fixture._verify_volume.assert_not_called()
        fixture.docker.run.reset_mock(side_effect=True)
        name = plan["volumes"]["postgres"]
        fixture.docker.run.return_value.stdout = name
        fixture.docker.json.side_effect = [{"OSType": "linux", "DockerRootDir": str(self.directory)},
            [{"Name": name, "Driver": "local", "Scope": "local", "Options": {},
              "Labels": {smoke.OWNER: "foreign-project", "com.docker.compose.volume": "pgdata"},
              "Mountpoint": str(self.directory / "volume/_data")}]]
        with self.assertRaisesRegex(r.RecoveryError, "authority differs"):
            smoke._volume_roots(fixture, plan)
        fixture.docker.run.assert_called_once()
        fixture._verify_volume.assert_not_called()

    def _restored_tree(self, *, name="", directory_mode=0o755, file_mode=0o640):
        directory = self.directory / name
        root = directory / "source" / "volume"
        put(root / "nested" / "private.data", b"captured synthetic bytes", file_mode)
        (root / "nested").chmod(directory_mode)
        inventory = r.scan([root], smoke.CAPTURE_LIMITS)
        quarantine = directory / "quarantine"
        quarantine.mkdir(mode=0o700)
        archived = quarantine / str(root).lstrip("/")
        shutil.copytree(root, archived)
        shutil.rmtree(root)
        root.mkdir(mode=0o700)
        return root, quarantine, inventory, archived

    def test_materialization_preserves_verified_bytes_modes_and_ownership(self):
        root, quarantine, inventory, _ = self._restored_tree()
        smoke._copy_verified_root(quarantine, root, inventory)
        self.assertEqual(r.scan([root], smoke.CAPTURE_LIMITS, single_link=True), inventory)
        self.assertEqual(stat.S_IMODE((root / "nested/private.data").stat().st_mode), 0o640)

    def test_materialization_preserves_actual_caddy_sticky_directory(self):
        root, quarantine, inventory, _ = self._restored_tree(directory_mode=0o1777)
        smoke._copy_verified_root(quarantine, root, inventory)
        self.assertEqual(r.scan([root], smoke.CAPTURE_LIMITS, single_link=True), inventory)
        self.assertEqual(stat.S_IMODE((root / "nested").stat().st_mode), 0o1777)

    def test_materialization_rejects_setid_and_special_file_permissions(self):
        for index, (directory_mode, file_mode) in enumerate(((0o755, 0o1777), (0o4755, 0o640),
                (0o2755, 0o640), (0o755, 0o4640), (0o755, 0o2640))):
            with self.subTest(directory_mode=oct(directory_mode), file_mode=oct(file_mode)):
                root, quarantine, inventory, _ = self._restored_tree(name=str(index),
                    directory_mode=directory_mode, file_mode=file_mode)
                with self.assertRaisesRegex(r.RecoveryError, "Only directory sticky"):
                    smoke._copy_verified_root(quarantine, root, inventory)

    def test_materialization_refuses_aliases_changed_bytes_and_nonempty_destination(self):
        root, quarantine, inventory, archived = self._restored_tree()
        outside = self.directory / "unrelated"
        put(outside, b"keep unrelated bytes", 0o640)
        leaf = archived / "nested/private.data"
        leaf.unlink()
        leaf.symlink_to(outside)
        with self.assertRaises(OSError):
            smoke._copy_verified_root(quarantine, root, inventory)
        self.assertEqual(outside.read_bytes(), b"keep unrelated bytes")
        shutil.rmtree(root)
        root.mkdir(mode=0o700)
        leaf.unlink()
        put(leaf, b"wrong synthetic content", 0o640)
        with self.assertRaisesRegex(r.RecoveryError, "Quarantine"):
            smoke._copy_verified_root(quarantine, root, inventory)
        with self.assertRaisesRegex(r.RecoveryError, "must be empty"):
            smoke._copy_verified_root(quarantine, root, inventory)

    def _restart_fixture(self):
        fixture = smoke.RecoveryFixture(Mock(), self.directory, self.baseline, self.candidate)
        before = runtime_rows(self.baseline, running=False)
        rows = {name: deepcopy(before[name]) for name in LONG_RUNNING}
        for index, row in enumerate(rows.values(), 100):
            row["Id"] = f"{index:064x}"
            row["Config"]["Hostname"] = "new-container-identity"
            row["State"]["Status"] = "created"
        fixture.compose = Mock()
        fixture._rows = lambda: deepcopy(rows)
        fixture._verify_volume = Mock()
        fixture._baseline_readiness = Mock(return_value={"workerFileReaperCompleted": True, "realtimeCloseCode": 4401})
        fixture._observe = Mock(return_value=({}, {"rows": 119, "sha256": "d" * 64}))

        def command(arguments, **_options):
            if arguments[0] == "start":
                row = next(row for row in rows.values() if row["Id"] == arguments[1])
                row["State"].update(Running=True, Status="running")
            return SimpleNamespace(returncode=0)
        fixture.docker.run.side_effect = command
        inventory = r.scan([self.directory], smoke.CAPTURE_LIMITS)
        return fixture, before, rows, inventory

    def test_restart_never_replays_initializers_and_uses_full_captured_image_topology(self):
        fixture, before, rows, inventory = self._restart_fixture()
        with patch.object(smoke, "owned_bridge_forwarder"), patch.object(smoke, "_media"):
            result = smoke._restart(fixture, before, {"rows": 119, "sha256": "d" * 64}, inventory, smoke.CAPTURE_LIMITS)
        calls = [item.args for item in fixture.compose.call_args_list]
        prefix = ("baseline", "up", "--no-start", "--no-deps", "--no-build", "--pull", "never")
        self.assertEqual(calls, [(*prefix, "postgres", "minio"),
            (*prefix, "app", "ws", "worker", "newsletter-engine", "caddy")])
        self.assertEqual([service for args in calls for service in args[7:]],
                         [service for group in smoke.CREATE_WAVES for service in group])
        self.assertEqual({service for args in calls for service in args[7:]}, LONG_RUNNING)
        starts = [item.args[0][1] for item in fixture.docker.run.call_args_list if item.args[0][0] == "start"]
        self.assertEqual(starts, [rows[service]["Id"] for wave in smoke.START_WAVES for service in wave])
        self.assertFalse(result["initializationServicesReplayed"])
        self.assertTrue(result["migrationLedgerUnchanged"])

    def test_recreated_baseline_replace_label_can_be_absent_from_fresh_restore(self):
        fixture, before, rows, inventory = self._restart_fixture()
        labels = {smoke.OWNER: fixture.project, "com.docker.compose.service": "app",
                  "com.docker.compose.config-hash": "frozen-baseline-configuration"}
        before["app"]["Config"]["Labels"] = {**labels, "com.docker.compose.replace": "f" * 64}
        rows["app"]["Config"]["Labels"] = dict(labels)
        captured = deepcopy(before["app"])
        with patch.object(smoke, "owned_bridge_forwarder"), patch.object(smoke, "_media"):
            result = smoke._restart(fixture, before, {"rows": 119, "sha256": "d" * 64}, inventory, smoke.CAPTURE_LIMITS)
        self.assertTrue(result["migrationLedgerUnchanged"])
        self.assertEqual(before["app"], captured)

    def test_created_false_and_started_null_oom_setting_preserve_raw_capture(self):
        fixture, before, rows, inventory = self._restart_fixture()
        for service in LONG_RUNNING:
            before[service]["HostConfig"]["OomKillDisable"] = None
            rows[service]["HostConfig"]["OomKillDisable"] = False
        captured = deepcopy(before)
        with patch.object(smoke, "owned_bridge_forwarder"), patch.object(smoke, "_media"):
            result = smoke._restart(fixture, before, {"rows": 119, "sha256": "d" * 64}, inventory, smoke.CAPTURE_LIMITS)
        self.assertTrue(result["migrationLedgerUnchanged"])
        self.assertEqual(before, captured)
        self.assertTrue(all(row["HostConfig"]["OomKillDisable"] is False for row in rows.values()))

    def test_modern_replace_marker_is_derived_from_exact_service_and_replica(self):
        fixture, before, rows, inventory = self._restart_fixture()
        labels = {smoke.OWNER: fixture.project, "com.docker.compose.service": "app",
                  "com.docker.compose.container-number": "1"}
        before["app"]["Config"]["Labels"] = {**labels, "com.docker.compose.replace": "app-1"}
        rows["app"]["Config"]["Labels"] = dict(labels)
        captured = deepcopy(before)
        with patch.object(smoke, "owned_bridge_forwarder"), patch.object(smoke, "_media"):
            smoke._restart(fixture, before, {"rows": 119, "sha256": "d" * 64}, inventory, smoke.CAPTURE_LIMITS)
        self.assertEqual(before, captured)
        for marker, service, number in (("worker-1", "app", "1"), ("app-2", "app", "1"),
                ("app-01", "app", "01"), ("app-0", "app", "0"), ("app-1", None, "1"),
                ("app-1", "app", 1), ("arbitrary-1", "arbitrary", "1"), ("app-1", "app", None)):
            row = deepcopy(before["app"])
            row["Config"]["Labels"].update({"com.docker.compose.replace": marker,
                "com.docker.compose.service": service, "com.docker.compose.container-number": number})
            with self.subTest(marker=marker, service=service, number=number), \
                    self.assertRaisesRegex(r.RecoveryError, "replacement identity"):
                smoke._topology(row)

    def test_environment_permutations_keep_exact_values_cardinality_and_raw_rows(self):
        row = runtime_rows(["app"])["app"]
        records = ["TOKEN=full=value", "EMPTY=", "UNICODE=über\nvalue"]
        row["Config"]["Env"] = records
        expected, captured = smoke._topology(row), deepcopy(row)
        for entries in permutations(records):
            candidate = deepcopy(row)
            candidate["Config"]["Env"] = list(entries)
            self.assertEqual(smoke._topology(candidate), expected)
            self.assertEqual(candidate["Config"]["Env"], list(entries))
        self.assertEqual(row, captured)
        for entries in (["TOKEN=changed", "EMPTY=", "UNICODE=über\nvalue"], records[:-1], [*records, "NEW=value"]):
            candidate = deepcopy(row)
            candidate["Config"]["Env"] = entries
            self.assertNotEqual(smoke._topology(candidate), expected)
        absent = deepcopy(row)
        absent["Config"].pop("Env")
        empty = deepcopy(absent)
        empty["Config"]["Env"] = []
        self.assertNotEqual(smoke._topology(absent), smoke._topology(empty))

    def test_environment_duplicates_and_malformed_records_are_rejected(self):
        for environment in (None, "KEY=value", [123], ["KEY"], ["=value"], ["BAD-KEY=value"],
                ["KEY=one", "KEY=two"], ["KEY=same", "KEY=same"], ["KEY=bad\0value"]):
            row = runtime_rows(["app"])["app"]
            row["Config"]["Env"] = environment
            with self.subTest(environment=environment), self.assertRaisesRegex(r.RecoveryError, "environment"):
                smoke._topology(row)

    def test_dependency_tuple_permutations_preserve_all_fields_and_raw_labels(self):
        row = runtime_rows(["caddy"])["caddy"]
        records = ["app:service_healthy:false", "ws:service_started:false", "migrate:service_completed_successfully:true"]
        row["Config"]["Labels"] = {"com.docker.compose.depends_on": ",".join(records)}
        expected, captured = smoke._topology(row), deepcopy(row)
        for entries in permutations(records):
            candidate = deepcopy(row)
            candidate["Config"]["Labels"]["com.docker.compose.depends_on"] = ",".join(entries)
            self.assertEqual(smoke._topology(candidate), expected)
            self.assertEqual(candidate["Config"]["Labels"]["com.docker.compose.depends_on"], ",".join(entries))
        self.assertEqual(row, captured)
        for changed in ("app:service_started:false", "app:service_healthy:true", "", ",".join(records[:-1])):
            candidate = deepcopy(row)
            candidate["Config"]["Labels"]["com.docker.compose.depends_on"] = changed
            self.assertNotEqual(smoke._topology(candidate), expected)

    def test_dependency_tuple_duplicates_and_malformed_labels_are_rejected(self):
        for label in (None, [], "app", "app:service_healthy", "app:unknown:false", "app:service_healthy:0",
                "App:service_healthy:false", "app:service_healthy:false,", "app:service_healthy:false,app:service_healthy:false",
                "app:service_healthy:false,app:service_started:false"):
            row = runtime_rows(["caddy"])["caddy"]
            row["Config"]["Labels"] = {"com.docker.compose.depends_on": label}
            with self.subTest(label=label), self.assertRaisesRegex(r.RecoveryError, "dependency"):
                smoke._topology(row)

    def test_selected_dependency_set_drift_still_blocks_every_start(self):
        fixture, before, rows, inventory = self._restart_fixture()
        before["newsletter-engine"]["Config"]["Labels"] = {"com.docker.compose.depends_on": ""}
        rows["newsletter-engine"]["Config"]["Labels"] = {
            "com.docker.compose.depends_on": "postgres:service_healthy:false"}
        with self.assertRaisesRegex(r.RecoveryError, "topology differs"):
            smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
        fixture.docker.run.assert_not_called()

    def test_actual_caddy_bind_permutations_keep_full_records_and_raw_capture(self):
        row = runtime_rows(["caddy"])["caddy"]
        records = ["/owned/source/Caddyfile:/etc/caddy/Caddyfile:ro", "fixture_caddydata:/data:rw",
            "fixture_caddyconfig:/config:rw", "/owned/source/newsletters/Caddyfile:/etc/caddy/newsletters:ro",
            "/owned/source/tls:/fixture:ro"]
        row["HostConfig"]["Binds"] = records
        expected, captured = smoke._topology(row), deepcopy(row)
        for entries in permutations(records):
            candidate = deepcopy(row)
            candidate["HostConfig"]["Binds"] = list(entries)
            self.assertEqual(smoke._topology(candidate), expected)
            self.assertEqual(candidate["HostConfig"]["Binds"], list(entries))
        self.assertEqual(row, captured)
        for changed in ("/different/source:/etc/caddy/Caddyfile:ro", "/owned/source/Caddyfile:/etc/caddy/Caddyfile:rw",
                "/owned/source/Caddyfile:/different-target:ro", "/owned/source/Caddyfile:/etc/caddy/Caddyfile:ro,z"):
            candidate = deepcopy(row)
            candidate["HostConfig"]["Binds"][0] = changed
            self.assertNotEqual(smoke._topology(candidate), expected)
        forms = []
        for value in ("absent", None, []):
            candidate = deepcopy(row)
            if value == "absent":
                candidate["HostConfig"].pop("Binds")
            else:
                candidate["HostConfig"]["Binds"] = value
            forms.append(smoke._topology(candidate))
        self.assertTrue(all(forms[a] != forms[b] for a in range(3) for b in range(a + 1, 3)))

    def test_ambiguous_duplicate_and_overlapping_binds_are_rejected(self):
        for binds in ("volume:/data:rw", [123], [""], [":/data:rw"], ["volume:relative:rw"],
                ["volume:/data/../data:rw"], ["volume:/data:rw:extra"], ["volume:/data:"],
                ["volume:/data:ro,rw"], ["volume:/data:ro,ro"], ["volume:/data:rw\n"],
                ["volume:/data:rw", "other://data:ro"], ["//owned/source:/data:ro"],
                ["volume:/data:rw", "other:/data:ro"], ["volume:/data:rw", "other:/data/nested:ro"],
                ["volume:/data/nested:rw", "other:/data:ro"]):
            row = runtime_rows(["caddy"])["caddy"]
            row["HostConfig"]["Binds"] = binds
            with self.subTest(binds=binds), self.assertRaises(r.RecoveryError):
                smoke._topology(row)

    def test_prestart_boundary_executes_all_volume_guards_without_starting(self):
        fixture, before, rows, inventory = self._restart_fixture()
        created = smoke._create_restored(fixture, before, inventory, smoke.CAPTURE_LIMITS)
        self.assertEqual(set(created), LONG_RUNNING)
        self.assertEqual(fixture._verify_volume.call_count, 5)
        self.assertEqual({item.args[0] for item in fixture._verify_volume.call_args_list}, fixture.volume_names)
        allowed = {row["Id"] for row in rows.values()}
        self.assertTrue(all(item.kwargs == {"allowed": allowed} for item in fixture._verify_volume.call_args_list))
        fixture.docker.run.assert_not_called()
        for selected in fixture.volume_names:
            fixture._verify_volume.side_effect = lambda name, **_: r.require(name != selected, "Foreign volume reference")
            with self.subTest(volume=selected), self.assertRaisesRegex(r.RecoveryError, "Foreign volume reference"):
                smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
            fixture.docker.run.assert_not_called()

    def test_topology_rejects_oom_disable_invalid_shape_and_missing_key_drift(self):
        for invalid in (True, 0, 1, "false", [], {}):
            fixture, before, rows, inventory = self._restart_fixture()
            before["app"]["HostConfig"]["OomKillDisable"] = None
            rows["app"]["HostConfig"]["OomKillDisable"] = invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(r.RecoveryError, "OOM kill setting"):
                smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
            fixture.docker.run.assert_not_called()
        for before_has_key in (False, True):
            fixture, before, rows, inventory = self._restart_fixture()
            selected = before if before_has_key else rows
            selected["app"]["HostConfig"]["OomKillDisable"] = None
            with self.subTest(before_has_key=before_has_key), self.assertRaisesRegex(r.RecoveryError, "topology differs"):
                smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
            fixture.docker.run.assert_not_called()

    def test_oom_normalization_keeps_all_other_host_config_values_exact(self):
        for field, value in (("Memory", 1), ("PidsLimit", 1), ("ReadonlyRootfs", True),
                ("CapAdd", ["SYS_ADMIN"]), ("NetworkMode", "host"), ("UnknownField", {"changed": True})):
            fixture, before, rows, inventory = self._restart_fixture()
            before["app"]["HostConfig"]["OomKillDisable"] = None
            rows["app"]["HostConfig"].update(OomKillDisable=False, **{field: value})
            with self.subTest(field=field), self.assertRaisesRegex(r.RecoveryError, "topology differs"):
                smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
            fixture.docker.run.assert_not_called()

    def test_invalid_replace_or_changed_protected_compose_label_blocks_starts(self):
        for invalid in ("short-id", "g" * 64, "a" * 63, 123, None):
            fixture, before, rows, inventory = self._restart_fixture()
            before["app"]["Config"]["Labels"] = {smoke.OWNER: fixture.project,
                "com.docker.compose.replace": invalid}
            rows["app"]["Config"]["Labels"] = {smoke.OWNER: fixture.project}
            with self.subTest(invalid=invalid), self.assertRaisesRegex(r.RecoveryError, "replacement identity"):
                smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
            fixture.docker.run.assert_not_called()

        fixture, before, rows, inventory = self._restart_fixture()
        before["app"]["Config"]["Labels"] = {smoke.OWNER: fixture.project,
            "com.docker.compose.config-hash": "captured-hash", "com.docker.compose.replace": "a" * 64}
        rows["app"]["Config"]["Labels"] = {smoke.OWNER: fixture.project,
            "com.docker.compose.config-hash": "changed-hash"}
        with self.assertRaisesRegex(r.RecoveryError, "topology differs"):
            smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
        fixture.docker.run.assert_not_called()

    def test_changed_topology_or_copyup_bytes_block_all_starts(self):
        fixture, before, rows, inventory = self._restart_fixture()
        rows["worker"]["Config"]["Env"].append("UNREVIEWED=true")
        with self.assertRaisesRegex(r.RecoveryError, "topology differs"):
            smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
        fixture.docker.run.assert_not_called()
        rows["worker"]["Config"]["Env"].pop()
        put(self.directory / "unexpected-copyup", b"unreviewed Docker volume copy-up")
        with self.assertRaisesRegex(r.RecoveryError, "creation changed"):
            smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
        fixture.docker.run.assert_not_called()

    def test_restored_cgroup_parent_must_equal_the_captured_parent_before_any_start(self):
        fixture, before, rows, inventory = self._restart_fixture()
        parent = "warpdrivequalificationabcdef012345.slice"
        for name in LONG_RUNNING:
            before[name]["HostConfig"]["CgroupParent"] = parent
            rows[name]["HostConfig"]["CgroupParent"] = parent
        for name in LONG_RUNNING:
            rows[name]["HostConfig"]["CgroupParent"] = "system.slice"
            with self.subTest(service=name), self.assertRaisesRegex(r.RecoveryError, "topology differs"):
                smoke._restart(fixture, before, {}, inventory, smoke.CAPTURE_LIMITS)
            fixture.docker.run.assert_not_called()
            rows[name]["HostConfig"]["CgroupParent"] = parent
        with patch.object(smoke, "owned_bridge_forwarder"), patch.object(smoke, "_media"):
            smoke._restart(fixture, before, {"rows": 119, "sha256": "d" * 64}, inventory, smoke.CAPTURE_LIMITS)

    def test_unknown_native_outcome_keeps_resources_and_a_private_redacted_receipt(self):
        fixture = Mock()
        fixture.project = "wd-fresh-unit-only"
        fixture.receipt = {"checks": {}}
        with patch.object(smoke, "_native_root_host"), \
                patch.object(smoke, "_binary", side_effect=lambda path, _pin: path), \
                patch.object(smoke.shutil, "which", return_value=sys.executable), \
                patch.object(smoke, "PinnedCommand") as command, patch.object(smoke, "FixtureDocker"), \
                patch.object(smoke, "RecoveryFixture", return_value=fixture) as factory, patch.object(smoke, "_media"), \
                patch.object(smoke.signal, "signal"), patch.object(smoke.signal, "alarm"), \
                patch.object(smoke.os, "statvfs", return_value=SimpleNamespace(f_bavail=10 * 1024**3, f_frsize=1)), \
                patch.object(smoke, "_recover", side_effect=r.RecoveryUnknown("PRIVATE_DO_NOT_SERIALIZE")):
            command.return_value.run.return_value = b"restic 0.18.0 fixture"
            result = smoke.run(self.baseline, self.candidate, restic=Path(sys.executable), restic_pin="a" * 64,
                               pg_control=Path(sys.executable), pg_control_pin="b" * 64, output_parent=self.directory,
                               storage_client_bin="mcli", cgroup_parent="warpdrivequalificationabcdef012345.slice")
        self.assertEqual(factory.call_args.kwargs["storage_client_bin"], "mcli")
        self.assertEqual(result["storageClientBin"], "mcli")
        self.assertEqual(factory.call_args.kwargs["cgroup_parent"], "warpdrivequalificationabcdef012345.slice")
        self.assertEqual(result["cgroupParent"], "warpdrivequalificationabcdef012345.slice")
        fixture.cleanup.assert_not_called()
        self.assertFalse(result["success"])
        self.assertTrue(result["manualReconciliationRequired"])
        self.assertTrue(result["fixtureWritersMayBeRunning"])
        record = Path(result["outputDirectory"]) / "result.json"
        raw = record.read_bytes()
        self.assertNotIn(b"PRIVATE_DO_NOT_SERIALIZE", raw)
        self.assertEqual(stat.S_IMODE(record.stat().st_mode), 0o600)
        self.assertEqual(json.loads(raw), result)


class CoordinatorFileModelTests(unittest.TestCase):
    """Execute capture/restore bookkeeping with memory storage, never native evidence."""

    def setUp(self):
        self.files = Fixture()
        self.addCleanup(self.files.close)
        f = self.files
        baseline, candidate = references()
        self.fixture = smoke.RecoveryFixture(Mock(), f.configuration.parent, baseline, candidate)
        self.fixture.configuration_pins = {f.configuration: sha256(f.configuration.read_bytes()).hexdigest()}
        self.fixture.receipt["checks"]["baseline"] = {"migrationLedger": {"rows": 1, "sha256": "d" * 64}}
        self.rows = runtime_rows(baseline, running=False)

        class MemoryRestic(FakeRestic, r.Restic):
            def __init__(self, _binary, _repository, key_file, **options):
                FakeRestic.__init__(self, f, f.keys.index(key_file))
                self.command, self.directory = options["command"], None
        self.restic_class = MemoryRestic
        self.progress = smoke.Progress(f.root)

        def observe(_plan):
            return {"roots": [*f.members.values(), str(f.configuration.parent)], "members": f.members,
                    "fingerprint": "b" * 64, "privateConfiguration": {"syntheticOnly": True},
                    "scope": "daemon-free-memory-model-not-native"}
        self.observer = SimpleNamespace(observe=observe)

        def cleanup():
            for path in f.members.values():
                if Path(path).exists():
                    shutil.rmtree(path)
        self.fixture.cleanup = Mock(side_effect=cleanup)

    def recover(self, *, lost_snapshot_ack=False, failed_independent_readback=False):
        f = self.files
        f.store.fail_after_write = lost_snapshot_ack
        binary, pg, docker = Path("/fixture/restic"), Path("/fixture/pg"), Path("/fixture/docker")
        pins = {binary: "a" * 64, pg: "b" * 64, docker: "c" * 64}

        def revoke(*_args):
            f.keys[0].unlink()

        def volume_roots(*_args):
            for path in f.members.values():
                Path(path).mkdir(mode=0o700)
            return {name: Path(path) for name, path in f.members.items()}

        def restarted(_fixture, _before, _ledger, inventory, budget):
            self.assertFalse(f.keys[0].exists())
            self.assertFalse((f.root / "capture/recovery-manifest.json").exists())
            self.assertTrue(self.progress.result["sourceAbsentAtIndependentRestore"])
            self.assertEqual(r.scan(inventory["roots"], budget), inventory)
            return {"modelOnly": True, "initializationServicesReplayed": False}

        restore = self.restic_class.restore

        def readback(adapter, *args, **kwargs):
            if failed_independent_readback and not f.keys[0].exists():
                raise r.RecoveryError("Synthetic independent readback failed")
            return restore(adapter, *args, **kwargs)

        with patch.object(smoke, "_stop", return_value=self.rows), \
                patch.object(smoke, "_initialize_repository", return_value=(f.repo, *f.keys, "e" * 64)), \
                patch.object(smoke, "_revoke_writer", side_effect=revoke), \
                patch.object(smoke.r, "Restic", self.restic_class), \
                patch.object(smoke.r, "DockerColdObserver", return_value=self.observer), \
                patch.object(self.restic_class, "restore", readback), \
                patch.object(smoke, "ObserverCommand"), patch.object(smoke, "_volume_roots", side_effect=volume_roots), \
                patch.object(smoke, "_restart", side_effect=restarted):
            return smoke._recover(self.fixture, f.root, binary, pg, docker, pins, self.progress)

    def test_actual_coordinator_removes_sources_before_independent_readback_and_keeps_quarantine(self):
        result = self.recover()
        self.assertTrue(result["isolatedRestoreBytesVerified"])
        self.assertTrue(self.progress.result["sourceAbsentAtIndependentRestore"])
        self.assertTrue(self.progress.result["writerSlotRevoked"])
        self.assertTrue(self.progress.result["cleanupSuccess"])
        self.assertEqual(self.files.store.backups, 1)
        self.assertEqual(self.fixture.cleanup.call_count, 2)
        self.assertFalse(self.fixture.directory.exists())
        self.assertTrue((self.files.root / "quarantine").is_dir())
        self.assertTrue((self.files.root / "verified-receipt.json").is_file())
        self.assertTrue((self.files.root / "verified-manifest.json").is_file())
        self.assertTrue(self.files.keys[1].is_file())

    def test_unknown_snapshot_retains_original_source_and_writer_without_replaying_backup(self):
        with self.assertRaises(r.RecoveryUnknown):
            self.recover(lost_snapshot_ack=True)
        self.assertEqual(self.files.store.backups, 1)
        self.fixture.cleanup.assert_not_called()
        self.assertTrue(self.files.keys[0].exists())
        self.assertTrue(Path(self.files.members["postgres"]).exists())
        self.assertFalse((self.files.root / "quarantine").exists())
        self.assertNotIn("writerSlotRevoked", self.progress.result)

    def test_failed_independent_readback_keeps_private_evidence_and_cannot_materialize_or_start(self):
        with self.assertRaisesRegex(r.RecoveryError, "independent readback failed"):
            self.recover(failed_independent_readback=True)
        self.assertEqual(self.fixture.cleanup.call_count, 1)
        self.assertTrue(self.progress.result["sourceAbsentAtIndependentRestore"])
        self.assertFalse(self.fixture.directory.exists())
        self.assertFalse(any(Path(path).exists() for path in self.files.members.values()))
        self.assertTrue((self.files.root / "verified-receipt.json").exists())
        self.assertTrue((self.files.root / "verified-manifest.json").exists())
        self.assertTrue(self.files.repo.is_dir())
        self.assertTrue(self.files.keys[1].exists())
        self.assertNotIn("restartedFixtureChecks", self.progress.result)


if __name__ == "__main__":
    unittest.main()
