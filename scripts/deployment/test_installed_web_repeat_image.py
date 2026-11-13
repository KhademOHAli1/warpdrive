"""Exercise the repeat image boundary with the exact v2 publication format."""
import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch

import test_web_repeat_publication as publication
from installed_web_image import WebImageError
from installed_web_repeat_image import MANIFEST, load_installed_repeat_image, verify_received_repeat


class RepeatInstalledImageTests(unittest.TestCase):
    def setUp(self):
        fixture = publication.RepeatWebPublicationTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.publication = fixture.retain()
        self.directory = fixture.destination
        self.bundle = self.directory / "bundle"
        self.raw = (self.directory / "receipt.json").read_bytes()
        self.pins = {"expected_publication_sha256": hashlib.sha256(self.raw).hexdigest(),
                     "expected_lineage_sha256": self.publication["baseline"]["installedLineageSha256"],
                     "expected_revision": self.publication["revision"],
                     "expected_active_revision": self.publication["baseline"]["activeWeb"]["revision"]}

    def test_exact_publication_passes_only_its_archive_to_native_loader(self):
        self.assertEqual(verify_received_repeat(self.bundle, self.raw, **self.pins), self.publication)
        with patch("installed_web_repeat_image.load_verified_web_archive", return_value={"state": "verified"}) as load:
            result = load_installed_repeat_image(self.bundle, publication_bytes=self.raw, state_dir=Path("/private/state"),
                docker=None, expected_daemon={}, **self.pins)
        self.assertEqual(result, {"state": "verified"})
        self.assertEqual(load.call_args.kwargs["image"], self.publication["image"])
        self.assertEqual(load.call_args.kwargs["provenance"], self.publication["provenance"])

    def test_refuses_foreign_lineage_and_changed_manifest_before_native_load(self):
        with self.assertRaises(WebImageError):
            verify_received_repeat(self.bundle, self.raw, **(self.pins | {"expected_lineage_sha256": "8" * 64}))
        path = self.bundle / MANIFEST
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaises(WebImageError):
            verify_received_repeat(self.bundle, self.raw, **self.pins)
