"""Loader/qualification guards only; final Linux containers require native CI."""
from pathlib import Path
import importlib.util
import gzip
import io
import json
import os
import stat
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

    def test_invalid_enumerated_environment_key_fails_before_exec(self):
        with tempfile.TemporaryDirectory() as folder:
            # Some /bin/sh implementations discard invalid inherited names before
            # running the script. Supply the actual enumeration boundary explicitly
            # so every platform exercises the loader's rejection, not shell startup.
            enumerator = Path(folder) / "env"
            enumerator.write_text("#!/bin/sh\nprintf '%s\\n' 'LISTMONK_bad-key_FILE=/opaque-secret'\n")
            enumerator.chmod(0o700)
            marker = Path(folder) / "command-executed"
            result = self.invoke({"PATH": folder + ":/usr/bin:/bin", "COMMAND_MARKER": str(marker)},
                                 "sh", "-c", 'printf reached > "$COMMAND_MARKER"')
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertEqual(result.stderr, "Newsletter secret file is missing, unreadable or invalid\n")
            self.assertFalse(marker.exists())

    def test_invalid_inherited_key_never_loads_or_exposes_its_file(self):
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / "private-secret-path"
            secret.write_text("synthetic-private-content")
            result = self.invoke({"LISTMONK_bad-key_FILE": str(secret)},
                                 "sh", "-c", 'printf "%s" "${LISTMONK_bad_key:-command-safe}"')
            # Dash removes this inherited name; shells retaining it reach the
            # loader's fixed rejection. Neither path can load/export its contents.
            self.assertIn(result.returncode, (0, 1))
            self.assertEqual(result.stdout, "command-safe" if result.returncode == 0 else "")
            self.assertEqual(result.stderr, "" if result.returncode == 0 else
                             "Newsletter secret file is missing, unreadable or invalid\n")
            self.assertNotIn(str(secret), result.stdout + result.stderr)
            self.assertNotIn("synthetic-private-content", result.stdout + result.stderr)

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
                         "migration_excludes_runtime", "readiness", "supported_old_upgrade"):
                setattr(value, name, Mock(return_value={}))
            value.cleanup = Mock(return_value=["owned cleanup deliberately failed"])
            value.failure_diagnostics = Mock(return_value=[])
            native = {name: Mock(return_value=None) for name in ("prove_fresh_migration", "prove_legacy_fence",
                      "prove_noop_and_upgrade", "prove_admission_failures", "prove_restricted_no_ddl_start",
                      "prove_policy_and_sequence_drift", "prove_runtime_excludes_migration", "prove_runtime_fence_loss")}
            value.archived_schema = Mock(return_value=b"unused synthetic schema")
            with patch.multiple(smoke.NATIVE, **native), patch.object(smoke.shutil, "disk_usage", return_value=SimpleNamespace(free=20*1024**3)), \
                 patch.object(smoke.platform, "system", return_value="Linux"), patch.object(smoke.platform, "machine", return_value="x86_64"), \
                 patch.object(smoke, "admit_secret_tmpfs", return_value=Path(directory)):
                self.assertFalse(value.qualify())
            report = json.loads((value.output_dir / "report.json").read_text())
            self.assertFalse(report["success"])
            self.assertFalse(report["cleanup"]["success"])
            self.assertEqual(len(report["checks"]), len(smoke.REQUIRED_CHECKS))
            self.assertFalse(value.secret_file.exists())


class SyntheticSecretStorageTests(unittest.TestCase):
    def mount_record(self, root, *, filesystem="tmpfs", options="rw,nosuid,nodev", device=None):
        metadata = root.stat()
        device = device or f"{os.major(metadata.st_dev)}:{os.minor(metadata.st_dev)}"
        mountpoint = str(root.resolve()).replace("\\", "\\134").replace(" ", "\\040")
        return f"25 1 {device} / {mountpoint} {options} - {filesystem} shm rw,size=65536k\n"

    def test_mount_admission_requires_matching_writable_tmpfs_including_escaped_path(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "tmpfs with space"
            root.mkdir()
            mountinfo = Path(folder) / "mountinfo"
            mountinfo.write_text(self.mount_record(root))
            self.assertEqual(smoke.admit_secret_tmpfs(root, mountinfo), root.resolve())

    def test_disk_readonly_missing_malformed_or_ambiguous_mount_never_falls_back(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "backing"
            root.mkdir()
            mountinfo = Path(folder) / "mountinfo"
            cases = (self.mount_record(root, filesystem="ext4"), self.mount_record(root, options="ro"),
                     self.mount_record(root, device="98765:43210"), "", "malformed mount record\n",
                     self.mount_record(root) * 2, "x" * (256 * 1024 + 1))
            with patch.object(smoke.tempfile, "TemporaryDirectory") as fallback:
                for raw in cases:
                    mountinfo.write_text(raw)
                    with self.subTest(record=raw[:80]), self.assertRaises(smoke.SmokeError):
                        smoke.admit_secret_tmpfs(root, mountinfo)
                mountinfo.unlink()
                with self.assertRaises(smoke.SmokeError):
                    smoke.admit_secret_tmpfs(root, mountinfo)
                fallback.assert_not_called()

    def test_symbolic_or_unavailable_mount_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "backing"
            root.mkdir()
            mountinfo = Path(folder) / "mountinfo"
            mountinfo.write_text(self.mount_record(root))
            symbolic = Path(folder) / "symbolic"
            symbolic.symlink_to(root, target_is_directory=True)
            for candidate in (symbolic, Path(folder) / "missing", mountinfo):
                with self.subTest(path=candidate.name), self.assertRaises(smoke.SmokeError):
                    smoke.admit_secret_tmpfs(candidate, mountinfo)

    def test_exclusive_private_creation_preserves_exact_payload_and_loader_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            original_open = os.open
            created = []
            def observe_open(path, flags, mode):
                descriptor = original_open(path, flags, mode)
                created.append((flags, stat.S_IMODE(os.fstat(descriptor).st_mode)))
                return descriptor
            previous_umask = os.umask(0)
            try:
                with patch.object(smoke.os, "open", side_effect=observe_open):
                    path = smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
            finally:
                os.umask(previous_umask)
            self.assertEqual(len(created), 1)
            self.assertTrue(created[0][0] & os.O_EXCL)
            self.assertTrue(created[0][0] & os.O_NOFOLLOW)
            self.assertEqual(created[0][1], 0o600)
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o444)
            self.assertEqual(path.read_text(), "synthetic-file-fixture-value")
            result = NonrootEntrypointTests().invoke({"LISTMONK_db__password": "deliberately-wrong-value",
                "LISTMONK_db__password_FILE": str(path)}, "sh", "-c", 'printf "%s" "$LISTMONK_db__password"')
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "synthetic-file-fixture-value")
            self.assertEqual(result.stderr, "")

    def test_container_keeps_readonly_inode_mount_and_deliberately_wrong_direct_value(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = SimpleNamespace(run=Mock())
            value = smoke.EngineImageSmoke(docker, "synthetic:only", "a" * 40, Path(directory) / "evidence")
            value.secret_file = smoke.write_synthetic_secret(Path(directory), value.pg_env["POSTGRES_PASSWORD"])
            value.report["image"]["id"] = "sha256:" + "b" * 64
            value.owned = Mock()
            value.engine(["--version"])
            arguments = docker.run.call_args.args[0]
            self.assertIn(f"type=bind,source={value.secret_file},target=/run/engine-db-password,readonly", arguments)
            self.assertIn("LISTMONK_db__password_FILE=/run/engine-db-password", arguments)
            self.assertIn("LISTMONK_db__password=deliberately-wrong-synthetic-password", arguments)
            self.assertFalse(any(value.pg_env["POSTGRES_PASSWORD"] in argument for argument in arguments))

    def test_existing_file_or_symbolic_target_cannot_be_overwritten(self):
        for symbolic in (False, True):
            with self.subTest(symbolic=symbolic), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                original = directory / "original"
                original.write_text("do not overwrite")
                target = directory / "db-password"
                if symbolic:
                    target.symlink_to(original)
                else:
                    target.write_text("do not overwrite")
                with self.assertRaises(FileExistsError):
                    smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assertEqual(original.read_text(), "do not overwrite")
                self.assertEqual(target.read_text(), "do not overwrite")

    def test_nonprivate_or_symbolic_parent_rejects_before_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            directory.chmod(0o755)
            try:
                with self.assertRaisesRegex(smoke.SmokeError, "not private"):
                    smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assertFalse((directory / "db-password").exists())
            finally:
                directory.chmod(0o700)
            symbolic = directory / "symbolic"
            symbolic.symlink_to(directory, target_is_directory=True)
            with self.assertRaisesRegex(smoke.SmokeError, "not private"):
                smoke.write_synthetic_secret(symbolic, "synthetic-file-fixture-value")

    def qualifier(self, directory, daemon):
        value = smoke.EngineImageSmoke(SimpleNamespace(json=Mock(return_value=daemon)),
            "synthetic:only", "a" * 40, Path(directory) / "evidence")
        value.cleanup = Mock(return_value=[])
        value.failure_diagnostics = Mock(return_value=[])
        return value

    def test_native_admission_precedes_any_secret_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.qualifier(directory, {"os": "linux", "architecture": "amd64", "root": directory})
            with patch.object(smoke.platform, "system", return_value="Darwin"), \
                 patch.object(smoke, "admit_secret_tmpfs") as backing, patch.object(smoke, "write_synthetic_secret") as write:
                self.assertFalse(value.qualify())
            backing.assert_not_called()
            write.assert_not_called()
            self.assertIsNone(value.secret_directory)

    def test_unadmitted_backing_fails_before_write_with_no_disk_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.qualifier(directory, {"os": "linux", "architecture": "amd64", "root": directory})
            with patch.object(smoke.platform, "system", return_value="Linux"), patch.object(smoke.platform, "machine", return_value="x86_64"), \
                 patch.object(smoke, "admit_secret_tmpfs", side_effect=smoke.SmokeError("fixture backing refused")), \
                 patch.object(smoke, "write_synthetic_secret") as write, patch.object(smoke.tempfile, "TemporaryDirectory") as fallback:
                self.assertFalse(value.qualify())
            write.assert_not_called()
            fallback.assert_not_called()
            self.assertIsNone(value.secret_directory)

    def test_provisioning_error_cleans_private_directory_without_retaining_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.qualifier(directory, {"os": "linux", "architecture": "amd64", "root": directory})
            original = smoke.write_synthetic_secret
            def interrupted(parent, password):
                original(parent, password)
                raise OSError("synthetic provisioning interruption")
            with patch.object(smoke.platform, "system", return_value="Linux"), patch.object(smoke.platform, "machine", return_value="x86_64"), \
                 patch.object(smoke, "admit_secret_tmpfs", return_value=Path(directory)), \
                 patch.object(smoke, "write_synthetic_secret", side_effect=interrupted):
                self.assertFalse(value.qualify())
            self.assertFalse(Path(value.secret_directory.name).exists())
            self.assertNotIn(value.pg_env["POSTGRES_PASSWORD"], (value.output_dir / "report.json").read_text())


class HistoricalMediaTransportTests(unittest.TestCase):
    def fixture(self):
        value = object.__new__(smoke.EngineImageSmoke)
        value.serve = SimpleNamespace(name="owned-historical-engine")
        value.report = {}
        value.auth = {"Authorization": "Basic synthetic-api-header"}
        value.owned = Mock()
        value.media_bytes = Mock(return_value=smoke.UPGRADE_PNG)
        def result(arguments, **options):
            if arguments[:2] == ["exec", "--interactive"]:
                return subprocess.CompletedProcess(arguments, 0, b"", b"")
            return subprocess.CompletedProcess(arguments, 0, json.dumps({"data": {"filename": "fixture.png"}}), "")
        value.docker = SimpleNamespace(run=Mock(side_effect=result))
        return value

    def test_staging_uses_owned_fixed_target_and_binary_stdin_without_daemon_copy(self):
        value = self.fixture()
        body = b"\x00\xff$(not-shell-code)\r\n"
        value.stage_old_media_body(body)
        value.owned.assert_called_once_with("owned-historical-engine")
        value.docker.run.assert_called_once_with(["exec", "--interactive", "owned-historical-engine", "sh", "-ec",
            "umask 077; cat > /tmp/upgrade-upload.body"], input_bytes=body, timeout=10, check=False)

    def test_empty_oversized_or_nonbinary_staging_rejects_before_control(self):
        value = self.fixture()
        for body in (b"", b"x" * 8193, "not binary"):
            with self.subTest(kind=type(body).__name__), self.assertRaises(smoke.SmokeError):
                value.stage_old_media_body(body)
        value.owned.assert_not_called()
        value.docker.run.assert_not_called()

    def test_failed_staging_stops_before_authenticated_upload_and_keeps_safe_subphase(self):
        for failure in (subprocess.CompletedProcess([], 1, b"synthetic-sensitive-output", b"synthetic-sensitive-output"),
                        smoke.SmokeError("transport synthetic-sensitive-output")):
            value = self.fixture()
            value.docker.run = Mock(return_value=failure, side_effect=failure if isinstance(failure, Exception) else None)
            with self.subTest(failure=type(failure).__name__), self.assertRaises(smoke.SmokeError) as raised:
                value.upload_old_media()
            self.assertNotIn("synthetic-sensitive-output", str(raised.exception))
            self.assertEqual(value.report["supportedOldUpgradePhase"], "media-payload-staging")
            self.assertEqual(value.docker.run.call_count, 1)
            value.media_bytes.assert_not_called()

    def test_actual_api_upload_and_exact_binary_media_check_remain_required(self):
        value = self.fixture()
        self.assertEqual(value.upload_old_media(), "fixture.png")
        self.assertEqual(value.docker.run.call_count, 2)
        staging, upload = value.docker.run.call_args_list
        body = staging.kwargs["input_bytes"]
        self.assertIn(smoke.UPGRADE_PNG, body)
        self.assertIn(b'filename="fixture.png"', body)
        self.assertFalse(any(call.args[0][0] == "cp" for call in value.docker.run.call_args_list))
        self.assertEqual(upload.args[0][-1], "http://127.0.0.1:9000/api/media")
        self.assertIn("--post-file", upload.args[0])
        self.assertIn("Authorization: Basic synthetic-api-header", upload.args[0])
        self.assertEqual(upload.kwargs, {"timeout": 10, "check": False})
        value.media_bytes.assert_called_once_with("fixture.png")
        self.assertEqual(value.report["supportedOldUpgradePhase"], "media-byte-verification")
        self.assertNotIn("synthetic-api-header", json.dumps(value.report))

    def test_api_failure_or_changed_media_cannot_qualify(self):
        value = self.fixture()
        value.docker.run.side_effect = [subprocess.CompletedProcess([], 0, b"", b""),
                                       subprocess.CompletedProcess([], 1, "private response", "private response")]
        with self.assertRaisesRegex(smoke.SmokeError, "API upload did not succeed"):
            value.upload_old_media()
        self.assertEqual(value.report["supportedOldUpgradePhase"], "media-api-upload")
        value.media_bytes.assert_not_called()
        value = self.fixture()
        value.media_bytes.return_value = b"changed binary media"
        with self.assertRaisesRegex(smoke.SmokeError, "preserve exact uploaded bytes"):
            value.upload_old_media()


class SupportedOldAdmissionTests(unittest.TestCase):
    def old_image(self):
        raw = ImageAdmissionTests().image()
        raw[0]["Config"].update(User="", Entrypoint=["docker-entrypoint.sh"])
        raw[0]["Config"]["Labels"].update({"org.opencontainers.image.revision": smoke.OLD_REVISION,
                                          smoke.CONTEXT_LABEL: smoke.OLD_CONTEXT_SHA})
        return raw

    def test_old_root_identity_is_honest_and_never_admitted_as_new(self):
        raw = self.old_image()
        result = smoke.engine_metadata(raw, smoke.OLD_REVISION, smoke.OLD_CONTEXT_SHA, legacy=True)
        self.assertEqual(result["revision"], smoke.OLD_REVISION)
        self.assertEqual(result["user"], "root-default")
        self.assertTrue(result["legacyRootFixture"])
        with self.assertRaises(smoke.SmokeError):
            smoke.engine_metadata(raw, "a" * 40, "c" * 64)

    def test_old_original_revision_cannot_be_overwritten(self):
        raw = self.old_image()
        raw[0]["Config"]["Labels"]["org.opencontainers.image.revision"] = "a" * 40
        with self.assertRaises(smoke.SmokeError):
            smoke.engine_metadata(raw, smoke.OLD_REVISION, smoke.OLD_CONTEXT_SHA, legacy=True)
        with self.assertRaisesRegex(smoke.SmokeError, "cannot be relabeled"):
            smoke.engine_metadata(raw, "a" * 40, smoke.OLD_CONTEXT_SHA, legacy=True)

    def test_unpinned_historical_context_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "patches").mkdir()
            for name in ("Dockerfile", "build.sh", "patches/085-inapp-operational-events.patch"):
                (root / name).write_text("not original historical content")
            with self.assertRaisesRegex(smoke.SmokeError, "39-file baseline"):
                smoke.context_record(root, legacy=True)

    def test_wrong_checkout_head_refuses_before_context_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "old-context"
            with patch.object(smoke.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"a" * 40 + b"\n", b"")) as run:
                with self.assertRaisesRegex(smoke.SmokeError, "original pinned revision"):
                    smoke.prepare_old_context(Path(directory), output)
            self.assertFalse(output.exists())
            self.assertEqual(run.call_count, 1)

    def test_changed_commit_object_refuses_before_context_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "old-context"
            with patch.object(smoke.subprocess, "run", side_effect=[
                subprocess.CompletedProcess([], 0, smoke.OLD_REVISION.encode() + b"\n", b""),
                subprocess.CompletedProcess([], 0, b"tampered commit object", b""),
            ]):
                with self.assertRaisesRegex(smoke.SmokeError, "commit object"):
                    smoke.prepare_old_context(Path(directory), output)
            self.assertFalse(output.exists())


class SupportedOldWriterFenceTests(unittest.TestCase):
    def fixture(self):
        value = object.__new__(smoke.EngineImageSmoke)
        value.prefix = "owned"
        value.old_binary_retired = False
        value.report = {"oldImage": {"id": "sha256:" + "b" * 64}}
        value.docker = SimpleNamespace(run=Mock(return_value=subprocess.CompletedProcess([], 0, "", "")))
        value.owned = Mock()
        value.sql = Mock(return_value="0")
        return value

    def test_unknown_or_live_old_process_holds_cutover(self):
        for state in ({"Running": True, "Pid": 55, "OOMKilled": False},
                      {"Running": False, "OOMKilled": False},
                      {"Running": False, "Pid": 0, "OOMKilled": True}):
            value = self.fixture()
            value.state = Mock(return_value=state)
            with self.subTest(state=state), self.assertRaises(smoke.SmokeError):
                value.verify_old_stopped(SimpleNamespace(name="owned-old"), "owned_legacy")
            self.assertFalse(value.old_binary_retired)
            value.docker.run.assert_not_called()
            value.sql.assert_not_called()

    def test_old_database_session_keeps_migration_held(self):
        value = self.fixture()
        value.state = Mock(return_value={"Running": False, "Pid": 0, "OOMKilled": False})
        value.sql.return_value = "1"
        def observe(check, *_args, **_kwargs):
            if not check():
                raise AssertionError("old session remains")
        with patch.object(smoke.NATIVE, "wait_until", side_effect=observe):
            with self.assertRaisesRegex(AssertionError, "old session remains"):
                value.verify_old_stopped(SimpleNamespace(name="owned-old"), "owned_legacy")
        self.assertFalse(value.old_binary_retired)

    def test_a_second_running_old_container_keeps_migration_held(self):
        value = self.fixture()
        value.state = Mock(side_effect=[{"Running": False, "Pid": 0, "OOMKilled": False}, {"Running": True}])
        value.docker.run.return_value.stdout = "owned-extra-old\n"
        with self.assertRaisesRegex(smoke.SmokeError, "still running"):
            value.verify_old_stopped(SimpleNamespace(name="owned-old"), "owned_legacy")
        self.assertFalse(value.old_binary_retired)
        value.sql.assert_not_called()

    def test_verified_stop_permanently_retires_old_binary(self):
        value = self.fixture()
        value.state = Mock(return_value={"Running": False, "Pid": 0, "OOMKilled": False})
        proof = value.verify_old_stopped(SimpleNamespace(name="owned-old"), "owned_legacy")
        self.assertTrue(value.old_binary_retired)
        self.assertEqual(proof["oldDatabaseSessions"], 0)
        with self.assertRaisesRegex(smoke.SmokeError, "Retired historical engine"):
            value.engine(["--passive"], legacy=True)

    def test_offline_handoff_has_no_recursive_or_foreign_path_escape(self):
        value = self.fixture()
        value.old_binary_retired, value.uploads_volume = True, "owned-media"
        for command in (["chown", "65532:65532", "/etc"], ["chown", "65532:65532", "/listmonk/uploads/../escape"],
                        ["chown", "65532:65532", "-R"], ["chown", "65532:65532"]):
            with self.subTest(command=command), self.assertRaises(smoke.SmokeError):
                value.engine([], {}, legacy=True, offline_media=True, entry_command=command)
        value.docker.run.assert_not_called()


class UpgradeWitnessTests(unittest.TestCase):
    def test_first_upgrade_preserves_rows_while_adding_only_receipt(self):
        before = {"table:campaigns": "a", "table:receipts": "b", "schema": "old", "sequence:event": "3:true"}
        after = {**before, "table:warpdrive_engine_schema": "new receipt", "schema": "new", "sequence:event": "4:true"}
        self.assertTrue(smoke.preserved_rows(before, after, added_receipt=True))
        for change in ({**after, "table:receipts": "mutated unknown receipt"},
                       {key: value for key, value in after.items() if key != "table:campaigns"},
                       {**after, "table:unexpected": "unreviewed"}):
            with self.subTest(change=change):
                self.assertFalse(smoke.preserved_rows(before, change, added_receipt=True))
        self.assertFalse(smoke.preserved_rows({}, {"table:warpdrive_engine_schema": "only receipt"}, added_receipt=True))

    def test_media_scope_is_bounded_to_owned_flat_fixture_tree(self):
        for path in ("/listmonk/uploads", "/listmonk/uploads/fixture.png", "/listmonk/uploads/thumbs/fixture.png"):
            self.assertTrue(smoke.valid_media_path(path))
        for path in ("/etc", "/listmonk/uploads/../x", "/listmonk/uploads/x\ny", "/listmonk/uploads/a/b/c", "--recursive"):
            self.assertFalse(smoke.valid_media_path(path))


if __name__ == "__main__":
    unittest.main()
