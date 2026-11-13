import copy
import json
from pathlib import Path
import tempfile
import unittest

from bundle import ARCHIVE, INPUT_RECEIPT, CandidateError, create_bundle, load_bundle
from candidate import create_candidate, sha256
from test_candidate import SHA, fixture
from test_component_inputs import fixture as input_fixture


def write_candidate(root, *, version=1):
    report, inspections = fixture()
    (root / "smoke").mkdir(parents=True)
    (root / "inspections").mkdir()
    report_path = root / "smoke/report.json"
    report_path.write_text(json.dumps(report))
    for name, value in inspections.items():
        (root / f"inspections/{name}.json").write_text(json.dumps([value]))
    receipt = input_fixture(root) if version == 2 else None
    if receipt is not None:
        (root / INPUT_RECEIPT).write_text(json.dumps(receipt))
    candidate = create_candidate(SHA, report, sha256(report_path), inspections, input_receipt=receipt)
    (root / "candidate.json").write_text(json.dumps(candidate))
    return candidate


class FakeDocker:
    def __init__(self):
        self.calls = []

    def run(self, args, **kwargs):
        self.calls.append(args)
        Path(args[args.index("--output") + 1]).write_bytes(b"synthetic archive, never Docker-loaded")


class BundleTests(unittest.TestCase):
    def test_v2_retains_input_receipt_and_reconstructs_every_bound_component(self):
        source = self.root / "v2-source"
        candidate = write_candidate(source, version=2)
        loaded = create_bundle(source, self.root / "v2-bundle", expected_revision=SHA, docker=self.docker)
        self.assertEqual(loaded["candidate"], candidate)
        self.assertTrue((self.root / "v2-bundle" / INPUT_RECEIPT).is_file())
        self.assertEqual(json.loads((self.root / "v2-bundle/bundle.json").read_text())["releaseRevision"], SHA)
        path = self.root / "v2-bundle" / INPUT_RECEIPT
        path.write_bytes(path.read_bytes() + b"tampered")
        with self.assertRaises(CandidateError):
            load_bundle(path.parent, expected_revision=SHA)

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.candidate_dir = self.root / "candidate"
        self.candidate = write_candidate(self.candidate_dir)
        self.destination = self.root / "bundle"
        self.docker = FakeDocker()

    def pack(self):
        return create_bundle(self.candidate_dir, self.destination, expected_revision=SHA, docker=self.docker)

    def test_retains_exact_tested_ids_without_build_or_deployment(self):
        loaded = self.pack()
        self.assertEqual(loaded["candidate"], self.candidate)
        self.assertEqual(self.docker.calls[0][:3], ["image", "save", "--output"])
        self.assertEqual(self.docker.calls[0][4:], [value["imageId"] for value in self.candidate["components"].values()])
        self.assertFalse(loaded["candidate"]["deploymentAuthorized"])
        self.assertEqual(loaded["provenance"]["archiveSha256"], sha256(self.destination / ARCHIVE))

    def test_archive_or_report_tamper_is_rejected(self):
        self.pack()
        for name in (ARCHIVE, "smoke/report.json", "candidate.json", "inspections/web.json"):
            path = self.destination / name
            original = path.read_bytes()
            path.write_bytes(original + b"tampered")
            with self.subTest(name=name), self.assertRaises(CandidateError):
                load_bundle(self.destination, expected_revision=SHA)
            path.write_bytes(original)

    def test_self_asserted_deployment_or_compatibility_cannot_enter_bundle(self):
        for field, value in (("deploymentAuthorized", True), ("compatibility", "safe")):
            bad = {**self.candidate, field: value}
            (self.candidate_dir / "candidate.json").write_text(json.dumps(bad))
            with self.subTest(field=field), self.assertRaises(CandidateError):
                self.pack()
            self.assertEqual(self.docker.calls, [])

    def test_symlink_metadata_is_rejected_before_saving_images(self):
        target = self.root / "outside.json"
        path = self.candidate_dir / "candidate.json"
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaises(CandidateError):
            self.pack()
        self.assertEqual(self.docker.calls, [])

    def test_existing_bundle_is_not_overwritten(self):
        self.pack()
        before = (self.destination / "bundle.json").read_bytes()
        with self.assertRaises(FileExistsError):
            self.pack()
        self.assertEqual(before, (self.destination / "bundle.json").read_bytes())

    def test_wrong_revision_and_missing_file_inventory_rejected(self):
        self.pack()
        with self.assertRaises(CandidateError):
            load_bundle(self.destination, expected_revision="f" * 40)
        manifest_path = self.destination / "bundle.json"
        manifest = json.loads(manifest_path.read_text())
        for name in (ARCHIVE, "inspections/realtime.json"):
            bad = copy.deepcopy(manifest)
            del bad["files"][name]
            manifest_path.write_text(json.dumps(bad))
            with self.assertRaises(CandidateError):
                load_bundle(self.destination, expected_revision=SHA)

    def test_complete_origin_required_for_github_bundle(self):
        for origin in ({"kind": "github-actions"},
                       {"kind": "github-actions", "repository": "owner/repo", "runId": True,
                        "runAttempt": 1, "event": "push", "ref": "refs/heads/main"}):
            with self.assertRaises(CandidateError):
                create_bundle(self.candidate_dir, self.destination, expected_revision=SHA,
                              docker=self.docker, origin=origin)
            self.assertEqual(self.docker.calls, [])


if __name__ == "__main__":
    unittest.main()
