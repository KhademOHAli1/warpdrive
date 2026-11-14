"""Qualify an opt-in, isolated native fresh Compose installation and Web rollback."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import ctypes
from hashlib import sha256
from http.client import HTTPSConnection, HTTPException
import json
import os
from pathlib import Path
import platform
import re
import secrets
import select
import shutil
import signal
import ssl
import stat
import subprocess
import sys
from tempfile import mkdtemp
import time
import uuid

from component_inputs import decode
from fresh_compose_admission import (COMPOSE, IMAGES, ROOT, STORAGE_CLIENT_CONFIG, STORAGE_CLIENT_ENV,
                                    STORAGE_CLIENT_DATA_TMPFS, STORAGE_CLIENT_GUARD, VOLUME_MOUNTS, _pinned_images, _validate,
                                    validate_cgroup_parent, validate_storage_client_bin)
from image_smoke import Docker, ImageSmoke, SmokeError, WS_PROBE, image_metadata, sanitized_log
from installed_web_chain import _directory
from loopback_forwarder import ForwarderError, owned_bridge_forwarder
from web_switch import SwitchConflict, canonical, content_hash, require


OWNER = "com.docker.compose.project"
SERVICE = "com.docker.compose.service"
SERVICE_PORT = 8443
TOTAL_SECONDS = 600
CLEANUP_SECONDS = 420
STOP_GRACE = {"worker": 75, "ws": 30, "app": 30, "newsletter-engine": 30,
              "caddy": 30, "postgres": 30, "minio": 30, "migrate": 30,
              "newsletter-engine-migrate": 30, "createbuckets": 30}
STOP_WAVES = (("caddy",), ("app", "ws", "worker", "newsletter-engine", "migrate",
                         "newsletter-engine-migrate", "createbuckets"), ("postgres", "minio"))
EXACT_ID = re.compile(r"[a-f0-9]{64}\Z")
LONG_RUNNING = {"postgres", "minio", "app", "ws", "worker", "newsletter-engine", "caddy"}
MIB = 1024**2
RESOURCE_LIMITS = {
    "caddy": (128 * MIB, 0.5, 128), "postgres": (512 * MIB, 1, 128),
    "minio": (256 * MIB, 1, 128), "createbuckets": (128 * MIB, 0.5, 64),
    "app": (1536 * MIB, 2, 256), "ws": (256 * MIB, 1, 128), "worker": (768 * MIB, 1, 256),
    "migrate": (768 * MIB, 1, 128), "newsletter-engine": (256 * MIB, 1, 128),
    "newsletter-engine-migrate": (256 * MIB, 1, 128),
}
MEMORY_RESERVE = 1024**3
DISK_RESERVE = 4 * 1024**3
FIXTURE_DISK_BUDGET = 1024**3
COMMAND_STDOUT_BYTES = 512 * 1024
COMMAND_STDERR_BYTES = 64 * 1024
COMMAND_OWNER = "WARPDRIVE_FRESH_COMMAND_OWNER"
CGROUP_ROOT = Path("/sys/fs/cgroup")
TLS = """{
 admin off
 auto_https off
}
https://:8443 {
 tls /fixture/cert.pem /fixture/key.pem
 @realtime path /_ws*
 reverse_proxy @realtime ws:8080
 reverse_proxy app:3000 {
  header_up X-Real-IP {remote_host}
 }
}
"""
RUNTIME_GRANTS = """REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, pgboss TO smoke_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, pgboss TO smoke_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, pgboss TO smoke_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, pgboss TO smoke_runtime;
"""
WORKER_PROBE = r"""
import { PgBoss } from 'pg-boss';
const boss = new PgBoss({connectionString:process.env.DATABASE_URL,max:1,migrate:false,createSchema:false,
  schedule:false,supervise:false,reindex:false,registerInstance:false,application_name:'fresh-compose-probe'});
let failed = false;
boss.on('error', () => {failed = true;});
try {
  await boss.start();
  const deadline = Date.now()+35000;
  while (!(await boss.getQueue('file.reaper'))) {
    if (failed || Date.now()>=deadline) throw Error('Worker registration missing');
    await Bun.sleep(250);
  }
  const id = await boss.send('file.reaper', {freshComposeSmoke:true}, {retryLimit:0});
  if (!id) throw Error('Worker job identity missing');
  while (true) {
    const [job] = await boss.findJobs('file.reaper', {id,limit:1});
    if (job?.state === 'completed') {console.log(JSON.stringify({completed:true}));break;}
    if (failed || ['failed','cancelled'].includes(job?.state) || Date.now()>=deadline) throw Error('Worker job incomplete');
    await Bun.sleep(250);
  }
} finally {await boss.stop({graceful:false,timeout:1000});}
"""
APP_PEER_PROBE = r"""
if (process.env.MIGRATION_DATABASE_URL || process.env.MIGRATION_DATABASE_URL_FILE) throw Error('Owner credential reached Web');
const deadline = Date.now()+12000;
while (true) {
  let healthy = false;
  try {
    const engine = await fetch('http://newsletter-engine:9000/health', {redirect:'error',signal:AbortSignal.timeout(1500)});
    healthy = engine.ok;
    await engine.body?.cancel();
  } catch {}
  if (healthy) break;
  if (Date.now()>=deadline) throw Error('Passive engine unavailable');
  await Bun.sleep(250);
}
const object = await fetch('http://minio:9000/warpdrive-fresh/fixture.txt', {redirect:'error',signal:AbortSignal.timeout(4000)});
if (object.status !== 403) throw Error('Anonymous fixture object was not denied');
const reader = object.body.getReader();
const data = [];
let bytes = 0;
while (true) {
  const {value,done} = await reader.read();
  if (done) break;
  bytes += value.length;
  if (bytes>4096) {await reader.cancel();throw Error('Anonymous response exceeded bound');}
  data.push(Buffer.from(value));
}
if (!Buffer.concat(data).includes('<Code>AccessDenied</Code>')) throw Error('Wrong anonymous storage response');
console.log(JSON.stringify({anonymousObjectDenied:true,passiveEngineHealthy:true}));
"""


class FreshCommandUnknown(SmokeError):
    """An owned command did not establish terminal execution and child cleanup."""


class FreshMutationUnknown(FreshCommandUnknown):
    """A mutating fixture call may still have effects at the daemon."""


def _command_processes():
    result = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,pgid=,uid=,stat=,lstart="], capture_output=True,
                            text=True, check=False, timeout=2)
    if result.returncode or len(result.stdout) > 1024 * 1024:
        raise FreshCommandUnknown("Owned command process inventory is unavailable")
    rows = {}
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) != 10 or not all(field.isdigit() for field in fields[:4]):
            raise FreshCommandUnknown("Owned command process inventory is malformed")
        pid, parent, group, uid = map(int, fields[:4])
        birth = " ".join(fields[5:])
        if sys.platform.startswith("linux") and uid == os.geteuid():
            try:
                with Path(f"/proc/{pid}/stat").open("r", encoding="ascii") as stream:
                    raw = stream.read(8193)
                tail = raw.rsplit(")", 1)[1].split()
                if len(raw) > 8192 or len(tail) < 20 or not tail[19].isdigit():
                    raise FreshCommandUnknown("Owned command birth identity is unavailable")
                birth = "linux-ticks:" + tail[19]
            except (FileNotFoundError, ProcessLookupError):
                continue
        rows[pid] = {"pid": pid, "parent": parent, "group": group, "uid": uid, "state": fields[4], "birth": birth}
    if len(rows) > 8192:
        raise FreshCommandUnknown("Owned command process inventory exceeds its bound")
    return rows


def _command_token(pid):
    try:
        if sys.platform.startswith("linux"):
            with Path(f"/proc/{pid}/environ").open("rb") as stream:
                raw = stream.read(128 * 1024 + 1)
            if len(raw) > 128 * 1024:
                raise FreshCommandUnknown("Owned command environment exceeds its bound")
            prefix = COMMAND_OWNER.encode() + b"="
            return next((part[len(prefix):].decode("ascii") for part in raw.split(b"\0") if part.startswith(prefix)), None)
        result = subprocess.run(["/bin/ps", "eww", "-p", str(pid), "-o", "command="], capture_output=True,
                                text=True, check=False, timeout=1)
        if len(result.stdout) > 512 * 1024:
            raise FreshCommandUnknown("Owned command environment exceeds its bound")
        match = re.search(r"(?:^|\s)" + COMMAND_OWNER + r"=([a-f0-9]{32})(?:\s|$)", result.stdout)
        return match[1] if match else None
    except (FileNotFoundError, ProcessLookupError):
        return None
    except PermissionError:
        raise FreshCommandUnknown("Owned command environment cannot be inspected") from None


def _owned_command_rows(group, token, baseline, known):
    rows = _command_processes()
    candidates = [row for pid, row in rows.items() if not row["state"].startswith("Z")
                  and (row["group"] == group or row["uid"] == os.geteuid() and baseline.get(pid) != row["birth"]
                       and (not sys.platform.startswith("linux") or row["parent"] in {os.getpid(), group, *known}))]
    if len(candidates) > 128:
        raise FreshCommandUnknown("New command process inventory exceeds its bound")
    owned = {}
    for row in candidates:
        pid = row["pid"]
        actual = _command_token(pid)
        if actual == token:
            known[pid] = row["birth"]
            owned[pid] = row
        elif row["group"] == group:
            current = _command_processes().get(pid)
            if current is None or current["state"].startswith("Z"):
                continue
            raise FreshCommandUnknown("Command group ownership cannot be established")
    # Linux adopts escaped grandchildren, allowing exact owned zombies to be
    # reaped. Never wait for or signal an unrelated child or a reused PID.
    for pid, row in rows.items():
        if (sys.platform.startswith("linux") and pid != group and row["parent"] == os.getpid()
                and row["state"].startswith("Z") and known.get(pid) == row["birth"]):
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
    return owned


def _signal_command_pid(row, token, signum):
    descriptor = None
    try:
        if sys.platform.startswith("linux"):
            descriptor = os.pidfd_open(row["pid"])
        current = _command_processes().get(row["pid"])
        if current is None:
            return
        if current["birth"] != row["birth"] or current["uid"] != row["uid"] or _command_token(row["pid"]) != token:
            raise FreshCommandUnknown("Owned command PID identity changed before termination")
        if descriptor is not None:
            signal.pidfd_send_signal(descriptor, signum)
        else:
            os.kill(row["pid"], signum)
    except ProcessLookupError:
        pass
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _stop_command_group(process, token, baseline, known):
    confirmed = False
    try:
        for signum, seconds in ((signal.SIGTERM, 1.0), (signal.SIGKILL, 2.0)):
            live = _owned_command_rows(process.pid, token, baseline, known)
            if not live and process.poll() is not None:
                confirmed = True
                break
            for row in live.values():
                _signal_command_pid(row, token, signum)
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if not _owned_command_rows(process.pid, token, baseline, known) and process.poll() is not None:
                    confirmed = True
                    break
                time.sleep(0.1)
            if confirmed:
                break
    finally:
        if process.poll() is None:
            try:
                row = _command_processes().get(process.pid)
                if row is not None:
                    _signal_command_pid(row, token, signal.SIGKILL)
            except (OSError, FreshCommandUnknown):
                pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            confirmed = False
    return confirmed


def run_owned_fixture_command(arguments, *, timeout, capture_output=True, text=True, check=False, env=None, input=None):
    """A bounded subprocess.run-compatible Docker runner with owned descendants.

    Output and credentials stay in memory. A timeout, interrupted wait, output
    overrun, or live descendant after leader exit is unknown even if termination
    subsequently succeeds. Callers must not replay the daemon operation.
    """
    if (not isinstance(arguments, (list, tuple)) or not arguments or not all(isinstance(arg, str) for arg in arguments)
            or capture_output is not True or check is not False or type(text) is not bool
            or type(timeout) not in (int, float) or not 0 < timeout <= 600):
        raise FreshCommandUnknown("Unsupported owned command invocation")
    data = input.encode("utf-8") if isinstance(input, str) and text else input
    if data is not None and (not isinstance(data, bytes) or len(data) > 128 * 1024):
        raise FreshCommandUnknown("Owned command input exceeds its bound")
    if sys.platform.startswith("linux"):
        # Reparent a short-lived, setsid() grandchild here instead of losing its
        # ownership between sampling intervals. Tokens separate concurrent calls.
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
            raise FreshCommandUnknown("Owned command child adoption is unavailable")
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise FreshCommandUnknown("Owned command PID-safe termination is unavailable")
    baseline = {pid: row["birth"] for pid, row in _command_processes().items()}
    token = secrets.token_hex(16)
    environment = dict(os.environ if env is None else env)
    environment[COMMAND_OWNER] = token
    process = subprocess.Popen(arguments, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, start_new_session=True)
    known, output, errors = {}, bytearray(), bytearray()
    deadline = time.monotonic() + timeout
    failure = None
    next_inventory = 0.0
    try:
        pending = memoryview(data) if data is not None else None
        if pending is not None:
            os.set_blocking(process.stdin.fileno(), False)
        streams = {process.stdout: output, process.stderr: errors}
        while streams or pending is not None or process.poll() is None:
            if time.monotonic() >= deadline:
                raise FreshCommandUnknown("Owned command deadline exceeded")
            exited = process.poll() is not None
            if exited or time.monotonic() >= next_inventory:
                live = _owned_command_rows(process.pid, token, baseline, known)
                next_inventory = time.monotonic() + 1.0
                if exited and live:
                    raise FreshCommandUnknown("Owned command leader exited with live descendants")
            readable, writable, _ = select.select(list(streams), [process.stdin] if pending is not None else [], [],
                                                min(0.05, max(0, deadline - time.monotonic())))
            if writable:
                if pending:
                    pending = pending[os.write(process.stdin.fileno(), pending[:4096]):]
                if not pending:
                    process.stdin.close()
                    pending = None
            for stream in readable:
                chunk = os.read(stream.fileno(), 65536)
                if not chunk:
                    del streams[stream]
                else:
                    streams[stream].extend(chunk)
                    if len(output) > COMMAND_STDOUT_BYTES or len(errors) > COMMAND_STDERR_BYTES:
                        raise FreshCommandUnknown("Owned command output exceeded its bound")
        if _owned_command_rows(process.pid, token, baseline, known):
            raise FreshCommandUnknown("Owned command retains live descendants")
    except BaseException as error:
        failure = error
    finally:
        try:
            cleaned = _stop_command_group(process, token, baseline, known)
        except BaseException:
            cleaned = False
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()
    if failure is not None or not cleaned:
        message = str(failure) if isinstance(failure, FreshCommandUnknown) else "Owned command execution or cleanup is unknown"
        raise FreshCommandUnknown(message) from None
    try:
        stdout, stderr = (bytes(value).decode("utf-8") if text else bytes(value) for value in (output, errors))
    except UnicodeDecodeError:
        raise FreshCommandUnknown("Owned command output encoding is unknown") from None
    return subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)


def _deadline_expired(_number, _frame):
    raise SwitchConflict("Fresh Compose native smoke exceeded its overall deadline")


def _same_except_web(before, after):
    require(before["services"]["app"]["image"].rsplit("@", 1)[1] != after["services"]["app"]["image"].rsplit("@", 1)[1],
            "Select a distinct candidate Web content digest")
    normalized = deepcopy(after)
    normalized["services"]["app"]["image"] = before["services"]["app"]["image"]
    require(canonical(normalized) == canonical(before), "Fresh smoke candidate changes another effective Compose setting")


def _validate_fixture_model(model, *, project, directory, images, storage_client_bin="mc", cgroup_parent=None):
    stock_shape = deepcopy(model)
    network = stock_shape["networks"]["default"]
    require(network.pop("internal", None) is True, "Fresh smoke requires an isolated internal network")
    caddy = stock_shape["services"]["caddy"]
    require(not caddy.get("ports"), "Fresh smoke must have no Docker-published port")
    caddy["ports"] = [{"target": port, "published": str(port)} for port in (80, 443)]
    binds = caddy["volumes"]
    fixture = [mount for mount in binds if mount["target"] == "/fixture"]
    require(len(fixture) == 1 and fixture[0]["type"] == "bind" and fixture[0]["read_only"] is True
            and fixture[0]["source"] == str(directory / "tls"), "Fresh smoke requires its own read-only TLS mount")
    binds.remove(fixture[0])
    for name, (memory, cpus, pids) in RESOURCE_LIMITS.items():
        service = stock_shape["services"][name]
        def exact_bytes(value):
            # Compose v5 emits decimal strings; supported v2 builds can emit integers.
            return ((type(value) is int and value == memory)
                    or (type(value) is str and re.fullmatch(r"[1-9][0-9]{0,15}", value) is not None and int(value) == memory))

        require(exact_bytes(service.get("mem_limit")) and exact_bytes(service.get("memswap_limit"))
                and type(service.get("pids_limit")) is int and service["pids_limit"] == pids
                and type(service.get("cpus")) in (int, float, str) and float(service["cpus"]) == cpus,
                "Fresh fixture model resource budget differs")
    _validate(stock_shape, project, directory, images, storage_client_bin=storage_client_bin, cgroup_parent=cgroup_parent)


def _native_host():
    require(platform.system() == "Linux" and platform.machine() in ("x86_64", "amd64"),
            "Native fresh Compose requires a Linux AMD64 host")


def _available_memory(proc=Path("/proc/meminfo"), cgroup=Path("/sys/fs/cgroup")):
    with proc.open("r", encoding="ascii") as source:
        raw = source.read(65537)
    matches = re.findall(r"^MemAvailable:\s+([0-9]{1,16}) kB$", raw, flags=re.MULTILINE)
    require(len(raw) <= 65536 and len(matches) == 1, "Native fixture available-memory observation is unavailable")
    available = int(matches[0]) * 1024
    limit = cgroup / "memory.max"
    if limit.is_file():
        def value(path):
            with path.open("r", encoding="ascii") as source:
                raw = source.read(65)
            require(len(raw) <= 64, "Native fixture cgroup observation exceeds its bound")
            return raw.strip()

        maximum = value(limit)
        require(maximum == "max" or re.fullmatch(r"[0-9]{1,20}", maximum), "Native fixture memory limit is invalid")
        if maximum != "max":
            current = value(cgroup / "memory.current")
            require(re.fullmatch(r"[0-9]{1,20}", current), "Native fixture memory usage is unavailable")
            available = min(available, max(0, int(maximum) - int(current)))
    return available


def _write_env(path, values):
    require(all(isinstance(value, str) and "\n" not in value and "\r" not in value for value in values.values()),
            "Synthetic Compose values must each occupy one line")
    _directory(path.parent)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(os.path.samestat(os.fstat(directory), path.parent.lstat()), "Private fixture directory changed")
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            info = os.fstat(output.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                    and stat.S_IMODE(info.st_mode) == 0o600, "Private single-link fixture environment required")
            raw = "".join(f"{key}={value}\n" for key, value in sorted(values.items()))
            require(output.write(raw) == len(raw), "Incomplete fixture environment write")
            output.flush()
            os.fsync(output.fileno())
            require(os.path.samestat(info, path.lstat()) and os.fstat(output.fileno()).st_nlink == 1
                    and os.path.samestat(os.fstat(directory), path.parent.lstat()), "Private fixture environment changed")
        os.fsync(directory)
    finally:
        os.close(directory)


class FreshSmoke:
    def __init__(self, docker, directory, baseline, candidate, *, storage_client_bin="mc", cgroup_parent=None):
        self.storage_client_bin = validate_storage_client_bin(storage_client_bin)
        self.cgroup_parent = validate_cgroup_parent(cgroup_parent)
        self.docker, self.directory = docker, directory
        self.project = "wd-fresh-" + secrets.token_hex(8)
        self.network = self.project + "_default"
        self.volume_names = {f"{self.project}_{name}" for mounts in VOLUME_MOUNTS.values() for name in mounts}
        self.refs = {"baseline": baseline, "candidate": candidate}
        self.images, self.revisions = {}, {}
        self.overlay = directory / "fixture.yml"
        self.compose_files = tuple(ROOT / name for name in COMPOSE)
        self.configuration_pins = {}
        self.secret_values = ()
        self.seed = str(uuid.uuid4())
        self.object_bytes = ("fresh compose object " + self.seed).encode()
        self.tls = directory / "tls"
        self.receipt = {"schemaVersion": 1, "kind": "warpdrive-native-fresh-compose-smoke", "project": self.project,
                        "success": False, "deploymentAuthorized": False, "checks": {}, "cleanupSuccess": False,
                        "storageClientBin": self.storage_client_bin, "manualReconciliationRequired": False}
        if self.cgroup_parent is not None:
            self.receipt["cgroupParent"] = self.cgroup_parent

    def _preloaded(self):
        require(self.docker.run(["info", "--format", "{{.OSType}} {{.Architecture}}"], timeout=10).stdout.strip()
                in {"linux x86_64", "linux amd64"}, "Native fresh Compose requires a Linux AMD64 Docker daemon")
        for phase, references in self.refs.items():
            self.images[phase] = {}
            for service, reference in references.items():
                rows = self.docker.json(["image", "inspect", reference], timeout=10)
                require(len(rows) == 1 and reference in (rows[0].get("RepoDigests") or [])
                        and rows[0].get("Os") == "linux" and rows[0].get("Architecture") == "amd64"
                        and re.fullmatch(r"sha256:[a-f0-9]{64}", rows[0]["Id"]), "Exact local digest-pinned AMD64 fixture image required")
                self.images[phase][service] = rows[0]["Id"]
                if service == "app":
                    self.revisions[phase] = image_metadata(rows, None)["revision"]
        require(self.images["baseline"]["app"] != self.images["candidate"]["app"]
                and self.revisions["baseline"] != self.revisions["candidate"], "Two distinct source-bound Web images required")
        self._admit_resources()

    def _admit_resources(self):
        required_memory = sum(row[0] for row in RESOURCE_LIMITS.values()) + MEMORY_RESERVE
        if self.cgroup_parent is None:
            available_memory = _available_memory()
        else:
            require(self.docker.run(["info", "--format", "{{.CgroupDriver}}"], timeout=10).stdout.strip() == "systemd",
                    "Selected qualification cgroup requires the systemd Docker driver")
            cgroup = CGROUP_ROOT / self.cgroup_parent
            require(cgroup.is_dir() and cgroup.resolve(strict=True) == cgroup
                    and all((cgroup / name).is_file() for name in ("memory.max", "memory.current", "cpu.max")),
                    "Selected qualification cgroup resource controls are unavailable")
            available_memory = _available_memory(cgroup=cgroup)
        root = Path(self.docker.run(["info", "--format", "{{.DockerRootDir}}"], timeout=10).stdout.strip())
        require(root.is_absolute() and root.is_dir(), "Native Docker storage is not measurable")
        available_disk = shutil.disk_usage(root).free
        require(available_memory >= required_memory and available_disk >= DISK_RESERVE + FIXTURE_DISK_BUDGET,
                "Native fresh Compose lacks its memory, storage and operating reserve")
        self.receipt["checks"]["resourceAdmission"] = {"availableMemoryBytes": available_memory,
            "requiredMemoryBytes": required_memory, "availableDiskBytes": available_disk,
            "fixtureDiskBudgetBytes": FIXTURE_DISK_BUDGET, "diskReserveBytes": DISK_RESERVE,
            "scope": "Synthetic fresh fixture only; not production capacity acceptance"}

    def compose(self, phase, *arguments, timeout=45):
        self._verify_configuration()
        position = 0
        while position < len(arguments) and arguments[position] == "--profile":
            position += 2
        require(position < len(arguments), "Explicit fresh Compose operation required")
        mutating = arguments[position] not in {"config", "help", "version"}
        argv = ["compose", "--project-name", self.project, "--project-directory", str(self.directory),
                "--env-file", str(self.directory / f"{phase}.env")]
        for source in (*self.compose_files, self.overlay):
            argv += ["--file", str(source)]
        try:
            result = self.docker.run([*argv, *arguments], timeout=timeout)
            if mutating and getattr(result, "returncode", 0) != 0:
                raise FreshMutationUnknown("Fresh Compose mutation completion is unknown")
            return result.stdout
        except BaseException as error:
            if mutating:
                raise FreshMutationUnknown("Fresh Compose mutation completion or child cleanup is unknown") from None
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise FreshCommandUnknown("Read-only fresh Compose command was interrupted") from None
            raise

    def _verify_configuration(self):
        for path, expected in self.configuration_pins.items():
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                    and not info.st_mode & (stat.S_IWGRP | stat.S_IWOTH) and path.resolve(strict=True) == path
                    and info.st_size <= 512 * 1024 and sha256(path.read_bytes()).hexdigest() == expected,
                    "Prepared fresh Compose configuration changed")

    def prepare(self):
        fixture = ImageSmoke(self.docker, {"web": self.refs["baseline"]["app"], "worker": self.refs["baseline"]["worker"],
            "realtime": self.refs["baseline"]["ws"], "migrator": self.refs["baseline"]["migrate"]}, self.directory)
        self.runtime_password = fixture.runtime_password
        self.newsletter_password = secrets.token_hex(24)
        self.secret_values = tuple(fixture.env.values()) + tuple(fixture.pg_env.values()) + (self.newsletter_password,)
        self.bucket = "warpdrive-fresh"
        storage_credentials = {"MINIO_ACCESS_KEY": fixture.env["MINIO_ACCESS_KEY"], "MINIO_SECRET_KEY": fixture.env["MINIO_SECRET_KEY"]}
        self.storage_env = self.directory / "storage-fixture.env"
        _write_env(self.storage_env, {**storage_credentials, "MINIO_BUCKET": self.bucket, "FIXTURE_OBJECT": self.object_bytes.decode(),
                                     STORAGE_CLIENT_ENV: self.storage_client_bin})
        _write_env(self.directory / ".env", {**fixture.env, "BASE_URL": "https://127.0.0.1", "WS_PUBLIC_URL": "ws://ws:8080",
            "MINIO_ENDPOINT": "http://minio:9000", "MINIO_BUCKET": self.bucket, "MIGRATION_DATABASE_URL": fixture.migration_url})
        for phase, references in self.refs.items():
            _write_env(self.directory / f"{phase}.env", {**fixture.pg_env, "APP_DOMAIN": "127.0.0.1", "ACME_EMAIL": "fresh@example.invalid",
                "BASE_URL": "https://127.0.0.1", "NEWSLETTER_PUBLIC_DOMAIN": "news.example.invalid",
                "NEWSLETTER_POSTGRES_PASSWORD": self.newsletter_password, "MINIO_ACCESS_KEY": fixture.env["MINIO_ACCESS_KEY"],
                "MINIO_SECRET_KEY": fixture.env["MINIO_SECRET_KEY"], "MINIO_BUCKET": self.bucket,
                STORAGE_CLIENT_ENV: self.storage_client_bin,
                **{name: references[services[0]] for name, services in IMAGES.items()}})
        self.tls.mkdir(mode=0o755)
        key, cert = self.tls / "key.pem", self.tls / "cert.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
                        "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", str(key), "-out", str(cert)],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=True)
        key.chmod(0o444)
        cert.chmod(0o444)
        (self.directory / "Caddyfile").write_text(TLS, encoding="utf-8")
        (self.directory / "deploy/newsletters").mkdir(parents=True)
        (self.directory / "deploy/newsletters/Caddyfile").write_text("import /etc/caddy/Caddyfile\n", encoding="utf-8")
        limits = "services:\n"
        for name, (memory, cpus, pids) in RESOURCE_LIMITS.items():
            limits += f"  {name}:\n    mem_limit: {memory}\n    memswap_limit: {memory}\n    cpus: {cpus}\n    pids_limit: {pids}\n"
            if self.cgroup_parent is not None:
                limits += "    cgroup_parent: " + self.cgroup_parent + "\n"
            if name == "caddy":
                limits += "    ports: !reset []\n    volumes:\n      - " + json.dumps(str(self.tls) + ":/fixture:ro") + "\n"
        self.overlay.write_text(limits + "networks:\n  default:\n    internal: true\n", encoding="utf-8")
        source = {name: (ROOT / name).read_bytes() for name in COMPOSE}
        frozen = self.directory / "compose-inputs"
        frozen.mkdir(mode=0o700)
        self.compose_files = tuple(frozen / f"{index}.yml" for index in range(len(COMPOSE)))
        for path, raw in zip(self.compose_files, source.values(), strict=True):
            path.write_bytes(raw)
            path.chmod(0o600)
        require(all((ROOT / name).read_bytes() == raw for name, raw in source.items()),
                "Fresh Compose source changed during snapshot")
        files = (*self.compose_files, self.overlay, self.directory / ".env", self.directory / "baseline.env",
                 self.directory / "candidate.env", self.storage_env, key, cert, self.directory / "Caddyfile",
                 self.directory / "deploy/newsletters/Caddyfile")
        self.configuration_pins = {path: sha256(path.read_bytes()).hexdigest() for path in files}
        models = {phase: decode(self.compose(phase, "--profile", "newsletter-migrations", "config", "--format", "json").encode())
                  for phase in self.refs}
        for phase, model in models.items():
            _validate_fixture_model(model, project=self.project, directory=self.directory, images=self.refs[phase],
                                    storage_client_bin=self.storage_client_bin, cgroup_parent=self.cgroup_parent)
        _same_except_web(models["baseline"], models["candidate"])
        self.receipt["checks"]["model"] = {phase: content_hash(model) for phase, model in models.items()}
        self.receipt["checks"]["configurationSha256"] = content_hash({
            str(path.relative_to(self.directory)): pin for path, pin in self.configuration_pins.items()
        })

    def _ids(self):
        return self.docker.run(["ps", "-a", "--no-trunc", "--filter", f"label={OWNER}={self.project}", "--format", "{{.ID}}"], timeout=10).stdout.splitlines()

    def _rows(self):
        self._verify_configuration()
        ids = self._ids()
        require(len(ids) <= 16 and all(EXACT_ID.fullmatch(value) for value in ids), "Exact bounded fixture containers required")
        if not ids:
            return {}
        rows = self.docker.json(["container", "inspect", *ids], timeout=12)
        result = {}
        for row in rows:
            labels = row["Config"]["Labels"]
            name = labels[SERVICE]
            require(labels[OWNER] == self.project and name in self.refs["baseline"] and name not in result
                    and row["Id"] in ids and not row["HostConfig"].get("PortBindings")
                    and row["Image"] in {phase[name] for phase in self.images.values()}, "Foreign or publicly exposed fixture container")
            memory, cpus, pids = RESOURCE_LIMITS[name]
            host = row["HostConfig"]
            require(host.get("Memory") == memory and host.get("MemorySwap") == memory
                    and host.get("NanoCpus") == int(cpus * 10**9) and host.get("PidsLimit") == pids,
                    "Fresh smoke runtime resource limits differ")
            require(self.cgroup_parent is None or host.get("CgroupParent") == self.cgroup_parent,
                    "Fresh smoke runtime cgroup parent differs")
            result[name] = row
        return result

    def _resources(self, kind):
        return self.docker.run([kind, "ls", "--filter", f"label={OWNER}={self.project}", "--format", "{{.Name}}"], timeout=10).stdout.splitlines()

    def _require_empty(self):
        require(not self._ids() and not self._resources("network") and not self._resources("volume"), "Fresh smoke project already has resources")
        for kind, names in (("network", {self.network}), ("volume", self.volume_names)):
            present = self.docker.run([kind, "ls", "--format", "{{.Name}}"], timeout=10).stdout.splitlines()
            require(not names.intersection(present), "Fresh smoke resource name is already in use")

    def _sql(self, statement, *, database="warpdrive_image_smoke", user="smoke", check=True):
        postgres = self._rows()["postgres"]["Id"]
        return self.docker.run(["exec", "-i", postgres, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database],
                               timeout=15, check=check, input_bytes=statement.encode())

    def _provision(self):
        self.compose("baseline", "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "40", "postgres", "minio")
        postgres = self._rows()["postgres"]["Id"]
        deadline = time.monotonic() + 15
        while self.docker.run(["exec", postgres, "pg_isready", "-h", "127.0.0.1", "-U", "smoke", "-d", "warpdrive_image_smoke"],
                              timeout=4, check=False).returncode != 0:
            require(time.monotonic() < deadline, "Owned PostgreSQL TCP readiness unavailable")
            time.sleep(0.5)
        self.compose("baseline", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "migrate")
        self._completed("migrate", 150)
        self._sql(f"CREATE ROLE smoke_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '{self.runtime_password}';\n"
                  + RUNTIME_GRANTS + f"CREATE ROLE warpdrive_newsletters LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{self.newsletter_password}';\n"
                  "CREATE DATABASE warpdrive_newsletters OWNER warpdrive_newsletters;\nREVOKE CONNECT ON DATABASE warpdrive_newsletters FROM PUBLIC;\n")
        denied = self._sql("CREATE TABLE public.fresh_ddl_must_fail(id int);", user="smoke_runtime", check=False)
        require(denied.returncode == 3 and b"permission denied" in denied.stderr, "Runtime fixture role unexpectedly has DDL authority")
        self.compose("baseline", "--profile", "newsletter-migrations", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "newsletter-engine-migrate")
        self._completed("newsletter-engine-migrate", 100)
        self.compose("baseline", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "createbuckets")
        self._completed("createbuckets", 45)
        require(self._sql("SELECT count(*) FROM pipelines;").stdout == b"0\n", "Synthetic seed needs a fresh CRM database")
        self._sql(f"BEGIN;\nINSERT INTO pipelines(id,name) VALUES('{self.seed}','Fresh Compose qualification');\n"
                  f"INSERT INTO stages(pipeline_id,name) VALUES('{self.seed}','Qualified');\nCOMMIT;\n", user="smoke_runtime")
        self._object("seed")
        self.compose("baseline", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "app", "ws", "worker", "newsletter-engine", "caddy")

    def _completed(self, service, timeout):
        row = self._rows()[service]
        result = self.docker.run(["wait", row["Id"]], timeout=timeout).stdout.strip()
        seen = self._rows()[service]
        require(result == "0" and row["Id"] == seen["Id"] and seen["State"]["Status"] == "exited"
                and seen["State"]["ExitCode"] == 0, "Fresh Compose one-shot service did not complete")

    def _object(self, mode):
        # Use the already provisioned owned object store, without pulling or a public port.
        validate_storage_client_bin(self.storage_client_bin)
        require(mode in {"seed", "read"}, "Exact storage fixture operation required")
        self._verify_configuration()
        require(self._rows()["minio"]["Image"] == self.images["baseline"]["minio"], "Exact owned object store required")
        client = '"$' + STORAGE_CLIENT_ENV + '" --config-dir ' + STORAGE_CLIENT_CONFIG
        seed = 'printf %s "$FIXTURE_OBJECT" | ' + client + ' pipe "local/$MINIO_BUCKET/fixture.txt" >/dev/null; ' if mode == "seed" else ""
        script = ('umask 077; ' + STORAGE_CLIENT_GUARD + '; ' + client
                  + ' alias set local http://minio:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null; '
                  + seed + client + ' cat "local/$MINIO_BUCKET/fixture.txt"')
        memory, cpus, pids = RESOURCE_LIMITS["createbuckets"]
        helper_service = "fixture-storage-client" if self.cgroup_parent is not None else "createbuckets"
        options = ["--pull", "never", "--network", self.network, "--label", f"{OWNER}={self.project}",
                   "--label", f"{SERVICE}={helper_service}", "--memory", str(memory), "--memory-swap", str(memory),
                   "--cpus", str(cpus), "--pids-limit", str(pids), "--tmpfs", STORAGE_CLIENT_DATA_TMPFS,
                   "--entrypoint", "/bin/sh", "--env-file", str(self.storage_env)]
        if self.cgroup_parent is not None:
            options += ["--cgroup-parent", self.cgroup_parent]
            output = self._budgeted_storage_client(options, script)
        else:
            output = self.docker.run(["run", "--rm", *options, self.images["baseline"]["createbuckets"], "-ec", script], timeout=15).stdout
        require(output == self.object_bytes.decode(), "Owned private fixture object did not round trip")

    def _budgeted_storage_client(self, options, script):
        """Read back the aggregate-budget helper before allowing its first write."""
        name = self.project + "-storage-client-" + uuid.uuid4().hex[:12]
        image = self.images["baseline"]["createbuckets"]
        memory, cpus, pids = RESOURCE_LIMITS["createbuckets"]

        def exact_mounts(row):
            declared = row["Config"].get("Volumes")
            mounts = row.get("Mounts")
            return ((declared is None or type(declared) is dict and declared in ({}, {"/data": {}}))
                    and row["HostConfig"].get("Tmpfs") == dict([STORAGE_CLIENT_DATA_TMPFS.split(":", 1)])
                    and type(mounts) is list and len(mounts) <= 1
                    and all(mount.get("Type") == "tmpfs" and mount.get("Destination") == "/data"
                            and mount.get("RW") is True and not mount.get("Name") and not mount.get("Source")
                            for mount in mounts))

        try:
            created = self.docker.run(["create", "--name", name, *options, image, "-ec", script], timeout=15)
            identifier = created.stdout.strip()
            require(created.returncode == 0 and EXACT_ID.fullmatch(identifier), "Storage helper create acknowledgement differs")
            before, = self.docker.json(["container", "inspect", identifier], timeout=10)
            host, state = before["HostConfig"], before["State"]
            require(before["Id"] == identifier and before["Name"] == "/" + name and before["Image"] == image
                    and before["Config"]["Labels"].get(OWNER) == self.project
                    and before["Config"]["Labels"].get(SERVICE) == "fixture-storage-client"
                    and host.get("Memory") == memory and host.get("MemorySwap") == memory
                    and host.get("NanoCpus") == int(cpus * 10**9) and host.get("PidsLimit") == pids
                    and host.get("CgroupParent") == self.cgroup_parent and host.get("NetworkMode") == self.network
                    and not host.get("PortBindings") and host.get("AutoRemove") is False
                    and host.get("ReadonlyRootfs") is False and host.get("Privileged") is False
                    and not host.get("Binds") and not host.get("Devices") and not host.get("Mounts")
                    and (host.get("OomKillDisable") is None or host.get("OomKillDisable") is False)
                    and exact_mounts(before)
                    and state.get("Running") is False and state.get("Status") == "created",
                    "Storage helper identity, resource budget or created state differs")
            attached = self.docker.run(["start", "--attach", identifier], timeout=15)
            require(attached.returncode == 0, "Storage helper start acknowledgement differs")
            waited = self.docker.run(["wait", identifier], timeout=5)
            require(waited.returncode == 0 and waited.stdout.strip() == "0", "Storage helper terminal acknowledgement differs")
            after, = self.docker.json(["container", "inspect", identifier], timeout=10)
            state = after["State"]
            after_host = deepcopy(after["HostConfig"])
            # Docker29/cgroupv2 changes an explicit false create default to
            # null after start. Both leave the OOM killer enabled; retain every
            # other field, key-presence requirement and the original snapshot.
            if host.get("OomKillDisable") is False and "OomKillDisable" in after_host and after_host["OomKillDisable"] is None:
                after_host["OomKillDisable"] = False
            require(all(after[key] == before[key] for key in ("Id", "Name", "Image", "Config", "Mounts"))
                    and after_host == host
                    and (after["HostConfig"].get("OomKillDisable") is None or after["HostConfig"].get("OomKillDisable") is False)
                    and exact_mounts(after)
                    and state.get("Running") is False and state.get("Status") == "exited"
                    and type(state.get("ExitCode")) is int and state["ExitCode"] == 0
                    and not any(state.get(key, False) for key in ("OOMKilled", "Restarting", "Paused", "Dead")),
                    "Storage helper terminal identity or state differs")
            removed = self.docker.run(["container", "rm", identifier], timeout=10)
            require(removed.returncode == 0 and removed.stdout.strip() == identifier,
                    "Storage helper removal acknowledgement differs")
            return attached.stdout
        except (Exception, KeyboardInterrupt) as error:
            # A lost daemon acknowledgement can leave this distinct helper live.
            # Do not retry, or let ordinary fixture cleanup infer terminal state.
            raise FreshMutationUnknown("Budgeted storage helper requires manual reconciliation") from error

    def _public_response(self, port, path):
        context = ssl.create_default_context(cafile=str(self.tls / "cert.pem"))
        connection = HTTPSConnection("127.0.0.1", port, timeout=4, context=context)
        try:
            connection.request("GET", path, headers={"Accept": "application/json", "Connection": "close"})
            response = connection.getresponse()
            raw = response.read(2049)
            require(len(raw) <= 2048, "Fresh Compose ingress response exceeded its bound")
            return response.status, raw
        finally:
            connection.close()

    def _public(self, port, path):
        status, raw = self._public_response(port, path)
        require(status == 200, "Fresh Compose health or Web identity unavailable")
        return decode(raw)

    def _ready_rows(self, phase):
        deadline = time.monotonic() + 60
        while True:
            rows = self._rows()
            require(set(rows) == self.refs[phase].keys(), "Fresh Compose runtime inventory differs")
            for name, row in rows.items():
                state = row["State"]
                require(row["Image"] == self.images[phase][name] and state["Running"] is (name in LONG_RUNNING)
                        and row["RestartCount"] == 0 and (name in LONG_RUNNING or (state["Status"], state["ExitCode"]) == ("exited", 0)),
                        "Fresh Compose service identity or state differs")
            statuses = [rows[name]["State"].get("Health", {}).get("Status") for name in ("postgres", "app", "ws")]
            require(all(status in {"starting", "healthy"} for status in statuses), "Fresh Compose required healthcheck is absent or unhealthy")
            if all(status == "healthy" for status in statuses):
                return rows
            require(time.monotonic() < deadline, "Fresh Compose startup healthchecks did not become healthy")
            time.sleep(0.5)

    def _bun_probe(self, row, script, timeout):
        result = self.docker.run(["exec", row["Id"], "bun", "--no-env-file", "-e", script], timeout=timeout)
        return decode(result.stdout.encode())

    @staticmethod
    def _witness(rows):
        return {name: (row["Id"], row["Image"], row["State"]["StartedAt"], row["RestartCount"]) for name, row in rows.items()}

    def _observe(self, relay, phase):
        port = int(relay.authority.rsplit(":", 1)[1])
        deadline = time.monotonic() + 50
        while True:
            try:
                health = self._public(port, "/api/health")
                identity = self._public(port, "/api/runtime/web-identity")
                require(health == {"ok": True} and identity["sourceRevision"] == self.revisions[phase]
                        and identity["contract"] == "warpdrive.web.identity.v1" and identity["component"] == "web",
                        "Fresh public Web generation differs")
                break
            except (OSError, HTTPException, ValueError, KeyError, SwitchConflict):
                require(time.monotonic() < deadline, "Fresh Compose public Web did not become ready")
                time.sleep(0.5)
        rows = self._ready_rows(phase)
        caddy = rows["caddy"]
        mounts = {mount["Destination"]: (mount["Source"], mount["RW"]) for mount in caddy["Mounts"] if mount["Type"] == "bind"}
        require(caddy["Config"]["Cmd"] == ["caddy", "run", "--config", "/etc/caddy/warpdrive-newsletters", "--adapter", "caddyfile"]
                and mounts == {"/etc/caddy/Caddyfile": (str(self.directory / "Caddyfile"), False),
                               "/etc/caddy/warpdrive-newsletters": (str(self.directory / "deploy/newsletters/Caddyfile"), False),
                               "/fixture": (str(self.tls), False)}
                and (self.directory / "Caddyfile").read_text(encoding="utf-8") == TLS,
                "Owned Caddy startup config or mounts differ")
        require(self._bun_probe(rows["app"], APP_PEER_PROBE, 20) == {"anonymousObjectDenied": True, "passiveEngineHealthy": True},
                "Fresh Compose passive engine or private storage readback differs")
        stored = self._sql(f"SELECT name FROM pipelines WHERE id='{self.seed}';\nSELECT count(*) FROM stages WHERE pipeline_id='{self.seed}';\n"
                           "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id;").stdout.splitlines()
        require(len(stored) > 2 and stored[0:2] == [b"Fresh Compose qualification", b"1"]
                and all(re.fullmatch(rb"[a-f0-9]{64}", item) for item in stored[2:]),
                "Fresh Compose database witness differs")
        self._object("read")
        ledger = {"rows": len(stored) - 2, "sha256": sha256(b"\n".join(stored[2:])).hexdigest()}
        witness = self._witness(rows)
        require(self._witness(self._ready_rows(phase)) == witness, "Fresh Compose service changed during health or data readback")
        return witness, ledger

    def _baseline_readiness(self):
        rows = self._ready_rows("baseline")
        require(self._bun_probe(rows["ws"], WS_PROBE, 10) == {"unauthenticatedCloseCode": 4401},
                "Fresh Compose Realtime did not enforce unauthenticated WebSocket rejection")
        require(self._bun_probe(rows["worker"], WORKER_PROBE, 45) == {"completed": True},
                "Fresh Compose Worker did not consume its owned queue job")
        return {"realtimeCloseCode": 4401, "workerFileReaperCompleted": True}

    def _confirm_candidate_stopped(self, relay, admitted):
        require(self._witness(self._ready_rows("candidate")) == admitted,
                "Candidate or retained services changed before failure injection")
        self.docker.run(["stop", "--time", "20", admitted["app"][0]], timeout=30)
        rows = self._rows()
        require(set(rows) == set(admitted) and rows["app"]["State"]["Running"] is False
                and rows["app"]["State"]["Status"] == "exited" and self._witness(rows) == admitted,
                "Stopped candidate or retained service identity is unresolved")
        port = int(relay.authority.rsplit(":", 1)[1])
        status, _ = self._public_response(port, "/api/runtime/web-identity")
        after = self._rows()
        require(status == 502 and self._witness(after) == admitted and after["app"]["State"]["Status"] == "exited"
                and all(after[name]["State"]["Running"] is True for name in LONG_RUNNING - {"app"}),
                "Fresh Compose candidate failure is not proven through the retained ingress")
        return {"candidateStopped": True, "ingressStatus": status}

    def exercise(self):
        self._provision()
        name = self._rows()["caddy"]["Name"].removeprefix("/")
        with owned_bridge_forwarder(self.docker, owner_label=OWNER, owner=self.project, network_name=self.network,
                                    container_name=name, port=SERVICE_PORT, max_connections=4) as relay:
            readiness = self._baseline_readiness()
            initial, ledger = self._observe(relay, "baseline")
            self.receipt["checks"]["baseline"] = {"revision": self.revisions["baseline"], "migrationLedger": ledger, **readiness}
            current = initial
            for phase in ("candidate", "baseline"):
                if phase == "baseline":
                    self.receipt["checks"]["injectedFailure"] = self._confirm_candidate_stopped(relay, current)
                self.compose(phase, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "app")
                observed, confirmed = self._observe(relay, phase)
                require(confirmed == ledger and observed["app"][0] != current["app"][0]
                        and {**observed, "app": initial["app"]} == initial,
                        "Web selection changed a retained service, migration ledger or startup identity")
                self.receipt["checks"]["candidate" if phase == "candidate" else "rollback"] = {
                    "revision": self.revisions[phase], "retainedServicesUnchanged": True, "databaseAndObjectContinuity": True}
                current = observed

    def cleanup(self):
        # Only remove inspected IDs and verified project-owned local volumes.
        ids = self._ids()
        require(len(ids) <= 16 and len(ids) == len(set(ids)) and all(EXACT_ID.fullmatch(item) for item in ids),
                "Fresh smoke cleanup could not select exact IDs")
        rows = self.docker.json(["container", "inspect", *ids], timeout=10) if ids else []
        require({row["Id"] for row in rows} == set(ids) and len(rows) == len(ids) and all(row["Config"]["Labels"][OWNER] == self.project
                and row["Config"]["Labels"].get(SERVICE) in self.refs["baseline"] and row["Id"] in ids
                and row["Image"] in {phase[row["Config"]["Labels"][SERVICE]] for phase in self.images.values()} for row in rows),
                "Fresh smoke cleanup found unowned containers")
        network, volumes = self._resources("network"), self._resources("volume")
        require(set(network) <= {self.network} and set(volumes) <= self.volume_names, "Fresh smoke cleanup found unowned storage")
        network_id = None
        if network:
            selected, = self.docker.json(["network", "inspect", self.network], timeout=10)
            require(selected["Labels"][OWNER] == self.project and selected["Name"] == self.network and selected["Internal"] is True
                    and EXACT_ID.fullmatch(selected["Id"]) and set(selected.get("Containers") or {}) <= set(ids),
                    "Fresh smoke network has foreign references")
            network_id = selected["Id"]
        for name in volumes:
            self._verify_volume(name, allowed=set(ids))
        self._stop_owned(rows)
        require(set(self._ids()) == set(ids), "Fresh smoke container inventory changed during drain")
        for name in volumes:
            self._verify_volume(name, allowed=set(ids))
        for row in rows:
            self.docker.run(["container", "rm", row["Id"]], timeout=10)
        if network_id is not None:
            self.docker.run(["network", "rm", network_id], timeout=10)
        for name in volumes:
            self._verify_volume(name, allowed=set())
            self.docker.run(["volume", "rm", name], timeout=10)
        require(not self._ids() and not self._resources("network") and not self._resources("volume"), "Fresh smoke cleanup is incomplete")

    def failure_diagnostics(self, error):
        """Retain finite first-failure facts, without raw inspect/config or credential-bearing logs."""
        result = {"errorType": type(error).__name__}
        if isinstance(error, (SmokeError, SwitchConflict)):
            result["message"] = sanitized_log(str(error), self.secret_values, byte_limit=1024)["text"]
        try:
            rows = self._rows()
            result["services"] = {}
            for service, row in rows.items():
                state = row["State"]
                status, health = state.get("Status"), (state.get("Health") or {}).get("Status")
                result["services"][service] = {"status": status if status in {"created", "running", "paused", "restarting", "removing", "exited", "dead"} else "unknown",
                    "health": health if health in {"starting", "healthy", "unhealthy"} else "unknown",
                    "exitCode": state.get("ExitCode") if type(state.get("ExitCode")) is int else None,
                    "oomKilled": state.get("OOMKilled") if type(state.get("OOMKilled")) is bool else None}
        except (OSError, KeyError, ValueError, TypeError, SmokeError, SwitchConflict):
            result["inspection"] = "unavailable-or-unowned"
        return result

    def _stop_owned(self, rows):
        """Drain ingress, then all writers, before stopping their backing services."""
        require(all(type(row["State"].get("Running")) is bool for row in rows), "Fresh smoke runtime state is ambiguous")
        stopped = []
        for services in STOP_WAVES:
            wave = [row for row in rows if row["Config"]["Labels"][SERVICE] in services and row["State"]["Running"]]
            if not wave:
                continue

            def stop(row):
                grace = STOP_GRACE[row["Config"]["Labels"][SERVICE]]
                self.docker.run(["stop", "--time", str(grace), row["Id"]], timeout=grace + 10)

            # Each stop has its own finite process deadline. Keeping backing services
            # live until the entire writer wave exits preserves the drain contract.
            with ThreadPoolExecutor(max_workers=len(wave)) as pool:
                futures = [pool.submit(stop, row) for row in wave]
                failures = [future.exception() for future in futures]
            require(not any(failures), "Fresh smoke stop acknowledgement is unknown; resources retained")
            observed = self.docker.json(["container", "inspect", *[row["Id"] for row in wave]], timeout=10)
            expected = {row["Id"]: row for row in wave}
            require(len(observed) == len(expected) and {row["Id"] for row in observed} == set(expected),
                    "Fresh smoke stopped inventory differs")
            for row in observed:
                before = expected[row["Id"]]
                state = row["State"]
                require(row["Image"] == before["Image"] and row["Config"]["Labels"] == before["Config"]["Labels"]
                        and state.get("Running") is False and state.get("Status") == "exited"
                        and not any(state.get(name, False) for name in ("OOMKilled", "Restarting", "Paused", "Dead"))
                        and type(state.get("ExitCode")) is int and state["ExitCode"] in (0, 143),
                        "Fresh smoke graceful stop was not confirmed; resources retained")
                stopped.append({"service": row["Config"]["Labels"][SERVICE], "containerId": row["Id"],
                                "exitCode": state["ExitCode"], "graceSeconds": STOP_GRACE[row["Config"]["Labels"][SERVICE]]})
        self.receipt["checks"]["cleanupDrain"] = stopped

    def _verify_volume(self, name, *, allowed):
        row, = self.docker.json(["volume", "inspect", name], timeout=10)
        require(row["Name"] == name and row["Labels"][OWNER] == self.project and row["Driver"] == "local" and not row.get("Options"),
                "Fresh smoke volume ownership differs")
        holders = self.docker.run(["ps", "-a", "--no-trunc", "--filter", f"volume={name}", "--format", "{{.ID}}"], timeout=10).stdout.splitlines()
        require(set(holders) <= allowed, "Fresh smoke volume has foreign references")


def run(baseline, candidate, *, storage_client_bin="mc", cgroup_parent=None):
    validate_storage_client_bin(storage_client_bin)
    validate_cgroup_parent(cgroup_parent)
    _native_host()
    _same_except_web({"services": {name: {"image": ref} for name, ref in baseline.items()}},
                     {"services": {name: {"image": ref} for name, ref in candidate.items()}})
    docker = Docker(runner=run_owned_fixture_command)
    directory = Path(mkdtemp(prefix="wd-fresh-compose-")).resolve()
    original = directory.stat()
    previous_handler = signal.signal(signal.SIGALRM, _deadline_expired)
    signal.alarm(TOTAL_SECONDS)
    fixture, armed, removed, held = None, False, False, False
    try:
        fixture = FreshSmoke(docker, directory, baseline, candidate, storage_client_bin=storage_client_bin, cgroup_parent=cgroup_parent)
        try:
            fixture._preloaded()
            fixture.prepare()
            fixture._require_empty()
            armed = True
            fixture.exercise()
            fixture.receipt["success"] = True
        except FreshCommandUnknown as error:
            held = True
            fixture.receipt.update(failure=type(error).__name__, success=False, cleanupSuccess=False,
                                   cleanupArmed=armed, manualReconciliationRequired=True,
                                   mutationCompletionUnknown=isinstance(error, FreshMutationUnknown))
        except (OSError, KeyError, ValueError, TypeError, SwitchConflict, SmokeError, ForwarderError,
                subprocess.SubprocessError) as error:
            fixture.receipt["failure"] = type(error).__name__
            fixture.receipt["diagnostics"] = fixture.failure_diagnostics(error)
        finally:
            signal.alarm(CLEANUP_SECONDS)
            try:
                if not held:
                    if armed:
                        fixture.cleanup()
                    _directory(directory)
                    require(os.path.samestat(original, directory.lstat()), "Private fixture root changed before removal")
                    shutil.rmtree(directory)
                    removed = True
                    fixture.receipt["cleanupSuccess"] = True
                    fixture.receipt["cleanupArmed"] = armed
            except (Exception, KeyboardInterrupt) as error:
                fixture.receipt["cleanupFailure"] = type(error).__name__
                fixture.receipt["success"] = False
                fixture.receipt["manualReconciliationRequired"] = True
                fixture.receipt["retainedFixtureDirectory"] = str(directory)
        return fixture.receipt
    finally:
        # An uncertain constructor/preflight or cleanup must keep the private
        # config available. TemporaryDirectory would remove it unconditionally.
        if not removed and fixture is not None:
            fixture.receipt["retainedFixtureDirectory"] = str(directory)
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-native", action="store_true", required=True)
    parser.add_argument("--storage-client-bin", choices=("mc", "mcli"), default="mc")
    parser.add_argument("--cgroup-parent")
    for phase in ("baseline", "candidate"):
        parser.add_argument(f"--{phase}-env", required=True, type=Path)
        parser.add_argument(f"--{phase}-env-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        result = run(_pinned_images(args.baseline_env, args.baseline_env_sha256, storage_client_bin=args.storage_client_bin),
                     _pinned_images(args.candidate_env, args.candidate_env_sha256, storage_client_bin=args.storage_client_bin),
                     storage_client_bin=args.storage_client_bin, cgroup_parent=args.cgroup_parent)
    except (OSError, KeyError, TypeError, ValueError, SwitchConflict, SmokeError, subprocess.SubprocessError) as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
