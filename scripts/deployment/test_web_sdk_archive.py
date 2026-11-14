"""Daemon-free projection tests; synthetic publication fixtures grant no authority."""

from copy import deepcopy
import gzip
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import tarfile
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import zipfile

from bundle import ARCHIVE, MANIFEST, create_bundle, metadata_files
from candidate import COMPONENTS, SMOKE_CHECKS, create_candidate
import component_inputs as inputs
import native_image_identity as native
import publication_gate
from test_component_inputs import fixture as input_fixture, rehash as rehash_inputs
from web_extension_inputs import REVIEWED_WEB_INPUTS
import web_sdk_full_receipt as sdk
import web_sdk_archive as projection


REVISION = "1" * 40


def encoded(value):
    return inputs.canonical(value)


def digest(raw):
    return "sha256:" + sha256(raw).hexdigest()


def archive_bytes(files, *, reverse=False, extra_member=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        items = list(files.items())
        for name, raw in reversed(items) if reverse else items:
            info = tarfile.TarInfo(name)
            info.size = len(raw)
            info.mtime = 123456  # Input transport metadata is deliberately not canonical.
            archive.addfile(info, io.BytesIO(raw))
        if extra_member is not None:
            info, raw = extra_member
            archive.addfile(info, io.BytesIO(raw) if raw else None)
    return output.getvalue()


def image_fixture(*, wrapped=False):
    files, descriptors, compatibility, expected, inspections, identities = {}, [], [], {}, {}, {}
    shared = b"shared synthetic layer bytes"
    shared_digest = digest(shared)
    files["blobs/sha256/" + shared_digest[7:]] = shared
    for role in COMPONENTS:
        expanded = ("private synthetic " + role + " layer").encode()
        stored = gzip.compress(expanded, mtime=0)
        role_digest = digest(stored)
        files["blobs/sha256/" + role_digest[7:]] = stored
        layers = [
            {"mediaType": "application/vnd.oci.image.layer.v1.tar", "digest": shared_digest, "size": len(shared)},
            {"mediaType": "application/vnd.oci.image.layer.v1.tar+gzip", "digest": role_digest, "size": len(stored)},
        ]
        config = {"architecture": "amd64", "os": "linux",
            "rootfs": {"type": "layers", "diff_ids": [shared_digest, digest(expanded)]},
            "config": {"User": "bun", "WorkingDir": "/app", "Entrypoint": ["/usr/local/bin/docker-entrypoint.sh"],
                "Cmd": ["bun", "--bun", "next", "start"] if role == "web" else ["bun", "dist/" + role + ".mjs"],
                "Env": ["APP_COMMIT=" + REVISION, "NEXT_DEPLOYMENT_ID=wd-" + REVISION, "APP_VERSION="],
                "Labels": {"org.opencontainers.image.revision": REVISION,
                    "org.opencontainers.image.title": "Warpdrive Web" if role == "web" else role}}}
        raw_config = encoded(config)
        config_digest = digest(raw_config)
        config_path = "blobs/sha256/" + config_digest[7:]
        files[config_path] = raw_config
        manifest = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": config_digest, "size": len(raw_config)},
            "layers": layers, "annotations": {"description": "original tested " + role + " payload"}}
        raw_manifest = encoded(manifest)
        manifest_digest = digest(raw_manifest)
        files["blobs/sha256/" + manifest_digest[7:]] = raw_manifest
        descriptor = {"mediaType": manifest["mediaType"], "digest": manifest_digest, "size": len(raw_manifest),
            "platform": {"os": "linux", "architecture": "amd64"}}
        native_descriptor = deepcopy(descriptor)
        if wrapped:
            raw_index = encoded({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
                                 "manifests": [descriptor]})
            index_digest = digest(raw_index)
            files["blobs/sha256/" + index_digest[7:]] = raw_index
            descriptor = {"mediaType": "application/vnd.oci.image.index.v1+json", "digest": index_digest, "size": len(raw_index)}
            native_descriptor = deepcopy(descriptor)
        # Existing source transport aliases may be present; none reaches output.
        descriptor["annotations"] = {"org.opencontainers.image.ref.name": "input-only/" + role + ":tested"}
        descriptors.append(descriptor)
        compatibility.append({"Config": config_path, "RepoTags": ["input-only/" + role + ":tested"],
            "Layers": ["blobs/sha256/" + layer["digest"][7:] for layer in layers],
            "LayerSources": dict(zip(config["rootfs"]["diff_ids"], layers))})
        expected[role] = {"configDigest": config_digest, "sourceRevision": REVISION,
            "metadata": {"User": "bun", "Cmd": config["config"]["Cmd"], "WorkingDir": "/app",
                "Labels": {"org.opencontainers.image.title": config["config"]["Labels"]["org.opencontainers.image.title"]}}}
        native_id = native_descriptor["digest"]
        inspections[role] = {"Id": native_id, "Descriptor": native_descriptor, "Os": "linux", "Architecture": "amd64",
            "Config": config["config"], "RootFS": {"Type": "layers", "Layers": config["rootfs"]["diff_ids"]}}
        identities[role] = {"config": config_digest, "manifest": manifest_digest, "native": native_id,
                            "layers": [layer["digest"] for layer in layers]}
    files.update({"index.json": encoded({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
                                        "manifests": descriptors}),
                  "manifest.json": encoded(compatibility), "oci-layout": encoded({"imageLayoutVersion": "1.0.0"})})
    return files, expected, inspections, identities


def sdk_input_fixture(root):
    backend = input_fixture(root)
    backend["context"]["baseImage"] = sdk.BASE_IMAGE
    rehash_inputs(backend)
    backend["components"] = {name: backend["components"][name] for name in sdk.BACKEND}
    web = {"profile": sdk.PROFILE, "context": deepcopy(backend["context"]), "gitInventorySha256": "a" * 64,
        "pinnedInputs": {path: {"gitBlob": blob, "sha256": pin, "bytes": 8}
                         for path, (blob, pin) in REVIEWED_WEB_INPUTS.items()},
        "helperEntries": deepcopy(backend["policy"]["entries"]["web"]), "helperGraphInputs": ["src/web.ts"],
        "sdkImports": {"src/ui.tsx": ["@ui-sdk/react/menu"]}, "staticWebInputCount": 2}
    web["inputSha256"] = inputs.content_hash(web)
    return {"schemaVersion": 1, "kind": sdk.KIND, "sourceRevision": REVISION,
            "backendInputs": backend, "web": web, "deploymentAuthorized": False}


class ArchiveDocker:
    """create_bundle's archive writer only; never invokes a daemon."""
    def __init__(self, raw):
        self.raw = raw

    def run(self, command, **_options):
        assert command[:3] == ["image", "save", "--output"]
        Path(command[3]).write_bytes(self.raw)


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.sequence = 0
        self.files, self.expected, self.inspections, self.identities = image_fixture()

    def bundle(self, files=None, *, raw=None, reverse=False, version=3):
        self.sequence += 1
        label = "fixture-" + str(self.sequence)
        source, destination = self.root / (label + "-source"), self.root / label
        (source / "smoke").mkdir(parents=True)
        (source / "inspections").mkdir()
        receipt = sdk_input_fixture(source / "inputs") if version == 3 else input_fixture(source / "inputs") if version == 2 else None
        if receipt is not None:
            (source / "component-inputs.json").write_bytes(encoded(receipt))
        report = {"schemaVersion": 1, "success": True, "expectedRevision": REVISION,
            "cleanup": {"success": True, "errors": []},
            "checks": [{"name": name, "status": "passed"} for name in SMOKE_CHECKS],
            "limitations": ["Synthetic offline fixture only; no release authority"],
            "images": {role: {"id": row["Id"], "revision": REVISION, "user": "bun"}
                       for role, row in self.inspections.items()}}
        report_raw = encoded(report)
        (source / "smoke/report.json").write_bytes(report_raw)
        for role, row in self.inspections.items():
            (source / "inspections" / (role + ".json")).write_bytes(encoded([row]))
        candidate = create_candidate(REVISION, report, sha256(report_raw).hexdigest(), self.inspections, input_receipt=receipt)
        (source / "candidate.json").write_bytes(encoded(candidate))
        producer = {"runId": 42, "runAttempt": 1, "event": "push", "ref": "refs/heads/main"}
        original_raw = archive_bytes(self.files if files is None else files, reverse=reverse) if raw is None else raw
        loaded = create_bundle(source, destination, expected_revision=REVISION, docker=ArchiveDocker(original_raw),
            origin={"kind": "github-actions", "repository": publication_gate.REPO, **producer})
        transport = destination.with_name(destination.name + ".zip")
        with zipfile.ZipFile(transport, "w") as zipped:
            for name in (*metadata_files(version), ARCHIVE, MANIFEST):
                zipped.write(destination / name, name)
        admission = {"schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission",
            "repository": publication_gate.REPO, "revision": REVISION, "producer": producer,
            "artifact": {"id": 81, "digest": digest(transport.read_bytes()), "sizeBytes": transport.stat().st_size},
            "deploymentAuthorized": False}
        output_dir = self.root / (label + "-projected")
        output_dir.mkdir(mode=0o700)
        arguments = {"admission": admission, "expected_admission_sha256": inputs.content_hash(admission),
            "expected_revision": REVISION, "expected_bundle_manifest_sha256": loaded["provenance"]["bundleManifestSha256"],
            "expected_archive_sha256": sha256(original_raw).hexdigest(), "expected_archive_bytes": len(original_raw),
            "expected_images": deepcopy(self.expected), "expected_web_manifest_digest": self.identities["web"]["manifest"]}
        return destination, output_dir / "web-image.tar", arguments

    def project(self, files=None, **options):
        directory, output, arguments = self.bundle(files, **options)
        return projection.project_downloaded_sdk_web_archive(directory, output, **arguments), output, directory

    def test_exact_native_payload_preserved_with_explicit_original_and_derived_custody(self):
        result, output, original = self.project()
        self.assertEqual(result["kind"], projection.KIND)
        self.assertEqual(result["original"]["kind"], "warpdrive-tested-image-bundle")
        self.assertNotEqual(result["original"]["archiveSha256"], result["derived"]["archiveSha256"])
        self.assertEqual(result["original"]["testedNativeImageId"], self.identities["web"]["native"])
        self.assertNotEqual(result["original"]["testedNativeImageId"], result["image"]["imageId"])
        self.assertEqual(result["image"]["imageId"], self.identities["web"]["config"])
        self.assertEqual(result["selectedWeb"]["manifestDigest"], self.identities["web"]["manifest"])
        self.assertFalse(result["backendReuseQualified"])
        self.assertFalse(result["installationAuthorized"])
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(output.stat().st_nlink, 1)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        with tarfile.open(output, "r:") as archive:
            members = archive.getmembers()
            blobs = {item.name for item in members if item.name.startswith("blobs/")}
            wanted = {"blobs/sha256/" + value[7:] for value in [self.identities["web"]["config"],
                self.identities["web"]["manifest"], *self.identities["web"]["layers"]]}
            self.assertEqual(blobs, wanted)
            self.assertTrue(all(item.uid == item.gid == item.mtime == 0 and item.mode == 0o600 for item in members))
            for name in wanted:
                self.assertEqual(archive.extractfile(name).read(), self.files[name])
            index = json.load(archive.extractfile("index.json"))
            self.assertEqual(len(index["manifests"]), 1)
            self.assertNotIn("annotations", index["manifests"][0])
            self.assertEqual(json.load(archive.extractfile("manifest.json"))[0]["RepoTags"], [])
        self.assertFalse((original / "web-bundle.json").exists())
        self.assertEqual(sha256((original / ARCHIVE).read_bytes()).hexdigest(), result["original"]["archiveSha256"])

    def test_deterministic_across_original_tar_member_order_and_metadata(self):
        first, a, _ = self.project()
        second, b, _ = self.project(reverse=True)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        self.assertEqual(first["derived"]["archiveSha256"], second["derived"]["archiveSha256"])
        self.assertNotEqual(first["original"]["archiveSha256"], second["original"]["archiveSha256"])

    def test_wrapped_tested_native_id_is_retained_but_output_uses_existing_direct_manifest(self):
        self.files, self.expected, self.inspections, self.identities = image_fixture(wrapped=True)
        result, output, _ = self.project()
        self.assertEqual(result["original"]["testedNativeImageId"], self.identities["web"]["native"])
        self.assertNotEqual(result["original"]["testedNativeImageId"], result["selectedWeb"]["manifestDigest"])
        with tarfile.open(output, "r:") as archive:
            index = json.load(archive.extractfile("index.json"))
        self.assertEqual(index["manifests"][0]["digest"], self.identities["web"]["manifest"])

    def test_four_image_docker_save_with_only_web_oci_root_retains_existing_web_manifest(self):
        files = deepcopy(self.files)
        index = json.loads(files["index.json"])
        index["manifests"] = index["manifests"][:1]
        files["index.json"] = encoded(index)
        result, _, _ = self.project(files)
        self.assertEqual(result["selectedWeb"]["manifestDigest"], self.identities["web"]["manifest"])

    def test_legacy_full_bundle_versions_cannot_be_renamed_into_sdk_projection(self):
        for version in [1, 2]:
            directory, output, arguments = self.bundle(version=version)
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "schema3"):
                projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
            self.assertFalse(output.exists())

    def test_independent_web_config_is_not_inferred_from_tested_manifest_id(self):
        directory, output, arguments = self.bundle()
        arguments["expected_images"]["web"]["configDigest"] = self.identities["web"]["native"]
        with self.assertRaises(ValueError):
            projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
        self.assertFalse(output.exists())

    def test_missing_or_wrong_independent_custody_and_web_pins_fail_before_publication(self):
        for field, wrong in [("expected_admission_sha256", "f" * 64),
            ("expected_bundle_manifest_sha256", "f" * 64), ("expected_archive_sha256", "f" * 64),
            ("expected_archive_bytes", 1), ("expected_web_manifest_digest", self.identities["worker"]["manifest"])]:
            directory, output, arguments = self.bundle()
            arguments[field] = wrong
            with self.subTest(field=field), self.assertRaises(ValueError):
                projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
            self.assertFalse(output.exists())

    def test_unapproved_or_ambiguous_web_manifest_and_extra_alias_are_rejected(self):
        for kind in ["foreign", "second-manifest", "alias"]:
            files = deepcopy(self.files)
            root = json.loads(files["index.json"])
            if kind == "foreign":
                raw = b"unreachable foreign payload"
                files["blobs/sha256/" + digest(raw)[7:]] = raw
            elif kind == "alias":
                root["manifests"].append(deepcopy(root["manifests"][0]))
            else:
                manifest = json.loads(files["blobs/sha256/" + self.identities["web"]["manifest"][7:]])
                manifest["annotations"]["other"] = "ambiguous second native payload"
                raw = encoded(manifest)
                other = digest(raw)
                files["blobs/sha256/" + other[7:]] = raw
                root["manifests"].append({"mediaType": manifest["mediaType"], "digest": other, "size": len(raw)})
            files["index.json"] = encoded(root)
            directory, output, arguments = self.bundle(files)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
            self.assertFalse(output.exists())

    def test_layer_corruption_even_inside_self_consistently_admitted_transport_is_rejected(self):
        files = deepcopy(self.files)
        path = "blobs/sha256/" + self.identities["web"]["layers"][1][7:]
        files[path] = b"x" * len(files[path])
        directory, output, arguments = self.bundle(files)
        with self.assertRaises(ValueError):
            projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
        self.assertFalse(output.exists())

    def test_paths_links_duplicates_and_foreign_member_types_are_rejected(self):
        for kind in ["path", "symlink", "hardlink", "duplicate", "fifo"]:
            info = tarfile.TarInfo("../escape" if kind == "path" else "unexpected")
            raw = b"payload"
            info.size = len(raw)
            if kind in {"symlink", "hardlink", "fifo"}:
                info.type = {"symlink": tarfile.SYMTYPE, "hardlink": tarfile.LNKTYPE, "fifo": tarfile.FIFOTYPE}[kind]
                info.linkname, info.size, raw = "index.json", 0, b""
            elif kind == "duplicate":
                info.name = "index.json"
            directory, output, arguments = self.bundle(raw=archive_bytes(self.files, extra_member=(info, raw)))
            with self.subTest(kind=kind), self.assertRaises((ValueError, tarfile.TarError)):
                projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
            self.assertFalse(output.exists())
            self.assertFalse((self.root / "escape").exists())

    def test_member_and_output_byte_limits_fail_without_leaving_published_output(self):
        for name, limit in [("MAX_SOURCE_MEMBERS", 2), ("MAX_OUTPUT_BYTES", 1024), ("MAX_ORIGINAL_BYTES", 1024)]:
            directory, output, arguments = self.bundle()
            with self.subTest(limit=name), patch.object(projection, name, limit), self.assertRaises(ValueError):
                projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
            self.assertFalse(output.exists())
            self.assertEqual(list(output.parent.iterdir()), [])

    def test_api_zip_substitution_is_not_replaced_with_local_only_bundle_acceptance(self):
        directory, output, arguments = self.bundle()
        arguments["admission"]["artifact"]["digest"] = "sha256:" + "f" * 64
        arguments["expected_admission_sha256"] = inputs.content_hash(arguments["admission"])
        with self.assertRaises(ValueError):
            projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
        self.assertFalse(output.exists())

    def test_existing_output_and_symlink_are_never_replaced(self):
        for link in [False, True]:
            directory, output, arguments = self.bundle()
            sentinel = output.parent / "sentinel"
            sentinel.write_bytes(b"preserve me")
            if link:
                output.symlink_to(sentinel)
            else:
                output.write_bytes(b"preserve me")
            with self.subTest(link=link), self.assertRaises(FileExistsError):
                projection.project_downloaded_sdk_web_archive(directory, output, **arguments)
            self.assertEqual(output.read_bytes(), b"preserve me")
            self.assertEqual(sentinel.read_bytes(), b"preserve me")
            self.assertFalse(any(p.name.startswith(".web-sdk-projection-") for p in output.parent.iterdir()))


if __name__ == "__main__":
    unittest.main()
