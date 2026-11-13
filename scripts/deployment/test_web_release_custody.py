from hashlib import sha256
from http.client import HTTPMessage
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from candidate import CandidateError
from component_inputs import decode
import web_release_custody as custody


class CustodyTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.source = self.root / "sources" / "origin"
        self.source.parent.mkdir()
        self.payload = b'{"authenticated":"original bytes"}\n'
        self.source.write_bytes(self.payload)
        self.pin = "sha256:" + sha256(self.payload).hexdigest()
        self.options = {"kind": "receipt", "digest": self.pin, "size": len(self.payload)}

    def test_layout_indexes_the_original_bytes_under_the_expected_manifest(self):
        layout = self.root / "layout"
        immutable = custody.prepare_layout(layout, self.source, **self.options)
        raw = custody.custody_manifest(**self.options)
        blobs = layout / "blobs/sha256"
        self.assertEqual((blobs / immutable.split(":")[1]).read_bytes(), raw)
        self.assertEqual((blobs / self.pin.split(":")[1]).read_bytes(), self.payload)
        self.assertEqual(decode((layout / "index.json").read_bytes())["manifests"][0]["digest"], immutable)
        self.assertNotEqual(immutable, self.pin)
        self.assertNotEqual(raw, custody.custody_manifest(**{**self.options, "kind": "archive"}))

    def test_bad_origin_bytes_cannot_create_the_layout(self):
        self.source.write_bytes(self.payload.replace(b"original", b"modified"))
        layout = self.root / "layout"
        with self.assertRaisesRegex(CandidateError, "admitted bytes"):
            custody.prepare_layout(layout, self.source, **self.options)
        self.assertFalse(layout.exists())

    def test_manifest_mismatch_holds_before_blob_fetch(self):
        destination = self.root / "retrieved"
        with patch.object(custody, "_fetch_manifest", return_value=(0, b"{}")), \
                patch.object(custody, "_fetch_payload") as fetch:
            with self.assertRaisesRegex(CandidateError, "manifest differs"):
                custody.retrieve("oras", destination, **self.options)
        fetch.assert_not_called()
        self.assertFalse(destination.exists())

    def test_partial_failed_fetch_never_creates_the_final_filename(self):
        destination = self.root / "retrieved"

        def fail(*args, output, **kwargs):
            output.write(b"partial")
            raise CandidateError("simulated read failure")

        with patch.object(custody, "_fetch_manifest", return_value=(0, custody.custody_manifest(**self.options))), \
                patch.object(custody, "_fetch_payload", side_effect=fail):
            with self.assertRaisesRegex(CandidateError, "simulated read failure"):
                custody.retrieve("oras", destination, **self.options)
        self.assertFalse(destination.exists())

    def test_existing_local_intent_prevents_another_publication(self):
        layout = self.root / "layout"
        layout.mkdir()
        with patch.object(custody, "_fetch_manifest", return_value=(1, b"")), \
                patch("registry_absence.precheck_custody_manifest") as absence, \
                patch.object(custody.subprocess, "run") as write:
            with self.assertRaisesRegex(CandidateError, "unresolved"):
                custody.publish("oras", layout, self.source, **self.options)
        absence.assert_not_called()
        write.assert_not_called()

    def test_public_or_ambiguous_registry_authorization_holds(self):
        headers = HTTPMessage()
        repository = custody.REPOSITORY.split("/", 1)[1]
        headers.add_header("WWW-Authenticate", f'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:{repository}:pull"')
        challenge = (401, headers, b"{}")
        private = (401, HTTPMessage(), b'{"errors":[{"code":"UNAUTHORIZED"}]}')
        with patch("registry_absence._get", side_effect=(challenge, private)):
            custody._verify_anonymous_denied(self.pin)
        denied = (403, HTTPMessage(), b'{"errors":[{"code":"DENIED"}]}')
        for response in (denied, (200, HTTPMessage(), b'{"token":"anonymous"}'), (403, HTTPMessage(), b"{}")):
            with self.subTest(response=response), patch("registry_absence._get", side_effect=(challenge, response)):
                with self.assertRaisesRegex(CandidateError, "private package state"):
                    custody._verify_anonymous_denied(self.pin)
