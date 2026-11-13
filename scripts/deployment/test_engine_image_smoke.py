"""Loader/qualification guards only; final Linux containers require native CI."""
from pathlib import Path
import base64
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
            directory = str(Path(directory).resolve())
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
    def assert_descriptors_closed(self, descriptors):
        self.assertTrue(descriptors)
        for descriptor in descriptors:
            with self.subTest(descriptor=descriptor), self.assertRaises(OSError):
                os.fstat(descriptor)

    def tracked_open(self, descriptors, before=None):
        original = os.open
        def opened(path, flags, mode=0o600, *, dir_fd=None):
            if before is not None:
                before(path, flags, dir_fd)
            descriptor = original(path, flags, mode, dir_fd=dir_fd)
            descriptors.append(descriptor)
            return descriptor
        return opened

    def private_tree(self, root):
        ancestor, outside = root / "ancestor", root / "outside"
        ancestor.mkdir(mode=0o700)
        directory = ancestor / "private"
        directory.mkdir(mode=0o700)
        outside.mkdir(mode=0o700)
        sentinel = outside / "db-password"
        sentinel.write_text("outside sentinel must not change")
        sentinel.chmod(0o600)
        return ancestor, directory, outside, sentinel

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
            directory = Path(folder).resolve()
            original_open = os.open
            created, descriptors = [], []
            def observe_open(path, flags, mode=0o600, *, dir_fd=None):
                descriptor = original_open(path, flags, mode, dir_fd=dir_fd)
                descriptors.append(descriptor)
                if flags & os.O_CREAT:
                    created.append((path, flags, stat.S_IMODE(os.fstat(descriptor).st_mode), dir_fd))
                else:
                    self.assertTrue(flags & os.O_DIRECTORY)
                    self.assertTrue(flags & os.O_NOFOLLOW)
                return descriptor
            previous_umask = os.umask(0)
            try:
                with patch.object(smoke.os, "open", side_effect=observe_open):
                    path = smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
            finally:
                os.umask(previous_umask)
            self.assertEqual(len(created), 1)
            self.assertEqual(created[0][0], "db-password")
            self.assertTrue(created[0][1] & os.O_EXCL)
            self.assertTrue(created[0][1] & os.O_NOFOLLOW)
            self.assertEqual(created[0][2], 0o600)
            self.assertIsNotNone(created[0][3])
            self.assertGreater(len(descriptors), 1)
            self.assert_descriptors_closed(descriptors)
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
            directory = str(Path(directory).resolve())
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
                directory = Path(folder).resolve()
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
            directory = Path(folder).resolve()
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

    def test_relative_and_parent_traversal_paths_are_not_runtime_fallbacks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            directory = root / "private"
            directory.mkdir(mode=0o700)
            for candidate in (Path("private"), directory / ".." / "private"):
                with self.subTest(path=candidate), self.assertRaises(smoke.SmokeError):
                    smoke.write_synthetic_secret(candidate, "synthetic-file-fixture-value")
            self.assertFalse((directory / "db-password").exists())

    def test_symbolic_ancestor_rejects_before_any_leaf_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            ancestor, directory, outside, sentinel = self.private_tree(root)
            symbolic = root / "symbolic"
            symbolic.symlink_to(ancestor, target_is_directory=True)
            descriptors = []
            with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors)):
                with self.assertRaises(smoke.SmokeError):
                    smoke.write_synthetic_secret(symbolic / "private", "synthetic-file-fixture-value")
            self.assert_descriptors_closed(descriptors)
            self.assertFalse((directory / "db-password").exists())
            self.assertEqual(sentinel.read_text(), "outside sentinel must not change")
            self.assertEqual(stat.S_IMODE(sentinel.stat().st_mode), 0o600)

    def test_private_directory_initial_witness_rejects_real_or_symbolic_replacement(self):
        for symbolic in (False, True):
            with self.subTest(symbolic=symbolic), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                _, directory, outside, _ = self.private_tree(root)
                moved, swapped, descriptors = root / "held-private", [], []
                def replace_after_initial_witness(path, _flags, dir_fd):
                    if dir_fd is None and path == directory.anchor and not swapped:
                        swapped.append(True)
                        directory.rename(moved)
                        if symbolic:
                            directory.symlink_to(outside, target_is_directory=True)
                        else:
                            outside.rename(directory)
                with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors, replace_after_initial_witness)):
                    with self.assertRaises(smoke.SmokeError):
                        smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assertEqual(swapped, [True])
                self.assert_descriptors_closed(descriptors)
                self.assertFalse((moved / "db-password").exists())
                sentinel = directory / "db-password"
                self.assertEqual(sentinel.read_text(), "outside sentinel must not change")
                self.assertEqual(stat.S_IMODE(sentinel.stat().st_mode), 0o600)

    def test_ancestor_open_rejects_real_or_symbolic_substitution_after_named_stat(self):
        for symbolic in (False, True):
            with self.subTest(symbolic=symbolic), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                ancestor, directory, outside, sentinel = self.private_tree(root)
                replacement_private = outside / "private"
                replacement_private.mkdir(mode=0o700)
                moved, swapped, descriptors = root / "held-ancestor", [], []
                def replace_before_ancestor_open(path, _flags, dir_fd):
                    if dir_fd is not None and path == ancestor.name and not swapped:
                        swapped.append(True)
                        ancestor.rename(moved)
                        if symbolic:
                            ancestor.symlink_to(outside, target_is_directory=True)
                        else:
                            outside.rename(ancestor)
                with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors, replace_before_ancestor_open)):
                    with self.assertRaises((OSError, smoke.SmokeError)):
                        smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assertEqual(swapped, [True])
                self.assert_descriptors_closed(descriptors)
                self.assertFalse((moved / "private/db-password").exists())
                selected = outside if symbolic else ancestor
                self.assertFalse((selected / "private/db-password").exists())
                self.assertEqual((selected / sentinel.name).read_text(), "outside sentinel must not change")

    def test_held_parent_prevents_write_through_late_real_or_symbolic_replacement(self):
        for symbolic in (False, True):
            with self.subTest(symbolic=symbolic), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                _, directory, outside, _ = self.private_tree(root)
                moved, swapped, descriptors = root / "held-private", [], []
                def replace_before_leaf_open(path, flags, dir_fd):
                    if path == "db-password" and flags & os.O_CREAT and not swapped:
                        self.assertIsNotNone(dir_fd)
                        swapped.append(True)
                        directory.rename(moved)
                        if symbolic:
                            directory.symlink_to(outside, target_is_directory=True)
                        else:
                            outside.rename(directory)
                with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors, replace_before_leaf_open)):
                    with self.assertRaises(smoke.SmokeError):
                        smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assertEqual(swapped, [True])
                self.assert_descriptors_closed(descriptors)
                # Cleanup is relative to the held original directory, never its replacement.
                self.assertFalse((moved / "db-password").exists())
                sentinel = directory / "db-password"
                self.assertEqual(sentinel.read_text(), "outside sentinel must not change")
                self.assertEqual(stat.S_IMODE(sentinel.stat().st_mode), 0o600)

    def test_named_leaf_real_symbolic_and_hardlink_substitution_never_receives_payload_or_cleanup(self):
        for kind in ("regular", "symlink", "hardlink"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                _, directory, _, sentinel = self.private_tree(root)
                target, moved, descriptors = directory / "db-password", root / "created-inode", []
                original_fdopen = os.fdopen
                def substitute_leaf(descriptor, *args, **kwargs):
                    target.rename(moved)
                    if kind == "regular":
                        target.write_text("replacement must not change")
                        target.chmod(0o600)
                    elif kind == "symlink":
                        target.symlink_to(sentinel)
                    else:
                        os.link(sentinel, target)
                    return original_fdopen(descriptor, *args, **kwargs)
                with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors)), \
                     patch.object(smoke.os, "fdopen", side_effect=substitute_leaf):
                    with self.assertRaisesRegex(smoke.SmokeError, "inode authority"):
                        smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assert_descriptors_closed(descriptors)
                self.assertEqual(moved.read_bytes(), b"")
                self.assertEqual(target.read_text(), "replacement must not change" if kind == "regular" else "outside sentinel must not change")
                self.assertEqual(sentinel.read_text(), "outside sentinel must not change")
                self.assertEqual(stat.S_IMODE(sentinel.stat().st_mode), 0o600)

    def test_new_hardlink_to_created_inode_rejects_before_plaintext_and_only_removes_owned_name(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder).resolve()
            target, alias, descriptors = directory / "db-password", directory / "unexpected-alias", []
            original_fdopen = os.fdopen
            def alias_before_payload(descriptor, *args, **kwargs):
                os.link(target, alias)
                return original_fdopen(descriptor, *args, **kwargs)
            with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors)), \
                 patch.object(smoke.os, "fdopen", side_effect=alias_before_payload):
                with self.assertRaisesRegex(smoke.SmokeError, "inode authority"):
                    smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
            self.assert_descriptors_closed(descriptors)
            self.assertFalse(target.exists())
            self.assertEqual(alias.read_bytes(), b"")
            self.assertEqual(stat.S_IMODE(alias.stat().st_mode), 0o600)

    def test_post_write_directory_or_leaf_substitution_is_rejected_without_touching_sentinel(self):
        for kind in ("directory", "leaf"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                _, directory, outside, sentinel = self.private_tree(root)
                target, moved, descriptors = directory / "db-password", root / "held-created", []
                original_chmod = os.fchmod
                def substitute_after_flush(descriptor, mode):
                    if kind == "directory":
                        directory.rename(moved)
                        directory.symlink_to(outside, target_is_directory=True)
                    else:
                        target.rename(moved)
                        target.symlink_to(sentinel)
                    original_chmod(descriptor, mode)
                with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors)), \
                     patch.object(smoke.os, "fchmod", side_effect=substitute_after_flush):
                    with self.assertRaises(smoke.SmokeError):
                        smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assert_descriptors_closed(descriptors)
                self.assertEqual(sentinel.read_text(), "outside sentinel must not change")
                self.assertEqual(stat.S_IMODE(sentinel.stat().st_mode), 0o600)
                if kind == "directory":
                    self.assertFalse((moved / "db-password").exists())
                else:
                    self.assertTrue(target.is_symlink())
                    self.assertEqual(moved.read_text(), "synthetic-file-fixture-value")

    def test_fdopen_and_partial_write_interruptions_close_descriptors_and_remove_only_owned_inode(self):
        for stage in ("fdopen", "write", "close", "chmod", "interruption"):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                _, directory, _, sentinel = self.private_tree(root)
                descriptors = []
                original_fdopen = os.fdopen
                class InterruptedWriter:
                    def __init__(self, wrapped):
                        self.wrapped = wrapped
                    def __enter__(self):
                        return self
                    def __exit__(self, *_error):
                        self.wrapped.close()
                        if stage == "close":
                            raise InterruptedError("synthetic payload close interrupted")
                    def fileno(self):
                        return self.wrapped.fileno()
                    def write(self, value):
                        if stage != "write":
                            return self.wrapped.write(value)
                        self.wrapped.write(value[:4])
                        self.wrapped.flush()
                        raise InterruptedError("synthetic payload write interrupted")
                    def flush(self):
                        self.wrapped.flush()
                def interrupted_fdopen(descriptor, *args, **kwargs):
                    if stage == "interruption":
                        raise KeyboardInterrupt("synthetic provisioning interrupted")
                    if stage == "fdopen":
                        raise InterruptedError("synthetic fdopen interrupted")
                    wrapped = original_fdopen(descriptor, *args, **kwargs)
                    return InterruptedWriter(wrapped) if stage in {"write", "close"} else wrapped
                def interrupted_chmod(_descriptor, _mode):
                    raise InterruptedError("synthetic chmod interrupted")
                with patch.object(smoke.os, "open", side_effect=self.tracked_open(descriptors)), \
                     patch.object(smoke.os, "fdopen", side_effect=interrupted_fdopen), \
                     patch.object(smoke.os, "fchmod", side_effect=interrupted_chmod):
                    with self.assertRaises(KeyboardInterrupt if stage == "interruption" else InterruptedError):
                        smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
                self.assert_descriptors_closed(descriptors)
                self.assertFalse((directory / "db-password").exists())
                self.assertEqual(sentinel.read_text(), "outside sentinel must not change")
                self.assertEqual(stat.S_IMODE(sentinel.stat().st_mode), 0o600)

    def test_failure_cleanup_keeps_created_inode_and_parent_descriptors_until_owned_unlink(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder).resolve()
            descriptors, created, removed = [], [], []
            original_open, original_unlink = os.open, os.unlink
            def opened(path, flags, mode=0o600, *, dir_fd=None):
                descriptor = original_open(path, flags, mode, dir_fd=dir_fd)
                descriptors.append(descriptor)
                if flags & os.O_CREAT:
                    created.append((descriptor, dir_fd))
                return descriptor
            def unlink_owned(path, *, dir_fd=None):
                self.assertEqual(path, "db-password")
                self.assertEqual(len(created), 1)
                descriptor, parent = created[0]
                self.assertEqual(dir_fd, parent)
                self.assertTrue(stat.S_ISDIR(os.fstat(parent).st_mode))
                current = os.fstat(descriptor)
                named = os.stat(path, dir_fd=parent, follow_symlinks=False)
                self.assertEqual((current.st_dev, current.st_ino), (named.st_dev, named.st_ino))
                removed.append(True)
                original_unlink(path, dir_fd=dir_fd)
            with patch.object(smoke.os, "open", side_effect=opened), \
                 patch.object(smoke.os, "fdopen", side_effect=InterruptedError("synthetic fdopen interrupted")), \
                 patch.object(smoke.os, "unlink", side_effect=unlink_owned):
                with self.assertRaises(InterruptedError):
                    smoke.write_synthetic_secret(directory, "synthetic-file-fixture-value")
            self.assertEqual(removed, [True])
            self.assert_descriptors_closed(descriptors)
            self.assertFalse((directory / "db-password").exists())

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
            directory = str(Path(directory).resolve())
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
    def response(self, body=None, status=200, chunked=False):
        body = json.dumps({"data": {"filename": "fixture.png"}}).encode() if body is None else body
        if chunked:
            framing = b"Transfer-Encoding: chunked"
            body = f"{len(body):x}\r\n".encode() + body + b"\r\n0\r\n\r\n"
        else:
            framing = f"Content-Length: {len(body)}".encode()
        return f"HTTP/1.1 {status} fixture\r\n".encode() + framing + b"\r\n\r\n" + body

    def fixture(self):
        value = object.__new__(smoke.EngineImageSmoke)
        value.serve = SimpleNamespace(name="owned-historical-engine")
        value.report = {}
        value.auth = {"Authorization": "Basic " + base64.b64encode(b"consent-proof-api:synthetic-token").decode()}
        value.owned = Mock()
        value.media_bytes = Mock(return_value=smoke.UPGRADE_PNG)
        value.docker = SimpleNamespace(run=Mock(return_value=subprocess.CompletedProcess([], 0, self.response(), b"")))
        return value

    def test_fixed_loopback_binary_stdin_and_prebuffer_response_cap_preserve_full_png(self):
        value = self.fixture()
        self.assertEqual(value.upload_old_media(), "fixture.png")
        value.owned.assert_called_once_with("owned-historical-engine")
        call = value.docker.run.call_args
        self.assertEqual(call.args[0], ["exec", "--interactive", "owned-historical-engine", "sh", "-ec",
            "nc -w 5 127.0.0.1 9000 2>/dev/null | head -c 16385"])
        self.assertIn(f"head -c {smoke.MEDIA_RESPONSE_LIMIT + 1}", call.args[0][-1])
        self.assertEqual(call.kwargs["timeout"], 10)
        self.assertIs(call.kwargs["check"], False)
        request = call.kwargs["input_bytes"]
        self.assertIsInstance(request, bytes)
        header, body = request.split(b"\r\n\r\n", 1)
        self.assertTrue(header.startswith(b"POST /api/media HTTP/1.1\r\nHost: 127.0.0.1:9000\r\n"))
        self.assertIn(b"Connection: close\r\n", header)
        self.assertIn(f"Content-Length: {len(body)}".encode(), header)
        self.assertIn(value.auth["Authorization"].encode(), header)
        self.assertIn(smoke.UPGRADE_PNG, body)
        self.assertIn(b"\x00", body)
        boundary = header.split(b"boundary=", 1)[1].split(b"\r\n", 1)[0]
        self.assertTrue(body.endswith(b"\r\n--" + boundary + b"--\r\n"))
        self.assertLess(body.find(b"\x00"), len(body) - len(boundary) - 8)
        self.assertNotIn("synthetic-token", str(call.args))
        self.assertNotIn(value.auth["Authorization"], str(call.args))
        self.assertNotIn("--post-file", str(call.args))
        self.assertLessEqual(len(request), smoke.MEDIA_REQUEST_LIMIT)

    def test_request_header_injection_or_oversize_rejects_before_control(self):
        for authorization in ("Basic value\r\nInjected: private", "Bearer private", "Basic " + "A" * 2049, None):
            value = self.fixture()
            value.auth["Authorization"] = authorization
            with self.subTest(authorization=authorization is None), self.assertRaises(smoke.SmokeError):
                value.upload_old_media()
            value.owned.assert_not_called()
            value.docker.run.assert_not_called()
        value = self.fixture()
        with patch.object(smoke, "UPGRADE_PNG", b"x" * smoke.MEDIA_REQUEST_LIMIT), self.assertRaises(smoke.SmokeError):
            value.upload_old_media()
        value.docker.run.assert_not_called()

    def test_failed_transport_never_retains_body_credentials_or_raw_errors(self):
        for failure in (subprocess.CompletedProcess([], 1, b"synthetic-sensitive-output", b"synthetic-sensitive-output"),
                        smoke.SmokeError("transport synthetic-sensitive-output")):
            value = self.fixture()
            value.docker.run = Mock(return_value=failure, side_effect=failure if isinstance(failure, Exception) else None)
            with self.subTest(failure=type(failure).__name__), self.assertRaises(smoke.SmokeError) as raised:
                value.upload_old_media()
            self.assertNotIn("synthetic-sensitive-output", str(raised.exception))
            self.assertEqual(value.report["supportedOldUpgradePhase"], "media-api-upload")
            self.assertEqual(value.docker.run.call_count, 1)
            value.media_bytes.assert_not_called()

    def test_actual_api_response_and_exact_binary_media_check_remain_required(self):
        value = self.fixture()
        self.assertEqual(value.upload_old_media(), "fixture.png")
        self.assertEqual(value.docker.run.call_count, 1)
        value.media_bytes.assert_called_once_with("fixture.png")
        self.assertEqual(value.report["supportedOldUpgradePhase"], "media-byte-verification")
        self.assertEqual(value.report["supportedOldMediaHttpStatus"], 200)
        self.assertNotIn(value.auth["Authorization"], json.dumps(value.report))
        value = self.fixture()
        value.docker.run.return_value.stdout = self.response(chunked=True)
        self.assertEqual(value.upload_old_media(), "fixture.png")

    def test_api_failure_or_changed_media_cannot_qualify(self):
        value = self.fixture()
        value.docker.run.return_value.stdout = self.response(b"private diagnostic body", status=403)
        with self.assertRaisesRegex(smoke.SmokeError, r"upload rejected \(status 403\)") as raised:
            value.upload_old_media()
        self.assertNotIn("private diagnostic body", str(raised.exception))
        self.assertNotIn("private diagnostic body", json.dumps(value.report))
        self.assertEqual(value.report["supportedOldMediaHttpStatus"], 403)
        self.assertEqual(value.report["supportedOldUpgradePhase"], "media-api-upload")
        value.media_bytes.assert_not_called()
        value = self.fixture()
        value.media_bytes.return_value = b"changed binary media"
        with self.assertRaisesRegex(smoke.SmokeError, "preserve exact uploaded bytes"):
            value.upload_old_media()

    def test_bad_json_filename_or_framing_never_reaches_the_media_read(self):
        for raw in (self.response(b"private-not-json"), self.response(b'{"data":{"filename":"../escape"}}'),
                    self.response(b'{"data":{"filename":true}}'), b"private malformed HTTP",
                    self.response(b"[" * 1500 + b"]" * 1500)):
            value = self.fixture()
            value.docker.run.return_value.stdout = raw
            with self.subTest(prefix=raw[:12]), self.assertRaises(smoke.SmokeError) as raised:
                value.upload_old_media()
            self.assertNotIn("private", str(raised.exception))
            value.media_bytes.assert_not_called()


class BoundedMediaHttpTests(unittest.TestCase):
    def test_content_length_and_bounded_chunked_controls(self):
        response = HistoricalMediaTransportTests().response
        body = b'{"data":{"filename":"fixture.png"}}'
        self.assertEqual(smoke.parse_media_http_response(response(body)), (200, body))
        self.assertEqual(smoke.parse_media_http_response(response(body, chunked=True)), (200, body))
        split = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n1\r\n \r\n0\r\n\r\n"
        self.assertEqual(smoke.parse_media_http_response(split), (200, b"{} "))

    def test_framing_duplicates_conflicts_truncation_or_missing_length_reject(self):
        for raw in (
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{}",
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\ntransfer-encoding: chunked\r\n\r\n0\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n{}",
            b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n{}",
            b"HTTP/1.1 200 OK\r\nContent-Length: 02\r\n\r\n{}",
            b"HTTP/1.1 200 OK\r\nContent-Length: +2\r\n\r\n{}",
            b"HTTP/1.1 200 OK\r\n\r\n{}",
            b"HTTP/1.1 999 private\r\nContent-Length: 0\r\n\r\n",
            b"HTTP/1.1 200 OK\r\n Content-Length: 2\r\n\r\n{}",
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\nInjected: private\r\n\r\n{}",
        ):
            with self.subTest(raw=raw[:30]), self.assertRaises(smoke.SmokeError):
                smoke.parse_media_http_response(raw)

    def test_chunk_errors_extensions_trailers_oversize_or_excess_count_reject(self):
        header = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
        for body in (b"zz\r\nx\r\n0\r\n\r\n", b"2\r\nx\r\n0\r\n\r\n", b"1;ignored\r\nx\r\n0\r\n\r\n",
                     b"1\r\nx\r\n0\r\nX-Trailer: private\r\n\r\n", b"0\r\n\r\nextra", b"10000000\r\n",
                     b"1\r\nx\r\n" * 128 + b"0\r\n\r\n"):
            with self.subTest(prefix=body[:20]), self.assertRaises(smoke.SmokeError):
                smoke.parse_media_http_response(header + body)
        with self.assertRaises(smoke.SmokeError):
            smoke.parse_media_http_response(header.replace(b"chunked", b"gzip") + b"0\r\n\r\n")

    def test_response_header_and_decoded_body_budgets_reject(self):
        response = HistoricalMediaTransportTests().response
        for raw in (b"x" * (smoke.MEDIA_RESPONSE_LIMIT + 1),
                    b"HTTP/1.1 200 OK\r\nX-Padding: " + b"x" * smoke.MEDIA_HEADER_LIMIT + b"\r\nContent-Length: 0\r\n\r\n",
                    response(b"x" * (smoke.MEDIA_BODY_LIMIT + 1)),
                    response(b"x" * (smoke.MEDIA_BODY_LIMIT + 1), chunked=True)):
            with self.subTest(length=len(raw)), self.assertRaises(smoke.SmokeError):
                smoke.parse_media_http_response(raw)


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
