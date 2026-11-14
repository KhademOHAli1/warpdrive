"""Pure composition tests; synthetic native-check rows are NOT qualification.

No Docker daemon, service, browser, publication API or subprocess is used. The
optional real-metadata case requires two explicitly supplied local receipt paths;
their known custody hashes are checked before parsing. It still proves only the
comparison's output, not authentication, discovery or backend compatibility.
"""

from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import component_inputs as inputs
from installed_web_backend import process_witness
import installed_web_sdk_admission as admission
import installed_web_sdk_runtime as runtime
from test_component_inputs import fixture as input_fixture, rehash as rehash_inputs
from test_installed_web_backend import process
from test_web_rollout import slot
from test_web_sdk_archive import image_fixture, sdk_input_fixture
import web_sdk_full_receipt as sdk


REVISION = "1" * 40
ORIGINAL_REVISION = "2" * 40
REAL_ORIGINAL_REVISION = "6b24e23cffb32c09089d7020252cc787e3b5bf51"
REAL_CURRENT_REVISION = "5fc628b7af4bfc4ca17e300233a2039346a1218c"
REAL_ORIGINAL_RAW_SHA = "f5b5d3d612b70e9c85c7309a7542ea4891966539972419a43a77761e6b491730"
# The actual current receipt hash is supplied separately by root for the optional
# real comparison; it is not inferred from its sourceRevision field.
CHECKBOX = "src/components/ui/Checkbox.tsx"


def encoded(value):
    return inputs.canonical(value)


def raw_hash(raw):
    return sha256(raw).hexdigest()


def sdk_controls_fixture(root):
    """Extend the reviewed archive fixture to actual controls receipt schema3."""
    value = sdk_input_fixture(root)
    value["schemaVersion"] = 3
    web = value["web"]
    web["importPolicySha256"] = sdk.CONTROLS_IMPORT_POLICY_SHA
    web["sdkImports"][CHECKBOX] = ["@ui-sdk/react/checkbox"]
    web["sdkBindings"] = {
        "src/ui.tsx": [{"specifier": "@ui-sdk/react/menu", "exported": "Menu", "local": "Menu"}],
        CHECKBOX: [{"specifier": "@ui-sdk/react/checkbox", "exported": "Checkbox", "local": "Checkbox"}],
    }
    web["staticWebInputCount"] = 3
    web["inputSha256"] = inputs.content_hash({key: child for key, child in web.items() if key != "inputSha256"})
    return value


def original_fixture(root):
    value = input_fixture(root)
    value["context"]["baseImage"] = sdk.BASE_IMAGE
    return rehash_inputs(value)


def accepted_chain_fixture():
    """Native-shaped accepted slots; no controller or acceptance run occurs."""
    active, previous = slot("1", "a", "a"), slot("2", "b", "b")
    def generation(item, alias, digit):
        return {"slot": item, "alias": alias, "receiptSha256": digit * 64,
                "provenance": {"repository": "KhademOHAli1/warpdrive",
                    "revision": item["runtime"]["sourceRevision"], "manifestSha256": digit * 64,
                    "archiveSha256": digit * 64, "testedConfigDigest": "sha256:" + digit * 64,
                    "authoritySha256": digit * 64}}
    return {"targetKey": "installed", "backendFingerprint": "3" * 64,
            "acceptedOperationId": "synthetic-prior-reapply", "acceptedPlanSha256": "4" * 64,
            "active": generation(active, "synthetic-web-active", "5"),
            "previous": generation(previous, "synthetic-web-previous", "6")}


class FakeDocker:
    """Only the exact existing inspect API is available; never runs Docker."""
    def __init__(self, row):
        self.row = deepcopy(row)
        self.calls = []

    def inspect(self, identifier):
        self.calls.append(identifier)
        if identifier != self.row["Id"]:
            raise AssertionError("Unexpected fixture inspect target")
        return deepcopy(self.row)


class BackendComparisonTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        self.current = sdk_controls_fixture(self.root / "current")
        self.original = original_fixture(self.root / "original")

    def compare(self, current=None, original=None, **pins):
        current = self.current if current is None else current
        original = self.original if original is None else original
        options = {"expected_sdk_sha256": inputs.content_hash(current),
                   "expected_original_sha256": inputs.content_hash(original),
                   "original_revision": ORIGINAL_REVISION}
        return admission.compare_backend_inputs(current, original, **(options | pins))

    def test_real_validators_accept_complete_sdk3_and_full_original_without_granting_reuse(self):
        # In particular, do not mock away validate_web_sdk_full_receipt's required
        # expected_revision keyword or its real controls-policy validation.
        before = deepcopy((self.current, self.original))
        result = self.compare()
        self.assertTrue(result["allInputsEqual"])
        self.assertFalse(result["runtimeCompatibilityQualified"])
        self.assertFalse(result["deploymentAuthorized"])
        self.assertEqual(set(result["components"]), set(admission.RETAINED))
        self.assertEqual(result["sourceRevision"], REVISION)
        self.assertEqual(result["originalBackendRevision"], ORIGINAL_REVISION)
        self.assertEqual(result["contextSha256"], inputs.content_hash(self.original["context"]))
        self.assertEqual((self.current, self.original), before)

    def test_wrong_independent_receipt_pins_and_nonrevision_original_are_rejected(self):
        for pins in ({"expected_sdk_sha256": "0" * 64}, {"expected_original_sha256": "0" * 64},
                     {"expected_sdk_sha256": True}, {"expected_original_sha256": "A" * 64},
                     {"original_revision": "main"}, {"original_revision": True}):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                self.compare(**pins)

    def test_incomplete_original_and_corrupt_or_wrong_scope_current_cannot_be_rehashed_in(self):
        original = deepcopy(self.original)
        original["components"].pop("web")
        with self.assertRaises(ValueError):
            self.compare(original=original)
        mutations = (
            lambda row: row.update(sourceRevision="main"),
            lambda row: row.update(deploymentAuthorized=True),
            lambda row: row["backendInputs"]["components"].pop("worker"),
            lambda row: row["backendInputs"]["components"]["worker"].update(componentInputSha256="0" * 64),
            lambda row: row["web"]["sdkBindings"][CHECKBOX][0].update(exported="CheckboxIndicator"),
        )
        for mutate in mutations:
            row = deepcopy(self.current)
            mutate(row)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.compare(current=row)

    def test_valid_but_different_context_or_policy_is_not_qualified_inequality(self):
        original = deepcopy(self.original)
        original["context"]["buildArgs"]["APP_VERSION"] = "different-semantic-version"
        rehash_inputs(original)
        with self.assertRaisesRegex(ValueError, "context or input policy changed"):
            self.compare(original=original)
        original = deepcopy(self.original)
        original["policy"]["esbuild"] = {"syntheticSemanticChange": True}
        rehash_inputs(original)
        with self.assertRaisesRegex(ValueError, "context or input policy changed"):
            self.compare(original=original)

    def test_changed_backend_source_is_reported_and_never_itself_accepted(self):
        current = deepcopy(self.current)
        record = next(row for row in current["backendInputs"]["components"]["worker"]["inputs"]
                      if row["path"] == "src/worker.ts")
        record["sha256"] = "e" * 64
        rehash_inputs(current["backendInputs"])
        result = self.compare(current=current)
        self.assertFalse(result["allInputsEqual"])
        self.assertFalse(result["components"]["worker"]["completeRecordsEqual"])
        self.assertNotEqual(result["components"]["worker"]["originalInputSha256"],
                            result["components"]["worker"]["currentInputSha256"])
        self.assertTrue(result["components"]["realtime"]["completeRecordsEqual"])
        self.assertFalse(result["runtimeCompatibilityQualified"])
        self.assertFalse(result["deploymentAuthorized"])

    def test_complete_record_difference_is_not_hidden_by_equal_component_input_hash(self):
        current = deepcopy(self.current)
        current["backendInputs"]["components"]["worker"]["limitations"].append("Additional synthetic source limitation")
        result = self.compare(current=current)
        worker = result["components"]["worker"]
        self.assertEqual(worker["originalInputSha256"], worker["currentInputSha256"])
        self.assertNotEqual(worker["originalRecordSha256"], worker["currentRecordSha256"])
        self.assertFalse(worker["completeRecordsEqual"])
        self.assertFalse(result["allInputsEqual"])


class EngineWitnessTests(unittest.TestCase):
    def setUp(self):
        self.row = process("synthetic-engine", "e" * 64, True)
        self.row["State"]["Pid"] = 801
        self.expected = process_witness(self.row, running=True)

    def test_native_shaped_live_witness_is_additional_and_not_a_backend_rehash(self):
        docker = FakeDocker(self.row)
        result = admission.verify_engine_unchanged(docker, self.expected,
            expected_sha256=inputs.content_hash(self.expected))
        self.assertEqual(result, self.expected)
        self.assertEqual(docker.calls, [self.row["Id"]])
        self.assertEqual(docker.row, self.row)
        chain = accepted_chain_fixture()
        self.assertEqual(chain["backendFingerprint"], "3" * 64)
        self.assertNotIn("engine", chain)
        self.assertNotEqual(inputs.content_hash(result), chain["backendFingerprint"])

    def test_bad_expected_witness_pin_or_shape_holds_before_any_docker_read(self):
        mutations = (
            lambda row: row.update(pid=True), lambda row: row.update(pid=0),
            lambda row: row.update(imageId="tag:latest"), lambda row: row.update(configSha256="0"),
            lambda row: row.update(extra=True), lambda row: row.pop("startedAt"),
        )
        for mutate in mutations:
            expected = deepcopy(self.expected)
            mutate(expected)
            docker = FakeDocker(self.row)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                admission.verify_engine_unchanged(docker, expected, expected_sha256=inputs.content_hash(expected))
            self.assertEqual(docker.calls, [])
        docker = FakeDocker(self.row)
        with self.assertRaises(ValueError):
            admission.verify_engine_unchanged(docker, self.expected, expected_sha256="0" * 64)
        self.assertEqual(docker.calls, [])

    def test_engine_process_image_config_restart_and_state_changes_are_not_projected_away(self):
        mutations = (
            lambda row: row["State"].update(Pid=802),
            lambda row: row["State"].update(StartedAt="2026-11-14T00:00:00Z"),
            lambda row: row.update(Image="sha256:" + "9" * 64),
            lambda row: row.update(RestartCount=1),
            lambda row: row["Config"].update(Cmd=["changed"]),
            lambda row: row["State"].update(OOMKilled=True),
            lambda row: row["State"].update(Running=False, Status="exited", Pid=0),
        )
        for mutate in mutations:
            row = deepcopy(self.row)
            mutate(row)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                admission.verify_engine_unchanged(FakeDocker(row), self.expected,
                    expected_sha256=inputs.content_hash(self.expected))


class DisabledNewsletterWitnessTests(unittest.TestCase):
    """Preserve an actual off configuration; do not invent an Engine receipt."""

    def setUp(self):
        self.row = process("app", "a" * 64, True)
        self.row["Config"]["Env"] = [
            "NODE_ENV=production", "NEWSLETTER_BASE_URL=", "NEWSLETTER_API_USER=",
            "NEWSLETTER_API_TOKEN=", "NEWSLETTER_DELIVERY_ENABLED=false",
            "NEWSLETTER_PUBLIC_SIGNUP_ENABLED=false",
        ]
        self.expected = {"schemaVersion": 1,
            "kind": "warpdrive-disabled-newsletter-integration-witness",
            "web": process_witness(self.row, running=True),
            "configuration": {"integrationConfigured": False, "deliveryEnabled": False,
                              "publicSignupEnabled": False}}
        self.chain = accepted_chain_fixture()
        self.chain["active"]["slot"]["runtime"].update(runtimeId=self.row["Id"],
            imageId=self.row["Image"], name=self.row["Name"][1:])

    def verify(self, row=None, expected=None):
        row = self.row if row is None else row
        expected = self.expected if expected is None else expected
        docker = FakeDocker(row)
        result = admission.verify_engine_unchanged(docker, expected,
            expected_sha256=inputs.content_hash(expected))
        return result, docker

    def test_native_off_state_has_only_three_false_facts_and_one_exact_web_inspect(self):
        before = deepcopy((self.row, self.expected, self.chain))
        self.assertTrue(admission.validate_newsletter_binding(self.expected, self.chain))
        result, docker = self.verify()
        self.assertEqual(result, self.expected)
        self.assertEqual(set(result), {"schemaVersion", "kind", "web", "configuration"})
        self.assertEqual(set(result["web"]), {"id", "name", "imageId", "pid", "startedAt",
            "finishedAt", "restartCount", "configSha256", "project", "service"})
        self.assertTrue(all(value is False for value in result["configuration"].values()))
        self.assertEqual(docker.calls, [self.row["Id"]])
        self.assertNotIn("engine", result)
        self.assertNotIn("newsletterAcceptance", result)
        self.assertEqual((self.row, self.expected, self.chain), before)

    def test_absent_defaults_and_empty_connection_files_remain_explicitly_off(self):
        row = deepcopy(self.row)
        row["Config"]["Env"] = ["NODE_ENV=production", "NEWSLETTER_API_TOKEN_FILE=  "]
        expected = deepcopy(self.expected)
        expected["web"] = process_witness(row, running=True)
        result, _ = self.verify(row, expected)
        self.assertEqual(result["configuration"], self.expected["configuration"])

    def test_rehashed_wrong_schema_configuration_types_or_web_shape_reject_before_native(self):
        changes = (
            lambda value: value.update(schemaVersion=True),
            lambda value: value.update(schemaVersion=2),
            lambda value: value.update(kind="warpdrive-newsletter-is-qualified"),
            lambda value: value.update(extra=True),
            lambda value: value.pop("web"),
            lambda value: value["configuration"].update(integrationConfigured=0),
            lambda value: value["configuration"].update(deliveryEnabled="false"),
            lambda value: value["configuration"].update(publicSignupEnabled=None),
            lambda value: value["configuration"].update(enginePresent=False),
            lambda value: value["web"].pop("service"),
            lambda value: value["web"].update(extra=True),
            lambda value: value["web"].update(pid=True),
            lambda value: value["web"].update(pid=0),
            lambda value: value["web"].update(imageId="newsletter:latest"),
            lambda value: value["web"].update(configSha256="0"),
            lambda value: value["web"].update(name="/invalid name"),
            lambda value: value["web"].update(startedAt=None),
            lambda value: value["web"].update(finishedAt=""),
            lambda value: value["web"].update(restartCount=True),
            lambda value: value["web"].update(restartCount=-1),
            lambda value: value["web"].update(project=[]),
            lambda value: value["web"].update(service=False),
        )
        for change in changes:
            expected = deepcopy(self.expected)
            change(expected)
            docker = FakeDocker(self.row)
            with self.subTest(change=change), self.assertRaises(ValueError):
                admission.verify_engine_unchanged(docker, expected,
                    expected_sha256=inputs.content_hash(expected))
            self.assertEqual(docker.calls, [])

    def test_nonobject_web_and_wrong_independent_pin_hold_before_native(self):
        for web in (None, [], "not-a-process"):
            expected = deepcopy(self.expected)
            expected["web"] = web
            docker = FakeDocker(self.row)
            with self.subTest(web=web), self.assertRaises(ValueError):
                admission.verify_engine_unchanged(docker, expected,
                    expected_sha256=inputs.content_hash(expected))
            self.assertEqual(docker.calls, [])
        docker = FakeDocker(self.row)
        with self.assertRaises(ValueError):
            admission.verify_engine_unchanged(docker, self.expected, expected_sha256="0" * 64)
        self.assertEqual(docker.calls, [])

    def test_every_enabling_or_unknown_flag_and_nonempty_connection_file_holds(self):
        changes = [
            ("NEWSLETTER_BASE_URL", "http://newsletter-engine:9000"),
            ("NEWSLETTER_API_USER", "configured-api"), ("NEWSLETTER_API_TOKEN", "synthetic-nonsecret-token"),
            ("NEWSLETTER_DELIVERY_ENABLED", "true"), ("NEWSLETTER_DELIVERY_ENABLED", "0"),
            ("NEWSLETTER_DELIVERY_ENABLED", ""), ("NEWSLETTER_PUBLIC_SIGNUP_ENABLED", "True"),
        ] + [(key + "_FILE", "/run/secrets/synthetic-newsletter") for key in (
            "NEWSLETTER_BASE_URL", "NEWSLETTER_API_USER", "NEWSLETTER_API_TOKEN",
            "NEWSLETTER_DELIVERY_ENABLED", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED")]
        for key, value in changes:
            row = deepcopy(self.row)
            row["Config"]["Env"] = [item for item in row["Config"]["Env"] if item.split("=", 1)[0] != key]
            row["Config"]["Env"].append(key + "=" + value)
            # Re-pin the changed native process to isolate the off-state guard.
            expected = deepcopy(self.expected)
            expected["web"] = process_witness(row, running=True)
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.verify(row, expected)

    def test_duplicate_or_unreadable_environment_holds_even_with_self_rehashed_process(self):
        environments = (None, {}, ["BROKEN"], ["NEWSLETTER_API_TOKEN=", "NEWSLETTER_API_TOKEN="],
                        ["OTHER=1", "OTHER=2"], ["NEWSLETTER_DELIVERY_ENABLED=false", 1])
        for environment in environments:
            row = deepcopy(self.row)
            row["Config"]["Env"] = environment
            expected = deepcopy(self.expected)
            expected["web"] = process_witness(row, running=True)
            with self.subTest(environment=environment), self.assertRaises(ValueError):
                self.verify(row, expected)

    def test_original_web_process_and_configuration_changes_hold_without_repinning(self):
        mutations = (
            lambda row: row["State"].update(Pid=501),
            lambda row: row.update(Image="sha256:" + "b" * 64),
            lambda row: row.update(Name="/another-web"),
            lambda row: row.update(RestartCount=1),
            lambda row: row["Config"]["Env"].append("UNRELATED_CONFIGURATION=changed"),
            lambda row: row["State"].update(Running=False, Status="exited", Pid=0),
        )
        for mutate in mutations:
            row = deepcopy(self.row)
            mutate(row)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.verify(row)

    def test_disabled_witness_binds_all_three_accepted_incumbent_identity_fields(self):
        for key, value in (("runtimeId", "b" * 64), ("imageId", "sha256:" + "b" * 64),
                           ("name", "other-web")):
            chain = deepcopy(self.chain)
            chain["active"]["slot"]["runtime"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                admission.validate_newsletter_binding(self.expected, chain)


class SdkReleaseCompositionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        current, original = sdk_controls_fixture(self.root / "current"), original_fixture(self.root / "original")
        self.comparison = admission.compare_backend_inputs(current, original,
            expected_sdk_sha256=inputs.content_hash(current), expected_original_sha256=inputs.content_hash(original),
            original_revision=ORIGINAL_REVISION)
        files, _expected, _inspections, identities = image_fixture(wrapped=True)
        identity = identities["web"]
        config = json.loads(files["blobs/sha256/" + identity["config"][7:]])
        self.publication = {"schemaVersion": 1, "kind": "warpdrive-candidate-publication-admission",
            "repository": "KhademOHAli1/warpdrive", "revision": REVISION,
            "producer": {"runId": 42, "runAttempt": 1, "event": "push", "ref": "refs/heads/main"},
            "artifact": {"id": 81, "digest": "sha256:" + "0" * 64, "sizeBytes": 123456},
            "deploymentAuthorized": False}
        # Authenticating these bytes is the caller's separate responsibility.
        self.publication_bytes = (json.dumps(self.publication, indent=2) + "\n").encode()
        self.projection = {"schemaVersion": 1, "kind": "warpdrive-sdk-web-archive-projection",
            "policy": "sdk-full-bundle-one-web-native-closure-v1", "sourceRevision": REVISION, "platform": "linux/amd64",
            "original": {"kind": "warpdrive-tested-image-bundle", "schemaVersion": 3,
                "publicationAdmissionSha256": inputs.content_hash(self.publication),
                "origin": {"kind": "github-actions", "repository": "KhademOHAli1/warpdrive",
                           "runId": 42, "runAttempt": 1, "event": "push", "ref": "refs/heads/main"},
                "bundleManifestSha256": "7" * 64, "archiveSha256": "8" * 64, "archiveSizeBytes": 456789,
                "testedNativeImageId": identity["native"],
                "candidatePendingGates": ["installation", "independently-qualified-component-reuse"]},
            "selectedWeb": {"configDigest": identity["config"], "manifestDigest": identity["manifest"],
                "layerDigests": identity["layers"], "configMetadataSha256": "9" * 64,
                "rootfsDiffIds": config["rootfs"]["diff_ids"]},
            "derived": {"path": "/synthetic/projection/web-image.tar", "kind": "untagged-single-web-direct-oci-archive",
                "archiveSha256": "a" * 64, "archiveSizeBytes": 123456},
            "image": {"imageId": identity["config"], "sourceRevision": REVISION, "runtimeUser": "bun", "generation": "wd-" + REVISION},
            "provenance": {"archiveSha256": "a" * 64, "archiveSizeBytes": 123456, "bundleManifestSha256": "7" * 64},
            "projectionOnly": True, "backendReuseQualified": False, "installationAuthorized": False, "deploymentAuthorized": False}
        self.chain = accepted_chain_fixture()
        self.engine = process_witness(process("synthetic-engine", "e" * 64, True), running=True)
        self.contract_review = "b" * 64
        self.binding = {"schemaVersion": 1, "kind": "warpdrive-sdk-web-runtime-binding",
            "publicationReceiptSha256": raw_hash(self.publication_bytes), "sourceRevision": REVISION,
            "imageId": identity["manifest"], "testedConfigDigest": identity["config"],
            "profileId": runtime.PROFILE_ID, "command": list(runtime.COMMAND)}
        self.qualification = {"schemaVersion": 1, "kind": admission.QUALIFICATION_KIND, "state": "passed",
            "sourceRevision": REVISION, "publicationReceiptSha256": raw_hash(self.publication_bytes),
            "projectionReceiptSha256": inputs.content_hash(self.projection),
            "backendComparisonSha256": inputs.content_hash(self.comparison), "installedChainSha256": inputs.content_hash(self.chain),
            "backendFingerprint": self.chain["backendFingerprint"],
            "schemaSha256": self.chain["active"]["slot"]["runtime"]["schemaSha256"],
            "engineWitnessSha256": inputs.content_hash(self.engine), "contractReviewSha256": self.contract_review,
            "selectedWeb": {"testedNativeImageId": identity["native"], "configDigest": identity["config"], "manifestDigest": identity["manifest"]},
            "retainedComponentRecords": {name: row["originalRecordSha256"] for name, row in self.comparison["components"].items()},
            "checks": [{"name": name, "reportSha256": raw_hash(("synthetic NOT qualification: " + name).encode())}
                       for name in sorted(admission.CHECKS)],
            "limitations": ["Synthetic source-only fixture. No native qualification, authentication, runtime, install or deployment occurred."]}

    def options(self):
        return {"expected_revision": REVISION,
            "publication_bytes": self.publication_bytes, "expected_publication_sha256": raw_hash(self.publication_bytes),
            "projection": self.projection, "expected_projection_sha256": inputs.content_hash(self.projection),
            "runtime_binding": self.binding, "expected_runtime_binding_sha256": inputs.content_hash(self.binding),
            "backend_comparison": self.comparison, "expected_backend_comparison_sha256": inputs.content_hash(self.comparison),
            "qualification": self.qualification, "expected_qualification_sha256": inputs.content_hash(self.qualification),
            "installed_chain": self.chain, "expected_chain_sha256": inputs.content_hash(self.chain),
            "expected_backend_fingerprint": self.chain["backendFingerprint"],
            "expected_engine_witness_sha256": inputs.content_hash(self.engine), "expected_contract_review_sha256": self.contract_review}

    def compose(self, **changes):
        return admission.build_sdk_release(**(self.options() | changes))

    def test_exact_nine_key_release_preserves_original_and_derived_identity_and_pending_state(self):
        before = deepcopy((self.publication, self.projection, self.comparison, self.qualification, self.chain, self.binding))
        result = self.compose()
        self.assertEqual(set(result), {"schemaVersion", "kind", "sourceRevision", "publicationReceiptSha256", "image", "provenance",
                                      "projectionReceiptSha256", "runtimeBindingSha256", "backendReuseQualificationSha256"})
        self.assertIs(type(result["schemaVersion"]), int)
        self.assertEqual(result["kind"], admission.RELEASE_KIND)
        self.assertEqual(result["publicationReceiptSha256"], raw_hash(self.publication_bytes))
        self.assertNotEqual(raw_hash(self.publication_bytes), inputs.content_hash(self.publication))
        self.assertEqual(self.projection["original"]["publicationAdmissionSha256"], inputs.content_hash(self.publication))
        identities = self.projection["selectedWeb"]
        self.assertEqual(len({self.projection["original"]["testedNativeImageId"], identities["configDigest"], identities["manifestDigest"]}), 3)
        self.assertEqual(result["image"]["imageId"], identities["configDigest"])
        self.assertEqual(self.binding["imageId"], identities["manifestDigest"])
        self.assertNotEqual(self.projection["original"]["archiveSha256"], result["provenance"]["archiveSha256"])
        self.assertFalse(self.projection["backendReuseQualified"])
        self.assertIn("independently-qualified-component-reuse", self.projection["original"]["candidatePendingGates"])
        self.assertEqual((self.publication, self.projection, self.comparison, self.qualification, self.chain, self.binding), before)
        result["image"]["runtimeUser"] = "changed output only"
        result["provenance"]["archiveSha256"] = "0" * 64
        self.assertEqual((self.publication, self.projection, self.comparison, self.qualification, self.chain, self.binding), before)

    def test_separate_qualified_record_is_mandatory_even_for_equal_source_inputs(self):
        self.assertTrue(self.comparison["allInputsEqual"])
        with self.assertRaises(ValueError):
            self.compose(qualification=None)
        for state in ("pending", "unassessed", "failed", True):
            qualified = deepcopy(self.qualification)
            qualified["state"] = state
            with self.subTest(state=state), self.assertRaises(ValueError):
                self.compose(qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))

    def test_each_independent_record_pin_and_authority_pin_is_enforced(self):
        for key in ("expected_publication_sha256", "expected_projection_sha256", "expected_runtime_binding_sha256",
                    "expected_backend_comparison_sha256", "expected_qualification_sha256", "expected_chain_sha256",
                    "expected_backend_fingerprint", "expected_engine_witness_sha256", "expected_contract_review_sha256"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.compose(**{key: "0" * 64})

    def test_raw_publication_pin_and_canonical_admission_pin_cannot_be_substituted(self):
        with self.assertRaises(ValueError):
            self.compose(expected_publication_sha256=inputs.content_hash(self.publication))
        projection = deepcopy(self.projection)
        projection["original"]["publicationAdmissionSha256"] = raw_hash(self.publication_bytes)
        with self.assertRaises(ValueError):
            self.compose(projection=projection, expected_projection_sha256=inputs.content_hash(projection))
        binding = deepcopy(self.binding)
        binding["publicationReceiptSha256"] = inputs.content_hash(self.publication)
        with self.assertRaises(ValueError):
            self.compose(runtime_binding=binding, expected_runtime_binding_sha256=inputs.content_hash(binding))
        qualified = deepcopy(self.qualification)
        qualified["publicationReceiptSha256"] = inputs.content_hash(self.publication)
        with self.assertRaises(ValueError):
            self.compose(qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))

    def test_publication_scope_raw_size_and_deployment_flags_hold(self):
        for revision in (ORIGINAL_REVISION, True, "main"):
            with self.subTest(expected_revision=revision), self.assertRaises(ValueError):
                self.compose(expected_revision=revision)
        for changes in ({"kind": "legacy-web-admission"}, {"repository": "foreign/warpdrive"},
                        {"revision": "main"}, {"deploymentAuthorized": True}):
            publication = self.publication | changes
            raw = encoded(publication)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.compose(publication_bytes=raw, expected_publication_sha256=raw_hash(raw))
        for raw in (b"", b" " * (4 * 1024**2 + 1)):
            with self.subTest(size=len(raw)), self.assertRaises(ValueError):
                self.compose(publication_bytes=raw, expected_publication_sha256=raw_hash(raw))

    def test_projection_is_transport_only_and_original_full_bundle_gate_is_not_cleared(self):
        mutations = (
            lambda row: row.update(kind="warpdrive-tested-web-bundle"),
            lambda row: row.update(sourceRevision="2" * 40),
            lambda row: row.update(projectionOnly=False),
            lambda row: row.update(backendReuseQualified=True),
            lambda row: row.update(installationAuthorized=True),
            lambda row: row.update(deploymentAuthorized=True),
            lambda row: row["original"].update(kind="warpdrive-tested-web-bundle"),
            lambda row: row["original"].update(schemaVersion=2),
            lambda row: row["original"].update(candidatePendingGates=["installation"]),
        )
        for mutate in mutations:
            projection, qualified = deepcopy(self.projection), deepcopy(self.qualification)
            mutate(projection)
            qualified["projectionReceiptSha256"] = inputs.content_hash(projection)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.compose(projection=projection, expected_projection_sha256=inputs.content_hash(projection),
                    qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))

    def test_manifest_config_native_image_source_generation_and_runtime_are_distinct_bindings(self):
        mutations = (
            lambda row: row["image"].update(imageId=row["selectedWeb"]["manifestDigest"]),
            lambda row: row["selectedWeb"].update(manifestDigest=row["selectedWeb"]["configDigest"]),
            lambda row: row["image"].update(sourceRevision="2" * 40),
            lambda row: row["image"].update(generation="wd-" + "2" * 40),
            lambda row: row["original"].update(testedNativeImageId="sha256:" + "0" * 64),
        )
        for mutate in mutations:
            projection, qualified = deepcopy(self.projection), deepcopy(self.qualification)
            mutate(projection)
            qualified["projectionReceiptSha256"] = inputs.content_hash(projection)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.compose(projection=projection, expected_projection_sha256=inputs.content_hash(projection),
                    qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))
        for changes in ({"command": ["bun", "node_modules/next/dist/bin/next", "start"]},
                        {"profileId": "other"}, {"sourceRevision": "2" * 40},
                        {"imageId": self.binding["testedConfigDigest"]},
                        {"testedConfigDigest": self.binding["imageId"]}):
            binding = self.binding | changes
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.compose(runtime_binding=binding, expected_runtime_binding_sha256=inputs.content_hash(binding))

    def test_qualification_has_exact_nine_unique_pinned_checks_and_no_deployment_shortcut(self):
        mutations = (
            lambda row: row["checks"].pop(),
            lambda row: row["checks"].append(deepcopy(row["checks"][0])),
            lambda row: row["checks"].__setitem__(0, deepcopy(row["checks"][1])),
            lambda row: row["checks"][0].update(reportSha256="not-a-pin"),
            lambda row: row["checks"][0].update(name="generic-healthy"),
            lambda row: row["checks"][0].update(passed=True),
            lambda row: row.update(deploymentAuthorized=True),
            lambda row: row.update(limitations=[""]),
        )
        for mutate in mutations:
            qualified = deepcopy(self.qualification)
            mutate(qualified)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.compose(qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))

    def test_stale_chain_backend_engine_contract_source_and_retained_record_authority_holds(self):
        for key in ("installedChainSha256", "backendFingerprint", "engineWitnessSha256", "contractReviewSha256",
                    "projectionReceiptSha256", "backendComparisonSha256", "publicationReceiptSha256"):
            qualified = deepcopy(self.qualification)
            qualified[key] = "0" * 64
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.compose(qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))
        qualified = deepcopy(self.qualification)
        qualified["sourceRevision"] = ORIGINAL_REVISION
        with self.assertRaises(ValueError):
            self.compose(qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))
        for component in admission.RETAINED:
            qualified = deepcopy(self.qualification)
            qualified["retainedComponentRecords"][component] = self.comparison["components"][component]["currentInputSha256"]
            with self.subTest(component=component), self.assertRaises(ValueError):
                self.compose(qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))
        chain = deepcopy(self.chain)
        chain["acceptedOperationId"] = "different-accepted-operation"
        with self.assertRaises(ValueError):
            self.compose(installed_chain=chain, expected_chain_sha256=inputs.content_hash(chain))

    def test_comparison_is_unqualified_and_cannot_drop_retained_components_or_change_source(self):
        mutations = (
            lambda row: row.update(runtimeCompatibilityQualified=True),
            lambda row: row.update(deploymentAuthorized=True),
            lambda row: row.update(sourceRevision=ORIGINAL_REVISION),
            lambda row: row["components"].pop("migrator"),
        )
        for mutate in mutations:
            comparison, qualified = deepcopy(self.comparison), deepcopy(self.qualification)
            mutate(comparison)
            qualified["backendComparisonSha256"] = inputs.content_hash(comparison)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.compose(backend_comparison=comparison, expected_backend_comparison_sha256=inputs.content_hash(comparison),
                    qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))

    def test_boolean_schema_versions_are_not_typed_record_versions(self):
        for name in ("publication", "projection", "comparison", "qualification"):
            # Rebind the synthetic fixture's hashes so only the record type is
            # being tested, not a trivial stale independent-hash mismatch.
            publication, projection = deepcopy(self.publication), deepcopy(self.projection)
            comparison, qualified, binding = deepcopy(self.comparison), deepcopy(self.qualification), deepcopy(self.binding)
            records = {"publication": publication, "projection": projection, "comparison": comparison, "qualification": qualified}
            records[name]["schemaVersion"] = True
            raw = (json.dumps(publication, indent=2) + "\n").encode()
            projection["original"]["publicationAdmissionSha256"] = inputs.content_hash(publication)
            binding["publicationReceiptSha256"] = raw_hash(raw)
            qualified.update(publicationReceiptSha256=raw_hash(raw), projectionReceiptSha256=inputs.content_hash(projection),
                             backendComparisonSha256=inputs.content_hash(comparison))
            with self.subTest(record=name), self.assertRaises(ValueError):
                self.compose(publication_bytes=raw, expected_publication_sha256=raw_hash(raw),
                    projection=projection, expected_projection_sha256=inputs.content_hash(projection),
                    backend_comparison=comparison, expected_backend_comparison_sha256=inputs.content_hash(comparison),
                    runtime_binding=binding, expected_runtime_binding_sha256=inputs.content_hash(binding),
                    qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))

    def test_schema_unchanged_pin_matches_the_accepted_chain_not_merely_hash_shape(self):
        qualified = deepcopy(self.qualification)
        qualified["schemaSha256"] = "0" * 64
        with self.assertRaises(ValueError):
            self.compose(qualification=qualified, expected_qualification_sha256=inputs.content_hash(qualified))


@unittest.skipUnless(os.environ.get("SDK_ADMISSION_REAL_ORIGINAL_RECEIPT") and os.environ.get("SDK_ADMISSION_REAL_CURRENT_RECEIPT")
                     and os.environ.get("SDK_ADMISSION_REAL_CURRENT_RAW_SHA256"), "Explicit custody-pinned local real receipts not supplied")
class GenuineBackendDifferenceTests(unittest.TestCase):
    def test_actual_6b_worker_realtime_difference_is_reported_without_accepting_reuse(self):
        original_raw = Path(os.environ["SDK_ADMISSION_REAL_ORIGINAL_RECEIPT"]).read_bytes()
        current_raw = Path(os.environ["SDK_ADMISSION_REAL_CURRENT_RECEIPT"]).read_bytes()
        self.assertEqual(raw_hash(original_raw), REAL_ORIGINAL_RAW_SHA)
        self.assertEqual(raw_hash(current_raw), os.environ["SDK_ADMISSION_REAL_CURRENT_RAW_SHA256"])
        original, current = inputs.decode(original_raw), inputs.decode(current_raw)
        self.assertEqual(current["sourceRevision"], REAL_CURRENT_REVISION)
        result = admission.compare_backend_inputs(current, original, expected_sdk_sha256=inputs.content_hash(current),
            expected_original_sha256=inputs.content_hash(original), original_revision=REAL_ORIGINAL_REVISION)
        self.assertFalse(result["allInputsEqual"])
        self.assertFalse(result["runtimeCompatibilityQualified"])
        self.assertFalse(result["deploymentAuthorized"])
        for name, equal in (("worker", False), ("realtime", False), ("migrator", True)):
            self.assertEqual(result["components"][name]["completeRecordsEqual"], equal)
        self.assertEqual(result["components"]["worker"]["originalInputSha256"], "e1643d5174de1bc89a107ae7dc6affe41cf9f1970bfaa82c109f3786a74fcfa2")
        self.assertEqual(result["components"]["worker"]["currentInputSha256"], "33af5c55d8ccfcdfe4e72389e3106e1d1a2c4d3cdc1cb564e6193f172e88da6d")
        self.assertEqual(result["components"]["realtime"]["originalInputSha256"], "2a3168a7712e2c72f6b90ba94378d962049c8ce6252c9940c2b4840f4a162085")
        self.assertEqual(result["components"]["realtime"]["currentInputSha256"], "73b5e0b00789f74856ac985e445d8b5ba1f1acc236f05b4a6d31cb81366d169a")
        self.assertEqual(result["components"]["migrator"]["originalInputSha256"], "db386c6c2038aec2b0075338511983671c7c62035c7050e4945cd345b1280498")


if __name__ == "__main__":
    unittest.main()
