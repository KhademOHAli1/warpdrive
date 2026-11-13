"""Exercise Git/object admission in an owned repo, with discovery isolated from the compiler."""
import copy
from contextlib import contextmanager
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import component_inputs as inputs
from test_component_inputs import fixture as input_fixture, rehash
import web_release_inputs as release


ENGINE_FILES = (
    "Dockerfile", "build.sh", "nonroot-entrypoint.sh",
    "patches/090-explicit-migrations.patch", "migration-tests/verify.py", "migration-tests/test_verify.py",
)


class WebReleaseInputsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="warpdrive-web-input-test-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.historical = input_fixture(self.root)
        for path in release.RUNTIME_FILES:
            self.write(path, ("source policy " + path).encode())
        for name in ENGINE_FILES:
            self.write(f"{release.ENGINE_ROOT}/{name}", ("engine context " + name).encode())
        self.write(release.STYLE_FILE, b".header {\n  gap: 24px;\n  height: 72px;\n}\n")
        for path in release.COPY_FILES:
            self.write(path, b'{"clearSelection":"Clear selection","selectedCount":"{count, number} selected"}\n')
        self.write("bun.lock", b"shared lock")
        self.historical["policy"]["sharedFiles"].append("bun.lock")
        for component in self.historical["components"].values():
            self.set_record(component, "bun.lock")
        for path in (*release.RUNTIME_FILES, release.STYLE_FILE, *release.COPY_FILES):
            self.set_record(self.historical["components"]["web"], path)
        rehash(self.historical)
        self.git("init", "-q")
        self.original = self.commit("Accepted baseline")
        policy = release.source_policy(self.root, self.original)
        components = {}
        for index, name in enumerate(("web", *release.RETAINED), 1):
            row = {
                "registryRef": f"ghcr.io/owned/fixture-{name}@sha256:{index + 20:064x}",
                "imageId": f"sha256:{index:064x}",
                "sourceRevision": self.original if name == "web" else "a" * 40,
            }
            if name in inputs.COMPONENTS:
                row.update(inputSha256=self.historical["components"][name]["componentInputSha256"],
                           inputPolicySha256=self.historical["inputPolicySha256"])
            if name == "engine":
                row.update(contextVersion=release.ENGINE_CONTEXT_VERSION, contextSha256=policy["engineContextSha256"])
            if name == "ingress":
                row["sourceRevision"] = None
            components[name] = row
        self.baseline = release.AuthenticatedBaseline(
            self.original, self.historical, inputs.content_hash(self.historical), components,
            policy["runtimePolicySha256"], "a" * 64, "b" * 64,
        )
        self.current = copy.deepcopy(self.historical)

    def git(self, *arguments):
        return subprocess.run(
            ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
             "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "core.filemode=true", *arguments],
            cwd=self.root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8,
        ).stdout

    def commit(self, message):
        self.git("add", "-f", "--", ".")
        self.git("commit", "-qm", message)
        return self.git("rev-parse", "HEAD").decode("ascii").strip()

    def write(self, relative, data):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def set_record(self, component, path):
        raw = (self.root / path).read_bytes()
        record = {"path": path, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        component["inputs"] = sorted(
            [item for item in component["inputs"] if item["path"] != path] + [record],
            key=lambda item: item["path"],
        )

    def presentation_commit(self, *, css=None, copy_label=None):
        if css is not None:
            self.write(release.STYLE_FILE, css)
            self.set_record(self.current["components"]["web"], release.STYLE_FILE)
        if copy_label is not None:
            path = release.COPY_FILES[1]
            value = json.loads((self.root / path).read_bytes())
            value[release.COPY_KEY] = copy_label
            self.write(path, json.dumps(value, ensure_ascii=False).encode())
            self.set_record(self.current["components"]["web"], path)
        rehash(self.current)
        return self.commit("Presentation source change")

    @contextmanager
    def mock_discovery(self, discovery=None):
        original_discover = inputs._discover
        received = []

        def discover(arguments, *args, **kwargs):
            if arguments[0] == "node":
                received.append(arguments)
                return inputs.canonical(self.current if discovery is None else discovery)
            return original_discover(arguments, *args, **kwargs)

        with patch.object(inputs, "_discover", side_effect=discover):
            yield
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0][1], "scripts/deployment/component_inputs.mjs")

    def admit(self, revision, *, baseline=None, discovery=None):
        with self.mock_discovery(discovery):
            return release.admit_web_release(
                self.root, self.current, expected_revision=revision,
                baseline=self.baseline if baseline is None else baseline,
            )

    def test_real_git_css_and_copy_delta_admits_web_and_keeps_original_artifacts(self):
        revision = self.presentation_commit(css=b".header {\n  gap: 22px;\n  height: 72px;\n}\n",
                                            copy_label="Clear selected rows")
        before = copy.deepcopy(self.baseline.components)
        result = self.admit(revision)
        self.assertEqual(result["releaseRevision"], revision)
        self.assertEqual(result["acceptedReleaseRevision"], self.original)
        self.assertEqual(result["changedPresentationPaths"], sorted([release.STYLE_FILE, release.COPY_FILES[1]]))
        self.assertEqual(result["buildComponents"], ["web"])
        self.assertEqual(result["acceptedWeb"], before["web"])
        self.assertEqual(result["retainedComponents"], {name: before[name] for name in release.RETAINED})
        self.assertEqual(self.baseline.components, before)
        self.assertEqual(result["acceptedRuntimeConfigSha256"], self.baseline.runtime_config_sha256)
        self.assertEqual(result["currentCoreInputReceiptSha256"], inputs.content_hash(self.current))
        self.assertFalse(result["deploymentAuthorized"])

    def test_existing_css_property_change_alone_keeps_backend_input_receipts_equal(self):
        revision = self.presentation_commit(css=b".header {\n  gap: 22px;\n  height: 70px;\n}\n")
        result = self.admit(revision)
        self.assertEqual(result["changedPresentationPaths"], [release.STYLE_FILE])
        self.assertEqual(result["buildComponents"], ["web"])
        for name in ("worker", "realtime", "migrator"):
            self.assertEqual(self.current["components"][name], self.historical["components"][name])
            self.assertEqual(result["retainedComponents"][name], self.baseline.components[name])

    def test_source_only_verification_binds_receipts_without_authenticated_image_facts(self):
        revision = self.presentation_commit(copy_label="Clear selected rows")
        with self.mock_discovery():
            source = release.verify_web_source_delta(
                self.root, self.current, expected_revision=revision,
                baseline_revision=self.original, baseline_receipt=self.historical,
            )
        self.assertEqual(source["kind"], "warpdrive-web-source-delta")
        self.assertEqual(source["releaseRevision"], revision)
        self.assertEqual(source["baselineRevision"], self.original)
        self.assertEqual(source["baselineCoreInputReceiptSha256"], inputs.content_hash(self.historical))
        self.assertEqual(source["runtimePolicySha256"], self.baseline.runtime_policy_sha256)
        self.assertEqual(source["buildComponents"], ["web"])
        self.assertFalse(source["deploymentAuthorized"])
        self.assertFalse({"acceptedWeb", "retainedComponents", "acceptedAuthoritySha256",
                          "acceptedRuntimeConfigSha256"} & source.keys())
        authenticated = self.admit(revision)
        for key in ("changedPresentationPaths", "currentCoreInputReceiptSha256", "currentWebInputSha256",
                    "engineContextSha256", "engineContextTreeSha256", "runtimePolicySha256"):
            self.assertEqual(authenticated[key], source[key])

    def test_executable_shared_engine_and_ingress_source_changes_refuse(self):
        cases = (
            "src/web.ts", "src/worker.ts", "src/new-ui.tsx", "bun.lock",
            "package.json", "Caddyfile", "docker-compose.yml", f"{release.ENGINE_ROOT}/build.sh",
            "scripts/deployment/component_inputs.mjs", ".github/workflows/unreviewed.yml",
        )
        for relative in cases:
            with self.subTest(relative=relative):
                self.git("reset", "--hard", self.original)
                self.current = copy.deepcopy(self.historical)
                self.write(relative, b"changed source")
                revision = self.presentation_commit(copy_label="Clear selected rows")
                with self.assertRaisesRegex(release.WebReleaseInputError, "presentation-only profile"):
                    self.admit(revision)

    def test_presentation_and_new_release_tool_preserve_all_backend_inputs(self):
        path = ".github/workflows/web-image-qualification.yml"
        self.write(path, b"name: Web-only qualification\n")
        self.set_record(self.current["components"]["web"], path)
        revision = self.presentation_commit(copy_label="Clear selected rows")
        result = self.admit(revision)
        self.assertEqual(result["changedReleaseToolingPaths"], [path])
        self.assertEqual(result["changedPresentationPaths"], [release.COPY_FILES[1]])
        self.assertEqual(result["buildComponents"], ["web"])
        for name in ("worker", "realtime", "migrator"):
            self.assertEqual(self.current["components"][name], self.historical["components"][name])

    def test_release_tool_alone_does_not_admit_web(self):
        path = ".github/workflows/web-image-qualification.yml"
        self.write(path, b"name: Web-only qualification\n")
        self.set_record(self.current["components"]["web"], path)
        revision = self.presentation_commit()
        with self.assertRaisesRegex(release.WebReleaseInputError, "presentation-only profile"):
            self.admit(revision)

    def test_executable_release_tool_does_not_admit_web(self):
        path = "scripts/deployment/web_release_build.py"
        self.write(path, b"pass\n")
        (self.root / path).chmod(0o755)
        self.set_record(self.current["components"]["web"], path)
        revision = self.presentation_commit(copy_label="Clear selected rows")
        with self.assertRaisesRegex(release.WebReleaseInputError, "regular non-executable"):
            self.admit(revision)

    def test_rejects_css_import_new_declaration_mode_and_copy_contract_drift(self):
        css_cases = (
            b'@import url("https://fixture.invalid/a.css");\n.header {\n  gap: 22px;\n  height: 72px;\n}\n',
            b".header {\n  gap: 22px;\n  height: 72px;\n  opacity: 0;\n}\n",
            b".header {\n  gap: 200px;\n  height: 72px;\n}\n",
        )
        for css in css_cases:
            with self.subTest(css=css):
                self.git("reset", "--hard", self.original)
                self.current = copy.deepcopy(self.historical)
                revision = self.presentation_commit(css=css)
                with self.assertRaisesRegex(release.WebReleaseInputError, "CSS delta"):
                    self.admit(revision)
        self.git("reset", "--hard", self.original)
        self.current = copy.deepcopy(self.historical)
        (self.root / release.STYLE_FILE).chmod(0o755)
        revision = self.presentation_commit(css=b".header {\n  gap: 22px;\n  height: 72px;\n}\n")
        with self.assertRaisesRegex(release.WebReleaseInputError, "file type changed"):
            self.admit(revision)
        for content in (
            b'{"clearSelection":"<a>Clear</a>","selectedCount":"{count, number} selected"}',
            b'{"clearSelection":"Clear selected rows","selectedCount":"{actor} selected"}',
            b'{"clearSelection":"Clear","clearSelection":"Clear again","selectedCount":"{count, number} selected"}',
        ):
            with self.subTest(content=content):
                self.git("reset", "--hard", self.original)
                self.current = copy.deepcopy(self.historical)
                self.write(release.COPY_FILES[1], content)
                self.set_record(self.current["components"]["web"], release.COPY_FILES[1])
                rehash(self.current)
                revision = self.commit("Unreviewed copy delta")
                with self.assertRaises((release.WebReleaseInputError, inputs.InputError)):
                    self.admit(revision)

    def test_raw_checkout_check_refuses_hidden_changed_input_and_stale_discovery(self):
        revision = self.presentation_commit(copy_label="Clear selected rows")
        with self.assertRaisesRegex(inputs.InputError, "fresh dependency discovery differs"):
            self.admit(revision, discovery=self.historical)
        self.git("update-index", "--assume-unchanged", "--", "src/web.ts")
        self.write("src/web.ts", b"new")
        with self.assertRaisesRegex(inputs.InputError, "changed or digest differs"):
            self.admit(revision)
        self.set_record(self.current["components"]["web"], "src/web.ts")
        rehash(self.current)
        with self.assertRaisesRegex(inputs.InputError, "differs from exact HEAD blob"):
            self.admit(revision)

    def test_historical_receipt_and_original_image_policy_tampering_refuse(self):
        revision = self.presentation_commit(copy_label="Clear selected rows")
        with self.assertRaisesRegex(release.WebReleaseInputError, "receipt digest differs"):
            self.admit(revision, baseline=replace(self.baseline, core_input_receipt_sha256="0" * 64))
        for target, key, value in (
            ("worker", "registryRef", "ghcr.io/owned/fixture-worker:mutable"),
            ("realtime", "inputSha256", "0" * 64),
            ("migrator", "sourceRevision", "fake"),
            ("engine", "contextVersion", "unknown"),
            ("engine", "contextSha256", "0" * 64),
            ("ingress", "imageId", "caddy:2"),
        ):
            with self.subTest(target=target, key=key):
                components = copy.deepcopy(self.baseline.components)
                components[target][key] = value
                with self.assertRaises(release.WebReleaseInputError):
                    self.admit(revision, baseline=replace(self.baseline, components=components))
        with self.assertRaisesRegex(release.WebReleaseInputError, "runtime|source policy"):
            self.admit(revision, baseline=replace(self.baseline, runtime_policy_sha256="0" * 64))
        historical = copy.deepcopy(self.historical)
        row = next(item for item in historical["components"]["web"]["inputs"] if item["path"] == release.STYLE_FILE)
        row["sha256"] = "0" * 64
        rehash(historical)
        components = copy.deepcopy(self.baseline.components)
        components["web"]["inputSha256"] = historical["components"]["web"]["componentInputSha256"]
        with self.assertRaisesRegex(inputs.InputError, "differs from exact HEAD blob"):
            self.admit(revision, baseline=replace(
                self.baseline, core_input_receipt=historical, components=components,
                core_input_receipt_sha256=inputs.content_hash(historical),
            ))

    def test_changed_backend_receipt_or_extra_engine_context_does_not_admit(self):
        revision = self.presentation_commit(copy_label="Clear selected rows")
        self.current["components"]["worker"]["limitations"].append("New discovery contract")
        with self.assertRaisesRegex(release.WebReleaseInputError, "retained Core"):
            self.admit(revision)
        self.current["components"]["worker"]["limitations"].pop()
        self.write(f"{release.ENGINE_ROOT}/extra-build-file", b"untracked engine input")
        with self.assertRaisesRegex(release.WebReleaseInputError, "Engine checkout differs"):
            self.admit(revision)

    def test_no_change_or_untyped_facts_cannot_authorize_release(self):
        with self.assertRaisesRegex(release.WebReleaseInputError, "distinct exact release"):
            self.admit(self.original)
        revision = self.presentation_commit(copy_label="Clear selected rows")
        with self.assertRaisesRegex(release.WebReleaseInputError, "resolver facts required"):
            self.admit(revision, baseline={"authenticated": True})


if __name__ == "__main__":
    unittest.main()
