"""Daemon-free optional image retention, linkage and archive integrity tests."""

from copy import deepcopy
from contextlib import redirect_stdout
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import stat
import tarfile
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bundle import create_bundle as create_baseline
from candidate import CandidateError
from image_smoke import COMPONENTS, image_metadata
import optional_image_bundle as optional
from test_bundle import FakeDocker as BaselineDocker, write_candidate
from test_candidate import SHA
from test_native_image_identity import add_legacy


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def optional_images():
    layer = b"shared synthetic optional layer, never Docker-loaded"
    layer_digest = "sha256:" + sha256(layer).hexdigest()
    blobs = {"blobs/sha256/" + layer_digest[7:]: layer}
    prefix = b"shared legacy RootFS prefix bytes"
    prefix_digest = "sha256:" + sha256(prefix).hexdigest()
    blobs["blobs/sha256/" + prefix_digest[7:]] = prefix
    layers = [{"mediaType": "application/vnd.oci.image.layer.v1.tar", "digest": prefix_digest, "size": len(prefix)},
              {"mediaType": "application/vnd.oci.image.layer.v1.tar", "digest": layer_digest, "size": len(layer)}]
    diff_ids = [prefix_digest, layer_digest]
    rows, manifests, descriptors = {}, [], []
    for role, specification in optional.ROLES.items():
        config = {"architecture": "amd64", "os": "linux", "created": "2026-11-13T19:28:26.035952736Z",
                  "rootfs": {"type": "layers", "diff_ids": diff_ids},
                  "config": {"User": "1000:1000" if role == "operations-collector" else "bun", "WorkingDir": "/app",
                             "Entrypoint": ["/usr/local/bin/docker-entrypoint.sh"], "Cmd": specification["command"],
                             "ExposedPorts": specification["ports"], "Labels": {"org.opencontainers.image.revision": SHA}}}
        config_raw = encoded(config)
        identifier = "sha256:" + sha256(config_raw).hexdigest()
        config_path = "blobs/sha256/" + identifier[7:]
        blobs[config_path] = config_raw
        oci = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
               "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": identifier, "size": len(config_raw)},
               "layers": layers}
        oci_raw = encoded(oci)
        oci_digest = "sha256:" + sha256(oci_raw).hexdigest()
        blobs["blobs/sha256/" + oci_digest[7:]] = oci_raw
        descriptors.append({"mediaType": oci["mediaType"], "digest": oci_digest, "size": len(oci_raw),
                            "platform": {"architecture": "amd64", "os": "linux"}})
        manifests.append({"Config": config_path, "RepoTags": None, "Layers": ["blobs/sha256/" + value[7:] for value in diff_ids],
                          "LayerSources": dict(zip(diff_ids, layers))})
        rows[role] = {"Id": identifier, "Os": "linux", "Architecture": "amd64", "Config": config["config"], "Size": 1024, "RepoDigests": []}
    return rows, blobs, manifests, descriptors


def saved_tar(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, raw in files:
            member = tarfile.TarInfo(name)
            member.size = len(raw)
            archive.addfile(member, io.BytesIO(raw))
    return output.getvalue()


class OptionalDocker:
    def __init__(self):
        self.images, self.blobs, self.manifests, self.descriptors = optional_images()
        self.calls = []
        self.archive_change = None
        self.replace_output = False
        self.classic = False

    def json(self, command, **_options):
        self.calls.append(command)
        if command[:2] != ["image", "inspect"]:
            raise AssertionError("Only exact image inspection is allowed")
        return [deepcopy(next(row for row in self.images.values() if row["Id"] == command[2]))]

    def run(self, command, **_options):
        self.calls.append(command)
        if command[:3] != ["image", "save", "--output"]:
            raise AssertionError("No build, load, pull, push or container operation allowed")
        selected = command[4:]
        manifests = [entry for entry in self.manifests if "sha256:" + entry["Config"].rsplit("/", 1)[1] in selected]
        descriptors = [item for item in self.descriptors if json.loads(self.blobs["blobs/sha256/" + item["digest"][7:]])["config"]["digest"] in selected]
        used = {entry["Config"] for entry in manifests} | {layer for entry in manifests for layer in entry["Layers"]}
        used |= {"blobs/sha256/" + descriptor["digest"][7:] for descriptor in descriptors}
        legacy = {}
        if self.classic:
            for entry in manifests:
                add_legacy(legacy, json.loads(self.blobs[entry["Config"]]))
        files = [("manifest.json", encoded(manifests)), ("index.json", encoded({"schemaVersion": 2, "manifests": descriptors[:1] if self.classic else descriptors})),
                 ("oci-layout", encoded({"imageLayoutVersion": "1.0.0"})), *((name, self.blobs[name]) for name in sorted(used))]
        files.extend(legacy.items())
        if self.archive_change:
            files = self.archive_change(files)
        path = Path(command[3])
        raw = saved_tar(files)
        if self.replace_output:
            other = path.with_suffix(".replacement")
            other.write_bytes(raw)
            os.replace(other, path)
        else:
            path.write_bytes(raw)


class OptionalBundleTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.origin = {"kind": "github-actions", "repository": "KhademOHAli1/warpdrive", "runId": 91, "runAttempt": 2,
                       "event": "workflow_dispatch", "ref": "refs/heads/qualification"}
        source = self.root / "baseline-source"
        candidate = write_candidate(source)
        self.baseline = self.root / "baseline"
        loaded = create_baseline(source, self.baseline, expected_revision=SHA, docker=BaselineDocker(), origin=self.origin)
        self.baseline_pin = loaded["provenance"]["bundleManifestSha256"]
        self.baseline_components = candidate["components"]
        self.output = self.root / "optional"
        self.docker = OptionalDocker()
        self.reports = {}
        for role, specification in optional.ROLES.items():
            report = {"kind": specification["kind"], "expectedRevision": SHA, "success": True, "failure": None,
                      "cleanup": {"success": True, "errors": []}, "checks": [{"name": check, "status": "passed"} for check in specification["checks"]],
                      "images": {component: {"id": value["imageId"], "revision": value.get("sourceRevision", SHA), "user": value["runtimeUser"]}
                                 for component, value in candidate["components"].items()},
                      specification["field"]: image_metadata([self.docker.images[role]], SHA)}
            path = self.root / (role + ".json")
            path.write_bytes(encoded(report))
            self.reports[role] = path

    def arguments(self):
        return {"expected_revision": SHA, "baseline_dir": self.baseline, "baseline_manifest_sha256": self.baseline_pin,
                "expected_origin": self.origin}

    def pack(self, reports=None):
        return optional.create_bundle(self.output, reports=self.reports if reports is None else reports, docker=self.docker, **self.arguments())

    def verify(self, pin=None):
        pin = pin or sha256((self.output / optional.MANIFEST).read_bytes()).hexdigest()
        return optional.verify_bundle(self.output, expected_manifest_sha256=pin, **self.arguments())

    def mutate_report(self, role, mutate):
        path = self.reports[role]
        report = json.loads(path.read_bytes())
        mutate(report)
        path.write_bytes(encoded(report))

    def rehash_manifest(self):
        path = self.output / optional.MANIFEST
        manifest = json.loads(path.read_bytes())
        for name, record in manifest["files"].items():
            raw = (self.output / name).read_bytes()
            record.update(sha256=sha256(raw).hexdigest(), sizeBytes=len(raw))
        raw = encoded(manifest)
        path.write_bytes(raw)
        return sha256(raw).hexdigest()

    def mutate_archive(self, mutate):
        path = self.output / optional.ARCHIVE
        with tarfile.open(path, "r:") as archive:
            files = [(entry.name, archive.extractfile(entry).read()) for entry in archive if entry.isfile()]
        path.write_bytes(saved_tar(mutate(files)))
        return self.rehash_manifest()

    def test_packs_both_exact_tested_ids_once_without_changing_fixed_four_bundle(self):
        before = {path.name: sha256(path.read_bytes()).hexdigest() for path in self.baseline.iterdir() if path.is_file()}
        loaded = self.pack()
        saves = [call for call in self.docker.calls if call[:2] == ["image", "save"]]
        self.assertEqual(len(saves), 1)
        self.assertEqual(set(saves[0][4:]), {row["Id"] for row in self.docker.images.values()})
        self.assertEqual(set(loaded["manifest"]["components"]), set(optional.ROLES))
        self.assertFalse(loaded["deploymentAuthorized"])
        self.assertTrue(loaded["independentProducerApiAdmissionRequired"])
        self.assertEqual(loaded["manifest"]["originVerification"], "baseline-producer-snapshot-only")
        self.assertEqual(loaded["manifest"]["baseline"]["bundleManifestSha256"], self.baseline_pin)
        self.assertEqual(COMPONENTS, ("web", "worker", "realtime", "migrator"))
        self.assertEqual(before, {path.name: sha256(path.read_bytes()).hexdigest() for path in self.baseline.iterdir() if path.is_file()})

    def test_each_optional_profile_can_be_retained_alone(self):
        for role in optional.ROLES:
            with self.subTest(role=role):
                self.output = self.root / role
                loaded = self.pack({role: self.reports[role]})
                self.assertEqual(set(loaded["manifest"]["components"]), {role})

    def test_classic_save_with_two_docker_entries_one_oci_root_and_derived_legacy_blobs_is_retained(self):
        self.docker.classic = True
        loaded = self.pack()
        self.assertEqual(set(loaded["manifest"]["components"]), set(optional.ROLES))
        self.assertEqual({value["imageId"] for value in loaded["manifest"]["components"].values()},
                         {row["Id"] for row in self.docker.images.values()})
        with tarfile.open(self.output / optional.ARCHIVE, "r:") as archive:
            manifest = json.load(archive.extractfile("manifest.json"))
            index = json.load(archive.extractfile("index.json"))
            legacy_count = sum(b'"container_config"' in archive.extractfile(member).read()
                               for member in archive if member.isfile() and member.name.startswith("blobs/"))
        self.assertEqual(len(manifest), 2)
        self.assertEqual(len(index["manifests"]), 1)
        self.assertEqual(legacy_count, 3)
        self.assertFalse(loaded["deploymentAuthorized"])
        self.verify()

    def test_classic_single_optional_role_keeps_all_derived_legacy_metadata(self):
        self.docker.classic = True
        loaded = self.pack({"core-api": self.reports["core-api"]})
        self.assertEqual(set(loaded["manifest"]["components"]), {"core-api"})
        self.verify()

    def test_classic_legacy_metadata_substitution_is_rejected_after_external_archive_rehash(self):
        self.docker.classic = True
        self.pack()

        def corrupt(files):
            changed = []
            replaced = False
            for name, raw in files:
                if not replaced and b'"container_config"' in raw:
                    value = json.loads(raw)
                    value["parent"] = "f" * 64
                    raw = encoded(value)
                    name = "blobs/sha256/" + sha256(raw).hexdigest()
                    replaced = True
                changed.append((name, raw))
            self.assertTrue(replaced)
            return changed

        with self.assertRaises(CandidateError):
            self.verify(self.mutate_archive(corrupt))

    def test_writes_only_owned_private_flat_files(self):
        self.pack()
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        self.assertEqual(len(list(self.output.iterdir())), 6)
        for path in self.output.iterdir():
            self.assertTrue(path.is_file())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_uid, os.geteuid())
            self.assertEqual(path.stat().st_nlink, 1)

    def test_no_empty_profile_or_unknown_role_can_create_an_archive(self):
        for reports in ({}, {"unknown": self.reports["core-api"]}):
            with self.subTest(reports=reports), self.assertRaises(CandidateError):
                self.pack(reports)
        self.assertFalse(any(call[:2] == ["image", "save"] for call in self.docker.calls))

    def test_empty_skipped_duplicate_or_missing_runtime_checks_never_establish_success(self):
        original = self.reports["core-api"].read_bytes()
        for checks in ([], [{"name": "optional-core-http-and-drain", "status": "passed"}],
                       [{"name": "optional-core-http-and-drain", "status": "passed"}] * 5,
                       [{"name": name, "status": "skipped"} for name in optional.ROLES["core-api"]["checks"]]):
            with self.subTest(checks=checks):
                self.mutate_report("core-api", lambda report: report.update(checks=checks))
                with self.assertRaises(CandidateError):
                    self.pack()
                self.reports["core-api"].write_bytes(original)

    def test_failed_or_unknown_cleanup_and_wrong_report_kind_or_revision_hold(self):
        original = self.reports["core-api"].read_bytes()
        for change in ({"success": False}, {"failure": "unknown"}, {"cleanup": {"success": False}},
                       {"cleanup": {"success": True, "errors": ["ownership changed"]}}, {"kind": "foreign"}, {"expectedRevision": "a" * 40}):
            with self.subTest(change=change):
                self.mutate_report("core-api", lambda report: report.update(change))
                with self.assertRaises(CandidateError):
                    self.pack()
                self.reports["core-api"].write_bytes(original)

    def test_optional_report_must_bind_all_exact_baseline_image_identities(self):
        for component in COMPONENTS:
            with self.subTest(component=component):
                original = self.reports["core-api"].read_bytes()
                self.mutate_report("core-api", lambda report: report["images"][component].update(id="sha256:" + "f" * 64))
                with self.assertRaises(CandidateError):
                    self.pack()
                self.reports["core-api"].write_bytes(original)

    def test_wrong_optional_source_platform_user_or_command_hold_before_save(self):
        original = deepcopy(self.docker.images)
        for change in (lambda row: row.update(Architecture="arm64"), lambda row: row["Config"].update(User="root"),
                       lambda row: row["Config"].update(Cmd=["bun", "unreviewed.mjs"]),
                       lambda row: row["Config"]["Labels"].update({"org.opencontainers.image.revision": "a" * 40})):
            with self.subTest(change=change):
                change(self.docker.images["core-api"])
                with self.assertRaises((CandidateError, RuntimeError)):
                    self.pack()
                self.docker.images = deepcopy(original)
        self.assertFalse(any(call[:2] == ["image", "save"] for call in self.docker.calls))

    def test_baseline_manifest_and_external_origin_snapshot_are_required(self):
        with self.assertRaises(CandidateError):
            optional.create_bundle(self.output, reports=self.reports, docker=self.docker,
                **{**self.arguments(), "baseline_manifest_sha256": "f" * 64})
        with self.assertRaises(CandidateError):
            optional.create_bundle(self.output, reports=self.reports, docker=self.docker,
                **{**self.arguments(), "expected_origin": {**self.origin, "runAttempt": 3}})

    def test_optional_manifest_pin_is_external_and_required_on_readback(self):
        self.pack()
        with self.assertRaises(CandidateError):
            self.verify("f" * 64)

    def test_manifest_cannot_authorize_deploy_or_rewrite_its_producer_snapshot(self):
        self.pack()
        path = self.output / optional.MANIFEST
        original = path.read_bytes()
        for change in ({"deploymentAuthorized": True}, {"origin": {**self.origin, "runId": 92}},
                       {"originVerification": "api-authenticated"}):
            manifest = json.loads(original)
            manifest.update(change)
            raw = encoded(manifest)
            path.write_bytes(raw)
            with self.assertRaises(CandidateError):
                self.verify(sha256(raw).hexdigest())
        path.write_bytes(original)

    def test_layer_substitution_fails_even_after_file_and_manifest_rehash(self):
        self.pack()

        def change(files):
            return [(name, b"corrupt bytes" if raw.startswith(b"shared synthetic") else raw) for name, raw in files]

        pin = self.mutate_archive(change)
        with self.assertRaises(CandidateError):
            self.verify(pin)

    def test_archive_cannot_add_unknown_image_blob_or_duplicate_member(self):
        self.pack()
        original = (self.output / optional.ARCHIVE).read_bytes()
        for change in (lambda files: files + [("blobs/sha256/" + "f" * 64, b"foreign")], lambda files: files + [files[0]]):
            with self.subTest(change=change):
                pin = self.mutate_archive(change)
                with self.assertRaises(CandidateError):
                    self.verify(pin)
                (self.output / optional.ARCHIVE).write_bytes(original)
                self.rehash_manifest()

    def test_archive_cannot_substitute_role_config_or_tagged_image(self):
        self.pack()

        def change(files):
            result = []
            for name, raw in files:
                if name == "manifest.json":
                    values = json.loads(raw)
                    values[0]["RepoTags"] = ["unreviewed:latest"]
                    raw = encoded(values)
                result.append((name, raw))
            return result

        pin = self.mutate_archive(change)
        with self.assertRaises(CandidateError):
            self.verify(pin)

    def test_archive_rejects_symlinks_and_noncanonical_file_names(self):
        self.pack()
        path = self.output / optional.ARCHIVE
        original = path.read_bytes()
        with tarfile.open(path, "a") as archive:
            member = tarfile.TarInfo("unsafe")
            member.type = tarfile.SYMTYPE
            member.linkname = "../outside"
            archive.addfile(member)
        with self.assertRaises(CandidateError):
            self.verify(self.rehash_manifest())
        path.write_bytes(original)
        self.rehash_manifest()
        pin = self.mutate_archive(lambda files: [(name + "/" if name == "manifest.json" else name, raw) for name, raw in files])
        with self.assertRaises(CandidateError):
            self.verify(pin)

    def test_unexpected_files_symlinks_and_hardlinks_hold(self):
        self.pack()
        extra = self.output / "unexpected.json"
        extra.write_text("{}")
        with self.assertRaises(CandidateError):
            self.verify()
        extra.unlink()
        archive = self.output / optional.ARCHIVE
        held = self.root / "held.tar"
        archive.rename(held)
        archive.symlink_to(held)
        with self.assertRaises((CandidateError, OSError)):
            self.verify()
        archive.unlink()
        os.link(held, archive)
        with self.assertRaises(CandidateError):
            self.verify()

    def test_report_symlink_and_existing_output_directory_never_overwrite(self):
        original = self.reports["core-api"]
        alias = self.root / "alias-report.json"
        alias.symlink_to(original)
        with self.assertRaises((CandidateError, OSError)):
            self.pack({"core-api": alias})
        self.output.mkdir()
        sentinel = self.output / "keep"
        sentinel.write_text("owned elsewhere")
        with self.assertRaises(CandidateError):
            self.pack()
        self.assertEqual(sentinel.read_text(), "owned elsewhere")

    def test_insufficient_disk_holds_before_archive_or_directory_creation(self):
        with patch.object(optional.shutil, "disk_usage", return_value=SimpleNamespace(free=1)), self.assertRaises(CandidateError):
            self.pack()
        self.assertFalse(self.output.exists())
        self.assertFalse(any(call[:2] == ["image", "save"] for call in self.docker.calls))

    def test_docker_cannot_replace_owned_archive_inode(self):
        self.docker.replace_output = True
        with self.assertRaises(CandidateError):
            self.pack()
        self.assertFalse((self.output / optional.MANIFEST).exists())

    def test_missing_optional_report_or_inspection_cannot_be_hidden_by_manifest_inventory(self):
        self.pack()
        path = self.output / "core-api-report.json"
        path.unlink()
        with self.assertRaises((CandidateError, OSError)):
            self.verify()

    def test_saved_config_substitution_is_rejected_without_load_or_runtime(self):
        self.pack()
        identifier = self.docker.images["core-api"]["Id"]

        def change(files):
            result = []
            for name, raw in files:
                if name == "blobs/sha256/" + identifier[7:]:
                    config = json.loads(raw)
                    config["config"]["Labels"]["org.opencontainers.image.revision"] = "f" * 40
                    raw = encoded(config)
                result.append((name, raw))
            return result

        pin = self.mutate_archive(change)
        with self.assertRaises(CandidateError):
            self.verify(pin)
        self.assertFalse(any(call[0] in {"run", "pull", "push", "build"} or call[:2] == ["image", "load"] for call in self.docker.calls))

    def test_cli_verify_is_offline_and_never_constructs_docker(self):
        loaded = self.pack()
        producer = self.root / "producer.json"
        producer.write_bytes(encoded(self.origin))
        argv = ["verify", "--bundle-dir", str(self.output), "--optional-manifest-sha256", loaded["manifestSha256"],
                "--expected-revision", SHA, "--baseline-dir", str(self.baseline), "--baseline-manifest-sha256", self.baseline_pin,
                "--producer-origin-file", str(producer)]
        with patch.object(optional, "Docker", side_effect=AssertionError("Offline verifier must not contact Docker")) as docker, \
                redirect_stdout(io.StringIO()) as stdout:
            self.assertEqual(optional.main(argv), 0)
        docker.assert_not_called()
        result = json.loads(stdout.getvalue())
        self.assertFalse(result["deploymentAuthorized"])
        self.assertTrue(result["independentProducerApiAdmissionRequired"])


if __name__ == "__main__":
    unittest.main()
