"""Verify exact single-Web transport admission without a live Docker daemon."""

from copy import deepcopy
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import installed_web_image as installed
import test_web_candidate as fixture_tools


BASELINE_REVISION, ORIGIN, REVISION = fixture_tools.BASELINE_REVISION, fixture_tools.ORIGIN, fixture_tools.REVISION


DAEMON = {"serverId": "fixture-daemon", "socketDevice": 4, "socketInode": 91}


class InstalledWebImageTests(unittest.TestCase):
    def setUp(self):
        fixture = fixture_tools.WebCandidateTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.admitted = fixture.pack()
        self.directory = fixture.output
        self.state = fixture.private / "installed-state"
        self.state.mkdir(mode=0o700)
        self.archive = self.directory / installed.candidate.ARCHIVE
        self.archive.chmod(0o600)
        self.image = self.admitted["candidate"]["image"]
        self.provenance = self.admitted["provenance"]
        self.arguments = {"state_dir": self.state, "expected_revision": REVISION,
                          "expected_manifest_sha256": self.provenance["bundleManifestSha256"],
                          "baseline_revision": BASELINE_REVISION,
                          "baseline_manifest_sha256": fixture.baseline["provenance"]["bundleManifestSha256"],
                          "expected_origin": ORIGIN, "expected_daemon": DAEMON}
        descriptor, = json.loads(fixture.docker.members()["index.json"])["manifests"]
        self.manifest = descriptor["digest"]
        config = json.loads(fixture.docker.raw_config)
        self.inspection = {"Id": self.manifest, "Descriptor": descriptor, "Os": "linux", "Architecture": "amd64",
                           "Config": config["config"], "RootFS": {"Type": "layers", "Layers": config["rootfs"]["diff_ids"]},
                           "RepoTags": [], "RepoDigests": []}
        self.inventory = {"sha256:" + "3" * 64: [["fixture", "retained", "<none>"]]}
        self.docker = Mock()
        self.docker.identity.return_value = DAEMON
        self.docker.inventory.side_effect = lambda: deepcopy(self.inventory)
        self.docker.inspect.side_effect = self.inspect
        self.docker.load.side_effect = self.effect

    def inspect(self, digest):
        self.assertEqual(digest, self.manifest)
        return [deepcopy(self.inspection)]

    def effect(self, source):
        self.assertEqual(source.tell(), 0)
        self.assertEqual(source.read(), self.archive.read_bytes())
        self.assertEqual(json.loads((self.state / installed.JOURNAL).read_bytes())["payload"]["state"], "intent")
        self.inventory[self.manifest] = deepcopy(installed.DANGLING)

    def load(self, **overrides):
        return installed.load_installed_web_image(self.directory, docker=self.docker, **(self.arguments | overrides))

    def test_verified_bundle_to_native_manifest_load_and_repeat_read_only(self):
        result = self.load()
        self.assertEqual(result["imageId"], self.manifest)
        self.assertEqual(result["manifestDigest"], self.manifest)
        self.assertEqual(result["testedConfigDigest"], self.image["imageId"])
        self.assertNotEqual(result["testedConfigDigest"], self.manifest)
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result, self.load())
        self.docker.load.assert_called_once()
        self.docker.admit_capacity.assert_called_once_with(DAEMON, self.archive.stat().st_size)
        self.assertEqual(json.loads((self.state / installed.JOURNAL).read_bytes())["payload"]["state"], "verified")

    def test_lost_ack_is_reconciled_only_by_exact_readback(self):
        def lose(source):
            self.effect(source)
            raise TimeoutError("fixture lost response")

        self.docker.load.side_effect = lose
        with self.assertRaises(installed.WebImageUnknown):
            self.load()
        journal = self.state / installed.JOURNAL
        retained = journal.read_bytes()
        with self.assertRaisesRegex(installed.WebImageUnknown, "Prior load intent"):
            self.load()
        self.assertEqual(self.load(reconcile=True)["state"], "verified")
        self.assertEqual(journal.read_bytes(), retained)
        self.docker.load.assert_called_once()

    def test_absent_after_ack_remains_unknown_and_never_replays(self):
        self.docker.load.side_effect = None
        with self.assertRaises(installed.WebImageUnknown):
            self.load()
        with self.assertRaises(installed.WebImageUnknown):
            self.load(reconcile=True)
        self.docker.load.assert_called_once()

    def test_preexisting_anonymous_image_is_adopted_read_only(self):
        self.inventory[self.manifest] = deepcopy(installed.DANGLING)
        result = self.load()
        self.assertEqual(result["beforeInventorySha256"], result["afterInventorySha256"])
        self.docker.load.assert_not_called()
        self.docker.admit_capacity.assert_not_called()

    def test_tagged_or_wrong_native_descriptor_refuses_before_any_write(self):
        self.inventory[self.manifest] = [["fixture", "mutable", "<none>"]]
        with self.assertRaisesRegex(installed.WebImageError, "tags"):
            self.load()
        self.inventory[self.manifest] = deepcopy(installed.DANGLING)
        self.inspection["Descriptor"]["digest"] = self.image["imageId"]
        with self.assertRaisesRegex(installed.WebImageError, "runtime metadata"):
            self.load()
        self.docker.load.assert_not_called()
        self.assertEqual(list(self.state.iterdir()), [])

    def test_mutation_or_wrong_daemon_does_not_reach_docker_load(self):
        self.docker.identity.return_value = DAEMON | {"socketInode": 100}
        with self.assertRaisesRegex(installed.WebImageError, "daemon differs"):
            self.load()
        self.docker.identity.reset_mock()
        data = self.archive.read_bytes()
        self.archive.write_bytes(data[:-1] + b"x")
        with self.assertRaisesRegex(installed.candidate.CandidateError, "archive digest differs"):
            self.load()
        self.docker.identity.assert_not_called()
        self.docker.load.assert_not_called()

    def test_held_file_reverified_after_bundle_admission(self):
        original = installed.candidate.load_web_bundle

        def substitute(*args, **kwargs):
            result = original(*args, **kwargs)
            data = self.archive.read_bytes()
            self.archive.write_bytes(data[:-1] + b"x")
            return result

        with patch.object(installed.candidate, "load_web_bundle", side_effect=substitute):
            with self.assertRaisesRegex(installed.WebImageError, "Held Web archive differs"):
                self.load()
        self.docker.identity.assert_not_called()
        self.docker.load.assert_not_called()

    def test_unrelated_inventory_drift_is_unknown_and_blocks_next_load(self):
        def drift(source):
            self.effect(source)
            self.inventory["sha256:" + "4" * 64] = deepcopy(installed.DANGLING)

        self.docker.load.side_effect = drift
        with self.assertRaises(installed.WebImageUnknown):
            self.load()
        with self.assertRaises(installed.WebImageUnknown):
            self.load(reconcile=True)
        self.docker.load.assert_called_once()

    def test_journal_substitution_and_unowned_state_refuse_without_replay(self):
        self.load()
        path = self.state / installed.JOURNAL
        path.chmod(0o644)
        with self.assertRaisesRegex(installed.WebImageError, "Private image-load journal"):
            self.load()
        path.chmod(0o600)
        record = json.loads(path.read_bytes())
        record["payload"]["state"] = "intent"
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(installed.WebImageError, "checksum differs"):
            self.load()
        self.docker.load.assert_called_once()


class DockerCommandTests(unittest.TestCase):
    def test_adapter_uses_only_fixed_unix_load_command_with_stream_input(self):
        docker = object.__new__(installed.LocalDocker)
        docker.binary = "/usr/bin/docker"
        docker.socket = (4, 91)
        data = io.BytesIO(b"fixture")
        with patch.object(docker, "_socket_identity", return_value=docker.socket), patch.object(
            installed.subprocess, "run", return_value=Mock(returncode=0),
        ) as command:
            docker.load(data)
        self.assertEqual(command.call_args.args[0], ["/usr/bin/docker", "--host", "unix:///run/docker.sock", "image", "load",
                                                     "--platform", "linux/amd64", "--quiet"])
        self.assertIs(command.call_args.kwargs["stdin"], data)
        self.assertEqual(command.call_args.kwargs["env"], {"PATH": installed.SYSTEM_PATH})

    def test_capacity_checks_both_admitted_stores(self):
        docker = object.__new__(installed.LocalDocker)
        docker.containerd_root = Path("/fixture/containerd")
        docker.storage = (4, 42)
        capacity = installed.DISK_RESERVE + 1000
        with patch.object(docker, "_info", return_value=(DAEMON, "/fixture/docker")), patch.object(
            docker, "_storage_identity", return_value=docker.storage,
        ), patch.object(installed.shutil, "disk_usage", side_effect=[Mock(free=capacity), Mock(free=capacity - 1000)]) as usage:
            with self.assertRaisesRegex(installed.WebImageError, "disk reserve"):
                docker.admit_capacity(DAEMON, 500)
        self.assertEqual([entry.args[0] for entry in usage.call_args_list], [Path("/fixture/docker"), docker.containerd_root])


if __name__ == "__main__":
    unittest.main()
