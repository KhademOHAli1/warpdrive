"""Daemon-free Docker config/manifest/index identity and byte-custody tests."""

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

import native_image_identity as native


REVISION = "a" * 40


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(raw):
    return "sha256:" + sha256(raw).hexdigest()


def archive_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, raw in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(raw)
            archive.addfile(entry, io.BytesIO(raw))
    return output.getvalue()


def fixture(count=1, *, wrapped=False, compressed=False, legacy=False):
    files, descriptors, compatibility, expectations, rows, identities = {}, [], [], {}, {}, {}
    raw_layer = b"synthetic shared RootFS bytes, no Docker operation"
    stored_layer = gzip.compress(raw_layer, mtime=0) if compressed else raw_layer
    layer_digest, diff_id = digest(stored_layer), digest(raw_layer)
    layer_type = "application/vnd.oci.image.layer.v1.tar+gzip" if compressed else "application/vnd.oci.image.layer.v1.tar"
    layer_path = "blobs/sha256/" + layer_digest[7:]
    files[layer_path] = stored_layer
    layers = [{"mediaType": layer_type, "digest": layer_digest, "size": len(stored_layer)}]
    diffs, paths = [diff_id], [layer_path]
    if legacy:
        prefix = b"shared first legacy RootFS prefix"
        prefix_digest = digest(prefix)
        prefix_path = "blobs/sha256/" + prefix_digest[7:]
        files[prefix_path] = prefix
        layers.insert(0, {"mediaType": "application/vnd.oci.image.layer.v1.tar", "digest": prefix_digest, "size": len(prefix)})
        diffs.insert(0, prefix_digest)
        paths.insert(0, prefix_path)
    for index, role in enumerate(("web", "worker", "realtime", "migrator")[:count]):
        config = {"architecture": "amd64", "os": "linux", "rootfs": {"type": "layers", "diff_ids": diffs},
                  "config": {"User": "bun", "WorkingDir": "/app", "Entrypoint": ["/usr/local/bin/docker-entrypoint.sh"],
                             "Cmd": ["bun", "dist/" + role + ".mjs"], "Env": ["APP_COMMIT=" + REVISION, "PATH=/usr/bin"],
                             "Labels": {"org.opencontainers.image.revision": REVISION, "title": role}}}
        if legacy:
            config["created"] = "2026-11-13T19:28:26.035952736Z"
            add_legacy(files, config)
        raw = encoded(config)
        config_id = digest(raw)
        config_path = "blobs/sha256/" + config_id[7:]
        files[config_path] = raw
        manifest = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": config_id, "size": len(raw)},
                    "layers": layers}
        raw = encoded(manifest)
        manifest_id = digest(raw)
        files["blobs/sha256/" + manifest_id[7:]] = raw
        descriptor = {"mediaType": manifest["mediaType"], "digest": manifest_id, "size": len(raw),
                      "platform": {"architecture": "amd64", "os": "linux"}}
        native_descriptor = deepcopy(descriptor)
        wrapper_id = None
        if wrapped:
            wrapper = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": [descriptor]}
            raw = encoded(wrapper)
            wrapper_id = digest(raw)
            files["blobs/sha256/" + wrapper_id[7:]] = raw
            descriptor = {"mediaType": wrapper["mediaType"], "digest": wrapper_id, "size": len(raw)}
        descriptor["annotations"] = {"org.opencontainers.image.ref.name": "untrusted-tag-" + str(index)}
        descriptors.append(descriptor)
        compatibility.append({"Config": config_path, "RepoTags": ["metadata/only:" + role], "Layers": paths,
                              "LayerSources": dict(zip(diffs, layers))})
        expectations[role] = {"configDigest": config_id, "sourceRevision": REVISION,
                              "metadata": {"User": "bun", "Cmd": config["config"]["Cmd"], "WorkingDir": "/app",
                                           "Env": {"APP_COMMIT": REVISION}, "Labels": {"title": role}}}
        rows[role] = {"Id": manifest_id, "Descriptor": native_descriptor, "Os": "linux", "Architecture": "amd64",
                      "Config": config["config"], "RootFS": {"Type": "layers", "Layers": diffs}}
        identities[role] = {"config": config_id, "manifest": manifest_id, "index": wrapper_id, "descriptor": descriptor}
    files.update({"oci-layout": encoded({"imageLayoutVersion": "1.0.0"}),
                  "index.json": encoded({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": descriptors}),
                  "manifest.json": encoded(compatibility)})
    return files, expectations, rows, identities


def add_legacy(files, config):
    # Match Moby's preserved nested Config order and sorted top-level CreateID map.
    zero = {"Hostname": "", "Domainname": "", "User": "", "AttachStdin": False, "AttachStdout": False,
            "AttachStderr": False, "Tty": False, "OpenStdin": False, "StdinOnce": False, "Env": None, "Cmd": None,
            "Image": "", "Volumes": None, "WorkingDir": "", "Entrypoint": None, "OnBuild": None, "Labels": None}
    chain, parent = None, None
    diffs = config["rootfs"]["diff_ids"]
    for index, diff in enumerate(diffs):
        chain = diff if chain is None else digest((chain + " " + diff).encode())
        top = index == len(diffs) - 1
        value = {"created": config["created"] if top else "1970-01-01T00:00:00Z", "container_config": zero}
        if top:
            value.update(config=config["config"], architecture=config["architecture"], os=config["os"])
        properties = {key: json.dumps(item, separators=(",", ":")).encode() for key, item in value.items()}
        properties["layer_id"] = encoded(chain)
        if parent is not None:
            properties["parent"] = encoded("sha256:" + parent)
        preimage = b"{" + b",".join(encoded(key) + b":" + properties[key] for key in sorted(properties)) + b"}"
        identifier = sha256(preimage).hexdigest()
        stored = {"id": identifier}
        if parent is not None:
            stored["parent"] = parent
        stored.update(value)
        stored["os"] = config["os"]
        raw = json.dumps(stored, separators=(",", ":")).encode()
        files["blobs/sha256/" + sha256(raw).hexdigest()] = raw
        parent = identifier


class NativeImageIdentityTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.path = self.root / "image.tar"
        self.files, self.expected, self.rows, self.ids = fixture()

    def verify(self, files=None, *, expected=None, expected_hash=None, expected_bytes=None, archive_mode="strict-oci"):
        raw = archive_bytes(self.files if files is None else files)
        self.path.write_bytes(raw)
        return native.verify_archive(self.path, expected_sha256=expected_hash or sha256(raw).hexdigest(),
                                     expected_bytes=len(raw) if expected_bytes is None else expected_bytes,
                                     expected_images=self.expected if expected is None else expected, archive_mode=archive_mode)

    def test_preserves_config_and_manifest_identity_without_relabeling(self):
        result = self.verify()
        image = result["images"]["web"]
        self.assertEqual(image["configDigest"], self.ids["web"]["config"])
        self.assertEqual(image["manifestDigest"], self.ids["web"]["manifest"])
        self.assertNotEqual(image["configDigest"], image["manifestDigest"])
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["reachableBlobsVerified"], 3)

    def test_four_role_baseline_graph_verifies_shared_layers_once(self):
        self.files, self.expected, self.rows, self.ids = fixture(4)
        result = self.verify()
        self.assertEqual(set(result["images"]), {"web", "worker", "realtime", "migrator"})
        self.assertEqual(result["reachableBlobsVerified"], 9)
        self.assertEqual(result["expandedRootfsBytesVerified"], len(b"synthetic shared RootFS bytes, no Docker operation"))
        self.assertTrue(all(not item["indexDigests"] for item in result["images"].values()))

    def compatibility_fixture(self):
        files, expected, rows, identities = fixture(4)
        root = json.loads(files["index.json"])
        for descriptor in root["manifests"][1:]:
            files.pop("blobs/sha256/" + descriptor["digest"][7:])
        root["manifests"] = root["manifests"][:1]
        files["index.json"] = encoded(root)
        return files, expected, rows, identities

    def test_explicit_compatibility_mode_verifies_four_docker_images_with_one_truthful_oci_root(self):
        self.files, self.expected, self.rows, self.ids = self.compatibility_fixture()
        with self.assertRaisesRegex(native.IdentityError, "selected OCI"):
            self.verify()
        result = self.verify(archive_mode="docker-save-compatibility")
        self.assertEqual(set(result["images"]), set(self.expected))
        self.assertEqual(result["images"]["web"]["manifestDigest"], self.ids["web"]["manifest"])
        self.assertEqual(result["archiveMode"], "docker-save-compatibility")
        for role in ("worker", "realtime", "migrator"):
            image = result["images"][role]
            self.assertIsNone(image["manifestDigest"])
            self.assertEqual(image["nativeIdentityCandidates"], {self.ids[role]["config"]: {"kind": "config-digest"}})
            row = deepcopy(self.rows[role])
            row["Id"] = self.ids[role]["config"]
            row.pop("Descriptor")
            native.verify_native_inspection(image, [row], expected_native_id=row["Id"])

    def test_compatibility_mode_still_rejects_unreachable_blobs_and_wrong_rootfs(self):
        self.files, self.expected, self.rows, self.ids = self.compatibility_fixture()
        files = deepcopy(self.files)
        files["blobs/sha256/" + "f" * 64] = b"unapproved"
        with self.assertRaises(native.IdentityError):
            self.verify(files, archive_mode="docker-save-compatibility")
        files = deepcopy(self.files)
        compatibility = json.loads(files["manifest.json"])
        compatibility[1]["Layers"] = []
        files["manifest.json"] = encoded(compatibility)
        with self.assertRaisesRegex(native.IdentityError, "RootFS"):
            self.verify(files, archive_mode="docker-save-compatibility")

    def test_actual_moby_subset_index_with_unindexed_manifests_and_legacy_chain_closes(self):
        self.files, self.expected, self.rows, self.ids = fixture(4, legacy=True)
        root = json.loads(self.files["index.json"])
        root["manifests"] = root["manifests"][:1]
        self.files["index.json"] = encoded(root)
        result = self.verify(archive_mode="docker-save-compatibility")
        self.assertEqual(result["legacyMetadataBlobsVerified"], 5)
        self.assertEqual(result["ociRootConfigDigests"], [self.ids["web"]["config"]])
        for role, image in result["images"].items():
            self.assertEqual(image["manifestDigest"], self.ids[role]["manifest"])
            native.verify_native_inspection(image, [self.rows[role]])
            if role != "web":
                self.assertEqual(image["indexDigests"], [])
        self.assertEqual(len(result["payloadBlobs"]), result["reachableBlobsVerified"])

    def test_legacy_create_id_parent_and_selected_top_projection_cannot_be_substituted(self):
        self.files, self.expected, self.rows, self.ids = fixture(4, legacy=True)
        for change in ("id", "parent", "created", "config"):
            files = deepcopy(self.files)
            path = next(name for name, raw in files.items() if name.startswith("blobs/") and b'"container_config"' in raw and b'"architecture"' in raw)
            value = json.loads(files.pop(path))
            if change == "config":
                value["config"]["Cmd"] = ["bun", "foreign.mjs"]
            else:
                value[change] = "f" * 64
            raw = encoded(value)
            files["blobs/sha256/" + sha256(raw).hexdigest()] = raw
            with self.subTest(change=change), self.assertRaises(native.IdentityError):
                self.verify(files, archive_mode="docker-save-compatibility")

    def test_layer_sources_are_ordered_rootfs_bound_and_required_in_compatibility_mode(self):
        self.files, self.expected, self.rows, self.ids = fixture(4, legacy=True)
        files = deepcopy(self.files)
        manifest = json.loads(files["manifest.json"])
        manifest[1]["LayerSources"] = {}
        files["manifest.json"] = encoded(manifest)
        with self.assertRaisesRegex(native.IdentityError, "LayerSources"):
            self.verify(files, archive_mode="docker-save-compatibility")

    def test_docker28_config_id_without_descriptor_is_verified(self):
        image = self.verify()["images"]["web"]
        row = deepcopy(self.rows["web"])
        row["Id"] = self.ids["web"]["config"]
        del row["Descriptor"]
        actual = native.verify_native_inspection(image, [row], expected_native_id=row["Id"])
        self.assertEqual(actual["nativeImageIdKind"], "config-digest")
        self.assertEqual(actual["nativeImageId"], self.ids["web"]["config"])

    def test_docker29_manifest_id_and_descriptor_are_verified(self):
        image = self.verify()["images"]["web"]
        actual = native.verify_native_inspection(image, [self.rows["web"]], expected_native_id=self.ids["web"]["manifest"])
        self.assertEqual(actual["nativeImageIdKind"], "platform-manifest-digest")
        self.assertEqual(actual["configDigest"], self.ids["web"]["config"])

    def test_nested_index_native_id_is_distinct_and_graph_bound(self):
        self.files, self.expected, self.rows, self.ids = fixture(wrapped=True)
        image = self.verify()["images"]["web"]
        row = self.rows["web"]
        row.update(Id=self.ids["web"]["index"], Descriptor=self.ids["web"]["descriptor"])
        result = native.verify_native_inspection(image, [row], expected_native_id=row["Id"])
        self.assertEqual(result["nativeImageIdKind"], "index-digest")
        self.assertEqual(result["indexDigest"], self.ids["web"]["index"])
        self.assertNotEqual(result["indexDigest"], result["manifestDigest"])
        self.assertNotEqual(result["indexDigest"], result["configDigest"])

    def test_config_native_id_can_keep_a_distinct_verified_index_descriptor(self):
        self.files, self.expected, self.rows, self.ids = fixture(wrapped=True)
        image = self.verify()["images"]["web"]
        row = self.rows["web"]
        row.update(Id=self.ids["web"]["config"], Descriptor=self.ids["web"]["descriptor"])
        result = native.verify_native_inspection(image, [row], expected_native_id=row["Id"])
        self.assertEqual(result["nativeImageIdKind"], "config-digest")
        self.assertEqual(result["indexDigest"], self.ids["web"]["index"])

    def test_independently_pinned_archive_hash_and_size_are_enforced(self):
        for kwargs in ({"expected_hash": "f" * 64}, {"expected_bytes": 1024}):
            with self.subTest(kwargs=kwargs), self.assertRaises(native.IdentityError):
                self.verify(**kwargs)

    def test_role_metadata_requires_explicit_nonroot_user(self):
        for user in ("root", "0", "00:1000", "", None):
            expected = deepcopy(self.expected)
            expected["web"]["metadata"]["User"] = user
            with self.subTest(user=user), self.assertRaises(native.IdentityError):
                self.verify(expected=expected)

    def test_source_and_caller_role_contracts_are_independently_enforced(self):
        for change in ({"sourceRevision": "f" * 40}, {"configDigest": "sha256:" + "f" * 64},
                       {"metadata": {"User": "bun", "Cmd": ["bun", "foreign.mjs"]}},
                       {"metadata": {"User": "bun", "Env": {"APP_COMMIT": "f" * 40}}}):
            expected = deepcopy(self.expected)
            expected["web"].update(change)
            with self.subTest(change=change), self.assertRaises(native.IdentityError):
                self.verify(expected=expected)

    def test_gzip_layers_are_streamed_and_linked_to_uncompressed_rootfs(self):
        self.files, self.expected, self.rows, self.ids = fixture(compressed=True)
        result = self.verify()
        self.assertEqual(result["expandedRootfsBytesVerified"], len(b"synthetic shared RootFS bytes, no Docker operation"))
        native.verify_native_inspection(result["images"]["web"], [self.rows["web"]])

    def test_wrong_compressed_rootfs_diff_id_rejected_with_all_metadata_rehashed(self):
        files, expected, _, _ = fixture(compressed=True)
        root = json.loads(files["index.json"])
        manifest_descriptor = root["manifests"][0]
        manifest_path = "blobs/sha256/" + manifest_descriptor["digest"][7:]
        manifest = json.loads(files[manifest_path])
        config_path = "blobs/sha256/" + manifest["config"]["digest"][7:]
        config = json.loads(files.pop(config_path))
        config["rootfs"]["diff_ids"] = ["sha256:" + "f" * 64]
        raw = encoded(config)
        config_id = digest(raw)
        files["blobs/sha256/" + config_id[7:]] = raw
        expected["web"]["configDigest"] = config_id
        manifest["config"].update(digest=config_id, size=len(raw))
        files.pop(manifest_path)
        raw = encoded(manifest)
        manifest_id = digest(raw)
        files["blobs/sha256/" + manifest_id[7:]] = raw
        manifest_descriptor.update(digest=manifest_id, size=len(raw))
        files["index.json"] = encoded(root)
        compatibility = json.loads(files["manifest.json"])
        compatibility[0]["Config"] = "blobs/sha256/" + config_id[7:]
        files["manifest.json"] = encoded(compatibility)
        with self.assertRaisesRegex(native.IdentityError, "RootFS"):
            self.verify(files, expected=expected)

    def test_all_reachable_layer_bytes_are_hashed(self):
        files = deepcopy(self.files)
        path = json.loads(files["manifest.json"])[0]["Layers"][0]
        files[path] = b"f" * len(files[path])
        with self.assertRaisesRegex(native.IdentityError, "Layer bytes"):
            self.verify(files)

    def test_missing_detached_extra_and_unapproved_graph_members_rejected(self):
        files = deepcopy(self.files)
        files["blobs/sha256/" + "f" * 64] = b"unreachable"
        with self.assertRaisesRegex(native.IdentityError, "unreachable"):
            self.verify(files)
        files = deepcopy(self.files)
        files.pop(json.loads(files["manifest.json"])[0]["Layers"][0])
        with self.assertRaises(native.IdentityError):
            self.verify(files)
        files, _, _, _ = fixture(4)
        with self.assertRaisesRegex(native.IdentityError, "Unapproved"):
            self.verify(files)

    def test_ambiguous_selected_platform_child_rejected(self):
        files = deepcopy(self.files)
        root = json.loads(files["index.json"])
        root["manifests"].append(deepcopy(root["manifests"][0]))
        files["index.json"] = encoded(root)
        with self.assertRaisesRegex(native.IdentityError, "Ambiguous"):
            self.verify(files)

    def test_wrong_descriptor_platform_and_size_rejected(self):
        for change in ({"platform": {"architecture": "arm64", "os": "linux"}}, {"size": 1}):
            files = deepcopy(self.files)
            root = json.loads(files["index.json"])
            root["manifests"][0].update(change)
            files["index.json"] = encoded(root)
            with self.subTest(change=change), self.assertRaises(native.IdentityError):
                self.verify(files)

    def test_docker_compatibility_manifest_must_match_exact_oci_layers(self):
        files = deepcopy(self.files)
        compatibility = json.loads(files["manifest.json"])
        compatibility[0]["Layers"] = []
        files["manifest.json"] = encoded(compatibility)
        with self.assertRaisesRegex(native.IdentityError, "Docker and OCI"):
            self.verify(files)

    def test_tags_and_annotations_cannot_override_source_authority(self):
        files = deepcopy(self.files)
        root = json.loads(files["index.json"])
        root["manifests"][0]["annotations"] = {"org.opencontainers.image.ref.name": "production:latest", "sourceRevision": "f" * 40}
        files["index.json"] = encoded(root)
        compatibility = json.loads(files["manifest.json"])
        compatibility[0]["RepoTags"] = ["unrelated/production:latest"]
        files["manifest.json"] = encoded(compatibility)
        self.verify(files)
        wrong = deepcopy(self.expected)
        wrong["web"]["sourceRevision"] = "f" * 40
        with self.assertRaises(native.IdentityError):
            self.verify(files, expected=wrong)

    def test_native_inspect_identity_descriptor_source_platform_and_rootfs_substitution_hold(self):
        image = self.verify()["images"]["web"]
        original = self.rows["web"]
        changes = [{"Id": "sha256:" + "f" * 64}, {"Architecture": "arm64"}, {"RootFS": {"Type": "layers", "Layers": []}},
                   {"Descriptor": {**original["Descriptor"], "digest": "sha256:" + "f" * 64}},
                   {"Descriptor": {**original["Descriptor"], "size": 1}}, {"Descriptor": None},
                   {"Config": {**original["Config"], "User": "root"}},
                   {"Config": {**original["Config"], "Env": ["APP_COMMIT=changed"]}}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(native.IdentityError):
                native.verify_native_inspection(image, [{**deepcopy(original), **change}])
        with self.assertRaises(native.IdentityError):
            native.verify_native_inspection(image, [original], expected_native_id=self.ids["web"]["config"])

    def test_duplicate_members_symlinks_and_trailing_data_are_rejected(self):
        raw = archive_bytes(self.files)
        self.path.write_bytes(raw)
        with tarfile.open(self.path, "a") as archive:
            entry = tarfile.TarInfo("index.json")
            entry.size = len(self.files["index.json"])
            archive.addfile(entry, io.BytesIO(self.files["index.json"]))
        raw = self.path.read_bytes()
        with self.assertRaises(native.IdentityError):
            native.verify_archive(self.path, expected_sha256=sha256(raw).hexdigest(), expected_bytes=len(raw), expected_images=self.expected)
        self.path.write_bytes(archive_bytes(self.files))
        with tarfile.open(self.path, "a") as archive:
            entry = tarfile.TarInfo("unsafe-link")
            entry.type = tarfile.SYMTYPE
            entry.linkname = "../outside"
            archive.addfile(entry)
        raw = self.path.read_bytes()
        with self.assertRaises(native.IdentityError):
            native.verify_archive(self.path, expected_sha256=sha256(raw).hexdigest(), expected_bytes=len(raw), expected_images=self.expected)
        raw = archive_bytes(self.files) + b"unexpected"
        self.path.write_bytes(raw)
        with self.assertRaises(native.IdentityError):
            native.verify_archive(self.path, expected_sha256=sha256(raw).hexdigest(), expected_bytes=len(raw), expected_images=self.expected)

    def test_duplicate_json_properties_are_not_admitted_as_graph_authority(self):
        files = deepcopy(self.files)
        files["index.json"] = files["index.json"].replace(b'"schemaVersion":2', b'"schemaVersion":2,"schemaVersion":2', 1)
        with self.assertRaises(native.IdentityError):
            self.verify(files)

    def test_archive_symlink_and_hardlink_refused_without_extraction(self):
        raw = archive_bytes(self.files)
        original = self.root / "original.tar"
        original.write_bytes(raw)
        self.path.symlink_to(original)
        with self.assertRaises((native.IdentityError, ValueError)):
            native.verify_archive(self.path, expected_sha256=sha256(raw).hexdigest(), expected_bytes=len(raw), expected_images=self.expected)
        self.path.unlink()
        os.link(original, self.path)
        with self.assertRaises((native.IdentityError, ValueError)):
            native.verify_archive(self.path, expected_sha256=sha256(raw).hexdigest(), expected_bytes=len(raw), expected_images=self.expected)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ["image.tar", "original.tar"])

    def test_output_never_contains_raw_environment_values(self):
        result = self.verify()
        raw = json.dumps(result)
        self.assertNotIn("APP_COMMIT", raw)
        self.assertNotIn("PATH=/usr/bin", raw)
        self.assertIn("configMetadataSha256", raw)


if __name__ == "__main__":
    unittest.main()
