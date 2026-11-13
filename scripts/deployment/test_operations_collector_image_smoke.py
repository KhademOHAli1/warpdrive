"""Exercise optional final-image smoke admission and finite fixture authority without Docker."""

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from image_smoke import COMPONENTS, OWNER_LABEL, SmokeError
from operations_collector_image_smoke import COMMAND, PACKAGING, SOCKET_DIRECTORY, OperationsCollectorImageSmoke


REVISION = "a" * 40
COLLECTOR = "fixture/collector:exact"
COLLECTOR_ID = "sha256:" + "f" * 64
IMAGES = {name: f"fixture/{name}:exact" for name in COMPONENTS}


class DockerReadback:
    def __init__(self):
        self.calls = []
        self.collector = {"Id": COLLECTOR_ID, "Os": "linux", "Architecture": "amd64", "RepoDigests": [],
                          "Config": {"User": "1000:1000", "Cmd": COMMAND,
                                     "Labels": {"org.opencontainers.image.revision": REVISION}}}
        self.runtime = None
        self.output = ""

    def run(self, arguments, **options):
        self.calls.append((arguments, options))
        output = self.output.encode() if "input_bytes" in options else self.output
        return subprocess.CompletedProcess(arguments, 0, output, "")

    def json(self, arguments, **options):
        self.calls.append((arguments, options))
        if arguments[:2] == ["image", "inspect"]:
            if arguments[2] == COLLECTOR:
                return [deepcopy(self.collector)]
            index = list(IMAGES.values()).index(arguments[2])
            return [{"Id": "sha256:" + str(index) * 64, "Config": {"User": "bun", "Labels": {
                "org.opencontainers.image.revision": REVISION}}, "RepoDigests": []}]
        if arguments[:2] == ["container", "inspect"]:
            return [deepcopy(self.runtime)]
        raise AssertionError("Unexpected synthetic Docker readback")


class OperationsCollectorImageSmokeTests(unittest.TestCase):
    def setUp(self):
        self.docker = DockerReadback()
        self.smoke = OperationsCollectorImageSmoke(self.docker, IMAGES, COLLECTOR, Path("unused"), REVISION)
        self.smoke.containers["postgres"] = f"{self.smoke.prefix}-postgres"

    def test_exact_native_final_image_and_default_command_required(self):
        result = self.smoke.inspect_images()
        self.assertEqual(result["collector"]["id"], COLLECTOR_ID)
        for key, value in (("Architecture", "arm64"), ("Id", "sha256:" + "0" * 64)):
            with self.subTest(key=key), patch.dict(self.docker.collector, {key: value}), self.assertRaises(SmokeError):
                self.smoke.inspect_images()
        config = self.docker.collector["Config"]
        for key, value in (("User", "root"), ("Cmd", ["different"]), ("ExposedPorts", {"8080/tcp": {}})):
            with self.subTest(key=key), patch.dict(config, {key: value}), self.assertRaises(SmokeError):
                self.smoke.inspect_images()

    def test_credentials_travel_in_stdin_and_setup_uses_owned_networkless_volume_writer(self):
        self.smoke.inspect_images()
        self.smoke.database()
        config_url = f"postgres://restricted:{self.smoke.collector_password}@postgres/fixture"
        with patch.object(self.smoke, "finished"):
            self.smoke.seed("config", f"{self.smoke.prefix}-socket", config_url)
        writes = [(args, options) for args, options in self.docker.calls if "input_bytes" in options]
        self.assertEqual(len(writes), 2)
        database, options = writes[0]
        self.assertEqual(database[:3], ["exec", "-i", self.smoke.containers["postgres"]])
        self.assertIn(self.smoke.collector_password.encode(), options["input_bytes"])
        setup, options = writes[1]
        self.assertEqual(setup[setup.index("--network") + 1], "none")
        self.assertIn("--read-only", setup)
        self.assertIn(f"{OWNER_LABEL}={self.smoke.prefix}", setup)
        self.assertIn(COLLECTOR_ID, setup)
        self.assertEqual(json.loads(options["input_bytes"])["databaseUrl"], config_url)
        self.assertNotIn(self.smoke.collector_password, " ".join(arg for args, _ in self.docker.calls for arg in args))
        self.assertNotIn(self.smoke.signing_key, " ".join(arg for args, _ in self.docker.calls for arg in args))

    def test_runtime_uses_exact_image_readonly_config_no_published_port_or_runtime_overrides(self):
        self.smoke.inspect_images()
        name = self.smoke.start_collector("collector", "owned-config", "owned-socket")
        command, _ = self.docker.calls[-1]
        self.assertEqual(command[-1], COLLECTOR_ID)
        self.assertIn("--read-only", command)
        self.assertIn("--init", command)
        self.assertIn("type=volume,source=owned-config,target=/run,volume-nocopy,readonly", command)
        self.assertIn(f"type=volume,source=owned-socket,target={SOCKET_DIRECTORY},volume-nocopy", command)
        for forbidden in ("--env", "--publish", "-p", "--entrypoint", "--user"):
            self.assertNotIn(forbidden, command)
        self.docker.runtime = {"Image": COLLECTOR_ID, "Config": {
            "Cmd": COMMAND, "User": "1000:1000", "Labels": {OWNER_LABEL: self.smoke.prefix}}, "HostConfig": {
                "ReadonlyRootfs": True, "Init": True, "CapDrop": ["ALL"], "PublishAllPorts": False,
                "Privileged": False, "SecurityOpt": ["no-new-privileges"]},
            "NetworkSettings": {"Networks": {self.smoke.report["resources"]["network"]: {}}, "Ports": {}}, "Mounts": [
                {"Name": "owned-config", "Destination": "/run", "RW": False, "Type": "volume"},
                {"Name": "owned-socket", "Destination": SOCKET_DIRECTORY, "RW": True, "Type": "volume"},
            ]}
        self.smoke.verify_runtime(name, "owned-config", "owned-socket")
        self.docker.runtime["Mounts"][0]["RW"] = True
        with self.assertRaises(SmokeError):
            self.smoke.verify_runtime(name, "owned-config", "owned-socket")

    def test_restart_probes_and_durable_sql_are_required_for_report(self):
        self.smoke.inspect_images()
        self.docker.output = "1"
        body = '{"fixture":"same bytes"}'
        initial = {"badSignatureDenied": True, "accepted": True, "replayAccepted": True,
                   "conflictDenied": True, "body": body}
        restarted = {"replayAfterRestart": True, "recoveryAccepted": True}
        packaging = {"uid": 1000, "gid": 1000, "isolatedPackaging": True, "privateSocket": True}
        with (patch.object(self.smoke, "seed", side_effect=["owner-config", "config"]),
              patch.object(self.smoke, "state", return_value={"Running": False, "ExitCode": 1}),
              patch.object(self.smoke, "verify_runtime"), patch.object(self.smoke, "wait_socket"),
              patch.object(self.smoke, "stop_collector") as stop, patch.object(self.smoke, "require_socket_absent") as absent,
              patch.object(self.smoke, "probe", return_value=packaging) as probe,
              patch.object(self.smoke, "signed_probe", side_effect=[initial, restarted]) as signed,
              patch.object(self.smoke, "sql", side_effect=["1:1", "2:2\n1\nhealthy"]) as sql):
            result = self.smoke.collector()
        self.assertEqual(result["receiptCount"], 2)
        self.assertEqual(result["recoveredIncidentCount"], 1)
        self.assertNotIn("body", result)
        self.assertEqual(stop.call_count, 2)
        self.assertEqual(absent.call_count, 3)
        self.assertEqual(signed.call_args.kwargs, {"previous": body.encode()})
        self.assertEqual(sql.call_count, 2)
        self.assertEqual(probe.call_args.args[1], PACKAGING)

    def test_failed_proof_cleans_and_only_writes_safe_failure_report(self):
        with tempfile.TemporaryDirectory() as directory:
            self.smoke.output_dir = Path(directory) / "report"
            with (patch.object(self.smoke, "inspect_images", side_effect=RuntimeError("private raw body")),
                  patch.object(self.smoke, "cleanup", return_value=[]) as cleanup):
                self.assertFalse(self.smoke.run())
            cleanup.assert_called_once()
            raw = (self.smoke.output_dir / "report.json").read_text()
            self.assertNotIn("private raw body", raw)
            self.assertEqual(json.loads(raw)["failure"], "RuntimeError")


if __name__ == "__main__":
    unittest.main()
