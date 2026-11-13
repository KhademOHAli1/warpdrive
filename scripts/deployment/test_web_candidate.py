"""Exercise the Web bundle boundary with bounded Docker archive fixtures."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import bundle
from candidate import CandidateError, create_candidate, sha256
import component_inputs as inputs
from image_smoke import SmokeError
from test_bundle import FakeDocker as FullBundleDocker
from test_candidate import SHA as BASELINE_REVISION, fixture as image_fixture
from test_component_inputs import fixture as input_fixture, rehash
import web_candidate as web
from web_mixed_image_smoke import BROWSER_PHASES


REVISION = "f" * 40
REPO = "KhademOHAli1/warpdrive"
OLD_ORIGIN = {"kind": "github-actions", "repository": REPO, "runId": 70,
              "runAttempt": 1, "event": "push", "ref": "refs/heads/main"}
ORIGIN = {**OLD_ORIGIN, "runId": 71}
GIB = 1024**3


def encoded(value):
    return inputs.canonical(value)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def record(path, value):
    return {"path": path, "bytes": len(value), "sha256": digest(value)}


def phase(name):
    return {"phase": name, **BROWSER_PHASES[name]}


class WebDocker:
    def __init__(self):
        self.archive_mutation = None
        self.calls = []
        self.config = {
            "User": "bun",
            "Labels": {web.REVISION_LABEL: REVISION, "org.opencontainers.image.title": "Warpdrive Web"},
            "Env": ["NODE_ENV=production", "APP_COMMIT=" + REVISION, "NEXT_DEPLOYMENT_ID=wd-" + REVISION],
        }
        self.layer = b"generated native image layer"
        self.raw_config = encoded({"architecture": "amd64", "os": "linux", "config": self.config,
                                   "rootfs": {"type": "layers", "diff_ids": ["sha256:" + digest(self.layer)]}})
        self.image_id = "sha256:" + digest(self.raw_config)
        self.inspect_mutation = None

    def json(self, args, *, timeout):
        self.calls.append(args)
        self.assert_expected_id(args[-1])
        row = {"Id": self.image_id, "Os": "linux", "Architecture": "amd64", "Config": copy.deepcopy(self.config)}
        if self.inspect_mutation:
            self.inspect_mutation(row, self.calls)
        return [row]

    def assert_expected_id(self, value):
        if value != self.image_id:
            raise AssertionError("Unexpected image ID reached Docker")

    def run(self, args, *, timeout):
        self.calls.append(args)
        self.assert_expected_id(args[-1])
        path = Path(args[args.index("--output") + 1])
        self.save(path)

    def members(self):
        layer = self.layer
        layer_sha = digest(layer)
        layer_name = f"blobs/sha256/{layer_sha}"
        config_name = f"blobs/sha256/{self.image_id[7:]}"
        manifest = [{"Config": config_name, "Layers": [layer_name], "RepoTags": None}]
        values = {"manifest.json": encoded(manifest), config_name: self.raw_config, layer_name: layer}
        image_media = "application/vnd.oci.image.manifest.v1+json"
        oci_manifest = encoded({
            "schemaVersion": 2, "mediaType": image_media,
            "config": {"mediaType": "application/vnd.oci.image.config.v1+json",
                       "digest": self.image_id, "size": len(self.raw_config)},
            "layers": [{"mediaType": "application/vnd.oci.image.layer.v1.tar",
                        "digest": "sha256:" + layer_sha, "size": len(layer)}],
        })
        manifest_sha = digest(oci_manifest)
        values.update({
            "oci-layout": b'{"imageLayoutVersion":"1.0.0"}',
            "index.json": encoded({"schemaVersion": 2, "manifests": [
                {"mediaType": image_media, "digest": "sha256:" + manifest_sha, "size": len(oci_manifest)},
            ]}),
            f"blobs/sha256/{manifest_sha}": oci_manifest,
        })
        return values

    def save(self, path):
        values = self.members()
        if self.archive_mutation:
            self.archive_mutation(values)
        with tarfile.open(path, "w", format=tarfile.USTAR_FORMAT) as archive:
            for name, raw in values.items():
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                archive.addfile(member, io.BytesIO(raw))


class WebCandidateTests(unittest.TestCase):
    def setUp(self):
        private = tempfile.TemporaryDirectory()
        self.addCleanup(private.cleanup)
        self.private = Path(private.name).resolve()
        self.source = self.private / "source"
        self.source.mkdir()
        self.before = input_fixture(self.source)
        self.set_style(self.before, b".header {\n  gap: 24px;\n}\n")
        self.after = copy.deepcopy(self.before)
        self.set_style(self.after, b".header {\n  gap: 22px;\n}\n")
        self.baseline_dir = self.private / "baseline-bundle"
        self.baseline = self.make_baseline()
        self.output = self.private / "web-bundle"
        self.docker = WebDocker()
        self.delta = self.make_delta()
        self.build, self.mixed = self.make_evidence()
        self.inputs_path = self.private / "current.json"
        self.build_path = self.private / "build.json"
        self.mixed_path = self.private / "mixed.json"
        self.write_evidence()

    def set_style(self, receipt, value):
        rows = receipt["components"]["web"]["inputs"]
        rows = [row for row in rows if row["path"] != web.STYLE_FILE]
        receipt["components"]["web"]["inputs"] = sorted(
            [*rows, record(web.STYLE_FILE, value)], key=lambda row: row["path"])
        rehash(receipt)

    def make_baseline(self):
        root = self.private / "baseline-candidate"
        (root / "smoke").mkdir(parents=True)
        (root / "inspections").mkdir()
        report, inspections = image_fixture()
        path = root / "smoke/report.json"
        path.write_bytes(encoded(report))
        for name, row in inspections.items():
            (root / f"inspections/{name}.json").write_bytes(encoded([row]))
        (root / bundle.INPUT_RECEIPT).write_bytes(encoded(self.before))
        candidate = create_candidate(BASELINE_REVISION, report, sha256(path), inspections, input_receipt=self.before)
        (root / "candidate.json").write_bytes(encoded(candidate))
        return bundle.create_bundle(root, self.baseline_dir, expected_revision=BASELINE_REVISION,
                                    origin=OLD_ORIGIN, docker=FullBundleDocker())

    def make_delta(self):
        return {
            "schemaVersion": 1, "kind": "warpdrive-web-source-delta", "profile": web.RUNTIME_PROFILE,
            "presentationPolicyVersion": 1, "platform": web.PLATFORM, "releaseRevision": REVISION,
            "baselineRevision": BASELINE_REVISION, "engineContextVersion": web.ENGINE_CONTEXT_VERSION,
            "baselineCoreInputReceiptSha256": inputs.content_hash(self.before),
            "currentCoreInputReceiptSha256": inputs.content_hash(self.after),
            "currentWebInputSha256": self.after["components"]["web"]["componentInputSha256"],
            "inputPolicySha256": self.after["inputPolicySha256"], "changedPresentationPaths": [web.STYLE_FILE],
            "buildComponents": ["web"], "deploymentAuthorized": False,
            **{key: "a" * 64 for key in web.SOURCE_HASH_FIELDS},
        }

    def make_evidence(self):
        provenance = self.baseline["provenance"]
        ids = {name: value["imageId"] for name, value in self.baseline["candidate"]["components"].items()}
        old, new = "wd-" + BASELINE_REVISION, "wd-" + REVISION
        build = {"sourceDelta": self.delta, "baselineManifestSha256": provenance["bundleManifestSha256"],
                 "baselineArchiveSha256": provenance["archiveSha256"], "baselineImages": ids,
                 "capacity": {"admitted": True, "availableBytes": 16 * GIB, "requiredBytes": 10 * GIB,
                              "remainingBytes": 6 * GIB, "scope": "Generated disk admission"},
                 "candidateWebImageId": self.docker.image_id, "sourceVerifiedAfterBuild": True,
                 "availableDiskBytesAfterBuild": 9 * GIB}
        assembly = {"baselineRevision": BASELINE_REVISION, "baselineOrigin": OLD_ORIGIN,
                    "baselineImages": ids, **provenance, "fixtureBuilds": 0,
                    "newWeb": {"imageId": self.docker.image_id, "sourceRevision": REVISION, "generation": new}}
        protected = {name: {"imageId": ids.get(name, "sha256:" + "e" * 64)} for name in
                     ("worker", "realtime", "postgres", "caddy")}
        backend = web.runtime_hash(protected)
        schema = "d" * 64
        qualification = {
            "assembly": assembly, "protectedRuntimes": protected, "backendFingerprint": backend,
            "slots": {old: {"runtime": {"imageId": ids["web"], "schemaSha256": schema}},
                      new: {"runtime": {"imageId": self.docker.image_id, "schemaSha256": schema}}},
        }
        checks = [{"name": name, "status": "passed", "detail": {}} for name in web.CHECKS]
        checks[0]["detail"] = assembly
        checks[2]["detail"] = {"qualification": qualification, "qualificationSha256": web.runtime_hash(qualification)}
        checks[3]["detail"] = {"initial": phase("initial-ready"), "freshBoundBaselineSeed": True, "forgedSession": False}
        checks[5]["detail"] = {"preSwitch": phase("pre-switch-ready"), "complete": phase("complete"),
                               "matchingActivityRows": 1, "generatedLoopbackTls": True}
        for index, generation, state, writes in ((4, new, "accepted", 1), (6, old, "accepted", 1), (7, old, "rolled-back", 2)):
            checks[index]["detail"] = {"receipt": {"state": state, "acceptedGeneration": generation, "backendFingerprint": backend},
                                       "ingress": {"activeGeneration": generation, "backendFingerprint": backend,
                                                   "schemaSha256": schema, "verifiedAssetGenerations": [old]},
                                       "routeWrites": writes, "repeatReadOnly": True, "candidateStopped": True}
        mixed = {"schemaVersion": 1, "kind": "warpdrive-native-mixed-web-smoke", "scope": "owned-native-staging-fixture",
                 "revision": BASELINE_REVISION, "success": True, "failure": None, "browserContinuityQualified": True,
                 "deploymentAuthorized": False, "limitations": web.LIMITATIONS, "images": assembly, "checks": checks,
                 "cleanup": {"success": True, "errors": [], "fixtureResourcesAbsent": True}}
        return build, mixed

    def write_evidence(self):
        self.inputs_path.write_bytes(encoded(self.after))
        self.build_path.write_bytes(encoded(self.build))
        self.mixed_path.write_bytes(encoded(self.mixed))

    def pack(self, *, origin=ORIGIN):
        with patch.object(web, "verify_web_source_delta", return_value=self.delta) as verify, \
             patch.object(inputs, "verify_source_revision") as post:
            result = web.create_web_bundle(
                self.source, self.output, expected_revision=REVISION, baseline_dir=self.baseline_dir,
                baseline_revision=BASELINE_REVISION, baseline_manifest_sha256=self.baseline["provenance"]["bundleManifestSha256"],
                input_receipt_path=self.inputs_path, build_evidence_path=self.build_path, mixed_report_path=self.mixed_path,
                origin=origin, docker=self.docker,
            )
            verify.assert_called_once_with(self.source, self.after, expected_revision=REVISION,
                                           baseline_revision=BASELINE_REVISION, baseline_receipt=self.before)
            post.assert_called_once_with(self.source, self.after, REVISION)
            return result

    def load(self, expected, **overrides):
        arguments = {"expected_revision": REVISION, "expected_manifest_sha256": expected,
                     "baseline_revision": BASELINE_REVISION, "baseline_manifest_sha256": self.baseline["provenance"]["bundleManifestSha256"],
                     "expected_origin": ORIGIN}
        return web.load_web_bundle(self.output, **{**arguments, **overrides})

    def test_saves_one_exact_tested_id_and_reconstructs_bound_release(self):
        packed = self.pack()
        proof = packed["provenance"]
        self.assertEqual(self.load(proof["bundleManifestSha256"]), packed)
        self.assertEqual(self.docker.calls, [
            ["image", "inspect", self.docker.image_id],
            ["image", "save", "--platform", web.PLATFORM, "--output", str(self.output / web.ARCHIVE), self.docker.image_id],
            ["image", "inspect", self.docker.image_id],
        ])
        candidate = packed["candidate"]
        self.assertEqual(candidate["image"]["imageId"], self.docker.image_id)
        self.assertEqual(candidate["image"]["sourceRevision"], REVISION)
        self.assertEqual(candidate["baseline"]["revision"], BASELINE_REVISION)
        self.assertEqual(candidate["qualification"]["reportSha256"], sha256(self.mixed_path))
        self.assertEqual(proof["archiveSha256"], sha256(self.output / web.ARCHIVE))
        self.assertEqual(proof["archiveSizeBytes"], (self.output / web.ARCHIVE).stat().st_size)
        self.assertFalse(candidate["deploymentAuthorized"])
        self.assertEqual(bundle.load_bundle(self.baseline_dir, expected_revision=BASELINE_REVISION), self.baseline)

    def test_fixture_archive_readback_has_no_release_or_origin_authority(self):
        path = self.private / web.ARCHIVE
        self.docker.save(path)
        proof = web.verify_saved_web_image(
            self.private, expected_image_id=self.docker.image_id, expected_revision=REVISION,
        )
        self.assertEqual(proof, {"image": {"imageId": self.docker.image_id, "sourceRevision": REVISION,
                                         "generation": "wd-" + REVISION, "runtimeUser": "bun"},
                                 "archiveSha256": sha256(path), "archiveSizeBytes": path.stat().st_size})
        with self.assertRaises(CandidateError):
            web.verify_saved_web_image(
                self.private, expected_image_id=self.docker.image_id, expected_revision=BASELINE_REVISION,
            )

    def test_baseline_and_producer_must_be_different_main_runs(self):
        for origin in (OLD_ORIGIN, {**ORIGIN, "event": "pull_request", "ref": "refs/pull/4/merge"},
                       {**ORIGIN, "repository": "other/repo"}):
            with self.subTest(origin=origin), self.assertRaises(CandidateError):
                self.pack(origin=origin)
        self.assertEqual(self.docker.calls, [])

    def test_external_manifest_source_origin_and_baseline_pins_are_required(self):
        packed = self.pack()
        expected = packed["provenance"]["bundleManifestSha256"]
        for override in ({"expected_revision": "e" * 40}, {"expected_origin": {**ORIGIN, "runAttempt": 2}},
                         {"baseline_manifest_sha256": "0" * 64}, {"baseline_revision": "e" * 40}):
            with self.subTest(override=override), self.assertRaises(CandidateError):
                self.load(expected, **override)
        path = self.output / web.MANIFEST
        manifest = json.loads(path.read_bytes())
        manifest["files"][web.MIXED] = {"sha256": "0" * 64, "sizeBytes": 1}
        path.write_bytes(encoded(manifest))
        with self.assertRaisesRegex(CandidateError, "external pin"):
            self.load(expected)

    def test_bundle_refuses_missing_extra_symlink_and_mutated_bytes(self):
        packed = self.pack()
        expected = packed["provenance"]["bundleManifestSha256"]
        for name in (web.ARCHIVE, *web.METADATA):
            path = self.output / name
            original = path.read_bytes()
            path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            with self.subTest(name=name), self.assertRaises(CandidateError):
                self.load(expected)
            path.write_bytes(original)
        foreign = self.output / "not-admitted"
        foreign.write_text("generated")
        with self.assertRaisesRegex(CandidateError, "Unexpected or missing"):
            self.load(expected)
        foreign.unlink()
        path = self.output / web.MIXED
        target = self.private / "link-target"
        path.rename(target)
        with self.assertRaisesRegex(CandidateError, "Unexpected or missing"):
            self.load(expected)
        path.symlink_to(target)
        with self.assertRaises(OSError):
            self.load(expected)

    def test_native_proof_requires_browser_rollback_cleanup_and_exact_ids(self):
        original = copy.deepcopy(self.mixed)
        mutations = (
            lambda value: value["checks"].pop(),
            lambda value: value["checks"][7]["detail"].update(routeWrites=True),
            lambda value: value["checks"][7]["detail"]["ingress"].update(backendFingerprint="0" * 64),
            lambda value: value["checks"][7]["detail"]["receipt"].update(state="accepted"),
            lambda value: value["checks"][5]["detail"].update(matchingActivityRows=True),
            lambda value: value["images"]["newWeb"].update(imageId="sha256:" + "d" * 64),
            lambda value: value["cleanup"].update(fixtureResourcesAbsent=False),
        )
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                self.mixed = copy.deepcopy(original)
                mutate(self.mixed)
                self.write_evidence()
                with self.assertRaises((CandidateError, SmokeError)):
                    self.pack()
        self.assertEqual(self.docker.calls, [])

    def test_mixed_archive_cannot_admit_extra_images_tags_or_substituted_config(self):
        def mutate_json(name, transform):
            def mutate(values):
                value = json.loads(values[name])
                transform(value)
                values[name] = encoded(value)
            return mutate

        for index, mutate in enumerate((
            mutate_json("manifest.json", lambda value: value.append(value[0])),
            mutate_json("manifest.json", lambda value: value[0].update(RepoTags=["untrusted:latest"])),
            mutate_json("index.json", lambda value: value["manifests"].append(value["manifests"][0])),
            mutate_json("index.json", lambda value: value["manifests"][0].update(digest="sha256:" + "e" * 64)),
            lambda values: values.pop("index.json"),
            lambda values: values.update({f"blobs/sha256/{digest(self.docker.layer)}": b"wrong layer"}),
            lambda values: values.update({f"blobs/sha256/{digest(self.docker.layer)}": b"x" * len(self.docker.layer)}),
            lambda values: values.update({f"blobs/sha256/{self.docker.image_id[7:]}": b"wrong config"}),
            lambda values: values.update({"../escape": b"generated"}),
        )):
            with self.subTest(index=index):
                self.output = self.private / f"invalid-archive-{index}"
                self.docker.archive_mutation = mutate
                with self.assertRaises(CandidateError):
                    self.pack()
                self.assertFalse((self.output / web.MANIFEST).exists())

    def test_source_binding_and_local_image_reinspection_fail_closed(self):
        with patch.object(web, "verify_web_source_delta", return_value={**self.delta, "engineContextSha256": "0" * 64}):
            with self.assertRaisesRegex(CandidateError, "Verified source differs"):
                web.create_web_bundle(
                    self.source, self.output, expected_revision=REVISION, baseline_dir=self.baseline_dir,
                    baseline_revision=BASELINE_REVISION, baseline_manifest_sha256=self.baseline["provenance"]["bundleManifestSha256"],
                    input_receipt_path=self.inputs_path, build_evidence_path=self.build_path, mixed_report_path=self.mixed_path,
                    origin=ORIGIN, docker=self.docker,
                )
        self.assertEqual(self.docker.calls, [])
        def replace_runtime(row, calls):
            if len(calls) > 1:
                row["Config"]["User"] = "other"
        self.docker.inspect_mutation = replace_runtime
        with self.assertRaisesRegex(CandidateError, "readback differs"):
            self.pack()
        self.assertFalse((self.output / web.MANIFEST).exists())

    def test_existing_output_cannot_be_replaced(self):
        packed = self.pack()
        with self.assertRaises(FileExistsError):
            self.pack()
        self.assertEqual(self.load(packed["provenance"]["bundleManifestSha256"]), packed)


if __name__ == "__main__":
    unittest.main()
