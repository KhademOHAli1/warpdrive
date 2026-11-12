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

    def restore(self, snapshot, target, budget):
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


def exact_root_removal_rejected(standard_error, locator):
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
        if not isinstance(record, dict) or record.get("message_type") != "error" or record.get("during") != "restore" or record.get("item") != "/":
            continue
        error = record.get("error")
        message = error.get("message") if isinstance(error, dict) else None
        if isinstance(message, str) and message in messages:
            return True
    return False


class DescriptorDiagnosticTests(unittest.TestCase):
    def test_only_same_record_exact_terminal_root_can_establish_removal_failure(self):
        def record(path, *, item="/", message=None):
            return json.dumps({"message_type": "error", "during": "restore", "item": item,
                               "error": {"message": message or f"failed to remove stale item: remove {path}: operation not permitted"}}).encode()
        locator = "/proc/self/fd/5"
        self.assertTrue(exact_root_removal_rejected(record(locator), locator))
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


@unittest.skipUnless(sys.platform.startswith("linux") and os.environ.get("WARPDRIVE_RECOVERY_CRYPTO_FIXTURE") == "1",
                     "Explicit native Linux descriptor/restic fixture only")
class RealResticDescriptorTests(unittest.TestCase):
    def test_terminal_descriptor_restore_root_rejected_without_source_mutation(self):
        # Diagnostic only: prove actual restic behavior, with no real-path
        # fallback or product target-locator change. The full roundtrip follows.
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
            command.deadline = time.monotonic() + 25
            command.run([str(binary), "--repo", str(repository), "--password-file", str(key),
                         "--no-cache", "init", "--repository-version", "2"], seconds=10)
            adapter = r.Restic(binary, str(repository), key, command=command, seconds=10)
            handle = r.DirectoryHandle(repository, private_parent=True)
            target = r.RestoreTarget(root / "restore")
            try:
                adapter.directory = handle
                snapshot = adapter.backup([source], "warpdrive-descriptor-preflight")
                target.create()
                locator = target.argument()
                self.assertEqual(locator, f"/proc/self/fd/{target.fd}")
                self.assertTrue(stat.S_ISLNK(os.lstat(locator).st_mode))
                self.assertEqual((os.stat(locator).st_dev, os.stat(locator).st_ino),
                                 (os.fstat(target.fd).st_dev, os.fstat(target.fd).st_ino))
                self.probe_facts["terminalDescriptorIsSymlinkToPinnedDirectory"] = True
                with self.assertRaises(r.ResticFailure) as failure:
                    adapter.restore(snapshot, target, {"repositoryBytes": 2 * 1024**2})
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
                self.assertLess(sum(p.stat().st_size for p in root.rglob("*") if p.is_file()), 2 * 1024**2)
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
