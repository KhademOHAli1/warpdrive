"""Fail-closed cold storage witnesses for the exact installed relay profile."""

from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import installed_cold_relay_storage as cold
from caddy_web_config import ADMIN_SOCKET
from installed_web_relay import AUTOSAVE_DIR, AUTOSAVE_FILE, INGRESS, SOCKET_DIR, create_document
from recovery import RecoveryError
from web_switch import content_hash


SUFFIX = "123456abcdef"
ALIAS = "warpdrive-web-relay-" + SUFFIX
RELAY = "1" * 64
INGRESS_ID = "2" * 64
IMAGE = "sha256:" + "3" * 64
MANIFEST = {"digest": "sha256:" + "4" * 64, "size": 1024,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "platform": {"os": "linux", "architecture": "amd64"}}


class InstalledColdRelayStorageTests(unittest.TestCase):
    def setUp(self):
        self.private = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.relay = self.private / ("first-web-release-" + SUFFIX) / "relay"
        self.config, self.socket = self.relay / "config", self.relay / "socket"
        self.caddy = self.config / "caddy"
        for directory in (self.relay.parent, self.relay, self.config, self.caddy, self.socket):
            directory.mkdir(mode=0o700)
        self.autosave = self.config / AUTOSAVE_FILE
        self.document = {"admin": {"listen": f"unix/{ADMIN_SOCKET}|0600", "config": {"persist": True}},
                         "apps": {"http": {"servers": {"relay": {"listen": [":8080"]}}}}}
        self.raw = json.dumps(self.document, indent=1).encode() + b"\n"
        self.write_autosave(self.raw)
        # Only sandbox filesystem ownership and root pathname vary. The native
        # container create contract still uses its real fixed UID/GID and paths.
        self.enterContext(patch.multiple(cold, INSTALLED_PRIVATE_ROOT=self.private,
                                         _ROOT_UID=os.geteuid(), _ROOT_GID=os.getegid(),
                                         _RELAY_UID=os.geteuid(), _RELAY_GID=os.getegid()))
        self.enterContext(patch("installed_web_relay._directory", side_effect=self.fixture_relay_directory))
        expected = create_document(self.relay, alias=ALIAS, image=IMAGE, ingress_id=INGRESS_ID)
        self.row = {
            "Id": RELAY, "Name": "/" + ALIAS, "Image": IMAGE, "ImageManifestDescriptor": deepcopy(MANIFEST),
            "RestartCount": 0,
            "Config": {key: deepcopy(expected[key]) for key in ("User", "Entrypoint", "Cmd", "Env", "Labels", "ExposedPorts")},
            "HostConfig": deepcopy(expected["HostConfig"]),
            "State": {"Status": "exited", "Pid": 0, "Running": False, "ExitCode": 0, "Error": "",
                      "OOMKilled": False, "Paused": False, "Restarting": False, "Dead": False,
                      "StartedAt": "2026-11-13T14:00:00.000000001Z", "FinishedAt": "2026-11-13T14:10:00Z"},
            "NetworkSettings": {"Networks": {INGRESS: {"NetworkID": INGRESS_ID, "Aliases": [ALIAS],
                                                         "EndpointID": "", "IPAddress": ""}}},
            "Mounts": [{"Source": str(self.socket), "Destination": SOCKET_DIR, "Type": "bind", "RW": True,
                        "Propagation": "rprivate"},
                       {"Source": str(self.config), "Destination": AUTOSAVE_DIR, "Type": "bind", "RW": True,
                        "Propagation": "rprivate"}],
        }
        self.peer = self.private / "unrelated"
        self.peer.mkdir(mode=0o700)

    @staticmethod
    def fixture_relay_directory(path, _uid):
        return path.lstat()

    def write_autosave(self, raw):
        self.autosave.write_bytes(raw)
        self.autosave.chmod(0o600)

    def observe(self, *, row=None, peers=None, **overrides):
        return cold.observe_installed_cold_relay_storage(
            self.row if row is None else row, [] if peers is None else peers,
            **({"relay_directory": self.relay, "relay_id": RELAY, "alias": ALIAS, "image_id": IMAGE,
                "ingress_id": INGRESS_ID, "manifest": MANIFEST,
                "accepted_route_sha256": content_hash(self.document)} | overrides),
        )

    def row_with(self, member, **changes):
        row = deepcopy(self.row)
        row[member].update(changes)
        return row

    def peer_with(self, path):
        return [{"Id": "5" * 64, "Mounts": [{"Type": "bind", "Source": str(path), "RW": False}]}]

    def test_exact_stopped_profile_retains_only_autosave_and_stable_witness(self):
        witness = self.observe(peers=self.peer_with(self.peer))
        self.assertEqual(witness["root"], str(self.autosave))
        self.assertEqual(witness["excludedSocketDirectory"], str(self.socket))
        self.assertEqual(witness["witness"]["autosaveSha256"], sha256(self.raw).hexdigest())
        self.assertEqual(witness["witness"]["acceptedRouteSha256"], content_hash(self.document))
        self.assertEqual(witness, self.observe(peers=self.peer_with(self.peer)))
        self.assertEqual(self.autosave.read_bytes(), self.raw)

    def test_requires_pinned_role_image_ingress_and_clean_cold_state(self):
        for overrides in ({"relay_id": "6" * 64}, {"image_id": "sha256:" + "7" * 64},
                          {"alias": "warpdrive-web-relay-000000000000"}, {"ingress_id": "8" * 64},
                          {"manifest": {**MANIFEST, "digest": "sha256:" + "9" * 64}}):
            with self.subTest(overrides=overrides), self.assertRaises(RecoveryError):
                self.observe(**overrides)
        for state in ({"Status": "created"}, {"Pid": 42}, {"ExitCode": 137}, {"ExitCode": False},
                      {"Running": True}, {"Restarting": True}, {"OOMKilled": True}, {"Dead": True},
                      {"FinishedAt": "0001-01-01T00:00:00Z"}):
            with self.subTest(state=state), self.assertRaisesRegex(RecoveryError, "cleanly stopped"):
                self.observe(row=self.row_with("State", **state))

    def test_refuses_startup_override_or_relabelled_ingress(self):
        env = self.row["Config"]["Env"]
        for row in (self.row_with("Config", Cmd=["caddy", "run"]),
                    self.row_with("Config", Env=env + [env[0]]),
                    self.row_with("Config", Labels={**self.row["Config"]["Labels"], "traefik.http.injected": "true"}),
                    self.row_with("HostConfig", Privileged=True), self.row_with("HostConfig", UsernsMode="host"),
                    self.row_with("HostConfig", PortBindings={"8080/tcp": [{}]}),
                    self.row_with("NetworkSettings", Networks={INGRESS: {"NetworkID": "", "Aliases": [ALIAS]}}),
                    self.row_with("NetworkSettings", Networks={INGRESS: {"NetworkID": INGRESS_ID, "Aliases": ["postgres"]}})):
            with self.assertRaises(RecoveryError):
                self.observe(row=row)

    def test_rejects_extra_changed_or_shared_mounts_and_foreign_stage_paths(self):
        extra = deepcopy(self.row)
        extra["Mounts"].append({"Type": "bind", "Source": str(self.peer), "Destination": "/extra", "RW": True})
        swapped = deepcopy(self.row)
        swapped["Mounts"][0]["Source"] = str(self.peer)
        propagated = deepcopy(self.row)
        propagated["Mounts"][0]["Propagation"] = "rshared"
        for row in (extra, swapped, propagated):
            with self.assertRaisesRegex(RecoveryError, "exact writable binds"):
                self.observe(row=row)
        for mount in (self.private, self.config, self.socket, self.autosave):
            with self.subTest(mount=mount), self.assertRaisesRegex(RecoveryError, "can access"):
                self.observe(peers=self.peer_with(mount))
        self.assertEqual(self.observe(peers=self.peer_with(self.peer))["root"], str(self.autosave))
        with self.assertRaisesRegex(RecoveryError, "exact installed|Exact installed"):
            self.observe(relay_directory=self.private / "private-relay")

    def test_unrelated_docker_socket_is_inspected_without_opening_special_files(self):
        control = self.peer / "docker.sock"
        with socket.socket(socket.AF_UNIX) as owned:
            with TemporaryDirectory(dir="/tmp") as short:
                path = Path(short) / "s"
                owned.bind(str(path))
                path.rename(control)
                self.assertEqual(self.observe(peers=self.peer_with(control))["root"], str(self.autosave))
        fifo = self.peer / "unexpected-fifo"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(RecoveryError, "Unobserved Docker peer source authority"):
            self.observe(peers=self.peer_with(fifo))

    def test_refuses_socket_residue_extra_config_and_wrong_mode_or_owner(self):
        residue = self.socket / "control.sock"
        residue.touch()
        with self.assertRaisesRegex(RecoveryError, "socket bind must be empty"):
            self.observe()
        residue.unlink()
        with socket.socket(socket.AF_UNIX) as active:
            # Some platform temp paths exceed sockaddr_un when using the real
            # relay path. Bind relative to a short owned separate directory.
            with TemporaryDirectory(dir="/tmp") as short:
                socket_path = Path(short) / "s"
                active.bind(str(socket_path))
                socket_path.rename(residue)
                with self.assertRaisesRegex(RecoveryError, "socket bind must be empty"):
                    self.observe()
                residue.unlink()
        extra = self.caddy / "unspecified.json"
        extra.touch()
        with self.assertRaisesRegex(RecoveryError, "Unexpected files"):
            self.observe()
        extra.unlink()
        self.autosave.chmod(0o644)
        with self.assertRaisesRegex(RecoveryError, "private relay autosave"):
            self.observe()
        self.autosave.chmod(0o600)
        self.config.chmod(0o755)
        with self.assertRaisesRegex(RecoveryError, "directory authority differs"):
            self.observe()
        self.config.chmod(0o700)
        with patch.object(cold, "_RELAY_GID", os.getegid() + 1), self.assertRaisesRegex(RecoveryError, "authority differs"):
            self.observe()

    def test_refuses_links_in_autosave_or_peer_storage(self):
        copy = self.peer / "autosave-copy"
        os.link(self.autosave, copy)
        with self.assertRaisesRegex(RecoveryError, "private relay autosave"):
            self.observe()
        with self.assertRaises(RecoveryError):
            self.observe(peers=self.peer_with(copy))
        copy.unlink()
        self.autosave.rename(copy)
        self.autosave.symlink_to(copy)
        with self.assertRaises(RecoveryError):
            self.observe()
        self.autosave.unlink()
        copy.rename(self.autosave)
        symlink = self.peer / "alternate"
        symlink.symlink_to(self.socket, target_is_directory=True)
        with self.assertRaises(RecoveryError):
            self.observe(peers=self.peer_with(symlink))
        self.caddy.rename(self.peer / "caddy")
        self.caddy.symlink_to(self.peer / "caddy", target_is_directory=True)
        with self.assertRaises(RecoveryError):
            self.observe()

    def test_rejects_wrong_route_duplicate_json_and_path_replacement(self):
        with self.assertRaisesRegex(RecoveryError, "accepted route"):
            self.observe(accepted_route_sha256="a" * 64)
        self.write_autosave(self.raw.replace(b'"apps":', b'"apps": null, "apps":', 1))
        with self.assertRaises(RecoveryError):
            self.observe()
        self.write_autosave(self.raw)
        original = cold._read_autosave

        def replace_after_read(fd):
            result = original(fd)
            self.autosave.rename(self.peer / "original")
            self.write_autosave(self.raw)
            return result

        with patch.object(cold, "_read_autosave", side_effect=replace_after_read):
            with self.assertRaisesRegex(RecoveryError, "changed during inspection"):
                self.observe()


if __name__ == "__main__":
    unittest.main()
