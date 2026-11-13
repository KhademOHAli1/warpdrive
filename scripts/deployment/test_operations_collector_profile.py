"""Render the optional collector overlay without using a Docker daemon."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_compose_profile import ROOT, SYNTHETIC_ENV


PREFIX = "WARPDRIVE_OPERATIONS_COLLECTOR_"
REPOSITORY = "ghcr.io/example/warpdrive-operations-collector"
DIGEST = "a" * 64


class OperationsCollectorProfileTest(unittest.TestCase):
    def setUp(self):
        self.docker = shutil.which("docker")
        self.assertIsNotNone(self.docker, "Docker CLI with Compose is required")
        self.scratch = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="wd-ops-compose-")))
        (self.scratch / ".env").touch()
        self.config = self.scratch / "collector.json"
        self.socket = self.scratch / "socket"
        self.settings = {
            PREFIX + "IMAGE_REPOSITORY": REPOSITORY,
            PREFIX + "IMAGE_SHA256": DIGEST,
            PREFIX + "CONFIG_FILE": str(self.config),
            PREFIX + "SOCKET_DIR": str(self.socket),
            PREFIX + "DB_NETWORK": "fixture-backend",
        }

    def render(self, *, optional=True, missing=None):
        values = {**SYNTHETIC_ENV, **self.settings}
        values.pop(missing, None)
        env_file = self.scratch / "render.env"
        env_file.write_text("".join(f"{name}={value}\n" for name, value in values.items()), encoding="utf-8")
        command = [
            self.docker, "compose", "--project-name", "wd-operations-profile",
            "--project-directory", str(self.scratch), "--env-file", str(env_file),
            "--file", str(ROOT / "docker-compose.yml"),
            "--file", str(ROOT / "deploy/images/compose.yml"),
        ]
        if optional:
            command.extend(["--file", str(ROOT / "deploy/images/compose.operations.yml")])
        return subprocess.run(
            [*command, "config", "--no-env-resolution", "--format", "json"],
            cwd=self.scratch,
            env={"PATH": os.environ.get("PATH", os.defpath),
                 "DOCKER_HOST": f"unix://{self.scratch}/no-daemon.sock"},
            capture_output=True, text=True, timeout=15, check=False,
        )

    def model(self, **options):
        result = self.render(**options)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_only_collector_and_existing_database_network_are_added(self):
        rendered = self.model()
        service = rendered["services"].pop("operations-collector")
        network = rendered["networks"].pop("operations-collector-db")
        self.assertEqual(rendered, self.model(optional=False))
        # Compose v5 includes an empty ipam object on otherwise unconfigured external networks.
        self.assertEqual(network.pop("ipam", {}), {})
        self.assertEqual(network, {"name": "fixture-backend", "external": True})
        self.assertEqual(set(service["networks"]), {"operations-collector-db"})
        self.assertEqual(service["image"], f"{REPOSITORY}@sha256:{DIGEST}")
        self.assertEqual(service["user"], "1000:1000")
        self.assertTrue(service["init"])
        self.assertEqual(service["restart"], "unless-stopped")
        self.assertEqual(service["stop_grace_period"], "30s")
        self.assertTrue(service["read_only"])
        self.assertEqual(service["cap_drop"], ["ALL"])
        self.assertEqual(service["security_opt"], ["no-new-privileges:true"])
        self.assertTrue({"build", "ports", "expose", "labels", "depends_on", "env_file",
                         "environment", "privileged", "network_mode"}.isdisjoint(service))

        volumes = {volume["target"]: volume for volume in service["volumes"]}
        self.assertEqual(set(volumes), {"/run/warpdrive-operations-config.json", "/run/warpdrive-operations"})
        config = volumes["/run/warpdrive-operations-config.json"]
        socket = volumes["/run/warpdrive-operations"]
        self.assertEqual(config["source"], str(self.config))
        self.assertTrue(config["read_only"])
        self.assertEqual(socket["source"], str(self.socket))
        self.assertFalse(socket.get("read_only", False))
        for volume in volumes.values():
            self.assertEqual(volume["type"], "bind")
            self.assertIs(volume.get("bind", {}).get("create_host_path", False), False)

    def test_missing_operator_inputs_fail_render(self):
        for name in self.settings:
            with self.subTest(name=name):
                result = self.render(missing=name)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)
