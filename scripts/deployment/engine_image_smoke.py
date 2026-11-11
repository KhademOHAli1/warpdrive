#!/usr/bin/env python3
"""Qualify an already-built final Linux engine image on owned local Docker only.

No builds, publication, source mounts, inherited provider credentials or deployment.
Native migration contract functions run through actual final-image containers.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import secrets
import signal
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from types import SimpleNamespace
import uuid

try:
    from .image_smoke import ImageSmoke, OWNER_LABEL, SmokeError, validate_reference, validate_revision, utc_now
    from .registry_smoke import IsolatedDocker
except ImportError:
    from image_smoke import ImageSmoke, OWNER_LABEL, SmokeError, validate_reference, validate_revision, utc_now
    from registry_smoke import IsolatedDocker

REPO = Path(__file__).resolve().parents[2]
CONTEXT = REPO / "deploy/newsletters/engine"
UPSTREAM_SHA = "52119464c87ed71a60d46f7097ddb304967d344fc1954769388a1e2d764b659b"
UPSTREAM_SOURCE = "https://github.com/knadh/listmonk/tree/ef0a75872463f10a4848af6c547d1c057405453a"
CONTEXT_LABEL = "io.warpdrive.engine.context.sha256"
LIMITATIONS = [
    "Disposable Linux/amd64 final-image fixture only; no production deployment or existing-volume ownership transition.",
    "Legacy upgrade starts from pinned upstream schema, not an older installed packed binary.",
    "No external SMTP/provider delivery, public ingress, backup restore or installed monitoring qualification.",
    "Advisory lifecycle locks are cooperative; supported DDL still requires independently verified offline maintenance.",
]
REQUIRED_CHECKS = (
    "immutable-final-engine-image", "owned-internal-fixture", "actual-final-image-packaging",
    "empty-runtime-refuses-schema-writes", "file-secret-loader-and-fresh-install", "fresh-repeat-no-write-migration", "pinned-schema-legacy-holds",
    "explicit-upgrade-and-no-write", "receipt-and-index-drift-rejection", "restricted-role-no-ddl-startup",
    "rls-policy-sequence-drift-rejection", "runtime-excludes-migration", "migration-excludes-actual-runtime",
    "fence-loss-exits-and-restarts", "final-image-health-and-readiness",
)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def required_checks_passed(checks) -> bool:
    return (isinstance(checks, list)
            and all(isinstance(item, dict) and item.get("status") == "passed" for item in checks)
            and tuple(item.get("name") for item in checks) == REQUIRED_CHECKS)


def admit_native_platform(system: str, machine: str, daemon) -> None:
    if (system != "Linux" or machine.lower() not in {"x86_64", "amd64"}
            or not isinstance(daemon, dict) or daemon.get("os") != "linux"
            or str(daemon.get("architecture", "")).lower() not in {"x86_64", "amd64"}):
        raise SmokeError("Engine qualification requires native Linux/amd64 host and Docker daemon")


class ExpandedTarReader:
    """Cap decompressed bytes even before tarfile parses extended/PAX headers."""
    def __init__(self, stream, limit):
        self.stream, self.limit, self.seen = stream, limit, 0

    def read(self, size=-1):
        remaining = self.limit - self.seen
        size = remaining + 1 if size < 0 else min(size, remaining + 1)
        data = self.stream.read(size)
        self.seen += len(data)
        if self.seen > self.limit:
            raise SmokeError("Engine source archive expanded-byte bound exceeded")
        return data


@contextmanager
def bounded_tar(path: Path, payload_limit: int, member_limit: int):
    # Header overhead is bounded as well as regular file bodies. Stream mode and
    # immediate iteration prevent unbounded TarInfo caching before admission.
    with gzip.open(path, "rb") as expanded:
        reader = ExpandedTarReader(expanded, payload_limit + member_limit * 4096 + 51200)
        with tarfile.open(fileobj=reader, mode="r|") as archive:
            yield archive


def context_record(context: Path = CONTEXT) -> dict:
    files = {}
    total = 0
    for path in sorted(context.rglob("*")):
        if path.is_symlink():
            raise SmokeError("Engine context symlinks are unsupported")
        if not path.is_file():
            continue
        relative = path.relative_to(context).as_posix()
        if "__pycache__" in path.parts or path.name.startswith(".env") or path.suffix == ".pyc":
            raise SmokeError("Engine context contains an unqualified generated/secret file")
        total += path.stat().st_size
        if path.stat().st_size > 2 * 1024**2 or total > 8 * 1024**2 or len(files) >= 256:
            raise SmokeError("Engine build context exceeds its reviewed resource bound")
        files[relative] = digest(path.read_bytes())
    required = {"Dockerfile", "build.sh", "nonroot-entrypoint.sh", "patches/090-explicit-migrations.patch",
                "migration-tests/verify.py", "migration-tests/test_verify.py"}
    if not required <= files.keys():
        raise SmokeError("Engine context is missing required migration/nonroot inputs")
    encoded = json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    return {"sha256": digest(encoded), "files": files}


def engine_metadata(raw, revision: str, context_sha: str) -> dict:
    if not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], dict):
        raise SmokeError("Engine image inspection is invalid")
    image = raw[0]
    config = image.get("Config") or {}
    labels = config.get("Labels") or {}
    if image.get("Os") != "linux" or image.get("Architecture") != "amd64":
        raise SmokeError("Engine qualification requires the actual Linux/amd64 final image")
    if config.get("User") != "65532:65532":
        raise SmokeError("Engine image must default to numeric nonroot user 65532:65532")
    if config.get("Entrypoint") != ["/usr/local/bin/warpdrive-engine-entrypoint.sh"] or config.get("Cmd") != ["./listmonk"]:
        raise SmokeError("Engine default entrypoint/CMD does not match the qualified command contract")
    if config.get("WorkingDir") != "/listmonk" or config.get("Volumes"):
        raise SmokeError("Unexpected engine working directory or anonymous volume")
    if labels.get("org.opencontainers.image.revision") != revision or labels.get(CONTEXT_LABEL) != context_sha:
        raise SmokeError("Engine source/context labels do not match requested inputs")
    if labels.get("org.opencontainers.image.source") != UPSTREAM_SOURCE:
        raise SmokeError("Engine image must preserve the pinned upstream source attribution")
    for value in config.get("Env") or []:
        key, _, content = value.partition("=")
        if content and re.search(r"SECRET|PASSWORD|TOKEN|KEY|_FILE$", key, re.I):
            raise SmokeError("Final engine image contains a credential/file override")
    image_id = image.get("Id", "")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id):
        raise SmokeError("Engine image has no immutable local image ID")
    return {"id": image_id, "revision": revision, "contextSha256": context_sha,
            "user": config["User"], "platform": "linux/amd64", "upstreamSource": UPSTREAM_SOURCE}


def installer_fingerprint(source: Path) -> str:
    names = {p.relative_to(source).as_posix() for p in (source / "internal/migrations").rglob("*")
             if p.is_file() and not p.name.endswith("_test.go")}
    names.update(p.relative_to(source).as_posix() for p in (source / "cmd").rglob("*.sql"))
    names.update(("schema.sql", "cmd/install.go", "cmd/upgrade.go", "cmd/main.go", "cmd/init.go",
                  "cmd/warpdrive_migrations.go", "cmd/crm_identity.go", "cmd/warpdrive_audiences.go",
                  "cmd/warpdrive_delivery_store.go", "cmd/warpdrive_readiness.go", "cmd/warpdrive_operational_events.go",
                  "internal/sesfeedback/feedback.go", "internal/sesfeedback/schema.sql"))
    checksums = "".join(f"{digest((source / name).read_bytes())}  {name}\n" for name in sorted(names))
    return digest(checksums.encode())


def verify_source_archive(path: Path, expected: dict, destination: Path) -> str:
    maximum = len(expected["files"]) + 2
    with bounded_tar(path, 64 * 1024**2, maximum) as archive:
        entries = {}
        count = total = 0
        for member in archive:
            count += 1
            total += member.size
            if count > maximum or member.size < 0 or total > 64 * 1024**2:
                raise SmokeError("Corresponding-source archive member count/size exceeds bound")
            if not member.isfile() or member.name in entries or not Path(member.name).is_relative_to(".") or ".." in Path(member.name).parts:
                raise SmokeError("Corresponding-source archive contains an unsafe entry")
            entries[member.name] = archive.extractfile(member).read()
        if set(entries) != set(expected["files"]) | {"LICENSE", "listmonk-ef0a758.tar.gz"}:
            raise SmokeError("Corresponding-source archive is not the exact reviewed context")
        for name, sha in expected["files"].items():
            if digest(entries[name]) != sha:
                raise SmokeError("Corresponding-source archive input differs from reviewed context")
        if digest(entries["listmonk-ef0a758.tar.gz"]) != UPSTREAM_SHA:
            raise SmokeError("Corresponding-source upstream archive is not pinned")
        upstream = destination / "upstream.tar.gz"
        upstream.write_bytes(entries["listmonk-ef0a758.tar.gz"])
    source = destination / "source"
    source.mkdir()
    with bounded_tar(upstream, 128 * 1024**2, 20000) as tar:
        count = total = 0
        for member in tar:
            count += 1
            total += member.size
            if count > 20000 or member.size < 0 or total > 128 * 1024**2:
                raise SmokeError("Pinned source member count/size exceeds bound")
            parts = Path(member.name).parts[1:]
            if not parts:
                continue
            if member.issym() or member.islnk() or ".." in parts:
                raise SmokeError("Pinned source member is unsafe")
            member.name = str(Path(*parts))
            tar.extract(member, source, filter="data")
    for patch in sorted((CONTEXT / "patches").glob("*.patch")):
        result = subprocess.run(["git", "apply", str(patch)], cwd=source, capture_output=True, timeout=10)
        if result.returncode:
            raise SmokeError("Reviewed engine patches do not apply to archived source")
    return installer_fingerprint(source)


def native_contract():
    spec = importlib.util.spec_from_file_location("_engine_native_migration", CONTEXT / "migration-tests/verify.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NATIVE = native_contract()


class ContainerProcess:
    """Only actual owned container state determines process completion."""
    def __init__(self, fixture, name):
        self.fixture, self.name = fixture, name

    def poll(self):
        state = self.fixture.state(self.name)
        if state.get("OOMKilled"):
            raise SmokeError("Final engine process was OOM killed")
        if state["Running"]:
            return None
        code = state.get("ExitCode")
        if type(code) is not int:
            raise SmokeError("Final engine exit state is invalid")
        return code

    def wait(self, timeout=25):
        self.fixture.owned(self.name)
        self.fixture.docker.run(["wait", self.name], timeout=timeout)
        code = self.poll()
        if code is None:
            raise SmokeError("Final engine process remained running after wait")
        return code

    def terminate(self):
        self.fixture.owned(self.name)
        self.fixture.docker.run(["kill", "--signal", "TERM", self.name], timeout=10)

    def kill(self):
        self.fixture.owned(self.name)
        self.fixture.docker.run(["kill", "--signal", "KILL", self.name], timeout=10)


class EngineImageSmoke(ImageSmoke, NATIVE.MigrationFixture):
    def __init__(self, docker, image: str, revision: str, output: Path):
        self.docker, self.image = docker, validate_reference(image)
        self.expected_revision, self.output_dir = validate_revision(revision), output
        self.prefix = "wd-engine-" + uuid.uuid4().hex[:12]
        self.resources, self.containers = [], {}
        self.clock, self.sleep = time.monotonic, time.sleep
        self.context = context_record()
        self.counter, self.serve = 0, None
        self.pg_bin, self.socket, self.root = Path("/usr/local/bin"), Path("/var/run/postgresql"), output
        password = secrets.token_urlsafe(32)
        self.pg_env = {"POSTGRES_USER": "consentproof", "POSTGRES_PASSWORD": password, "POSTGRES_DB": "consent"}
        self.env = {"LISTMONK_app__address": "127.0.0.1:9000", "LISTMONK_db__host": "postgres",
                    "LISTMONK_db__port": "5432", "LISTMONK_db__user": "consentproof", "LISTMONK_db__database": "consent",
                    "LISTMONK_db__password": password, "LISTMONK_db__ssl_mode": "disable", "LISTMONK_db__max_open": "4",
                    "LISTMONK_db__max_idle": "2", "LISTMONK_db__max_lifetime": "300s", "LISTMONK_db__params": "connect_timeout=3",
                    "LISTMONK_ADMIN_USER": "consent-proof", "LISTMONK_ADMIN_PASSWORD": secrets.token_urlsafe(24),
                    "LISTMONK_ADMIN_API_USER": "consent-proof-api", "NEWSLETTER_DELIVERY_ENABLED": "false",
                    "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false", "NEWSLETTER_SES_FEEDBACK_ENABLED": "false"}
        self.secret_directory, self.secret_file = None, None
        self.report = {"schemaVersion": 1, "success": False, "expectedRevision": revision, "startedAt": utc_now(),
                       "image": {}, "context": self.context, "checks": [], "failure": None, "diagnostics": [],
                       "resources": {"prefix": self.prefix, "network": self.prefix + "-network"},
                       "cleanup": {"success": False, "errors": []}, "limitations": LIMITATIONS}

    def owned(self, name):
        if ("container", name) not in self.resources:
            raise SmokeError("Unowned engine container read/control refused")
        labels = self.docker.json(["container", "inspect", name, "--format", "{{json .Config.Labels}}"])
        if not isinstance(labels, dict) or labels.get(OWNER_LABEL) != self.prefix:
            raise SmokeError("Engine container ownership changed; read/control refused")
        settings = self.docker.json(["container", "inspect", name, "--format", "{{json .NetworkSettings}}"])
        if not isinstance(settings, dict) or set(settings.get("Networks", {})) != {self.report["resources"]["network"]}:
            raise SmokeError("Owned engine fixture has an unexpected network attachment")
        if any(value for value in (settings.get("Ports") or {}).values()):
            raise SmokeError("Owned engine fixture unexpectedly publishes host ports")

    def state(self, name):
        self.owned(name)
        return ImageSmoke.state(self, name)

    def engine(self, flags, environment=None, missing_file=False, entry_command=None):
        self.counter += 1
        name = f"{self.prefix}-engine-{self.counter}"
        self.resources.append(("container", name))
        env = dict(self.env if environment is None else environment)
        args = ["run", "--detach", "--pull", "never", "--name", name, "--label", f"{OWNER_LABEL}={self.prefix}",
                "--network", self.report["resources"]["network"], "--memory", "256m", "--memory-swap", "256m",
                "--cpus", "1", "--pids-limit", "96", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--read-only", "--log-opt", "max-size=1m", "--log-opt", "max-file=1",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700"]
        if entry_command is None:
            args += ["--tmpfs", "/listmonk/uploads:rw,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700"]
            # Every database command authenticates through the real *_FILE loader.
            # A wrong direct value prevents a loader bypass from passing.
            env["LISTMONK_db__password"] = "deliberately-wrong-synthetic-password"
            env["LISTMONK_db__password_FILE"] = "/run/absent-engine-secret" if missing_file else "/run/engine-db-password"
            if not missing_file:
                args += ["--mount", f"type=bind,source={self.secret_file},target=/run/engine-db-password,readonly"]
        for key, value in sorted(env.items()):
            args += ["--env", f"{key}={value}"]
        args += [self.report["image"]["id"], *(entry_command if entry_command is not None else ["./listmonk", "--config", "", *flags])]
        self.docker.run(args, timeout=60)
        self.owned(name)
        return ContainerProcess(self, name)

    def pg_argv(self, arguments):
        self.owned(self.containers["postgres"])
        return ["docker", "--host", self.docker.endpoint, "exec", "--interactive", self.containers["postgres"], *arguments]

    def run(self, argv, **options):
        if Path(argv[0]).name not in {"psql", "pg_dump"}:
            raise SmokeError("Only owned PostgreSQL fixture tools are permitted")
        command = self.pg_argv(argv)
        try:
            result = self.docker.runner(command, env=self.docker.environment, capture_output=True,
                                        text=True, check=False, timeout=25, **options)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise SmokeError("Owned PostgreSQL fixture tool did not finish") from error
        if result.returncode:
            raise SmokeError("Owned PostgreSQL fixture SQL/tool failed")
        return result

    def command(self, flags, database="consent", timeout=25):
        process = self.engine(flags, {**self.env, "LISTMONK_db__database": database})
        code = process.wait(timeout)
        self.owned(process.name)
        logs = self.docker.run(["logs", process.name], timeout=5)
        return subprocess.CompletedProcess([], code, logs.stdout, logs.stderr)

    def launch(self, env=None):
        self.stop_engine()
        actual = self.env if env is None else env
        if actual.get("LISTMONK_db__user") == "migration_runtime":
            # Native local sockets use trust for this synthetic role. The image
            # fixture uses authenticated TCP, so arrange its password as owner
            # before launching the restricted runtime, outside runtime admission.
            value = self.pg_env["POSTGRES_PASSWORD"].replace("'", "''")
            self.sql(f"ALTER ROLE migration_runtime PASSWORD '{value}'")
        self.serve = self.engine(["--passive"], actual)
        return self.serve

    def stop_engine(self):
        if self.serve is not None and self.serve.poll() is None:
            self.owned(self.serve.name)
            self.docker.run(["stop", "--time", "5", self.serve.name], timeout=12)
            if self.serve.poll() is None:
                raise SmokeError("Owned engine runtime did not stop")

    def request(self, path, headers=None, body=None, method=None):
        if path not in {"/health", "/api/warpdrive/readiness"} or body is not None or method is not None:
            raise SmokeError("Only bounded fixture health/readiness GETs are allowed")
        self.owned(self.serve.name)
        args = ["exec", self.serve.name, "wget", "-q", "-S", "-T", "4", "-O", "-"]
        for key, value in (headers or {}).items():
            if key != "Authorization" or value != self.auth["Authorization"]:
                raise SmokeError("Unexpected fixture HTTP header")
            args += ["--header", key + ": " + value]
        result = self.docker.run([*args, "http://127.0.0.1:9000" + path], check=False, timeout=8)
        statuses = re.findall(r"HTTP/\S+\s+(\d{3})", result.stderr or "")
        if not statuses:
            raise OSError("Owned container HTTP response unavailable")
        status = int(statuses[-1])
        if status < 400 and result.returncode != 0:
            raise OSError("Owned container HTTP transfer did not finish")
        return status, result.stdout.encode()

    def inspect_image(self):
        metadata = engine_metadata(self.docker.json(["image", "inspect", self.image]), self.expected_revision, self.context["sha256"])
        self.report["image"] = metadata
        return metadata

    def create_environment(self):
        network = self.report["resources"]["network"]
        self.resources.append(("network", network))
        self.docker.run(["network", "create", "--internal", "--label", f"{OWNER_LABEL}={self.prefix}", network])
        if self.docker.json(["network", "inspect", network, "--format", "{{json .Internal}}"]) is not True:
            raise SmokeError("Engine fixture network is not internal")
        volume = self.prefix + "-pgdata"
        self.resources.append(("volume", volume))
        self.docker.run(["volume", "create", "--label", f"{OWNER_LABEL}={self.prefix}", volume])
        ImageSmoke.start_container(self, "postgres", "postgres:16-alpine", [], environment=self.pg_env,
                                   mount=f"type=volume,source={volume},target=/var/lib/postgresql/data",
                                   memory="512m", pull="missing")
        self.wait_for(lambda: self.docker.run(["exec", self.containers["postgres"], "pg_isready", "-U", "consentproof", "-d", "consent"],
                                             check=False, timeout=5).returncode == 0,
                      "owned PostgreSQL", 60, self.containers["postgres"])
        return {"internalNetwork": True, "publishedPorts": 0, "sourceMounts": 0, "providers": "disabled"}

    def packaging(self):
        probe = self.engine([], {}, entry_command=["sh", "-ec", "test $(id -u) = 65532; test -x ./listmonk; "
                            "test -r warpdrive-engine-source.tar.gz; test ! -e /engine; test ! -e /go; "
                            "test ! -e /usr/local/go; test ! -e /listmonk/cmd; test ! -e /listmonk/internal; "
                            "test ! -e /listmonk/.env; test $(stat -c %u /listmonk/uploads) = 65532"])
        if probe.wait() != 0:
            raise SmokeError("Final engine source-free/nonroot packaging probe failed")
        copies = {}
        for name, target in (("listmonk", "/listmonk/listmonk"), ("warpdrive-engine-source.tar.gz", "/listmonk/warpdrive-engine-source.tar.gz"),
                             ("entrypoint.sh", "/usr/local/bin/warpdrive-engine-entrypoint.sh")):
            self.owned(probe.name)
            path = self.output_dir / name
            self.docker.run(["cp", probe.name + ":" + target, str(path)], timeout=20)
            if not path.is_file() or path.stat().st_size > 64 * 1024**2:
                raise SmokeError("Copied engine artifact shape/size is unqualified")
            copies[name] = {"sha256": digest(path.read_bytes()), "bytes": path.stat().st_size}
        binary = (self.output_dir / "listmonk").read_bytes()
        if binary[:6] != b"\x7fELF\x02\x01" or int.from_bytes(binary[18:20], "little") != 62:
            raise SmokeError("Packaged engine is not an actual amd64 ELF executable")
        if copies["entrypoint.sh"]["sha256"] != self.context["files"]["nonroot-entrypoint.sh"]:
            raise SmokeError("Installed engine entrypoint differs from archived source")
        with tempfile.TemporaryDirectory(prefix="engine-source-check-") as folder:
            fingerprint = verify_source_archive(self.output_dir / "warpdrive-engine-source.tar.gz", self.context, Path(folder))
            self.legacy_schema = (Path(folder) / "source/schema.sql").read_bytes()
        if fingerprint.encode() + b"\n" not in binary:
            raise SmokeError("Packaged engine does not embed reconstructed installer content fingerprint")
        self.report["artifacts"], self.report["installerSha256"] = copies, fingerprint
        return {"defaultUid": 65532, "readOnlyRoot": True, "unpackedSourceAbsent": True,
                "sourceArchiveMatchesContext": True, "installerSha256": fingerprint}

    def initialize(self):
        result = self.command(["--install", "--yes"])
        if result.returncode != 0:
            raise SmokeError("Final-image explicit fresh installation failed")
        token = re.search(r'export LISTMONK_ADMIN_API_TOKEN="([^"]+)"', result.stdout + result.stderr)
        if token is None:
            raise SmokeError("Synthetic fixture API token was not minted")
        self.env["IMAGE_SMOKE_API_TOKEN"] = token[1]
        self.auth = {"Authorization": "Basic " + base64.b64encode(("consent-proof-api:" + token[1]).encode()).decode()}
        self.env["IMAGE_SMOKE_AUTH_TOKEN"] = self.auth["Authorization"]
        self.sql(sys.modules["consent"].SQL_FIXTURES)
        missing = self.engine(["--version"], missing_file=True)
        if missing.wait() == 0:
            raise SmokeError("Missing secret file did not reject before version-only command")
        self.secret_file.chmod(0)
        try:
            unreadable = self.engine(["--version"])
            if unreadable.wait() == 0:
                raise SmokeError("Unreadable secret file did not reject before version-only command")
        finally:
            self.secret_file.chmod(0o444)
        return {"freshExplicitInstall": True, "authenticatedFilePassword": True, "missingFileRejected": True,
                "unreadableFileRejected": True}

    def empty_runtime(self):
        self.sql("CREATE DATABASE engine_empty", "postgres")
        before = self.snapshot("engine_empty")
        empty = self.engine(["--passive"], {**self.env, "LISTMONK_db__database": "engine_empty"})
        if empty.wait() != 1:
            raise SmokeError("Ordinary final-image startup did not refuse an empty database")
        if self.snapshot("engine_empty") != before:
            raise SmokeError("Ordinary final-image startup changed empty database state")
        return {"ordinaryStartupRejected": True, "durableWrites": 0}

    def migration_excludes_runtime(self):
        self.sql("DROP TABLE public.warpdrive_engine_schema")
        suffix = secrets.token_hex(8)
        migration_name, runtime_name = "engine_migrator_" + suffix, "engine_waiter_" + suffix
        holder = SimpleNamespace(psql_args=lambda: self.pg_argv(self.psql_args()),
                                 env=self.docker.environment, root=self.output_dir)
        migration = None
        try:
            with NATIVE.held_lock(holder, NATIVE.DELIVERY_KEY):
                migration = self.engine(["--migrate", "--yes"], {**self.env, "LISTMONK_db__params": "application_name=" + migration_name})
                def fenced():
                    if migration.poll() is not None:
                        raise SmokeError("Final-image migration exited before actual fence acquisition")
                    return self.sql("SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid) "
                                    "WHERE a.datname=current_database() AND a.application_name='" + migration_name + "' "
                                    "AND l.locktype='advisory' AND l.classid=900731613 AND l.objid=90 "
                                    "AND l.objsubid=2 AND l.mode='ExclusiveLock' AND l.granted) "
                                    "AND EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid) "
                                    "WHERE a.datname=current_database() AND a.application_name='" + migration_name + "' "
                                    "AND l.locktype='advisory' AND l.classid=900731613 AND l.objid=50 "
                                    "AND l.objsubid=2 AND NOT l.granted)") == "t"
                NATIVE.wait_until(fenced, "final-image migration exclusive lock", seconds=8)
                before = self.snapshot()
                runtime = self.launch({**self.env, "LISTMONK_db__params": "application_name=" + runtime_name})
                NATIVE.wait_for_runtime_lock(self, runtime, runtime_name, migration_name)
                NATIVE.assert_equal(runtime.wait(timeout=8), 1, "final-image shared-lock timeout")
                NATIVE.assert_equal(self.snapshot(), before, "blocked final-image startup changes no durable state")
            NATIVE.assert_equal(migration.wait(timeout=25), 0, "final-image migration after fixture lock release")
            self.receipt()
        finally:
            try:
                self.stop_engine()
            finally:
                if migration is not None and migration.poll() is None:
                    migration.terminate()
                    migration.wait(timeout=8)
        return {"actualOwnedSharedLockWait": True, "exclusiveMigration": True}

    def readiness(self):
        self.ready()
        try:
            NATIVE.assert_equal(self.request("/api/warpdrive/readiness")[0], 403, "anonymous readiness denied")
            status, raw = self.request("/api/warpdrive/readiness", self.auth)
            value = json.loads(raw)["data"]
            if status != 200 or value["database"]["status"] != "ready" or value["scheduler"]["status"] != "passive" or value["ready"] is not False:
                raise SmokeError("Final-image passive readiness evidence is invalid")
        finally:
            self.stop_engine()
        return {"healthSurvived": True, "databaseReady": True, "passiveIsNotDeliveryReady": True, "anonymousDenied": True}

    def qualify(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        previous_signals = {kind: signal.getsignal(kind) for kind in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT)}
        def expired(_signal, _frame):
            raise SmokeError("Final-image engine qualification deadline exceeded")
        for kind in previous_signals:
            signal.signal(kind, expired)
        signal.alarm(600)
        try:
            self.secret_directory = tempfile.TemporaryDirectory(prefix="wd-engine-secret-")
            self.secret_file = Path(self.secret_directory.name) / "db-password"
            self.secret_file.write_text(self.pg_env["POSTGRES_PASSWORD"])
            self.secret_file.chmod(0o444)
            daemon = self.docker.json(["info", "--format", '{"os":{{json .OSType}},"architecture":{{json .Architecture}},"root":{{json .DockerRootDir}}}'], timeout=10)
            admit_native_platform(platform.system(), platform.machine(), daemon)
            self.report["nativePlatform"] = {"host": "linux/amd64", "daemon": "linux/amd64"}
            self.docker_root = Path(daemon.get("root", ""))
            if not self.docker_root.is_absolute() or not self.docker_root.is_dir():
                raise SmokeError("Engine qualification requires a native host-visible Docker root")
            self.initial_free = shutil.disk_usage(self.docker_root).free
            self.capacity()
            self.check("immutable-final-engine-image", self.inspect_image)
            self.check("owned-internal-fixture", self.create_environment)
            self.check("actual-final-image-packaging", self.packaging)
            self.check("empty-runtime-refuses-schema-writes", self.empty_runtime)
            self.check("file-secret-loader-and-fresh-install", self.initialize)
            for name, operation in (
                ("fresh-repeat-no-write-migration", lambda: NATIVE.prove_fresh_migration(self)),
                ("pinned-schema-legacy-holds", lambda: NATIVE.prove_legacy_fence(self, self.archived_schema().decode())),
                ("explicit-upgrade-and-no-write", lambda: NATIVE.prove_noop_and_upgrade(self)),
                ("receipt-and-index-drift-rejection", lambda: NATIVE.prove_admission_failures(self)),
                ("restricted-role-no-ddl-startup", lambda: NATIVE.prove_restricted_no_ddl_start(self)),
                ("rls-policy-sequence-drift-rejection", lambda: NATIVE.prove_policy_and_sequence_drift(self)),
                ("runtime-excludes-migration", lambda: NATIVE.prove_runtime_excludes_migration(self)),
                ("migration-excludes-actual-runtime", self.migration_excludes_runtime),
                ("fence-loss-exits-and-restarts", lambda: NATIVE.prove_runtime_fence_loss(self)),
                ("final-image-health-and-readiness", self.readiness),
            ):
                self.capacity()
                self.check(name, operation)
            self.capacity()
            if not required_checks_passed(self.report["checks"]):
                raise SmokeError("Engine qualification did not execute all required checks")
        except BaseException as error:
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
        finally:
            signal.alarm(0)
            if self.report["failure"] is not None:
                self.report["diagnostics"] = self.failure_diagnostics()
            errors = self.cleanup()
            try:
                if self.secret_directory is not None:
                    self.secret_directory.cleanup()
            except OSError:
                errors.append("Synthetic secret fixture cleanup failed")
            self.report["cleanup"] = {"success": not errors, "errors": errors}
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and not errors
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
            for kind, previous in previous_signals.items():
                signal.signal(kind, previous)
        return self.report["success"]

    def capacity(self):
        available = shutil.disk_usage(self.docker_root).free
        growth = max(0, self.initial_free - available)
        if available < 8 * 1024**3 or growth > 3 * 1024**3:
            raise SmokeError("Owned engine fixture exceeded disk growth/reserve admission")
        self.report["capacity"] = {"availableBytes": available, "maxObservedGrowthBytes": max(growth, self.report.get("capacity", {}).get("maxObservedGrowthBytes", 0)),
                                   "growthLimitBytes": 3 * 1024**3, "reserveBytes": 8 * 1024**3, "deadlineSeconds": 600}

    def archived_schema(self):
        raw = self.legacy_schema
        if digest(raw) != NATIVE.UPSTREAM_SCHEMA_SHA256:
            raise SmokeError("Legacy fixture schema differs from pinned upstream")
        return raw


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image")
    parser.add_argument("--expected-revision")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--context-digest", action="store_true", help="Print deterministic reviewed build-context fingerprint only")
    args = parser.parse_args(arguments)
    if args.context_digest:
        print(context_record()["sha256"])
        return 0
    if not all((args.image, args.expected_revision, args.output_dir)):
        parser.error("--image, --expected-revision and --output-dir are required")
    validate_reference(args.image)
    validate_revision(args.expected_revision)
    with tempfile.TemporaryDirectory(prefix="wd-engine-docker-") as directory:
        docker = IsolatedDocker(Path(directory) / "config")
        fixture = EngineImageSmoke(docker, args.image, args.expected_revision, args.output_dir)
        return 0 if fixture.qualify() else 1


if __name__ == "__main__":
    sys.exit(main())
