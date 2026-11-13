"""Bracket the exact two private Web slot profiles with owned fixture storage."""

from copy import deepcopy
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import installed_cold_web_slots as cold
from installed_web_runtime import DATABASE, NETWORKS, verify_candidate
from installed_web_successor import _document
from recovery import RecoveryError
from test_installed_web_operator import NETWORK_IDS, candidate_fixture
from web_switch import content_hash


DATABASE_ROLE = "warpdrive_runtime"
DATABASE_NAME = "warpdrive"
OWNED_DSN = "postgresql://warpdrive_runtime:fixture-private-password@postgres:5432/warpdrive\n"


class InstalledColdWebSlotsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.secrets = self.root / "exported-secrets"
        self.release = self.root / "private" / "split-release-synthetic"
        self.secrets.mkdir(mode=0o700)
        self.release.mkdir(mode=0o700, parents=True)
        self.runtime_secret = self.release / "runtime-database-url"
        self.enterContext(patch.multiple(cold, INSTALLED_ROOT=self.root, SECRET_UID=os.geteuid()))
        # Ownership checks stay real, with the fixture's group in place of the
        # one root-owned group on the production storage application secret.
        original = cold._read_secret
        self.enterContext(patch.object(cold, "_read_secret", side_effect=lambda p, _gid, m: original(p, os.getegid(), m)))
        self.write(self.runtime_secret, OWNED_DSN.encode())
        for filename in cold._FILE_INPUTS.values():
            if filename != "database_url":
                self.write(self.secrets / filename, ("fixture-secret-" + filename).encode(),
                           mode=0o440 if filename == "storage_app_secret" else 0o400)
        self.running, slots = {}, {}
        self.networks = {name: {"Id": identifier, "Name": name, "Driver": "bridge", "Scope": "local",
                                "Internal": name == NETWORKS[1], "Labels": {"fixture": "private"}, "Containers": {}}
                         for name, identifier in NETWORK_IDS.items()}
        for index, side in enumerate(("active", "previous"), 1):
            document, row = candidate_fixture()
            alias, revision, identifier = "warpdrive-web-" + str(index) * 12, str(index) * 40, str(index + 3) * 64
            image = "sha256:" + str(index) * 64
            environment = dict(item.split("=", 1) for item in document["Env"])
            environment.update({key + "_FILE": "/run/secrets/" + filename for key, filename in cold._FILE_INPUTS.items()})
            mounts = document["HostConfig"]["Mounts"]
            for mount in mounts:
                target = mount["Target"]
                mount["Source"] = str(self.runtime_secret if target == DATABASE else self.secrets / Path(target).name)
            profile = {"environment": environment, "mounts": mounts, "healthcheck": document["Healthcheck"],
                       "limits": {key: value for key, value in document["HostConfig"].items()
                                  if key not in {"NetworkMode", "Mounts", "RestartPolicy"}}, "networks": NETWORK_IDS}
            document = _document(profile, image=image, revision=revision, alias=alias)
            row.update(Id=identifier, Name="/" + alias, Image=image,
                       ImageManifestDescriptor={"digest": image, "size": 2048,
                                                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                                                "platform": {"os": "linux", "architecture": "amd64"}})
            row["Config"] = {key: value for key, value in document.items() if key not in {"HostConfig", "NetworkingConfig"}}
            row["HostConfig"] = document["HostConfig"]
            row["Mounts"] = [{"Type": "bind", "Source": mount["Source"], "Destination": mount["Target"],
                              "RW": False, "Propagation": "rprivate"} for mount in mounts]
            row["State"].update(Pid=500 + index, Dead=False, Error="")
            hosts, resolvers = self.root / f"{side}-hosts", self.root / f"{side}-resolv.conf"
            self.write(hosts, f"127.0.0.1 localhost\n10.0.1.{index} {alias}\n".encode())
            self.write(resolvers, b"nameserver 127.0.0.11\noptions ndots:0\n")
            row.update(HostsPath=str(hosts), ResolvConfPath=str(resolvers))
            row["NetworkSettings"]["Networks"] = deepcopy(document["NetworkingConfig"]["EndpointsConfig"])
            for subnet, name in enumerate(NETWORKS, 1):
                address, endpoint_id = f"10.0.{subnet}.{index + 10}", str(subnet * 2 + index) * 64
                row["NetworkSettings"]["Networks"][name].update(EndpointID=endpoint_id, IPAddress=address,
                                                              DNSNames=[alias, identifier[:12]])
                self.networks[name]["Containers"][identifier] = {"Name": alias, "EndpointID": endpoint_id,
                                                                 "IPv4Address": address + "/24"}
            runtime = verify_candidate(row, document, alias=alias, network_ids=NETWORK_IDS,
                                       runtime_secret=str(self.runtime_secret), require_ready=True)
            self.running[side] = row
            slots[side] = {"alias": alias, "slot": {"runtime": {**runtime, "schemaSha256": "a" * 64},
                "route": {"runtimeId": identifier, "generation": "wd-" + revision, "fingerprint": str(index) * 64}}}
        self.chain = {"targetKey": "pitant-warpdrive", "backendFingerprint": "b" * 64,
                      "acceptedOperationId": "fixture-before-stop", "acceptedPlanSha256": "c" * 64, **slots}
        self.before = self.preflight()
        self.cold_rows, self.cold_networks = deepcopy(self.running), deepcopy(self.networks)
        for row in self.cold_rows.values():
            row["State"].update(Pid=0, Status="exited", ExitCode=0, Running=False, FinishedAt="2026-11-13T09:02:00Z")
            for endpoint in row["NetworkSettings"]["Networks"].values():
                endpoint.update(EndpointID="", IPAddress="", DNSNames=None)
        for network in self.cold_networks.values():
            network["Containers"].clear()

    @staticmethod
    def write(path, contents, *, mode=0o400):
        path.chmod(0o600) if path.exists() else path.touch(mode=0o600)
        path.write_bytes(contents)
        path.chmod(mode)

    def pins(self):
        return {"chain": self.chain, "chain_sha256": content_hash(self.chain), "network_ids": NETWORK_IDS,
                "runtime_secret": self.runtime_secret, "database_role": DATABASE_ROLE, "database_name": DATABASE_NAME}

    def preflight(self, **overrides):
        return cold.observe_installed_web_slots_before_stop(self.running, self.networks, **(self.pins() | overrides))

    def observe(self, rows=None, networks=None, **overrides):
        pins = {**self.pins(), "before_stop": self.before, "before_stop_sha256": content_hash(self.before), **overrides}
        return cold.observe_installed_cold_web_slots(self.cold_rows if rows is None else rows,
                                                    self.cold_networks if networks is None else networks, **pins)

    def test_two_pinned_stopped_web_slots_share_exact_secrets_without_emitting_them(self):
        witness = self.observe()
        self.assertEqual(len(witness["roots"]), 6)
        self.assertIn(str(self.runtime_secret), witness["roots"])
        self.assertEqual(set(witness["witness"]["slots"]), {"active", "previous"})
        self.assertEqual(self.observe(), witness)
        self.assertNotIn("fixture-private-password", json.dumps(witness))
        self.assertNotIn("fixture-secret-auth_secret", json.dumps(self.before))

    def test_rejects_changed_pins_wrong_pair_or_legacy_alias(self):
        for changes in ({"chain_sha256": "e" * 64}, {"before_stop_sha256": "e" * 64}, {"database_role": "warpdrive_owner"}):
            with self.subTest(changes=changes), self.assertRaises(RecoveryError):
                self.observe(**changes)
        chain = deepcopy(self.chain)
        chain["previous"]["alias"] = "app"
        with self.assertRaises(RecoveryError):
            self.observe(chain=chain, chain_sha256=content_hash(chain))
        with self.assertRaises(RecoveryError):
            self.observe(rows={"active": self.cold_rows["active"], "previous": self.cold_rows["active"]})

    def test_rejects_unclean_stops_changed_start_and_static_runtime(self):
        for state in ({"Running": True}, {"Status": "created"}, {"Pid": 401}, {"ExitCode": 137}, {"ExitCode": False},
                      {"FinishedAt": "2026-11-13T08:00:00Z"}, {"OOMKilled": True}, {"Dead": True},
                      {"StartedAt": "2026-11-13T09:01:00Z"}):
            rows = deepcopy(self.cold_rows)
            rows["active"]["State"].update(state)
            with self.subTest(state=state), self.assertRaises(RecoveryError):
                self.observe(rows=rows)
        rows = deepcopy(self.cold_rows)
        rows["active"]["Config"]["Env"].append("UNRELATED_STATIC_CHANGE=yes")
        with self.assertRaises(RecoveryError):
            self.observe(rows=rows)

    def test_rejects_blank_network_id_bridge_drift_and_live_endpoints(self):
        network = NETWORKS[0]
        for changes in ({"NetworkID": ""}, {"EndpointID": "a" * 64}, {"IPAddress": "10.0.0.1"},
                        {"GlobalIPv6Address": "fe80::1"}, {"DNSNames": ["postgres"]}):
            rows = deepcopy(self.cold_rows)
            rows["previous"]["NetworkSettings"]["Networks"][network].update(changes)
            with self.subTest(changes=changes), self.assertRaises(RecoveryError):
                self.observe(rows=rows)
        networks = deepcopy(self.cold_networks)
        networks[network]["Internal"] = not networks[network]["Internal"]
        with self.assertRaisesRegex(RecoveryError, "bridge changed after stop"):
            self.observe(networks=networks)
        networks = deepcopy(self.cold_networks)
        networks[network]["Containers"] = self.networks[network]["Containers"]
        with self.assertRaisesRegex(RecoveryError, "live network endpoint"):
            self.observe(networks=networks)

    def test_rejects_mount_authority_and_secret_file_drift(self):
        secret = self.secrets / "auth_secret"
        previous = secret.read_bytes()
        self.write(secret, b"rotated-secret")
        with self.assertRaisesRegex(RecoveryError, "secret or start identity changed"):
            self.observe()
        self.write(secret, previous, mode=0o644)
        with self.assertRaisesRegex(RecoveryError, "private Web secret file"):
            self.observe()
        secret.chmod(0o400)
        hard_link = self.root / "hard-link"
        os.link(secret, hard_link)
        with self.assertRaisesRegex(RecoveryError, "bounded installed Web file"):
            self.observe()
        hard_link.unlink()
        secret.rename(hard_link)
        secret.symlink_to(hard_link)
        with self.assertRaises(RecoveryError):
            self.observe()

    def test_preflight_rejects_database_authority_and_endpoint_conflict(self):
        for dsn in (OWNED_DSN.replace("@postgres", "@external"), OWNED_DSN.replace(DATABASE_ROLE, "owner"),
                    OWNED_DSN.rstrip() + "?host=other", OWNED_DSN.rstrip() + "?sslmode=disable&sslmode=require"):
            self.write(self.runtime_secret, dsn.encode())
            with self.subTest(dsn=dsn.split("?")[0].split("@")[-1]), self.assertRaisesRegex(RecoveryError, "role or bridge"):
                self.preflight()
        self.write(self.runtime_secret, OWNED_DSN.encode())
        name = NETWORKS[1]
        identifier = self.running["active"]["Id"]
        self.networks[name]["Containers"][identifier]["EndpointID"] = "a" * 64
        with self.assertRaisesRegex(RecoveryError, "member differs"):
            self.preflight()

    def test_resolver_allows_docker_stop_rewrite_but_rejects_overrides_and_new_authority(self):
        row = self.cold_rows["active"]
        hosts, resolv = Path(row["HostsPath"]), Path(row["ResolvConfPath"])
        self.write(hosts, b"127.0.0.1 localhost\n")
        self.assertIn("roots", self.observe())
        self.write(hosts, b"127.0.0.1 localhost\n10.0.0.5 Postgres.\n")
        with self.assertRaisesRegex(RecoveryError, "hosts file overrides"):
            self.observe()
        self.write(hosts, b"127.0.0.1 localhost\n")
        self.write(resolv, b"nameserver 127.0.0.11\nnameserver 1.1.1.1\n")
        with self.assertRaisesRegex(RecoveryError, "Docker resolver"):
            self.observe()
        self.write(resolv, b"nameserver 127.0.0.11\n")
        alternate = self.root / "alternate-hosts"
        self.write(alternate, hosts.read_bytes())
        row["HostsPath"] = str(alternate)
        with self.assertRaisesRegex(RecoveryError, "resolver path authority changed"):
            self.observe()


if __name__ == "__main__":
    unittest.main()
