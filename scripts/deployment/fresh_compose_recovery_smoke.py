"""Opt-in cold recovery and restart of one owned synthetic Linux Compose fixture.

This coordinator never accepts an installed project or live credentials. Capture
and independent readback retain the production recovery adapters' authority.
Only the fixture's seven long-running services may boot after byte verification;
the three initialization services are not replayed. Any uncertain outcome holds
the remaining resources for reconciliation instead of retrying or deleting them.
"""

import argparse
from contextlib import ExitStack
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import stat
import sys
import tempfile
import time

from fresh_compose_admission import _pinned_images, validate_cgroup_parent, validate_storage_client_bin
from fresh_compose_smoke import (FreshSmoke, LONG_RUNNING, OWNER, SERVICE_PORT, _native_host, _same_except_web,
                                 run_owned_fixture_command)
from installed_web_chain import _directory
from loopback_forwarder import owned_bridge_forwarder
import recovery as r
from registry_smoke import IsolatedDocker
from restore_recovery_set import restore_existing


TOTAL_SECONDS = 1500
CAPTURE_LIMITS = {"files": 20000, "bytes": 1024**3, "fileBytes": 256 * 1024**2,
                  "seconds": 240, "reserveBytes": 2 * 1024**3, "repositoryBytes": 1024**3}
STOP_WAVES = (("caddy",), ("app", "worker", "ws", "newsletter-engine"), ("minio", "postgres"))
START_WAVES = (("postgres", "minio"), ("app", "ws", "worker", "newsletter-engine"), ("caddy",))
LIMITATIONS = [
    "Owned synthetic Linux AMD64 fixture only; no production or customer installation was recovered.",
    "Seeded CRM rows, migration ledger, private object, engine media, health, one worker job and WebSocket rejection only.",
    "No native user/session, mail/provider effect, populated supported-version upgrade or tenant-isolation acceptance.",
    "The retained encrypted repository and separate readback key are on one host; no off-host or separate key custody acceptance.",
    "Only this unique fixture may restart; operator application writer resumption remains unauthorized.",
    "A held/unknown result retains resources and private controls for manual reconciliation; it never retries a mutation.",
]


def _expired(_number, _frame):
    raise r.RecoveryUnknown("Native recovery fixture exceeded its overall deadline")


def _native_root_host():
    _native_host()
    r.require(os.geteuid() == 0, "Native recovery fixture requires root access to local Docker volume paths")


def _private(path, raw):
    _directory(path.parent)
    parent = r.DirectoryHandle(path.parent)
    try:
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent.fd)
        with os.fdopen(descriptor, "wb") as output:
            r.require(output.write(raw) == len(raw), "Incomplete private fixture record")
            output.flush()
            os.fsync(output.fileno())
        parent.check()
        os.fsync(parent.fd)
    finally:
        parent.close()


class Progress:
    """Finite private intent/result record, separate from recovery's capture journal."""

    def __init__(self, directory):
        self.directory = directory
        self.result = {"schemaVersion": 1, "kind": "warpdrive-native-fresh-compose-recovery-smoke",
                       "success": False, "outputDirectory": str(directory), "steps": [],
                       "applicationRecoveryAccepted": False, "offHostAccepted": False, "keyCustodyAccepted": False,
                       "writerResumptionAuthorized": False, "fixtureWritersMayBeRunning": False,
                       "cleanupSuccess": False, "manualReconciliationRequired": True, "limitations": LIMITATIONS}

    def write(self, phase):
        r.require(len(self.result["steps"]) < 32, "Fixture phase record exceeded its bound")
        self.result["phase"] = phase
        self.result["steps"].append(phase)
        path = self.directory / "result.json"
        if os.path.lexists(path):
            info = path.lstat()
            r.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                      and stat.S_IMODE(info.st_mode) == 0o600, "Private fixture result changed")
        temporary = self.directory / (".result-" + secrets.token_hex(8))
        _private(temporary, r.canonical(self.result) + b"\n")
        directory = r.DirectoryHandle(self.directory)
        try:
            os.replace(temporary.name, path.name, src_dir_fd=directory.fd, dst_dir_fd=directory.fd)
            directory.check()
            os.fsync(directory.fd)
        finally:
            directory.close()


def _binary(path, pin):
    path = path.resolve(strict=True)
    descriptor = r.open_path(path)
    try:
        info = os.fstat(descriptor)
        r.require(isinstance(pin, str) and r.HASH.fullmatch(pin) and stat.S_ISREG(info.st_mode)
                  and info.st_nlink == 1 and not info.st_mode & 0o022 and os.access(path, os.X_OK)
                  and 0 < info.st_size <= 128 * 1024**2, "Exact bounded executable and SHA-256 required")
        hasher = sha256()
        remaining = info.st_size
        while remaining:
            raw = os.read(descriptor, min(remaining, 1024**2))
            r.require(raw, "Fixture executable changed during inspection")
            hasher.update(raw)
            remaining -= len(raw)
        after = os.fstat(descriptor)
        r.require(not os.read(descriptor, 1) and os.path.samestat(after, path.lstat())
                  and (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
                  == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                  and hasher.hexdigest() == pin, "Recovery executable differs from its SHA-256")
    finally:
        os.close(descriptor)
    return path


class PinnedCommand(r.Command):
    def __init__(self, pins):
        self.pins = {str(path): pin for path, pin in pins.items()}

    def _run(self, arguments, **options):
        r.require(str(arguments[0]) in self.pins, "Unpinned recovery fixture executable")
        _binary(Path(arguments[0]), self.pins[str(arguments[0])])
        result = super()._run(arguments, **options)
        _binary(Path(arguments[0]), self.pins[str(arguments[0])])
        return result


class FixtureDocker(IsolatedDocker):
    """Use the admitted local context and an exact executable with empty auth config."""

    def __init__(self, config, binary, pin):
        def runner(arguments, **options):
            r.require(arguments[0] == "docker", "Unexpected fixture Docker launcher")
            _binary(binary, pin)
            result = run_owned_fixture_command([str(binary), *arguments[1:]], **options)
            _binary(binary, pin)
            return result
        super().__init__(config, runner=runner)


class ObserverCommand(PinnedCommand):
    """Bind native observer reads to the same real local endpoint, not ambient context."""

    def __init__(self, docker, binary, pg_control, pins, config):
        super().__init__({binary: pins[binary], pg_control: pins[pg_control]})
        self.binary, self.config, self.endpoint = str(binary), str(config), docker.endpoint
        r.require(self.endpoint.startswith("unix:///"), "Local fixture Docker endpoint required")
        config.mkdir(mode=0o700)
        _private(config / "config.json", b"{}\n")
        super().run([self.binary, "--config", self.config, "context", "create", "warpdrive-recovery",
                     "--docker", "host=" + self.endpoint], seconds=10)

    def run(self, arguments, **options):
        if str(arguments[0]) == self.binary:
            tail = arguments[1:]
            prefix = [self.binary, "--config", self.config]
            arguments = ([*prefix, "context", "inspect", "warpdrive-recovery"] if tail == ["context", "inspect"]
                         else [*prefix, "--host", self.endpoint, *tail])
        return super().run(arguments, **options)


class RecoveryFixture(FreshSmoke):
    """A restored fixture deliberately has no initialization-service containers."""

    restored = False

    def _ready_rows(self, phase):
        if not self.restored:
            return super()._ready_rows(phase)
        r.require(phase == "baseline", "Only the captured baseline fixture may restart")
        deadline = time.monotonic() + 60
        while True:
            rows = self._rows()
            r.require(set(rows) == LONG_RUNNING, "Restored fixture contains an initialization or unknown service")
            for name, row in rows.items():
                r.require(row["Image"] == self.images[phase][name] and row["State"]["Running"] is True
                          and row["State"]["Status"] == "running" and row["RestartCount"] == 0,
                          "Restored fixture service identity or state differs")
            health = [rows[name]["State"].get("Health", {}).get("Status") for name in ("postgres", "app", "ws")]
            r.require(all(value in {"starting", "healthy"} for value in health), "Restored fixture healthcheck failed")
            if all(value == "healthy" for value in health):
                return rows
            r.require(time.monotonic() < deadline, "Restored fixture health deadline exceeded")
            time.sleep(0.5)


def _stop(fixture):
    admitted = fixture._ready_rows("baseline")
    witness = fixture._witness(admitted)
    web_stop = None
    evidence = {}
    for wave in STOP_WAVES:
        for service in wave:
            rows = fixture._rows()
            r.require(fixture._witness(rows) == witness, "Fresh recovery runtime changed before stopping")
            row = rows[service]
            r.require(row["State"]["Running"] is True, "Fresh recovery writer was already stopped")
            grace = 75 if service == "worker" else 30
            fixture.docker.run(["stop", "--time", str(grace), row["Id"]], timeout=grace + 10)
            stopped = fixture._rows()
            r.require(fixture._witness(stopped) == witness and stopped[service]["State"]["Running"] is False
                      and stopped[service]["State"]["Status"] == "exited",
                      "Fresh recovery writer did not stop cleanly")
            if stopped[service]["State"]["ExitCode"] == 143 and service == "app":
                web_stop = r.next_web_stop_contract(admitted["app"], project=fixture.project,
                    expected={"id": admitted["app"]["Id"], "imageId": fixture.images["baseline"]["app"]},
                    source_revision=fixture.revisions["baseline"])
            evidence[service] = r.clean_stop_evidence(stopped[service], service=service,
                expected={"id": admitted[service]["Id"], "imageId": admitted[service]["Image"]}, project=fixture.project,
                next_web_stop=web_stop)
    rows = fixture._rows()
    r.require(set(rows) == set(admitted) and fixture._witness(rows) == witness
              and all(r.clean_stop_evidence(row, service=service,
                  expected={"id": admitted[service]["Id"], "imageId": admitted[service]["Image"]}, project=fixture.project,
                  next_web_stop=web_stop) for service, row in rows.items()), "Fresh recovery cold inventory differs")
    fixture.receipt["checks"]["coldStop"] = evidence
    return rows


def _key_command(command, binary, repository, password, *arguments):
    return command.run([str(binary), "--repo", str(repository), "--password-file", str(password),
                        "--no-cache", "--json", *arguments], seconds=30)


def _key_slots(command, binary, repository, password):
    rows = r.document(_key_command(command, binary, repository, password, "key", "list"))
    r.require(type(rows) is list and 1 <= len(rows) <= 2 and all(type(row) is dict
              and isinstance(row.get("id"), str) and r.HASH.fullmatch(row["id"])
              and type(row.get("current")) is bool for row in rows), "Exact fixture key slot inventory required")
    ids, current = {row["id"] for row in rows}, [row["id"] for row in rows if row["current"]]
    r.require(len(ids) == len(rows) and len(current) == 1, "One fixture key slot must authenticate")
    return ids, current[0]


def _initialize_repository(directory, binary, command):
    writer, reader = directory / "writer-password", directory / "readback-password"
    for path in (writer, reader):
        _private(path, (secrets.token_hex(32) + "\n").encode())
    repository = directory / "repository"
    repository.mkdir(mode=0o700)
    _key_command(command, binary, repository, writer, "init", "--repository-version", "2")
    _key_command(command, binary, repository, writer, "key", "add", "--new-password-file", str(reader),
                 "--user", "fixture-reader", "--host", "warpdrive-test")
    slots, writer_id = _key_slots(command, binary, repository, writer)
    read_slots, reader_id = _key_slots(command, binary, repository, reader)
    r.require(slots == read_slots == {writer_id, reader_id} and writer_id != reader_id,
              "Fixture passwords must authenticate independent key slots")
    return repository, writer, reader, writer_id


def _revoke_writer(command, binary, repository, writer, reader, writer_id):
    identity = r.password_file(writer)
    _key_command(command, binary, repository, reader, "key", "remove", writer_id)
    slots, current = _key_slots(command, binary, repository, reader)
    r.require(slots == {current} and current != writer_id, "Fixture writer slot revocation differs")
    try:
        _key_command(command, binary, repository, writer, "cat", "config")
    except r.RecoveryCommandFailure as error:
        r.require(error.exit_code == 12, "Revoked writer failed for an unknown reason")
    else:
        raise r.RecoveryError("Revoked writer still authenticates")
    r.require(r.password_file(writer) == identity, "Fixture writer key file changed")
    writer.unlink()


def _plan(fixture, rows, repository_id):
    r.require(set(rows) == set(fixture.refs["baseline"]) and fixture.configuration_pins,
              "Complete prepared fresh fixture inventory required")
    fixture._verify_configuration()
    plan = {"schemaVersion": 1, "kind": "warpdrive-cold-recovery-set", "operationId": "fresh-cold-" + secrets.token_hex(12),
            "installationId": fixture.project, "project": fixture.project,
            "containers": {name: {"id": row["Id"], "imageId": row["Image"]} for name, row in rows.items()},
            "volumes": {role: fixture.project + "_" + logical for role, logical in r.VOLUMES.items()},
            "configurationFiles": [str(fixture.directory)], "repositoryId": repository_id, "limits": dict(CAPTURE_LIMITS)}
    r.require(set(plan["volumes"].values()) == fixture.volume_names, "Exact five fixture volumes required")
    r.validate_plan(plan)
    return plan


def _media(fixture, *, seed=False):
    path = "/listmonk/uploads/recovery-" + fixture.seed + ".txt"
    payload = b"fresh recovery media " + fixture.seed.encode()
    row = fixture._rows()["newsletter-engine"]
    if seed:
        fixture.docker.run(["exec", "-i", row["Id"], "sh", "-ec", 'umask 077; test ! -e "$1"; cat > "$1"', "sh", path],
                           timeout=10, input_bytes=payload)
    r.require(fixture.docker.run(["exec", row["Id"], "cat", path], timeout=10).stdout.encode() == payload,
              "Fresh recovery engine media differs")


def _remove_tree(path):
    """Only an admitted private, owned scratch tree; never Docker data paths."""
    _directory(path.parent)
    _directory(path)
    with ExitStack() as stack:
        parent = r.DirectoryHandle(path.parent)
        stack.callback(parent.close)
        child = r.DirectoryHandle(path)
        stack.callback(child.close)
        parent.check()
        child.check()
        r.require(shutil.rmtree.avoids_symlink_attacks, "Descriptor-safe fixture deletion required")
        shutil.rmtree(path.name, dir_fd=parent.fd)
        parent.check()
        r.require(not os.path.lexists(path), "Private source tree remains")
        os.fsync(parent.fd)


def _runtime_inventory(manifest, roots):
    roots = sorted((str(r.absolute(str(path))) for path in roots), key=lambda value: (len(Path(value).parts), value))
    inventory = manifest["inventory"]
    entries = [entry for entry in inventory["entries"]
               if any(r.absolute(entry["path"]).is_relative_to(Path(root)) for root in roots)]
    r.require({entry["path"] for entry in entries if entry["path"] in roots} == set(roots),
              "Restored runtime roots are not in the verified inventory")
    return {"roots": roots, "entries": entries, "bytes": sum(entry.get("bytes", 0) for entry in entries)}


def _open_relative(anchor, path, flags=os.O_RDONLY):
    r.require(not path.is_absolute() and ".." not in path.parts, "Relative fixture destination required")
    return r.relative_open(anchor, Path("/") / path, flags) if path.parts else os.dup(anchor)


def _copy_verified_root(quarantine, root, inventory):
    """Copy a verified regular tree into one new, empty fixture volume/config root."""
    with ExitStack() as stack:
        target = r.DirectoryHandle(root)
        stack.callback(target.close)
        source = r.DirectoryHandle(quarantine)
        stack.callback(source.close)
        r.require(not os.listdir(target.fd), "Restored fixture destination must be empty")
        rows = [row for row in inventory["entries"] if Path(row["path"]).is_relative_to(root)]
        r.require(rows and any(row["path"] == str(root) and row["kind"] == "directory" for row in rows),
                  "Verified directory root required")
        directories = []
        for row in sorted(rows, key=lambda row: (len(Path(row["path"]).parts), row["path"])):
            path = Path(row["path"])
            relative = path.relative_to(root)
            r.require(not row["mode"] & 0o7000, "Special permission bits are unsupported in this fixture")
            if path == root:
                directories.append(row)
                continue
            parent_path = root / relative.parent
            parent = _open_relative(target.fd, relative.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                if row["kind"] == "directory":
                    os.mkdir(path.name, 0o700, dir_fd=parent)
                    directories.append(row)
                else:
                    original = r.relative_open(source.fd, path)
                    descriptor = None
                    try:
                        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
                        info = os.fstat(original)
                        r.require(stat.S_ISREG(info.st_mode) and info.st_size == row["bytes"] and info.st_nlink == 1
                                  and (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)
                                  == (row["mode"], row["uid"], row["gid"]), "Quarantine file changed")
                        hasher, remaining = sha256(), row["bytes"]
                        while remaining:
                            data = os.read(original, min(remaining, 1024**2))
                            r.require(data, "Incomplete quarantine member")
                            hasher.update(data)
                            offset = 0
                            while offset < len(data):
                                count = os.write(descriptor, data[offset:])
                                r.require(count > 0, "Restored fixture write made no progress")
                                offset += count
                            remaining -= len(data)
                        r.require(not os.read(original, 1) and hasher.hexdigest() == row["sha256"], "Quarantine bytes changed")
                        if (os.fstat(descriptor).st_uid, os.fstat(descriptor).st_gid) != (row["uid"], row["gid"]):
                            os.fchown(descriptor, row["uid"], row["gid"])
                        os.fchmod(descriptor, row["mode"])
                        os.fsync(descriptor)
                    finally:
                        if descriptor is not None:
                            os.close(descriptor)
                        os.close(original)
                r.require(os.path.samestat(os.fstat(parent), parent_path.lstat()), "Fixture destination parent changed")
                os.fsync(parent)
            finally:
                os.close(parent)
        for row in reversed(directories):
            descriptor = _open_relative(target.fd, Path(row["path"]).relative_to(root), os.O_RDONLY | os.O_DIRECTORY)
            try:
                if (os.fstat(descriptor).st_uid, os.fstat(descriptor).st_gid) != (row["uid"], row["gid"]):
                    os.fchown(descriptor, row["uid"], row["gid"])
                os.fchmod(descriptor, row["mode"])
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        target.check()
        source.check()


def _volume_roots(fixture, plan):
    """Create only the absent original fixture names, checking local Docker ownership."""
    fixture._require_empty()
    info = fixture.docker.json(["info", "--format", "{{json .}}"], timeout=10)
    r.require(info.get("OSType") == "linux", "Local Linux storage required")
    docker_root = r.absolute(info.get("DockerRootDir"))
    result = {}
    for role, logical in r.VOLUMES.items():
        name = plan["volumes"][role]
        actual = fixture.docker.run(["volume", "create", "--driver", "local", "--label", OWNER + "=" + fixture.project,
                                    "--label", "com.docker.compose.volume=" + logical, name], timeout=10).stdout.strip()
        r.require(actual == name, "Restored fixture volume creation is unresolved")
        row, = fixture.docker.json(["volume", "inspect", name], timeout=10)
        path = r.absolute(row.get("Mountpoint"))
        r.require(row.get("Name") == name and row.get("Driver") == "local" and row.get("Scope") == "local"
                  and not row.get("Options") and row.get("Labels", {}).get(OWNER) == fixture.project
                  and row["Labels"].get("com.docker.compose.volume") == logical
                  and path.is_relative_to(docker_root) and path.name == "_data", "Restored volume authority differs")
        fixture._verify_volume(name, allowed=set())
        r.require(not list(path.iterdir()), "Restored fixture volume is not empty")
        result[role] = path
    r.require(len(set(result.values())) == len(r.VOLUMES), "Restored fixture volume paths alias")
    return result


def _topology(row):
    config = deepcopy(row["Config"])
    config.pop("Hostname", None)  # Docker assigns the new full container identity.
    labels = config.get("Labels")
    r.require(labels is None or type(labels) is dict, "Restored fixture labels are invalid")
    if labels is not None and "com.docker.compose.replace" in labels:
        replaced = labels.pop("com.docker.compose.replace")
        r.require(isinstance(replaced, str) and r.HASH.fullmatch(replaced), "Compose replacement identity is invalid")
        # Compose retains this old-container marker after a Web replacement;
        # the independently restored project creates a new container directly.
    return {"imageId": row["Image"], "config": config, "hostConfig": row["HostConfig"],
            "mounts": sorted(row["Mounts"], key=lambda mount: mount["Destination"])}


def _restart(fixture, before, ledger, inventory, budget):
    fixture.compose("baseline", "up", "--no-start", "--no-deps", "--no-build", "--pull", "never", *sorted(LONG_RUNNING))
    created = fixture._rows()
    r.require(set(created) == LONG_RUNNING, "Restored fixture must not recreate initialization services")
    for service, row in created.items():
        r.require(row["Id"] != before[service]["Id"] and row["State"]["Status"] == "created"
                  and row["State"]["Running"] is False and row["RestartCount"] == 0
                  and _topology(row) == _topology(before[service]), "Restored container topology differs from captured fixture")
    for name in fixture.volume_names:
        fixture._verify_volume(name, allowed={row["Id"] for row in created.values()})
    r.require(r.scan(inventory["roots"], budget, single_link=True) == inventory,
              "Fixture container creation changed restored bytes or metadata")
    fixture.restored = True
    for wave in START_WAVES:
        for service in wave:
            row = fixture._rows()[service]
            r.require(row["Id"] == created[service]["Id"] and row["State"]["Running"] is False,
                      "Restored fixture identity changed before start")
            fixture.docker.run(["start", row["Id"]], timeout=15)
        if "postgres" in wave:
            deadline = time.monotonic() + 40
            while fixture.docker.run(["exec", created["postgres"]["Id"], "pg_isready", "-h", "127.0.0.1", "-U", "smoke",
                                     "-d", "warpdrive_image_smoke"], timeout=4, check=False).returncode != 0:
                r.require(time.monotonic() < deadline, "Restored PostgreSQL readiness deadline exceeded")
                time.sleep(0.5)
    name = fixture._rows()["caddy"]["Name"].removeprefix("/")
    with owned_bridge_forwarder(fixture.docker, owner_label=OWNER, owner=fixture.project, network_name=fixture.network,
                                container_name=name, port=SERVICE_PORT, max_connections=4) as relay:
        readiness = fixture._baseline_readiness()
        _, observed = fixture._observe(relay, "baseline")
        r.require(observed == ledger, "Recovered migration ledger differs")
        _media(fixture)
    return {"databaseAndObjectContinuity": True, "engineMediaContinuity": True,
            "migrationLedgerUnchanged": True, "initializationServicesReplayed": False, **readiness}


def _recover(fixture, directory, restic, pg_control, docker_binary, pins, progress):
    result = progress.result
    progress.write("source-stop-intent")
    rows = _stop(fixture)
    result.update(sourceWritersStopped=True, fixtureWritersMayBeRunning=False)
    progress.write("source-cold")
    command = PinnedCommand({restic: pins[restic]})
    repository, writer, reader_key, writer_id = _initialize_repository(directory, restic, command)
    primary = r.Restic(restic, str(repository), writer, command=PinnedCommand({restic: pins[restic]}), seconds=CAPTURE_LIMITS["seconds"])
    reader = r.Restic(restic, str(repository), reader_key, command=PinnedCommand({restic: pins[restic]}), seconds=CAPTURE_LIMITS["seconds"])
    plan = _plan(fixture, rows, primary.repository_id())
    journal = r.Journal(directory / "capture")
    _private(directory / "plan.json", r.canonical(plan))
    observer = r.DockerColdObserver(docker_binary, pg_control,
        ObserverCommand(fixture.docker, docker_binary, pg_control, pins, directory / "observer-docker"),
        next_web_stop=(r.next_web_stop_contract(rows["app"], project=fixture.project, expected=plan["containers"]["app"],
            source_revision=fixture.revisions["baseline"]) if rows["app"]["State"]["ExitCode"] == 143 else None))
    progress.write("cold-capture-intent")
    receipt = r.capture(plan, journal, observer, primary, reader, directory / "capture-restore")
    member = journal.path / "recovery-manifest.json"
    raw_manifest, raw_receipt = r.read_regular(member), r.canonical(receipt)
    manifest = r.document(raw_manifest)
    receipt_path, manifest_path = directory / "verified-receipt.json", directory / "verified-manifest.json"
    _private(receipt_path, raw_receipt)
    _private(manifest_path, raw_manifest)
    progress.write("writer-revocation-intent")
    _revoke_writer(command, restic, repository, writer, reader_key, writer_id)
    result["writerSlotRevoked"] = True
    progress.write("source-removal-intent")
    fixture.cleanup()  # All selected containers have already been proven cleanly stopped.
    r.require(all(not os.path.lexists(path) for path in manifest["members"].values()), "Original Docker volume paths remain")
    for path in (fixture.directory, journal.path, directory / "capture-restore"):
        _remove_tree(path)
    r.require(not writer.exists() and not os.path.lexists(member)
              and all(not os.path.lexists(path) for path in manifest["inventory"]["roots"]), "Original recovery sources remain")
    result["sourceAbsentAtIndependentRestore"] = True
    progress.write("independent-restore-intent")
    quarantine = directory / "quarantine"
    restored = restore_existing(receipt_path, expected_receipt_sha256=r.digest(raw_receipt), manifest_path=manifest_path,
        original_manifest_member=member,
        reader=r.Restic(restic, str(repository), reader_key, command=PinnedCommand({restic: pins[restic]}),
                        seconds=CAPTURE_LIMITS["seconds"]), restore_target=quarantine, budget=plan["limits"])
    r.require(restored["snapshotId"] == receipt["snapshotId"] and restored["isolatedRestoreBytesVerified"] is True
              and restored["writerResumptionAuthorized"] is False, "Fresh independent restore readback differs")
    _private(directory / "independent-restore.json", r.canonical(restored))
    progress.write("fixture-materialization-intent")
    volumes = _volume_roots(fixture, plan)
    r.require({role: str(path) for role, path in volumes.items()} == manifest["members"],
              "Recreated fixture volume mountpoints differ from the verified sources")
    fixture.directory.mkdir(mode=0o700)
    inventory = _runtime_inventory(manifest, [fixture.directory, *volumes.values()])
    for root in map(Path, inventory["roots"]):
        _copy_verified_root(quarantine, root, inventory)
    r.require(r.scan(inventory["roots"], plan["limits"], single_link=True) == inventory,
              "Materialized fixture bytes, modes or ownership differ")
    fixture._verify_configuration()
    result["fixtureWritersMayBeRunning"] = True  # A start acknowledgement may be lost.
    progress.write("fixture-restart-intent")
    restarted = _restart(fixture, rows, fixture.receipt["checks"]["baseline"]["migrationLedger"], inventory, plan["limits"])
    result["restartedFixtureChecks"] = restarted
    progress.write("recovered-stop-intent")
    _stop(fixture)
    result["fixtureWritersMayBeRunning"] = False
    progress.write("owned-cleanup-intent")
    fixture.cleanup()
    _remove_tree(fixture.directory)
    result["cleanupSuccess"] = True
    return {"snapshotId": receipt["snapshotId"], "manifestSha256": receipt["manifestSha256"],
            "receiptSha256": r.digest(raw_receipt), "restoredBytes": restored["verifiedBytes"],
            "restoredEntries": restored["verifiedEntries"], "isolatedRestoreBytesVerified": True,
            "restartedSyntheticServicesQualified": True}


def run(baseline, candidate, *, restic, restic_pin, pg_control, pg_control_pin, output_parent,
        storage_client_bin="mc", cgroup_parent=None):
    validate_storage_client_bin(storage_client_bin)
    validate_cgroup_parent(cgroup_parent)
    _native_root_host()
    _directory(output_parent)
    _same_except_web({"services": {name: {"image": ref} for name, ref in baseline.items()}},
                     {"services": {name: {"image": ref} for name, ref in candidate.items()}})
    restic, pg_control = _binary(restic, restic_pin), _binary(pg_control, pg_control_pin)
    docker = shutil.which("docker")
    r.require(docker is not None, "Local Docker CLI required")
    docker_binary = Path(docker).resolve(strict=True)
    docker_pin = r.digest(r.read_regular(docker_binary, maximum=128 * 1024**2))
    pins = {restic: restic_pin, pg_control: pg_control_pin, docker_binary: docker_pin}
    command = PinnedCommand({restic: restic_pin})
    r.require(command.run([str(restic), "version"], maximum=4096).startswith(b"restic 0.18.0 "),
              "Recovery fixture requires the qualified Restic 0.18.0")
    free = os.statvfs(output_parent)
    r.require(free.f_bavail * free.f_frsize >= 4 * CAPTURE_LIMITS["bytes"] + CAPTURE_LIMITS["reserveBytes"],
              "Native recovery scratch capacity is insufficient")
    directory = Path(tempfile.mkdtemp(prefix="wd-fresh-recovery-", dir=output_parent)).resolve()
    directory.chmod(0o700)
    source = directory / "source"
    source.mkdir(mode=0o700)
    progress = Progress(directory)
    progress.result["storageClientBin"] = storage_client_bin
    if cgroup_parent is not None:
        progress.result["cgroupParent"] = cgroup_parent
    started = time.monotonic()
    handler = signal.signal(signal.SIGALRM, _expired)
    signal.alarm(TOTAL_SECONDS)
    try:
        progress.write("admission")
        fixture = RecoveryFixture(FixtureDocker(directory / "docker", docker_binary, docker_pin), source, baseline, candidate,
                                  storage_client_bin=storage_client_bin, cgroup_parent=cgroup_parent)
        progress.result["project"] = fixture.project
        fixture._preloaded()
        fixture.prepare()
        fixture._require_empty()
        progress.result["fixtureWritersMayBeRunning"] = True
        progress.write("fresh-runtime-intent")
        fixture.exercise()
        _media(fixture, seed=True)
        progress.result["freshRuntimeChecks"] = fixture.receipt["checks"]
        progress.result["recovery"] = _recover(fixture, directory, restic, pg_control, docker_binary, pins, progress)
        for binary, pin in pins.items():
            _binary(binary, pin)
        progress.result.update(success=True, manualReconciliationRequired=False)
        progress.write("qualified")
    except (Exception, KeyboardInterrupt) as error:
        progress.result.update(failure=type(error).__name__, failureFact=r.failure_fact(error), success=False,
                               manualReconciliationRequired=True)
        progress.write("held")
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, handler)
        progress.result["durationSeconds"] = round(time.monotonic() - started, 3)
        progress.write("complete" if progress.result["success"] else "held-final")
    return progress.result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-native", action="store_true", required=True)
    parser.add_argument("--storage-client-bin", choices=("mc", "mcli"), default="mc")
    parser.add_argument("--cgroup-parent")
    for phase in ("baseline", "candidate"):
        parser.add_argument(f"--{phase}-env", required=True, type=Path)
        parser.add_argument(f"--{phase}-env-sha256", required=True)
    for name in ("restic", "pg-controldata", "output-parent"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("restic", "pg-controldata"):
        parser.add_argument("--" + name + "-sha256", required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        result = run(_pinned_images(args.baseline_env, args.baseline_env_sha256, storage_client_bin=args.storage_client_bin),
            _pinned_images(args.candidate_env, args.candidate_env_sha256, storage_client_bin=args.storage_client_bin),
            restic=args.restic, restic_pin=args.restic_sha256, pg_control=args.pg_controldata,
            pg_control_pin=args.pg_controldata_sha256, output_parent=args.output_parent, storage_client_bin=args.storage_client_bin,
            cgroup_parent=args.cgroup_parent)
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__, "failureFact": r.failure_fact(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
