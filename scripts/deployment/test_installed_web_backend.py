"""Exercise the installed Core guard against independently pinned native-shaped readback."""

from copy import deepcopy
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from installed_docker import DockerNativeError
from installed_web_backend import COMPONENTS, RUNNING, observe_backend, observe_retained_core, process_witness, read_direct_core
from installed_web_runtime import NETWORKS, WebRuntimeError
from web_switch import canonical, content_hash


def digest(byte):
    return "sha256:" + byte * 64


class DockerReadback:
    def __init__(self):
        self.calls = []
        self.rows = {}
        self.networks = {}
        self.image = None

    def inspect(self, identifier):
        self.calls.append(("inspect", identifier))
        return deepcopy(self.rows[identifier])

    def network(self, identifier):
        self.calls.append(("network", identifier))
        return deepcopy(self.networks[identifier])

    def request(self, method, path):
        self.calls.append((method, path))
        assert method == "GET" and path == f"/images/{self.image['Descriptor']['digest']}/json?manifests=true"
        return deepcopy(self.image)


def process(component, identifier, running):
    return {"Id": identifier, "Name": "/warpdrive-" + component, "Image": digest(identifier[0]),
            "State": {"Status": "running" if running else "exited", "Pid": 500 if running else 0,
                      "Running": running, "OOMKilled": False, "Paused": False, "Restarting": False, "ExitCode": 0,
                      "StartedAt": "2026-11-13T10:15:00.123456789Z", "FinishedAt": "0001-01-01T00:00:00Z"},
            "RestartCount": 0, "Mounts": [], "HostConfig": {},
            "Config": {"Labels": {"com.docker.compose.project": "pitant-warpdrive",
                                  "com.docker.compose.service": component}}, "NetworkSettings": {"Networks": {}}}


class RetainedCoreTests(unittest.TestCase):
    def setUp(self):
        self.docker = DockerReadback()
        self.ids = {component: f"{index:x}" * 64 for index, component in enumerate(sorted(COMPONENTS), start=1)}
        for component, identifier in self.ids.items():
            self.docker.rows[identifier] = process(component, identifier, component in RUNNING)
        self.pins = {component: {"id": identifier, "pid": self.docker.rows[identifier]["State"]["Pid"]}
                     for component, identifier in self.ids.items()}
        self.schema = "a" * 64
        self.postgres = self.ids["postgres"]
        self.core_id = "e" * 64
        self.core = process("core-api", self.core_id, True)
        self.core["State"]["Pid"] = 608
        self.docker.rows[self.core_id] = self.core
        config_digest = digest("b")
        media_type = "application/vnd.oci.image.manifest.v1+json"
        self.raw = json.dumps({"schemaVersion": 2, "mediaType": media_type, "config": {
            "mediaType": "application/vnd.oci.image.config.v1+json", "digest": config_digest, "size": 1294},
            "layers": [{"mediaType": "application/vnd.oci.image.layer.v1.tar+gzip", "digest": digest("c"), "size": 172}]})
        manifest_id = "sha256:" + sha256(self.raw.encode()).hexdigest()
        manifest = {"mediaType": media_type, "size": len(self.raw.encode()), "digest": manifest_id,
                    "platform": {"os": "linux", "architecture": "amd64"}}
        revision = "d" * 40
        image_reference = "registry.example.invalid/warpdrive/core-api@" + manifest_id
        config = self.core["Config"]
        config.update(Image=image_reference, User="bun", WorkingDir="/app", Cmd=["bun", "--no-env-file", "dist/core-api.mjs"],
                      Entrypoint=["/usr/local/bin/docker-entrypoint.sh"], StopTimeout=75, ExposedPorts={"3010/tcp": {}},
                      Env=["NODE_ENV=production", "RUNTIME_COMPONENT=core-api", "CORE_HOST=0.0.0.0", "CORE_PORT=3010",
                           "APP_COMMIT=" + revision, "DATABASE_URL=postgres://restricted:do-not-emit@postgres:5432/warpdrive"])
        config["Labels"].update({"org.opencontainers.image.revision": revision, "traefik.enable": "false"})
        self.core.update(Image=manifest_id, ImageManifestDescriptor=deepcopy(manifest))
        self.core["HostConfig"].update(NetworkMode=NETWORKS[1], IpcMode="private", Privileged=False, PublishAllPorts=False,
                                       ReadonlyRootfs=True, CapDrop=["ALL"], Init=True, SecurityOpt=["no-new-privileges:true"])
        self.core["NetworkSettings"]["Ports"] = {"3010/tcp": None}
        self.docker.image = {"Id": manifest_id, "Os": "linux", "Architecture": "amd64",
                             "Descriptor": {key: manifest[key] for key in ("mediaType", "size", "digest")},
                             "Config": {key: deepcopy(config[key]) for key in ("Cmd", "Entrypoint", "User", "Labels")}}
        net_ids = ("7" * 64, "8" * 64)
        for name, net_id in zip(NETWORKS, net_ids, strict=True):
            self.docker.networks[net_id] = {"Name": name, "Id": net_id, "Driver": "bridge", "Scope": "local", "Containers": {}}
        ingress = self.attach(self.core_id, net_ids[0], "10.9.0.5", "9", "warpdrive-core-api")
        database = self.attach(self.core_id, net_ids[1], "172.29.0.5", "a", "core-api")
        self.attach(self.ids["edge"], net_ids[0], "10.9.0.2", "b", "traefik")
        self.attach(self.postgres, net_ids[1], "172.29.0.2", "c", "postgres")
        self.pin = {key: value for key, value in process_witness(self.core, running=True).items() if key not in {"service", "finishedAt"}}
        self.pin.update(imageReference=image_reference, imageConfigDigest=config_digest, manifest=manifest,
                        manifestJson=self.raw, sourceRevision=revision, ingress={**ingress, "alias": "warpdrive-core-api"},
                        database=database)
        self.probes = []

    def attach(self, identifier, net_id, address, endpoint, alias):
        network = self.docker.networks[net_id]
        row = self.docker.rows[identifier]
        record = {"NetworkID": net_id, "EndpointID": endpoint * 64, "IPAddress": address,
                  "Aliases": [alias], "DNSNames": [alias, identifier[:12]]}
        row["NetworkSettings"]["Networks"][network["Name"]] = record
        network["Containers"][identifier] = {"Name": row["Name"][1:], "EndpointID": record["EndpointID"], "IPv4Address": address + "/24"}
        return {"networkId": net_id, "endpointId": record["EndpointID"], "ipv4": address}

    def schema_reader(self, identifier):
        self.assertEqual(identifier, self.postgres)
        return self.schema

    def ready(self, address):
        self.probes.append(address)
        return True

    def observe(self, **options):
        return observe_retained_core(self.docker, self.pin, postgres_id=self.postgres, probe=options.pop("probe", self.ready), **options)

    def repin_configuration(self):
        self.pin["configSha256"] = process_witness(self.core, running=True)["configSha256"]

    def test_legacy_output_and_digest_are_unchanged(self):
        legacy = {name: process_witness(self.docker.rows[identifier], running=name in RUNNING)
                  for name, identifier in sorted(self.ids.items())}
        old = {"schemaSha256": self.schema, "processes": legacy}
        result = observe_backend(self.docker, self.pins, schema_reader=self.schema_reader, core_probe=self.fail)
        self.assertEqual(canonical(result), canonical({**old, "backendFingerprint": content_hash(old)}))
        self.assertEqual(self.docker.calls, [("inspect", self.ids[component]) for component in sorted(COMPONENTS)])

    def test_optional_core_witness_is_bound_and_excludes_private_config(self):
        result = observe_backend(self.docker, self.pins, schema_reader=self.schema_reader,
                                 core_pin=self.pin, core_probe=self.ready)
        core = result["processes"]["core"]
        self.assertEqual(set(result["processes"]), COMPONENTS | {"core"})
        self.assertEqual(core["ingress"], self.pin["ingress"])
        self.assertEqual(core["database"], self.pin["database"])
        self.assertEqual(core["imageConfigDigest"], self.pin["imageConfigDigest"])
        self.assertEqual(core["service"], "core-api")
        self.assertNotIn("manifestJson", core)
        self.assertNotIn(b"do-not-emit", canonical(result))
        self.assertEqual(result["backendFingerprint"], content_hash({"schemaSha256": self.schema, "processes": result["processes"]}))
        self.assertEqual(self.probes, [self.pin["ingress"]["ipv4"]])
        self.assertEqual(self.docker.calls.count(("inspect", self.core_id)), 2)
        self.assertEqual(self.docker.calls.count(("network", self.pin["ingress"]["networkId"])), 2)

    def test_invalid_independent_pins_hold_before_observation(self):
        for patch_values in ({"manifestJson": self.raw + " "}, {"imageConfigDigest": digest("a")},
                             {"imageReference": "registry.example.invalid/core:mutable"},
                             {"imageId": self.pin["imageConfigDigest"]}, {"name": "not-absolute"}, {"pid": True},
                             {"ingress": {**self.pin["ingress"], "ipv4": "127.0.0.1"}},
                             {"database": {**self.pin["database"], "networkId": self.pin["ingress"]["networkId"]}}):
            with self.subTest(fields=patch_values.keys()), self.assertRaises(WebRuntimeError):
                observe_retained_core(self.docker, self.pin | patch_values, postgres_id=self.postgres, probe=self.fail)
        self.assertEqual(self.docker.calls, [])

    def test_protected_component_cannot_be_reused_as_core(self):
        with self.assertRaisesRegex(WebRuntimeError, "distinct"):
            observe_backend(self.docker, self.pins, schema_reader=self.schema_reader,
                            core_pin=self.pin | {"id": self.ids["worker"]}, core_probe=self.fail)

    def test_image_readback_and_live_platform_are_checked(self):
        platform = self.core["ImageManifestDescriptor"]["platform"]
        platform["architecture"] = "arm64"
        with self.assertRaisesRegex(WebRuntimeError, "platform manifest"):
            self.observe()
        platform["architecture"] = "amd64"
        self.docker.image["Descriptor"]["size"] += 1
        with self.assertRaisesRegex(WebRuntimeError, "attest"):
            self.observe()
        self.assertEqual(self.probes, [])

    def test_unknown_and_false_readiness_hold(self):
        for response in (False, None, 1):
            with self.subTest(response=response), self.assertRaisesRegex(WebRuntimeError, "readiness"):
                self.observe(probe=lambda _: response)
        with patch.object(self.docker, "network", side_effect=DockerNativeError("private address must not appear")):
            with self.assertRaisesRegex(WebRuntimeError, "^Malformed or unavailable retained Core readback$"):
                self.observe()

    def test_role_and_exposure_guards_apply_even_to_independently_pinned_config(self):
        for field, key, value in (("HostConfig", "PortBindings", {"3010/tcp": [{"HostPort": "3010"}]}),
                                  ("HostConfig", "Privileged", True), ("HostConfig", "ReadonlyRootfs", False),
                                  ("HostConfig", "SecurityOpt", []), ("HostConfig", "CapDrop", []),
                                  ("HostConfig", "Dns", ["10.1.2.3"]), ("HostConfig", "DnsOptions", ["ndots:4"]),
                                  ("HostConfig", "DnsSearch", ["private.invalid"]), ("Config", "StopTimeout", 45),
                                  ("Config", "Labels", {key: value for key, value in self.core["Config"]["Labels"].items()
                                                       if key != "traefik.enable"}),
                                  ("Config", "Cmd", ["bun", "unverified.mjs"]),
                                  ("Config", "Env", self.core["Config"]["Env"] + ["POSTGRES_PASSWORD=owner"]),
                                  ("Config", "Env", [value.replace("@postgres:", "@10.2.3.4:")
                                                     for value in self.core["Config"]["Env"]])):
            with self.subTest(field=field, key=key):
                original = deepcopy(self.core)
                self.core[field][key] = value
                self.repin_configuration()
                with self.assertRaises(WebRuntimeError):
                    self.observe()
                self.core.clear()
                self.core.update(original)
        self.assertEqual(self.probes, [])

    def test_network_alias_and_address_collisions_hold(self):
        ingress, database = self.pin["ingress"]["networkId"], self.pin["database"]["networkId"]
        edge = self.docker.rows[self.ids["edge"]]["NetworkSettings"]["Networks"][NETWORKS[0]]
        edge["DNSNames"].append("Warpdrive-Core-Api.")
        with self.assertRaisesRegex(WebRuntimeError, "ambiguous or missing ownership"):
            self.observe()
        edge["DNSNames"].pop()
        self.docker.networks[ingress]["Containers"][self.ids["edge"]]["IPv4Address"] = self.pin["ingress"]["ipv4"] + "/24"
        edge["IPAddress"] = self.pin["ingress"]["ipv4"]
        with self.assertRaisesRegex(WebRuntimeError, "ambiguous address"):
            self.observe()
        edge["IPAddress"] = "10.9.0.2"
        self.docker.networks[ingress]["Containers"][self.ids["edge"]]["IPv4Address"] = "10.9.0.2/24"
        self.attach(self.ids["worker"], database, "172.29.0.3", "d", "postgres")
        with self.assertRaisesRegex(WebRuntimeError, "ambiguous or missing ownership"):
            self.observe()
        self.assertEqual(self.probes, [])

    def test_live_process_is_bracketed_around_readiness(self):
        def restarts(address):
            self.ready(address)
            self.core["State"]["Pid"] += 1
            return True

        with self.assertRaisesRegex(WebRuntimeError, "process or platform manifest changed"):
            self.observe(probe=restarts)

    def test_live_endpoint_is_bracketed_around_readiness(self):
        def changes_endpoint(address):
            self.ready(address)
            self.attach(self.core_id, self.pin["ingress"]["networkId"], address, "d", self.pin["ingress"]["alias"])
            return True

        with self.assertRaisesRegex(WebRuntimeError, "endpoint differs"):
            self.observe(probe=changes_endpoint)


class DirectCoreReadinessTests(unittest.TestCase):
    def test_exact_request_and_response_with_bounded_numeric_authority(self):
        response = (b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\n"
                    b"Content-Length: 2\r\nConnection: close\r\n\r\nOK")
        for wire, expected in ((response, True), (response.replace(b"200 OK", b"302 Found"), False),
                               (response.replace(b"\r\n\r\nOK", b"\r\nContent-Length: 2\r\n\r\nOK"), False),
                               (response.replace(b"\r\n\r\nOK", b"\r\nTransfer-Encoding: chunked\r\n\r\nOK"), False),
                               (response + b"unexpected", False)):
            with self.subTest(expected=expected, response=wire), patch("installed_web_backend.socket.socket") as factory:
                connection = factory.return_value.__enter__.return_value
                connection.recv.side_effect = [wire[:32], wire[32:], b""]
                self.assertIs(read_direct_core("10.9.0.5"), expected)
                connection.connect.assert_called_once_with(("10.9.0.5", 3010))
                request = connection.sendall.call_args.args[0]
                self.assertTrue(request.startswith(b"GET /readyz HTTP/1.1\r\nHost: 10.9.0.5:3010\r\n"))
                self.assertNotIn(b"Cookie", request)
                self.assertNotIn(b"Authorization", request)

    def test_readiness_timeout_does_not_retry(self):
        with patch("installed_web_backend.socket.socket") as factory:
            connection = factory.return_value.__enter__.return_value
            connection.recv.side_effect = TimeoutError("simulated incomplete body")
            self.assertFalse(read_direct_core("10.9.0.5"))
            factory.assert_called_once()
            connection.connect.assert_called_once()


if __name__ == "__main__":
    unittest.main()
