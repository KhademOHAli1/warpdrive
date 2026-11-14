"""Failure-focused recovery tests; the opt-in crypto case uses owned synthetic files."""
from __future__ import annotations

import ast
import copy
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import sys
import tempfile
import time
import tracemalloc
import unittest
from unittest.mock import patch

import recovery as r


def put(path, value, mode=0o600):
    """Write generated fixture bytes through owned, no-follow file authority.

    Keys/markers intentionally remain visible dataflow inputs to the encryption
    test. No caller-supplied installation or user secret is accepted by Fixture.
    """
    path = r.absolute(str(path))
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    private_ancestor = False
    try:
        for part in path.parts[1:-1]:
            try:
                os.mkdir(part, 0o700, dir_fd=parent)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
            metadata = os.fstat(parent)
            private_ancestor |= metadata.st_uid == os.geteuid() and stat.S_IMODE(metadata.st_mode) == 0o700
        r.require(private_ancestor, "Fixture writes require an owned private ancestor")
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
        try:
            metadata = os.fstat(descriptor)
            r.require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.geteuid() and metadata.st_nlink == 1,
                      "Fixture writes require an owned single-link regular file")
            # Restrict an existing file before truncation or any new payload byte.
            os.fchmod(descriptor, 0o600)
            os.ftruncate(descriptor, 0)
            offset = 0
            while offset < len(value):
                written = os.write(descriptor, value[offset:])
                r.require(written > 0, "Fixture write made no progress")
                offset += written
            os.fchmod(descriptor, mode)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent)


class FixtureFileAuthorityTests(unittest.TestCase):
    def test_restricts_before_payload_even_with_permissive_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "fixture-key"
            observed = []
            write = os.write
            def checked_write(descriptor, value):
                observed.append(stat.S_IMODE(os.fstat(descriptor).st_mode))
                return write(descriptor, value)
            previous = os.umask(0)
            try:
                with patch("os.write", checked_write):
                    put(path, b"generated-only-fixture-value")
            finally:
                os.umask(previous)
            self.assertTrue(observed)
            self.assertEqual(set(observed), {0o600})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            path.chmod(0o644)
            with patch("os.write", checked_write):
                put(path, b"replacement-generated-only-value")
            self.assertEqual(set(observed), {0o600})

    def test_rejects_leaf_and_ancestor_symlinks_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            original = root / "original"
            put(original, b"preserve")
            leaf = root / "leaf"
            leaf.symlink_to(original)
            with self.assertRaises(OSError):
                put(leaf, b"replace")
            outside = root / "outside"
            outside.mkdir(mode=0o700)
            alias = root / "alias"
            alias.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(OSError):
                put(alias / "new" / "value", b"escape")
            self.assertEqual(original.read_bytes(), b"preserve")
            self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_hard_links_before_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            original = root / "original"
            put(original, b"preserve")
            linked = root / "linked"
            os.link(original, linked)
            with self.assertRaises(r.RecoveryError):
                put(linked, b"replace")
            self.assertEqual(original.read_bytes(), b"preserve")


class Fixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="warpdrive-recovery-unit-")
        self.root = Path(self.temporary.name).resolve()
        self.members = {}
        for name in r.VOLUMES:
            member = self.root / "source" / name
            member.mkdir(parents=True, mode=0o700)
            member.chmod(0o700)
            put(member / "synthetic.data", ("synthetic " + name).encode())
            self.members[name] = str(member)
        self.configuration = self.root / "configuration" / "accepted.json"
        put(self.configuration, b'{"acceptedImageId":"synthetic-only"}')
        self.secret = b"SYNTHETIC_RECOVERY_SECRET_" + secrets.token_hex(24).encode()
        put(self.root / "source" / "postgres" / "encrypted-record.data", self.secret)
        self.plan = {
            "schemaVersion": 1, "kind": "warpdrive-cold-recovery-set", "operationId": "fixture-a",
            "installationId": "synthetic-only", "project": "synthetic",
            "containers": {name: {"id": f"{i:064x}", "imageId": "sha256:" + f"{i + 20:064x}"}
                           for i, name in enumerate(sorted(r.REQUIRED_SERVICES | {"migrate"}), 1)},
            "volumes": {name: "synthetic_" + logical for name, logical in r.VOLUMES.items()},
            "configurationFiles": [str(self.configuration)], "repositoryId": "a" * 64,
            "limits": {**r.DEFAULT_LIMITS, "bytes": 2 * 1024**2, "fileBytes": 2 * 1024**2,
                       "seconds": 90, "reserveBytes": 1024**2, "repositoryBytes": 16 * 1024**2},
        }
        self.keys = [self.root / "key-primary", self.root / "key-readback"]
        password = secrets.token_hex(32).encode() + b"\n"
        for key in self.keys:
            put(key, password)
        self.repo = self.root / "repository"
        self.repo.mkdir()
        self.journal = r.Journal(self.root / "state")
        self.observer = Observer(self)
        self.store = Store(self)
        self.primary = FakeRestic(self, 0)
        self.reader = FakeRestic(self, 1)

    def capture(self, *, reconcile=False, target=None):
        return r.capture(self.plan, self.journal, self.observer, self.primary, self.reader,
                         target or self.root / "restore", reconcile=reconcile)

    def close(self):
        self.temporary.cleanup()
        if self.root.exists():
            raise AssertionError("Owned recovery fixture directory remains")


class Observer:
    def __init__(self, fixture):
        self.fixture, self.fingerprint, self.blocked = fixture, "b" * 64, False

    def observe(self, plan):
        r.require(not self.blocked, "A synthetic writer is running")
        return {"roots": [*self.fixture.members.values(), str(self.fixture.configuration)],
                "members": self.fixture.members, "fingerprint": self.fingerprint,
                "privateConfiguration": {"syntheticSecret": self.fixture.secret.decode()},
                "scope": "owned-synthetic-file-fixture-not-installation"}


class Store:
    def __init__(self, fixture):
        self.fixture, self.snapshots, self.backups = fixture, {}, 0
        self.fail_after_write, self.mutate = False, None


class FakeRestic:
    def __init__(self, fixture, key):
        self.fixture, self.store = fixture, fixture.store
        self.repository = str(fixture.repo)
        self.key, self.key_identity, self.key_sha = r.password_file(fixture.keys[key])
        self.repo_id, self.restore_failure, self.validation_failure = "a" * 64, False, False

    def repository_id(self):
        return self.repo_id

    def backup(self, paths, tag):
        self.store.backups += 1
        identifier = f"{self.store.backups:064x}"
        inventory = r.scan(paths, self.fixture.plan["limits"])
        self.store.snapshots[identifier] = {
            "tag": tag, "paths": [str(p) for p in paths], "inventory": inventory,
            "files": {entry["path"]: Path(entry["path"]).read_bytes()
                      for entry in inventory["entries"] if entry["kind"] == "file"},
        }
        if self.store.mutate:
            self.store.mutate()
        if self.store.fail_after_write:
            raise r.RecoveryError("Synthetic lost acknowledgement")
        return identifier

    def find(self, tag):
        return [key for key, value in self.store.snapshots.items() if value["tag"] == tag]

    def validate_snapshot(self, snapshot, tag, path, manifest, inventory):
        r.require(not self.validation_failure, "Synthetic corrupt snapshot")
        record = self.store.snapshots[snapshot]
        r.require(record["tag"] == tag and record["files"][str(path)] == manifest, "Synthetic snapshot binding differs")

    def restore(self, snapshot, target, budget, *, inventory):
        r.require(not self.restore_failure, "Synthetic restore failed")
        record = self.store.snapshots[snapshot]
        for entry in sorted(record["inventory"]["entries"], key=lambda value: len(Path(value["path"]).parts)):
            path = target / entry["path"].lstrip("/")
            if entry["kind"] == "directory":
                path.mkdir(parents=True, exist_ok=True)
                path.chmod(entry["mode"])
            else:
                put(path, record["files"][entry["path"]], entry["mode"])


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.close)

    def test_capture_verifies_all_members_but_never_claims_offhost_or_resumes(self):
        receipt = self.fixture.capture()
        self.assertTrue(receipt["isolatedRestoreBytesVerified"])
        self.assertFalse(receipt["offHostAccepted"])
        self.assertFalse(receipt["keyCustodyAccepted"])
        self.assertFalse(receipt["writerResumptionAuthorized"])
        self.assertTrue(receipt["separateCredentialFileReadback"])
        self.assertNotIn("independentCredentialReadback", receipt)
        self.assertEqual(receipt["scope"], "owned-synthetic-file-fixture-not-installation")
        self.assertEqual(self.fixture.store.backups, 1)
        self.assertEqual(self.fixture.capture(), receipt)
        self.assertEqual(self.fixture.store.backups, 1)

    def test_running_writer_blocks_before_any_backup(self):
        self.fixture.observer.blocked = True
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)

    def test_finite_restic_failure_stays_unknown_and_never_replays_the_write(self):
        backup = self.fixture.primary.backup
        def failed_after_write(paths, tag):
            backup(paths, tag)
            raise r.ResticFailure("snapshot-write", r.RecoveryCommandFailure(1))
        self.fixture.primary.backup = failed_after_write
        with self.assertRaisesRegex(r.RecoveryUnknown, "snapshot-write:command-nonzero") as failure:
            self.fixture.capture()
        self.assertEqual(r.failure_fact(failure.exception), {"operation": "snapshot-write", "reason": "command-nonzero", "exitCode": 1})
        with self.fixture.journal.lock():
            retained = self.fixture.journal.read()[-1]
        self.assertEqual(retained["state"], "UNKNOWN")
        self.assertEqual(retained["failure"], {"operation": "snapshot-write", "reason": "command-nonzero", "exitCode": 1})
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 1)

    def test_missing_member_and_extra_plan_key_rejected(self):
        for mutate in (lambda p: p["volumes"].pop("objects"), lambda p: p.update(stopped=True)):
            plan = copy.deepcopy(self.fixture.plan)
            mutate(plan)
            with self.assertRaises(r.RecoveryError):
                r.validate_plan(plan)

    def test_lost_ack_is_reconciled_without_repeating_backup(self):
        self.fixture.store.fail_after_write = True
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 1)
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        receipt = self.fixture.capture(reconcile=True, target=self.fixture.root / "reconciled")
        self.assertTrue(receipt["isolatedRestoreBytesVerified"])
        self.assertEqual(self.fixture.store.backups, 1)

    def test_absent_or_ambiguous_snapshot_never_retries_a_write(self):
        self.fixture.store.fail_after_write = True
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        saved = copy.deepcopy(self.fixture.store.snapshots)
        self.fixture.store.snapshots.clear()
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture(reconcile=True)
        self.fixture.store.snapshots = saved
        self.fixture.store.snapshots["c" * 64] = copy.deepcopy(next(iter(saved.values())))
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture(reconcile=True)
        self.assertEqual(self.fixture.store.backups, 1)

    def test_source_change_after_backup_holds_restore_and_replay(self):
        self.fixture.store.mutate = lambda: put(Path(self.fixture.members["objects"]) / "new-object", b"late write")
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        self.assertFalse((self.fixture.root / "restore").exists())
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture(reconcile=True)
        self.assertEqual(self.fixture.store.backups, 1)

    def test_restart_identity_change_blocks_reconciliation(self):
        self.fixture.store.fail_after_write = True
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        self.fixture.observer.fingerprint = "d" * 64
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture(reconcile=True)

    def test_wrong_repository_and_existing_target_do_not_write(self):
        self.fixture.reader.repo_id = "c" * 64
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)
        self.fixture.reader.repo_id = "a" * 64
        (self.fixture.root / "restore").mkdir()
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)

    def test_keys_cannot_be_inside_captured_sources_or_reused_by_inode(self):
        self.fixture.primary.key = Path(self.fixture.members["postgres"]) / "forbidden-key"
        put(self.fixture.primary.key, secrets.token_hex(32).encode())
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)

    def test_same_key_inode_is_not_independent_readback(self):
        self.fixture.reader.key_identity = self.fixture.primary.key_identity
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()

    def test_a_hardlinked_backup_key_cannot_enter_the_recovery_set(self):
        os.link(self.fixture.keys[0], Path(self.fixture.members["objects"]) / "hidden-key")
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)

    def test_repository_alias_into_source_and_restore_parent_alias_do_not_write(self):
        alias = self.fixture.root / "repo-alias"
        alias.symlink_to(self.fixture.members["objects"], target_is_directory=True)
        self.fixture.primary.repository = str(alias)
        self.fixture.reader.repository = str(alias)
        with self.assertRaises(OSError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)
        self.fixture.primary.repository = self.fixture.reader.repository = str(self.fixture.repo)
        parent_alias = self.fixture.root / "restore-parent-alias"
        parent_alias.symlink_to(self.fixture.members["objects"], target_is_directory=True)
        with self.assertRaises(OSError):
            self.fixture.capture(target=parent_alias / "new-restore")
        self.assertEqual(self.fixture.store.backups, 0)

    def test_restore_parent_substitution_after_intent_cannot_write_into_source(self):
        parent = self.fixture.root / "restore-parent"
        parent.mkdir(mode=0o700)
        moved = self.fixture.root / "old-restore-parent"
        def substitute():
            parent.rename(moved)
            parent.symlink_to(self.fixture.members["objects"], target_is_directory=True)
        self.fixture.store.mutate = substitute
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture(target=parent / "new-restore")
        self.assertFalse((Path(self.fixture.members["objects"]) / "new-restore").exists())

    def test_password_requires_safe_owned_mode_and_no_symlink(self):
        key = self.fixture.keys[0]
        key.chmod(0o644)
        with self.assertRaises(r.RecoveryError):
            r.password_file(key)
        key.chmod(0o600)
        alias = self.fixture.root / "alias"
        alias.symlink_to(key)
        with self.assertRaises(OSError):
            r.password_file(alias)

    def test_symlink_and_fifo_sources_reject_without_opening(self):
        root = Path(self.fixture.members["objects"])
        alias = root / "alias"
        alias.symlink_to(self.fixture.keys[0])
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        alias.unlink()
        self.fixture.journal = r.Journal(self.fixture.root / "fifo-state")
        os.mkfifo(root / "fifo")
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)

    def test_file_and_byte_limits_hold_before_mutation(self):
        self.fixture.plan["limits"]["bytes"] = 16
        self.fixture.plan["limits"]["fileBytes"] = 16
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.assertEqual(self.fixture.store.backups, 0)

    def test_failed_restore_is_quarantined_and_reconciliation_uses_new_target(self):
        self.fixture.reader.restore_failure = True
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        target = self.fixture.root / "restore"
        self.assertTrue(target.exists())
        self.fixture.reader.restore_failure = False
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture(reconcile=True)
        receipt = self.fixture.capture(reconcile=True, target=self.fixture.root / "fresh-restore")
        self.assertTrue(receipt["sourceUnchanged"])
        self.assertEqual(self.fixture.store.backups, 1)

    def test_actual_partial_stream_failure_is_unknown_and_reconciles_without_backup_replay(self):
        restore = self.fixture.reader.restore
        def failed_stream(snapshot, target, budget, *, inventory):
            descriptor = os.open("partial", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=target.fd)
            try:
                r.Command().stream([sys.executable, "-c", "import sys;sys.stdout.buffer.write(b'abc');raise SystemExit(3)"],
                                   descriptor, expected_bytes=3, expected_sha256=r.digest(b"abc"))
            finally:
                os.close(descriptor)
        self.fixture.reader.restore = failed_stream
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        self.assertEqual((self.fixture.root / "restore/partial").read_bytes(), b"abc")
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture()
        self.fixture.reader.restore = restore
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture(reconcile=True)
        self.assertTrue(self.fixture.capture(reconcile=True, target=self.fixture.root / "fresh-stream-target")["sourceUnchanged"])
        self.assertEqual(self.fixture.store.backups, 1)

    def test_manifest_and_journal_tampering_prevent_replay(self):
        self.fixture.store.fail_after_write = True
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        manifest = self.fixture.journal.path / "recovery-manifest.json"
        manifest.write_bytes(b"{}")
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture(reconcile=True)
        phase = self.fixture.journal.path / "0001.json"
        phase.write_bytes(b"{}")
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture(reconcile=True)
        self.assertEqual(self.fixture.store.backups, 1)

    def test_conflicting_plan_and_concurrent_journal_owner_hold(self):
        with self.fixture.journal.lock():
            with self.assertRaises(r.RecoveryError):
                self.fixture.capture()
        self.fixture.store.fail_after_write = True
        with self.assertRaises(r.RecoveryUnknown):
            self.fixture.capture()
        self.fixture.plan["operationId"] = "different"
        with self.assertRaises(r.RecoveryError):
            self.fixture.capture(reconcile=True)

    def test_fifo_journal_phase_is_rejected_without_waiting_for_a_writer(self):
        with self.fixture.journal.lock():
            os.mkfifo(self.fixture.journal.path / "0001.json", 0o600)
            with self.assertRaises(r.RecoveryError):
                self.fixture.journal.read()


class DockerCommand:
    def __init__(self, fixture):
        self.fixture = fixture
        self.rows = []
        project = fixture.plan["project"]
        self.volumes = []
        docker_root = fixture.root / "docker"
        for role, logical in r.VOLUMES.items():
            name = fixture.plan["volumes"][role]
            mount = docker_root / "volumes" / name / "_data"
            mount.mkdir(parents=True)
            self.volumes.append({"Name": name, "Driver": "local", "Scope": "local", "Options": None,
                                 "Mountpoint": str(mount), "Labels": {"com.docker.compose.project": project,
                                 "com.docker.compose.volume": logical}})
            if role == "postgres":
                put(mount / "PG_VERSION", b"16\n")
        by_role = {role: value for role, value in zip(r.VOLUMES, self.volumes)}
        for service, expected in fixture.plan["containers"].items():
            mounts = []
            roles = {"postgres": ["postgres"], "minio": ["objects"], "newsletter-engine": ["newsletterMedia"],
                     "caddy": ["ingressData", "ingressConfig"]}.get(service, [])
            for role in roles:
                volume = by_role[role]
                destination = {"postgres": "/var/lib/postgresql/data", "objects": "/data",
                               "newsletterMedia": "/listmonk/uploads", "ingressData": "/data",
                               "ingressConfig": "/config"}[role]
                mounts.append({"Type": "volume", "Name": volume["Name"], "Source": volume["Mountpoint"],
                               "Destination": destination, "RW": True})
            environment = []
            if service in {"app", "worker", "ws", "migrate"}:
                environment.append("DATABASE_URL=postgres://synthetic@postgres/fixture")
            if service == "core-api":
                environment.extend(["RUNTIME_COMPONENT=core-api", "DATABASE_URL=postgres://synthetic@postgres/fixture"])
            if service == "newsletter-engine":
                environment.extend(["LISTMONK_db__host=postgres", "LISTMONK_db__params="])
            hosts_file = docker_root / "containers" / expected["id"] / "hosts"
            resolv_file = docker_root / "containers" / expected["id"] / "resolv.conf"
            put(hosts_file, b"127.0.0.1 localhost\n")
            put(resolv_file, b"nameserver 127.0.0.11\noptions ndots:0\n")
            self.rows.append({"Id": expected["id"], "Image": expected["imageId"],
                              "Config": {"Labels": {"com.docker.compose.project": project,
                              "com.docker.compose.service": service}, "Env": environment},
                              "Mounts": mounts, "HostConfig": {"NetworkMode": "synthetic_default"},
                              "HostsPath": str(hosts_file), "ResolvConfPath": str(resolv_file),
                              "NetworkSettings": {"Networks": {"synthetic_default": {"NetworkID": "e" * 64, "Aliases": [service]}}},
                              "State": {"Status": "exited", "Running": False,
                              "Paused": False, "Restarting": False, "Dead": False, "OOMKilled": False,
                              "ExitCode": 0, "StartedAt": "2026-01-01T00:00:00Z", "FinishedAt": "2026-01-01T01:00:00Z"}})
        self.cluster_state = "shut down"

    def run(self, arguments, **kwargs):
        args = arguments[1:]
        if args == ["context", "inspect"]:
            return r.canonical([{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}])
        if args[:1] == ["info"]:
            return r.canonical({"OSType": "linux", "Swarm": {"LocalNodeState": "inactive"},
                                "DockerRootDir": str(self.fixture.root / "docker")})
        if args[:1] == ["ps"]:
            return ("\n".join(row["Id"] for row in self.rows) + "\n").encode()
        if args[:1] == ["inspect"]:
            return r.canonical(self.rows)
        if args[:2] == ["volume", "inspect"]:
            return r.canonical(self.volumes)
        if args[:2] == ["network", "inspect"]:
            return r.canonical([{"Id": "e" * 64, "Driver": "bridge", "Scope": "local", "Containers": {},
                                 "Labels": {"com.docker.compose.project": self.fixture.plan["project"]}}])
        if args == ["--version"]:
            return b"pg_controldata (PostgreSQL) 16.10\n"
        return ("Database cluster state: " + self.cluster_state + "\n").encode()


class DockerObservationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.close)
        self.command = DockerCommand(self.fixture)
        self.observer = r.DockerColdObserver("/bin/echo", sys.executable, self.command)

    def observe(self):
        with patch("recovery.sys.platform", "linux"):
            return self.observer.observe(self.fixture.plan)

    def test_actual_observation_parser_requires_cold_exact_exclusive_inventory(self):
        result = self.observe()
        self.assertEqual(set(result["members"]), set(r.VOLUMES))
        self.assertEqual(len(result["privateConfiguration"]), len(self.fixture.plan["containers"]))
        self.command.rows[0]["State"]["Running"] = True
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def next_web(self):
        row = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "app")
        revision = "a" * 40
        row["Config"].update(User="bun", WorkingDir="/app", Cmd=list(r.NEXT_WEB_COMMAND),
            Entrypoint=["/usr/local/bin/docker-entrypoint.sh"])
        row["Config"]["Labels"]["org.opencontainers.image.revision"] = revision
        row["Config"]["Env"] += ["APP_COMMIT=" + revision, "NEXT_DEPLOYMENT_ID=wd-" + revision]
        row.update(RestartCount=0)
        row["State"].update(ExitCode=143, Pid=0, Error="")
        contract = r.next_web_stop_contract(row, project=self.fixture.plan["project"],
            expected=self.fixture.plan["containers"]["app"], source_revision=revision)
        return row, contract

    def test_next143_is_explicit_opt_in_and_retains_raw_exit_with_exact_source_contract(self):
        row, contract = self.next_web()
        with self.assertRaisesRegex(r.RecoveryError, "cleanly stopped"):
            self.observe()
        self.observer = r.DockerColdObserver("/bin/echo", sys.executable, self.command, next_web_stop=contract)
        result = self.observe()
        app = next(value for value in result["privateConfiguration"] if value["service"] == "app")
        self.assertEqual(app["stopEvidence"], {"exitCode": 143, "contract": r.NEXT_WEB_STOP_KIND})
        self.assertEqual(row["State"]["ExitCode"], 143)

    def test_opted_next_contract_never_accepts_crash_or_other_service_nonzero(self):
        row, contract = self.next_web()
        self.observer = r.DockerColdObserver("/bin/echo", sys.executable, self.command, next_web_stop=contract)
        for code in (137, 2, 130, 1):
            row["State"]["ExitCode"] = code
            with self.subTest(code=code), self.assertRaisesRegex(r.RecoveryError, "cleanly stopped"):
                self.observe()
        row["State"]["ExitCode"] = 0
        for service, code in (("worker", 143), ("newsletter-engine", 2)):
            other = next(value for value in self.command.rows if value["Config"]["Labels"]["com.docker.compose.service"] == service)
            other["State"]["ExitCode"] = code
            with self.subTest(service=service), self.assertRaisesRegex(r.RecoveryError, "cleanly stopped"):
                self.observe()
            other["State"]["ExitCode"] = 0

    def test_next_contract_rejects_wrong_command_revision_manual_handler_and_image(self):
        row, contract = self.next_web()
        self.observer = r.DockerColdObserver("/bin/echo", sys.executable, self.command, next_web_stop=contract)
        original = copy.deepcopy(row)
        changes = (lambda: row["Config"].update(Cmd=["bun", "node_modules/next/dist/bin/next", "start"]),
                   lambda: row["Config"]["Labels"].update({"org.opencontainers.image.revision": "b" * 40}),
                   lambda: row["Config"]["Env"].append("NEXT_MANUAL_SIG_HANDLE=1"),
                   lambda: row.update(Image="sha256:" + "f" * 64),
                   lambda: row["Config"].update(StopSignal="SIGKILL"))
        for index, change in enumerate(changes):
            change()
            with self.subTest(change=index), self.assertRaises(r.RecoveryError):
                self.observe()
            row.clear()
            row.update(copy.deepcopy(original))

    def test_next143_requires_terminal_pid_flags_finish_and_same_started_process(self):
        row, contract = self.next_web()
        self.observer = r.DockerColdObserver("/bin/echo", sys.executable, self.command, next_web_stop=contract)
        for key, value in (("Pid", 12), ("OOMKilled", True), ("Paused", True), ("Restarting", True),
                           ("Dead", True), ("Running", True), ("FinishedAt", ""), ("StartedAt", "2026-02-02T00:00:00Z")):
            previous = row["State"].get(key)
            row["State"][key] = value
            with self.subTest(key=key), self.assertRaises(r.RecoveryError):
                self.observe()
            row["State"][key] = previous
        row["RestartCount"] = 1
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_unknown_container_or_shared_storage_is_refused(self):
        added = copy.deepcopy(self.command.rows[0])
        added["Id"] = "f" * 64
        self.command.rows.append(added)
        with self.assertRaises(r.RecoveryError):
            self.observe()
        added["Config"]["Labels"]["com.docker.compose.project"] = "unrelated"
        added["Mounts"] = copy.deepcopy(next(row for row in self.command.rows if row["Mounts"])["Mounts"])
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_crash_exit_unclean_pg_and_unexpected_image_refuse(self):
        original = copy.deepcopy(self.command.rows)
        self.command.rows[0]["State"]["ExitCode"] = 137
        with self.assertRaises(r.RecoveryError):
            self.observe()
        self.command.rows = copy.deepcopy(original)
        self.command.cluster_state = "in production"
        with self.assertRaises(r.RecoveryError):
            self.observe()
        self.command.cluster_state = "shut down"
        self.command.rows[0]["Image"] = "sha256:" + "f" * 64
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_external_database_is_not_hidden_by_local_pg_volume(self):
        app = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "app")
        app["Config"]["Env"] = ["DATABASE_URL=postgres://synthetic@external.example/other"]
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_core_query_cannot_override_the_observed_host(self):
        app = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "app")
        for query in ("host=external.example", "h%6fst=external.example", "options=host%3Dexternal.example", "port=5433"):
            with self.subTest(query=query):
                app["Config"]["Env"] = ["DATABASE_URL=postgres://synthetic@postgres/fixture?" + query]
                with self.assertRaises(r.RecoveryError):
                    self.observe()

    def test_separate_migration_owner_target_must_be_in_the_observed_cluster(self):
        migrate = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "migrate")
        original = list(migrate["Config"]["Env"])
        for target in ("postgres://owner@external.example/other",
                       "postgres://owner@postgres/fixture?host=external.example"):
            with self.subTest(target=target):
                migrate["Config"]["Env"] = [*original, "MIGRATION_DATABASE_URL=" + target]
                with self.assertRaises(r.RecoveryError):
                    self.observe()
        migrate["Config"]["Env"] = [*original, "MIGRATION_DATABASE_URL=postgres://owner@postgres/fixture"]
        self.assertEqual(self.observe()["scope"], "observed-cold-local-compose")

    def test_optional_core_is_a_cold_writer_bound_to_the_observed_cluster(self):
        fixture = Fixture()
        self.addCleanup(fixture.close)
        fixture.plan["containers"]["core-api"] = {"id": "a" * 64, "imageId": "sha256:" + "b" * 64}
        command = DockerCommand(fixture)
        observer = r.DockerColdObserver("/bin/echo", sys.executable, command)
        core = next(row for row in command.rows if row["Id"] == "a" * 64)
        with patch("recovery.sys.platform", "linux"):
            self.assertIn("core-api", {row["service"] for row in observer.observe(fixture.plan)["privateConfiguration"]})
            for extra in (
                ["DATABASE_URL=postgres://synthetic@external.example/fixture"],
                ["DATABASE_URL=postgres://synthetic@postgres/fixture?host=elsewhere"],
                ["DATABASE_URL=postgres://synthetic@postgres/fixture?sslcert=/tmp/external"],
                ["DATABASE_URL=postgres://synthetic@postgres"],
                ["DATABASE_URL=postgres://synthetic@postgres/fixture", "MIGRATION_DATABASE_URL=postgres://owner@postgres/fixture"],
            ):
                with self.subTest(extra=extra), self.assertRaises(r.RecoveryError):
                    core["Config"]["Env"] = ["RUNTIME_COMPONENT=core-api", *extra]
                    observer.observe(fixture.plan)

    def collector_fixture(self):
        service = "operations-collector"
        fixture = Fixture()
        self.addCleanup(fixture.close)
        fixture.plan["containers"][service] = {"id": "a" * 64, "imageId": "sha256:" + "b" * 64}
        command = DockerCommand(fixture)
        row = next(row for row in command.rows if row["Id"] == "a" * 64)
        config, socket_dir = fixture.root / "configuration" / "collector.json", fixture.root / "collector-socket"
        socket_dir.mkdir(mode=0o700)
        put(config, r.canonical({"databaseUrl": "postgres://synthetic@postgres/fixture",
                                "socketPath": r.COLLECTOR_SOCKET_DIR + "/collector.sock"}))
        fixture.plan["configurationFiles"].append(str(config))
        row["Config"].update(User="1000:1000", Cmd=["bun", "--no-env-file", "dist/operations-collector.mjs",
                                                    r.COLLECTOR_CONFIG])
        row["HostConfig"].update(ReadonlyRootfs=True, Privileged=False)
        row["Mounts"] = [{"Type": "bind", "Source": str(config), "Destination": r.COLLECTOR_CONFIG, "RW": False},
                         {"Type": "bind", "Source": str(socket_dir), "Destination": r.COLLECTOR_SOCKET_DIR, "RW": True}]
        observer = r.DockerColdObserver("/bin/echo", sys.executable, command)
        self.enterContext(patch("recovery.sys.platform", "linux"))
        self.enterContext(patch("recovery.COLLECTOR_UID", os.geteuid()))
        return fixture, observer, row, config, socket_dir

    def test_optional_collector_keeps_its_config_and_excludes_empty_socket_directory(self):
        fixture, observer, row, config, socket_dir = self.collector_fixture()
        first = observer.observe(fixture.plan)
        self.assertIn(str(config), first["roots"])
        self.assertNotIn(str(socket_dir), first["roots"])
        collector = next(item for item in first["privateConfiguration"] if item["service"] == "operations-collector")
        self.assertNotIn("postgres://", str(collector))
        put(config, r.canonical({"databaseUrl": "postgres://synthetic@postgres/fixture",
                                "socketPath": r.COLLECTOR_SOCKET_DIR + "/collector.sock", "sources": []}))
        self.assertNotEqual(observer.observe(fixture.plan)["fingerprint"], first["fingerprint"])
        row["State"]["Running"] = True
        with self.assertRaisesRegex(r.RecoveryError, "cleanly stopped"):
            observer.observe(fixture.plan)

    def test_collector_rejects_external_database_and_mount_authority(self):
        fixture, observer, row, config, socket_dir = self.collector_fixture()
        for authority in ("elsewhere/fixture", "postgres/fixture?host=elsewhere", "postgres/fixture?sslcert=/tmp/file",
                          "postgres:invalid/fixture", "postgres/fixture?sslmode"):
            with self.subTest(authority=authority):
                put(config, r.canonical({"databaseUrl": "postgres://synthetic@" + authority,
                                        "socketPath": r.COLLECTOR_SOCKET_DIR + "/collector.sock"}))
                with self.assertRaisesRegex(r.RecoveryError, "observed PostgreSQL bridge"):
                    observer.observe(fixture.plan)
        put(config, r.canonical({"databaseUrl": "postgres://synthetic@postgres/fixture",
                                "socketPath": r.COLLECTOR_SOCKET_DIR + "/collector.sock"}))
        row["Config"]["Env"] = ["PGHOST=elsewhere"]
        with self.assertRaisesRegex(r.RecoveryError, "private configuration"):
            observer.observe(fixture.plan)
        row["Config"]["Env"] = []
        row["HostConfig"]["UsernsMode"] = "host"
        with self.assertRaisesRegex(r.RecoveryError, "UID mapping"):
            observer.observe(fixture.plan)
        row["HostConfig"]["UsernsMode"] = ""
        row["Mounts"][0]["RW"] = True
        with self.assertRaisesRegex(r.RecoveryError, "socket binds"):
            observer.observe(fixture.plan)
        row["Mounts"][0]["RW"] = False
        put(socket_dir / "unexpected", b"stale")
        with self.assertRaisesRegex(r.RecoveryError, "private and empty"):
            observer.observe(fixture.plan)
        (socket_dir / "unexpected").unlink()
        fixture.plan["configurationFiles"].append(str(socket_dir))
        with self.assertRaisesRegex(r.RecoveryError, "overlaps"):
            observer.observe(fixture.plan)

    def test_engine_params_case_and_delimiter_aliases_cannot_override_authority(self):
        engine = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "newsletter-engine")
        for added in ("LISTMONK_db__params=host=external.example", "LISTMONK_DB__HOST=external.example",
                      "LISTMONK_db.host=external.example", "LISTMONK_DB.PARAMS=host=external.example"):
            with self.subTest(added=added):
                engine["Config"]["Env"] = ["LISTMONK_db__host=postgres", "LISTMONK_db__params=", added]
                with self.assertRaises(r.RecoveryError):
                    self.observe()
        engine["Config"]["Env"] = ["LISTMONK_db__host=postgres"]
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_published_or_shared_database_network_is_refused(self):
        postgres = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "postgres")
        postgres["HostConfig"]["PortBindings"] = {"5432/tcp": [{"HostPort": "5432"}]}
        with self.assertRaises(r.RecoveryError):
            self.observe()
        postgres["HostConfig"].pop("PortBindings")
        extra = copy.deepcopy(self.command.rows[0])
        extra["Id"] = "f" * 64
        extra["Config"]["Labels"]["com.docker.compose.project"] = "unrelated"
        extra["Mounts"] = []
        self.command.rows.append(extra)
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_outside_bind_cannot_bypass_named_volume_or_capture_root_admission(self):
        postgres_path = next(volume["Mountpoint"] for volume in self.command.volumes
                             if volume["Name"] == self.fixture.plan["volumes"]["postgres"])
        alias = self.fixture.root / "outside-alias"
        alias.symlink_to(postgres_path)
        foreign = {"Id": "f" * 64, "Config": {"Labels": {"com.docker.compose.project": "unrelated"}},
                   "NetworkSettings": {"Networks": {}}, "Mounts": []}
        self.command.rows.append(foreign)
        for source, writable in ((postgres_path, True), (postgres_path, False), (str(alias), True),
                                 (str(self.fixture.configuration / "nested"), True),
                                 (str(self.fixture.configuration.parent), True)):
            with self.subTest(source=source, writable=writable):
                foreign["Mounts"] = [{"Type": "bind", "Source": source, "RW": writable}]
                with self.assertRaisesRegex(r.RecoveryError, "outside container shares"):
                    self.observe()
        foreign["Mounts"] = [{"Type": "bind", "Source": str(self.fixture.root / "unrelated"), "RW": True}]
        self.assertEqual(self.observe()["scope"], "observed-cold-local-compose")

    def test_database_dns_overrides_and_alias_collisions_are_refused(self):
        app = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "app")
        original = copy.deepcopy(app)
        for key, value in (("ExtraHosts", ["postgres:203.0.113.8"]), ("Dns", ["203.0.113.8"]),
                           ("NetworkMode", "host"), ("NetworkMode", "container:other")):
            with self.subTest(key=key, value=value):
                app["HostConfig"][key] = value
                with self.assertRaises(r.RecoveryError):
                    self.observe()
                app.clear()
                app.update(copy.deepcopy(original))
        for alias in ("postgres", "Postgres", "POSTGRES."):
            with self.subTest(alias=alias):
                app["NetworkSettings"]["Networks"]["synthetic_default"]["Aliases"].append(alias)
                with self.assertRaises(r.RecoveryError):
                    self.observe()
                app.clear()
                app.update(copy.deepcopy(original))
                put(Path(app["HostsPath"]), ("203.0.113.8 " + alias + "\n").encode())
                with self.assertRaises(r.RecoveryError):
                    self.observe()
                put(Path(app["HostsPath"]), b"127.0.0.1 localhost\n")
        put(Path(app["HostsPath"]), b"203.0.113.8 POSTGRES\x00ignored\n")
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_file_database_authority_wins_regardless_of_env_order(self):
        app = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "app")
        file = self.fixture.root / "database-secret"
        put(file, b"postgres://synthetic@external.example/other\n")
        self.fixture.plan["configurationFiles"].append(str(file))
        app["Mounts"].append({"Type": "bind", "Source": str(file), "Destination": "/run/db", "RW": False})
        app["Config"]["Env"] = ["DATABASE_URL_FILE=/run/db", "DATABASE_URL=postgres://synthetic@postgres/fixture"]
        with self.assertRaises(r.RecoveryError):
            self.observe()

    def test_file_migration_owner_authority_cannot_escape_the_capture(self):
        migrate = next(row for row in self.command.rows if row["Config"]["Labels"]["com.docker.compose.service"] == "migrate")
        file = self.fixture.root / "migration-owner-secret"
        put(file, b"postgres://owner@external.example/other\n")
        self.fixture.plan["configurationFiles"].append(str(file))
        migrate["Mounts"].append({"Type": "bind", "Source": str(file), "Destination": "/run/owner", "RW": False})
        migrate["Config"]["Env"] = ["DATABASE_URL=postgres://synthetic@postgres/fixture",
                                  "MIGRATION_DATABASE_URL_FILE=/run/owner",
                                  "MIGRATION_DATABASE_URL=postgres://owner@postgres/fixture"]
        with self.assertRaises(r.RecoveryError):
            self.observe()


class StderrObservedCommand(r.Command):
    """Passive bounded observation; the real process and exit status are unchanged."""
    def run(self, arguments, **kwargs):
        if "restore" in arguments and getattr(self, "before_restore", None) is not None:
            callback, self.before_restore = self.before_restore, None
            callback()
        self.standard_error = bytearray()
        popen, read = r.subprocess.Popen, r.os.read
        observed = None
        def start(values, **options):
            nonlocal observed
            process = popen(values, **options)
            if values is arguments:
                observed = process.stderr.fileno()
            return process
        def receive(descriptor, maximum):
            value = read(descriptor, maximum)
            if descriptor == observed:
                r.require(len(self.standard_error) + len(value) <= 64 * 1024, "Preflight diagnostics exceeded their bound")
                self.standard_error.extend(value)
            return value
        with patch("recovery.subprocess.Popen", start), patch("recovery.os.read", receive):
            return super().run(arguments, **kwargs)

    def stream(self, arguments, descriptor, **kwargs):
        if getattr(self, "before_dump", None) is not None:
            callback, self.before_dump = self.before_dump, None
            callback()
        return super().stream(arguments, descriptor, **kwargs)


def exact_root_removal_rejected(standard_error, locator, *, expected_item="/"):
    """Match one versioned restic JSON root error, never unrelated substrings."""
    prefix = "/proc/self/fd/"
    descriptor = locator.removeprefix(prefix)
    if not locator.startswith(prefix) or not 1 <= len(descriptor) <= 10 or not descriptor.isascii() or not descriptor.isdecimal():
        return False
    messages = {f"failed to remove stale item: remove {locator}: {reason}"
                for reason in ("operation not permitted", "permission denied", "read-only file system")}
    for line in standard_error.splitlines():
        try:
            record = json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(record, dict) or record.get("message_type") != "error" or record.get("during") != "restore" or record.get("item") != expected_item:
            continue
        error = record.get("error")
        message = error.get("message") if isinstance(error, dict) else None
        if isinstance(message, str) and message in messages:
            return True
    return False


class DescriptorDiagnosticTests(unittest.TestCase):
    def test_restore_argument_preserves_raw_dot_through_actual_process_argv(self):
        with tempfile.TemporaryDirectory() as directory:
            target = r.RestoreTarget(Path(directory).resolve() / "restore")
            try:
                target.create()
                with patch("recovery.sys.platform", "linux"):
                    argument = target.argument()
                self.assertEqual(argument, f"/proc/self/fd/{target.fd}/.")
                self.assertIsInstance(argument, str)
                output = r.Command().run([sys.executable, "-c", "import sys;print(sys.argv[1])", argument], pass_fds=(target.fd,))
                self.assertEqual(output.decode().rstrip("\n"), argument)
            finally:
                target.close()

    def test_restore_argument_rejects_persistent_leaf_and_parent_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / "source"
            source.mkdir(mode=0o700)
            for replacement in ("leaf", "parent"):
                with self.subTest(replacement=replacement):
                    parent = root / replacement
                    parent.mkdir(mode=0o700)
                    target = r.RestoreTarget(parent / "restore")
                    try:
                        target.create()
                        moved = parent if replacement == "parent" else target.path
                        moved.rename(root / (replacement + "-old"))
                        moved.symlink_to(source, target_is_directory=True)
                        with self.assertRaises(OSError):
                            target.argument()
                        self.assertEqual(list(source.iterdir()), [])
                    finally:
                        target.close()

    def test_only_same_record_exact_terminal_root_can_establish_removal_failure(self):
        def record(path, *, item="/", message=None):
            return json.dumps({"message_type": "error", "during": "restore", "item": item,
                               "error": {"message": message or f"failed to remove stale item: remove {path}: operation not permitted"}}).encode()
        locator = "/proc/self/fd/5"
        self.assertTrue(exact_root_removal_rejected(record(locator), locator))
        self.assertTrue(exact_root_removal_rejected(record(locator, item="/descriptor-root-file.data"), locator,
                                                   expected_item="/descriptor-root-file.data"))
        for raw in (record(locator + "0"), record(locator + "/child"), record(locator, item="/child"),
                    record(locator, message=f"mentioned {locator}") + b"\n" + record(locator + "/child"),
                    b"failed to remove stale item: remove /proc/self/fd/5: operation not permitted"):
            with self.subTest(raw=raw):
                self.assertFalse(exact_root_removal_rejected(raw, locator))


class CommandTests(unittest.TestCase):
    def test_passive_preflight_observer_keeps_actual_command_failure(self):
        command = StderrObservedCommand()
        with self.assertRaises(r.RecoveryCommandFailure) as failure:
            command.run([sys.executable, "-c", "import sys;sys.stderr.write('generated-preflight-marker');raise SystemExit(7)"])
        self.assertEqual(failure.exception.exit_code, 7)
        self.assertEqual(bytes(command.standard_error), b"generated-preflight-marker")

    def test_nonzero_exit_retains_only_finite_status_not_command_streams(self):
        with self.assertRaises(r.RecoveryCommandFailure) as failure:
            r.Command().run([sys.executable, "-c", "import sys;sys.stderr.write('synthetic-private-command-marker');raise SystemExit(3)"])
        self.assertEqual(failure.exception.exit_code, 3)
        self.assertNotIn("synthetic-private-command-marker", str(failure.exception))
        wrapped = r.ResticFailure("isolated-restore", failure.exception)
        self.assertEqual(wrapped.operation, "isolated-restore")
        self.assertEqual(wrapped.reason, "command-nonzero")
        self.assertNotIn("synthetic-private-command-marker", str(wrapped))
        self.assertEqual(r.failure_fact(wrapped), {"operation": "isolated-restore", "reason": "command-nonzero", "exitCode": 3})
        self.assertEqual(r.failure_fact(ValueError("synthetic-private-command-marker")), {"operation": "verification", "reason": "guard-rejected"})

    def test_actual_workflow_runner_retains_finite_facts_without_exception_payload(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/recovery-qualification.yml").read_text()
        start = workflow.index('          runner = """')
        end = workflow.index('\n          """', start) + len('\n          """')
        statement = "\n".join(line[10:] for line in workflow[start:end].splitlines())
        runner = ast.literal_eval(ast.parse(statement).body[0].value)
        prefix = '''import os,sys,types,unittest
sys.path.insert(0,sys.argv[2])
import recovery
module=types.ModuleType('owned_failure_probe')
class Case(unittest.TestCase):
    def test_known(self):
        raise recovery.RecoveryUnknown('generated-private-fixture-message',failure={
            'operation':'snapshot-write','reason':'command-nonzero','exitCode':3})
    def test_unclassified(self):
        raise ValueError('generated-private-fixture-message')
module.Case=Case
sys.modules[module.__name__]=module
os.environ['RECOVERY_RESULT']=sys.argv[1]
sys.argv=['runner','owned_failure_probe.Case']
'''
        with tempfile.TemporaryDirectory() as directory:
            result = Path(directory).resolve() / "result.json"
            with self.assertRaises(r.RecoveryCommandFailure) as failure:
                r.Command().run([sys.executable, "-c", prefix + runner, str(result), str(Path(__file__).resolve().parent)], seconds=5)
            self.assertEqual(failure.exception.exit_code, 1)
            value = json.loads(result.read_bytes())
            self.assertEqual((value["success"], value["tests"], value["errors"]), (False, 2, 2))
            self.assertEqual(value["failureFacts"], [
                {"operation": "snapshot-write", "reason": "command-nonzero", "exitCode": 3},
                {"operation": "verification", "reason": "guard-rejected"},
            ])
            self.assertNotIn("generated-private-fixture-message", json.dumps(value))

    def test_streams_multi_megabyte_output_with_bounded_python_memory_and_private_writes(self):
        chunk = b"x" * 65536
        hasher = r.hashlib.sha256()
        for _ in range(64):
            hasher.update(chunk)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "output"
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            sizes, modes, write = [], [], os.write
            def observed_write(fd, value):
                if fd == descriptor:
                    sizes.append(len(value))
                    modes.append(stat.S_IMODE(os.fstat(fd).st_mode))
                return write(fd, value)
            tracemalloc.start()
            try:
                with patch("os.write", observed_write):
                    value = r.Command().stream([sys.executable, "-c", "import sys;chunk=b'x'*65536\nfor _ in range(64): sys.stdout.buffer.write(chunk)"],
                                               descriptor, expected_bytes=4 * 1024**2, expected_sha256=hasher.hexdigest(), seconds=10)
                _, peak = tracemalloc.get_traced_memory()
                self.assertLess(peak, 2 * 1024**2)
                self.assertEqual(value, {"bytes": 4 * 1024**2, "sha256": hasher.hexdigest()})
                self.assertTrue(sizes and max(sizes) <= 65536)
                self.assertEqual(set(modes), {0o600})
            finally:
                tracemalloc.stop()
                os.close(descriptor)

    def test_stream_rejects_overrun_short_digest_nonzero_stderr_and_timeout(self):
        cases = [
            ("import sys;sys.stdout.buffer.write(b'abcd')", 3, r.digest(b"abc"), 5),
            ("import sys;sys.stdout.buffer.write(b'ab')", 3, r.digest(b"abc"), 5),
            ("import sys;sys.stdout.buffer.write(b'abc')", 3, r.digest(b"xyz"), 5),
            ("import sys;sys.stdout.buffer.write(b'abc');raise SystemExit(3)", 3, r.digest(b"abc"), 5),
            ("import sys;sys.stderr.buffer.write(b'x'*65537)", 0, r.digest(b""), 5),
            ("import os,time;os.write(1,b'a');time.sleep(2)", 1, r.digest(b"a"), 0.05),
        ]
        with tempfile.TemporaryDirectory() as directory:
            for index, (program, size, checksum, seconds) in enumerate(cases):
                with self.subTest(index=index):
                    descriptor = os.open(Path(directory).resolve() / str(index), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    try:
                        with self.assertRaises(r.RecoveryError):
                            r.Command().stream([sys.executable, "-c", program], descriptor,
                                               expected_bytes=size, expected_sha256=checksum, seconds=seconds)
                        self.assertLessEqual(os.fstat(descriptor).st_size, size)
                        self.assertEqual(stat.S_IMODE(os.fstat(descriptor).st_mode), 0o600)
                    finally:
                        os.close(descriptor)

    def test_stream_refuses_existing_offset_and_propagates_partial_sink_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            descriptor = os.open(Path(directory).resolve() / "output", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.lseek(descriptor, 1, os.SEEK_SET)
                with self.assertRaises(r.RecoveryError):
                    r.Command().stream([sys.executable, "-c", "pass"], descriptor, expected_bytes=0, expected_sha256=r.digest(b""))
                os.lseek(descriptor, 0, os.SEEK_SET)
                write, calls = os.write, []
                def failed_sink(fd, value):
                    if fd == descriptor:
                        calls.append(True)
                        if len(calls) > 1:
                            raise OSError("generated-sink-failure")
                        return write(fd, value[:1])
                    return write(fd, value)
                with patch("os.write", failed_sink), self.assertRaises(OSError):
                    r.Command().stream([sys.executable, "-c", "import sys;sys.stdout.buffer.write(b'abc')"], descriptor,
                                       expected_bytes=3, expected_sha256=r.digest(b"abc"))
                self.assertEqual(os.fstat(descriptor).st_size, 1)
            finally:
                os.close(descriptor)

    def test_output_and_deadline_are_bounded(self):
        command = r.Command()
        with self.assertRaises(r.RecoveryError):
            command.run([sys.executable, "-c", "print('x'*100000)"], maximum=1024)
        with self.assertRaises(r.RecoveryError):
            command.run([sys.executable, "-c", "import time; time.sleep(10)"], seconds=0.1)

    def test_no_inherited_environment_or_blocking_stdin(self):
        command = r.Command()
        with patch.dict(os.environ, {"RESTIC_PASSWORD": "never-inherit-this", "NODE_OPTIONS": "never-inherit-this"}):
            raw = command.run([sys.executable, "-c", "import os; print('RESTIC_PASSWORD' in os.environ or 'NODE_OPTIONS' in os.environ)"])
        self.assertEqual(raw, b"False\n")
        with self.assertRaises(r.RecoveryError):
            command.run([sys.executable, "-c", "import time; time.sleep(10)"], data=b"x" * (128 * 1024), seconds=0.1)

    def test_inspection_diagnostics_are_not_silently_treated_as_success(self):
        with self.assertRaises(r.RecoveryError):
            r.Command().run([sys.executable, "-c", "import sys; sys.stderr.write('warning')"], reject_stderr=True)


def file_entry(path, value, mode=0o640):
    return {"path": path, "kind": "file", "mode": mode, "uid": os.getuid(), "gid": os.getgid(),
            "bytes": len(value), "sha256": r.digest(value)}


class HybridCommand:
    def __init__(self, entries, contents):
        self.entries, self.contents = entries, contents
        self.calls, self.streams = [], []
        self.before_stream, self.exit_code = None, 0

    def run(self, arguments, **kwargs):
        self.calls.append(arguments)
        if arguments[-1] == "version":
            return b"restic 0.18.0 generated-unit-adapter\n"
        if "ls" in arguments:
            rows = [{"struct_type": "snapshot"}] + [
                {"path": row["path"], "type": "file" if row["kind"] == "file" else "dir", "uid": row["uid"],
                 "gid": row["gid"], "mode": r.restic_file_mode(row["mode"]), "size": row.get("bytes", 0)}
                for row in self.entries]
            return b"\n".join(r.canonical(row) for row in rows)
        if "stats" in arguments:
            return b'{"total_size":1}'
        return b"{}"

    def stream(self, arguments, descriptor, **kwargs):
        self.streams.append(arguments)
        if self.before_stream is not None:
            callback, self.before_stream = self.before_stream, None
            callback()
        value = self.contents[arguments[-1]]
        program = f"import sys;sys.stdout.buffer.write({value!r});raise SystemExit({self.exit_code})"
        return r.Command().stream([sys.executable, "-c", program], descriptor, **kwargs)


class HybridRestoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.key = self.root / "key"
        put(self.key, b"generated-only-hybrid-unit-password-0000000000\n")
        self.repository = self.root / "repository"
        self.repository.mkdir(mode=0o700)
        self.handle = r.DirectoryHandle(self.repository, private_parent=True)
        self.addCleanup(self.handle.close)
        self.budget = {**r.DEFAULT_LIMITS, "repositoryBytes": 2 * 1024**2}

    def adapter(self, entries, contents):
        command = HybridCommand(entries, contents)
        adapter = r.Restic(sys.executable, str(self.repository), self.key, command=command)
        adapter.directory = self.handle
        return adapter, command

    def inventory(self, entries):
        return {"roots": [row["path"] for row in entries], "entries": entries,
                "bytes": sum(row.get("bytes", 0) for row in entries)}

    def target(self, name):
        target = r.RestoreTarget(self.root / name)
        target.create()
        self.addCleanup(target.close)
        return target

    def test_literal_patterns_and_original_dump_names_complete_owned_file_metadata(self):
        path, value = r"/literal*?[x]\tail", b"generated-root-file"
        entry = file_entry(path, value)
        inventory = self.inventory([entry])
        adapter, command = self.adapter([entry], {path: value})
        target = self.target("restore")
        adapter.restore("a" * 64, target, self.budget, inventory=inventory)
        bulk = next(call for call in command.calls if "restore" in call)
        self.assertEqual(bulk[-2:], ["--exclude", r"/literal\*\?\[x\]\\tail"])
        self.assertEqual(command.streams[0][-3:], ["dump", "a" * 64, path])
        self.assertNotIn("--target", command.streams[0])
        self.assertEqual(r.scan([path], self.budget, anchor=target.fd), inventory)
        self.assertEqual(r.root_exclude_pattern("/trailing\\"), "/trailing\\\\")
        self.assertEqual(r.root_exclude_pattern("/!,$# space ü"), "/!,$# space ü")
        self.assertEqual(r.restic_file_mode(0o7755), 0o755 | (1 << 23) | (1 << 22) | (1 << 20))
        with self.assertRaises(r.RecoveryError):
            r.root_exclude_pattern("/nested/file")

    def test_changed_missing_extra_and_invalid_snapshot_members_reject_before_payload(self):
        entry = file_entry("/fixture", b"value")
        cases = [[], [dict(entry, bytes=6)], [dict(entry, mode=0o600)], [dict(entry, uid=entry["uid"] + 1)], [dict(entry, kind="directory")],
                 [dict(entry, path="/other")], [entry, entry]]
        for index, actual in enumerate(cases):
            with self.subTest(index=index):
                adapter, command = self.adapter(actual, {"/fixture": b"value"})
                target = self.target("reject-" + str(index))
                with self.assertRaises(r.RecoveryError):
                    adapter.restore("a" * 64, target, self.budget, inventory=self.inventory([entry]))
                self.assertEqual(os.listdir(target.fd), [])
                self.assertFalse(command.streams)
                self.assertFalse(any("restore" in call for call in command.calls))
        for inventory in (self.inventory([dict(entry, sha256="invalid")]), self.inventory([entry, entry]),
                          {"roots": ["/fixture"], "entries": [entry], "bytes": 0}):
            with self.assertRaises(r.RecoveryError):
                r.root_restore_files(inventory, self.budget)
        # An inventory omitting an actual root member must not bulk-restore it.
        nested = file_entry("/nested/file", b"nested")
        adapter, command = self.adapter([entry, nested], {"/fixture": b"value"})
        target = self.target("omitted")
        with self.assertRaises(r.RecoveryError):
            adapter.restore("a" * 64, target, self.budget, inventory=self.inventory([nested]))
        self.assertEqual(os.listdir(target.fd), [])

    def test_existing_symlink_regular_and_hardlink_outputs_are_never_truncated(self):
        original = self.root / "original"
        put(original, b"preserve")
        entry = file_entry("/fixture", b"value")
        for kind in ("symlink", "regular", "hardlink"):
            with self.subTest(kind=kind):
                target = self.target(kind)
                destination = target.path / "fixture"
                if kind == "symlink":
                    destination.symlink_to(original)
                elif kind == "hardlink":
                    os.link(original, destination)
                else:
                    put(destination, b"preserve")
                adapter, command = self.adapter([entry], {"/fixture": b"value"})
                with self.assertRaises(OSError):
                    adapter.restore("a" * 64, target, self.budget, inventory=self.inventory([entry]))
                self.assertEqual(original.read_bytes(), b"preserve")
                self.assertEqual(destination.read_bytes(), b"preserve")
                self.assertFalse(command.streams)

    def test_digest_or_lost_response_keeps_private_partial_file_and_no_metadata_promotion(self):
        entry = file_entry("/fixture", b"value", mode=0o644)
        for index, (payload, exit_code) in enumerate(((b"wrong", 0), (b"value", 3))):
            target = self.target("failed-" + str(index))
            adapter, command = self.adapter([entry], {"/fixture": payload})
            command.exit_code = exit_code
            with self.assertRaises(r.ResticFailure) as failure:
                adapter.restore("a" * 64, target, self.budget, inventory=self.inventory([entry]))
            self.assertEqual(failure.exception.operation, "root-file-restore")
            self.assertEqual(stat.S_IMODE((target.path / "fixture").stat().st_mode), 0o600)

    def test_root_and_output_leaf_substitution_do_not_redirect_descriptor_writes(self):
        entry, value = file_entry("/fixture", b"value"), b"value"
        source = self.root / "source"
        source.mkdir(mode=0o700)
        put(source / "sentinel", b"preserve")
        adapter, command = self.adapter([entry], {"/fixture": value})
        target = self.target("replaceable")
        def replace_root():
            target.path.rename(self.root / "original-target")
            target.path.symlink_to(source, target_is_directory=True)
        command.before_stream = replace_root
        with self.assertRaises(OSError):
            adapter.restore("a" * 64, target, self.budget, inventory=self.inventory([entry]))
        self.assertEqual(r.scan(["/fixture"], self.budget, anchor=target.fd), self.inventory([entry]))
        self.assertEqual(list(source.iterdir()), [source / "sentinel"])
        target = self.target("leaf-replaceable")
        adapter, command = self.adapter([entry], {"/fixture": value})
        def replace_leaf():
            (target.path / "fixture").rename(target.path / "held-output")
            (target.path / "fixture").symlink_to(source / "sentinel")
        command.before_stream = replace_leaf
        with self.assertRaises(OSError):
            adapter.restore("a" * 64, target, self.budget, inventory=self.inventory([entry]))
        self.assertEqual((target.path / "held-output").read_bytes(), value)
        self.assertEqual((source / "sentinel").read_bytes(), b"preserve")


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux live descriptor mechanism")
class LinuxDescriptorTests(unittest.TestCase):
    def test_inherited_repository_and_target_descriptors_do_not_follow_substituted_paths(self):
        with tempfile.TemporaryDirectory(prefix="warpdrive-recovery-fd-") as folder:
            root = Path(folder).resolve()
            source = root / "source"
            source.mkdir(mode=0o700)
            put(source / "marker", b"unrelated-source")
            repository = root / "repository"
            repository.mkdir(mode=0o700)
            put(repository / "marker", b"original-repository")
            handle = r.DirectoryHandle(repository, private_parent=True)
            target = r.RestoreTarget(root / "target")
            try:
                target.create()
                repo_argument, target_argument = handle.argument(), target.argument()
                repository.rename(root / "old-repository")
                repository.symlink_to(source, target_is_directory=True)
                (root / "target").rename(root / "old-target")
                (root / "target").symlink_to(source, target_is_directory=True)
                output = r.Command().run([
                    sys.executable, "-c",
                    "from pathlib import Path; import sys; print((Path(sys.argv[1])/'marker').read_text()); "
                    "(Path(sys.argv[2])/'restored').write_text('owned-target')",
                    repo_argument, target_argument,
                ], pass_fds=(handle.fd, target.fd))
                self.assertEqual(output, b"original-repository\n")
                self.assertEqual((root / "old-target" / "restored").read_text(), "owned-target")
                self.assertFalse((source / "restored").exists())
                with self.assertRaises(OSError):
                    handle.check()
            finally:
                target.close()
                handle.close()


def verified_static_binary(path, maximum, expected_sha256=None):
    descriptor = r.open_path(Path(path))
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        r.require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                  and stat.S_IMODE(before.st_mode) == 0o700 and 64 <= before.st_size <= maximum,
                  "Owned bounded private executable required")
        header = source.read(64)
        r.require(header[:6] == b"\x7fELF\x02\x01" and int.from_bytes(header[16:18], "little") in {2, 3}
                  and int.from_bytes(header[18:20], "little") == 62 and int.from_bytes(header[20:24], "little") == 1,
                  "Native AMD64 ELF required")
        offset = int.from_bytes(header[32:40], "little")
        size, count = int.from_bytes(header[54:56], "little"), int.from_bytes(header[56:58], "little")
        r.require(size == 56 and 1 <= count <= 128 and offset >= 64 and offset + size * count <= before.st_size,
                  "Invalid ELF program headers")
        source.seek(offset)
        headers = source.read(size * count)
        kinds = [int.from_bytes(headers[index:index + 4], "little") for index in range(0, len(headers), size)]
        r.require(1 in kinds and 3 not in kinds, "Static executable without an interpreter required")
        source.seek(0)
        hasher = r.hashlib.sha256()
        while chunk := source.read(1024**2):
            hasher.update(chunk)
        after = os.fstat(source.fileno())
        r.require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                  == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "Executable changed while checking")
        checksum = hasher.hexdigest()
        r.require(expected_sha256 is None or checksum == expected_sha256, "Executable hash differs")
        return {"sha256": checksum, "bytes": before.st_size}


def make_private_namespace(root):
    parent = r.DirectoryHandle(root)
    try:
        metadata = os.fstat(parent.fd)
        r.require(metadata.st_uid == os.geteuid() and stat.S_IMODE(metadata.st_mode) == 0o700,
                  "Private owned fixture root required before mutation")
        os.mkdir("mixed-namespace", 0o700, dir_fd=parent.fd)
        child = os.open("mixed-namespace", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent.fd)
        try:
            # Restic's packer uses Linux /tmp when no TMPDIR is set. Keep its
            # scratch inside the private namespace and outside explicit backup roots.
            os.mkdir("tmp", 0o700, dir_fd=child)
            scratch = os.stat("tmp", dir_fd=child, follow_symlinks=False)
            r.require(stat.S_ISDIR(scratch.st_mode) and scratch.st_uid == os.geteuid()
                      and stat.S_IMODE(scratch.st_mode) == 0o700, "Private namespace temporary directory required")
        finally:
            os.close(child)
        parent.check()
        return root / "mixed-namespace"
    finally:
        parent.close()


class StaticFixtureTests(unittest.TestCase):
    def test_static_elf_hash_bounds_and_link_admission(self):
        raw = bytearray(120)
        raw[:6] = b"\x7fELF\x02\x01"
        for offset, size, value in ((16, 2, 2), (18, 2, 62), (20, 4, 1), (32, 8, 64), (54, 2, 56), (56, 2, 1), (64, 4, 1)):
            raw[offset:offset + size] = value.to_bytes(size, "little")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "binary"
            put(path, bytes(raw), 0o700)
            self.assertEqual(verified_static_binary(path, 1024), {"sha256": r.digest(raw), "bytes": 120})
            for maximum, expected in ((119, None), (1024, "0" * 64)):
                with self.assertRaises(r.RecoveryError):
                    verified_static_binary(path, maximum, expected)
            raw[64:68] = (3).to_bytes(4, "little")
            put(path, bytes(raw), 0o700)
            with self.assertRaises(r.RecoveryError):
                verified_static_binary(path, 1024)
            alias = root / "alias"
            alias.symlink_to(path)
            with self.assertRaises(OSError):
                verified_static_binary(alias, 1024)
            fifo = root / "fifo"
            os.mkfifo(fifo, 0o700)
            with self.assertRaises(r.RecoveryError):
                verified_static_binary(fifo, 1024)

    def test_chroot_producer_refuses_without_explicit_hosted_admission_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            with patch.dict(os.environ, {"WARPDRIVE_RECOVERY_CHROOT_FIXTURE": "0"}), self.assertRaises(r.RecoveryError):
                owned_mixed_snapshot(root, Path(sys.executable), r.Command(), r.DEFAULT_LIMITS, {})
            self.assertEqual(list(root.iterdir()), [])

    def test_namespace_creation_refuses_symlink_or_nonprivate_root_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / "source"
            source.mkdir(mode=0o700)
            alias = root / "alias"
            alias.symlink_to(source, target_is_directory=True)
            with self.assertRaises(OSError):
                make_private_namespace(alias)
            source.chmod(0o755)
            with self.assertRaises(r.RecoveryError):
                make_private_namespace(source)
            self.assertEqual(list(source.iterdir()), [])
            source.chmod(0o700)
            self.assertEqual(make_private_namespace(source), source / "mixed-namespace")
            self.assertEqual(stat.S_IMODE((source / "mixed-namespace").stat().st_mode), 0o700)
            scratch = (source / "mixed-namespace/tmp").lstat()
            self.assertTrue(stat.S_ISDIR(scratch.st_mode))
            self.assertEqual((scratch.st_uid, stat.S_IMODE(scratch.st_mode)), (os.geteuid(), 0o700))


def owned_mixed_snapshot(root, binary, command, budget, progress):
    """Hosted-only producer; no mount, network, service or host '/' writes."""
    r.require(sys.platform.startswith("linux") and os.environ.get("WARPDRIVE_RECOVERY_CHROOT_FIXTURE") == "1",
              "Explicit hosted-only chroot fixture required")
    progress["mixedProducerStage"] = "static-admission"
    uid, gid = os.getuid(), os.getgid()
    r.require(uid != 0 and uid == os.geteuid() and gid == os.getegid(), "Unprivileged fixture controller required")
    expected = os.environ.get("WARPDRIVE_RECOVERY_RESTIC_SHA256", "")
    r.require(r.HASH.fullmatch(expected), "Verified downloaded restic hash required")
    binary_proof = verified_static_binary(binary, 64 * 1024**2, expected)
    for tool in ("/usr/bin/env", "/usr/bin/cc", "/usr/bin/sudo", "/usr/bin/timeout", "/usr/sbin/chroot"):
        path = Path(tool).resolve(strict=True)
        descriptor = r.open_path(path)
        try:
            metadata = os.fstat(descriptor)
            r.require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022
                      and metadata.st_mode & 0o111, "Trusted fixed hosted tool required")
        finally:
            os.close(descriptor)
    r.require(command.run(["/usr/bin/timeout", "--version"], seconds=3).startswith(b"timeout (GNU coreutils) "),
              "Fixed GNU timeout required")
    r.require(command.run(["/usr/sbin/chroot", "--version"], seconds=3).startswith(b"chroot (GNU coreutils) "),
              "Fixed GNU chroot required")
    namespace = make_private_namespace(root)
    handle = r.DirectoryHandle(namespace, private_parent=True)
    try:
        metadata = os.fstat(handle.fd)
        r.require(metadata.st_uid == uid and stat.S_IMODE(metadata.st_mode) == 0o700, "Private owned namespace required")
        # A hard link retains the already verified immutable executable bytes
        # without an extra28MiB copy. Both names are checked before/after use.
        os.link(binary, namespace / "restic")
        identity_source = (b"#include <unistd.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n"
                           b"int main(int n,char**v){if(n!=3&&n!=4)return 90;unsigned long u=strtoul(v[1],0,10),g=strtoul(v[2],0,10);"
                           b"if(!u||getuid()!=u||geteuid()!=u||getgid()!=g||getegid()!=g)return 91;"
                           b"puts(\"warpdrive-drop-ok\");fflush(stdout);if(n==4){if(strcmp(v[3],\"hold\"))return 92;sleep(30);return 93;}return 0;}\n")
        put(namespace / "identity.c", identity_source)
        progress["mixedProducerStage"] = "identity-compilation"
        compiler = ["/usr/bin/env", "TMPDIR=" + str(namespace), "/usr/bin/cc"]
        command.run([*compiler, "-pipe", "-Os", "-c", str(namespace / "identity.c"), "-o", str(namespace / "identity.o")], seconds=5)
        command.run([*compiler, "-static", str(namespace / "identity.o"), "-o", str(namespace / "identity")], seconds=5)
        (namespace / "identity").chmod(0o700)
        identity_proof = verified_static_binary(namespace / "identity", 1024**2)
        namespace_argument = str(namespace)
        prefix = ["/usr/bin/sudo", "-n", "--", "/usr/bin/timeout", "--signal=TERM", "--kill-after=1s", "3s",
                  "/usr/sbin/chroot", f"--userspec={uid}:{gid}", namespace_argument]
        def launch(arguments):
            handle.check()
            current = os.fstat(handle.fd)
            r.require(current.st_uid == uid and stat.S_IMODE(current.st_mode) == 0o700, "Namespace authority changed")
            r.require(command.deadline - time.monotonic() >= 6, "Insufficient time for bounded privileged launcher")
            value = command.run([*prefix, *arguments], seconds=6)
            handle.check()
            return value
        progress["mixedProducerStage"] = "identity-drop-proof"
        r.require(launch(["/identity", str(uid), str(gid)]) == b"warpdrive-drop-ok\n", "Exact privilege drop was not proved")
        progress["mixedProducerStage"] = "privileged-launcher-timeout-proof"
        try:
            launch(["/identity", str(uid), str(gid), "hold"])
        except r.RecoveryCommandFailure as error:
            r.require(error.exit_code == 124, "Privileged launcher did not reach its GNU timeout boundary")
        else:
            raise r.RecoveryError("Privileged launcher timeout was not proved")
        progress["mixedProducerStage"] = "pinned-version-proof"
        r.require(launch(["/restic", "version"]).startswith(b"restic 0.18.0 "), "Pinned namespace binary required")
        key = namespace / "key"
        put(key, secrets.token_hex(32).encode() + b"\n")
        repository = namespace / "repository"
        repository.mkdir(mode=0o700)
        command.run([str(binary), "--repo", str(repository), "--password-file", str(key), "--no-cache", "init", "--repository-version", "2"], seconds=10)
        names = [r"literal*?[x]\tail", "trailing\\", "!,$# space ü", "empty"]
        for index, name in enumerate(names):
            put(namespace / name, b"" if name == "empty" else f"generated mixed root {index}".encode(), 0o640 + index)
        for directory in ("nested", "literalzzxtail"):
            (namespace / directory).mkdir(mode=0o700)
            put(namespace / directory / names[0], ("generated nested " + directory).encode(), 0o640)
        physical = [namespace / name for name in [*names, "nested", "literalzzxtail"]]
        captured = r.scan(physical, budget)
        inventory = {"roots": ["/" + str(Path(path).relative_to(namespace)) for path in captured["roots"]],
                     "entries": [{**row, "path": "/" + str(Path(row["path"]).relative_to(namespace))} for row in captured["entries"]],
                     "bytes": captured["bytes"]}
        progress["mixedProducerStage"] = "mixed-backup"
        raw = launch(["/restic", "--repo", "/repository", "--password-file", "/key", "--no-cache", "--json", "backup",
                      "--read-concurrency", "1", "--host", "warpdrive-recovery", "--tag", "warpdrive-mixed-preflight", *inventory["roots"]])
        summaries = [row for line in raw.splitlines() if (row := r.document(line)).get("message_type") == "summary"]
        r.require(len(summaries) == 1 and isinstance(summaries[0].get("snapshot_id"), str)
                  and r.HASH.fullmatch(summaries[0]["snapshot_id"]), "Full mixed snapshot ID required")
        verified_static_binary(binary, 64 * 1024**2, binary_proof["sha256"])
        verified_static_binary(namespace / "restic", 64 * 1024**2, binary_proof["sha256"])
        verified_static_binary(namespace / "identity", 1024**2, identity_proof["sha256"])
        r.require(r.scan(physical, budget) == captured, "Mixed source changed during backup")
        r.require(sum(path.stat().st_size for path in namespace.rglob("*") if path.is_file()) <= 64 * 1024**2,
                  "Mixed producer binary scratch exceeds its cap")
        return {"snapshot": summaries[0]["snapshot_id"], "repository": repository, "key": key,
                "inventory": inventory, "physical": physical, "captured": captured,
                "proof": {"identityProbeSourceSha256": r.digest(identity_source), "identityProbeSha256": identity_proof["sha256"],
                          "pinnedResticStaticHashVerified": True, "exactPrivilegeDropProvedBeforeBackup": True,
                          "privilegedLauncherTimeoutProvedBeforeBackup": True,
                          "boundedPrivilegedLaunchHandlesTerminal": True}}
    finally:
        handle.close()


@unittest.skipUnless(sys.platform.startswith("linux") and os.environ.get("WARPDRIVE_RECOVERY_CRYPTO_FIXTURE") == "1",
                     "Explicit native Linux descriptor/restic fixture only")
class RealResticDescriptorTests(unittest.TestCase):
    def test_terminal_descriptor_rejection_and_dot_restore_keep_held_inode_authority(self):
        # The original terminal symlink is tested independently of the product
        # RestoreTarget's raw '/.' locator. The full roundtrip follows.
        self.probe_facts = {}
        with tempfile.TemporaryDirectory(prefix="warpdrive-restic-descriptor-") as directory:
            root = Path(directory).resolve()
            source = root / "source"
            source.mkdir(mode=0o700)
            marker = source / "generated.data"
            value = b"owned-native-descriptor-preflight"
            put(marker, value)
            key = root / "key"
            put(key, secrets.token_hex(32).encode() + b"\n")
            repository = root / "repository"
            repository.mkdir(mode=0o700)
            binary = Path(os.environ["WARPDRIVE_RECOVERY_RESTIC"]).resolve(strict=True)
            command = StderrObservedCommand()
            command.deadline = time.monotonic() + 45
            budget = {**r.DEFAULT_LIMITS, "bytes": 2 * 1024**2, "fileBytes": 2 * 1024**2,
                      "files": 64, "deadline": command.deadline}
            inventory = r.scan([source], budget)
            command.run([str(binary), "--repo", str(repository), "--password-file", str(key),
                         "--no-cache", "init", "--repository-version", "2"], seconds=10)
            adapter = r.Restic(binary, str(repository), key, command=command, seconds=10)
            handle = r.DirectoryHandle(repository, private_parent=True)
            raw_target = root / "restore"
            raw_target.mkdir(mode=0o700)
            target = r.DirectoryHandle(raw_target, private_parent=True)
            try:
                adapter.directory = handle
                snapshot = adapter.backup([source], "warpdrive-descriptor-preflight")
                locator = target.argument()
                self.assertEqual(locator, f"/proc/self/fd/{target.fd}")
                self.assertTrue(stat.S_ISLNK(os.lstat(locator).st_mode))
                self.assertEqual((os.stat(locator).st_dev, os.stat(locator).st_ino),
                                 (os.fstat(target.fd).st_dev, os.fstat(target.fd).st_ino))
                self.probe_facts["terminalDescriptorIsSymlinkToPinnedDirectory"] = True
                with self.assertRaises(r.ResticFailure) as failure:
                    adapter.restore(snapshot, target, {**budget, "repositoryBytes": 2 * 1024**2}, inventory=inventory)
                self.probe_facts["actualResticRootRemovalRejected"] = exact_root_removal_rejected(command.standard_error, locator)
                self.probe_facts["restoreTargetContainsEntries"] = bool(os.listdir(target.fd))
                self.assertEqual(r.failure_fact(failure.exception),
                                 {"operation": "isolated-restore", "reason": "command-nonzero",
                                  "exitCode": 1})
                # Observe only a fixed signature and exact generated locator;
                # no raw stream, key or path enters retained report fields.
                self.assertTrue(self.probe_facts["actualResticRootRemovalRejected"])
                # restic's error reporter may continue into children after a
                # root error. Never equate command failure with an empty target.
                restored = target.path / marker.relative_to("/")
                if restored.exists():
                    self.assertEqual(r.read_regular(restored), value)
                target.argument()
                self.assertEqual(adapter.find("warpdrive-descriptor-preflight"), [snapshot])
                self.assertEqual(marker.read_bytes(), value)
                self.probe_facts["sourceAndSnapshotUnchanged"] = True
                dot_target = r.RestoreTarget(root / "dot-restore")
                try:
                    dot_target.create()
                    dot_locator = dot_target.argument()
                    self.assertEqual(dot_locator, f"/proc/self/fd/{dot_target.fd}/.")
                    self.assertTrue(stat.S_ISDIR(os.lstat(dot_locator).st_mode))
                    identity = (os.fstat(dot_target.fd).st_dev, os.fstat(dot_target.fd).st_ino)
                    adapter.restore(snapshot, dot_target, {**budget, "repositoryBytes": 2 * 1024**2}, inventory=inventory)
                    self.assertEqual((os.stat(dot_locator).st_dev, os.stat(dot_locator).st_ino), identity)
                    self.assertEqual(r.scan([source], budget, anchor=dot_target.fd), inventory)
                    self.probe_facts["rawDotRestoredBytesModesOwnershipAtPinnedInode"] = True
                finally:
                    dot_target.close()
                parent = root / "replaceable-parent"
                parent.mkdir(mode=0o700)
                renamed_target = r.RestoreTarget(parent / "restore")
                try:
                    renamed_target.create()
                    identity = (os.fstat(renamed_target.fd).st_dev, os.fstat(renamed_target.fd).st_ino)
                    def substitute_after_argument_admission():
                        renamed_target.path.rename(parent / "original-target")
                        renamed_target.path.symlink_to(source, target_is_directory=True)
                        parent.rename(root / "original-parent")
                        parent.symlink_to(source, target_is_directory=True)
                    command.before_restore = substitute_after_argument_admission
                    with self.assertRaises(OSError):
                        adapter.restore(snapshot, renamed_target, {**budget, "repositoryBytes": 2 * 1024**2}, inventory=inventory)
                    self.assertEqual((os.fstat(renamed_target.fd).st_dev, os.fstat(renamed_target.fd).st_ino), identity)
                    self.assertEqual(r.scan([source], budget, anchor=renamed_target.fd), inventory)
                    self.assertEqual(r.scan([source], budget), inventory)
                    self.assertFalse((source / "restore").exists())
                    self.probe_facts["actualResticKeptPinnedInodeAcrossLeafAndParentReplacement"] = True
                    self.probe_facts["postCommandPathSubstitutionRejected"] = True
                finally:
                    renamed_target.close()
                # stdin supplies an actual root-level snapshot file without
                # creating any file in the host's '/'. This admitted layout is
                # a REQUIRED passing gate, not an expected-failure exception.
                root_file = "/descriptor-root-file.data"
                root_value = b"owned-native-direct-root-file-preflight"
                raw = adapter.run("backup", "--read-concurrency", "1", "--host", "warpdrive-recovery",
                                  "--tag", "warpdrive-root-file-preflight", "--stdin", "--stdin-filename", root_file,
                                  data=root_value)
                summaries = [row for line in raw.splitlines() if (row := r.document(line)).get("message_type") == "summary"]
                self.assertEqual(len(summaries), 1)
                root_snapshot = summaries[0].get("snapshot_id")
                self.assertTrue(isinstance(root_snapshot, str) and r.HASH.fullmatch(root_snapshot))
                self.assertEqual(r.document(adapter.run("cat", "snapshot", root_snapshot))["paths"], [root_file])
                root_target = r.RestoreTarget(root / "direct-root-restore")
                expected = {"roots": [root_file], "bytes": len(root_value), "entries": [
                    {"path": root_file, "mode": 0o644, "uid": os.getuid(), "gid": os.getgid(),
                     "kind": "file", "bytes": len(root_value), "sha256": r.digest(root_value)},
                ]}
                try:
                    root_target.create()
                    identity = (os.fstat(root_target.fd).st_dev, os.fstat(root_target.fd).st_ino)
                    self.probe_facts["directRootFilePassingCompatibilityRequired"] = True
                    try:
                        adapter.restore(root_snapshot, root_target, {**budget, "repositoryBytes": 2 * 1024**2}, inventory=expected)
                    except r.ResticFailure:
                        self.probe_facts["directRootFileFailureMatchedDescriptorRootRemoval"] = exact_root_removal_rejected(
                            command.standard_error, f"/proc/self/fd/{root_target.fd}", expected_item=root_file)
                        raise
                    self.assertEqual(r.scan([root_file], budget, anchor=root_target.fd), expected)
                    self.assertEqual((os.fstat(root_target.fd).st_dev, os.fstat(root_target.fd).st_ino), identity)
                    self.probe_facts["directRootFileRestoredBytesModesOwnershipAtPinnedInode"] = True
                finally:
                    root_target.close()
                mixed = owned_mixed_snapshot(root, binary, command, budget, self.probe_facts)
                self.probe_facts.update(mixed["proof"])
                mixed_adapter = r.Restic(binary, str(mixed["repository"]), mixed["key"], command=command, seconds=10)
                mixed_handle = r.DirectoryHandle(mixed["repository"], private_parent=True)
                try:
                    mixed_adapter.directory = mixed_handle
                    mixed_inventory = mixed["inventory"]
                    metadata = r.document(mixed_adapter.run("cat", "snapshot", mixed["snapshot"]))
                    self.assertEqual(set(metadata["paths"]), set(mixed_inventory["roots"]))
                    expected_members = {row["path"]: row for row in mixed_inventory["entries"]}
                    seen = set()
                    for line in mixed_adapter.run("ls", mixed["snapshot"]).splitlines():
                        member = r.document(line)
                        if member.get("struct_type") == "snapshot":
                            continue
                        self.assertIn(member["path"], expected_members)
                        self.assertNotIn(member["path"], seen)
                        seen.add(member["path"])
                        wanted = expected_members[member["path"]]
                        self.assertEqual(member["type"], "file" if wanted["kind"] == "file" else "dir")
                        self.assertEqual((member["uid"], member["gid"]), (wanted["uid"], wanted["gid"]))
                        expected_mode = r.restic_file_mode(wanted["mode"]) | ((1 << 31) if wanted["kind"] == "directory" else 0)
                        self.assertEqual(member.get("mode", 0), expected_mode)
                        if wanted["kind"] == "file":
                            self.assertEqual(member["size"], wanted["bytes"])
                    self.assertEqual(seen, set(expected_members))
                    self.probe_facts["mixedSnapshotExactMemberMetadataVerified"] = True
                    mixed_target = r.RestoreTarget(root / "mixed-restore")
                    try:
                        mixed_target.create()
                        self.probe_facts["mixedProducerStage"] = "mixed-hybrid-restore"
                        mixed_adapter.restore(mixed["snapshot"], mixed_target, {**budget, "repositoryBytes": 2 * 1024**2},
                                              inventory=mixed_inventory)
                        self.assertEqual(r.scan(mixed_inventory["roots"], budget, anchor=mixed_target.fd), mixed_inventory)
                        self.probe_facts["mixedMetacharacterRootAndNestedFilesRestored"] = True
                    finally:
                        mixed_target.close()
                    mixed_parent = root / "mixed-replaceable-parent"
                    mixed_parent.mkdir(mode=0o700)
                    mixed_target = r.RestoreTarget(mixed_parent / "restore")
                    try:
                        mixed_target.create()
                        source_alias = mixed["physical"][-2]
                        def substitute_during_stream():
                            mixed_target.path.rename(mixed_parent / "original-target")
                            mixed_target.path.symlink_to(source_alias, target_is_directory=True)
                            mixed_parent.rename(root / "mixed-original-parent")
                            mixed_parent.symlink_to(source_alias, target_is_directory=True)
                        command.before_dump = substitute_during_stream
                        self.probe_facts["mixedProducerStage"] = "mixed-stream-substitution"
                        with self.assertRaises(OSError):
                            mixed_adapter.restore(mixed["snapshot"], mixed_target, {**budget, "repositoryBytes": 2 * 1024**2},
                                                  inventory=mixed_inventory)
                        first = r.root_restore_files(mixed_inventory, budget)[0]
                        root_files = {row["path"] for row in r.root_restore_files(mixed_inventory, budget)}
                        partial_roots = [path for path in mixed_inventory["roots"] if path not in root_files] + [first["path"]]
                        partial_roots.sort(key=lambda path: (len(Path(path).parts), path))
                        partial_entries = [row for row in mixed_inventory["entries"]
                                           if any(Path(row["path"]).is_relative_to(Path(path)) for path in partial_roots)]
                        partial_inventory = {"roots": partial_roots, "entries": partial_entries,
                                             "bytes": sum(row.get("bytes", 0) for row in partial_entries)}
                        self.assertEqual(r.scan(partial_roots, budget, anchor=mixed_target.fd), partial_inventory)
                        self.assertEqual(r.scan(mixed["physical"], budget), mixed["captured"])
                        self.probe_facts["mixedStreamKeptHeldInodeUnderLeafAndParentSubstitution"] = True
                    finally:
                        mixed_target.close()
                finally:
                    mixed_adapter.directory = None
                    mixed_handle.close()
                self.assertLess(sum(p.stat().st_size for p in root.rglob("*") if p.is_file()), 64 * 1024**2)
            finally:
                adapter.directory = None
                target.close()
                handle.close()
        self.assertFalse(root.exists())
        self.probe_facts["fixtureCleanupSuccess"] = True


@unittest.skipUnless(os.environ.get("WARPDRIVE_RECOVERY_CRYPTO_FIXTURE") == "1", "Explicit owned restic fixture only")
class RealResticTests(unittest.TestCase):
    def test_authenticated_encrypted_roundtrip_wrong_key_and_tamper(self):
        fixture = Fixture()
        self.addCleanup(fixture.close)
        binary = Path(os.environ.get("WARPDRIVE_RECOVERY_RESTIC", "/opt/homebrew/bin/restic")).resolve(strict=True)
        command = r.Command()
        # Initialization is fixture-owned only; the production adapter never initializes.
        command.run([str(binary), "--repo", str(fixture.repo), "--password-file", str(fixture.keys[0]),
                     "--no-cache", "init", "--repository-version", "2"], seconds=30)
        fixture.primary = r.Restic(binary, str(fixture.repo), fixture.keys[0], seconds=90)
        fixture.reader = r.Restic(binary, str(fixture.repo), fixture.keys[1], seconds=90)
        fixture.plan["repositoryId"] = fixture.primary.repository_id()
        receipt = fixture.capture()
        self.assertTrue(receipt["isolatedRestoreBytesVerified"])
        self.assertFalse(receipt["offHostAccepted"])
        self.assertEqual(receipt["snapshotId"], fixture.reader.find("warpdrive-recovery:fixture-a")[0])
        self.assertFalse(any(fixture.secret in p.read_bytes() for p in fixture.repo.rglob("*") if p.is_file()))
        wrong = fixture.root / "wrong-key"
        put(wrong, secrets.token_hex(32).encode())
        wrong_reader = r.Restic(binary, str(fixture.repo), wrong, seconds=30)
        with self.assertRaises(r.RecoveryError):
            wrong_reader.repository_id()
        tampered = fixture.root / "tampered-repository"
        shutil.copytree(fixture.repo, tampered)
        config = tampered / "config"
        config.chmod(0o600)
        raw = bytearray(config.read_bytes())
        raw[len(raw) // 2] ^= 1
        config.write_bytes(raw)
        tampered_reader = r.Restic(binary, str(tampered), fixture.keys[1], seconds=30)
        with self.assertRaises(r.RecoveryError):
            tampered_reader.repository_id()
        corrupted_data = fixture.root / "corrupted-data-repository"
        shutil.copytree(fixture.repo, corrupted_data)
        packs = [path for path in (corrupted_data / "data").rglob("*") if path.is_file()]
        self.assertTrue(packs)
        pack = packs[0]
        pack.chmod(0o600)
        packed = bytearray(pack.read_bytes())
        packed[len(packed) // 2] ^= 1
        pack.write_bytes(packed)
        data_reader = r.Restic(binary, str(corrupted_data), fixture.keys[1], seconds=30)
        self.assertEqual(data_reader.repository_id(), fixture.plan["repositoryId"])
        handle = r.DirectoryHandle(corrupted_data, private_parent=True)
        data_reader.directory = handle
        try:
            with self.assertRaises(r.RecoveryError):
                data_reader.run("check", "--read-data")
        finally:
            data_reader.directory = None
            handle.close()


if __name__ == "__main__":
    unittest.main()
