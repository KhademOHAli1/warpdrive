"""Qualify the generated fresh smoke model and fail-closed orchestration without Docker runtime."""

from copy import deepcopy
from hashlib import sha256
import io
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import fresh_compose_smoke as smoke
from fresh_compose_admission import IMAGES
from test_compose_profile import FRESH_ENV, SYNTHETIC_ENV
from web_switch import SwitchConflict


class FreshComposeSmokeTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory(prefix="wd-fresh-test-"))).resolve()
        values = SYNTHETIC_ENV | FRESH_ENV
        self.baseline = {service: values[variable] for variable, names in IMAGES.items() for service in names}
        self.candidate = {**self.baseline, "app": "ghcr.io/example/candidate@sha256:" + "a" * 64}

    def test_fixture_environment_is_private_before_first_byte_with_permissive_umask(self):
        path = self.directory / "private.env"
        observed = []

        class CheckedWriter(io.TextIOWrapper):
            def write(writer, value):
                info = os.fstat(writer.fileno())
                observed.append((stat.S_IMODE(info.st_mode), info.st_nlink, info.st_uid))
                return super().write(value)

        def checked_open(descriptor, mode, *, encoding):
            return CheckedWriter(io.FileIO(descriptor, mode), encoding=encoding)

        previous_umask = os.umask(0)
        try:
            with patch.object(smoke.os, "fdopen", side_effect=checked_open):
                smoke._write_env(path, {"POSTGRES_PASSWORD": "generated-fixture-only", "A": "first"})
        finally:
            os.umask(previous_umask)
        self.assertEqual(observed, [(0o600, 1, os.geteuid())])
        self.assertEqual(path.read_text(), "A=first\nPOSTGRES_PASSWORD=generated-fixture-only\n")

    def test_fixture_environment_refuses_existing_paths_and_unowned_parent_mode(self):
        source = self.directory / "source"
        source.write_text("preserve original bytes")
        regular, symlink, linked = (self.directory / name for name in ("regular.env", "symlink.env", "linked.env"))
        regular.write_text("existing environment")
        symlink.symlink_to(source)
        os.link(source, linked)
        with patch.object(smoke.os, "fdopen", side_effect=AssertionError("Existing path reached a writer")):
            for path in (regular, symlink, linked):
                with self.subTest(path=path.name), self.assertRaises(FileExistsError):
                    smoke._write_env(path, {"POSTGRES_PASSWORD": "generated-fixture-only"})
        self.assertEqual(source.read_text(), "preserve original bytes")
        self.assertEqual(regular.read_text(), "existing environment")
        self.assertEqual(source.stat().st_nlink, 2)
        self.directory.chmod(0o755)
        with self.assertRaisesRegex(SwitchConflict, "private installed Web chain directory"):
            smoke._write_env(self.directory / "uncreated.env", {"A": "value"})
        self.assertFalse((self.directory / "uncreated.env").exists())

    def test_interrupted_fixture_write_keeps_private_file_and_refuses_replacement(self):
        path = self.directory / "interrupted.env"

        class FailingWriter(io.TextIOWrapper):
            def write(writer, _value):
                self.assertEqual(stat.S_IMODE(os.fstat(writer.fileno()).st_mode), 0o600)
                raise OSError("injected fixture write failure")

        def failing_open(descriptor, mode, *, encoding):
            return FailingWriter(io.FileIO(descriptor, mode), encoding=encoding)

        with patch.object(smoke.os, "fdopen", side_effect=failing_open):
            with self.assertRaisesRegex(OSError, "injected fixture write failure"):
                smoke._write_env(path, {"POSTGRES_PASSWORD": "generated-fixture-only"})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.read_bytes(), b"")
        with self.assertRaises(FileExistsError):
            smoke._write_env(path, {"POSTGRES_PASSWORD": "replacement"})

    def test_actual_generated_four_file_fixture_plus_isolation_model(self):
        docker = shutil.which("docker")
        self.assertIsNotNone(docker)

        selected_parent = "warpdrivequalificationabcdef012345.slice"
        for client, parent in (("mc", None), ("mcli", None), ("mc", selected_parent), ("mcli", selected_parent)):
            with self.subTest(client=client, cgroup_parent=parent):
                models = []

                def config_only(argv, *, timeout):
                    self.assertEqual(argv[-3:], ["config", "--format", "json"])
                    result = subprocess.run([docker, *argv], capture_output=True, text=True, timeout=timeout,
                                            env={"PATH": "/usr/bin:/bin", "DOCKER_HOST": "unix:///dev/null"}, check=True)
                    models.append(smoke.decode(result.stdout.encode()))
                    return result

                directory = self.directory / (client + ("-cgroup" if parent else ""))
                directory.mkdir(mode=0o700)
                fixture = smoke.FreshSmoke(SimpleNamespace(run=config_only), directory, self.baseline, self.candidate,
                                           storage_client_bin=client, cgroup_parent=parent)
                fixture.prepare()
                self.assertEqual(set(fixture.receipt["checks"]["model"]), {"baseline", "candidate"})
                self.assertEqual((directory / "Caddyfile").read_text(), smoke.TLS)
                self.assertNotIn("ACME", smoke.TLS)
                self.assertIn("admin off", smoke.TLS)
                self.assertIn("ports: !reset []", fixture.overlay.read_text())
                self.assertEqual([path.read_bytes() for path in fixture.compose_files], [(smoke.ROOT / name).read_bytes() for name in smoke.COMPOSE])
                self.assertTrue(all(path.is_relative_to(directory) for path in fixture.compose_files))
                self.assertEqual(len(fixture.receipt["checks"]["configurationSha256"]), 64)
                for path in (directory / "baseline.env", directory / "candidate.env", fixture.storage_env):
                    self.assertIn("WARPDRIVE_STORAGE_CLIENT_BIN=" + client + "\n", path.read_text())
                storage_env = dict(line.split("=", 1) for line in fixture.storage_env.read_text().splitlines())
                self.assertEqual({key: storage_env[key] for key in smoke.STORAGE_FILE_DEFAULTS},
                                 dict.fromkeys(smoke.STORAGE_FILE_DEFAULTS, ""))
                self.assertTrue(storage_env["MINIO_ACCESS_KEY"] and storage_env["MINIO_SECRET_KEY"])
                for model in models:
                    for role in ("minio", "createbuckets"):
                        self.assertEqual({key: model["services"][role]["environment"][key] for key in smoke.STORAGE_FILE_DEFAULTS},
                                         dict.fromkeys(smoke.STORAGE_FILE_DEFAULTS, ""))
                    self.assertEqual(model["services"]["minio"]["environment"]["MINIO_ROOT_USER"], storage_env["MINIO_ACCESS_KEY"])
                    self.assertEqual(model["services"]["createbuckets"]["environment"]["MINIO_SECRET_KEY"], storage_env["MINIO_SECRET_KEY"])
                self.assertTrue(all(model["services"]["createbuckets"]["environment"][smoke.STORAGE_CLIENT_ENV] == client for model in models))
                for name, (memory, cpus, pids) in smoke.RESOURCE_LIMITS.items():
                    self.assertEqual(models[0]["services"][name].get("cgroup_parent"), parent)
                    self.assertEqual(int(models[0]["services"][name]["mem_limit"]), memory)
                    self.assertEqual(int(models[0]["services"][name]["memswap_limit"]), memory)
                    self.assertEqual(float(models[0]["services"][name]["cpus"]), cpus)
                    self.assertEqual(models[0]["services"][name]["pids_limit"], pids)
                drift = deepcopy(models[0])
                drift["services"]["worker"]["mem_limit"] *= 2
                with self.assertRaisesRegex(SwitchConflict, "resource budget"):
                    smoke._validate_fixture_model(drift, project=fixture.project, directory=directory, images=self.baseline,
                                                  storage_client_bin=client, cgroup_parent=parent)
                drift = deepcopy(models[0])
                drift["services"]["app"]["cgroup_parent"] = "system.slice"
                with self.assertRaisesRegex(SwitchConflict, "cgroup parent differs"):
                    smoke._validate_fixture_model(drift, project=fixture.project, directory=directory, images=self.baseline,
                                                  storage_client_bin=client, cgroup_parent=parent)

    def test_resource_admission_holds_before_starting_any_container(self):
        docker = Mock()
        docker.run.return_value.stdout = str(self.directory)
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate)
        minimum = sum(value[0] for value in smoke.RESOURCE_LIMITS.values()) + smoke.MEMORY_RESERVE
        for memory, free in ((minimum - 1, 10 * 1024**3), (minimum, smoke.DISK_RESERVE)):
            with self.subTest(memory=memory, free=free), patch.object(smoke, "_available_memory", return_value=memory), \
                    patch.object(smoke.shutil, "disk_usage", return_value=SimpleNamespace(free=free)), \
                    self.assertRaisesRegex(SwitchConflict, "operating reserve"):
                fixture._admit_resources()
        self.assertTrue(all(call.args[0][0] == "info" for call in docker.run.call_args_list))
        with patch.object(smoke, "_available_memory", return_value=minimum), \
                patch.object(smoke.shutil, "disk_usage", return_value=SimpleNamespace(free=10 * 1024**3)):
            fixture._admit_resources()
        self.assertEqual(fixture.receipt["checks"]["resourceAdmission"]["requiredMemoryBytes"], minimum)

    def test_selected_aggregate_parent_reads_its_own_remaining_memory_and_requires_systemd(self):
        parent = "warpdrivequalificationabcdef012345.slice"
        base = self.directory / "cgroup"
        selected = base / parent
        selected.mkdir(parents=True)
        for name in ("memory.max", "memory.current", "cpu.max"):
            (selected / name).write_text("fixture")
        docker = Mock()
        docker.run.side_effect = lambda args, **_options: SimpleNamespace(stdout="systemd" if "CgroupDriver" in args[-1] else str(self.directory))
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate, cgroup_parent=parent)
        minimum = sum(value[0] for value in smoke.RESOURCE_LIMITS.values()) + smoke.MEMORY_RESERVE
        with patch.object(smoke, "CGROUP_ROOT", base), patch.object(smoke, "_available_memory", return_value=minimum) as memory, \
                patch.object(smoke.shutil, "disk_usage", return_value=SimpleNamespace(free=10 * 1024**3)):
            fixture._admit_resources()
            memory.assert_called_once_with(cgroup=selected)
        docker.run.return_value.stdout = "cgroupfs"
        docker.run.side_effect = None
        with self.assertRaisesRegex(SwitchConflict, "systemd Docker driver"):
            fixture._admit_resources()

    def test_only_flat_unique_qualification_parent_is_accepted_before_docker(self):
        with patch.object(smoke, "Docker") as docker:
            for parent in ("system.slice", "/sys/fs/cgroup/a", "warpdrive-qualification-abcdef012345.slice",
                           "warpdrivequalificationABCDEF012345.slice", "warpdrivequalificationabcdef01234.slice", ""):
                with self.subTest(parent=parent), self.assertRaisesRegex(SwitchConflict, "flat unique"):
                    smoke.run(self.baseline, self.candidate, cgroup_parent=parent)
            docker.assert_not_called()

    def test_actual_container_readback_requires_selected_parent_for_every_role(self):
        parent = "warpdrivequalificationabcdef012345.slice"
        docker = Mock()
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate, cgroup_parent=parent)
        rows = []
        for index, name in enumerate(sorted(self.baseline), 1):
            memory, cpus, pids = smoke.RESOURCE_LIMITS[name]
            rows.append({"Id": f"{index:064x}", "Image": "sha256:" + f"{index + 20:064x}",
                "Config": {"Labels": {smoke.OWNER: fixture.project, smoke.SERVICE: name},
                           "Env": [key + "=" for key in sorted(smoke.STORAGE_FILE_DEFAULTS)]},
                "HostConfig": {"Memory": memory, "MemorySwap": memory, "NanoCpus": int(cpus * 10**9),
                               "PidsLimit": pids, "CgroupParent": parent}})
        fixture.images = {"baseline": {row["Config"]["Labels"][smoke.SERVICE]: row["Image"] for row in rows}}
        fixture._ids = Mock(return_value=[row["Id"] for row in rows])
        fixture._verify_configuration = Mock()
        docker.json.return_value = rows
        self.assertEqual(set(fixture._rows()), set(self.baseline))
        for row in rows:
            row["HostConfig"]["CgroupParent"] = "system.slice"
            with self.subTest(service=row["Config"]["Labels"][smoke.SERVICE]), self.assertRaisesRegex(SwitchConflict, "runtime cgroup"):
                fixture._rows()
            row["HostConfig"]["CgroupParent"] = parent

    def test_available_memory_observation_respects_container_limit(self):
        proc, cgroup = self.directory / "meminfo", self.directory / "cgroup"
        cgroup.mkdir()
        proc.write_text("MemAvailable: 8388608 kB\n")
        (cgroup / "memory.max").write_text("1073741824\n")
        (cgroup / "memory.current").write_text("268435456\n")
        self.assertEqual(smoke._available_memory(proc, cgroup), 805306368)
        (cgroup / "memory.max").write_text("max\n")
        self.assertEqual(smoke._available_memory(proc, cgroup), 8 * 1024**3)
        (cgroup / "memory.max").write_text("invalid\n")
        with self.assertRaisesRegex(SwitchConflict, "limit is invalid"):
            smoke._available_memory(proc, cgroup)
        proc.write_text("MemTotal: 8388608 kB\n")
        with self.assertRaisesRegex(SwitchConflict, "available-memory"):
            smoke._available_memory(proc, cgroup)

    def test_actual_storage_rows_refuse_missing_nonempty_or_added_file_authority(self):
        for role in ("minio", "createbuckets"):
            for key, value in [(key, "relative-default") for key in smoke.STORAGE_FILE_DEFAULTS] + [
                    ("MINIO_ROOT_USER_FILE", None), ("MINIO_EXTRA_FILE", ""), ("EXTERNAL_SECRET_FILE", "/run/unreviewed")]:
                docker = Mock()
                fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate)
                identifier, image = "f" * 64, "sha256:" + "a" * 64
                environment = dict.fromkeys(smoke.STORAGE_FILE_DEFAULTS, "")
                if value is None:
                    environment.pop(key)
                else:
                    environment[key] = value
                memory, cpus, pids = smoke.RESOURCE_LIMITS[role]
                row = {"Id": identifier, "Image": image,
                       "Config": {"Labels": {smoke.OWNER: fixture.project, smoke.SERVICE: role},
                                  "Env": [key + "=" + value for key, value in environment.items()]},
                       "HostConfig": {"Memory": memory, "MemorySwap": memory,
                                      "NanoCpus": int(cpus * 10**9), "PidsLimit": pids}}
                fixture.images = {"baseline": {role: image}}
                fixture._ids = Mock(return_value=[identifier])
                fixture._verify_configuration = Mock()
                docker.json.return_value = [row]
                with self.subTest(role=role, key=key, value=value), self.assertRaisesRegex(SwitchConflict, "file defaults"):
                    fixture._rows()
                docker.run.assert_not_called()

    def test_changed_prepared_configuration_holds_before_any_compose_command(self):
        docker = Mock()
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate)
        path = self.directory / ".env"
        path.write_text("DATABASE_URL=fixture-original\n")
        path.chmod(0o600)
        fixture.configuration_pins = {path: sha256(path.read_bytes()).hexdigest()}
        path.write_text("DATABASE_URL=fixture-replacement\n")
        with self.assertRaisesRegex(SwitchConflict, "configuration changed"):
            fixture.compose("candidate", "up", "-d", "app")
        docker.run.assert_not_called()
        path.unlink()
        replacement = self.directory / "outside-config"
        replacement.write_text("DATABASE_URL=fixture-original\n")
        path.symlink_to(replacement)
        with self.assertRaisesRegex(SwitchConflict, "configuration changed"):
            fixture.compose("baseline", "up", "-d", "app")
        docker.run.assert_not_called()

    def test_non_native_host_holds_before_docker(self):
        with patch.object(smoke.platform, "system", return_value="Darwin"), patch.object(smoke, "Docker") as docker:
            with self.assertRaisesRegex(SwitchConflict, "Linux AMD64 host"):
                smoke.run(self.baseline, self.candidate)
        docker.assert_not_called()

    def test_invalid_storage_client_holds_before_docker_or_private_fixture_creation(self):
        with patch.object(smoke, "Docker") as docker:
            for client in ("bash", "mc --flag", "$(unreviewed)", None):
                with self.subTest(client=client), self.assertRaisesRegex(SwitchConflict, "must be mc or mcli"):
                    smoke.run(self.baseline, self.candidate, storage_client_bin=client)
                with self.assertRaisesRegex(SwitchConflict, "must be mc or mcli"):
                    smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate, storage_client_bin=client)
        docker.assert_not_called()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_preloaded_immutable_image_refs_must_resolve_exactly(self):
        docker = Mock()
        docker.run.return_value.stdout = "linux x86_64"
        docker.json.return_value = [{"RepoDigests": [], "Os": "linux", "Architecture": "amd64", "Id": "sha256:" + "0" * 64}]
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate)
        with self.assertRaisesRegex(SwitchConflict, "digest-pinned"):
            fixture._preloaded()
        self.assertEqual(docker.json.call_args.args[0][0:2], ["image", "inspect"])

    def test_selection_only_changes_app_and_proves_retained_identity_before_rollback(self):
        fixture = smoke.FreshSmoke(Mock(), self.directory, self.baseline, self.candidate)
        fixture._provision = Mock()
        fixture._baseline_readiness = Mock(return_value={"realtimeCloseCode": 4401, "workerFileReaperCompleted": True})
        fixture._confirm_candidate_stopped = Mock(return_value={"candidateStopped": True, "ingressStatus": 502})
        fixture._rows = Mock(return_value={"caddy": {"Name": "/owned-caddy"}})
        fixture.compose = Mock()
        fixture.revisions = {"baseline": "a" * 40, "candidate": "b" * 40}
        retained = {"app": ("old",), "ws": ("ws",), "worker": ("worker",)}
        fixture._observe = Mock(side_effect=[(retained, 1), ({**retained, "app": ("new",)}, 1), ({**retained, "app": ("restored",)}, 1)])
        with patch.object(smoke, "owned_bridge_forwarder"):
            fixture.exercise()
        self.assertEqual(fixture.compose.call_args_list[0].args,
            ("candidate", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "app"))
        self.assertEqual(fixture.compose.call_args_list[1].args[0], "baseline")
        self.assertTrue(fixture.receipt["checks"]["rollback"]["retainedServicesUnchanged"])
        self.assertEqual(fixture.receipt["checks"]["injectedFailure"], {"candidateStopped": True, "ingressStatus": 502})
        fixture._confirm_candidate_stopped.assert_called_once()

        fixture.compose.reset_mock()
        drift = {**retained, "app": ("new",), "worker": ("unexpected",)}
        fixture._observe.side_effect = [(retained, 1), (drift, 1)]
        with patch.object(smoke, "owned_bridge_forwarder"), self.assertRaisesRegex(SwitchConflict, "changed a retained service"):
            fixture.exercise()
        fixture.compose.assert_called_once()

        fixture.compose.reset_mock()
        fixture._observe.side_effect = [(retained, 1), ({**retained, "app": ("new",)}, 1)]
        fixture._confirm_candidate_stopped.side_effect = SwitchConflict("unconfirmed failure")
        with patch.object(smoke, "owned_bridge_forwarder"), self.assertRaisesRegex(SwitchConflict, "unconfirmed failure"):
            fixture.exercise()
        fixture.compose.assert_called_once()

    def _runtime_rows(self, phase="baseline"):
        rows = {}
        for service in self.baseline:
            running = service in smoke.LONG_RUNNING
            rows[service] = {"Id": service, "Image": phase + service, "RestartCount": 0,
                             "State": {"Running": running, "Status": "running" if running else "exited", "ExitCode": 0,
                                       "StartedAt": "fixture"}}
        for service in ("postgres", "app", "ws"):
            rows[service]["State"]["Health"] = {"Status": "healthy"}
        return rows

    def test_runtime_waits_for_installed_health_and_rejects_unhealthy_or_failed_one_shot(self):
        fixture = smoke.FreshSmoke(Mock(), self.directory, self.baseline, self.candidate)
        ready = self._runtime_rows()
        starting = deepcopy(ready)
        starting["ws"]["State"]["Health"]["Status"] = "starting"
        fixture.images = {"baseline": {name: row["Image"] for name, row in ready.items()}}
        fixture._rows = Mock(side_effect=[starting, ready])
        with patch.object(smoke.time, "sleep") as sleep:
            self.assertEqual(fixture._ready_rows("baseline"), ready)
        sleep.assert_called_once()

        for name, path, value, message in (("ws", ("Health", "Status"), "unhealthy", "healthcheck"),
                                           ("migrate", ("ExitCode",), 1, "identity or state")):
            rows = deepcopy(ready)
            state = rows[name]["State"]
            for key in path[:-1]:
                state = state[key]
            state[path[-1]] = value
            fixture._rows.side_effect = None
            fixture._rows.return_value = rows
            with self.subTest(name=name), self.assertRaisesRegex(SwitchConflict, message):
                fixture._ready_rows("baseline")

    def test_worker_and_realtime_require_real_protocol_receipts(self):
        fixture = smoke.FreshSmoke(Mock(), self.directory, self.baseline, self.candidate)
        fixture._ready_rows = Mock(return_value=self._runtime_rows())
        fixture._bun_probe = Mock(side_effect=[{"unauthenticatedCloseCode": 4401}, {"completed": True}])
        self.assertEqual(fixture._baseline_readiness(), {"realtimeCloseCode": 4401, "workerFileReaperCompleted": True})
        self.assertEqual(fixture._bun_probe.call_args_list[0].args[1], smoke.WS_PROBE)
        self.assertIn("boss.findJobs", fixture._bun_probe.call_args_list[1].args[1])
        fixture._bun_probe.side_effect = [{"unauthenticatedCloseCode": 4401}, {"registered": True}]
        with self.assertRaisesRegex(SwitchConflict, "Worker did not consume"):
            fixture._baseline_readiness()

    def _budgeted_storage_fixture(self, client="mc"):
        docker = Mock()
        parent = "warpdrivequalificationabcdef012345.slice"
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate,
                                   storage_client_bin=client, cgroup_parent=parent)
        fixture._verify_configuration = Mock()
        fixture._rows = Mock(return_value={"minio": {"Image": "owned-storage"}})
        fixture.images = {"baseline": {"minio": "owned-storage", "createbuckets": "owned-client"}}
        fixture.storage_env = self.directory / "storage.env"
        row = {}
        identifier = "f" * 64

        def run(arguments, **_options):
            output = ""
            if arguments[0] == "create":
                memory, cpus, pids = smoke.RESOURCE_LIMITS["createbuckets"]
                row.update(Id=identifier, Name="/" + arguments[arguments.index("--name") + 1], Image="owned-client",
                    Config={"Labels": {smoke.OWNER: fixture.project, smoke.SERVICE: "fixture-storage-client"},
                            "Env": [key + "=" for key in sorted(smoke.STORAGE_FILE_DEFAULTS)] + [smoke.STORAGE_CLIENT_ENV + "=" + client],
                            "Volumes": {"/data": {}}},
                    HostConfig={"Memory": memory, "MemorySwap": memory, "NanoCpus": int(cpus * 10**9),
                                "PidsLimit": pids, "CgroupParent": parent, "NetworkMode": fixture.network,
                                "PortBindings": {}, "AutoRemove": False, "OomKillDisable": False,
                                "Tmpfs": dict([smoke.STORAGE_CLIENT_DATA_TMPFS.split(":", 1)]),
                                "ReadonlyRootfs": False, "Privileged": False},
                    State={"Running": False, "Status": "created"}, Mounts=[])
                output = identifier
            elif arguments[0] == "start":
                self.assertEqual(arguments, ["start", "--attach", identifier])
                row["State"] = {"Running": False, "Status": "exited", "ExitCode": 0, "OOMKilled": False}
                row["HostConfig"]["OomKillDisable"] = None
                output = fixture.object_bytes.decode()
            elif arguments[0] == "wait":
                self.assertEqual(arguments, ["wait", identifier])
                output = "0\n"
            elif arguments[:2] == ["container", "rm"]:
                self.assertEqual(arguments, ["container", "rm", identifier])
                output = identifier
            else:
                self.fail("Unexpected storage helper command")
            return SimpleNamespace(returncode=0, stdout=output)

        docker.run.side_effect = run
        docker.json.side_effect = lambda arguments, **_options: [deepcopy(row)] if arguments == ["container", "inspect", identifier] else self.fail("Unexpected inspect")
        return fixture, docker, row

    def test_transient_storage_probe_has_the_same_finite_resource_budget(self):
        selected_parent = "warpdrivequalificationabcdef012345.slice"
        for client, parent in (("mc", None), ("mcli", None), ("mc", selected_parent), ("mcli", selected_parent)):
            docker = Mock()
            fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate,
                                       storage_client_bin=client, cgroup_parent=parent)
            fixture._verify_configuration = Mock()
            fixture._rows = Mock(return_value={"minio": {"Image": "owned-storage"}})
            fixture.images = {"baseline": {"minio": "owned-storage", "createbuckets": "owned-client"}}
            fixture.storage_env = self.directory / "storage.env"
            docker.run.return_value.stdout = fixture.object_bytes.decode()
            if parent is not None:
                fixture, docker, _ = self._budgeted_storage_fixture(client)
            for mode in ("seed", "read"):
                docker.run.reset_mock()
                docker.json.reset_mock()
                fixture._object(mode)
                args = docker.run.call_args_list[0].args[0]
                memory, cpus, pids = smoke.RESOURCE_LIMITS["createbuckets"]
                for option, value in (("--memory", memory), ("--memory-swap", memory), ("--cpus", cpus), ("--pids-limit", pids)):
                    self.assertEqual(args[args.index(option) + 1], str(value))
                self.assertEqual(args[args.index("--pull") + 1], "never")
                self.assertEqual(args[args.index("--tmpfs") + 1], smoke.STORAGE_CLIENT_DATA_TMPFS)
                if parent is None:
                    self.assertNotIn("--cgroup-parent", args)
                else:
                    self.assertEqual(args[args.index("--cgroup-parent") + 1], parent)
                    self.assertEqual([call.args[0][0] for call in docker.run.call_args_list], ["create", "start", "wait", "container"])
                    self.assertEqual(docker.json.call_count, 2)
                    self.assertIn(f"{smoke.SERVICE}=fixture-storage-client", args)
                script = args[-1]
                selected = '"$WARPDRIVE_STORAGE_CLIENT_BIN" --config-dir /tmp/warpdrive-fixture-client '
                self.assertIn(smoke.STORAGE_CLIENT_GUARD, script)
                self.assertIn(selected + "alias set", script)
                self.assertIn(selected + "cat", script)
                self.assertEqual(script.count(selected), 3 if mode == "seed" else 2)

    def test_budgeted_storage_client_never_starts_before_identity_and_caps_readback(self):
        changes = ((("HostConfig", "CgroupParent"), "system.slice"), (("HostConfig", "Memory"), 1),
                   (("HostConfig", "MemorySwap"), 1), (("HostConfig", "NanoCpus"), 1),
                   (("HostConfig", "PidsLimit"), 1), (("HostConfig", "NetworkMode"), "production"),
                   (("HostConfig", "OomKillDisable"), True),
                   (("HostConfig", "Privileged"), True), (("HostConfig", "ReadonlyRootfs"), True),
                   (("HostConfig", "Tmpfs"), {}),
                   (("HostConfig", "Tmpfs"), {"/data": "rw,noexec,nosuid,size=16m"}),
                   (("HostConfig", "Tmpfs"), {"/data": "rw,nosuid,size=8m"}),
                   (("HostConfig", "Tmpfs"), {"/data": "rw,noexec,size=8m"}),
                   (("HostConfig", "Tmpfs"), {"/data": "ro,noexec,nosuid,size=8m"}),
                   (("HostConfig", "Tmpfs"), {"/data": "rw,noexec,nosuid,size=8m", "/extra": "rw,size=1m"}),
                   (("HostConfig", "Binds"), ["/production:/data"]),
                   (("HostConfig", "Mounts"), [{"Type": "volume", "Target": "/data"}]),
                   (("State", "Running"), True), (("State", "Status"), "running"),
                   (("Id",), "e" * 64), (("Name",), "/foreign"), (("Image",), "foreign-image"),
                   (("Config", "Volumes"), {"/unreviewed": {}}),
                   (("Mounts",), [{"Type": "volume", "Name": "anonymous", "Destination": "/data", "RW": True}]),
                   (("Mounts",), [{"Type": "bind", "Source": "/production", "Destination": "/data", "RW": True}]),
                   (("Mounts",), [{"Type": "tmpfs", "Destination": "/data", "RW": False}]),
                   (("Mounts",), [{"Type": "tmpfs", "Destination": "/other", "RW": True}]),
                   (("Config", "Labels", smoke.OWNER), "foreign"),
                   (("Config", "Labels", smoke.SERVICE), "createbuckets"))
        for path, value in changes:
            fixture, docker, row = self._budgeted_storage_fixture()

            def inspect(_args, **_options):
                changed = deepcopy(row)
                selected = changed
                for key in path[:-1]:
                    selected = selected[key]
                selected[path[-1]] = value
                return [changed]

            docker.json.side_effect = inspect
            with self.subTest(path=path), self.assertRaises(smoke.FreshMutationUnknown):
                fixture._object("seed")
            self.assertEqual([call.args[0][0] for call in docker.run.call_args_list], ["create"])

    def test_budgeted_client_file_and_selection_guards_hold_before_first_start(self):
        for client in ("mc", "mcli"):
            for change in ("missing", "relative", "absolute", "new-minio-file", "new-external-file", "duplicate", "selection"):
                fixture, docker, row = self._budgeted_storage_fixture(client)

                def inspect(_args, **_options):
                    changed = deepcopy(row)
                    env = changed["Config"]["Env"]
                    if change == "missing":
                        changed["Config"]["Env"] = [v for v in env if not v.startswith("MINIO_ACCESS_KEY_FILE=")]
                    elif change in {"relative", "absolute"}:
                        changed["Config"]["Env"] = [v for v in env if not v.startswith("MINIO_ACCESS_KEY_FILE=")] + [
                            "MINIO_ACCESS_KEY_FILE=" + ("relative-default" if change == "relative" else "/run/secret")]
                    elif change == "new-minio-file":
                        env.append("MINIO_EXTRA_FILE=")
                    elif change == "new-external-file":
                        env.append("EXTERNAL_SECRET_FILE=/run/secret")
                    elif change == "duplicate":
                        env.append("MINIO_ACCESS_KEY_FILE=")
                    else:
                        changed["Config"]["Env"] = [v for v in env if not v.startswith(smoke.STORAGE_CLIENT_ENV + "=")] + [
                            smoke.STORAGE_CLIENT_ENV + "=other"]
                    return [changed]

                docker.json.side_effect = inspect
                with self.subTest(client=client, change=change), self.assertRaises(smoke.FreshMutationUnknown):
                    fixture._object("seed")
                self.assertEqual([call.args[0][0] for call in docker.run.call_args_list], ["create"])

    def test_budgeted_storage_client_accepts_only_the_proven_oom_default_transition(self):
        missing = object()
        for before, after in ((False, None), (False, False), (None, None), (True, None),
                              (False, True), (None, False), (False, 0), (False, missing)):
            fixture, docker, row = self._budgeted_storage_fixture()
            inspections = []

            def inspect(_args, **_options):
                changed = deepcopy(row)
                selected = before if not inspections else after
                if selected is missing:
                    del changed["HostConfig"]["OomKillDisable"]
                else:
                    changed["HostConfig"]["OomKillDisable"] = selected
                inspections.append(changed)
                return [changed]

            docker.json.side_effect = inspect
            allowed = before is False and (after is False or after is None) or before is None and after is None
            with self.subTest(before=before, after="missing" if after is missing else after):
                if allowed:
                    fixture._object("seed")
                    self.assertEqual(docker.run.call_args.args[0][0:2], ["container", "rm"])
                    self.assertIs(inspections[0]["HostConfig"]["OomKillDisable"], before)
                    self.assertIs(inspections[1]["HostConfig"]["OomKillDisable"], after)
                else:
                    with self.assertRaises(smoke.FreshMutationUnknown):
                        fixture._object("seed")
                    self.assertFalse(any(call.args[0][0:2] == ["container", "rm"] for call in docker.run.call_args_list))

    def test_budgeted_storage_client_only_accepts_empty_or_exact_tmpfs_data_mount_inventory(self):
        for declared in (None, {}, {"/data": {}}):
            for mounts in ([], [{"Type": "tmpfs", "Destination": "/data", "RW": True, "Source": "", "Name": ""}]):
                fixture, docker, row = self._budgeted_storage_fixture()

                def inspect(_args, **_options):
                    changed = deepcopy(row)
                    if declared is None:
                        del changed["Config"]["Volumes"]
                    else:
                        changed["Config"]["Volumes"] = declared
                    changed["Mounts"] = deepcopy(mounts)
                    return [changed]

                docker.json.side_effect = inspect
                with self.subTest(declared=declared, mounts=mounts):
                    fixture._object("read")
                self.assertEqual(docker.run.call_args.args[0][0:2], ["container", "rm"])

    def test_budgeted_storage_client_holds_lost_or_invalid_acknowledgements_without_retry(self):
        for stage in ("create", "start", "wait", "container"):
            for failure in ("lost", "nonzero", "malformed"):
                if stage == "start" and failure == "malformed":
                    continue  # Its bounded stdout is checked after independent terminal readback.
                fixture, docker, _ = self._budgeted_storage_fixture()
                original = docker.run.side_effect

                def run(arguments, **options):
                    result = original(arguments, **options)
                    if arguments[0] == stage:
                        if failure == "lost":
                            raise smoke.SmokeError("Synthetic lost daemon acknowledgement")
                        if failure == "nonzero":
                            result.returncode = 1
                        else:
                            result.stdout = "ambiguous"
                    return result

                docker.run.side_effect = run
                with self.subTest(stage=stage, failure=failure), self.assertRaises(smoke.FreshMutationUnknown):
                    fixture._object("seed")
                commands = [call.args[0][0] for call in docker.run.call_args_list]
                self.assertEqual(commands, ["create", "start", "wait", "container"][:commands.index(stage) + 1])

    def test_budgeted_storage_client_rechecks_ownership_and_parent_before_removal(self):
        for change in ("parent", "label", "image", "exit", "memory", "environment", "command", "tmpfs", "mount"):
            fixture, docker, row = self._budgeted_storage_fixture()
            inspections = 0

            def inspect(_args, **_options):
                nonlocal inspections
                inspections += 1
                changed = deepcopy(row)
                if inspections == 2:
                    if change == "parent":
                        changed["HostConfig"]["CgroupParent"] = "system.slice"
                    elif change == "label":
                        changed["Config"]["Labels"][smoke.OWNER] = "foreign"
                    elif change == "image":
                        changed["Image"] = "foreign-image"
                    elif change == "memory":
                        changed["HostConfig"]["Memory"] += 1
                    elif change == "environment":
                        changed["Config"]["Env"] = ["UNREVIEWED=true"]
                    elif change == "command":
                        changed["Config"]["Cmd"] = ["unreviewed"]
                    elif change == "tmpfs":
                        changed["HostConfig"]["Tmpfs"] = {"/data": "rw,noexec,nosuid,size=16m"}
                    elif change == "mount":
                        changed["Mounts"] = [{"Type": "volume", "Name": "anonymous", "Destination": "/data", "RW": True}]
                    else:
                        changed["State"]["ExitCode"] = 137
                return [changed]

            docker.json.side_effect = inspect
            with self.subTest(change=change), self.assertRaises(smoke.FreshMutationUnknown):
                fixture._object("seed")
            self.assertEqual([call.args[0][0] for call in docker.run.call_args_list], ["create", "start", "wait"])

    def test_exact_candidate_stop_demands_caddy_failure_before_restore(self):
        docker = Mock()
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate)
        rows = self._runtime_rows("candidate")
        admitted = fixture._witness(rows)
        fixture._ready_rows = Mock(return_value=rows)
        stopped = deepcopy(rows)
        stopped["app"]["State"].update(Running=False, Status="exited")
        fixture._rows = Mock(return_value=stopped)
        fixture._public_response = Mock(return_value=(502, b""))
        relay = SimpleNamespace(authority="127.0.0.1:1234")
        self.assertEqual(fixture._confirm_candidate_stopped(relay, admitted), {"candidateStopped": True, "ingressStatus": 502})
        docker.run.assert_called_once_with(["stop", "--time", "20", "app"], timeout=30)
        fixture._public_response.return_value = (200, b"")
        with self.assertRaisesRegex(SwitchConflict, "not proven through"):
            fixture._confirm_candidate_stopped(relay, admitted)
        docker.run.reset_mock()
        rows["worker"]["RestartCount"] = 1
        with self.assertRaisesRegex(SwitchConflict, "before failure injection"):
            fixture._confirm_candidate_stopped(relay, admitted)
        docker.run.assert_not_called()

    def test_changed_candidate_other_than_web_holds_before_native_work(self):
        before = {"services": {name: {"image": ref} for name, ref in self.baseline.items()}}
        after = deepcopy(before)
        after["services"]["app"]["image"] = self.candidate["app"]
        after["services"]["ws"]["environment"] = {"INJECTED": "true"}
        with self.assertRaisesRegex(SwitchConflict, "another effective Compose setting"):
            smoke._same_except_web(before, after)

    def test_cleanup_refuses_external_reference_before_removing_anything(self):
        docker = Mock()
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate)
        fixture._ids = Mock(return_value=[])
        volume = next(iter(fixture.volume_names))
        fixture._resources = Mock(side_effect=lambda kind: [volume] if kind == "volume" else [])
        docker.json.return_value = [{"Name": volume, "Labels": {smoke.OWNER: fixture.project}, "Driver": "local"}]
        docker.run.return_value.stdout = "e" * 64 + "\n"
        with self.assertRaisesRegex(SwitchConflict, "foreign references"):
            fixture.cleanup()
        self.assertEqual(docker.run.call_args.args[0][:2], ["ps", "-a"])
        docker.run.assert_called_once()

    def _cleanup_fixture(self, *, lose_stop_reply=False):
        docker = Mock()
        fixture = smoke.FreshSmoke(docker, self.directory, self.baseline, self.candidate)
        images = {name: "sha256:" + f"{index + 100:064x}" for index, name in enumerate(self.baseline)}
        fixture.images = {"baseline": images, "candidate": {**images, "app": "sha256:" + "f" * 64}}
        live = {}
        for index, name in enumerate(self.baseline):
            live[f"{index + 1:064x}"] = {
                "Id": f"{index + 1:064x}", "Image": images[name],
                "Config": {"Labels": {smoke.OWNER: fixture.project, smoke.SERVICE: name}},
                "State": {"Running": name in smoke.LONG_RUNNING, "Status": "running" if name in smoke.LONG_RUNNING else "exited", "ExitCode": 0},
            }
        calls = []
        fixture._ids = Mock(side_effect=lambda: list(live))
        fixture._resources = Mock(return_value=[])

        def inspect(arguments, **_options):
            self.assertEqual(arguments[:2], ["container", "inspect"])
            return [deepcopy(live[identifier]) for identifier in arguments[2:]]

        def run(arguments, **options):
            calls.append((arguments, options))
            if arguments[0] == "stop":
                row = live[arguments[-1]]
                row["State"].update(Running=False, Status="exited")
                if lose_stop_reply and row["Config"]["Labels"][smoke.SERVICE] == "worker":
                    raise smoke.SmokeError("injected lost stop reply")
            elif arguments[:2] == ["container", "rm"]:
                self.assertTrue(all(not row["State"]["Running"] for row in live.values()))
                live.pop(arguments[-1])
            else:
                self.fail("Unexpected destructive Docker operation")

        docker.json.side_effect = inspect
        docker.run.side_effect = run
        return fixture, live, calls

    def test_cleanup_drains_ingress_then_writers_then_storage_with_worker_budget(self):
        fixture, live, calls = self._cleanup_fixture()
        service_ids = {row["Id"]: row["Config"]["Labels"][smoke.SERVICE] for row in live.values()}
        fixture.cleanup()
        self.assertFalse(live)
        stops = [(service_ids[args[-1]], args, options) for args, options in calls if args[0] == "stop"]
        names = [name for name, _, _ in stops]
        self.assertEqual(names[0], "caddy")
        writers = [names.index(name) for name in ("app", "ws", "worker", "newsletter-engine")]
        self.assertLess(max(writers), min(names.index(name) for name in ("postgres", "minio")))
        _, worker, limits = next(item for item in stops if item[0] == "worker")
        self.assertEqual(worker[1:3], ["--time", "75"])
        self.assertEqual(limits["timeout"], 85)
        self.assertEqual(len(fixture.receipt["checks"]["cleanupDrain"]), len(smoke.LONG_RUNNING))

    def test_unknown_stop_acknowledgement_retains_all_containers_and_storage(self):
        fixture, live, calls = self._cleanup_fixture(lose_stop_reply=True)
        original_ids = set(live)
        with self.assertRaisesRegex(SwitchConflict, "acknowledgement is unknown"):
            fixture.cleanup()
        self.assertEqual(set(live), original_ids)
        self.assertTrue(all(args[0] == "stop" for args, _ in calls))
        self.assertTrue(all(live[identifier]["State"]["Running"] for identifier in live
                            if live[identifier]["Config"]["Labels"][smoke.SERVICE] in ("postgres", "minio")))

    def _run_fixture(self, directory, *, cleanup_error=None, preflight_error=None):
        fixture = Mock()
        fixture.receipt = {"success": False, "cleanupSuccess": False, "checks": {}}
        fixture.prepare.side_effect = lambda: smoke._write_env(directory / ".env", {"PASSWORD": "fixture-value-only"})
        fixture._require_empty.side_effect = preflight_error
        fixture.cleanup.side_effect = cleanup_error
        fixture.failure_diagnostics.return_value = {"errorType": "SwitchConflict"}
        return fixture

    def test_first_failure_diagnostics_exclude_config_and_secret_values(self):
        fixture = smoke.FreshSmoke(Mock(), self.directory, self.baseline, self.candidate)
        secret = "synthetic-sensitive-value-12345"
        fixture.secret_values = (secret,)
        fixture._rows = Mock(return_value={"app": {"Config": {"Env": ["TOKEN=" + secret]},
            "State": {"Status": "exited", "ExitCode": 1, "OOMKilled": False,
                      "Health": {"Status": "unhealthy", "Log": [{"Output": secret}]}}}})
        result = fixture.failure_diagnostics(SwitchConflict("Fixture failed " + secret))
        encoded = smoke.canonical(result).decode()
        self.assertNotIn(secret, encoded)
        self.assertNotIn("Env", encoded)
        self.assertNotIn("Log", encoded)
        self.assertEqual(result["services"]["app"]["exitCode"], 1)
        fixture._rows.side_effect = SwitchConflict("unowned")
        self.assertEqual(fixture.failure_diagnostics(OSError(secret)),
                         {"errorType": "OSError", "inspection": "unavailable-or-unowned"})

    def test_unknown_compose_completion_retains_configuration_without_cleanup_or_retry(self):
        for failure in (smoke.FreshMutationUnknown("unknown"), smoke.FreshCommandUnknown("child unknown")):
            with self.subTest(failure=type(failure).__name__):
                directory = self.directory / type(failure).__name__
                directory.mkdir(mode=0o700)
                fixture = self._run_fixture(directory)
                fixture.exercise.side_effect = failure
                with patch.object(smoke, "_native_host"), patch.object(smoke, "Docker") as docker, \
                        patch.object(smoke, "mkdtemp", return_value=str(directory)), \
                        patch.object(smoke, "FreshSmoke", return_value=fixture), \
                        patch.object(smoke.signal, "signal"), patch.object(smoke.signal, "alarm"):
                    result = smoke.run(self.baseline, self.candidate)
                docker.assert_called_once_with(runner=smoke.run_owned_fixture_command)
                fixture.exercise.assert_called_once()
                fixture.cleanup.assert_not_called()
                fixture.failure_diagnostics.assert_not_called()
                self.assertFalse(result["success"])
                self.assertFalse(result["cleanupSuccess"])
                self.assertTrue(result["manualReconciliationRequired"])
                self.assertEqual(result["mutationCompletionUnknown"], isinstance(failure, smoke.FreshMutationUnknown))
                self.assertEqual(result["retainedFixtureDirectory"], str(directory))
                self.assertEqual((directory / ".env").stat().st_mode & 0o777, 0o600)

    def test_compose_nonzero_interruption_and_lost_reply_are_mutation_holds(self):
        fixture = smoke.FreshSmoke(Mock(), self.directory, self.baseline, self.candidate)
        fixture._verify_configuration = Mock()
        for failure in (smoke.SmokeError("connection lost"), smoke.FreshCommandUnknown("deadline"),
                        KeyboardInterrupt(), SwitchConflict("outer deadline")):
            with self.subTest(failure=type(failure).__name__):
                fixture.docker.run.side_effect = failure
                with self.assertRaises(smoke.FreshMutationUnknown):
                    fixture.compose("baseline", "--profile", "fresh", "up", "--detach")
        fixture.docker.run.side_effect = None
        fixture.docker.run.return_value = subprocess.CompletedProcess([], 1, "", "")
        with self.assertRaises(smoke.FreshMutationUnknown):
            fixture.compose("baseline", "up", "--detach")
        fixture.docker.run.side_effect = smoke.SmokeError("invalid config")
        with self.assertRaises(smoke.SmokeError) as raised:
            fixture.compose("baseline", "config", "--format", "json")
        self.assertNotIsInstance(raised.exception, smoke.FreshCommandUnknown)

    def test_run_retains_private_configuration_when_cleanup_is_unknown(self):
        directory = self.directory / "held"
        directory.mkdir(mode=0o700)
        fixture = self._run_fixture(directory, cleanup_error=SwitchConflict("unknown fixture state"))
        with patch.object(smoke, "_native_host"), patch.object(smoke, "Docker"), \
                patch.object(smoke, "mkdtemp", return_value=str(directory)), \
                patch.object(smoke, "FreshSmoke", return_value=fixture), \
                patch.object(smoke.signal, "signal"), patch.object(smoke.signal, "alarm"):
            result = smoke.run(self.baseline, self.candidate)
        self.assertFalse(result["success"])
        self.assertFalse(result["cleanupSuccess"])
        self.assertEqual(result["retainedFixtureDirectory"], str(directory))
        self.assertEqual((directory / ".env").stat().st_mode & 0o777, 0o600)
        fixture.cleanup.assert_called_once()

    def test_preflight_collision_never_arms_destructive_cleanup(self):
        directory = self.directory / "preflight"
        directory.mkdir(mode=0o700)
        fixture = self._run_fixture(directory, preflight_error=SwitchConflict("existing foreign project"))
        with patch.object(smoke, "_native_host"), patch.object(smoke, "Docker"), \
                patch.object(smoke, "mkdtemp", return_value=str(directory)), \
                patch.object(smoke, "FreshSmoke", return_value=fixture), \
                patch.object(smoke.signal, "signal"), patch.object(smoke.signal, "alarm"):
            result = smoke.run(self.baseline, self.candidate)
        fixture.exercise.assert_not_called()
        fixture.cleanup.assert_not_called()
        self.assertFalse(result["success"])
        self.assertTrue(result["cleanupSuccess"])
        self.assertFalse(result["cleanupArmed"])
        self.assertFalse(directory.exists())

    def test_successful_cleanup_removes_only_the_owned_fixture_configuration(self):
        directory = self.directory / "finished"
        directory.mkdir(mode=0o700)
        fixture = self._run_fixture(directory)
        with patch.object(smoke, "_native_host"), patch.object(smoke, "Docker"), \
                patch.object(smoke, "mkdtemp", return_value=str(directory)), \
                patch.object(smoke, "FreshSmoke", return_value=fixture), \
                patch.object(smoke.signal, "signal"), patch.object(smoke.signal, "alarm"):
            result = smoke.run(self.baseline, self.candidate)
        self.assertTrue(result["success"])
        self.assertTrue(result["cleanupSuccess"])
        self.assertTrue(result["cleanupArmed"])
        self.assertFalse(directory.exists())


class OwnedFixtureCommandTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory(prefix="wd-command-test-"))).resolve()

    def test_exact_binary_input_output_and_nonzero_completion(self):
        code = "import sys; data=sys.stdin.buffer.read(); sys.stdout.buffer.write(data); sys.stderr.write('bounded'); sys.exit(3)"
        result = smoke.run_owned_fixture_command([sys.executable, "-c", code], timeout=4, text=False, input=b"fixture\x00bytes")
        self.assertEqual((result.returncode, result.stdout, result.stderr), (3, b"fixture\x00bytes", b"bounded"))

    def _assert_children_stopped(self, path):
        self.assertTrue(path.is_file(), "Test child did not establish its private PID witness")
        for pid in map(int, path.read_text().split()):
            row = smoke._command_processes().get(pid)
            self.assertTrue(row is None or row["state"].startswith("Z"), f"Owned test child remains live: {pid}")

    def test_timeout_stops_the_owned_leader_and_child(self):
        witness = self.directory / "timeout.pids"
        code = ("import os,subprocess,sys,time; "
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)']); "
                "open(sys.argv[1],'w').write(str(os.getpid())+' '+str(child.pid)); time.sleep(20)")
        with self.assertRaises(smoke.FreshCommandUnknown):
            smoke.run_owned_fixture_command([sys.executable, "-c", code, str(witness)], timeout=0.6)
        self._assert_children_stopped(witness)

    def test_successful_leader_with_detached_live_child_is_unknown_and_stopped(self):
        witness = self.directory / "orphan.pids"
        code = ("import os,subprocess,sys; "
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],"
                "stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); "
                "open(sys.argv[1],'w').write(str(os.getpid())+' '+str(child.pid))")
        with self.assertRaisesRegex(smoke.FreshCommandUnknown, "live descendants"):
            smoke.run_owned_fixture_command([sys.executable, "-c", code, str(witness)], timeout=4)
        self._assert_children_stopped(witness)

    def test_output_overrun_and_interrupted_wait_do_not_report_completion(self):
        with patch.object(smoke, "COMMAND_STDOUT_BYTES", 32):
            with self.assertRaisesRegex(smoke.FreshCommandUnknown, "output exceeded"):
                smoke.run_owned_fixture_command([sys.executable, "-c", "print('x'*128)"], timeout=4)
        original = smoke.select.select
        interrupted = False

        def interrupt_once(*arguments):
            nonlocal interrupted
            if not interrupted:
                interrupted = True
                raise KeyboardInterrupt()
            return original(*arguments)

        with patch.object(smoke.select, "select", side_effect=interrupt_once):
            with self.assertRaisesRegex(smoke.FreshCommandUnknown, "execution or cleanup is unknown"):
                smoke.run_owned_fixture_command([sys.executable, "-c", "import time; time.sleep(20)"], timeout=4)

    def _row(self, *, pid=8123, parent=1, group=8123, uid=None, birth="original", state="S"):
        return {"pid": pid, "parent": parent, "group": group, "uid": os.geteuid() if uid is None else uid,
                "birth": birth, "state": state}

    def test_unrelated_foreign_uid_is_not_read_even_if_environment_is_denied(self):
        row = self._row(group=99, uid=os.geteuid() + 1)
        with patch.object(smoke, "_command_processes", return_value={row["pid"]: row}), \
                patch.object(smoke, "_command_token", side_effect=PermissionError("foreign environ")) as token:
            self.assertEqual(smoke._owned_command_rows(123, "owned", {}, {}), {})
        token.assert_not_called()

    def test_unreadable_same_group_is_held_and_known_pid_does_not_replace_token(self):
        row = self._row()
        for actual in (None, "foreign"):
            with self.subTest(actual=actual), patch.object(smoke, "_command_processes", return_value={row["pid"]: row}), \
                    patch.object(smoke, "_command_token", return_value=actual):
                with self.assertRaisesRegex(smoke.FreshCommandUnknown, "ownership"):
                    smoke._owned_command_rows(row["group"], "owned", {}, {row["pid"]: row["birth"]})

    def test_denied_same_group_environment_is_a_distinct_unknown(self):
        row = self._row()
        with patch.object(smoke.sys, "platform", "linux"), \
                patch.object(smoke, "_command_processes", return_value={row["pid"]: row}), \
                patch.object(smoke.Path, "open", side_effect=PermissionError("denied")):
            with self.assertRaisesRegex(smoke.FreshCommandUnknown, "cannot be inspected"):
                smoke._owned_command_rows(row["group"], "owned", {}, {})

    def test_pid_reuse_or_token_change_never_signals_replacement(self):
        original = self._row()
        for current, token in (({**original, "birth": "reused"}, "owned"), (original, "foreign")):
            with self.subTest(current=current, token=token), patch.object(smoke.sys, "platform", "darwin"), \
                    patch.object(smoke, "_command_processes", return_value={original["pid"]: current}), \
                    patch.object(smoke, "_command_token", return_value=token), patch.object(smoke.os, "kill") as kill:
                with self.assertRaisesRegex(smoke.FreshCommandUnknown, "PID identity changed"):
                    smoke._signal_command_pid(original, "owned", signal.SIGTERM)
            kill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
