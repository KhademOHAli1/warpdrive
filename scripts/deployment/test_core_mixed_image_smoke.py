"""Test admission, exact Caddy composition, and bounded mixed Core evidence."""

from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from bundle import ARCHIVE, MANIFEST, create_bundle, sha256
from caddy_core_config import core_api_routes
from core_mixed_image_smoke import CORE_COMMAND, CORE_MEMORY_MIB, CORE_RPC_PROBE, CoreMixedImageSmoke, main
from image_smoke import SmokeError
from test_bundle import FakeDocker, write_candidate
from test_candidate import SHA, fixture as baseline_inspections
from web_generation_routes import WebGeneration
from web_mixed_image_smoke import MixedWebSmoke, generation_configs
from web_switch import canonical
from web_switch_smoke import GENERATION_HEADER, MIB, WebSwitchSmokeError, fixture_caddyfile


PREFIX = "wd-image-smoke-123456abcdef"
OLD = WebGeneration("wd-" + "a" * 40, PREFIX + "-web-a")
NEW = WebGeneration("wd-" + "b" * 40, PREFIX + "-web-b")
CORE = "sha256:" + "c" * 64
ACTOR = {"id": "12345678-1234-1234-1234-123456789012", "cookie": "wd_sid=fixture-cookie", "csrf": "A" * 43}


class CoreMixedImageTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.docker = Mock()
        self.args = SimpleNamespace(bundle_dir=self.root / "bundle", output_dir=self.root / "report", baseline_revision=SHA,
                                    new_web_image_id="sha256:" + "b" * 64, new_web_revision="b" * 40,
                                    core_image_id=CORE, core_revision="d" * 40, browser=False, baseline_preloaded=False)
        self.smoke = CoreMixedImageSmoke(self.docker, self.args, self.root)

    def mixed_images(self):
        candidate_dir = self.root / "candidate"
        candidate = write_candidate(candidate_dir, version=2)
        origin = {"kind": "github-actions", "repository": "fixture/warpdrive", "runId": 3, "runAttempt": 1,
                  "event": "workflow_dispatch", "ref": "refs/heads/main"}
        create_bundle(candidate_dir, self.args.bundle_dir, expected_revision=SHA, docker=FakeDocker(), origin=origin)
        self.args.baseline_manifest_sha256 = sha256(self.args.bundle_dir / MANIFEST)
        _, inspected = baseline_inspections()
        self.images = {row["Id"]: row for row in inspected.values()}
        self.baseline_pins = {key: row["imageId"] for key, row in candidate["components"].items()}
        self.images[self.args.new_web_image_id] = deepcopy(inspected["web"])
        self.images[self.args.new_web_image_id]["Id"] = self.args.new_web_image_id
        self.images[self.args.new_web_image_id]["Config"]["Labels"]["org.opencontainers.image.revision"] = self.args.new_web_revision
        for component, revision in ((self.baseline_pins["web"], SHA), (self.args.new_web_image_id, self.args.new_web_revision)):
            config = self.images[component]["Config"]
            config["Labels"]["org.opencontainers.image.title"] = "Warpdrive Web"
            config["Env"] = ["APP_COMMIT=" + revision, "NEXT_DEPLOYMENT_ID=wd-" + revision]
        self.images[CORE] = {"Id": CORE, "Os": "linux", "Architecture": "amd64", "Config": {"User": "bun", "Cmd": CORE_COMMAND,
                             "ExposedPorts": {"3010/tcp": {}}, "Labels": {"org.opencontainers.image.revision": self.args.core_revision}}}
        self.docker.run.return_value.stdout = "linux x86_64"

        def inspect(command, **_options):
            self.assertEqual(command[:2], ["image", "inspect"])
            if command[2] not in self.images:
                raise SmokeError("Docker image failed")
            return [self.images[command[2]]]

        self.docker.json.side_effect = inspect
        self.enterContext(patch("web_mixed_image_smoke.platform.system", return_value="Linux"))
        self.enterContext(patch("web_mixed_image_smoke.platform.machine", return_value="x86_64"))

    def load(self, *, preloaded):
        self.args.baseline_preloaded = preloaded
        self.smoke = CoreMixedImageSmoke(self.docker, self.args, self.root)
        return self.smoke.load()

    def test_preloaded_verifies_real_bundle_and_each_immutable_image_without_loading(self):
        self.mixed_images()
        report = self.load(preloaded=True)
        self.docker.run.assert_called_once_with(["info", "--format", "{{.OSType}} {{.Architecture}}"], timeout=10)
        self.assertEqual({item.args[0][-1] for item in self.docker.json.call_args_list}, set(self.images))
        self.assertEqual(report["coreImage"]["id"], CORE)
        self.assertEqual(report["baselineImageSource"], "preloaded")
        self.assertEqual(report["baselineImages"], self.baseline_pins)
        self.assertEqual(report["bundleManifestSha256"], self.args.baseline_manifest_sha256)
        self.assertEqual(report["archiveSha256"], sha256(self.args.bundle_dir / ARCHIVE))
        self.assertEqual(self.smoke.report["images"], report)

    def test_default_still_loads_exact_archive_once(self):
        self.mixed_images()
        report = self.load(preloaded=False)
        self.assertEqual(report["baselineImageSource"], "archive-load")
        self.assertEqual(self.docker.run.call_count, 2)
        self.docker.run.assert_called_with(["image", "load", "--input", str(self.args.bundle_dir / ARCHIVE)], timeout=300)

    def test_preloaded_refuses_archive_tampering_before_inspecting_images(self):
        self.mixed_images()
        (self.args.bundle_dir / ARCHIVE).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "bundle content changed"):
            self.load(preloaded=True)
        self.docker.json.assert_not_called()
        self.assertEqual(self.docker.run.call_count, 1)

    def test_preloaded_refuses_missing_wrong_platform_revision_id_and_user(self):
        self.mixed_images()
        worker = self.baseline_pins["worker"]
        exact = self.images[worker]
        for changes, exception in (
            ({"Architecture": "arm64"}, WebSwitchSmokeError),
            ({"Id": self.baseline_pins["realtime"]}, WebSwitchSmokeError),
            ({"Config": exact["Config"] | {"User": "nobody"}}, WebSwitchSmokeError),
            ({"Config": exact["Config"] | {"Labels": {"org.opencontainers.image.revision": "f" * 40}}}, SmokeError),
        ):
            self.images[worker] = exact | changes
            with self.subTest(changes=changes), self.assertRaises(exception):
                self.load(preloaded=True)
        del self.images[worker]
        with self.assertRaisesRegex(SmokeError, "Docker image failed"):
            self.load(preloaded=True)
        self.assertTrue(all(call.args[0][0] == "info" for call in self.docker.run.call_args_list))

    def test_core_identity_and_distinct_pins_hold_before_optional_archive_load(self):
        self.mixed_images()
        exact = self.images[CORE]
        for changes in ({"Architecture": "arm64"}, {"Id": self.baseline_pins["web"]},
                        {"Config": exact["Config"] | {"Volumes": {"/app": {}}}},
                        {"Config": exact["Config"] | {"Cmd": ["bun", "wrong"]}}):
            self.images[CORE] = exact | changes
            with self.subTest(changes=changes), self.assertRaisesRegex(WebSwitchSmokeError, "distinct native final Core"):
                self.load(preloaded=False)
        self.args.core_image_id = self.baseline_pins["worker"]
        with self.assertRaisesRegex(WebSwitchSmokeError, "Distinct immutable Core, Web and retained backend"):
            self.load(preloaded=False)
        self.assertTrue(all(call.args[0][0] == "info" for call in self.docker.run.call_args_list))

    def test_both_native_caddy_configs_keep_same_core_proxy_and_exact_web_policies(self):
        caddy = shutil.which("caddy")
        if caddy is None:
            self.skipTest("Native Caddy binary unavailable")
        self.smoke.fixture = SimpleNamespace(prefix=PREFIX)
        source = fixture_caddyfile(OLD.target, PREFIX + "-realtime").replace(f" header {GENERATION_HEADER} generation-a\n", "")
        result = subprocess.run([caddy, "adapt", "--config", "-", "--adapter", "caddyfile"], input=source,
                                text=True, capture_output=True, timeout=8, check=True)
        adapted = json.loads(result.stdout)
        documents = self.smoke.compile_documents(adapted, OLD, NEW)
        previous = generation_configs(adapted, OLD, NEW)
        for active, retained in ((OLD, NEW), (NEW, OLD)):
            with self.subTest(active=active):
                document = deepcopy(documents[active.deployment_id])
                subprocess.run([caddy, "validate", "--config", "-"], input=canonical(document),
                               capture_output=True, timeout=8, check=True)
                server, = document["apps"]["http"]["servers"].values()
                routes = server["routes"][-1]["handle"][0]["routes"]
                expected = core_api_routes(PREFIX + "-core", active, retained)
                self.assertEqual(routes[:len(expected)], expected)
                del routes[:len(expected)]
                self.assertEqual(document, previous[active.deployment_id])
        self.assertEqual(self.smoke.runtime_memory_limit() - MixedWebSmoke.runtime_memory_limit(self.smoke), CORE_MEMORY_MIB * MIB)

    def test_exact_rpc_keeps_cookie_in_stdin_and_refuses_changed_identity_or_schema(self):
        fixture = self.smoke
        fixture.core = PREFIX + "-core"
        fixture.producer = {"id": "producer"}
        fixture.protected = {"core": {"pid": 81}}
        fixture.schema_sha = "e" * 64
        fixture.protected_runtimes = Mock(return_value=fixture.protected)
        fixture._producer = Mock(return_value=fixture.producer)
        fixture.schema = Mock(return_value=fixture.schema_sha)
        route = {"generation": NEW.deployment_id, "fingerprint": "f" * 64}
        fixture.target = SimpleNamespace(slots={NEW.deployment_id: {"route": route}}, read_route=lambda: (route, "etag"))
        fixture.direct_readback = {NEW.deployment_id: {"identity": {"sourceRevision": "b" * 40, "version": "1.2.3"}}}
        result = {"session": ACTOR, "sourceRevision": "b" * 40, "version": "1.2.3", "anonymousDenied": True,
                  "csrfDenied": True, "unknownStampRejected": True, "realtimeTickets": 2, "durableOwnedReports": 2}
        self.docker.run.return_value.stdout = json.dumps(result).encode()
        output = fixture.rpc("baseline", NEW.deployment_id, OLD.deployment_id)
        self.assertNotIn("session", output)
        self.assertEqual(output["durableOwnedReports"], 2)
        fixture.rpc("reapply", NEW.deployment_id, OLD.deployment_id)
        command, = self.docker.run.call_args.args
        self.assertNotIn(ACTOR["cookie"], " ".join(command))
        self.assertIn(ACTOR["cookie"].encode(), self.docker.run.call_args.kwargs["input_bytes"])
        self.docker.run.return_value.stdout = json.dumps(result | {"session": ACTOR | {"csrf": "B" * 43}}).encode()
        with self.assertRaisesRegex(WebSwitchSmokeError, "original native session"):
            fixture.rpc("reapply", NEW.deployment_id, OLD.deployment_id)
        self.docker.run.return_value.stdout = json.dumps(result).encode()
        fixture.schema.return_value = "0" * 64
        with self.assertRaisesRegex(WebSwitchSmokeError, "database schema changed"):
            fixture.rpc("reapply", NEW.deployment_id, OLD.deployment_id)

    def test_probe_script_parses_on_local_bun_without_running_it(self):
        bun = shutil.which("bun")
        if bun is None:
            self.skipTest("Local Bun unavailable")
        transpile = "new Bun.Transpiler({loader:'js'}).transformSync(await Bun.stdin.text())"
        subprocess.run([bun, "--no-env-file", "-e", transpile], input=CORE_RPC_PROBE, text=True,
                       capture_output=True, timeout=8, check=True)

    def cli_arguments(self, core_image=CORE):
        return ["--bundle-dir", str(self.root / "bundle"), "--output-dir", str(self.root / "report"),
                "--baseline-manifest-sha256", "f" * 64, "--baseline-revision", "a" * 40,
                "--new-web-revision", "b" * 40, "--core-revision", "d" * 40,
                "--new-web-image-id", "sha256:" + "b" * 64, "--core-image-id", core_image]

    def test_cli_rejects_mutable_or_duplicate_image_reference_before_docker(self):
        with patch("core_mixed_image_smoke.IsolatedDocker") as docker, patch("sys.stderr"):
            for core_image in ("warpdrive:mutable", "sha256:" + "b" * 64):
                with self.subTest(core_image=core_image), self.assertRaises(SystemExit) as error:
                    main(self.cli_arguments(core_image))
                self.assertEqual(error.exception.code, 2)
            docker.assert_not_called()

    def test_cli_passes_explicit_preloaded_mode_to_harness(self):
        with patch("core_mixed_image_smoke.IsolatedDocker"), patch("core_mixed_image_smoke.CoreMixedImageSmoke") as smoke, \
                patch("core_mixed_image_smoke.platform.system", return_value="Linux"), \
                patch("core_mixed_image_smoke.platform.machine", return_value="x86_64"), patch("builtins.print"):
            for preloaded in (False, True):
                options = ["--baseline-preloaded"] if preloaded else []
                self.assertEqual(main(self.cli_arguments() + options), 0)
                self.assertIs(smoke.call_args.args[1].baseline_preloaded, preloaded)


if __name__ == "__main__":
    unittest.main()
