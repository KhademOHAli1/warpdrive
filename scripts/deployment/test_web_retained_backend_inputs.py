"""Regressions for fresh backend closure and its original artifact binding."""

from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import component_inputs as inputs
from test_component_inputs import fixture, rehash
from web_retained_backend_inputs import DISCOVER, RETAINED, _write_private, verify_retained_backend_inputs


class RetainedBackendInputsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.receipt = fixture(self.root)
        self.projected = {**self.receipt, "components": {name: self.receipt["components"][name] for name in RETAINED}}
        self.git("init", "--quiet")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "original inputs")
        self.revision = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, check=True, timeout=10).stdout.strip()

    def verify(self, **overrides):
        options = {"expected_revision": self.revision, "retained_receipt": self.receipt,
                   "expected_retained_sha256": inputs.content_hash(self.receipt)}
        return verify_retained_backend_inputs(self.root, **(options | overrides))

    def discovered(self, receipt=None, *, before=None):
        expected = self.projected if receipt is None else receipt
        original = inputs._discover

        def discover(arguments, root, environment, **limits):
            if arguments[0] != "node":
                return original(arguments, root, environment, **limits)
            self.assertEqual(arguments[:6], ["node", "--input-type=module", "-e", DISCOVER, "--", "."])
            self.assertEqual(root, self.root)
            self.assertNotIn("NODE_OPTIONS", environment)
            self.assertNotIn("SECRET_ENV", environment)
            if before is not None:
                before()
            return inputs.canonical(expected)

        return patch.object(inputs, "_discover", side_effect=discover)

    def test_fresh_backend_only_result_accepts_web_only_commit_with_frozen_policy_and_graphs(self):
        (self.root / "src/web.ts").write_text("Web-only presentation")
        self.git("add", "src/web.ts")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "web-only")
        current = self.git("rev-parse", "HEAD")
        with self.discovered(), patch.dict(os.environ, {"NODE_OPTIONS": "--require=/fixture/unknown", "SECRET_ENV": "private"}):
            self.assertEqual(self.verify(expected_revision=current), self.projected)
        self.assertNotEqual(current, self.revision)
        self.assertEqual(set(self.receipt["components"]), {*RETAINED, "web"})

    def test_changed_worker_or_shared_policy_source_stops_before_node_execution(self):
        for path in ("src/worker.ts", "scripts/deployment/component_inputs.mjs"):
            with self.subTest(path=path):
                source = self.root / path
                original = source.read_bytes()
                source.write_bytes(b"changed protected input")
                self.git("add", path)
                self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "protected change")
                with self.discovered(before=lambda: self.fail("unqualified checkout code executed")):
                    with self.assertRaisesRegex(inputs.InputError, "input file"):
                        self.verify(expected_revision=self.git("rev-parse", "HEAD"))
                source.write_bytes(original)
                self.git("add", path)

    def test_fresh_graph_cannot_add_a_self_consistent_dependency(self):
        added = "src/new-worker-import.ts"
        body = b"new dependency"
        (self.root / added).write_bytes(body)
        current = deepcopy(self.projected)
        worker = current["components"]["worker"]
        worker["inputs"].append({"path": added, "bytes": len(body), "sha256": sha256(body).hexdigest()})
        worker["inputs"].sort(key=lambda item: item["path"])
        worker["graphInputs"] = sorted([*worker["graphInputs"], added])
        with self.discovered(rehash(current)):
            with self.assertRaisesRegex(inputs.InputError, "Fresh worker graph"):
                self.verify()

    def test_discovery_result_cannot_change_context_or_predecessor_pin(self):
        with self.discovered(before=lambda: self.fail("wrong retained pin executed discovery")):
            with self.assertRaisesRegex(inputs.InputError, "admitted digest"):
                self.verify(expected_retained_sha256="0" * 64)
        current = deepcopy(self.projected)
        current["context"]["buildArgs"]["APP_VERSION"] = "changed"
        with self.discovered(rehash(current)):
            with self.assertRaisesRegex(inputs.InputError, "build context or input policy changed"):
                self.verify()

    def test_source_mutation_during_node_discovery_is_rechecked(self):
        def change():
            (self.root / "src/migrator.ts").write_bytes(b"changed during discovery")

        with self.discovered(before=change):
            with self.assertRaisesRegex(inputs.InputError, "input file"):
                self.verify()

    def test_output_is_private_and_refuses_overwrite(self):
        output = self.root / "fresh-backend.json"
        _write_private(output, self.projected)
        self.assertEqual(stat.S_IMODE(output.lstat().st_mode), 0o600)
        self.assertEqual(inputs.load_receipt(output), self.projected)
        with self.assertRaises(FileExistsError):
            _write_private(output, self.receipt)
        self.assertEqual(inputs.load_receipt(output), self.projected)
