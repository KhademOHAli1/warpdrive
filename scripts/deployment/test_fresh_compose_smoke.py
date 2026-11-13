"""Qualify the generated fresh smoke model and fail-closed orchestration without Docker runtime."""

from copy import deepcopy
from hashlib import sha256
import io
import os
from pathlib import Path
import shutil
import stat
import subprocess
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

        def config_only(argv, *, timeout):
            self.assertEqual(argv[-3:], ["config", "--format", "json"])
            return subprocess.run([docker, *argv], capture_output=True, text=True, timeout=timeout,
                                  env={"PATH": "/usr/bin:/bin", "DOCKER_HOST": "unix:///dev/null"}, check=True)

        fixture = smoke.FreshSmoke(SimpleNamespace(run=config_only), self.directory, self.baseline, self.candidate)
        fixture.prepare()
        self.assertEqual(set(fixture.receipt["checks"]["model"]), {"baseline", "candidate"})
        self.assertEqual((self.directory / "Caddyfile").read_text(), smoke.TLS)
        self.assertNotIn("ACME", smoke.TLS)
        self.assertIn("admin off", smoke.TLS)
        self.assertIn("ports: !reset []", fixture.overlay.read_text())
        self.assertEqual([path.read_bytes() for path in fixture.compose_files], [(smoke.ROOT / name).read_bytes() for name in smoke.COMPOSE])
        self.assertTrue(all(path.is_relative_to(self.directory) for path in fixture.compose_files))
        self.assertEqual(len(fixture.receipt["checks"]["configurationSha256"]), 64)

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


if __name__ == "__main__":
    unittest.main()
