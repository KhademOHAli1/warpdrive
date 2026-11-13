import copy
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from candidate import CandidateError, create_candidate
import component_inputs as inputs
from test_candidate import SHA, fixture as smoke_fixture
from test_component_inputs import fixture as legacy_input_fixture, rehash as rehash_legacy
from web_build_context import prepare_context
from web_extension_inputs import REVIEWED_WEB_INPUTS
from web_release_inputs import _tree
import web_sdk_full_receipt as receipt


REPOSITORY = Path(__file__).resolve().parents[2]
SWITCH = "src/components/ui/Switch.tsx"
SWITCH_IMPORT = "@ui-sdk/react/switch"
CHECKBOX = "src/components/ui/Checkbox.tsx"
COMBOBOX = "src/components/ui/SdkCombobox.tsx"
CONTROL_BINDINGS = {
    CHECKBOX: ("@ui-sdk/react/checkbox", ("Checkbox",)),
    COMBOBOX: ("@ui-sdk/react/combobox", ("Combobox", "ComboboxContent", "ComboboxEmpty", "ComboboxInput",
                                         "ComboboxItem", "ComboboxList", "ComboboxTrigger")),
}


def rehash(value):
    web = value["web"]
    web["inputSha256"] = inputs.content_hash({key: child for key, child in web.items() if key != "inputSha256"})
    return value


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.owned = Path(directory.name).resolve()
        self.root = self.owned / "checkout"
        self.root.mkdir()
        self.legacy = legacy_input_fixture(self.root)
        self.legacy["context"]["baseImage"] = receipt.BASE_IMAGE
        rehash_legacy(self.legacy)
        backend = {**self.legacy, "components": {name: self.legacy["components"][name] for name in receipt.BACKEND}}
        self.value = rehash({
            "schemaVersion": 1, "kind": receipt.KIND, "sourceRevision": SHA, "backendInputs": backend,
            "deploymentAuthorized": False,
            "web": {"profile": receipt.PROFILE, "context": copy.deepcopy(backend["context"]),
                    "gitInventorySha256": "a" * 64, "pinnedInputs": {
                        path: {"gitBlob": blob, "sha256": digest, "bytes": (REPOSITORY / path).stat().st_size}
                        for path, (blob, digest) in REVIEWED_WEB_INPUTS.items()
                    }, "helperEntries": copy.deepcopy(backend["policy"]["entries"]["web"]),
                    "helperGraphInputs": ["src/web.ts"], "staticWebInputCount": 2,
                    "sdkImports": {"src/ui.tsx": ["@ui-sdk/react/menu"]}},
        })

    def test_projects_native_full_candidate_and_keeps_legacy_input_policy_unchanged(self):
        report, images = smoke_fixture()
        legacy = create_candidate(SHA, report, "a" * 64, images, input_receipt=self.legacy)
        self.assertEqual(legacy["schemaVersion"], 2)
        images["web"]["Config"].update(
            Env=[f"APP_COMMIT={SHA}", f"NEXT_DEPLOYMENT_ID=wd-{SHA}", "APP_VERSION="],
            Cmd=["bun", "--bun", "next", "start"], WorkingDir="/app",
        )
        images["web"]["Config"]["Labels"]["org.opencontainers.image.title"] = "Warpdrive Web"
        candidate = receipt.create_web_sdk_full_candidate(SHA, report, "a" * 64, images, input_receipt=self.value)
        self.assertEqual(candidate["schemaVersion"], 3)
        self.assertEqual(candidate["releaseRevision"], SHA)
        self.assertFalse(candidate["deploymentAuthorized"])
        for name in receipt.BACKEND:
            self.assertEqual(candidate["components"][name], legacy["components"][name])
        provenance = candidate["inputProvenance"]
        self.assertEqual(provenance["receiptSha256"], inputs.content_hash(self.value))
        self.assertEqual(candidate["components"]["web"]["inputSha256"], self.value["web"]["inputSha256"])
        self.assertEqual(candidate["components"]["web"]["inputPolicySha256"], provenance["webInputPolicySha256"])
        self.assertNotEqual(provenance["webInputPolicySha256"], provenance["backendInputPolicySha256"])
        report["success"] = False
        with self.assertRaisesRegex(CandidateError, "smoke did not succeed"):
            receipt.create_web_sdk_full_candidate(SHA, report, "a" * 64, images, input_receipt=self.value)
        report["success"] = True
        images["web"]["Config"]["Env"].append("APP_VERSION=alternate")
        with self.assertRaisesRegex(CandidateError, "APP_VERSION differs"):
            receipt.create_web_sdk_full_candidate(SHA, report, "a" * 64, images, input_receipt=self.value)

    def test_rejects_self_consistent_metadata_with_wrong_scope(self):
        for mutate in (
            lambda value: value.update(schemaVersion=True),
            lambda value: value.update(sourceRevision="2" * 40),
            lambda value: value.update(deploymentAuthorized=True),
            lambda value: value["backendInputs"]["components"].update(web=self.legacy["components"]["web"]),
            lambda value: value["web"]["pinnedInputs"][receipt.RECIPE].update(gitBlob="a" * 40),
            lambda value: value["web"]["context"]["buildArgs"].update(APP_VERSION="changed"),
            lambda value: value["web"].update(staticWebInputCount=True),
            lambda value: value["web"].update(sdkImports={"src/ui.tsx": ["@ui-sdk/react/unknown"]}),
            lambda value: value["web"].update(sdkImports={"src/worker.ts": ["@ui-sdk/react/menu"]}),
            lambda value: value["web"].update(sdkImports={"src/web.ts": ["@ui-sdk/react/menu"]}),
            lambda value: value["web"].update(helperGraphInputs=["../escape"]),
        ):
            bad = copy.deepcopy(self.value)
            mutate(bad)
            with self.subTest(mutation=bad["web"]["inputSha256"]), self.assertRaises(inputs.InputError):
                receipt.validate_web_sdk_full_receipt(rehash(bad), expected_revision=SHA)

    def _successor(self):
        value = copy.deepcopy(self.value)
        value["schemaVersion"] = 2
        value["web"].update(
            staticWebInputCount=3, importPolicySha256=receipt.IMPORT_POLICY_SHA,
            sdkBindings={
                "src/ui.tsx": [{"specifier": "@ui-sdk/react/menu", "exported": "Menu", "local": "Menu"}],
                SWITCH: [{"specifier": SWITCH_IMPORT, "exported": "Switch", "local": "SdkSwitch"},
                         {"specifier": SWITCH_IMPORT, "exported": "SwitchThumb", "local": "SwitchThumb"}],
            },
        )
        value["web"]["sdkImports"][SWITCH] = [SWITCH_IMPORT]
        return rehash(value)

    def test_versioned_binding_proof_preserves_legacy_receipts_and_backend_provenance(self):
        successor = self._successor()
        self.assertIs(receipt.validate_web_sdk_full_receipt(self.value, expected_revision=SHA), self.value)
        self.assertIs(receipt.validate_web_sdk_full_receipt(successor, expected_revision=SHA), successor)
        legacy = receipt.candidate_input_facts(self.value, expected_revision=SHA)
        current = receipt.candidate_input_facts(successor, expected_revision=SHA)
        for name in receipt.BACKEND:
            self.assertEqual(legacy["components"][name], current["components"][name])
        self.assertNotEqual(legacy["components"]["web"], current["components"]["web"])

    def test_versioned_proof_rejects_rehashed_receipt_tampering(self):
        for mutate in (
            lambda value: value.update(schemaVersion=1),
            lambda value: value["web"].update(importPolicySha256="a" * 64),
            lambda value: value["web"]["sdkBindings"].pop(SWITCH),
            lambda value: value["web"]["sdkImports"][SWITCH].append("@ui-sdk/react/menu"),
            lambda value: value["web"]["sdkBindings"][SWITCH][0].update(exported="createSwitchController"),
            lambda value: value["web"]["sdkBindings"][SWITCH][0].update(local="SwitchThumb"),
            lambda value: value["web"]["sdkBindings"][SWITCH][0].update(exported="SwitchThumb"),
            lambda value: value["web"]["sdkBindings"]["src/ui.tsx"].append(value["web"]["sdkBindings"][SWITCH][0]),
            lambda value: value["web"]["helperGraphInputs"].append(SWITCH),
        ):
            bad = self._successor()
            mutate(bad)
            with self.subTest(mutation=bad["web"]["inputSha256"]), self.assertRaises(inputs.InputError):
                receipt.validate_web_sdk_full_receipt(rehash(bad), expected_revision=SHA)

    def _controls(self, *paths, with_switch=False):
        value = self._successor()
        value["schemaVersion"] = 3
        web = value["web"]
        web["importPolicySha256"] = receipt.CONTROLS_IMPORT_POLICY_SHA
        if not with_switch:
            web["sdkImports"].pop(SWITCH)
            web["sdkBindings"].pop(SWITCH)
        for path in paths:
            specifier, names = CONTROL_BINDINGS[path]
            web["sdkImports"][path] = [specifier]
            web["sdkBindings"][path] = [{"specifier": specifier, "exported": name, "local": name} for name in names]
        web["staticWebInputCount"] = len(web["sdkImports"]) + 1
        return rehash(value)

    def test_controls_proof_admits_either_or_both_without_changing_legacy_policy(self):
        old = self._successor()
        self.assertEqual(old["web"]["importPolicySha256"], receipt.IMPORT_POLICY_SHA)
        for controls in ((CHECKBOX,), (COMBOBOX,), (CHECKBOX, COMBOBOX)):
            for with_switch in (False, True):
                with self.subTest(controls=controls, with_switch=with_switch):
                    value = self._controls(*controls, with_switch=with_switch)
                    self.assertIs(receipt.validate_web_sdk_full_receipt(value, expected_revision=SHA), value)
                    current = receipt.candidate_input_facts(value, expected_revision=SHA)
                    previous = receipt.candidate_input_facts(old, expected_revision=SHA)
                    self.assertNotEqual(current["components"]["web"], previous["components"]["web"])
                    for name in receipt.BACKEND:
                        self.assertEqual(current["components"][name], previous["components"][name])

    def test_controls_proof_rejects_other_paths_partial_symbols_and_backend_inputs(self):
        for mutate in (
            lambda value: value.update(schemaVersion=2),
            lambda value: value["web"].update(importPolicySha256=receipt.IMPORT_POLICY_SHA),
            lambda value: value["web"]["sdkBindings"][COMBOBOX].pop(),
            lambda value: value["web"]["sdkBindings"][COMBOBOX][0].update(exported="ComboboxGroup"),
            lambda value: value["web"]["sdkBindings"][CHECKBOX][0].update(exported="CheckboxIndicator"),
            lambda value: value["web"]["helperGraphInputs"].append(CHECKBOX),
            lambda value: value["web"]["sdkBindings"].update({"src/features/quick-add/GlobalNoteModal.tsx":
                                                               value["web"]["sdkBindings"].pop(COMBOBOX)}),
        ):
            bad = self._controls(CHECKBOX, COMBOBOX)
            mutate(bad)
            with self.subTest(mutation=mutate), self.assertRaises(inputs.InputError):
                receipt.validate_web_sdk_full_receipt(rehash(bad), expected_revision=SHA)
        with self.assertRaisesRegex(inputs.InputError, "canonical SDK control proof"):
            receipt.validate_web_sdk_full_receipt(self._controls(with_switch=True), expected_revision=SHA)
        bad = self._controls(CHECKBOX)
        backend = bad["backendInputs"]
        worker = backend["components"]["worker"]
        worker["inputs"].append({"path": CHECKBOX, "bytes": 1, "sha256": "0" * 64})
        worker["inputs"].sort(key=lambda row: row["path"])
        rehash_legacy(backend)
        with self.assertRaisesRegex(inputs.InputError, "isolated Web profile"):
            receipt.validate_web_sdk_full_receipt(rehash(bad), expected_revision=SHA)

    def test_controls_dialog_backdrop_requires_v3_and_the_reviewed_wrapper(self):
        for version, path in ((2, "src/components/ui/SdkDialog.tsx"), (3, "src/components/ui/SdkDialog.tsx"),
                              (3, "src/components/ui/OtherDialog.tsx")):
            value = self._successor() if version == 2 else self._controls(COMBOBOX)
            value["web"]["sdkImports"][path] = ["@ui-sdk/react/dialog"]
            value["web"]["sdkBindings"][path] = [{"specifier": "@ui-sdk/react/dialog", "exported": "DialogBackdrop",
                                                 "local": "DialogBackdrop"}]
            value["web"]["staticWebInputCount"] += 1
            if version == 3 and path == "src/components/ui/SdkDialog.tsx":
                self.assertIs(receipt.validate_web_sdk_full_receipt(rehash(value), expected_revision=SHA), value)
            else:
                with self.assertRaisesRegex(inputs.InputError, "exceeds the reviewed public import policy"):
                    receipt.validate_web_sdk_full_receipt(rehash(value), expected_revision=SHA)

    def _git(self, *args):
        return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=self.root,
                                       env={"PATH": os.environ["PATH"], "GIT_CONFIG_NOSYSTEM": "1",
                                            "GIT_CONFIG_GLOBAL": "/dev/null"}, timeout=10).strip()

    def _build_context(self, *, historical=False, controls=False):
        for path in REVIEWED_WEB_INPUTS:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPOSITORY / path, target)
        for path in set(receipt.SCANNER_FILES) - inputs.POLICY_SOURCES:
            if historical and path in {receipt.IMPORT_POLICY, receipt.IMPORT_SCANNER}:
                continue
            if path == receipt.IMPORT_POLICY:
                shutil.copyfile(REPOSITORY / path, self.root / path)
            else:
                (self.root / path).write_text("// fixture scanner path\n")
        if controls:
            path = receipt.CONTROLS_IMPORT_POLICY
            shutil.copyfile(REPOSITORY / path, self.root / path)
        (self.root / "src/ui.tsx").write_text("export const fixture = true;\n")
        (self.root / ".dockerignore").write_text("node_modules\n")
        self._git("init", "--quiet")
        self._git("config", "user.name", "Fixture")
        self._git("config", "user.email", "fixture@example.invalid")
        self._git("add", "--all")
        self._git("commit", "--quiet", "--no-gpg-sign", "-m", "fixture source")
        revision = self._git("rev-parse", "HEAD").decode()
        self.value["sourceRevision"] = revision
        self.value["web"]["gitInventorySha256"] = inputs.content_hash(
            {path: list(row) for path, row in _tree(self.root, revision).items()})
        rehash(self.value)
        context = self.owned / "web-context"
        prepare_context(self.root, revision, context)
        return revision, context

    def test_exact_recipe_staged_context_and_raw_source_are_required_for_build_verification(self):
        revision, context = self._build_context()
        original = inputs._discover

        def controlled_discovery(arguments, *args, **kwargs):
            if arguments[:1] == ["node"]:
                self.assertEqual(arguments[-5:], [revision, receipt.BASE_IMAGE, "linux/amd64", "", "same-origin"])
                return inputs.canonical(self.value)
            return original(arguments, *args, **kwargs)

        with patch.object(inputs, "_discover", side_effect=controlled_discovery):
            self.assertIs(receipt.verify_current_web_sdk_full_receipt(
                self.root, self.value, expected_revision=revision, web_context=context), self.value)
            (context / receipt.RECIPE).write_text("FROM wrong\n")
            with self.assertRaisesRegex(ValueError, "context bytes differ"):
                receipt.verify_current_web_sdk_full_receipt(
                    self.root, self.value, expected_revision=revision, web_context=context)

    def test_current_verification_refuses_different_fresh_discovery_and_hidden_tooling_changes(self):
        revision, context = self._build_context()
        original = inputs._discover
        fresh = copy.deepcopy(self.value)
        fresh["web"]["sdkImports"] = {}
        rehash(fresh)

        def controlled_discovery(arguments, *args, **kwargs):
            if arguments[:1] == ["node"]:
                return inputs.canonical(fresh)
            return original(arguments, *args, **kwargs)

        with patch.object(inputs, "_discover", side_effect=controlled_discovery):
            with self.assertRaisesRegex(inputs.InputError, "Fresh SDK Web or backend input discovery differs"):
                receipt.verify_current_web_sdk_full_receipt(
                    self.root, self.value, expected_revision=revision, web_context=context)
        self._git("update-index", "--assume-unchanged", receipt.SCAN)
        (self.root / receipt.SCAN).write_text("// hidden tooling change\n")
        with self.assertRaisesRegex(inputs.InputError, "scanner differs from selected Git bytes"):
            receipt.verify_current_web_sdk_full_receipt(self.root, self.value, expected_revision=revision)

    def test_discovery_binds_the_requested_context_and_checks_source_before_starting_node(self):
        revision, _ = self._build_context()
        original = inputs._discover
        build_args = {"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"}
        result = copy.deepcopy(self.value)

        def controlled_discovery(arguments, *args, **kwargs):
            if arguments[:1] == ["node"]:
                return inputs.canonical(result)
            return original(arguments, *args, **kwargs)

        def discover(args):
            return receipt.discover_web_sdk_full_receipt(
                self.root, expected_revision=revision, base_image=receipt.BASE_IMAGE,
                platform="linux/amd64", build_args=args)

        with patch.object(inputs, "_discover", side_effect=controlled_discovery) as command:
            self.assertEqual(discover(build_args), result)
            with self.assertRaisesRegex(inputs.InputError, "returned a different build context"):
                discover({**build_args, "APP_VERSION": "different"})
            self._git("update-index", "--assume-unchanged", receipt.SCAN)
            (self.root / receipt.SCAN).write_text("// hidden scanner edit\n")
            command.reset_mock()
            with self.assertRaisesRegex(inputs.InputError, "scanner differs from selected Git bytes"):
                discover(build_args)
            self.assertFalse(any(call.args[0][0] == "node" for call in command.call_args_list))

    def test_original_v1_source_does_not_require_successor_scanner_files(self):
        revision, context = self._build_context(historical=True)
        original = inputs._discover

        def controlled_discovery(arguments, *args, **kwargs):
            if arguments[:1] == ["node"]:
                return inputs.canonical(self.value)
            return original(arguments, *args, **kwargs)

        with patch.object(inputs, "_discover", side_effect=controlled_discovery):
            self.assertIs(receipt.verify_current_web_sdk_full_receipt(
                self.root, self.value, expected_revision=revision, web_context=context), self.value)

    def test_edited_import_policy_is_refused_before_discovery(self):
        revision, _ = self._build_context()
        self._git("update-index", "--assume-unchanged", receipt.IMPORT_POLICY)
        (self.root / receipt.IMPORT_POLICY).write_text("{}\n")
        with self.assertRaisesRegex(inputs.InputError, "Reviewed Web SDK import policy differs"):
            receipt.discover_web_sdk_full_receipt(
                self.root, expected_revision=revision, base_image=receipt.BASE_IMAGE,
                platform="linux/amd64", build_args={"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"},
            )

    def test_controls_policy_must_be_exact_before_current_discovery(self):
        revision, _ = self._build_context(controls=True)
        path = receipt.CONTROLS_IMPORT_POLICY
        self._git("update-index", "--assume-unchanged", path)
        (self.root / path).write_text("{}\n")
        with self.assertRaisesRegex(inputs.InputError, "Reviewed Web SDK import policy differs"):
            receipt.discover_web_sdk_full_receipt(
                self.root, expected_revision=revision, base_image=receipt.BASE_IMAGE,
                platform="linux/amd64", build_args={"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"},
            )

    def test_prepare_writes_the_exact_context_receipt_and_never_overwrites(self):
        revision, _ = self._build_context()
        original = inputs._discover

        def controlled_discovery(arguments, *args, **kwargs):
            if arguments[:1] == ["node"]:
                return inputs.canonical(self.value)
            return original(arguments, *args, **kwargs)

        context, output = self.owned / "staged-context", self.owned / "component-inputs.json"
        with patch.object(inputs, "_discover", side_effect=controlled_discovery):
            self.assertEqual(receipt.main(["prepare", "--root", str(self.root), "--revision", revision,
                                           "--context", str(context), "--output", str(output)]), 0)
        self.assertEqual(inputs.load_receipt(output), self.value)
        self.assertEqual((context / receipt.RECIPE).read_bytes(), (self.root / receipt.RECIPE).read_bytes())
        with self.assertRaisesRegex(ValueError, "fresh canonical output"):
            receipt.prepare_web_sdk_full_release(self.root, revision, self.owned / "unused-context", output)


if __name__ == "__main__":
    unittest.main()
