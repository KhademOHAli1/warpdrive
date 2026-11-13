"""Opt-in native PostgreSQL, Silo and newsletter recovery from one encrypted snapshot."""

import base64
from contextlib import ExitStack, contextmanager, nullcontext
import hashlib
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import time
import unittest
import uuid

import recovery as r
from restore_recovery_set import restore_existing
from test_recovery import Fixture, put
from test_restore_recovery_set import initialize_independent_fixture_keys, revoke_fixture_writer


ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get("WARPDRIVE_RECOVERY_PG_BIN", "/opt/homebrew/opt/postgresql@16/bin"))
RUN = os.environ.get("WARPDRIVE_RECOVERY_POSTGRES_FIXTURE") == "1"
SILO_VERSION = "RELEASE.2026-10-26T00-00-00Z"
SILO_COMMIT = "c3ad836aed0d8a7d23c2e44a5eaa3009d08525e3"
MAX_SILO_BINARY = 160 * 1024**2


@contextmanager
def loopback_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        yield probe.getsockname()[1]


@unittest.skipUnless(RUN, "Explicit owned PostgreSQL and restic fixture only")
class RestoredPostgresTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.close)
        self.root = self.fixture.root
        self.bun = shutil.which("bun")
        self.assertIsNotNone(self.bun)
        self.command = {
            "PATH": os.defpath, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "TMPDIR": str(self.root),
        }
        version = self.pg("postgres", "--version").strip()
        self.assertRegex(version, r"^postgres \(PostgreSQL\) 16\.")
        self.nonce = secrets.token_hex(16)
        self.silo_binary = self.admit_silo()
        engine = self.admit_binary("ENGINE", "listmonk", 64 * 1024**2)
        self.engine = None
        if engine is not None:
            from recovery_engine_fixture import NewsletterRecoveryFixture

            self.assertIsNotNone(self.silo_binary, "The coordinated Engine fixture requires native Silo")
            version = self.run_owned([str(engine), "--version"], seconds=5).strip()
            self.assertRegex(version, r"^v6\.2\.0\+warpdrive-crm\.1-[a-f0-9]{7,40}$")
            self.engine = NewsletterRecoveryFixture(self, PG, engine, loopback_port)

    def run_owned(self, args, *, env=None, seconds=60):
        result = subprocess.run(
            args, cwd=ROOT, env=env or self.command, stdin=subprocess.DEVNULL,
            capture_output=True, timeout=seconds, check=False,
        )
        self.assertEqual(result.returncode, 0, f"Owned fixture command failed: {Path(args[0]).name}")
        return result.stdout.decode()

    def pg(self, name, *args):
        return self.run_owned([str(PG / name), *args], seconds=15)

    def admit_silo(self):
        executable = self.admit_binary("SILO", "silo", MAX_SILO_BINARY)
        if executable is not None:
            version = self.run_owned([str(executable), "--version"], seconds=5).splitlines()
            self.assertGreaterEqual(len(version), 2)
            self.assertEqual(version[0], f"silo version {SILO_VERSION} (commit-id={SILO_COMMIT})")
            self.assertRegex(version[1], r"^Runtime: go\S+ darwin/arm64$")
        return executable

    def admit_binary(self, component, filename, maximum):
        source = os.environ.get(f"WARPDRIVE_RECOVERY_{component}_BIN")
        expected = os.environ.get(f"WARPDRIVE_RECOVERY_{component}_SHA256")
        if source is None and expected is None:
            return None
        self.assertEqual(os.uname().sysname, "Darwin")
        self.assertEqual(os.uname().machine, "arm64")
        self.assertTrue(source and expected and re.fullmatch(r"[a-f0-9]{64}", expected),
                        f"Native {component} requires an absolute binary and exact executable SHA-256")
        source_path = r.absolute(source)
        executable = self.root / filename
        sha = hashlib.sha256()
        with os.fdopen(r.open_path(source_path), "rb") as original:
            before = os.fstat(original.fileno())
            self.assertTrue(
                stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                and before.st_nlink == 1 and 0 < before.st_size <= maximum
                and before.st_mode & 0o022 == 0,
                f"Native {component} input must be an owned regular file within its byte limit",
            )
            self.assertTrue(original.read(8) == b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01",
                            f"Native {component} input must be an ARM64 Mach-O")
            original.seek(0)
            fd = os.open(executable, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as copy:
                remaining = before.st_size
                while remaining:
                    chunk = original.read(min(remaining, 256 * 1024))
                    self.assertTrue(chunk, f"Native {component} executable truncated")
                    sha.update(chunk)
                    copy.write(chunk)
                    remaining -= len(chunk)
                self.assertFalse(original.read(1), f"Native {component} executable grew")
                after = os.fstat(original.fileno())
                self.assertEqual((after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                                 (before.st_size, before.st_mtime_ns, before.st_ctime_ns))
                self.assertEqual(sha.hexdigest(), expected, f"Native {component} executable digest differs")
                copy.flush()
                os.fchmod(copy.fileno(), 0o500)
                os.fsync(copy.fileno())
        return executable

    @staticmethod
    def silo_ready(port):
        connection = HTTPConnection("127.0.0.1", port, timeout=0.5)
        try:
            connection.request("GET", "/minio/health/ready")
            return connection.getresponse().status == 200
        except (OSError, HTTPException):
            return False
        finally:
            connection.close()

    def assert_loopback_listeners(self, process, required, allowed):
        listeners = self.run_owned(
            ["/usr/sbin/lsof", "-nP", "-a", "-p", str(process.pid), "-iTCP", "-sTCP:LISTEN", "-Fpn"],
            seconds=4,
        ).splitlines()
        self.assertEqual({line for line in listeners if line.startswith("p")}, {f"p{process.pid}"},
                         "Owned recovery service listener identity differs")
        endpoints = {line[1:] for line in listeners if line.startswith("n")}
        self.assertLessEqual(required, endpoints, "A required recovery service loopback listener is absent")
        self.assertLessEqual(endpoints, allowed, "Recovery service opened an unexpected listener")

    @contextmanager
    def silo(self, data, name, credentials):
        private = self.root / f"silo-{name}"
        private.mkdir(mode=0o700)
        for leaf in ("config", "certs"):
            (private / leaf).mkdir(mode=0o700)
        access, password = private / "access", private / "password"
        put(access, (credentials["siloAccess"] + "\n").encode())
        put(password, (credentials["siloPassword"] + "\n").encode())
        with loopback_port() as port, loopback_port() as console_port:
            self.assertNotEqual(port, console_port)
        environment = {
            **self.command, "MINIO_ROOT_USER_FILE": str(access), "MINIO_ROOT_PASSWORD_FILE": str(password),
            "MINIO_BROWSER": "off", "GOMEMLIMIT": "192MiB", "GOMAXPROCS": "2", "NO_COLOR": "1",
        }
        process = subprocess.Popen(
            [str(self.silo_binary), "server", "--address", f"127.0.0.1:{port}",
             "--console-address", f"127.0.0.1:{console_port}", "--quiet", "--anonymous",
             "--config-dir", str(private / "config"), "--certs-dir", str(private / "certs"), str(data)],
            cwd=private, env=environment, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            deadline = time.monotonic() + 15
            while not self.silo_ready(port):
                self.assertIsNone(process.poll(), "Owned Silo exited during startup")
                self.assertLess(time.monotonic(), deadline, "Owned Silo readiness deadline")
                time.sleep(0.05)
            allowed = {f"{host}:{selected}" for host in ("127.0.0.1", "[::1]") for selected in (port, console_port)}
            self.assert_loopback_listeners(process, {f"127.0.0.1:{port}"}, allowed)
            yield port
            self.assertIsNone(process.poll(), "Owned Silo exited while serving")
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                    self.fail("Owned Silo did not shut down cleanly")
            self.assertEqual(process.returncode, 0)
            for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
                for selected in (port, console_port):
                    with socket.socket(family) as probe:
                        probe.settimeout(0.5)
                        self.assertNotEqual(probe.connect_ex((host, selected)), 0,
                                            "A Silo fixture port remains open")

    @contextmanager
    def database(self, data, name, *, max_connections=12):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        output = self.root / (name + ".log")
        put(output, b"")
        with output.open("ab") as log:
            postgres = subprocess.Popen(
                [str(PG / "postgres"), "-D", str(data), "-h", "127.0.0.1", "-k", "",
                 "-p", str(port), "-c", f"warpdrive.recovery_fixture={self.nonce}",
                 "-c", f"max_connections={max_connections}", "-c", "shared_buffers=16MB",
                 "-c", "max_wal_size=64MB", "-c", "min_wal_size=32MB",
                 "-c", "max_parallel_workers=0", "-c", "jit=off", "-c", "log_min_messages=warning"],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=self.command,
            )
            try:
                deadline = time.monotonic() + 10
                while True:
                    self.assertIsNone(postgres.poll(), "Owned PostgreSQL exited during startup")
                    result = subprocess.run(
                        [str(PG / "pg_isready"), "-q", "-h", "127.0.0.1", "-p", str(port), "-t", "1"],
                        capture_output=True, env=self.command, timeout=2, check=False,
                    )
                    if result.returncode == 0:
                        break
                    self.assertLess(time.monotonic(), deadline, "Owned PostgreSQL readiness deadline")
                    time.sleep(0.05)
                yield port
            finally:
                if postgres.poll() is None:
                    postgres.send_signal(signal.SIGINT)
                    try:
                        postgres.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        postgres.kill()
                        postgres.wait(timeout=5)
                        self.fail("Owned PostgreSQL did not shut down cleanly")
        self.assertEqual(postgres.returncode, 0)
        self.assertRegex(self.pg("pg_controldata", str(data)), r"Database cluster state:\s+shut down\n")
        with socket.socket() as probe:
            probe.settimeout(0.5)
            self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0, "A PostgreSQL fixture port remains open")

    def harness(self, mode, port, marker, config, *, silo_port=None, **values):
        role = "recovery_owner" if mode == "seed" else "recovery_runtime"
        password = config["ownerPassword"] if mode == "seed" else config["runtimePassword"]
        env = {
            **self.command, "NODE_ENV": "test", "BASE_URL": "https://recovery.example.test",
            "DATABASE_URL": f"postgres://{role}:{password}@127.0.0.1:{port}/recovery_fixture",
            "WS_TICKET_SECRET": secrets.token_urlsafe(36), "WS_PUBLIC_URL": "wss://recovery.example.test/ws",
            "MINIO_ENDPOINT": "http://127.0.0.1:1", "MINIO_ACCESS_KEY": "synthetic",
            "MINIO_SECRET_KEY": "synthetic", "MCP_ENABLED": "false", "AUTH_GOOGLE_ENABLED": "false",
            "AUTH_SECRET": config["authSecret"], "TOKEN_ENCRYPTION_KEY": config["encryptionKey"],
            "DISABLE_TELEMETRY": "true", "DISABLE_UPDATE_CHECK": "true",
            **values,
        }
        if silo_port is not None:
            env.update(MINIO_ENDPOINT=f"http://127.0.0.1:{silo_port}",
                       MINIO_BUCKET="warpdrive-recovery-fixture", MINIO_ACCESS_KEY=config["siloAccess"],
                       MINIO_SECRET_KEY=config["siloPassword"], RECOVERY_FIXTURE_SILO_PORT=str(silo_port))
        raw = self.run_owned(
            [self.bun, "--no-env-file", "--smol", "scripts/deployment/recovery-postgres.harness.ts", mode, str(marker)],
            env=env,
        )
        return json.loads(raw.splitlines()[-1])

    def test_cold_restored_database_retains_runtime_state(self):
        f = self.fixture
        marker = self.root / "readback-expectations.json"
        put(marker, r.canonical({"nonce": self.nonce, "ownerId": str(uuid.uuid4()), "otherOwnerId": str(uuid.uuid4()),
                                 "operationId": str(uuid.uuid4()), "token": secrets.token_urlsafe(36)}))
        config = {"ownerPassword": secrets.token_hex(32), "runtimePassword": secrets.token_hex(32),
                  "authSecret": secrets.token_urlsafe(48), "encryptionKey": base64.b64encode(secrets.token_bytes(32)).decode()}
        objects = Path(f.members["objects"])
        fixture_dir = Path(f.members["newsletterMedia"])
        engine_state = None
        if self.silo_binary is not None:
            (objects / "synthetic.data").unlink()
            config.update(siloAccess="recoveryfixture" + secrets.token_hex(12), siloPassword=secrets.token_hex(24))
        put(f.configuration, r.canonical(config))
        password_file = self.root / "init-password"
        put(password_file, (config["ownerPassword"] + "\n").encode())
        data = Path(f.members["postgres"]) / "data"
        self.pg("initdb", "-D", str(data), "-U", "recovery_owner", "--auth=scram-sha-256",
                "--pwfile", str(password_file), "--no-locale", "--encoding=UTF8")
        password_file.unlink()
        source_silo = self.silo(objects, "source", config) if self.silo_binary else nullcontext()
        with self.database(data, "source") as source_port, source_silo as source_silo_port:
            self.run_owned(
                [str(PG / "createdb"), "-h", "127.0.0.1", "-p", str(source_port), "-U", "recovery_owner", "recovery_fixture"],
                env={**self.command, "PGPASSWORD": config["ownerPassword"]}, seconds=10,
            )
            seeded = self.harness("seed", source_port, marker, config, silo_port=source_silo_port,
                                  RECOVERY_FIXTURE_RUNTIME_PASSWORD=config["runtimePassword"])
            if self.engine is not None:
                config["enginePassword"] = secrets.token_hex(32)
                engine_state, config["engineToken"] = self.engine.seed(source_port, fixture_dir, config)
                put(f.configuration, r.canonical(config))
        media = secrets.token_bytes(4_096)
        put(fixture_dir / "example.bin", media)
        restic = Path(os.environ.get("WARPDRIVE_RECOVERY_RESTIC", "/opt/homebrew/bin/restic")).resolve(strict=True)
        f.plan["limits"].update(bytes=256 * 1024**2, fileBytes=64 * 1024**2, seconds=150, repositoryBytes=128 * 1024**2)
        writer_id = initialize_independent_fixture_keys(f, restic, seconds=150)
        receipt = f.capture()
        revoke_fixture_writer(f, restic, writer_id)
        receipt_path, manifest_path = self.root / "verified-receipt.json", self.root / "verified-manifest.json"
        manifest_member = f.journal.path / "recovery-manifest.json"
        put(receipt_path, r.canonical(receipt))
        put(manifest_path, manifest_member.read_bytes())
        for name in ("source", "configuration", "state", "restore", "key-primary"):
            (self.root / name).rename(self.root / ("offline-" + name))
        del config
        target = self.root / "independent"
        restored = restore_existing(
            receipt_path, expected_receipt_sha256=r.digest(r.canonical(receipt)), manifest_path=manifest_path,
            original_manifest_member=manifest_member, reader=r.Restic(restic, str(f.repo), f.keys[1], seconds=150),
            restore_target=target, budget=f.plan["limits"],
        )
        self.assertEqual(restored["snapshotId"], receipt["snapshotId"])
        self.assertFalse(restored["writerResumptionAuthorized"])
        self.assertEqual((target / str(fixture_dir / "example.bin").lstrip("/")).read_bytes(), media)
        restored_data = target / str(data).lstrip("/")
        restored_objects = target / str(objects).lstrip("/")
        restored_media = target / str(fixture_dir).lstrip("/")
        restored_config = json.loads((target / str(f.configuration).lstrip("/")).read_bytes())
        self.assertFalse(data.exists())
        self.assertFalse(objects.exists())
        self.assertFalse(fixture_dir.exists())
        expected = {"credentialDecrypted": True, "queuePending": True, "unknownReceiptHeld": True,
                    "crossActorReceiptHidden": True, "runtimeDdlDenied": True}
        with ExitStack() as runtime:
            port = runtime.enter_context(self.database(restored_data, "restored"))
            self.assertNotEqual(port, source_port, "Restored PostgreSQL reused the source listener")
            object_values = {}
            silo_port = None
            if self.silo_binary is not None:
                self.assertTrue((restored_objects / ".minio.sys").is_dir())
                silo_port = runtime.enter_context(self.silo(restored_objects, "restored", restored_config))
                self.assertNotEqual(silo_port, source_silo_port, "Restored Silo reused the source listener")
                object_values["RECOVERY_FIXTURE_FILE_ID"] = seeded["fileId"]
                expected.update(objectBytesAndMetadataVerified=True, anonymousObjectDenied=True,
                                crossActorAttachmentDenied=True)
            outcome = self.harness("verify", port, marker, restored_config, silo_port=silo_port,
                                   RECOVERY_FIXTURE_JOB_ID=seeded["jobId"], **object_values)
            self.assertEqual(outcome, expected)
            result = self.harness("reject-key", port, marker, restored_config,
                                  TOKEN_ENCRYPTION_KEY=base64.b64encode(secrets.token_bytes(32)).decode())
            self.assertEqual(result, {"wrongKeyRejected": True})
            if self.engine is not None:
                self.engine.verify(port, restored_media, restored_config, engine_state)
