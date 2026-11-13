"""Daemon-free checks of the real merged image-only Compose model.

These tests invoke only `docker compose config`/help. They never start services, contact
a daemon, pull images or resolve service .env files. An explicit synthetic interpolation
file and allowlisted subprocess environment keep real installation values out of output.
Docker Compose with --no-env-resolution and !reset support is required, not skipped.

The checked-in base/overlay are rendered with a scratch project directory. Relative service
env, bind and build paths therefore normalize into scratch in both models. These checks
prove merge preservation and selection, not production mount existence or runtime health.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
IMAGE_VARIABLES = {
    "WARPDRIVE_WEB_IMAGE": "app",
    "WARPDRIVE_REALTIME_IMAGE": "ws",
    "WARPDRIVE_WORKER_IMAGE": "worker",
    "WARPDRIVE_MIGRATOR_IMAGE": "migrate",
}
SYNTHETIC_ENV = {
    "APP_DOMAIN": "image-profile.example.invalid",
    "ACME_EMAIL": "operator@example.invalid",
    "POSTGRES_USER": "image_profile_fixture",
    "POSTGRES_PASSWORD": "synthetic_image_profile_password",
    "POSTGRES_DB": "image_profile_fixture",
    "MINIO_ACCESS_KEY": "synthetic_image_profile_access",
    "MINIO_SECRET_KEY": "synthetic_image_profile_secret",
    "MINIO_BUCKET": "synthetic_image_profile_bucket",
    "BASE_URL": "https://image-profile.example.invalid",
    "NEXT_PUBLIC_WS_URL": "same-origin",
    "APP_VERSION": "fixture",
    **{
        variable: f"ghcr.io/example/warpdrive-{service}@sha256:{str(index) * 64}"
        for index, (variable, service) in enumerate(IMAGE_VARIABLES.items(), 1)
    },
}
FRESH_IMAGES = {
    "WARPDRIVE_CADDY_IMAGE": ("caddy",), "WARPDRIVE_POSTGRES_IMAGE": ("postgres",),
    "WARPDRIVE_STORAGE_IMAGE": ("minio",), "WARPDRIVE_STORAGE_INIT_IMAGE": ("createbuckets",),
    "WARPDRIVE_NEWSLETTER_IMAGE": ("newsletter-engine", "newsletter-engine-migrate"),
}
FRESH_ENV = {"NEWSLETTER_POSTGRES_PASSWORD": "owned-newsletter-fixture", "NEWSLETTER_PUBLIC_DOMAIN": "news.example.invalid",
             **{name: f"ghcr.io/example/fixture-{index}@sha256:" + f"{index:x}" * 64
                for index, name in enumerate(FRESH_IMAGES, 5)}}


class ImageComposeProfileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.docker = shutil.which("docker")
        if cls.docker is None:
            raise RuntimeError("Docker CLI with Compose is required for daemon-free model checks")
        cls.scratch = tempfile.TemporaryDirectory(prefix="warpdrive-image-compose-")
        cls.addClassCleanup(cls.scratch.cleanup)
        cls.directory = Path(cls.scratch.name)
        # Compose versions differ on whether --no-env-resolution also bypasses the
        # existence check. Satisfy it in scratch without creating/reading ROOT/.env.
        cls.service_env = cls.directory / ".env"
        cls.service_env.write_text("", encoding="utf-8")
        # No inherited COMPOSE_*, DOCKER_CONTEXT or installation credentials. The socket
        # deliberately does not exist; all checks must remain daemon-independent.
        cls.process_env = {
            "PATH": os.environ.get("PATH", os.defpath),
            "DOCKER_HOST": f"unix://{cls.directory}/no-daemon.sock",
        }
        help_result = subprocess.run(
            [cls.docker, "compose", "config", "--help"],
            cwd=cls.directory,
            env=cls.process_env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if help_result.returncode != 0 or "--no-env-resolution" not in help_result.stdout:
            raise RuntimeError(
                "Docker Compose config with --no-env-resolution is required; "
                "no daemon-free checks were skipped"
            )

    def render(
        self,
        *,
        overlay: bool = True,
        core: bool = False,
        fresh: bool = False,
        replacements: dict[str, str | None] | None = None,
        resolve_service_env: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        values = SYNTHETIC_ENV | (FRESH_ENV if fresh else {})
        for name, value in (replacements or {}).items():
            if value is None:
                values.pop(name, None)
            else:
                values[name] = value
        interpolation = self.directory / "synthetic-interpolation.env"
        interpolation.write_text(
            "".join(f"{name}={value}\n" for name, value in sorted(values.items())),
            encoding="utf-8",
        )
        command = [
            self.docker,
            "compose",
            "--project-name",
            "warpdrive-image-profile-test",
            "--project-directory",
            str(self.directory),
            "--env-file",
            str(interpolation),
            "--file",
            str(ROOT / "docker-compose.yml"),
        ]
        if fresh:
            command.extend(["--file", str(ROOT / "docker-compose.newsletters.yml")])
        if overlay:
            command.extend(["--file", str(ROOT / "deploy/images/compose.yml")])
        if core:
            command.extend(["--file", str(ROOT / "deploy/images/compose.core.yml")])
        if fresh:
            command.extend(["--file", str(ROOT / "deploy/images/compose.fresh.yml"), "--profile", "*"])
        command.append("config")
        if not resolve_service_env:
            command.append("--no-env-resolution")
        command.extend(["--format", "json"])
        return subprocess.run(
            command,
            cwd=self.directory,
            env=self.process_env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    def model(self, **options: object) -> dict:
        result = self.render(**options)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_real_merge_removes_every_core_build_and_pins_independent_images(self) -> None:
        model = self.model()
        for variable, service in IMAGE_VARIABLES.items():
            with self.subTest(service=service):
                self.assertNotIn("build", model["services"][service])
                self.assertEqual(model["services"][service]["image"], SYNTHETIC_ENV[variable])

    def test_fresh_model_has_only_admitted_images_and_keeps_storage_roles(self) -> None:
        model = self.model(fresh=True)
        services = model["services"]
        expected = {service: SYNTHETIC_ENV[name] for name, service in IMAGE_VARIABLES.items()}
        expected.update({service: FRESH_ENV[name] for name, names in FRESH_IMAGES.items() for service in names})
        self.assertEqual(set(services), set(expected))
        for name, service in services.items():
            with self.subTest(name=name):
                self.assertNotIn("build", service)
                self.assertEqual(service["pull_policy"], "never")
                self.assertEqual(service["image"], expected[name])
                if name != "caddy":
                    self.assertNotIn("ports", service)
        self.assertEqual(set(model["volumes"]), {"pgdata", "miniodata", "newsletter_uploads", "caddydata", "caddyconfig"})
        self.assertEqual(services["newsletter-engine-migrate"]["profiles"], ["newsletter-migrations"])
        self.assertEqual(services["newsletter-engine"]["environment"]["NEWSLETTER_DELIVERY_ENABLED"], "false")

    def test_fresh_selection_changes_only_web_image_and_missing_foundation_pin_holds(self) -> None:
        before = self.model(fresh=True)
        selected = "ghcr.io/example/candidate-web@sha256:" + "e" * 64
        after = self.model(fresh=True, replacements={"WARPDRIVE_WEB_IMAGE": selected})
        self.assertEqual(after["services"]["app"]["image"], selected)
        before["services"]["app"]["image"] = selected
        self.assertEqual(before, after)
        for name in FRESH_IMAGES:
            with self.subTest(name=name):
                refused = self.render(fresh=True, replacements={name: None})
                self.assertNotEqual(refused.returncode, 0)
                self.assertIn(name, refused.stderr)

    def test_optional_core_adds_only_one_private_pinned_service(self) -> None:
        environment = {
            "WARPDRIVE_CORE_IMAGE_REPOSITORY": "ghcr.io/example/warpdrive-core",
            "WARPDRIVE_CORE_IMAGE_SHA256": "b" * 64,
            "WARPDRIVE_CORE_ENV_FILE": str(self.service_env),
            "WARPDRIVE_CORE_INGRESS_ALIAS": "warpdrive-core-fixture",
            "WARPDRIVE_CORE_INGRESS_NETWORK": "pitant-warpdrive-ingress",
            "WARPDRIVE_CORE_DB_NETWORK": "pitant-warpdrive_backend",
        }
        with_core = self.model(core=True, replacements=environment, resolve_service_env=True)
        service = with_core["services"].pop("core-api")
        for name, variable in (("core-ingress", "WARPDRIVE_CORE_INGRESS_NETWORK"), ("core-db", "WARPDRIVE_CORE_DB_NETWORK")):
            network = with_core["networks"].pop(name)
            self.assertEqual(network.pop("ipam", {}), {})
            self.assertEqual(network, {"name": environment[variable], "external": True})
        self.assertEqual(with_core, self.model(resolve_service_env=True))
        self.assertEqual(service["image"], "ghcr.io/example/warpdrive-core@sha256:" + "b" * 64)
        self.assertTrue({"build", "ports", "depends_on"}.isdisjoint(service))
        self.assertEqual(set(service["networks"]), {"core-ingress", "core-db"})
        self.assertEqual(service["networks"]["core-ingress"]["aliases"], [environment["WARPDRIVE_CORE_INGRESS_ALIAS"]])
        self.assertEqual(service["labels"]["traefik.enable"], "false")
        self.assertTrue(service["read_only"])
        self.assertEqual(service["cap_drop"], ["ALL"])
        self.assertIn(service["stop_grace_period"], {"75s", "1m15s"})
        self.assertEqual(service["environment"]["MIGRATION_DATABASE_URL"], "")
        self.assertEqual(service["environment"]["MIGRATION_DATABASE_URL_FILE"], "")
        for name in environment:
            with self.subTest(missing=name):
                result = self.render(core=True, replacements={**environment, name: None})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)

    def test_service_env_paths_are_confined_to_the_empty_scratch_fixture(self) -> None:
        result = self.render()
        self.assertEqual(result.returncode, 0, result.stderr)
        model = json.loads(result.stdout)
        # v2 can resolve an empty service env file out of the rendered model while
        # v5 retains env_file. Prove invocation confinement for both representations.
        for flag, expected in (
            ("--project-directory", self.directory),
            ("--env-file", self.directory / "synthetic-interpolation.env"),
        ):
            self.assertEqual(result.args.count(flag), 1)
            self.assertEqual(
                Path(result.args[result.args.index(flag) + 1]).resolve(),
                expected.resolve(),
            )
        self.assertNotIn(str(ROOT / ".env"), json.dumps(model))
        for service in ("app", "ws", "worker", "migrate", "createbuckets"):
            with self.subTest(service=service):
                rendered_service = model["services"][service]
                if "env_file" in rendered_service:
                    env_files = rendered_service["env_file"]
                    paths = [
                        entry["path"] if isinstance(entry, dict) else entry
                        for entry in env_files
                    ]
                    self.assertEqual(
                        [Path(path).resolve() for path in paths],
                        [self.service_env.resolve()],
                    )
                else:
                    expected_environment = {}
                    if service in ("app", "ws", "worker"):
                        expected_environment = {
                            "MIGRATION_DATABASE_URL": "",
                            "MIGRATION_DATABASE_URL_FILE": "",
                            "POSTGRES_PASSWORD": "",
                            "POSTGRES_PASSWORD_FILE": "",
                        }
                    if service == "app":
                        expected_environment["AUTH_TRUSTED_PROXY_HEADER"] = "x-real-ip"
                    if service == "createbuckets":
                        expected_environment = {
                            name: SYNTHETIC_ENV[name]
                            for name in ("MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET")
                        }
                    self.assertEqual(
                        rendered_service.get("environment", {}),
                        expected_environment,
                    )
        self.assertEqual(self.service_env.read_text(encoding="utf-8"), "")

    def test_owner_credentials_are_only_resolved_into_the_one_shot_migrator(self) -> None:
        owner = "postgres://fixture_owner:synthetic_secret@postgres/fixture"
        owner_file = "/run/secrets/fixture_migration_owner"
        self.service_env.write_text(
            f"MIGRATION_DATABASE_URL={owner}\nMIGRATION_DATABASE_URL_FILE={owner_file}\n"
            "POSTGRES_PASSWORD=synthetic_owner_password\nPOSTGRES_PASSWORD_FILE=/run/secrets/fixture_pg_owner\n",
            encoding="utf-8",
        )
        try:
            model = self.model(resolve_service_env=True)
            migrator = model["services"]["migrate"]["environment"]
            self.assertEqual(migrator["MIGRATION_DATABASE_URL"], owner)
            self.assertEqual(migrator["MIGRATION_DATABASE_URL_FILE"], owner_file)
            for service in ("app", "ws", "worker"):
                with self.subTest(service=service):
                    environment = model["services"][service]["environment"]
                    self.assertEqual(environment["MIGRATION_DATABASE_URL"], "")
                    self.assertEqual(environment["MIGRATION_DATABASE_URL_FILE"], "")
                    self.assertEqual(environment["POSTGRES_PASSWORD"], "")
                    self.assertEqual(environment["POSTGRES_PASSWORD_FILE"], "")
            for service in ("createbuckets", "caddy", "minio", "postgres"):
                with self.subTest(service=service):
                    serialized = json.dumps(model["services"][service])
                    self.assertNotIn(owner, serialized)
                    self.assertNotIn(owner_file, serialized)
        finally:
            self.service_env.write_text("", encoding="utf-8")

    def test_merge_preserves_ingress_stateful_services_auth_and_cold_start_gates(self) -> None:
        base = self.model(overlay=False)
        expected = copy.deepcopy(base)
        for variable, service in IMAGE_VARIABLES.items():
            del expected["services"][service]["build"]
            expected["services"][service]["image"] = SYNTHETIC_ENV[variable]
        actual = self.model()
        self.assertEqual(actual, expected)
        self.assertEqual(
            actual["services"]["app"]["environment"]["AUTH_TRUSTED_PROXY_HEADER"],
            "x-real-ip",
        )
        for service in ("app", "ws", "worker"):
            self.assertEqual(
                actual["services"][service]["depends_on"]["migrate"]["condition"],
                "service_completed_successfully",
            )
        self.assertEqual(
            actual["services"]["app"]["depends_on"]["createbuckets"]["condition"],
            "service_completed_successfully",
        )

    def test_one_digest_change_only_changes_the_selected_service_image(self) -> None:
        before = self.model()
        for variable, service in IMAGE_VARIABLES.items():
            with self.subTest(service=service):
                changed = f"ghcr.io/example/warpdrive-{service}@sha256:{'a' * 64}"
                expected = copy.deepcopy(before)
                expected["services"][service]["image"] = changed
                self.assertEqual(self.model(replacements={variable: changed}), expected)

    def test_missing_or_empty_image_reference_rejects_the_model(self) -> None:
        for variable in IMAGE_VARIABLES:
            for value in (None, ""):
                with self.subTest(variable=variable, value=value):
                    result = self.render(replacements={variable: value})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(variable, result.stderr)


if __name__ == "__main__":
    unittest.main()
