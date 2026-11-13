"""Exercise actual functional publication and native image-load journal composition."""

from copy import deepcopy
from hashlib import sha256
import json
import tarfile
import zipfile
import unittest
from unittest.mock import Mock, patch

import installed_web_functional_image as functional
from installed_web_image import DANGLING, JOURNAL, WebImageError, WebImageUnknown
from test_installed_web_image import DAEMON
import test_web_functional_publication as publication
from web_candidate import _record


class InstalledFunctionalWebImageTests(unittest.TestCase):
    def setUp(self):
        fixture = publication.FunctionalWebPublicationTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.receipt = fixture.retain()
        self.raw = (fixture.output / "receipt.json").read_bytes()
        self.directory = fixture.output / "bundle"
        self.state = fixture.output.parent / "load-state"
        self.state.mkdir(mode=0o700)
        manifest_raw = (self.directory / functional.MANIFEST).read_bytes()
        self.manifest = json.loads(manifest_raw)
        pin = sha256(self.raw).hexdigest()
        self.imported = {"schemaVersion": 1, "kind": "warpdrive-web-functional-artifact-import", "revision": self.receipt["revision"],
                         "publicationReceiptSha256": pin, "origin": self.receipt["origin"], "artifactId": self.receipt["artifact"]["id"],
                         "baseline": self.receipt["baseline"], "bundleManifestSha256": self.receipt["provenance"]["bundleManifestSha256"],
                         "testedConfigDigest": self.receipt["image"]["imageId"],
                         "files": {functional.MANIFEST: _record(manifest_raw), **self.manifest["files"]}, "deploymentAuthorized": False}
        self.pins = {"expected_publication_sha256": pin, "expected_lineage_sha256": fixture.lineage_sha,
                     "expected_revision": self.receipt["revision"], "installed_chain": fixture.lineage, "import_record": self.imported}
        self.archive = self.directory / functional.ARCHIVE
        with zipfile.ZipFile(fixture.output / publication.gate.ZIP_NAME) as package:
            self.assertEqual(package.read(functional.ARCHIVE), self.archive.read_bytes())
        with tarfile.open(self.archive, mode="r:") as package:
            descriptor, = json.load(package.extractfile("index.json"))["manifests"]
            config = json.load(package.extractfile("blobs/sha256/" + self.receipt["image"]["imageId"][7:]))
        self.native_digest = descriptor["digest"]
        self.native = {"Id": self.native_digest, "Descriptor": descriptor, "Os": "linux", "Architecture": "amd64",
                       "Config": config["config"], "RootFS": {"Type": "layers", "Layers": config["rootfs"]["diff_ids"]},
                       "RepoTags": [], "RepoDigests": []}
        self.inventory = {}
        self.docker = Mock()
        self.docker.identity.return_value = DAEMON
        self.docker.inventory.side_effect = lambda: deepcopy(self.inventory)
        self.docker.inspect.return_value = [self.native]
        self.docker.load.side_effect = self.effect

    def effect(self, source):
        self.assertEqual(source.tell(), 0)
        self.assertEqual(source.read(), self.archive.read_bytes())
        self.assertEqual(json.loads((self.state / JOURNAL).read_bytes())["payload"]["state"], "intent")
        self.inventory[self.native_digest] = deepcopy(DANGLING)

    def verify(self, **overrides):
        return functional.verify_received_functional(self.directory, self.raw, **(self.pins | overrides))

    def load(self, **overrides):
        return functional.load_installed_functional_image(self.directory, publication_bytes=self.raw, state_dir=self.state,
            docker=self.docker, expected_daemon=DAEMON, **(self.pins | overrides))

    def test_exact_import_composes_with_native_archive_and_returns_config_and_manifest_distinctly(self):
        self.assertEqual(self.verify(), self.receipt)
        loaded = self.load()
        self.assertEqual(loaded["testedConfigDigest"], self.receipt["image"]["imageId"])
        self.assertEqual(loaded["imageId"], self.native_digest)
        self.assertNotEqual(loaded["testedConfigDigest"], loaded["imageId"])
        self.assertEqual(loaded["baselineManifestSha256"], self.pins["installed_chain"]["active"]["provenance"]["manifestSha256"])
        self.assertEqual(loaded, self.load())
        self.docker.load.assert_called_once()

    def test_foreign_lineage_and_unbound_import_stop_before_native_loader(self):
        wrong = {**self.imported, "deploymentAuthorized": 0}
        with patch.object(functional, "load_verified_web_archive") as native:
            with self.assertRaisesRegex(WebImageError, "admitted current Web chain"):
                self.load(expected_lineage_sha256="0" * 64)
            with self.assertRaisesRegex(WebImageError, "import receipt differs"):
                self.load(import_record=wrong)
            with self.assertRaisesRegex(WebImageError, "persisted functional Web import receipt required"):
                self.load(import_record=None)
            native.assert_not_called()

    def test_manifest_and_private_metadata_changes_hold(self):
        path = self.directory / functional.REPORT
        raw = path.read_bytes()
        path.write_bytes(raw + b" ")
        with self.assertRaisesRegex(WebImageError, "input or report custody differs"):
            self.verify()
        path.write_bytes(raw)
        path.chmod(0o644)
        with self.assertRaisesRegex(WebImageError, "private functional Web metadata"):
            self.verify()
        path.chmod(0o600)
        manifest = self.directory / functional.MANIFEST
        manifest.write_bytes(manifest.read_bytes() + b"\n")
        with self.assertRaisesRegex(WebImageError, "manifest differs"):
            self.verify()

    def test_same_size_archive_corruption_stops_before_docker_load(self):
        raw = self.archive.read_bytes()
        self.archive.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
        with self.assertRaisesRegex(WebImageError, "archive differs from admitted bytes"):
            self.load()
        self.docker.load.assert_not_called()
        self.assertFalse((self.state / JOURNAL).exists())

    def test_lost_ack_reconciles_without_replaying_load(self):
        def lose(source):
            self.effect(source)
            raise TimeoutError("fixture lost response")

        self.docker.load.side_effect = lose
        with self.assertRaises(WebImageUnknown):
            self.load()
        with self.assertRaisesRegex(WebImageUnknown, "Prior load intent"):
            self.load()
        self.assertEqual(self.load(reconcile=True)["state"], "verified")
        self.docker.load.assert_called_once()
