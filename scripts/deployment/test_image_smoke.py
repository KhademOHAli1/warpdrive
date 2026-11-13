"""Behavioral tests for smoke admission, resource ownership and failure reporting.

No daemon, image, database or application is started by this test module.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

try:
    from . import image_smoke as smoke
    from .registry_smoke import IsolatedDocker
except ImportError:
    import image_smoke as smoke
    from registry_smoke import IsolatedDocker


SHA = "a" * 40
IMAGE_ID = "sha256:" + "b" * 64


def inspected_image(user="bun", revision=SHA):
    return [{"Id": IMAGE_ID, "Config": {"User": user, "Labels": {
        "org.opencontainers.image.revision": revision,
    }}, "RepoDigests": []}]


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.owner = None
        self.foreign = False
        self.inspect_failure = False
        self.remove_failure = False
        self.missing = False
        self.running = True
        self.exit_code = 0
        self.oom = False
        self.fail_run = False

    def run(self, args, **kwargs):
        self.calls.append(args)
        code, stdout, stderr = 0, "", ""
        if args[0] == "run" and self.fail_run:
            raise smoke.SmokeError("Docker run did not complete")
        if len(args) > 1 and args[1] == "inspect":
            if self.missing:
                code, stderr = 1, "Error: No such container: owned"
            elif self.inspect_failure:
                code, stderr = 1, "Cannot connect to the Docker daemon"
            elif ".State" in args[-1]:
                stdout = json.dumps({"Running": self.running, "ExitCode": self.exit_code,
                                     "OOMKilled": self.oom})
            else:
                stdout = json.dumps({smoke.OWNER_LABEL: "someone-else" if self.foreign else self.owner})
        if len(args) > 1 and args[1] == "rm" and self.remove_failure:
            raise smoke.SmokeError("Docker container failed (exit 1)")
        return subprocess.CompletedProcess(args, code, stdout, stderr)

    def json(self, args, **kwargs):
        if args[:2] == ["image", "inspect"]:
            return inspected_image()
        return json.loads(self.run(args, **kwargs).stdout)


def harness(docker=None, output_dir=Path("unused"), **options):
    value = smoke.ImageSmoke(docker or FakeDocker(), {name: f"local/{name}:candidate"
                                                   for name in smoke.COMPONENTS}, output_dir,
                             expected_revision=SHA, **options)
    value.docker.owner = value.prefix
    return value


class AdmissionTests(unittest.TestCase):
    def test_refuses_remote_or_ambiguous_environment_before_any_docker_call(self):
        for name, value in (("DOCKER_HOST", "ssh://production"),
                            ("DOCKER_HOST", "unix:///var/run/docker.sock"),
                            ("DOCKER_CONTEXT", "production"),
                            ("DOCKER_TLS_VERIFY", "1"),
                            ("DOCKER_CERT_PATH", "/private/certs")):
            with self.subTest(name=name, value=value):
                called = []
                with self.assertRaises(smoke.SmokeError):
                    smoke.Docker({name: value}, runner=lambda *a, **k: called.append(a))
                self.assertEqual(called, [])

    def test_requires_local_absolute_unix_socket(self):
        smoke.admit_endpoint("unix:///var/run/docker.sock")
        smoke.admit_endpoint("unix:///Users/smoke/.docker/run/docker.sock")
        for endpoint in ("ssh://vps", "tcp://127.0.0.1:2375", "unix://host/socket",
                         "unix:relative", "unix:///socket?target=vps", ""):
            with self.subTest(endpoint=endpoint), self.assertRaises(smoke.SmokeError):
                smoke.admit_endpoint(endpoint)

    def test_pins_admitted_context_and_does_not_forward_application_credentials(self):
        calls = []

        def runner(command, **kwargs):
            calls.append((command, kwargs))
            output = "desktop-local\n" if command[-2:] == ["context", "show"] else "unix:///var/run/docker.sock\n"
            return subprocess.CompletedProcess(command, 0, output, "")

        docker = smoke.Docker({"PATH": "/bin", "HOME": "/tmp/smoke",
                               "STRIPE_SECRET_KEY": "private", "DATABASE_URL": "private"}, runner)
        docker.run(["version"])
        self.assertEqual(calls[-1][0][:3], ["docker", "--context", "desktop-local"])
        for _, kwargs in calls:
            self.assertNotIn("STRIPE_SECRET_KEY", kwargs["env"])
            self.assertNotIn("DATABASE_URL", kwargs["env"])
            self.assertFalse(kwargs.get("shell", False))

    def test_timeout_does_not_expose_command_arguments(self):
        docker = object.__new__(smoke.Docker)
        docker.context, docker.environment = "local", {}

        def timeout(command, **kwargs):
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])

        docker.runner = timeout
        with self.assertRaises(smoke.SmokeError) as raised:
            docker.run(["run", "--env", "SECRET=hidden"])
        self.assertNotIn("hidden", str(raised.exception))

    def test_finite_binary_stdin_uses_existing_pinned_context_without_text_conversion(self):
        docker = object.__new__(smoke.Docker)
        docker.context, docker.environment = "admitted-local", {"DOCKER_CONFIG": "/owned/empty-auth"}
        docker.runner = Mock(return_value=subprocess.CompletedProcess([], 0, b"", b""))
        body = b"\x00\xff$(not-shell-code)\r\n"
        result = docker.run(["exec", "--interactive", "owned", "cat"], input_bytes=body, timeout=7)
        docker.runner.assert_called_once_with(["docker", "--context", "admitted-local", "exec", "--interactive", "owned", "cat"],
            capture_output=True, text=False, timeout=7, env=docker.environment, check=False, input=body)
        self.assertEqual(result.stdout, b"")

    def test_binary_stdin_preserves_isolated_endpoint_and_empty_auth_configuration(self):
        docker = object.__new__(IsolatedDocker)
        docker.context, docker.endpoint = None, "unix:///owned/docker.sock"
        docker.environment = {"DOCKER_CONFIG": "/owned/empty-auth"}
        docker.runner = Mock(return_value=subprocess.CompletedProcess([], 0, b"", b""))
        docker.run(["exec", "--interactive", "owned", "cat"], input_bytes=b"fixture")
        self.assertEqual(docker.runner.call_args.args[0], ["docker", "--host", "unix:///owned/docker.sock",
            "exec", "--interactive", "owned", "cat"])
        self.assertEqual(docker.runner.call_args.kwargs["env"], {"DOCKER_CONFIG": "/owned/empty-auth"})
        self.assertEqual(docker.runner.call_args.kwargs["input"], b"fixture")

    def test_oversized_or_nonbinary_stdin_rejects_before_spawn(self):
        docker = object.__new__(smoke.Docker)
        docker.context, docker.environment, docker.runner = "local", {}, Mock()
        for body in (b"x" * 8193, "sensitive-nonbinary-input", bytearray(b"content")):
            with self.subTest(kind=type(body).__name__), self.assertRaises(smoke.SmokeError) as raised:
                docker.run(["exec", "owned", "cat"], input_bytes=body)
            self.assertEqual(str(raised.exception), "Docker stdin must be bounded binary data")
        docker.runner.assert_not_called()

    def test_binary_stdin_failure_or_timeout_never_exposes_payload_or_process_output(self):
        docker = object.__new__(smoke.Docker)
        docker.context, docker.environment = "local", {}
        body = b"synthetic-sensitive-body"
        for error in (None, subprocess.TimeoutExpired(["docker", "exec"], 1, output=body), OSError("synthetic-sensitive-body")):
            docker.runner = Mock(return_value=subprocess.CompletedProcess([], 1, body, body), side_effect=error)
            with self.subTest(error=type(error).__name__), self.assertRaises(smoke.SmokeError) as raised:
                docker.run(["exec", "owned", "cat"], input_bytes=body, timeout=1)
            self.assertNotIn(body.decode(), str(raised.exception))

    def test_normal_text_calls_keep_the_existing_runner_and_return_contract(self):
        docker = object.__new__(smoke.Docker)
        docker.context, docker.environment = "local", {}
        docker.runner = Mock(return_value=subprocess.CompletedProcess([], 0, "ordinary text", ""))
        self.assertEqual(docker.run(["version"]).stdout, "ordinary text")
        self.assertNotIn("input", docker.runner.call_args.kwargs)
        self.assertIs(docker.runner.call_args.kwargs["text"], True)

    def test_rejects_flags_shell_fragments_and_abbreviated_revision(self):
        for value in ("--privileged", "image;echo", "image\n--network=host", "$(command)"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                smoke.validate_reference(value)
        self.assertEqual(smoke.validate_reference("ghcr.io/example/web@sha256:" + "a" * 64),
                         "ghcr.io/example/web@sha256:" + "a" * 64)
        with self.assertRaises(ValueError):
            smoke.validate_revision(SHA[:8])

    def test_requires_every_requested_component_and_sustained_window(self):
        with self.assertRaises(ValueError):
            smoke.ImageSmoke(FakeDocker(), {"web": "web:test"}, Path("unused"))
        with self.assertRaises(ValueError):
            harness(stability_seconds=0)


class ImageIdentityTests(unittest.TestCase):
    def test_image_identity_records_local_id_without_claiming_registry_publication(self):
        result = smoke.image_metadata(inspected_image(), SHA)
        self.assertEqual(result["id"], IMAGE_ID)
        self.assertEqual(result["repoDigests"], [])

    def test_root_and_unstamped_or_wrong_source_images_fail(self):
        for user, revision in (("", SHA), ("0:1000", SHA), ("root", SHA),
                               ("bun", ""), ("bun", "b" * 40)):
            with self.subTest(user=user, revision=revision), self.assertRaises(smoke.SmokeError):
                smoke.image_metadata(inspected_image(user, revision), SHA)

    def test_all_images_must_have_the_same_source_revision(self):
        docker = FakeDocker()
        count = 0

        def inspect(args, **kwargs):
            nonlocal count
            count += 1
            return inspected_image(revision=SHA if count == 1 else "c" * 40)

        docker.json = inspect
        value = smoke.ImageSmoke(docker, {name: f"{name}:test" for name in smoke.COMPONENTS}, Path("unused"))
        with self.assertRaises(smoke.SmokeError):
            value.inspect_images()


class ProcessAndCleanupTests(unittest.TestCase):
    def test_only_migration_containers_receive_the_separate_owner_connection(self):
        docker = FakeDocker()
        value = harness(docker)
        value.report["images"]["migrator"] = {"id": IMAGE_ID}
        value.containers["postgres"] = "owned-postgres"
        value.finished = lambda *_: None
        original_run = docker.run

        def run(args, **kwargs):
            result = original_run(args, **kwargs)
            if "-Atc" in args:
                result.stdout = "119\n0\n"
            elif args[0] == "logs":
                result.stdout = json.dumps({"runtimeRole": "smoke_runtime",
                                            "ownerCredentialsRuntime": False, "deniedDdl": 5})
            return result

        docker.run = run
        detail = value.migrations()
        self.assertEqual(detail["deniedDdl"], 5)
        self.assertNotEqual(value.migration_url, value.env["DATABASE_URL"])
        self.assertEqual(value.env["MIGRATION_DATABASE_URL"], "")
        self.assertEqual(value.env["MIGRATION_DATABASE_URL_FILE"], "")
        launches = [args for args in docker.calls if args[0] == "run"]
        self.assertEqual(len(launches), 3)
        for index, args in enumerate(launches):
            environment = dict(args[offset + 1].split("=", 1)
                               for offset, argument in enumerate(args) if argument == "--env")
            self.assertIn("postgres://smoke_runtime:", environment["DATABASE_URL"])
            self.assertEqual(environment["MIGRATION_DATABASE_URL"],
                             value.migration_url if index < 2 else "")
            self.assertEqual(environment["MIGRATION_DATABASE_URL_FILE"], "")
        serialized = json.dumps(detail)
        self.assertNotIn(value.runtime_password, serialized)
        self.assertNotIn(value.migration_url, serialized)

    def test_runtime_privilege_proof_is_required_after_owner_migration(self):
        docker = FakeDocker()
        value = harness(docker)
        value.report["images"]["migrator"] = {"id": IMAGE_ID}
        value.containers["postgres"] = "owned-postgres"
        value.finished = lambda *_: None
        original_run = docker.run

        def run(args, **kwargs):
            result = original_run(args, **kwargs)
            if "-Atc" in args:
                result.stdout = "119\n0\n"
            elif args[0] == "logs":
                result.stdout = json.dumps({"runtimeRole": "smoke_runtime",
                                            "ownerCredentialsRuntime": False, "deniedDdl": 4})
            return result

        docker.run = run
        with self.assertRaisesRegex(smoke.SmokeError, "privilege proof"):
            value.migrations()

        def malformed(args, **kwargs):
            result = run(args, **kwargs)
            if args[0] == "logs":
                result.stdout = json.dumps({"runtimeRole": "smoke_runtime",
                                            "ownerCredentialsRuntime": 0, "deniedDdl": 5.0})
            return result

        docker.run = malformed
        with self.assertRaisesRegex(smoke.SmokeError, "privilege proof"):
            value.migrations()

    def test_explicit_bounded_tmpfs_does_not_change_default_container_mounts(self):
        docker = FakeDocker()
        value = harness(docker)
        specifications = ("/data:rw,noexec,nosuid,nodev,size=16m", "/config:rw,noexec,nosuid,nodev,size=16m")
        value.start_container("caddy", "caddy:test", ["caddy", "adapt"], environment={}, readonly=True, tmpfs=specifications)
        created = docker.calls[-1]
        self.assertEqual([created[index + 1] for index, argument in enumerate(created) if argument == "--tmpfs"], list(specifications))
        self.assertIn("--read-only", created)
        self.assertFalse(any(argument in {"--volume", "-v"} for argument in created))
        value.start_container("web", "web:test", ["bun", "next", "start"])
        self.assertNotIn("--tmpfs", docker.calls[-1])

    def test_ready_log_cannot_override_a_failed_process_or_oom(self):
        for running, code, oom in ((False, 1, False), (False, 0, False), (True, 0, True)):
            docker = FakeDocker()
            docker.running, docker.exit_code, docker.oom = running, code, oom
            with self.subTest(running=running, code=code, oom=oom), self.assertRaises(smoke.SmokeError):
                harness(docker).assert_running("owned-web")

    def test_ambiguous_create_outcome_still_tracks_the_owned_name_for_cleanup(self):
        docker = FakeDocker()
        value = harness(docker)
        docker.fail_run = True
        with self.assertRaises(smoke.SmokeError):
            value.start_container("web", "web:test", ["bun", "next", "start"])
        expected = f"{value.prefix}-web"
        self.assertIn(("container", expected), value.resources)
        self.assertEqual(value.cleanup(), [])
        self.assertIn(["container", "rm", "--force", expected], docker.calls)

    def test_cleanup_refuses_resources_with_a_different_owner(self):
        docker = FakeDocker()
        value = harness(docker)
        value.resources = [("container", "owned-name")]
        docker.foreign = True
        self.assertEqual(len(value.cleanup()), 1)
        self.assertFalse(any(args[1] == "rm" for args in docker.calls))

    def test_cleanup_daemon_failure_is_not_mistaken_for_missing_resource(self):
        docker = FakeDocker()
        value = harness(docker)
        value.resources = [("container", "owned-name")]
        docker.inspect_failure = True
        self.assertEqual(len(value.cleanup()), 1)
        docker.inspect_failure, docker.missing = False, True
        self.assertEqual(value.cleanup(), [])

    def test_cleanup_is_exact_and_reverse_order_and_does_not_prune(self):
        docker = FakeDocker()
        value = harness(docker)
        value.resources = [("network", "owned-net"), ("volume", "owned-data"),
                           ("container", "owned-db"), ("container", "owned-web")]
        self.assertEqual(value.cleanup(), [])
        removals = [args for args in docker.calls if args[1] == "rm"]
        self.assertEqual(removals, [["container", "rm", "--force", "owned-web"],
                                    ["container", "rm", "--force", "owned-db"],
                                    ["volume", "rm", "owned-data"], ["network", "rm", "owned-net"]])
        self.assertFalse(any("prune" in args for args in docker.calls))


class ReportingTests(unittest.TestCase):
    @staticmethod
    def no_op_phases(value):
        for name in ("inspect_images", "packaging", "create_environment", "migrations", "web", "realtime", "worker"):
            setattr(value, name, lambda: {"fixture": True})
        value.containers = {name: name for name in ("web", "worker", "realtime")}
        value.assert_running = lambda name: None

    def test_partial_failure_reports_only_executed_checks_and_retains_scope_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            value = harness(output_dir=Path(directory) / "run")
            self.no_op_phases(value)

            def fail():
                raise smoke.SmokeError("Required process stopped (exit 1, OOM False)")

            value.web = fail
            self.assertFalse(value.run())
            report = json.loads((value.output_dir / "report.json").read_text())
            self.assertEqual(report["checks"][-1]["status"], "failed")
            self.assertNotIn("worker-durable-job-across-restart", [item["name"] for item in report["checks"]])
            self.assertTrue(report["cleanup"]["success"])
            self.assertTrue(any("authenticated" in limit for limit in report["limitations"]))

    def test_cleanup_failure_prevents_success_even_when_every_probe_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            value = harness(output_dir=Path(directory) / "run")
            self.no_op_phases(value)
            value.cleanup = lambda: ["owned resource could not be removed"]
            self.assertFalse(value.run())
            self.assertFalse(value.report["cleanup"]["success"])
            self.assertTrue(all(item["status"] == "passed" for item in value.report["checks"]))
            self.assertFalse(value.report["success"])

    def test_refuses_to_overwrite_evidence_before_starting_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            value = harness(output_dir=Path(directory))
            with self.assertRaises(FileExistsError):
                value.run()
            self.assertEqual(value.resources, [])


class DiagnosticTests(unittest.TestCase):
    def test_redacts_generated_values_and_unknown_credential_patterns_before_truncation(self):
        secret = "0123456789secret-which-must-never-appear"
        text = (f"failure {secret}\n" + '"AUTH_SECRET":"unknown-baked-secret"\n'
                + "access_token=unknown-token\nAuthorization: Bearer unknown.jwt.token\n"
                + "Cookie: session=unknown-session\npostgres://user:unknown@database/crm\n")
        result = smoke.sanitized_log(text, [secret])
        for forbidden in (secret, "unknown-baked-secret", "unknown-token", "unknown.jwt.token",
                          "unknown-session", "user:unknown"):
            self.assertNotIn(forbidden, result["text"])
        self.assertIn("[REDACTED]", result["text"])

    def test_log_tail_is_byte_and_line_bounded_and_utf8_safe(self):
        result = smoke.sanitized_log("ä" * 10000 + "\n" + "line\n" * 100, [], 512)
        self.assertTrue(result["truncated"])
        self.assertLessEqual(len(result["text"].encode("utf-8")), 512)
        self.assertLessEqual(len(result["text"].splitlines()), 80)
        self.assertNotIn("�", result["text"])

    def test_diagnostics_refuse_to_read_foreign_container_logs(self):
        docker = FakeDocker()
        value = harness(docker)
        value.resources = [("container", "foreign-name")]
        docker.foreign = True
        result = value.failure_diagnostics()
        self.assertEqual(result[0]["status"], "foreign-owner-read-refused")
        self.assertFalse(any(args[0] == "logs" for args in docker.calls))

    def test_failure_diagnostics_precede_cleanup_and_do_not_include_command_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            value = harness(output_dir=Path(directory) / "run")
            ReportingTests.no_op_phases(value)
            events = []

            def fail():
                raise smoke.SmokeError("Docker exec failed (exit 1)")

            value.web = fail
            value.failure_diagnostics = lambda: events.append("diagnostics") or [{"status": "fixture"}]
            value.cleanup = lambda: events.append("cleanup") or []
            self.assertFalse(value.run())
            self.assertEqual(events, ["diagnostics", "cleanup"])
            self.assertEqual(value.report["diagnostics"], [{"status": "fixture"}])
            self.assertNotIn("DATABASE_URL", json.dumps(value.report))


if __name__ == "__main__":
    unittest.main()
