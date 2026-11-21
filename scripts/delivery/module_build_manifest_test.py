"""Exercise source/build joins against real local Git data, never a daemon."""
from copy import deepcopy
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import module_build_manifest as build
import module_versions as versions


class ModuleBuildManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Version fixture")
        self.git("config", "user.email", "version@example.invalid")
        self.write("package.json", {"version": "1.7.1"})
        modules = {role: {"name": role, "kind": "service", "version": "1.7.1",
                          "paths": [role + ".ts"], "dependencies": []} for role in build.HEADLESS_ROLES}
        registry = {"schemaVersion": 1, "kind": versions.KIND, "versionMeaning": versions.MEANING,
                    "baselineSourceRevision": "a" * 40, "modules": modules, "sharedPaths": [],
                    "ignoredPaths": [versions.REGISTRY], "ignoreVersionOnlyChanges": ["package.json"]}
        self.write(versions.REGISTRY, registry)
        for role in build.HEADLESS_ROLES:
            (self.root / (role + ".ts")).write_text("export const value = 1;\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Create versioned local fixture")
        self.revision = self.git("rev-parse", "HEAD").strip()
        ids = {role: "sha256:" + str(index) * 64 for index, role in enumerate(sorted(build.ROLES), 1)}
        self.candidate = {"schemaVersion": 3, "kind": "warpdrive-image-candidate", "revision": self.revision,
                          "deploymentAuthorized": False, "components": {
                              role: {"imageId": identity, "sourceRevision": self.revision} for role, identity in ids.items()}}
        self.smoke = {"expectedRevision": self.revision, "success": True, "failure": None,
                      "cleanup": {"success": True, "errors": []}, "checks": [{"status": "passed"}],
                      "images": {role: {"id": identity, "revision": self.revision} for role, identity in ids.items()}}
        self.inspections = {role: [{"Id": identity, "Config": {"Labels": {
            "org.opencontainers.image.revision": self.revision}}}] for role, identity in ids.items()}
        self.evidence = {"candidate": {"sha256": "a" * 64, "bytes": 1},
                         "smoke": {"sha256": "b" * 64, "bytes": 1},
                         "inspections": {role: {"sha256": "c" * 64, "bytes": 1} for role in build.ROLES}}

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], capture_output=True,
                              check=True, timeout=10).stdout.decode()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return path

    def result(self, **changes):
        arguments = dict(git=versions.Git(self.root), revision=self.revision, release_version="1.7.1",
                         candidate=self.candidate, smoke=self.smoke, inspections=self.inspections,
                         evidence=self.evidence)
        arguments.update(changes)
        return build.join_build(**arguments)

    def test_actual_git_versions_and_native_ids_join_without_installed_claims(self):
        result = self.result()
        self.assertEqual(result["releaseVersion"], "1.7.1")
        self.assertFalse(result["installedAcceptance"])
        self.assertFalse(result["deploymentAuthorized"])
        for role, row in result["builtModules"].items():
            self.assertEqual(row["testedNativeImageId"], self.candidate["components"][role]["imageId"])
            self.assertEqual(row["sourceModuleVersion"], "1.7.1")
            self.assertIsNone(row["configDigest"])
            self.assertIsNone(row["platformManifestDigest"])
            self.assertIsNone(row["installedModuleVersion"])

    def test_wrong_product_version_is_rejected_against_committed_package(self):
        with self.assertRaises(versions.VersionError):
            self.result(release_version="1.7.2")

    def test_headless_manifest_joins_exact_core_without_reusing_web_identity(self):
        identifier = "sha256:" + "5" * 64
        self.candidate["schemaVersion"] = 4
        self.candidate["components"]["core-api"] = {"imageId": identifier, "sourceRevision": self.revision}
        self.smoke.update(kind="warpdrive-headless-final-image-smoke", coreImage={"id": identifier, "revision": self.revision})
        self.inspections["core-api"] = [{"Id": identifier, "Config": {"Labels": {"org.opencontainers.image.revision": self.revision}}}]
        self.evidence["inspections"]["core-api"] = {"sha256": "d" * 64, "bytes": 1}
        result = self.result()
        self.assertEqual(set(result["builtModules"]), build.HEADLESS_ROLES)
        self.assertEqual(result["builtModules"]["core-api"]["testedNativeImageId"], identifier)
        self.smoke["coreImage"]["id"] = self.smoke["images"]["web"]["id"]
        with self.assertRaises(versions.VersionError):
            self.result()

    def test_native_id_mismatch_is_rejected(self):
        changed = deepcopy(self.inspections)
        changed["web"][0]["Id"] = "sha256:" + "f" * 64
        with self.assertRaises(versions.VersionError):
            self.result(inspections=changed)

    def test_foreign_source_is_rejected(self):
        changed = deepcopy(self.inspections)
        changed["worker"][0]["Config"]["Labels"]["org.opencontainers.image.revision"] = "f" * 40
        with self.assertRaises(versions.VersionError):
            self.result(inspections=changed)

    def test_failed_cleanup_or_check_is_not_manifested_as_successful_build(self):
        for mutation in ("cleanup", "check", "success"):
            with self.subTest(mutation=mutation):
                changed = deepcopy(self.smoke)
                if mutation == "cleanup":
                    changed["cleanup"]["errors"] = ["unresolved"]
                elif mutation == "check":
                    changed["checks"][0]["status"] = "failed"
                else:
                    changed["success"] = False
                with self.assertRaises(versions.VersionError):
                    self.result(smoke=changed)

    def test_missing_or_foreign_component_is_rejected(self):
        changed = deepcopy(self.candidate)
        changed["components"]["unknown"] = changed["components"].pop("worker")
        with self.assertRaises(versions.VersionError):
            self.result(candidate=changed)

    def test_actual_platform_descriptor_is_kept_with_its_type(self):
        identity = self.inspections["web"][0]["Id"]
        self.inspections["web"][0]["Descriptor"] = {
            "mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": identity}
        self.assertEqual(self.result()["builtModules"]["web"]["platformManifestDigest"], identity)

    def test_different_descriptor_does_not_retype_the_native_id(self):
        self.inspections["web"][0]["Descriptor"] = {
            "mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": "sha256:" + "f" * 64}
        row = self.result()["builtModules"]["web"]
        self.assertEqual(row["testedNativeImageId"], self.inspections["web"][0]["Id"])
        self.assertIsNone(row["platformManifestDigest"])
        self.assertIsNone(row["configDigest"])

    def test_malformed_image_descriptor_is_rejected(self):
        self.inspections["web"][0]["Descriptor"] = {
            "mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": "not-a-digest"}
        with self.assertRaises(versions.VersionError):
            self.result()

    def test_index_descriptor_is_not_relabelled_as_platform_manifest(self):
        self.inspections["web"][0]["Descriptor"] = {
            "mediaType": "application/vnd.oci.image.index.v1+json", "digest": self.inspections["web"][0]["Id"]}
        self.assertIsNone(self.result()["builtModules"]["web"]["platformManifestDigest"])

    def test_metadata_rejects_symlinks_and_duplicate_keys(self):
        original = self.write("metadata.json", {"ok": True})
        linked = self.root / "linked.json"
        linked.symlink_to(original)
        with self.assertRaises(OSError):
            build.metadata(linked)
        original.write_text('{"ok":true,"ok":false}')
        with self.assertRaises(versions.VersionError):
            build.metadata(original)

    def test_cli_preserves_original_inputs_and_refuses_output_overwrite(self):
        candidate = self.write("proof/candidate.json", self.candidate)
        smoke = self.write("proof/smoke/report.json", self.smoke)
        for role, rows in self.inspections.items():
            self.write("proof/inspections/" + role + ".json", rows)
        before = candidate.read_bytes()
        output = self.root / "proof/module-release-manifest.json"
        args = ["--repo", str(self.root), "--revision", self.revision, "--release-version", "1.7.1",
                "--candidate", str(candidate), "--smoke-report", str(smoke),
                "--inspections", str(self.root / "proof/inspections"), "--output", str(output)]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build.main(args), 0)
        result = json.loads(output.read_bytes())
        self.assertEqual(result["sourceRevision"], self.revision)
        self.assertEqual(candidate.read_bytes(), before)
        with self.assertRaises(FileExistsError):
            build.main(args)


if __name__ == "__main__":
    unittest.main()
