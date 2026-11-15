"""Bounded source-version policy and actual temporary-Git integration tests."""
from copy import deepcopy
from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import module_versions as versions


def registry():
    return {"schemaVersion": 1, "kind": versions.KIND, "versionMeaning": versions.MEANING,
            "baselineSourceRevision": "a" * 40,
            "modules": {
                "api": {"name": "API", "kind": "service", "version": "1.7.1", "paths": ["src/api/"], "dependencies": []},
                "web": {"name": "Web", "kind": "application", "version": "1.7.1", "paths": ["src/web/"], "dependencies": ["api"]}},
            "sharedPaths": [{"paths": ["package.json", "bun.lock"], "modules": ["api", "web"]}],
            "ignoredPaths": [versions.REGISTRY, "docs/delivery/releases/", "docs/delivery/module-version-changes/"],
            "ignoreVersionOnlyChanges": ["package.json"]}


class RegistryPolicyTests(unittest.TestCase):
    def test_stable_semver_and_explicit_bumps(self):
        self.assertEqual(versions.bump_version("1.7.1", "patch"), "1.7.2")
        self.assertEqual(versions.bump_version("1.7.1", "minor"), "1.8.0")
        self.assertEqual(versions.bump_version("1.7.1", "major"), "2.0.0")
        for value in ("v1.7.1", "1.07.1", "1.7", "1.7.1-rc.1", "1.7.1;echo bad", 171):
            with self.subTest(value=value), self.assertRaises(versions.VersionError):
                versions.version_tuple(value)

    def test_dependency_cycle_and_unknown_dependency_hold(self):
        for dependency in ("web", "missing"):
            value = registry()
            value["modules"]["api"]["dependencies"] = [dependency]
            with self.subTest(dependency=dependency), self.assertRaises(versions.VersionError):
                versions.validate_registry(value)

    def test_duplicate_unknown_fields_and_unsafe_paths_hold(self):
        with self.assertRaises(versions.VersionError):
            versions.decode(b'{"schemaVersion":1,"schemaVersion":1}')
        for path in ("../secret", "/etc/passwd", "src/../secret", ".git/config", "src/*", "src\\code", "src//code"):
            value = registry()
            value["modules"]["web"]["paths"] = [path]
            with self.subTest(path=path), self.assertRaises(versions.VersionError):
                versions.validate_registry(value)
        value = registry()
        value["publish"] = True
        with self.assertRaises(versions.VersionError):
            versions.validate_registry(value)

    def test_full_path_bound_allows_nested_names_and_counts_utf8_bytes(self):
        long_path = "src/api/" + "preserved-source/" * 14 + "slackOperationFailures.test.ts.source"
        self.assertGreater(len(long_path), 240)
        self.assertEqual(versions.safe_path(long_path, prefix=False), long_path)
        self.assertEqual(versions.safe_path("src/" + "x" * (versions.MAX_PATH_BYTES - 4)),
                         "src/" + "x" * (versions.MAX_PATH_BYTES - 4))
        for path in ("src/" + "x" * versions.MAX_PATH_BYTES, "src/" + "é" * (versions.MAX_PATH_BYTES // 2)):
            with self.subTest(path_bytes=len(path.encode("utf-8"))), self.assertRaises(versions.VersionError):
                versions.safe_path(path)

    def test_shared_and_transitive_source_changes(self):
        value = versions.validate_registry(registry())
        affected = versions.affected_modules(value, ["src/api/deleted.ts"])
        self.assertEqual(affected["api"]["paths"], {"src/api/deleted.ts"})
        self.assertEqual(affected["web"]["reasons"], {"dependency:api"})
        shared = versions.affected_modules(value, ["bun.lock"])
        self.assertTrue(all("shared-input" in row["reasons"] for row in shared.values()))

    def test_only_package_version_is_normalized(self):
        value = registry()
        first = b'{"version":"1.7.1","dependencies":{"x":"1"}}'
        version_only = b'{"dependencies":{"x":"1"},"version":"1.7.2"}'
        changed_dependency = b'{"version":"1.7.2","dependencies":{"x":"2"}}'
        self.assertEqual(versions.normalized_blob("package.json", first, value), versions.normalized_blob("package.json", version_only, value))
        self.assertNotEqual(versions.normalized_blob("package.json", first, value), versions.normalized_blob("package.json", changed_dependency, value))
        self.assertEqual(versions.normalized_blob("src/package-data.json", first, value), first)

    def test_reviewed_intent_rejects_unknown_modules_or_bumps(self):
        for bumps in ({"missing": "major"}, {"web": "release"}, {"web": True}):
            with self.subTest(bumps=bumps), self.assertRaises(versions.VersionError):
                versions.validate_changes({"schemaVersion": 1, "bumps": bumps}, registry()["modules"])

    def test_observed_legacy_identity_does_not_invent_a_version(self):
        value = {"schemaVersion": 1, "modules": {"api": {"moduleVersion": None, "sourceRevision": "b" * 40,
                 "imageDigest": "sha256:" + "c" * 64, "runtimeId": None, "evidence": {"installed-chain": "d" * 64}}}}
        self.assertIsNone(versions.validate_identities(value, registry()["modules"])["api"]["moduleVersion"])
        for key, bad in (("sourceRevision", "main"), ("imageDigest", "latest"), ("moduleVersion", 171), ("evidence", {})):
            changed = deepcopy(value)
            changed["modules"]["api"][key] = bad
            with self.subTest(key=key), self.assertRaises(versions.VersionError):
                versions.validate_identities(changed, registry()["modules"])

    def test_catalog_update_preserves_formatting_and_changes_only_version_tokens(self):
        value = registry()
        value["modules"]["api"]["name"] = 'API {example} "1.7.1"'
        raw = (json.dumps(value, indent="\t", ensure_ascii=False) + "\n").encode()
        proposed = deepcopy(value)
        proposed["modules"]["api"]["version"] = "1.7.2"
        updated = versions.updated_catalog_bytes(raw, proposed)
        self.assertEqual(updated, raw.replace(b'"version": "1.7.1"', b'"version": "1.7.2"', 1))
        self.assertEqual(versions.updated_catalog_bytes(raw, value), raw)
        proposed["modules"]["web"]["name"] = "Unrelated edit"
        with self.assertRaises(versions.VersionError):
            versions.updated_catalog_bytes(raw, proposed)


class RepositoryVersionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.command("init", "--quiet")
        self.command("config", "user.name", "Version tests")
        self.command("config", "user.email", "versions@example.invalid")
        self.write("package.json", {"name": "fixture", "version": "1.7.1", "dependencies": {"x": "1"}})
        self.write("bun.lock", "locked dependency 1\n")
        self.write("src/api/index.ts", "export const api = 1;\n")
        self.write("src/web/index.ts", "export const web = 1;\n")
        self.write(versions.REGISTRY, registry())
        self.base = self.commit("Initial source-module fixture")

    def command(self, *args):
        result = subprocess.run(["git", "-C", str(self.root), *args], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return result.stdout.decode().strip()

    def write(self, path, value):
        destination = self.root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n" if isinstance(value, dict) else value)

    def commit(self, subject):
        self.command("add", "--all")
        self.command("commit", "--quiet", "-m", subject)
        return self.command("rev-parse", "HEAD")

    def test_real_diff_patch_proposal_and_manifest_are_deterministic(self):
        self.write("src/api/index.ts", "export const api = 2;\n")
        head = self.commit("API implementation change")
        git = versions.Git(self.root)
        proposal = versions.plan(git, self.base, head)
        self.assertTrue(proposal["hasChanges"])
        self.assertEqual(proposal["modules"]["api"]["proposedVersion"], "1.7.2")
        self.assertEqual(proposal["modules"]["web"]["proposedVersion"], "1.7.2")
        self.assertEqual(versions.canonical(proposal), versions.canonical(versions.plan(git, self.base, head)))
        manifest = versions.manifest(git, head, "1.7.1")
        self.assertEqual(manifest["releaseVersion"], "1.7.1")
        self.assertTrue(all(not row["installedModuleVersionKnown"] and row["observedIdentity"] is None for row in manifest["modules"].values()))
        self.assertFalse(manifest["deploymentAuthorized"])
        self.assertFalse(manifest["compatibilityQualified"])
        self.assertEqual(manifest["sourceRevision"], head)

    def test_deletion_affects_declared_module_and_dependents(self):
        (self.root / "src/api/index.ts").unlink()
        head = self.commit("Delete an API input")
        proposal = versions.plan(versions.Git(self.root), self.base, head)
        self.assertEqual(proposal["modules"]["api"]["changedPaths"], ["src/api/index.ts"])
        self.assertIn("dependency:api", proposal["modules"]["web"]["reasons"])

    def test_long_nested_tracked_path_is_counted_and_fingerprinted(self):
        long_path = "src/api/" + "preserved-source/" * 14 + "slackOperationFailures.test.ts.source"
        self.assertGreater(len(long_path), 240)
        self.write(long_path, "export const preservedSource = 1;\n")
        head = self.commit("Include a legitimate long nested source path")
        git = versions.Git(self.root)
        proposal = versions.plan(git, self.base, head)
        self.assertEqual(proposal["modules"]["api"]["changedPaths"], [long_path])
        self.assertEqual(proposal["modules"]["api"]["proposedVersion"], "1.7.2")
        self.assertIn("dependency:api", proposal["modules"]["web"]["reasons"])
        before = versions.manifest(git, self.base, "1.7.1")
        after = versions.manifest(git, head, "1.7.1")
        self.assertNotEqual(before["modules"]["api"]["versionDecisionFingerprint"],
                            after["modules"]["api"]["versionDecisionFingerprint"])

    def test_selected_long_nested_symlink_is_not_read_as_source(self):
        long_path = "src/api/" + "preserved-source/" * 14 + "linked-source.ts"
        destination = self.root / long_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.symlink_to(self.root / "src/web/index.ts")
        head = self.commit("Unsupported selected symbolic link fixture")
        with self.assertRaisesRegex(versions.VersionError, "regular committed source"):
            versions.manifest(versions.Git(self.root), head, "1.7.1")

    def test_version_and_release_metadata_only_changes_do_not_loop(self):
        before_manifest = versions.manifest(versions.Git(self.root), self.base, "1.7.1")
        package = json.loads((self.root / "package.json").read_text())
        package["version"] = "1.7.2"
        self.write("package.json", package)
        changed = registry()
        changed["modules"]["api"]["version"] = "1.7.2"
        self.write(versions.REGISTRY, changed)
        self.write("docs/delivery/releases/1.7.2.json", {"version": "1.7.2"})
        head = self.commit("Apply reviewed version metadata")
        self.assertFalse(versions.plan(versions.Git(self.root), self.base, head)["hasChanges"])
        after_manifest = versions.manifest(versions.Git(self.root), head, "1.7.2")
        self.assertEqual(before_manifest["modules"]["api"]["versionDecisionFingerprint"],
                         after_manifest["modules"]["api"]["versionDecisionFingerprint"])

    def test_module_policy_change_is_visible_and_propagates(self):
        changed = registry()
        changed["modules"]["api"]["paths"].append("src/extra-api/")
        self.write(versions.REGISTRY, changed)
        head = self.commit("Extend API source scope")
        proposal = versions.plan(versions.Git(self.root), self.base, head)
        self.assertIn("module-policy-change", proposal["modules"]["api"]["reasons"])
        self.assertIn("dependency:api", proposal["modules"]["web"]["reasons"])
        self.assertEqual(proposal["modules"]["web"]["proposedVersion"], "1.7.2")

    def test_dependency_change_bumps_all_shared_consumers(self):
        package = json.loads((self.root / "package.json").read_text())
        package["dependencies"]["x"] = "2"
        self.write("package.json", package)
        head = self.commit("Change a real dependency")
        proposal = versions.plan(versions.Git(self.root), self.base, head)
        self.assertTrue(all(row["status"] == "bump-required" for row in proposal["modules"].values()))

    def test_explicit_major_does_not_infer_major_for_consumers(self):
        self.write("src/api/index.ts", "export const breakingApi = 2;\n")
        head = self.commit("Change API contract")
        proposal = versions.plan(versions.Git(self.root), self.base, head,
                                 changes={"schemaVersion": 1, "bumps": {"api": "major"}})
        self.assertEqual(proposal["modules"]["api"]["proposedVersion"], "2.0.0")
        self.assertEqual(proposal["modules"]["web"]["proposedVersion"], "1.7.2")

    def test_unaffected_override_and_regression_hold(self):
        self.write("docs/readme.md", "Documentation only\n")
        head = self.commit("Documentation change")
        with self.assertRaises(versions.VersionError):
            versions.plan(versions.Git(self.root), self.base, head,
                          changes={"schemaVersion": 1, "bumps": {"api": "major"}})
        changed = registry()
        changed["modules"]["web"]["version"] = "1.7.0"
        self.write(versions.REGISTRY, changed)
        head = self.commit("Invalid source version regression")
        with self.assertRaises(versions.VersionError):
            versions.plan(versions.Git(self.root), self.base, head)

    def test_apply_writes_only_catalog_and_has_no_git_or_release_side_effect(self):
        self.write("src/web/index.ts", "export const web = 2;\n")
        head = self.commit("Web implementation change")
        package_before = (self.root / "package.json").read_bytes()
        out = self.root / "proposal.json"
        self.assertEqual(versions.main(["--repo", str(self.root), "apply", "--base", self.base, "--head", head, "--output", str(out)]), 0)
        self.assertEqual(self.command("rev-parse", "HEAD"), head)
        self.assertEqual(self.command("diff", "--name-only"), versions.REGISTRY)
        self.assertEqual((self.root / "package.json").read_bytes(), package_before)
        self.assertEqual(json.loads((self.root / versions.REGISTRY).read_text())["modules"]["web"]["version"], "1.7.2")
        self.assertEqual(out.read_bytes(), versions.canonical(json.loads(out.read_bytes())) + b"\n")

    def test_apply_preserves_peer_registry_edits(self):
        self.write("src/web/index.ts", "export const web = 2;\n")
        head = self.commit("Web change")
        changed = registry()
        changed["modules"]["api"]["version"] = "2.0.0"
        self.write(versions.REGISTRY, changed)
        before = (self.root / versions.REGISTRY).read_bytes()
        with patch("sys.stderr", new=io.StringIO()):
            result = versions.main(["--repo", str(self.root), "apply", "--base", self.base, "--head", head])
        self.assertEqual(result, 1)
        self.assertEqual((self.root / versions.REGISTRY).read_bytes(), before)

    def test_bootstrap_records_initial_source_versions_without_legacy_claim(self):
        (self.root / versions.REGISTRY).unlink()
        no_catalog = self.commit("Synthetic pre-tracking fixture")
        self.write(versions.REGISTRY, registry())
        head = self.commit("Introduce source-module version tracking")
        proposal = versions.plan(versions.Git(self.root), no_catalog, head)
        self.assertTrue(proposal["bootstrap"])
        self.assertFalse(proposal["hasChanges"])
        self.assertTrue(all(row["previousVersion"] is None for row in proposal["modules"].values()))

    def test_unknown_identity_and_selected_symlink_hold(self):
        git = versions.Git(self.root)
        with self.assertRaises(versions.VersionError):
            versions.manifest(git, self.base, "9.9.9")
        with self.assertRaises(versions.VersionError):
            versions.manifest(git, self.base, "1.7.1", identities={"schemaVersion": 1, "modules": {"unknown": {}}})
        (self.root / "src/web/link.ts").symlink_to("../api/index.ts")
        head = self.commit("Synthetic unsupported source link")
        with self.assertRaises(versions.VersionError):
            versions.manifest(versions.Git(self.root), head, "1.7.1")


if __name__ == "__main__":
    unittest.main()
