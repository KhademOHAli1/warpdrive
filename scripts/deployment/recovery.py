#!/usr/bin/env python3
"""Cold recovery-set capture and isolated verification; never stop or resume writers.

The supported live observer is a local Linux Docker Compose installation using
exclusive local named volumes. It reads actual Docker and pg_controldata state.
Restic supplies authenticated encryption. Local journals/checksums are trusted
operator records, not signatures or proof of independent off-host custody.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, ExitStack
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import select
import signal
import stat
import subprocess
import sys
import time
from typing import Protocol
from urllib.parse import parse_qsl, urlsplit

HASH = re.compile(r"[0-9a-f]{64}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,63}\Z")
SERVICES = {"caddy", "postgres", "minio", "app", "worker", "ws", "migrate",
            "createbuckets", "newsletter-engine", "newsletter-engine-migrate"}
REQUIRED_SERVICES = {"caddy", "postgres", "minio", "app", "worker", "ws", "newsletter-engine"}
VOLUMES = {"postgres": "pgdata", "objects": "miniodata", "newsletterMedia": "newsletter_uploads",
           "ingressData": "caddydata", "ingressConfig": "caddyconfig"}
DEFAULT_LIMITS = {"files": 100_000, "bytes": 1024**4, "fileBytes": 64 * 1024**3,
                  "seconds": 3600, "reserveBytes": 2 * 1024**3,
                  "repositoryBytes": 4 * 1024**4}
MAX_METADATA = 32 * 1024**2
LIMITATIONS = [
    "No writer stop/start, installed restore, provider reconciliation or automatic writer resumption.",
    "Independent credentials and uncached readback on one host do not prove off-host acceptance or separate key custody.",
    "Restore verifies captured bytes and metadata in a new directory; booting the recovered services remains unqualified.",
    "External engine media, KMS dependencies and application-level object/credential reconciliation require installation-specific inspection.",
]


class RecoveryError(RuntimeError):
    pass


class RecoveryUnknown(RecoveryError):
    """A backup may exist. Reconcile its exact manifest; never repeat the write."""
    def __init__(self, message, *, failure=None):
        self.failure = failure
        super().__init__(message)


class RecoveryCommandFailure(RecoveryError):
    def __init__(self, exit_code):
        self.exit_code = exit_code
        super().__init__("Recovery command failed; outcome requires readback")


class ResticFailure(RecoveryError):
    """Finite diagnostic facts only; command streams and arguments stay private."""
    def __init__(self, operation, error):
        require(operation in {"repository-identity", "snapshot-write", "snapshot-find", "snapshot-metadata",
                              "manifest-read", "snapshot-members", "repository-budget", "repository-integrity", "isolated-restore"},
                "Unknown recovery operation")
        reason = "command-nonzero" if isinstance(error, RecoveryCommandFailure) else "command-guard"
        self.operation, self.reason = operation, reason
        self.exit_code = error.exit_code if isinstance(error, RecoveryCommandFailure) else None
        super().__init__(f"Recovery operation {operation} failed ({reason})")


def failure_fact(error):
    """Return fixed diagnostic fields; never serialize an exception or cause."""
    if isinstance(error, RecoveryUnknown) and error.failure is not None:
        return error.failure
    if isinstance(error, ResticFailure):
        return {"operation": error.operation, "reason": error.reason, "exitCode": error.exit_code}
    return {"operation": "verification", "reason": "guard-rejected"}


def require(value, message):
    if not value:
        raise RecoveryError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def document(raw):
    require(len(raw) <= MAX_METADATA, "Recovery metadata exceeds its bound")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate recovery metadata property")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique)
    except (ValueError, TypeError):
        raise RecoveryError("Invalid recovery metadata") from None


def absolute(value):
    require(isinstance(value, str) and len(value.encode("utf8")) <= 4096 and value.startswith("/") and "\x00" not in value
            and not any(ord(c) < 32 for c in value), "An absolute bounded source path is required")
    path = PurePosixPath(value)
    require(str(path) == value and len(path.parts) <= 128 and ".." not in path.parts and value != "/", "Unsafe recovery path")
    return Path(value)


def open_path(path, flags=os.O_RDONLY):
    """Pin every ancestor instead of following a symlink during source admission."""
    path = absolute(str(path))
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        result = os.open(path.name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        return result
    finally:
        os.close(descriptor)


def read_regular(path, maximum=MAX_METADATA):
    descriptor = open_path(path)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_size <= maximum, "Unsafe or oversized recovery file")
        raw = source.read(maximum + 1)
    require(len(raw) <= maximum, "Recovery file exceeds its bound")
    return raw


def no_overlap(left, right):
    return not (left.is_relative_to(right) or right.is_relative_to(left))


def relative_open(anchor, path, flags=os.O_RDONLY):
    """Open an absolute snapshot path below an already pinned restore root."""
    path = absolute(str(path))
    descriptor = os.dup(anchor)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return os.open(path.name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
    finally:
        os.close(descriptor)


class DirectoryHandle:
    def __init__(self, path, *, private_parent=False):
        self.path = absolute(str(path))
        self.fd = open_path(self.path, os.O_RDONLY | os.O_DIRECTORY)
        self.identity = (os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino)
        try:
            if private_parent:
                parent = open_path(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    metadata = os.fstat(parent)
                    require(metadata.st_uid == os.geteuid() and stat.S_IMODE(metadata.st_mode) == 0o700,
                            "Local recovery mutation paths require a private owned parent")
                finally:
                    os.close(parent)
        except BaseException:
            os.close(self.fd)
            raise

    def check(self):
        descriptor = open_path(self.path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            metadata = os.fstat(descriptor)
            require((metadata.st_dev, metadata.st_ino) == self.identity, "Pinned recovery directory path changed")
        finally:
            os.close(descriptor)

    def argument(self):
        # The live adapter is Linux only. macOS is used solely by synthetic tests
        # under a private parent; it does not establish Linux descriptor behavior.
        self.check()
        return f"/proc/self/fd/{self.fd}" if sys.platform.startswith("linux") else str(self.path)

    def close(self):
        os.close(self.fd)


class RestoreTarget:
    def __init__(self, path):
        self.path = absolute(str(path))
        self.parent = DirectoryHandle(self.path.parent)
        try:
            info = os.fstat(self.parent.fd)
            require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                    "Restore target requires a private owned parent")
        except BaseException:
            self.parent.close()
            raise
        self.fd = None

    def create(self):
        self.parent.check()
        os.mkdir(self.path.name, 0o700, dir_fd=self.parent.fd)
        self.fd = os.open(self.path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.parent.fd)
        require(not os.listdir(self.fd), "Restore target is not new and empty")

    def argument(self):
        require(self.fd is not None, "Restore target has not been reserved")
        self.parent.check()
        child = os.open(self.path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.parent.fd)
        try:
            require((os.fstat(child).st_dev, os.fstat(child).st_ino)
                    == (os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino), "Restore target path changed")
        finally:
            os.close(child)
        return f"/proc/self/fd/{self.fd}" if sys.platform.startswith("linux") else str(self.path)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
        self.parent.close()

    def __fspath__(self):
        return str(self.path)

    def __truediv__(self, other):
        return self.path / other


def limits(value):
    require(isinstance(value, dict) and set(value) == set(DEFAULT_LIMITS), "Explicit complete recovery limits required")
    require(all(type(v) is int and v > 0 for v in value.values()), "Positive integer recovery limits required")
    require(value["files"] <= 100_000 and value["seconds"] <= 86_400
            and value["bytes"] <= 16 * 1024**4 and value["fileBytes"] <= value["bytes"]
            and value["repositoryBytes"] <= 64 * 1024**4,
            "Recovery limits exceed the supported envelope")
    return value


def validate_plan(plan):
    keys = {"schemaVersion", "kind", "operationId", "installationId", "project", "containers",
            "volumes", "configurationFiles", "repositoryId", "limits"}
    require(isinstance(plan, dict) and set(plan) == keys and type(plan["schemaVersion"]) is int
            and plan["schemaVersion"] == 1 and plan["kind"] == "warpdrive-cold-recovery-set",
            "Complete cold Compose recovery plan required")
    require(all(isinstance(plan[k], str) and NAME.fullmatch(plan[k])
                for k in ("operationId", "installationId", "project")), "Invalid installation or operation identity")
    require(isinstance(plan["repositoryId"], str) and HASH.fullmatch(plan["repositoryId"]), "Fixed full repository ID required")
    containers = plan["containers"]
    require(isinstance(containers, dict) and REQUIRED_SERVICES <= set(containers) <= SERVICES,
            "Every supported writer and storage service must be inventoried")
    identifiers = []
    for service, expected in containers.items():
        require(isinstance(expected, dict) and set(expected) == {"id", "imageId"}
                and isinstance(expected["id"], str) and HASH.fullmatch(expected["id"])
                and isinstance(expected["imageId"], str) and IMAGE.fullmatch(expected["imageId"]),
                "Full container and immutable image identities required")
        identifiers.append(expected["id"])
    require(len(set(identifiers)) == len(identifiers), "Duplicate container identity")
    require(isinstance(plan["volumes"], dict) and set(plan["volumes"]) == set(VOLUMES)
            and all(isinstance(v, str) and NAME.fullmatch(v) for v in plan["volumes"].values())
            and len(set(plan["volumes"].values())) == len(VOLUMES), "All five exclusive named volumes required")
    require(isinstance(plan["configurationFiles"], list) and 1 <= len(plan["configurationFiles"]) <= 64,
            "Installation configuration and accepted-state paths required")
    for path in plan["configurationFiles"]:
        absolute(path)
    limits(plan["limits"])


def scan(paths, budget, *, anchor=None, forbidden=()):
    """Hash bounded regular trees, preserving ownership/modes and refusing aliases."""
    started = time.monotonic()
    result, byte_count = [], 0
    roots = []
    for path in sorted({absolute(str(p)) for p in paths}, key=lambda p: (len(p.parts), str(p))):
        if not any(path.is_relative_to(parent) for parent in roots):
            roots.append(path)
    def visit(descriptor, path):
        nonlocal byte_count
        absolute(str(path))
        require(time.monotonic() - started <= budget["seconds"]
                and time.monotonic() <= budget.get("deadline", float("inf")), "Source inventory deadline exceeded")
        info = os.fstat(descriptor)
        require((info.st_dev, info.st_ino) not in forbidden, "Recovery key or repository aliases captured source state")
        require(len(result) < budget["files"], "Source file-count budget exceeded")
        row = {"path": str(path), "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid}
        if stat.S_ISDIR(info.st_mode):
            row["kind"] = "directory"
            result.append(row)
            for entry in sorted(os.listdir(descriptor)):
                require(entry not in {".", ".."} and not any(ord(c) < 32 for c in entry), "Unsafe source filename")
                metadata = os.stat(entry, dir_fd=descriptor, follow_symlinks=False)
                require(stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode),
                        "Symlink, external tablespace or special source file is unsupported")
                child = os.open(entry, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
                try:
                    visit(child, path / entry)
                finally:
                    os.close(child)
        else:
            require(stat.S_ISREG(info.st_mode) and info.st_size <= budget["fileBytes"], "Unsafe or oversized source member")
            byte_count += info.st_size
            require(byte_count <= budget["bytes"], "Source byte budget exceeded")
            hasher = hashlib.sha256()
            remaining = info.st_size
            while remaining:
                require(time.monotonic() - started <= budget["seconds"]
                        and time.monotonic() <= budget.get("deadline", float("inf")), "Source inventory deadline exceeded")
                chunk = os.read(descriptor, min(1024**2, remaining))
                require(bool(chunk), "Source changed while hashing")
                hasher.update(chunk)
                remaining -= len(chunk)
            after = os.fstat(descriptor)
            require((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
                    == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                    and not os.read(descriptor, 1), "Source changed while hashing")
            row.update(kind="file", bytes=info.st_size, sha256=hasher.hexdigest())
            result.append(row)
    for path in roots:
        descriptor = open_path(path) if anchor is None else relative_open(anchor, path)
        try:
            visit(descriptor, path)
        finally:
            os.close(descriptor)
    return {"roots": [str(p) for p in roots], "entries": sorted(result, key=lambda row: row["path"]), "bytes": byte_count}


class Command:
    """Owned process group, bounded streams/time/RSS; no shell or inherited secrets."""
    def run(self, arguments, *, data=None, seconds=60, maximum=MAX_METADATA, reject_stderr=False, pass_fds=()):
        require(data is None or len(data) <= 128 * 1024, "Command input exceeds its bound")
        environment = {"PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
                       "LC_ALL": "C", "TZ": "UTC", "GOMAXPROCS": "2", "GOMEMLIMIT": "256MiB"}
        seconds = min(seconds, getattr(self, "deadline", float("inf")) - time.monotonic())
        require(seconds > 0, "Recovery command deadline exceeded")
        process = subprocess.Popen(arguments, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment,
                                   start_new_session=True, pass_fds=pass_fds)
        output, errors = bytearray(), bytearray()
        started = time.monotonic()
        try:
            pending = memoryview(data) if data is not None else None
            if pending is not None:
                os.set_blocking(process.stdin.fileno(), False)
            streams = {process.stdout: output, process.stderr: errors}
            while streams or pending is not None:
                require(time.monotonic() - started < seconds, "Recovery command deadline exceeded")
                readable, writable, _ = select.select(list(streams), [process.stdin] if pending is not None else [], [], 0.2)
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
                        require(len(output) <= maximum and len(errors) <= 64 * 1024, "Recovery command output exceeded its bound")
                # Go's memory limit is soft; retain an independent sampled group limit.
                rows = subprocess.run(["/bin/ps", "-axo", "pgid=,rss="], capture_output=True,
                                      text=True, check=True, timeout=3).stdout.splitlines()
                rss = sum(int(fields[1]) * 1024 for line in rows
                          if len(fields := line.split()) == 2 and int(fields[0]) == process.pid)
                require(rss <= 768 * 1024**2, "Recovery command RSS budget exceeded")
            exit_code = process.wait(timeout=5)
            if exit_code != 0:
                raise RecoveryCommandFailure(exit_code)
            require(not reject_stderr or not errors, "Recovery inspection emitted diagnostics and is unknown")
            return bytes(output)
        finally:
            # A child retaining stdout can survive its leader. Stop the whole
            # group even if the leader already exited; this session is ours.
            for signum in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, signum)
                except ProcessLookupError:
                    break
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    continue
                # SIGKILL is still sent to any group descendants after TERM.
            process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()


class ColdObserver(Protocol):
    def observe(self, plan: dict) -> dict: ...


class DockerColdObserver:
    """Inspect only. No stop/start/exec, host socket mount or container creation."""
    def __init__(self, docker, pg_controldata, command=None):
        self.docker = str(Path(docker).resolve(strict=True))
        self.pg_control = str(Path(pg_controldata).resolve(strict=True))
        self.command = command or Command()

    def _json(self, *arguments):
        return document(self.command.run([self.docker, *arguments]))

    def observe(self, plan):
        validate_plan(plan)
        require(sys.platform.startswith("linux"), "Cold Docker capture requires the local Linux host")
        context = self._json("context", "inspect")
        endpoint = context[0].get("Endpoints", {}).get("docker", {}).get("Host", "") if len(context) == 1 else ""
        require(endpoint.startswith("unix:///"), "Remote Docker authority is unsupported")
        info = self._json("info", "--format", "{{json .}}")
        require(info.get("OSType") == "linux" and info.get("Swarm", {}).get("LocalNodeState") == "inactive",
                "Dedicated Linux Compose storage required")
        all_ids = self.command.run([self.docker, "ps", "-aq", "--no-trunc"]).decode().splitlines()
        require(len(all_ids) <= 1024 and all(HASH.fullmatch(i) for i in all_ids), "Container inventory is unbounded or invalid")
        rows = self._json("inspect", *all_ids) if all_ids else []
        owned = [r for r in rows if r.get("Config", {}).get("Labels", {}).get("com.docker.compose.project") == plan["project"]]
        require({r.get("Id") for r in owned} == {r["id"] for r in plan["containers"].values()},
                "Unknown, missing or additional installation container")
        postgres = next(row for row in owned
                        if row.get("Config", {}).get("Labels", {}).get("com.docker.compose.service") == "postgres")
        pg_networks = set(postgres.get("NetworkSettings", {}).get("Networks", {}))
        require(len(pg_networks) == 1 and not postgres.get("HostConfig", {}).get("PortBindings")
                and postgres.get("HostConfig", {}).get("NetworkMode") in pg_networks,
                "Unknown, host-published or shared PostgreSQL authority")
        network_name = next(iter(pg_networks))
        networks = self._json("network", "inspect", network_name)
        require(isinstance(networks, list) and len(networks) == 1, "Private PostgreSQL bridge inspection is incomplete")
        network = networks[0]
        def aliases(endpoint):
            values = endpoint.get("Aliases") or []
            require(isinstance(values, list) and len(values) <= 128
                    and all(isinstance(value, str) and len(value) <= 253 for value in values),
                    "Unknown network alias metadata")
            return {value.rstrip(".").casefold() for value in values}
        require(network.get("Driver") == "bridge" and network.get("Scope") == "local"
                and network.get("Labels", {}).get("com.docker.compose.project") == plan["project"]
                and isinstance(network.get("Id"), str) and HASH.fullmatch(network["Id"])
                and set(network.get("Containers", {})) <= {row["Id"] for row in owned},
                "PostgreSQL bridge has unknown ownership or endpoints")
        pg_endpoint = postgres["NetworkSettings"]["Networks"][network_name]
        require(pg_endpoint.get("NetworkID") == network["Id"] and "postgres" in aliases(pg_endpoint),
                "The observed PostgreSQL bridge does not own the postgres alias")
        database_users = {"app", "worker", "ws", "migrate", "newsletter-engine", "newsletter-engine-migrate"}
        network_file_hashes = {}
        for row in owned:
            service = row.get("Config", {}).get("Labels", {}).get("com.docker.compose.service")
            endpoints = row.get("NetworkSettings", {}).get("Networks", {})
            if row["Id"] != postgres["Id"]:
                require(not any("postgres" in aliases(endpoint) for endpoint in endpoints.values()),
                        "The PostgreSQL service alias is ambiguous")
            if service not in database_users:
                continue
            host = row.get("HostConfig", {})
            require(set(endpoints) == pg_networks and host.get("NetworkMode") == network_name
                    and endpoints[network_name].get("NetworkID") == network["Id"]
                    and not any(host.get(key) for key in ("ExtraHosts", "Dns", "DnsSearch", "DnsOptions", "Links")),
                    "Database client DNS or network authority is unobserved")
            require(not any(m.get("Destination") in {"/etc/hosts", "/etc/resolv.conf", "/etc/nsswitch.conf"}
                            for m in row.get("Mounts", [])), "Database resolver override mount is unsupported")
            hosts = read_regular(absolute(row.get("HostsPath")), 64 * 1024)
            resolv = read_regular(absolute(row.get("ResolvConfPath")), 64 * 1024)
            require(all(byte in {9, 10, 13} or 32 <= byte <= 126 for byte in hosts + resolv),
                    "Database resolver files contain unknown encoding or control bytes")
            host_lines = [line.split("#", 1)[0].split() for line in hosts.decode().splitlines()]
            require(not any("postgres" in {value.rstrip(".").casefold() for value in fields[1:]} for fields in host_lines),
                    "Hosts file overrides the database service alias")
            resolvers = [fields[1] for line in resolv.decode().splitlines()
                         if len(fields := line.split("#", 1)[0].split()) >= 2 and fields[0] == "nameserver"]
            require(resolvers and set(resolvers) == {"127.0.0.11"}, "Database clients must use the observed Docker resolver")
            network_file_hashes[row["Id"]] = {"hostsSha256": digest(hosts), "resolvSha256": digest(resolv)}
        roots, private, identities = [], [], []
        wanted_volumes = set(plan["volumes"].values())
        for row in rows:
            labels = row.get("Config", {}).get("Labels", {}) or {}
            mounts = row.get("Mounts", [])
            if labels.get("com.docker.compose.project") != plan["project"]:
                require(not any(m.get("Name") in wanted_volumes for m in mounts), "A recovery volume is shared outside this installation")
                require(not pg_networks.intersection(row.get("NetworkSettings", {}).get("Networks", {})),
                        "The PostgreSQL network is shared outside this installation")
                continue
            service = labels.get("com.docker.compose.service")
            expected = plan["containers"].get(service)
            require(expected is not None and row.get("Id") == expected["id"] and row.get("Image") == expected["imageId"],
                    "Container service or immutable image changed")
            state = row.get("State", {})
            require(state.get("Status") == "exited" and state.get("Running") is False
                    and state.get("Paused") is False and state.get("Restarting") is False
                    and state.get("Dead") is False and state.get("OOMKilled") is False
                    and state.get("ExitCode") == 0 and state.get("FinishedAt", "").startswith("20"),
                    "Every writer and storage process must be cleanly stopped")
            for mount in mounts:
                if mount.get("Type") == "volume":
                    require(mount.get("Name") in wanted_volumes, "Uninventoried persistent volume")
                elif mount.get("Type") == "bind":
                    require(mount.get("RW") is False, "Writable bind source is unsupported")
                    source = absolute(mount.get("Source"))
                    require(any(source.is_relative_to(absolute(p)) for p in plan["configurationFiles"]),
                            "Bind source is outside the approved configuration set")
                    roots.append(str(source))
                else:
                    require(mount.get("Type") == "tmpfs", "Unknown persistent mount type")
            private.append({"service": service, "id": row["Id"], "imageId": row["Image"],
                            "config": row["Config"], "hostConfig": row.get("HostConfig", {}), "mounts": mounts,
                            "networkFileHashes": network_file_hashes.get(row["Id"]),
                            "networks": row.get("NetworkSettings", {}).get("Networks", {})})
            identities.append({"id": row["Id"], "imageId": row["Image"], "service": service,
                               "startedAt": state.get("StartedAt"), "finishedAt": state["FinishedAt"],
                               "configurationSha256": digest(canonical(private[-1]))})
        for service, role, destination in (("postgres", "postgres", "/var/lib/postgresql/data"),
                                            ("minio", "objects", "/data"),
                                            ("newsletter-engine", "newsletterMedia", "/listmonk/uploads"),
                                            ("caddy", "ingressData", "/data"),
                                            ("caddy", "ingressConfig", "/config")):
            container = next(item for item in private if item["service"] == service)
            matches = [m for m in container["mounts"] if m.get("Type") == "volume"
                       and m.get("Name") == plan["volumes"][role] and m.get("Destination") == destination]
            require(len(matches) == 1, "Required service data mount differs from the supported installation")
        volume_rows = self._json("volume", "inspect", *sorted(wanted_volumes))
        require(len(volume_rows) == len(wanted_volumes), "Incomplete volume inventory")
        members = {}
        for role, logical in VOLUMES.items():
            name = plan["volumes"][role]
            found = [v for v in volume_rows if v.get("Name") == name]
            require(len(found) == 1, "Missing volume identity")
            volume = found[0]
            labels = volume.get("Labels", {}) or {}
            require(volume.get("Driver") == "local" and volume.get("Scope") == "local"
                    and not volume.get("Options") and labels.get("com.docker.compose.project") == plan["project"]
                    and labels.get("com.docker.compose.volume") == logical, "Unknown or nonexclusive volume authority")
            path = absolute(volume.get("Mountpoint"))
            require(path.is_relative_to(absolute(info.get("DockerRootDir"))) and path.name == "_data",
                    "Volume does not belong to this local Docker data root")
            members[role] = str(path)
            roots.append(str(path))
        # Every configured file secret must resolve through an observed read-only bind
        # or an already included named volume. Environment literals are in private config.
        for item in private:
            resolved = {}
            for value in item["config"].get("Env", []):
                key, separator, target = value.partition("=")
                require(separator and key not in resolved, "Malformed or duplicate runtime environment binding")
                resolved[key] = target
            # Parse first, then apply file overrides independently of Env order.
            for key, target in list(resolved.items()):
                if key.endswith("_FILE") and target:
                    target_path = absolute(target)
                    candidates = [m for m in item["mounts"] if target_path.is_relative_to(absolute(m["Destination"]))]
                    require(bool(candidates), "A secret file is outside inventoried mounts")
                    mount = max(candidates, key=lambda m: len(m["Destination"]))
                    require(mount.get("Type") in {"bind", "volume"} and (mount.get("Type") == "volume" or mount.get("RW") is False),
                            "A secret file has unsupported mount authority")
                    source = absolute(mount["Source"]) / target_path.relative_to(mount["Destination"])
                    raw = read_regular(source, 1024**2).decode("utf8")
                    resolved[key.removesuffix("_FILE")] = raw.strip() if item["service"] != "newsletter-engine" else raw.rstrip("\n")
            if item["service"] in {"app", "worker", "ws", "migrate"}:
                # New one-shot migrators have a separate owner DSN. Historical cold
                # captures may predate it, but any configured owner target must belong
                # to the same observed cluster, including file-secret overrides.
                dsn_keys = ["DATABASE_URL"]
                if resolved.get("MIGRATION_DATABASE_URL"):
                    dsn_keys.append("MIGRATION_DATABASE_URL")
                for dsn_key in dsn_keys:
                    dsn = urlsplit(resolved.get(dsn_key, ""))
                    require(dsn.scheme in {"postgres", "postgresql"} and dsn.hostname == "postgres"
                            and dsn.port in {None, 5432} and not dsn.fragment
                            and all(key in {"application_name", "connect_timeout", "sslmode"}
                                    for key, _ in parse_qsl(dsn.query, keep_blank_values=True, strict_parsing=True)),
                            "External, ambiguous or unobserved Core database authority")
            if item["service"] == "newsletter-engine":
                normalized = {}
                for key, value in resolved.items():
                    if key.startswith("LISTMONK_") and not key.endswith("_FILE"):
                        name = key.removeprefix("LISTMONK_").lower().replace("__", ".")
                        if "." not in name:
                            name = name.replace("_", "-")
                        require(name not in normalized, "Ambiguous normalized Listmonk configuration key")
                        normalized[name] = value
                require(normalized.get("db.host") == "postgres"
                        and normalized.get("db.port", "5432") == "5432"
                        and normalized.get("db.params") == "",
                        "External or ambiguous engine database authority")
        pg = Path(members["postgres"])
        major = read_regular(pg / "PG_VERSION", 32).decode().strip()
        require(re.fullmatch(r"1[6-9]", major), "Unsupported PostgreSQL data version")
        version = self.command.run([self.pg_control, "--version"], maximum=4096, reject_stderr=True).decode()
        require(re.search(r"PostgreSQL\) " + re.escape(major) + r"\.", version), "PostgreSQL control tool version differs")
        control = self.command.run([self.pg_control, str(pg)], maximum=32 * 1024, reject_stderr=True).decode()
        require(re.search(r"^Database cluster state:\s+shut down\s*$", control, re.M)
                and "WARNING" not in control, "PostgreSQL is not cleanly shut down")
        require(not (pg / "postmaster.pid").exists(), "PostgreSQL process marker remains")
        roots.extend(plan["configurationFiles"])
        # Bind the actual cold observations. Raw secrets stay in one private member.
        witness = {"containers": sorted(identities, key=lambda r: r["id"]), "volumes": volume_rows, "network": network,
                   "postgresControlSha256": digest(control.encode()), "dockerEndpoint": endpoint}
        return {"roots": sorted(set(roots)), "members": members, "fingerprint": digest(canonical(witness)),
                "privateConfiguration": private, "scope": "observed-cold-local-compose"}


def password_file(path):
    path = absolute(str(path))
    descriptor = open_path(path)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.geteuid() and 32 <= info.st_size <= 4096,
                "Recovery key must be an owned 0600 regular file containing a strong random password")
        value = source.read(4097)
    require(32 <= len(value.rstrip(b"\n")) <= 4096 and b"\x00" not in value, "Invalid recovery key file")
    return path, (info.st_dev, info.st_ino), digest(value)


class Restic:
    def __init__(self, binary, repository, key_file, command=None, seconds=3600):
        self.binary = str(Path(binary).resolve(strict=True))
        require(isinstance(repository, str) and len(repository) <= 2048
                and not any(ord(c) < 32 for c in repository), "Explicit approved repository required")
        # No arbitrary backend commands, URL passwords, insecure TLS or shell credential hooks.
        remote = re.fullmatch(r"sftp:([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})@([A-Za-z0-9][A-Za-z0-9.-]*):(/[A-Za-z0-9_./-]+)", repository)
        require(repository.startswith("/") or (remote is not None
                and all(label and not label.endswith("-") for label in remote[2].split("."))
                and all(part not in {".", ".."} for part in remote[3].split("/"))),
                "Only an explicit local rehearsal repository or configured SFTP repository is supported")
        self.repository, self.key, self.key_identity, self.key_sha = repository, *password_file(key_file)
        self.command, self.seconds = command or Command(), seconds
        self.directory = None
        version = self.command.run([self.binary, "version"], maximum=4096).decode()
        require(version.startswith("restic 0.18.0 "), "This adapter is qualified against restic 0.18.0 only")

    def run(self, *args, data=None, maximum=MAX_METADATA):
        require(password_file(self.key)[1:] == (self.key_identity, self.key_sha), "Recovery key file changed")
        repository = self.directory.argument() if self.directory is not None else self.repository
        descriptors = (self.directory.fd,) if self.directory is not None else ()
        operations = {"backup": "snapshot-write", "snapshots": "snapshot-find", "dump": "manifest-read",
                      "ls": "snapshot-members", "stats": "repository-budget", "check": "repository-integrity"}
        operation = ("repository-identity" if args[:2] == ("cat", "config") else "snapshot-metadata"
                     if args[:2] == ("cat", "snapshot") else operations.get(args[0] if args else ""))
        require(operation is not None, "Unknown restic operation")
        try:
            raw = self.command.run([self.binary, "--repo", repository, "--password-file", str(self.key),
                                    "--no-cache", "--json", "--limit-upload", "16384", "--limit-download", "16384", *args],
                                   data=data, seconds=self.seconds, maximum=maximum, pass_fds=descriptors)
        except RecoveryError as error:
            raise ResticFailure(operation, error) from None
        require(password_file(self.key)[1:] == (self.key_identity, self.key_sha), "Recovery key file changed during command")
        if self.directory is not None:
            self.directory.check()
        return raw

    def repository_id(self):
        config = document(self.run("cat", "config"))
        require(config.get("version") == 2 and isinstance(config.get("id"), str) and HASH.fullmatch(config["id"]),
                "Authenticated format-2 repository identity required")
        return config["id"]

    def backup(self, paths, tag):
        require(not self.repository.startswith("/") or self.directory is not None,
                "Local backup requires a retained repository directory descriptor")
        raw = self.run("backup", "--read-concurrency", "1", "--host", "warpdrive-recovery", "--tag", tag,
                       "--files-from-raw", "-", data=b"".join(str(p).encode() + b"\x00" for p in paths))
        summaries = [row for line in raw.splitlines() if (row := document(line)).get("message_type") == "summary"]
        require(len(summaries) == 1 and isinstance(summaries[0].get("snapshot_id"), str)
                and HASH.fullmatch(summaries[0]["snapshot_id"]), "Full written snapshot identity was not returned")
        return summaries[0]["snapshot_id"]

    def find(self, tag):
        rows = document(self.run("snapshots", "--tag", tag))
        require(isinstance(rows, list) and len(rows) <= 64, "Snapshot reconciliation is unbounded")
        require(all(isinstance(r, dict) and isinstance(r.get("id"), str) and HASH.fullmatch(r["id"]) for r in rows),
                "Invalid snapshot identity")
        return [r["id"] for r in rows]

    def validate_snapshot(self, snapshot, tag, manifest_path, manifest, inventory):
        require(isinstance(snapshot, str) and HASH.fullmatch(snapshot), "A full snapshot ID is required")
        metadata = document(self.run("cat", "snapshot", snapshot))
        require(metadata.get("tags") == [tag] and set(metadata.get("paths", [])) == set(inventory["roots"]) | {str(manifest_path)},
                "Snapshot paths or operation binding differs")
        require(self.run("dump", snapshot, str(manifest_path)) == manifest, "Encrypted snapshot manifest differs")
        expected = {r["path"]: r for r in inventory["entries"]}
        expected[str(manifest_path)] = {"kind": "file", "bytes": len(manifest), "sha256": digest(manifest)}
        seen = set()
        for line in self.run("ls", snapshot).splitlines():
            row = document(line)
            if row.get("struct_type") == "snapshot":
                continue
            path, kind = row.get("path"), row.get("type")
            absolute(path)
            require(kind in {"file", "dir"}, "Restoring symlinks or special files is unsupported")
            if kind == "dir" and path not in expected:
                require(any(absolute(root).is_relative_to(absolute(path)) for root in inventory["roots"] + [str(manifest_path)]),
                        "Snapshot includes an unexpected directory")
                continue
            require(path in expected and path not in seen, "Snapshot member inventory differs")
            wanted = expected[path]
            require((kind == "dir") == (wanted["kind"] == "directory")
                    and (kind != "file" or row.get("size") == wanted["bytes"]), "Snapshot member type or size differs")
            seen.add(path)
        require(seen == set(expected), "Snapshot omitted a required recovery member")

    def restore(self, snapshot, target, budget):
        require(not self.repository.startswith("/") or self.directory is not None,
                "Local restore requires a retained repository directory descriptor")
        stats = document(self.run("stats", "--mode", "raw-data"))
        require(type(stats.get("total_size")) is int and stats["total_size"] <= budget["repositoryBytes"],
                "Repository integrity read exceeds its resource budget")
        self.run("check", "--read-data")
        # The repository and target directory descriptors both stay live across
        # the mutation. Linux /proc paths prevent ancestor substitution.
        repository = self.directory.argument() if self.directory is not None else self.repository
        descriptors = (target.fd,) + ((self.directory.fd,) if self.directory is not None else ())
        require(password_file(self.key)[1:] == (self.key_identity, self.key_sha), "Recovery key changed before restore")
        try:
            self.command.run([self.binary, "--repo", repository, "--password-file", str(self.key), "--no-cache", "--json",
                              "--limit-download", "16384", "restore", snapshot, "--target", target.argument(),
                              "--overwrite", "never", "--verify"], seconds=self.seconds, pass_fds=descriptors)
        except RecoveryError as error:
            raise ResticFailure("isolated-restore", error) from None
        target.argument()
        require(password_file(self.key)[1:] == (self.key_identity, self.key_sha), "Recovery key changed during restore")
        if self.directory is not None:
            self.directory.check()


class Journal:
    def __init__(self, path):
        self.path = absolute(str(path))

    @contextmanager
    def lock(self):
        parent = open_path(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            try:
                os.mkdir(self.path.name, 0o700, dir_fd=parent)
                os.fsync(parent)
            except FileExistsError:
                pass
            descriptor = os.open(self.path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        finally:
            os.close(parent)
        try:
            info = os.fstat(descriptor)
            require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700, "Private owned recovery journal required")
            lock = os.open("target.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
            try:
                lock_info = os.fstat(lock)
                require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_uid == os.geteuid()
                        and stat.S_IMODE(lock_info.st_mode) == 0o600, "Private regular recovery lock required")
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(lock)
                raise RecoveryError("Another recovery operation owns this journal") from None
            except BaseException:
                os.close(lock)
                raise
            self.fd = descriptor
            try:
                yield self
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)
                os.close(lock)
        finally:
            os.close(descriptor)

    def read(self):
        names = sorted(n for n in os.listdir(self.fd) if re.fullmatch(r"[0-9]{4}\.json", n))
        events, previous = [], None
        for number, name in enumerate(names, 1):
            require(name == f"{number:04}.json", "Recovery journal has a phase gap")
            with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.fd), "rb") as source:
                info = os.fstat(source.fileno())
                require(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_METADATA
                        and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600,
                        "Private bounded regular journal phase required")
                row = document(source.read(MAX_METADATA + 1))
            require(set(row) == {"payload", "sha256"} and digest(canonical(row["payload"])) == row["sha256"]
                    and row["payload"].get("previousSha256") == previous, "Recovery journal checksum or chain differs")
            events.append(row["payload"])
            previous = row["sha256"]
        transitions = {None: {"PREPARED"}, "PREPARED": {"BACKUP_INTENT"},
                       "BACKUP_INTENT": {"SNAPSHOT_REPORTED", "UNKNOWN", "RESTORE_INTENT"},
                       "SNAPSHOT_REPORTED": {"RESTORE_INTENT", "UNKNOWN"},
                       "RESTORE_INTENT": {"RESTORE_INTENT", "VERIFIED", "UNKNOWN"},
                       "UNKNOWN": {"RESTORE_INTENT", "UNKNOWN"}, "VERIFIED": set()}
        before = None
        for event in events:
            state = event.get("state")
            require(state in transitions.get(before, set()), "Invalid recovery journal transition")
            before = state
        return events

    def new(self, name, raw):
        require("/" not in name, "Unsafe journal member")
        descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        with os.fdopen(descriptor, "wb") as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
        os.fsync(self.fd)

    def append(self, state, payload):
        events = self.read()
        require(len(events) < 100, "Recovery journal phase budget exceeded")
        value = {"state": state, "previousSha256": digest(canonical(events[-1])) if events else None, **payload}
        self.new(f"{len(events) + 1:04}.json", canonical({"payload": value, "sha256": digest(canonical(value))}))
        return value


def _preflight_paths(observation, journal, primary, reader, target, stack):
    require(primary.key_identity != reader.key_identity, "Readback requires a separate credential file")
    roots = [absolute(p) for p in observation["roots"]]
    target = absolute(str(target))
    require(not target.exists() and not target.is_symlink(), "Restore target must be a new path")
    protected = [journal.path, target, primary.key, reader.key]
    protected.extend(absolute(r.repository) for r in (primary, reader) if r.repository.startswith("/"))
    for index, left in enumerate(protected):
        for right in protected[index + 1:]:
            # Primary and reader may address the same repository, independently.
            if left == right and str(left) in {primary.repository, reader.repository}:
                continue
            require(no_overlap(left, right), "Recovery controls, repository, key and restore paths overlap")
        require(all(no_overlap(left, root) for root in roots), "A recovery control or key is inside captured state")
    for adapter in (primary, reader):
        if adapter.repository.startswith("/"):
            handle = DirectoryHandle(absolute(adapter.repository), private_parent=True)
            stack.callback(handle.close)
            adapter.recovery_directory = handle
            stack.callback(setattr, adapter, "recovery_directory", None)
            if isinstance(adapter, Restic):
                adapter.directory = handle
                stack.callback(setattr, adapter, "directory", None)
    reserved = RestoreTarget(target)
    stack.callback(reserved.close)
    return reserved


def _forbidden_sources(primary, reader):
    identities = {primary.key_identity, reader.key_identity}
    for adapter in (primary, reader):
        handle = getattr(adapter, "recovery_directory", None)
        if handle is not None:
            identities.add(handle.identity)
    return identities


def _verify_restore(target, manifest_path, manifest, inventory, budget):
    restored = scan(inventory["roots"], budget, anchor=target.fd)
    require(restored == inventory, "Restored member bytes, modes or ownership differ")
    with os.fdopen(relative_open(target.fd, manifest_path), "rb") as source:
        require(source.read(MAX_METADATA + 1) == manifest, "Restored recovery manifest differs")


def _finish(plan, journal, observer, primary, reader, target, prepared, snapshot, deadline):
    manifest_path = journal.path / "recovery-manifest.json"
    manifest = read_regular(manifest_path)
    require(digest(manifest) == prepared["manifestSha256"], "Prepared manifest changed")
    value = document(manifest)
    observation = observer.observe(plan)
    require(observation["fingerprint"] == value["coldFingerprint"], "Installation changed after backup intent")
    inventory = value["inventory"]
    budget = {**plan["limits"], "deadline": deadline}
    require(scan(inventory["roots"], budget, forbidden=_forbidden_sources(primary, reader)) == inventory,
            "Captured source changed after backup intent")
    require(primary.repository_id() == reader.repository_id() == plan["repositoryId"], "Readback repository identity differs")
    reader.validate_snapshot(snapshot, value["tag"], manifest_path, manifest, inventory)
    require(os.fstatvfs(target.parent.fd).f_bavail * os.fstatvfs(target.parent.fd).f_frsize
            >= inventory["bytes"] + plan["limits"]["reserveBytes"],
            "Insufficient isolated restore disk reserve")
    target.create()
    journal.append("RESTORE_INTENT", {"planSha256": digest(canonical(plan)), "snapshotId": snapshot,
                                      "manifestSha256": prepared["manifestSha256"],
                                      "restoreTarget": str(target.path),
                                      "restoreTargetDevice": os.fstat(target.fd).st_dev,
                                      "restoreTargetInode": os.fstat(target.fd).st_ino})
    reader.restore(snapshot, target, plan["limits"])
    _verify_restore(target, manifest_path, manifest, inventory, budget)
    require(observer.observe(plan)["fingerprint"] == value["coldFingerprint"]
            and scan(inventory["roots"], budget, forbidden=_forbidden_sources(primary, reader)) == inventory,
            "Installation changed during verification")
    receipt = {"schemaVersion": 1, "kind": "warpdrive-verified-cold-recovery-set", "operationId": plan["operationId"],
               "installationId": plan["installationId"], "repositoryId": plan["repositoryId"], "snapshotId": snapshot,
               "manifestSha256": prepared["manifestSha256"], "coldFingerprint": value["coldFingerprint"],
               "sourceBytes": inventory["bytes"], "sourceEntries": len(inventory["entries"]),
               "scope": observation["scope"], "verifiedAt": int(time.time()), "sourceUnchanged": True,
               "separateCredentialFileReadback": True, "fullRepositoryIntegrityRead": True,
               "isolatedRestoreBytesVerified": True, "offHostAccepted": False, "keyCustodyAccepted": False,
               "applicationRecoveryAccepted": False,
               "writerResumptionAuthorized": False, "limitations": LIMITATIONS}
    journal.append("VERIFIED", {"planSha256": digest(canonical(plan)), "receipt": receipt})
    return receipt


def capture(plan, journal, observer, primary, reader, target, *, reconcile=False):
    validate_plan(plan)
    plan_hash = digest(canonical(plan))
    started = time.monotonic()
    deadline = started + plan["limits"]["seconds"]
    for adapter in (observer, primary, reader):
        if isinstance(getattr(adapter, "command", None), Command):
            adapter.command.deadline = deadline
    with journal.lock(), ExitStack() as stack:
        events = journal.read()
        if events:
            require(all(e.get("planSha256") == plan_hash for e in events), "Recovery plan differs from the retained operation")
            if events[-1]["state"] == "VERIFIED":
                return events[-1]["receipt"]
            require(reconcile, "A retained intent exists; use independent reconciliation, never repeat capture")
            prepared = events[0]
            require(prepared["state"] == "PREPARED", "Incomplete prepared recovery record")
            observation = observer.observe(plan)
            target = _preflight_paths(observation, journal, primary, reader, target, stack)
            ids = reader.find("warpdrive-recovery:" + plan["operationId"])
            if len(ids) != 1:
                raise RecoveryUnknown("No unique manifest-bound snapshot can be reconciled; no write was replayed")
            try:
                return _finish(plan, journal, observer, primary, reader, target, prepared, ids[0], deadline)
            except RecoveryError as error:
                raise RecoveryUnknown("Retained backup remains unverified; keep all writers stopped",
                                      failure=failure_fact(error)) from None
        require(not reconcile, "There is no retained backup intent to reconcile")
        observation = observer.observe(plan)
        target = _preflight_paths(observation, journal, primary, reader, target, stack)
        require(primary.repository_id() == reader.repository_id() == plan["repositoryId"], "Approved repository identity differs")
        journal.new("private-configuration.json", canonical(observation["privateConfiguration"]))
        inventory = scan([*observation["roots"], journal.path / "private-configuration.json"],
                         {**plan["limits"], "deadline": deadline}, forbidden=_forbidden_sources(primary, reader))
        manifest = canonical({"schemaVersion": 1, "kind": "warpdrive-cold-recovery-manifest", "planSha256": plan_hash,
                              "tag": "warpdrive-recovery:" + plan["operationId"], "coldFingerprint": observation["fingerprint"],
                              "members": observation["members"], "inventory": inventory})
        require(len(manifest) <= MAX_METADATA, "Recovery manifest exceeds its bound")
        journal.new("recovery-manifest.json", manifest)
        prepared = journal.append("PREPARED", {"planSha256": plan_hash, "manifestSha256": digest(manifest)})
        require(observer.observe(plan)["fingerprint"] == observation["fingerprint"], "Cold installation changed during preparation")
        journal.append("BACKUP_INTENT", {"planSha256": plan_hash, "manifestSha256": digest(manifest)})
        try:
            snapshot = primary.backup([*inventory["roots"], journal.path / "recovery-manifest.json"],
                                      "warpdrive-recovery:" + plan["operationId"])
            journal.append("SNAPSHOT_REPORTED", {"planSha256": plan_hash, "snapshotId": snapshot})
            require(time.monotonic() - started <= plan["limits"]["seconds"], "Recovery operation deadline exceeded")
            return _finish(plan, journal, observer, primary, reader, target, prepared, snapshot, deadline)
        except BaseException as error:
            failure = failure_fact(error)
            try:
                journal.append("UNKNOWN", {"planSha256": plan_hash, "manifestSha256": digest(manifest), "failure": failure})
            except BaseException:
                pass  # The already-fsynced intent remains authoritative if reporting fails.
            diagnostic = f" [{failure['operation']}:{failure['reason']}]"
            raise RecoveryUnknown("Backup outcome requires independent reconciliation; keep all writers stopped" + diagnostic,
                                  failure=failure) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["capture", "reconcile"])
    for name in ("plan", "state", "restic", "password-file", "readback-password-file", "restore-target", "docker", "pg-controldata"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--readback-repository", required=True)
    args = parser.parse_args()
    try:
        plan = document(read_regular(args.plan))
        validate_plan(plan)
        primary = Restic(args.restic, args.repository, args.password_file, seconds=plan["limits"]["seconds"])
        reader = Restic(args.restic, args.readback_repository, args.readback_password_file, seconds=plan["limits"]["seconds"])
        receipt = capture(plan, Journal(args.state), DockerColdObserver(args.docker, args.pg_controldata), primary, reader,
                          args.restore_target, reconcile=args.action == "reconcile")
        print(json.dumps(receipt, sort_keys=True))
    except (RecoveryError, OSError, ValueError, TypeError, KeyError, AttributeError, UnicodeError):
        print("Recovery held. Inspect the private journal and reconcile; no writer resumption is authorized.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
