"""Loader/qualification guards only; final Linux containers require native CI."""
from pathlib import Path
import importlib.util
import gzip
import io
import json
import os
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

try:
    from . import engine_image_smoke as smoke
except ImportError:
    import engine_image_smoke as smoke


CONTEXT = Path(__file__).resolve().parents[2] / "deploy/newsletters/engine"


class NonrootEntrypointTests(unittest.TestCase):
    def invoke(self, environment, *command):
        env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", **environment}
        return subprocess.run(["sh", str(CONTEXT / "nonroot-entrypoint.sh"), *command],
                              env=env, capture_output=True, text=True, timeout=5)

    def test_no_file_options_executes_exact_command_and_exit(self):
        result = self.invoke({}, "sh", "-c", "exit 7")
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stderr, "")

    def test_secret_file_overrides_direct_value_without_evaluating_content(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / "must-not-exist"
            secret = Path(folder) / "secret with spaces"
            value = "synthetic $(touch " + str(marker) + ") ; quote'\nnext"
            secret.write_text(value + "\n")
            result = self.invoke({"LISTMONK_db__password": "old-synthetic-value",
                                  "LISTMONK_db__password_FILE": str(secret)},
                                 "sh", "-c", 'printf "%s" "$LISTMONK_db__password"')
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, value)
            self.assertFalse(marker.exists())
            self.assertEqual(result.stderr, "")

    def test_missing_file_fails_instead_of_using_direct_value(self):
        with tempfile.TemporaryDirectory() as folder:
            missing = str(Path(folder) / "absent-sensitive-path")
            result = self.invoke({"LISTMONK_db__password": "synthetic-fallback-secret",
                                  "LISTMONK_db__password_FILE": missing}, "sh", "-c", "exit 0")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertNotIn(missing, result.stderr)
            self.assertNotIn("synthetic-fallback-secret", result.stderr)

    def test_directory_is_not_a_secret_file(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.invoke({"LISTMONK_db__password_FILE": folder}, "sh", "-c", "exit 0")
            self.assertNotEqual(result.returncode, 0)

    @unittest.skipIf(os.geteuid() == 0, "root bypasses host file readability")
    def test_unreadable_file_is_rejected_without_logging_value(self):
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / "secret"
            secret.write_text("synthetic-unreadable-secret")
            secret.chmod(0)
            try:
                result = self.invoke({"LISTMONK_db__password_FILE": str(secret)}, "sh", "-c", "exit 0")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("synthetic-unreadable-secret", result.stderr)
            finally:
                secret.chmod(0o600)

    def test_trailing_newline_path_cannot_resolve_to_another_file(self):
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / "secret"
            secret.write_text("synthetic-content")
            result = self.invoke({"LISTMONK_db__password_FILE": str(secret) + "\n"},
                                 "sh", "-c", "exit 0")
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("synthetic-content", result.stdout + result.stderr)

    def test_invalid_environment_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / "secret"
            secret.write_text("synthetic-content")
            result = self.invoke({"LISTMONK_bad-key_FILE": str(secret)}, "sh", "-c", "exit 0")
            self.assertNotEqual(result.returncode, 0)

    def test_startup_never_invokes_user_or_ownership_tools(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / "ownership-tool-called"
            for tool in ("chown", "adduser", "addgroup", "getent", "su-exec"):
                path = Path(folder) / tool
                path.write_text('#!/bin/sh\nprintf called >> "$OWNERSHIP_MARKER"\nexit 99\n')
                path.chmod(0o700)
            result = self.invoke({"PATH": folder + ":/usr/bin:/bin", "OWNERSHIP_MARKER": str(marker),
                                  "PUID": "12345", "PGID": "12345"}, "sh", "-c", "exit 0")
            self.assertEqual(result.returncode, 0)
            self.assertFalse(marker.exists())


class ImageAdmissionTests(unittest.TestCase):
    def image(self):
        return [{"Id": "sha256:" + "b" * 64, "Os": "linux", "Architecture": "amd64", "Config": {
            "User": "65532:65532", "WorkingDir": "/listmonk", "Entrypoint": ["/usr/local/bin/warpdrive-engine-entrypoint.sh"],
            "Cmd": ["./listmonk"], "Env": ["PATH=/usr/bin:/bin"], "Volumes": None,
            "Labels": {"org.opencontainers.image.revision": "a" * 40,
                       "org.opencontainers.image.source": smoke.UPSTREAM_SOURCE, smoke.CONTEXT_LABEL: "c" * 64}}}]

    def test_exact_default_nonroot_identity_is_admitted(self):
        value = smoke.engine_metadata(self.image(), "a" * 40, "c" * 64)
        self.assertEqual(value["id"], "sha256:" + "b" * 64)
        self.assertEqual(value["user"], "65532:65532")

    def test_root_override_cannot_qualify_default_image(self):
        value = self.image()
        value[0]["Config"]["User"] = ""
        with self.assertRaisesRegex(smoke.SmokeError, "default.*nonroot"):
            smoke.engine_metadata(value, "a" * 40, "c" * 64)

    def test_wrong_architecture_revision_context_or_upstream_is_rejected(self):
        for target, key, content in (("image", "Architecture", "arm64"),
                                     ("labels", "org.opencontainers.image.revision", "d" * 40),
                                     ("labels", smoke.CONTEXT_LABEL, "d" * 64),
                                     ("labels", "org.opencontainers.image.source", "https://wrong.invalid")):
            with self.subTest(key=key):
                value = self.image()
                (value[0] if target == "image" else value[0]["Config"]["Labels"])[key] = content
                with self.assertRaises(smoke.SmokeError):
                    smoke.engine_metadata(value, "a" * 40, "c" * 64)

    def test_baked_secret_and_anonymous_volume_are_rejected(self):
        for key, content in (("Env", ["LISTMONK_db__password_FILE=/private-secret"]), ("Volumes", {"/listmonk/uploads": {}})):
            value = self.image()
            value[0]["Config"][key] = content
            with self.assertRaises(smoke.SmokeError):
                smoke.engine_metadata(value, "a" * 40, "c" * 64)

    def test_native_host_and_daemon_must_both_match(self):
        smoke.admit_native_platform("Linux", "x86_64", {"os": "linux", "architecture": "amd64"})
        for host, architecture, daemon in (
            ("Darwin", "x86_64", {"os": "linux", "architecture": "amd64"}),
            ("Linux", "aarch64", {"os": "linux", "architecture": "amd64"}),
            ("Linux", "amd64", {"os": "linux", "architecture": "arm64"}),
            ("Linux", "x86_64", {"os": "windows", "architecture": "amd64"}),
        ):
            with self.subTest(host=host, architecture=architecture, daemon=daemon), self.assertRaises(smoke.SmokeError):
                smoke.admit_native_platform(host, architecture, daemon)


class ContextBindingTests(unittest.TestCase):
    def context(self, root):
        for name in ("Dockerfile", "build.sh", "nonroot-entrypoint.sh", "patches/090-explicit-migrations.patch",
                     "migration-tests/verify.py", "migration-tests/test_verify.py"):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic reviewed input")

    def test_context_change_changes_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.context(root)
            before = smoke.context_record(root)
            self.assertEqual(smoke.context_record(root), before)
            (root / "Dockerfile").write_text("different input")
            self.assertNotEqual(smoke.context_record(root)["sha256"], before["sha256"])

    def test_secret_generated_and_link_inputs_fail_closed(self):
        for kind in ("secret", "bytecode", "symlink"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.context(root)
                if kind == "symlink":
                    (root / "foreign").symlink_to("/not-an-input")
                else:
                    (root / (".env.production" if kind == "secret" else "generated.pyc")).write_text("not reviewed")
                with self.assertRaises(smoke.SmokeError):
                    smoke.context_record(root)

    def test_archive_cannot_rebind_a_different_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "source.tar.gz"
            contents = {"Dockerfile": b"wrong context", "LICENSE": b"synthetic license", "listmonk-ef0a758.tar.gz": b"unused"}
            with tarfile.open(archive, "w:gz") as output:
                for name, raw in contents.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(raw)
                    output.addfile(info, io.BytesIO(raw))
            with patch.object(smoke.subprocess, "run") as execute:
                with self.assertRaisesRegex(smoke.SmokeError, "differs from reviewed"):
                    smoke.verify_source_archive(archive, {"files": {"Dockerfile": smoke.digest(b"correct")}}, root)
            execute.assert_not_called()

    def test_excess_members_refuse_before_full_tar_enumeration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "source.tar.gz"
            with tarfile.open(archive, "w:gz") as output:
                for name in ("Dockerfile", "LICENSE", "listmonk-ef0a758.tar.gz", "extra-member"):
                    info = tarfile.TarInfo(name)
                    info.size = 1
                    output.addfile(info, io.BytesIO(b"x"))
            with patch.object(tarfile.TarFile, "getmembers", side_effect=AssertionError("unbounded enumeration")):
                with self.assertRaisesRegex(smoke.SmokeError, "member count/size"):
                    smoke.verify_source_archive(archive, {"files": {"Dockerfile": smoke.digest(b"x")}}, root)

    def test_reader_bounds_extended_header_expansion_before_parser_allocates_it(self):
        source = io.BytesIO(b"x" * 33)
        reader = smoke.ExpandedTarReader(source, 16)
        with self.assertRaisesRegex(smoke.SmokeError, "expanded-byte"):
            reader.read(1024**3)
        self.assertEqual(source.tell(), 17)

    def oversized_extended_header(self, member_type):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "compressed-metadata-bomb.tar.gz"
            header = tarfile.TarInfo("././@PaxHeader" if member_type == tarfile.XHDTYPE else "././@LongLink")
            header.type = member_type
            header.size = 1024 * 1024
            with gzip.open(archive, "wb") as output:
                output.write(header.tobuf(format=tarfile.USTAR_FORMAT))
                for _ in range(256):
                    output.write(b"x" * 4096)
                output.write(b"\0" * 1024)
            self.assertLess(archive.stat().st_size, 4096)
            # A small test budget exercises the actual gzip/tar parser boundary.
            # The parser must stop before reading its claimed1MiB metadata body.
            with self.assertRaisesRegex(smoke.SmokeError, "expanded-byte"):
                with smoke.bounded_tar(archive, 16, 1) as opened:
                    next(iter(opened))

    def test_compressed_oversized_pax_fails_before_tarinfo_yield(self):
        self.oversized_extended_header(tarfile.XHDTYPE)

    def test_compressed_oversized_gnu_longname_fails_before_tarinfo_yield(self):
        self.oversized_extended_header(tarfile.GNUTYPE_LONGNAME)


class OwnershipAndCompletionTests(unittest.TestCase):
    def fixture(self, owner="foreign"):
        value = object.__new__(smoke.EngineImageSmoke)
        value.prefix = "owned"
        value.resources = [("container", "owned-engine")]
        value.report = {"resources": {"network": "owned-network"}}
        value.docker = SimpleNamespace(json=Mock(return_value={smoke.OWNER_LABEL: owner}), run=Mock())
        return value

    def test_foreign_resource_cannot_be_read_or_controlled(self):
        value = self.fixture()
        process = smoke.ContainerProcess(value, "owned-engine")
        with self.assertRaisesRegex(smoke.SmokeError, "ownership changed"):
            process.terminate()
        value.docker.run.assert_not_called()
        self.assertEqual(value.docker.json.call_count, 1)

    def test_unexpected_network_is_refused_before_control(self):
        value = self.fixture("owned")
        value.docker.json.side_effect = [{smoke.OWNER_LABEL: "owned"}, {"Networks": {"foreign-network": {}}, "Ports": {}}]
        with self.assertRaisesRegex(smoke.SmokeError, "network attachment"):
            smoke.ContainerProcess(value, "owned-engine").terminate()
        value.docker.run.assert_not_called()

    def test_wait_or_ready_log_does_not_substitute_for_exit_state(self):
        for state in ({"Running": True, "OOMKilled": False}, {"Running": False, "OOMKilled": True, "ExitCode": 0}):
            value = SimpleNamespace(owned=Mock(), docker=SimpleNamespace(run=Mock()), state=Mock(return_value=state))
            with self.subTest(state=state), self.assertRaises(smoke.SmokeError):
                smoke.ContainerProcess(value, "owned-engine").wait()

    def test_missing_failed_duplicate_or_reordered_phase_cannot_qualify(self):
        checks = [{"name": name, "status": "passed"} for name in smoke.REQUIRED_CHECKS]
        self.assertTrue(smoke.required_checks_passed(checks))
        self.assertFalse(smoke.required_checks_passed(checks[:-1]))
        self.assertFalse(smoke.required_checks_passed(checks + checks[-1:]))
        self.assertFalse(smoke.required_checks_passed(list(reversed(checks))))
        checks[0]["status"] = "failed"
        self.assertFalse(smoke.required_checks_passed(checks))


class CleanupQualificationTests(unittest.TestCase):
    def test_cleanup_failure_prevents_mocked_phase_success(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = SimpleNamespace(json=Mock(return_value={"os": "linux", "architecture": "amd64", "root": directory}))
            value = smoke.EngineImageSmoke(docker, "synthetic:only", "a" * 40, Path(directory) / "evidence")
            for name in ("inspect_image", "create_environment", "packaging", "empty_runtime", "initialize",
                         "migration_excludes_runtime", "readiness"):
                setattr(value, name, Mock(return_value={}))
            value.cleanup = Mock(return_value=["owned cleanup deliberately failed"])
            value.failure_diagnostics = Mock(return_value=[])
            native = {name: Mock(return_value=None) for name in ("prove_fresh_migration", "prove_legacy_fence",
                      "prove_noop_and_upgrade", "prove_admission_failures", "prove_restricted_no_ddl_start",
                      "prove_policy_and_sequence_drift", "prove_runtime_excludes_migration", "prove_runtime_fence_loss")}
            value.archived_schema = Mock(return_value=b"unused synthetic schema")
            with patch.multiple(smoke.NATIVE, **native), patch.object(smoke.shutil, "disk_usage", return_value=SimpleNamespace(free=20*1024**3)), \
                 patch.object(smoke.platform, "system", return_value="Linux"), patch.object(smoke.platform, "machine", return_value="x86_64"):
                self.assertFalse(value.qualify())
            report = json.loads((value.output_dir / "report.json").read_text())
            self.assertFalse(report["success"])
            self.assertFalse(report["cleanup"]["success"])
            self.assertEqual(len(report["checks"]), len(smoke.REQUIRED_CHECKS))
            self.assertFalse(value.secret_file.exists())


if __name__ == "__main__":
    unittest.main()
