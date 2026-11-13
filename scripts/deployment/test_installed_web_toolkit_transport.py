"""Exercise bounded toolkit transport, exact publication and lost-response readback."""

from contextlib import ExitStack
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import installed_web_toolkit_transport as transport


SCRIPT = Path(transport.__file__).resolve()
LARGE_FIXTURE = os.environ.get("WARPDRIVE_TEST_INSTALLED_TOOLKIT")
LARGE_PIN = os.environ.get("WARPDRIVE_TEST_INSTALLED_TOOLKIT_SHA256")


class InstalledToolkitTransportTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory(prefix="wd-toolkit-transport-"))).resolve()
        self.sender = self.root / "sender"
        self.receiver = self.root / "receiver"
        self.wire = self.root / "wire"
        self.destination = self.receiver / "operation-a"
        self.source = self.sender / "source"
        self.manifest = self.sender / "manifest.json"
        for path in (self.sender, self.receiver, self.source, self.source / "scripts", self.source / "scripts/deployment"):
            path.mkdir(mode=0o700)
        self.files = {name: f"raise AssertionError({name!r})\n".encode() for name in sorted(transport.REQUIRED)}
        self.document = {"kind": "warpdrive-local-installed-web-toolkit-proposal", "version": 1,
                         "repositoryHead": "a" * 40, "draft": False, "transferred": False, "deploymentAuthorized": False,
                         "stageAcknowledgementEntry": transport.STAGE_ACK,
                         "sourceFiles": len(self.files), "pins": {path: sha256(raw).hexdigest() for path, raw in self.files.items()}}
        for name, raw in self.files.items():
            self.private(self.source / name, raw)
        self.manifest_bytes = (json.dumps(self.document, indent=2) + "\n").encode()
        self.private(self.manifest, self.manifest_bytes)
        self.expected = sha256(self.manifest_bytes).hexdigest()

    @staticmethod
    def private(path, raw):
        path.write_bytes(raw)
        path.chmod(0o600)

    @staticmethod
    def executable(action, expected, *arguments):
        return [sys.executable, "-I", "-B", str(SCRIPT), action, "--manifest-sha256", expected, *map(str, arguments)]

    def send_cli(self, expected=None):
        return subprocess.run(self.executable("send", expected or self.expected, "--source", self.source, "--manifest", self.manifest),
                              stdin=subprocess.DEVNULL, capture_output=True, timeout=10, check=False)

    def run_cli(self, action, *, wire=None, expected=None):
        return subprocess.run(self.executable(action, expected or self.expected, "--destination", self.destination),
                              input=wire if wire is not None else b"", capture_output=True, timeout=10, check=False)

    def wire_bytes(self, raw_manifest=None, files=None):
        source = self.files if files is None else files
        frames = [self.manifest_bytes if raw_manifest is None else raw_manifest, *(source[name] for name in sorted(source))]
        return transport.MAGIC + b"".join(transport.SIZE.pack(len(frame)) + frame for frame in frames)

    def receive(self, wire):
        self.private(self.wire, wire)
        with self.wire.open("rb") as source:
            return transport.receive(self.destination, self.expected, source.fileno())

    def select_sources(self, files, **metadata):
        for name in self.files:
            (self.source / name).unlink()
        self.files = files
        for name, raw in files.items():
            path = self.source / name
            for parent in reversed(path.parents):
                if parent.is_relative_to(self.source):
                    parent.mkdir(mode=0o700, exist_ok=True)
            self.private(path, raw)
        self.document.update(metadata, sourceFiles=len(files), pins={name: sha256(raw).hexdigest() for name, raw in files.items()})
        self.manifest_bytes = (json.dumps(self.document, indent=2) + "\n").encode()
        self.private(self.manifest, self.manifest_bytes)
        self.expected = sha256(self.manifest_bytes).hexdigest()

    def modern_files(self):
        roots = {name: b"raise AssertionError('transport must not execute source')\n" for name in transport.MODERN_REQUIRED}
        return {**roots, transport.FUNCTIONAL_OPERATOR: b"from fixture_first import flag\n",
                transport.DEPLOYMENT + "fixture_first.py": b"from . import fixture_second\n",
                transport.DEPLOYMENT + "fixture_second.py": b"from fixture_first import flag\n"}

    def test_exact_standalone_transfer_and_receipt_readback(self):
        sender = self.send_cli()
        self.assertEqual((sender.returncode, sender.stderr), (0, b""))
        self.assertEqual(sender.stdout, self.wire_bytes())
        receiver = self.run_cli("receive", wire=sender.stdout)
        self.assertEqual((receiver.returncode, receiver.stderr), (0, b""))
        observed = self.run_cli("readback")
        self.assertEqual((observed.returncode, observed.stdout, observed.stderr), (0, receiver.stdout, b""))
        receipt = subprocess.run(self.executable("verify-receipt", self.expected, "--destination-name", self.destination.name), input=receiver.stdout,
                                 capture_output=True, timeout=10, check=False)
        self.assertEqual((receipt.returncode, receipt.stdout, receipt.stderr), (0, receiver.stdout, b""))
        self.assertEqual(json.loads(receipt.stdout), transport._receipt(self.destination.name, self.expected, self.files))
        with self.assertRaisesRegex(transport.TransportError, "Exact toolkit receipt"):
            transport._read_receipt(receipt.stdout, "another-operation", self.expected)
        self.assertEqual((self.destination / "manifest.json").read_bytes(), self.manifest_bytes)
        for name, raw in self.files.items():
            path = self.destination / "source" / name
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual((stat.S_IMODE(path.stat().st_mode), path.stat().st_nlink), (0o600, 1))
        self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o700
                            for path in self.destination.rglob("*") if path.is_dir()))

    def test_malformed_truncated_corrupt_oversized_and_trailing_wire_never_publish(self):
        valid = self.wire_bytes()
        corrupt = dict(self.files)
        name = next(iter(corrupt))
        corrupt[name] = b"X" + corrupt[name][1:]
        for data in (b"wrong", valid[:-1], self.wire_bytes(files=corrupt), valid + b"\n",
                     transport.MAGIC + transport.SIZE.pack(transport.MAX_MANIFEST + 1),
                     transport.MAGIC + transport.SIZE.pack(0),
                     transport.MAGIC + transport.SIZE.pack(len(self.manifest_bytes)) + self.manifest_bytes
                     + transport.SIZE.pack(transport.MAX_FILE + 1)):
            with self.subTest(size=len(data)), self.assertRaises(transport.TransportError):
                self.receive(data)
            self.assertEqual(list(self.receiver.iterdir()), [])
        wrong_pin = self.run_cli("receive", wire=valid, expected="f" * 64)
        self.assertEqual(wrong_pin.returncode, 1)
        self.assertEqual(wrong_pin.stdout, b"")
        self.assertEqual(list(self.receiver.iterdir()), [])

    def test_missing_eof_holds_on_bounded_channel_deadline(self):
        reader, writer = os.pipe()
        try:
            os.write(writer, self.wire_bytes())
            with patch.object(transport, "IO_SECONDS", 0.05), self.assertRaisesRegex(transport.TransportError, "deadline"):
                transport.receive(self.destination, self.expected, reader)
        finally:
            os.close(writer)
            os.close(reader)
        self.assertEqual(list(self.receiver.iterdir()), [])

    def test_explicit_pin_strict_manifest_membership_and_total_limit(self):
        for changes in ({"sourceFiles": True}, {"stageAcknowledgementEntry": "../outside.py"}, {"deploymentAuthorized": True},
                        {"pins": {**self.document["pins"], "../escape.py": "f" * 64}, "sourceFiles": len(self.files) + 1}):
            bad = json.dumps(self.document | changes).encode()
            with self.subTest(changes=changes), self.assertRaises(transport.TransportError):
                transport._manifest(bad, sha256(bad).hexdigest())
        duplicate = self.manifest_bytes.replace(b'"version": 1', b'"version": 0, "version": 1')
        with self.assertRaisesRegex(transport.TransportError, "Duplicate"):
            transport._manifest(duplicate, sha256(duplicate).hexdigest())
        self.assertEqual(self.send_cli("f" * 64).stdout, b"")
        with patch.object(transport, "MAX_TOTAL", sum(map(len, self.files.values())) - 1):
            with self.assertRaisesRegex(transport.TransportError, "bound"):
                self.receive(self.wire_bytes())
        self.assertEqual(list(self.receiver.iterdir()), [])

    def test_modern_operator_pair_transfers_and_reads_back_standalone_dependency_closure(self):
        files = self.modern_files()
        self.select_sources(files, **transport.MODERN_ENTRIES)
        sender = self.send_cli()
        self.assertEqual((sender.returncode, sender.stderr, sender.stdout), (0, b"", self.wire_bytes()))
        receiver = self.run_cli("receive", wire=sender.stdout)
        self.assertEqual((receiver.returncode, receiver.stderr), (0, b""))
        self.assertEqual(self.run_cli("readback").stdout, receiver.stdout)
        self.assertEqual(json.loads(receiver.stdout), transport._receipt(self.destination.name, self.expected, files))

    def test_modern_missing_transitive_pin_holds_on_send_and_receive_before_publication(self):
        files = self.modern_files()
        del files[transport.DEPLOYMENT + "fixture_second.py"]
        self.select_sources(files, **transport.MODERN_ENTRIES)
        sender = self.send_cli()
        self.assertEqual((sender.returncode, sender.stdout), (1, b""))
        with self.assertRaisesRegex(transport.TransportError, "dependency is missing"):
            self.receive(self.wire_bytes())
        self.assertEqual(list(self.receiver.iterdir()), [])

    def test_modern_pins_require_both_exact_entries_core_lineage_and_unshadowed_stdlib(self):
        files = self.modern_files()
        self.select_sources(files, **transport.MODERN_ENTRIES)
        for document in (
                {key: value for key, value in self.document.items() if key != "coreOperatorEntry"},
                {**self.document, "coreOperatorEntry": "scripts/deployment/arbitrary.py"},
                {**self.document, "stageAcknowledgementEntry": transport.LEGACY_STAGE_ACK},
                {**self.document, "sourceFiles": len(files) - 1, "pins": {key: pin for key, pin in self.document["pins"].items()
                    if key != "scripts/deployment/installed_core_lineage_seal.py"}},
                {**self.document, "sourceFiles": len(files) + 1,
                 "pins": {**self.document["pins"], "scripts/deployment/json.py": "f" * 64}},
        ):
            raw = json.dumps(document).encode()
            with self.assertRaises(transport.TransportError):
                transport._manifest(raw, sha256(raw).hexdigest())

    def test_modern_relative_import_cannot_escape_its_module_directory(self):
        files = self.modern_files()
        files[transport.CORE_OPERATOR] = b"from .. fixture import flag\n"
        self.select_sources(files, **transport.MODERN_ENTRIES)
        with self.assertRaisesRegex(transport.TransportError, "relative import escapes"):
            self.receive(self.wire_bytes())
        self.assertEqual(list(self.receiver.iterdir()), [])

    def test_source_and_readback_reject_unexpected_entries_links_and_changed_bytes(self):
        first = self.source / next(iter(self.files))
        original = first.read_bytes()
        unexpected = self.source / "scripts/deployment/unexpected.py"
        self.private(unexpected, b"# unreviewed\n")
        held = self.send_cli()
        self.assertEqual((held.returncode, held.stdout), (1, b""))
        unexpected.unlink()
        first.chmod(0o644)
        self.assertEqual(self.send_cli().returncode, 1)
        first.chmod(0o600)
        link = self.sender / "extra-link.py"
        os.link(first, link)
        self.assertEqual(self.send_cli().returncode, 1)
        link.unlink()
        first.unlink()
        first.symlink_to(self.manifest)
        self.assertEqual(self.send_cli().returncode, 1)
        first.unlink()
        self.private(first, original)
        self.receive(self.wire_bytes())
        received = self.destination / "source" / first.relative_to(self.source)
        self.private(received, b"Z" + original[1:])
        with self.assertRaisesRegex(transport.TransportError, "differs from its pin"):
            transport.readback(self.destination, self.expected)

    def test_prepublication_error_removes_only_owned_scratch(self):
        foreign = self.receiver / ".wd-toolkit-foreign"
        foreign.mkdir(mode=0o700)
        write = transport._write_private

        def incomplete(fd, name, raw):
            write(fd, name, raw[:4])
            raise OSError("fixture write stopped")

        with patch.object(transport, "_write_private", side_effect=incomplete), self.assertRaisesRegex(OSError, "write stopped"):
            self.receive(self.wire_bytes())
        self.assertEqual(list(self.receiver.iterdir()), [foreign])

    def test_competing_destination_is_not_overwritten_and_exact_replay_is_readback_only(self):
        rename = transport._rename_noreplace

        def compete(parent, temporary, final):
            os.mkdir(final, 0o700, dir_fd=parent)
            rename(parent, temporary, final)

        with patch.object(transport, "_rename_noreplace", side_effect=compete), self.assertRaises(FileExistsError):
            self.receive(self.wire_bytes())
        self.assertEqual(list(self.destination.iterdir()), [])
        self.assertEqual(list(self.receiver.iterdir()), [self.destination])
        with self.assertRaisesRegex(transport.TransportError, "already exists"):
            self.receive(self.wire_bytes())
        self.destination.rmdir()
        committed = self.receive(self.wire_bytes())
        original_inode = self.destination.stat().st_ino
        with self.assertRaisesRegex(transport.TransportError, "already exists"):
            self.receive(self.wire_bytes())
        self.assertEqual((transport.readback(self.destination, self.expected), self.destination.stat().st_ino), (committed, original_inode))

    def test_unknown_after_rename_recovers_only_exact_committed_destination(self):
        original_sync = os.fsync
        expected_parent = self.receiver.stat()

        def lost_after_rename(fd):
            if os.path.samestat(os.fstat(fd), expected_parent):
                raise OSError("fixture lost durable response")
            original_sync(fd)

        with patch.object(transport.os, "fsync", side_effect=lost_after_rename), self.assertRaises(transport.ReceiptUnknown):
            self.receive(self.wire_bytes())
        self.assertEqual(list(self.receiver.iterdir()), [self.destination])
        self.assertEqual(transport.readback(self.destination, self.expected), transport._receipt(self.destination.name, self.expected, self.files))
        with self.assertRaisesRegex(transport.TransportError, "manifest differs"):
            transport.readback(self.destination, "f" * 64)

    def test_lost_stdout_pipe_returns_unknown_then_readback_succeeds(self):
        fd, pipe = os.pipe()
        os.close(fd)
        try:
            with subprocess.Popen(self.executable("receive", self.expected, "--destination", self.destination),
                                  stdin=subprocess.PIPE, stdout=pipe, stderr=subprocess.PIPE) as receiver:
                _, error = receiver.communicate(self.wire_bytes(), timeout=10)
                self.assertEqual(receiver.returncode, 1)
                self.assertEqual(json.loads(error), {"state": "unknown", "errorType": "ReceiptUnknown"})
        finally:
            os.close(pipe)
        self.assertEqual(transport.readback(self.destination, self.expected), transport._receipt(self.destination.name, self.expected, self.files))

    @unittest.skipUnless(LARGE_FIXTURE and LARGE_PIN, "No existing installed Web toolkit fixture configured")
    def test_existing_private_toolkit_uses_real_pipe_and_standalone_bootstrap(self):
        fixture = Path(LARGE_FIXTURE).resolve(strict=True)
        bootstrap = self.root / "bootstrap.py"
        shutil.copyfile(SCRIPT, bootstrap)
        with ExitStack() as cleanup:
            sender = cleanup.enter_context(subprocess.Popen(self.executable("send", LARGE_PIN, "--source", fixture / "source",
                "--manifest", fixture / "manifest.json"), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE))
            receiver_command = self.executable("receive", LARGE_PIN, "--destination", self.destination)
            receiver_command[3] = str(bootstrap)
            receiver = cleanup.enter_context(subprocess.Popen(receiver_command, stdin=sender.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE))
            sender.stdout.close()
            raw, error = receiver.communicate(timeout=15)
            self.assertEqual((receiver.returncode, error, sender.wait(timeout=15), sender.stderr.read()), (0, b"", 0, b""))
        expected = json.loads((fixture / "manifest.json").read_bytes())
        self.assertEqual(json.loads(raw)["sourceFiles"], expected["sourceFiles"])
        self.assertEqual(transport.readback(self.destination, LARGE_PIN), json.loads(raw))
        for path in expected["pins"]:
            self.assertEqual((self.destination / "source" / path).read_bytes(), (fixture / "source" / path).read_bytes())


if __name__ == "__main__":
    unittest.main()
