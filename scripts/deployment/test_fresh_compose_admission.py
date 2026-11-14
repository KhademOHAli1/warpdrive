"""Exercise exact fresh Compose admission against the actual Compose model."""

from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import fresh_compose_admission as admission
from test_compose_profile import FRESH_ENV, SYNTHETIC_ENV
from web_switch import SwitchConflict


class FreshComposeAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.docker = Path(shutil.which("docker")).resolve()
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="wd-fresh-compose-"))).resolve()
        self.project = "fresh-fixture"
        self.baseline = self.directory / "baseline.env"
        self.candidate = self.directory / "candidate.env"
        self.environment = SYNTHETIC_ENV | FRESH_ENV
        self.new_image = "ghcr.io/example/selected-web@sha256:" + "a" * 64
        self.private(self.directory / ".env", {"DATABASE_URL": "postgres://fixture:secret@postgres/fixture"})

    @staticmethod
    def private(path, values):
        raw = "".join(f"{key}={value}\n" for key, value in values.items()).encode()
        path.write_bytes(raw)
        path.chmod(0o600)
        return sha256(raw).hexdigest()

    def settings(self, **changes):
        before = self.private(self.baseline, self.environment)
        after = self.private(self.candidate, self.environment | {"WARPDRIVE_WEB_IMAGE": self.new_image} | changes)
        return {"docker": self.docker, "project": self.project, "directory": self.directory,
                "baseline_env": self.baseline, "baseline_pin": before, "candidate_env": self.candidate, "candidate_pin": after}

    def test_real_four_files_match_only_app_change_without_daemon_or_env_values_in_receipt(self):
        with patch.dict(os.environ, {"WARPDRIVE_WEB_IMAGE": "untrusted", "COMPOSE_FILE": "/untrusted", "DOCKER_HOST": "tcp://untrusted"}):
            receipt = admission.admit(**self.settings())
        self.assertEqual(receipt["state"], "admitted")
        self.assertEqual(receipt["candidateWebImage"], self.new_image)
        self.assertFalse(receipt["deploymentAuthorized"])
        self.assertEqual(set(receipt["baselineImages"]), admission.SERVICES)
        self.assertNotEqual(receipt["baselineModelSha256"], receipt["candidateModelSha256"])
        self.assertNotIn("synthetic", json.dumps(receipt))
        self.assertNotIn("fixture:secret", json.dumps(receipt))

    def test_wrong_pin_non_digest_and_second_image_change_stop_before_compose(self):
        with patch.object(admission, "_config") as compose:
            with self.assertRaisesRegex(SwitchConflict, "SHA-256 pin"):
                admission.admit(**(self.settings() | {"baseline_pin": "f" * 64}))
            with self.assertRaisesRegex(SwitchConflict, "immutable reference"):
                admission.admit(**self.settings(WARPDRIVE_WEB_IMAGE="ghcr.io/example/web:latest"))
            with self.assertRaisesRegex(SwitchConflict, "only the Web image"):
                admission.admit(**self.settings(WARPDRIVE_WORKER_IMAGE="ghcr.io/example/worker@sha256:" + "b" * 64))
            with self.assertRaisesRegex(SwitchConflict, "only the Web image"):
                admission.admit(**self.settings(WARPDRIVE_WEB_IMAGE="ghcr.io/example/renamed-web@sha256:" + "1" * 64))
            compose.assert_not_called()

    def test_both_storage_client_profiles_have_pinned_selection_and_fixed_initialization(self):
        for client in ("mc", "mcli"):
            with self.subTest(client=client):
                self.environment[admission.STORAGE_CLIENT_ENV] = client
                options = self.settings()
                receipt = admission.admit(**options, storage_client_bin=client)
                self.assertEqual(receipt["storageClientBin"], client)
                model = admission._config(self.docker, self.project, self.directory, self.baseline)
                service = model["services"]["createbuckets"]
                self.assertEqual(service["environment"][admission.STORAGE_CLIENT_ENV], client)
                self.assertEqual(service["entrypoint"], admission.STORAGE_INIT_ENTRYPOINT)
                self.assertEqual(service["command"], [])
                self.assertEqual(service["tmpfs"], [admission.STORAGE_CLIENT_DATA_TMPFS])
                images = admission._pinned_images(self.baseline, options["baseline_pin"], storage_client_bin=client)
                for change in (lambda row: row["environment"].update({admission.STORAGE_CLIENT_ENV: "other"}),
                               lambda row: row.update(entrypoint=["/bin/sh", "-ec", "exec mcli other-command"]),
                               lambda row: row.update(command=["unreviewed"])):
                    altered = deepcopy(model)
                    change(altered["services"]["createbuckets"])
                    with self.assertRaisesRegex(SwitchConflict, "fixed initialization entrypoint"):
                        admission._validate(altered, self.project, self.directory, images, storage_client_bin=client)

    def test_storage_client_data_is_ephemeral_bounded_and_not_an_extra_authoritative_volume(self):
        options = self.settings()
        model = admission._config(self.docker, self.project, self.directory, self.baseline)
        images = admission._pinned_images(self.baseline, options["baseline_pin"])
        self.assertEqual(model["services"]["createbuckets"]["tmpfs"], ["/data:rw,noexec,nosuid,size=8m"])
        self.assertEqual(model["services"]["createbuckets"].get("volumes", []), [])
        self.assertEqual(set(model["volumes"]), {"caddydata", "caddyconfig", "pgdata", "miniodata", "newsletter_uploads"})
        self.assertEqual([(row["type"], row["source"], row["target"]) for row in model["services"]["minio"]["volumes"]],
                         [("volume", "miniodata", "/data")])
        for changed in ([], ["/data:rw,noexec,nosuid,size=16m"], ["/data:ro,noexec,nosuid,size=8m"],
                        ["/data:rw,nosuid,size=8m"], ["/data:rw,noexec,size=8m"],
                        [admission.STORAGE_CLIENT_DATA_TMPFS, "/cache:rw,size=1m"]):
            altered = deepcopy(model)
            altered["services"]["createbuckets"]["tmpfs"] = changed
            with self.subTest(changed=changed), self.assertRaisesRegex(SwitchConflict, "exact eight-MiB"):
                admission._validate(altered, self.project, self.directory, images)
        altered = deepcopy(model)
        altered["services"]["createbuckets"]["volumes"] = [{"type": "volume", "target": "/data"}]
        with self.assertRaisesRegex(SwitchConflict, "mount scope"):
            admission._validate(altered, self.project, self.directory, images)
        altered = deepcopy(model)
        altered["services"]["minio"]["tmpfs"] = [admission.STORAGE_CLIENT_DATA_TMPFS]
        with self.assertRaisesRegex(SwitchConflict, "exact eight-MiB"):
            admission._validate(altered, self.project, self.directory, images)

    def test_invalid_or_changed_storage_selection_holds_before_compose(self):
        with patch.object(admission, "_config") as compose:
            for client in ("sh", "/usr/bin/mc", "mc --other", "$(echo unreviewed)", None):
                with self.subTest(client=client), self.assertRaisesRegex(SwitchConflict, "must be mc or mcli"):
                    admission.admit(**self.settings(), storage_client_bin=client)
            self.environment[admission.STORAGE_CLIENT_ENV] = "mcli"
            with self.assertRaisesRegex(SwitchConflict, "Pinned storage client differs"):
                admission.admit(**self.settings())
            with self.assertRaisesRegex(SwitchConflict, "Pinned storage client differs"):
                admission.admit(**self.settings(WARPDRIVE_STORAGE_CLIENT_BIN="mc"), storage_client_bin="mcli")
            self.environment[admission.STORAGE_CLIENT_ENV] = "mc;echo-unreviewed"
            with self.assertRaisesRegex(SwitchConflict, "must be mc or mcli"):
                admission.admit(**self.settings())
            compose.assert_not_called()

    def test_fixed_script_uses_quoted_explicit_client_and_private_config_for_each_operation(self):
        # These executable shims check shell argument boundaries, not native S3 interoperability.
        binaries = self.directory / "client-bin"
        binaries.mkdir(mode=0o700)
        record = self.directory / "client-arguments.jsonl"
        shim = ("#!" + sys.executable + "\nimport json,os,sys\n"
                "with open(os.environ['FIXTURE_RECORD'], 'a') as output:\n"
                " output.write(json.dumps(sys.argv[1:])+'\\n')\n")
        for client in ("mc", "mcli"):
            binary = binaries / client
            binary.write_text(shim)
            binary.chmod(0o700)
        access, secret = "fixture access with spaces", "literal $(untrusted) fixture secret"
        environment = {"PATH": str(binaries), "FIXTURE_RECORD": str(record), "MINIO_ACCESS_KEY": access,
                       "MINIO_SECRET_KEY": secret, "MINIO_BUCKET": "owned-bucket"}
        prefix = ["--config-dir", admission.STORAGE_CLIENT_CONFIG]
        for client in ("mc", "mcli"):
            if record.exists():
                record.unlink()
            result = subprocess.run(["/bin/sh", "-ec", admission.STORAGE_INIT_SCRIPT],
                env={**environment, admission.STORAGE_CLIENT_ENV: client}, capture_output=True, timeout=5, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual([json.loads(line) for line in record.read_text().splitlines()], [
                prefix + ["alias", "set", "local", "http://minio:9000", access, secret],
                prefix + ["mb", "--ignore-existing", "local/owned-bucket"],
                prefix + ["anonymous", "set", "none", "local/owned-bucket"]])
        record.unlink()
        result = subprocess.run(["/bin/sh", "-ec", admission.STORAGE_INIT_SCRIPT],
            env={**environment, admission.STORAGE_CLIENT_ENV: "mc;unreviewed"}, capture_output=True, timeout=5, check=False)
        self.assertEqual(result.returncode, 64)
        self.assertFalse(record.exists())

    def test_candidate_effective_runtime_changes_and_unsafe_passive_settings_hold(self):
        with self.assertRaisesRegex(SwitchConflict, "another rendered Compose setting"):
            admission.admit(**self.settings(POSTGRES_USER="different_database_owner"))
        for field, value in (("NEWSLETTER_PUBLIC_SIGNUP_ENABLED", "true"), ("NEWSLETTER_DELIVERY_ENABLED", "true"),
                             ("NEWSLETTER_SES_FEEDBACK_ENABLED", "true"), ("NEWSLETTER_API_TOKEN", "secret")):
            with self.subTest(field=field), self.assertRaisesRegex(SwitchConflict, "must stay disabled"):
                admission.admit(**self.settings(**{field: value}))

    def test_actual_fresh_application_and_job_runtimes_have_no_partial_newsletter_binding(self):
        self.settings()
        model = admission._config(self.docker, self.project, self.directory, self.baseline)
        for name in ("app", "worker", "ws", "migrate", "createbuckets"):
            with self.subTest(name=name):
                service = model["services"][name]
                for key in ("NEWSLETTER_BASE_URL", "NEWSLETTER_API_USER", "NEWSLETTER_API_TOKEN", "NEWSLETTER_API_TOKEN_FILE"):
                    self.assertEqual(service["environment"][key], "")
                altered = deepcopy(service)
                altered["environment"]["NEWSLETTER_BASE_URL"] = "http://newsletter-engine:9000"
                with self.assertRaisesRegex(SwitchConflict, "must stay disabled"):
                    admission._service(name, altered, self.directory, service["image"])

    def test_private_service_env_and_private_pins_are_required(self):
        options = self.settings()
        self.baseline.chmod(0o644)
        with self.assertRaisesRegex(SwitchConflict, "private"):
            admission.admit(**options)
        self.baseline.chmod(0o600)
        (self.directory / ".env").chmod(0o644)
        with self.assertRaisesRegex(SwitchConflict, "private"):
            admission.admit(**options)

    def test_unsafe_model_shapes_are_rejected_without_overconstraining_compose_output(self):
        settings = self.settings()
        model = admission._config(self.docker, self.project, self.directory, self.baseline)
        images = admission._pinned_images(self.baseline, settings["baseline_pin"])
        changes = (
            ("ports", lambda data: data["services"]["postgres"].update(ports=[{"target": 5432}])),
            ("build", lambda data: data["services"]["newsletter-engine"].update(build={"context": "."})),
            ("profile", lambda data: data["services"]["newsletter-engine-migrate"].pop("profiles")),
            ("driver", lambda data: data["volumes"]["pgdata"].update(driver="other")),
            ("network", lambda data: data["networks"]["default"].update(external=True)),
            ("mount", lambda data: data["services"]["caddy"]["volumes"][0].update(read_only=False)),
        )
        for label, change in changes:
            altered = deepcopy(model)
            change(altered)
            with self.subTest(label=label), self.assertRaises(SwitchConflict):
                admission._validate(altered, self.project, self.directory, images)

    def test_config_subprocess_output_and_wait_are_bounded(self):
        fake = self.directory / "docker-fixture"
        fake.write_text("#!/bin/sh\nprintf 'overlong'\n", encoding="utf-8")
        fake.chmod(0o700)
        with patch.object(admission, "MAX_OUTPUT", 2), self.assertRaisesRegex(SwitchConflict, "output exceeded"):
            admission._config(fake, self.project, self.directory, self.baseline)
        fake.write_text("#!/bin/sh\nexec sleep 10\n", encoding="utf-8")
        with patch.object(admission, "TIMEOUT", 0.05), self.assertRaisesRegex(SwitchConflict, "timed out"):
            admission._config(fake, self.project, self.directory, self.baseline)


if __name__ == "__main__":
    unittest.main()
