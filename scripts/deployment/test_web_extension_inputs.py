"""Check the SDK prototype with real local Node resolution and synthetic tarballs."""

import base64
from copy import deepcopy
from hashlib import sha256, sha512
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import component_inputs as inputs
from test_component_inputs import fixture, rehash
import web_extension_inputs as extension


REPO = Path(__file__).resolve().parents[2]
VERSIONS = {"react": "19.3.1", "react-dom": "19.3.1", "scheduler": "0.28.0", "next": "16.4.6"}


def write(root, relative, raw):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path


def document(value):
    return json.dumps(value).encode()


def sdk_fixture(root, name):
    manifest = {"name": name, "version": extension.SDK_VERSION, "type": "module",
                "exports": {"." if name == "@ui-sdk/core" else "./primitive": "./entry.js"}}
    if name == "@ui-sdk/react":
        manifest["peerDependencies"] = extension.PEERS
    files = {"package.json": document(manifest), "entry.js": b'throw Error("package code must never run");\n'}
    archive = root / (name.split("/")[1] + ".tgz")
    with tarfile.open(archive, "w:gz") as target:
        for leaf, data in files.items():
            member = tarfile.TarInfo("package/" + leaf)
            member.size = len(data)
            target.addfile(member, io.BytesIO(data))
    return archive, files


class WebExtensionTests(unittest.TestCase):
    def setUp(self):
        self.private = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.app, self.web = (self.private / name for name in ("app", "web"))
        self.app.mkdir(mode=0o700)
        self.web.mkdir(mode=0o700)
        self.archives, self.pins = {}, {}
        for name in extension.SDK:
            archive, files = sdk_fixture(self.private, name)
            self.archives[name] = archive
            self.pins[name] = "sha512-" + base64.b64encode(sha512(archive.read_bytes()).digest()).decode()
            for leaf, data in files.items():
                write(self.web, f"node_modules/{name}/{leaf}", data)
        self.enterContext(patch.object(extension, "SDK", self.pins))
        self.manifest = {
            "name": "warpdrive", "packageManager": extension.MANAGER,
            "dependencies": {name: "^" + VERSIONS[name] for name in ("react", "react-dom", "next")},
            "devDependencies": {"@types/react": "^19.3.0"},
        }
        self.app_lock = {"packages": {name: [
            f"{name}@{version}", "", {}, "sha512-" + "a" * 86 + "==",
        ] for name, version in VERSIONS.items()}}
        versions = {**{name: extension.SDK_VERSION for name in self.pins}, "react": VERSIONS["react"],
                    "react-dom": VERSIONS["react-dom"]}
        self.sidecar = {"name": extension.ROOT_PACKAGE, "private": True, "type": "module",
                        "packageManager": extension.MANAGER, "dependencies": versions}
        self.sidecar_lock = {"lockfileVersion": 3, "configVersion": 1, "workspaces": {
            "": {"name": extension.ROOT_PACKAGE, "dependencies": versions},
        }, "packages": {
            **{name: self.app_lock["packages"][name] for name in ("react", "react-dom", "scheduler")},
            **{name: [f"{name}@{extension.SDK_VERSION}", "", {
                "peerDependencies": extension.PEERS, "optionalPeers": ["@types/react"],
            } if name == "@ui-sdk/react" else {}, pin] for name, pin in self.pins.items()},
        }}
        write(self.app, "package.json", document(self.manifest))
        write(self.web, "package.json", document(self.manifest))
        write(self.app, "bun.lock", document(self.app_lock))
        write(self.app, "bunfig.toml", b'[install]\nlinker = "hoisted"\n')
        write(self.app, "deploy/images/Dockerfile", b"FROM pinned-fixture\n")
        write(self.app, extension.MANIFEST, document(self.sidecar))
        write(self.app, extension.LOCK, document(self.sidecar_lock))
        for root in (self.app, self.web):
            for name, version in VERSIONS.items():
                write(root, f"node_modules/{name}/package.json",
                      document({"name": name, "version": version, "main": "index.js"}))
                write(root, f"node_modules/{name}/index.js", b'throw Error("must not load");\n')
            # Node ESM requires exported subpaths when they omit an extension.
            for name, subpath in (("react", "jsx-runtime"), ("react-dom", "client")):
                write(root, f"node_modules/{name}/package.json", document({
                    "name": name, "version": VERSIONS[name], "exports": {".": "./index.js", f"./{subpath}": f"./{subpath}.js"},
                }))
                write(root, f"node_modules/{name}/{subpath}.js", b'throw Error("must not load");\n')
        for path in ("dist/server/next.js", "dist/client/app-next.js"):
            write(self.web, f"node_modules/next/{path}", b'throw Error("must not load");\n')
        self.revision = self.commit()
        records = []
        for name in extension.ROOT_FILES:
            raw = (self.app / name).read_bytes()
            records.append({"path": name, "sha256": sha256(raw).hexdigest(), "bytes": len(raw)})
        self.receipt = {"inputPolicySha256": "a" * 64, "components": {
            name: {"componentInputSha256": digit * 64, "inputs": deepcopy(records)}
            for name, digit in zip(extension.RETAINED, "123")
        }}

    def git(self, *arguments):
        return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *arguments],
                                       cwd=self.app, timeout=5, stderr=subprocess.DEVNULL).decode().strip()

    def commit(self):
        self.git("init", "-q")
        self.git("add", "package.json", "bun.lock", "bunfig.toml", "deploy", "tools")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture")
        return self.git("rev-parse", "HEAD")

    def verify(self, *, current=None):
        with (
            patch("component_inputs.validate_receipt", return_value=self.receipt),
            patch("component_inputs.verify_current", return_value=self.receipt if current is None else current) as discover,
        ):
            result = extension.verify_web_extension_inputs(
                self.app, expected_revision=self.revision, retained_receipt=self.receipt,
                current_receipt=self.receipt if current is None else current, web_root=self.web, sdk_archives=self.archives,
            )
            discover.assert_called_once_with(self.app, self.receipt if current is None else current,
                                             expected_revision=self.revision)
            return result

    def functional_fixture(self):
        original = fixture(self.app)
        paths = [*extension.ROOT_FILES, *original["policy"]["sharedFiles"]]
        original["policy"]["sharedFiles"] = sorted(paths)
        for component in original["components"].values():
            component["inputs"].extend({"path": name, "sha256": sha256((self.app / name).read_bytes()).hexdigest(),
                                        "bytes": (self.app / name).stat().st_size} for name in extension.ROOT_FILES)
            component["inputs"].sort(key=lambda item: item["path"])
        rehash(original)
        # The actual admitted active Web source can predate the SDK-only recipe.
        self.git("add", "src", "scripts")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Backend baseline")
        baseline = self.git("rev-parse", "HEAD")
        write(self.app, extension.WEB_RECIPE, (REPO / extension.WEB_RECIPE).read_bytes())
        self.git("add", extension.WEB_RECIPE)
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Reviewed Web recipe")
        candidate = self.git("rev-parse", "HEAD")
        pins = {name: (self.git("rev-parse", f"{candidate}:{name}"), sha256((self.app / name).read_bytes()).hexdigest())
                for name in (extension.WEB_RECIPE, extension.MANIFEST, extension.LOCK)}
        for name in ("bun.lock", "bunfig.toml"):
            write(self.web, name, (self.app / name).read_bytes())
        self.enterContext(patch.object(extension, "REVIEWED_WEB_INPUTS", pins))
        projected = {**original, "components": {name: original["components"][name] for name in extension.RETAINED}}
        discover = inputs._discover

        def capture(arguments, root, environment, **limits):
            if arguments[:2] == ["node", "--input-type=module"]:
                self.assertEqual(root, self.app)
                return inputs.canonical(projected)
            return discover(arguments, root, environment, **limits)

        self.enterContext(patch.object(inputs, "_discover", side_effect=capture))
        return {"expected_revision": candidate, "expected_baseline_revision": baseline, "retained_receipt": original,
                "expected_retained_sha256": inputs.content_hash(original), "web_root": self.web, "sdk_archives": self.archives}, projected

    @unittest.skipUnless(shutil.which("node"), "Native Node resolver required")
    def test_functional_candidate_binds_fresh_backend_ancestry_recipe_and_private_projection(self):
        options, projected = self.functional_fixture()
        result = extension.verify_web_extension_candidate(self.app, **options)
        self.assertEqual(result["kind"], "warpdrive-web-extension-candidate-inputs")
        self.assertEqual(result["sourceRevision"], options["expected_revision"])
        self.assertEqual(result["baselineRevision"], options["expected_baseline_revision"])
        self.assertEqual(result["retainedBackendInputsSha256"], inputs.content_hash(projected))
        self.assertEqual(result["webRecipe"]["gitBlob"], extension.REVIEWED_WEB_INPUTS[extension.WEB_RECIPE][0])
        self.assertEqual(result["originalBackendReceiptSha256"], options["expected_retained_sha256"])
        self.assertFalse(result["buildIntegrationQualified"])
        self.assertFalse(result["deploymentAuthorized"])
        write(self.web, "bun.lock", b"private projection lock changed")
        with self.assertRaisesRegex(extension.WebExtensionInputError, "Projected app manifest or locked configuration"):
            extension.verify_web_extension_candidate(self.app, **options)

    def test_functional_candidate_denies_wrong_recipe_and_original_backend_digest(self):
        options, _ = self.functional_fixture()
        with self.assertRaisesRegex(inputs.InputError, "admitted digest"):
            extension.verify_web_extension_candidate(self.app, **{**options, "expected_retained_sha256": "0" * 64})
        self.git("update-index", "--assume-unchanged", extension.WEB_RECIPE)
        recipe = self.app / extension.WEB_RECIPE
        recipe.write_bytes(recipe.read_bytes() + b"# same git index, changed effective recipe\n")
        with self.assertRaisesRegex(extension.WebExtensionInputError, "differs from the reviewed source"):
            extension.verify_web_extension_candidate(self.app, **options)

    def test_functional_candidate_requires_externally_pinned_ancestor(self):
        options, _ = self.functional_fixture()
        with self.assertRaisesRegex(extension.WebExtensionInputError, "Distinct exact"):
            extension.verify_web_extension_candidate(self.app, **{**options, "expected_baseline_revision": options["expected_revision"]})
        with self.assertRaises(inputs.InputError):
            extension.verify_web_extension_candidate(self.app, **{**options, "expected_baseline_revision": "0" * 40})

    @unittest.skipUnless(shutil.which("node"), "Native Node resolver required")
    def test_verifies_actual_files_and_physical_singletons_without_loading_package_code(self):
        result = self.verify()
        self.assertFalse(result["buildIntegrationQualified"])
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(result["observedSharedRuntimeVersions"], VERSIONS)
        self.assertEqual({name: value["integrity"] for name, value in result["sdk"].items()}, self.pins)
        self.assertEqual([item["path"] for item in result["extensionInputs"]], [extension.MANIFEST, extension.LOCK])
        self.assertEqual(result, self.verify())

    @unittest.skipUnless(shutil.which("node"), "Native Node resolver required")
    def test_same_version_nested_react_and_next_client_shadow_are_rejected(self):
        for parent in ("@ui-sdk/react", "next/dist/client"):
            with self.subTest(parent=parent):
                nested = self.web / f"node_modules/{parent}/node_modules/react"
                shutil.copytree(self.web / "node_modules/react", nested)
                try:
                    with self.assertRaises((inputs.InputError, extension.WebExtensionInputError)):
                        self.verify()
                finally:
                    shutil.rmtree(nested.parent)

    def test_source_blob_and_backend_input_changes_are_rejected(self):
        current = deepcopy(self.receipt)
        current["components"]["worker"]["inputs"].append({"path": extension.MANIFEST, "sha256": "a" * 64, "bytes": 12})
        with self.assertRaisesRegex(extension.WebExtensionInputError, "backend input"):
            self.verify(current=current)
        self.git("update-index", "--assume-unchanged", extension.MANIFEST)
        write(self.app, extension.MANIFEST, document(self.sidecar) + b" ")
        with self.assertRaisesRegex(inputs.InputError, "identity or byte count"):
            self.verify()

    def test_tampered_extra_and_symlink_installed_sdk_members_are_rejected(self):
        leaf = self.web / "node_modules/@ui-sdk/core/entry.js"
        original = leaf.read_bytes()
        leaf.write_bytes(b"tamper")
        with self.assertRaisesRegex(extension.WebExtensionInputError, "Installed SDK bytes"):
            self.verify()
        leaf.write_bytes(original)
        extra = leaf.with_name("extra.js")
        extra.symlink_to(leaf)
        with self.assertRaisesRegex(extension.WebExtensionInputError, "symlink"):
            self.verify()
        extra.unlink()
        archive = self.archives["@ui-sdk/core"]
        archive.write_bytes(archive.read_bytes() + b"tamper")
        with self.assertRaisesRegex(extension.WebExtensionInputError, "SHA-512 integrity"):
            self.verify()

    def test_strict_frozen_sdk_lock_and_shared_resolution(self):
        lock = deepcopy(self.sidecar_lock)
        lock["packages"]["react-dom"][-1] = "sha512-" + "b" * 86 + "=="
        with self.assertRaisesRegex(extension.WebExtensionInputError, "shared React runtime"):
            extension.dependency_policy(self.manifest, self.app_lock, self.sidecar, lock)
        lock = deepcopy(self.sidecar_lock)
        lock["packages"]["@ui-sdk/react/react"] = lock["packages"]["react"]
        with self.assertRaisesRegex(extension.WebExtensionInputError, "nested dependency"):
            extension.dependency_policy(self.manifest, self.app_lock, self.sidecar, lock)
        self.assertEqual(extension.lock_object(b'{"value":"keep,}",}'), {"value": "keep,}"})
        with self.assertRaises(inputs.InputError):
            extension.lock_object(b'{"key": 1,"key": 2,}')


if __name__ == "__main__":
    unittest.main()
