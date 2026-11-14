"""Source-only tests. Synthetic reports NEVER establish native qualification."""

from copy import deepcopy
from hashlib import sha1, sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import component_inputs as inputs
from image_smoke import ImageSmoke, OWNER_LABEL
from installed_web_sdk_admission import compare_backend_inputs
from installed_web_sdk_runtime import COMMAND, PROFILE_ID
from test_component_inputs import fixture as input_fixture, rehash
from test_web_sdk_archive import sdk_input_fixture
import web_sdk_full_receipt as sdk
import web_sdk_reuse_qualification as qualification


def selection_fixture():
    result = {}
    for number, role in enumerate(qualification.ROLES, start=1):
        digit = format(number, "x")
        revision = "1" if role in qualification.RETAINED else "2" if role == "old_web" else "3" if role == "new_web" else "4"
        result[role] = {"nativeImageId": "sha256:" + digit * 64, "configDigest": "sha256:" + (digit + "a") * 32,
            "manifestDigest": "sha256:" + (digit + "b") * 32, "sourceRevision": revision * 40, "reference": None}
    return result


def profiles_fixture(selection):
    old = selection["old_web"]
    legacy = {"kind": "warpdrive-legacy-web-fixture-profile", "sourceRevision": old["sourceRevision"],
        "nativeImageId": old["nativeImageId"], "configDigest": old["configDigest"],
        "command": list(qualification.LEGACY_COMMAND), "authoritySha256": "e" * 64}
    new = selection["new_web"]
    binding = {"schemaVersion": 1, "kind": "warpdrive-sdk-web-runtime-binding", "publicationReceiptSha256": "f" * 64,
        "sourceRevision": new["sourceRevision"], "imageId": new["manifestDigest"], "testedConfigDigest": new["configDigest"],
        "profileId": PROFILE_ID, "command": list(COMMAND)}
    return legacy, binding


def native_row(selected, command):
    revision = selected["sourceRevision"]
    return {"Image": selected["nativeImageId"], "Config": {"Image": selected["nativeImageId"], "Cmd": list(command),
        "Env": ["APP_COMMIT=" + revision, "NEXT_DEPLOYMENT_ID=wd-" + revision, "APP_VERSION=", "NODE_ENV=production"],
        "User": "bun", "WorkingDir": "/app", "Labels": {"org.opencontainers.image.revision": revision}},
        "HostConfig": {"Memory": 1536 * 1024**2, "CgroupParent": "warpdrivequalification123456abcdef.slice"}, "Mounts": []}


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.owned_postgres = None

    def run(self, arguments, **options):
        self.calls.append((deepcopy(arguments), deepcopy(options)))
        if arguments[:1] == ["run"] and "--name" in arguments:
            name = arguments[arguments.index("--name") + 1]
            if name.startswith("wd-image-smoke-") and name.endswith("-postgres"):
                owner = name.removesuffix("-postgres")
                if f"{OWNER_LABEL}={owner}" not in arguments:
                    raise AssertionError("Synthetic PostgreSQL lacks its exact owner label")
                self.owned_postgres = name
        return SimpleNamespace(stdout="", stderr="", returncode=0)

    def json(self, arguments, **options):
        self.calls.append((deepcopy(arguments), deepcopy(options)))
        if arguments[:2] == ["network", "inspect"]:
            return True
        if (len(arguments) == 5 and arguments[:2] == ["container", "inspect"]
                and self.owned_postgres is not None and arguments[2] == self.owned_postgres
                and arguments[3:] == ["--format", "{{json .State}}"]):
            return {"Status": "running", "Running": True, "ExitCode": 0, "OOMKilled": False}
        raise AssertionError("Unexpected native-shaped read")


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.selection = selection_fixture()

    def test_selection_keeps_three_source_generations_and_independent_identity_kinds(self):
        result = qualification.selected_images(self.selection)
        self.assertEqual(result, self.selection)
        self.assertEqual(len({row["nativeImageId"] for row in result.values()}), 6)
        self.assertNotEqual(result["new_web"]["nativeImageId"], result["new_web"]["configDigest"])
        result["worker"]["sourceRevision"] = "9" * 40
        self.assertEqual(self.selection["worker"]["sourceRevision"], "1" * 40)

    def test_mutable_refs_missing_identity_and_wrong_backend_or_unknown_roles_hold(self):
        mutations = (
            lambda value: value["new_web"].update(reference="repo:latest"),
            lambda value: value["worker"].update(nativeImageId="loaded-id"),
            lambda value: value["worker"].update(sourceRevision="main"),
            lambda value: value["realtime"].update(sourceRevision="9" * 40),
            lambda value: value["new_web"].update(sourceRevision=value["old_web"]["sourceRevision"]),
            lambda value: value["new_web"].update(nativeImageId=value["worker"]["nativeImageId"]),
            lambda value: value.update(core_api=deepcopy(value["engine"])),
            lambda value: value.pop("migrator"),
        )
        for mutate in mutations:
            selected = deepcopy(self.selection)
            mutate(selected)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                qualification.selected_images(selected)

    def test_fixed_profiles_preserve_legacy_old_and_reject_arbitrary_commands(self):
        old, new = profiles_fixture(self.selection)
        actual = qualification.profiles(old, new, self.selection, "f" * 64)
        self.assertEqual(actual["old_web"]["command"], ["bun", "node_modules/next/dist/bin/next", "start"])
        self.assertEqual(actual["new_web"]["command"], ["bun", "--bun", "next", "start"])
        for mutate_old, mutate_new in (({"command": ["sh", "-c", "next start"]}, {}), ({}, {"command": ["sh", "-c", "next start"]}),
                                       ({"authoritySha256": "missing"}, {}), ({}, {"testedConfigDigest": self.selection["new_web"]["manifestDigest"]}),
                                       ({"sourceRevision": "9" * 40}, {})):
            with self.subTest(old=mutate_old, new=mutate_new), self.assertRaises(ValueError):
                qualification.profiles(old | mutate_old, new | mutate_new, self.selection, "f" * 64)

    def test_common_config_allows_only_bound_cmd_delta_and_preserves_actual_rows(self):
        old = native_row(self.selection["old_web"], qualification.LEGACY_COMMAND)
        new = native_row(self.selection["new_web"], COMMAND)
        before = deepcopy((old, new))
        a = qualification.common_configuration(old, self.selection["old_web"]["sourceRevision"], selected=self.selection["old_web"], command=qualification.LEGACY_COMMAND)
        b = qualification.common_configuration(new, self.selection["new_web"]["sourceRevision"], selected=self.selection["new_web"], command=COMMAND)
        self.assertEqual(a, b)
        self.assertEqual((old, new), before)
        changed = deepcopy(new)
        changed["HostConfig"]["Memory"] += 1
        self.assertNotEqual(a, qualification.common_configuration(changed, self.selection["new_web"]["sourceRevision"], selected=self.selection["new_web"], command=COMMAND))
        for row in (new | {"Image": self.selection["old_web"]["nativeImageId"]},
                    new | {"Config": new["Config"] | {"Cmd": list(qualification.LEGACY_COMMAND)}}):
            with self.subTest(row=row["Image"]), self.assertRaises(ValueError):
                qualification.common_configuration(row, self.selection["new_web"]["sourceRevision"], selected=self.selection["new_web"], command=COMMAND)

    def test_preloaded_mixed_never_selects_a_profile_from_live_cmd_or_mutable_caddy(self):
        fixture = qualification._PreloadedMixed.__new__(qualification._PreloadedMixed)
        old, new = profiles_fixture(self.selection)
        fixture.admitted = {"selection": self.selection,
            "runtimeProfiles": qualification.profiles(old, new, self.selection, "f" * 64)}
        fixture.supports = {"caddy": {"nativeImageId": "sha256:" + "c" * 64}}
        self.assertEqual(fixture.web_command("a", {"imageId": self.selection["old_web"]["nativeImageId"]}), list(qualification.LEGACY_COMMAND))
        self.assertEqual(fixture.web_command("b", {"imageId": self.selection["new_web"]["nativeImageId"]}), list(COMMAND))
        with patch.object(qualification.mixed, "caddy_image", side_effect=AssertionError("Mutable fallback forbidden")):
            self.assertEqual(fixture.selected_caddy_image(), fixture.supports["caddy"]["nativeImageId"])
        with self.assertRaises(ValueError):
            fixture.web_command("other", {"imageId": self.selection["new_web"]["nativeImageId"]})

    def test_no_aggregate_cgroup_or_changed_admission_pin_rejects_before_source_or_daemon(self):
        handoff = {key: None for key in qualification.TOP}
        handoff.update(schemaVersion=1, kind=qualification.ADMISSION_KIND, dockerEndpoint="unix:///var/run/docker.sock",
            maximumSeconds=1800, allowPrivateFixturePublication=False, namespace="wd-sdk-reuse-123456abcdef", storageClientBin="mc", cgroup={"parent": None})
        with patch.object(qualification.local, "verify_source", side_effect=AssertionError("No source call expected")):
            with self.assertRaises(ValueError):
                qualification.admit_reuse(handoff, expected_handoff_sha256=inputs.content_hash(handoff))
            with self.assertRaises(ValueError):
                qualification.admit_reuse(handoff, expected_handoff_sha256="0" * 64)


class IncumbentHistoryTests(unittest.TestCase):
    """Real mode validators; strict archive readers remain separate tested boundaries."""
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.paths = {}
        for name in ("core", "previous-web", "active-web", "seed"):
            value = self.root / name
            value.mkdir()
            self.paths[name] = str(value)
        for name, schema in (("previous-publication.json", 1), ("active-publication.json", 2), ("functional.json", 1)):
            value = self.root / name
            value.write_text(json.dumps({"schemaVersion": schema, "kind": "reader-boundary-unit-metadata"}))
            self.paths[name] = str(value)
        names = set(qualification.mixed.REPEAT_OPTIONS) | set(qualification.mixed.SUCCESSOR_OPTIONS) | set(qualification.mixed.FUNCTIONAL_PREDECESSOR_OPTIONS)
        self.history = {name: None for name in names}
        self.history.update(active_web_bundle=self.paths["previous-web"],
            active_web_publication_receipt=self.paths["previous-publication.json"],
            active_web_publication_receipt_sha256="a" * 64, seed_root=self.paths["seed"], harness_revision="a" * 40,
            successor_web_bundle=self.paths["active-web"], successor_web_publication_receipt=self.paths["active-publication.json"],
            successor_web_publication_receipt_sha256="b" * 64, successor_web_revision="c" * 40,
            predecessor_lineage_sha256="c" * 64)
        self.incumbent = {"history": self.history, "archive": {}, "configDigest": "sha256:" + "d" * 64,
                          "metadata": {}, "legacyProfile": {}}
        self.backend = {"bundleDir": self.paths["core"], "revision": "1" * 40, "bundleManifestSha256": "2" * 64}
        self.new = {"nativeImageId": "sha256:" + "e" * 64, "sourceRevision": "e" * 40}

    def args(self):
        return qualification._history_args(self.incumbent, self.backend, self.new, self.root / "proof")

    def test_repeat_schema2_incumbent_keeps_inactive_nulls_and_uses_strict_successor_reader(self):
        # Actual installed shape: prior schema1 Web + current schema2 repeat Web;
        # the independently pinned functional composite pair is absent.
        args = self.args()
        self.assertIsNone(args.functional_predecessor_composite)
        self.assertIsNone(args.functional_predecessor_composite_sha256)
        self.assertIsInstance(args.active_web_bundle, Path)
        self.assertFalse(qualification.mixed.functional_successor_mode(args))
        self.assertTrue(qualification.mixed.successor_mode(args))
        admitted = {"kind": "strict-successor-reader-return", "sourceRevision": "c" * 40}
        with patch.object(qualification.mixed, "successor_baseline", return_value=admitted) as successor, \
             patch.object(qualification.mixed, "functional_successor_baseline", side_effect=AssertionError("Wrong receipt grammar")):
            self.assertIs(qualification.incumbent_baseline(args, self.backend), admitted)
            successor.assert_called_once_with(args, self.backend)

    def test_functional_mode_still_uses_existing_reader_without_repeat_paths(self):
        for name in qualification.mixed.REPEAT_OPTIONS[:3]:
            self.history[name] = None
        self.history.update(functional_predecessor_composite=self.paths["functional.json"],
                            functional_predecessor_composite_sha256="d" * 64)
        args = self.args()
        self.assertIsNone(args.active_web_bundle)
        self.assertIsNone(args.active_web_publication_receipt)
        self.assertTrue(qualification.mixed.functional_successor_mode(args))
        expected = {"kind": "strict-functional-reader-return"}
        with patch.object(qualification.mixed, "functional_successor_baseline", return_value=expected) as functional, \
             patch.object(qualification.mixed, "successor_baseline", side_effect=AssertionError("Wrong receipt grammar")):
            self.assertIs(qualification.incumbent_baseline(args, self.backend), expected)
            functional.assert_called_once_with(args, self.backend)

    def test_conflicting_partial_or_unsupported_modes_do_not_call_any_archive_reader(self):
        histories = []
        conflict = deepcopy(self.history)
        conflict.update(functional_predecessor_composite=self.paths["functional.json"], functional_predecessor_composite_sha256="d" * 64)
        histories.append(conflict)
        histories.append(self.history | {"successor_web_publication_receipt": None})
        histories.append(self.history | {"functional_predecessor_composite_sha256": "d" * 64})
        histories.append({key: None for key in self.history})
        for history in histories:
            self.incumbent["history"] = history
            with self.subTest(history=history), \
                 patch.object(qualification.mixed, "functional_successor_baseline") as functional, \
                 patch.object(qualification.mixed, "successor_baseline") as successor:
                with self.assertRaises((ValueError, qualification.mixed.WebSwitchSmokeError)):
                    qualification.incumbent_baseline(self.args(), self.backend)
                functional.assert_not_called()
                successor.assert_not_called()

    def test_wrong_history_types_unknown_fields_and_noncanonical_paths_hold(self):
        for key, value in (("functional_predecessor_composite", False), ("seed_root", []),
                           ("successor_web_revision", 123), ("active_web_publication_receipt_sha256", {})):
            self.incumbent["history"] = self.history | {key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.args()
        self.incumbent["history"] = self.history | {"unreviewedMode": "auto"}
        with self.assertRaises(ValueError):
            self.args()
        self.incumbent["history"] = self.history | {"seed_root": "relative-seed"}
        with self.assertRaises((ValueError, qualification.mixed.WebSwitchSmokeError)):
            qualification.incumbent_baseline(self.args(), self.backend)


class BoundWebCommandTests(unittest.TestCase):
    def setUp(self):
        self.selection = selection_fixture()
        old, new = profiles_fixture(self.selection)
        self.legacy = qualification.profiles(old, new, self.selection, "f" * 64)
        self.sdk_old = qualification.profiles(old | {"command": list(COMMAND)}, new, self.selection, "f" * 64)

    def test_both_fixed_old_commands_need_matching_original_artifact_and_publication(self):
        chain = {"active": {"provenance": {"authoritySha256": "e" * 64}}}
        history = {"successor_web_publication_receipt_sha256": "e" * 64}
        for profiles in (self.legacy, self.sdk_old):
            qualification.verify_profile_commands(profiles, old_metadata={"Cmd": profiles["old_web"]["command"]},
                new_metadata={"Cmd": list(COMMAND)})
            qualification.verify_incumbent_profile_authority(profiles, chain, history)
            mismatched = list(COMMAND) if profiles == self.legacy else list(qualification.LEGACY_COMMAND)
            with self.subTest(command=mismatched), self.assertRaises(ValueError):
                qualification.verify_profile_commands(profiles, old_metadata={"Cmd": mismatched}, new_metadata={"Cmd": list(COMMAND)})
            with self.assertRaises(ValueError):
                qualification.verify_incumbent_profile_authority(profiles, chain,
                    {"successor_web_publication_receipt_sha256": "0" * 64})
        with self.assertRaises(ValueError):
            qualification.verify_profile_commands(self.sdk_old, old_metadata={"Cmd": list(COMMAND)},
                new_metadata={"Cmd": list(qualification.LEGACY_COMMAND)})

    def test_mixed_uses_only_admitted_profile_and_rejects_actual_row_command_substitution(self):
        for profiles in (self.legacy, self.sdk_old):
            fixture = qualification._PreloadedMixed.__new__(qualification._PreloadedMixed)
            fixture.admitted = {"selection": self.selection, "runtimeProfiles": profiles}
            old = self.selection["old_web"]
            expected = profiles["old_web"]["command"]
            self.assertEqual(fixture.web_command("a", {"imageId": old["nativeImageId"]}), expected)
            self.assertEqual(fixture.web_command("b", {"imageId": self.selection["new_web"]["nativeImageId"]}), list(COMMAND))
            row = native_row(old, expected)
            self.assertIsInstance(fixture.common_configuration(row, old["sourceRevision"]), dict)
            row["Config"]["Cmd"] = ["sh", "-c", "next start"]
            with self.assertRaises(ValueError):
                fixture.common_configuration(row, old["sourceRevision"])

    def fresh_fixture(self, profiles):
        fixture = qualification._FreshProducer.__new__(qualification._FreshProducer)
        fixture.admitted = {"selection": self.selection, "runtimeProfiles": profiles}
        fixture.images = {phase: {"app": "sha256:" + digit * 64} for phase, digit in (("baseline", "a"), ("candidate", "b"))}
        fixture.revisions = {"baseline": self.selection["old_web"]["sourceRevision"],
                             "candidate": self.selection["new_web"]["sourceRevision"]}
        return fixture

    def test_fresh_model_cannot_override_admitted_legacy_command_to_sdk(self):
        fixture = self.fresh_fixture(self.sdk_old)
        fixture.compose = Mock(return_value=json.dumps({"services": {"app": {"command": list(COMMAND)}}}))
        with patch.object(qualification.fresh.FreshSmoke, "prepare"):
            fixture.prepare()
            self.assertEqual(fixture.compose.call_count, 2)
            fixture.admitted["runtimeProfiles"] = self.legacy
            with self.assertRaisesRegex(ValueError, "Compose launcher"):
                fixture.prepare()

    def test_fresh_native_rows_require_admitted_command_phase_source_and_transport_identity(self):
        fixture = self.fresh_fixture(self.sdk_old)
        row = {"Image": fixture.images["baseline"]["app"], "Config": {"Cmd": list(COMMAND)}}
        with patch.object(qualification.fresh.FreshSmoke, "_ready_rows", return_value={"app": row}):
            self.assertEqual(fixture._ready_rows("baseline"), {"app": row})
            for changed in ({"Image": "sha256:" + "f" * 64}, {"Config": {"Cmd": list(qualification.LEGACY_COMMAND)}}):
                with self.subTest(changed=changed), patch.object(qualification.fresh.FreshSmoke, "_ready_rows", return_value={"app": row | changed}), self.assertRaises(ValueError):
                    fixture._ready_rows("baseline")
            fixture.revisions["baseline"] = "f" * 40
            with self.assertRaises(ValueError):
                fixture._ready_rows("baseline")



class HistoricalEngineContextTests(unittest.TestCase):
    """Synthetic Git-object protocol only; no Git process or code is executed."""
    def setUp(self):
        self.revision, self.tree = "4" * 40, "e" * 40
        self.files = {name: ("synthetic producer file: " + name).encode() for name in qualification.ENGINE_REQUIRED}
        self.files[".dockerignore"] = b".git\n"
        self.headers, self.blobs, self.calls = [], {}, []
        for name, data in sorted(self.files.items()):
            oid = sha1(f"blob {len(data)}\0".encode() + data, usedforsecurity=False).hexdigest()
            self.headers.append(("100644", "blob", oid, name))
            self.blobs[oid] = data

    def read(self, args, maximum):
        self.calls.append((args, maximum))
        if args == ["rev-parse", "--verify", self.revision + "^{commit}"]:
            return (self.revision + "\n").encode()
        if args == ["rev-parse", "--verify", self.revision + ":deploy/newsletters/engine"]:
            return (self.tree + "\n").encode()
        if args == ["cat-file", "-t", self.tree]:
            return b"tree\n"
        if args == ["ls-tree", "-r", "-z", self.tree]:
            return b"".join((f"{mode} {kind} {oid}\t{name}\0").encode() for mode, kind, oid, name in self.headers)
        if args[:2] == ["cat-file", "-s"]:
            return (str(len(self.blobs[args[2]])) + "\n").encode()
        if args[:2] == ["cat-file", "blob"]:
            return self.blobs[args[2]]
        raise AssertionError("Unexpected Git/source/path request")

    def reconstruct(self):
        with patch.object(qualification, "_engine_git_bytes", side_effect=self.read), patch.object(qualification.local, "context_record", side_effect=AssertionError("Current context must not be used")):
            return qualification.historical_engine_context(self.revision)

    def test_exact_producer_context_hashes_raw_blobs_without_current_tree_or_materialization(self):
        result = self.reconstruct()
        files = {name: sha256(raw).hexdigest() for name, raw in self.files.items()}
        expected = {"files": files, "sha256": sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}
        self.assertEqual(result["context"], expected)
        self.assertEqual(result["sourceRevision"], self.revision)
        self.assertEqual(result["gitTree"], self.tree)
        self.assertEqual(result["fixedDirectory"], "deploy/newsletters/engine")
        self.assertEqual(result["totalBytes"], sum(map(len, self.files.values())))
        self.assertFalse(any("HEAD" in arg for args, _ in self.calls for arg in args))

    def test_symlink_submodule_unsafe_generated_secret_and_duplicate_members_reject(self):
        original = deepcopy(self.headers)
        bad_headers = [
            ("120000", "blob", original[0][2], "link"), ("160000", "commit", self.revision, "submodule"),
            *(('100644', 'blob', original[0][2], name) for name in ("../outside", "/outside", "a//b", ".env.production", "tests/__pycache__/x.pyc", ".git/config")),
            original[0],
        ]
        for header in bad_headers:
            self.headers = original + [header]
            with self.subTest(header=header), self.assertRaises(ValueError): self.reconstruct()

    def test_wrong_raw_blob_or_missing_required_file_does_not_reuse_context_hash(self):
        first = self.headers[0]
        self.blobs[first[2]] += b"wrong bytes"
        with self.assertRaisesRegex(ValueError, "raw blob differs"): self.reconstruct()
        self.blobs[first[2]] = self.files[first[3]]
        self.headers = [row for row in self.headers if row[3] != "build.sh"]
        with self.assertRaisesRegex(ValueError, "required nonroot/migration"): self.reconstruct()

    def test_unknown_producer_or_oversized_context_is_held_without_fallback(self):
        with patch.object(qualification, "_engine_git_bytes", side_effect=AssertionError("No Git for invalid revision")):
            with self.assertRaises(ValueError): qualification.historical_engine_context("main")
        with patch.object(qualification, "_engine_git_bytes", side_effect=ValueError("Missing local object")):
            with self.assertRaises(ValueError): qualification.historical_engine_context(self.revision)
        with patch.object(qualification, "ENGINE_MAX_FILE_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "byte bound"): self.reconstruct()
        with patch.object(qualification, "ENGINE_MAX_TOTAL_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "byte bound"): self.reconstruct()
        with patch.object(qualification, "ENGINE_MAX_FILES", 1):
            with self.assertRaisesRegex(ValueError, "file inventory"): self.reconstruct()

    def test_report_or_independent_context_substitution_cannot_match_another_current_tree(self):
        context = self.reconstruct()["context"]
        with patch.object(qualification, "_engine_git_bytes", side_effect=self.read):
            actual = qualification.verify_historical_engine_context(self.revision, context, expected_sha256=context["sha256"])
            self.assertEqual(actual["context"], context)
            changed = deepcopy(context)
            changed["files"]["build.sh"] = "0" * 64
            for report, expected in ((changed, context["sha256"]), (context, "0" * 64)):
                with self.subTest(expected=expected), self.assertRaises(ValueError):
                    qualification.verify_historical_engine_context(self.revision, report, expected_sha256=expected)


class PinnedHookTests(unittest.TestCase):
    """Root must apply native-hooks.patch in a private tools copy before running."""
    def test_postgres_never_pulls_and_every_owned_runtime_has_aggregate_parent(self):
        docker = FakeDocker()
        with TemporaryDirectory() as directory:
            postgres = "sha256:" + "d" * 64
            parent = "warpdrivequalification123456abcdef.slice"
            fixture = ImageSmoke(docker, {role: "sha256:" + format(n, "x") * 64 for n, role in enumerate(qualification.COMPONENTS, 1)},
                Path(directory), postgres_image=postgres, cgroup_parent=parent)
            fixture.create_environment()
            fixture.start_container("owned-probe", "sha256:" + "e" * 64, ["bun", "probe.mjs"])
        runs = [args for args, _ in docker.calls if args[:1] == ["run"]]
        self.assertEqual(len(runs), 2)
        self.assertIn(postgres, runs[0])
        for args in runs:
            self.assertEqual(args[args.index("--pull") + 1], "never")
            self.assertEqual(args[args.index("--cgroup-parent") + 1], parent)
            self.assertNotIn("postgres:16-alpine", args)

    def test_unpinned_support_or_arbitrary_cgroup_is_rejected_at_construction(self):
        for options in ({"postgres_image": "postgres:16-alpine"}, {"cgroup_parent": "system.slice"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                ImageSmoke(FakeDocker(), {role: "sha256:" + "a" * 64 for role in qualification.COMPONENTS}, Path("/unused"), **options)

    def test_support_inventory_reference_and_config_blob_digest_are_admitted_before_native_read(self):
        supports = {role: {"reference": "cache.invalid/" + role + "@sha256:" + "1" * 64,
            "configDigest": "sha256:" + "2" * 64, "configBlob": {"sha256": "2" * 64}, "snapshot": {}}
            for role in qualification.local.SUPPORT}
        with patch.object(qualification, "file_record", return_value={}):
            self.assertEqual(qualification.support_declarations(supports), supports)
        for mutate in (lambda value: value.pop("registry"), lambda value: value["caddy"].update(reference="caddy:2-alpine"),
                       lambda value: value["postgres"]["configBlob"].update(sha256="3" * 64),
                       lambda value: value["registry"].update(extra=True)):
            changed = deepcopy(supports)
            mutate(changed)
            with patch.object(qualification, "file_record", return_value={}), self.subTest(mutate=mutate), self.assertRaises(ValueError):
                qualification.support_declarations(changed)


class ComparisonTests(unittest.TestCase):
    def test_unequal_inputs_remain_unequal_and_false_equal_declared_record_rejects(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            current = sdk_input_fixture(root / "current")
            original = input_fixture(root / "original")
            original["context"]["baseImage"] = sdk.BASE_IMAGE
            rehash(original)
            row = next(item for item in current["backendInputs"]["components"]["worker"]["inputs"] if item["path"] == "src/worker.ts")
            row["sha256"] = "9" * 64
            rehash(current["backendInputs"])
            expected = compare_backend_inputs(current, original, expected_sdk_sha256=inputs.content_hash(current),
                expected_original_sha256=inputs.content_hash(original), original_revision="2" * 40)
            actual = qualification.record_comparison(current, original, expected, original_revision="2" * 40)
            self.assertFalse(actual["allInputsEqual"])
            self.assertFalse(actual["runtimeCompatibilityQualified"])
            self.assertFalse(actual["deploymentAuthorized"])
            forged = deepcopy(expected)
            forged["allInputsEqual"] = True
            with self.assertRaises(ValueError):
                qualification.record_comparison(current, original, forged, original_revision="2" * 40)

    def test_full_artifact_manifest_custody_mismatch_holds_before_graph_or_image_access(self):
        part = {"revision": "1" * 40, "bundleDir": "/unexecuted", "apiAdmission": {},
            "bundleManifestSha256": "a" * 64, "configDigests": {}, "loadArchive": None}
        with patch.object(qualification, "file_record", return_value={}), patch.object(qualification, "verify_downloaded",
                return_value={"provenance": {"bundleManifestSha256": "b" * 64}}), patch.object(qualification.local, "_graph", side_effect=AssertionError("No graph access expected")):
            with self.assertRaisesRegex(ValueError, "manifest differs"):
                qualification._full_artifact(part)


def synthetic_subreports(ids):
    """Declared unit fixtures only: never execute_reuse or actual qualification."""
    names = ["authenticated-baseline-and-local-web", "owned-retained-backend-and-two-web-runtimes", "compiled-caddy-and-initial-web",
        "native-browser-draft-and-authenticated-socket-before-switch", "forward-web-generation-switch",
        "persistent-old-tab-action-and-fresh-realtime-after-switch", "rollback-to-retained-web-generation", "stopped-candidate-automatically-restores-retained-web"]
    fresh_report = {"kind": "warpdrive-native-fresh-compose-smoke", "success": True, "cleanupSuccess": True,
        "manualReconciliationRequired": False, "deploymentAuthorized": False, "checks": {
            **{key: {"syntheticUnitMetadataOnly": True} for key in ("baseline", "candidate", "rollback", "injectedFailure", "cleanupDrain")},
            "newWebProducerRetainedWorker": {"completed": True, "producerImageId": ids["new_web"], "workerImageId": ids["worker"], "restartDurabilityQualified": False}}}
    mixed_report = {"success": True, "browserContinuityQualified": True, "deploymentAuthorized": False,
        "cleanup": {"success": True, "errors": []}, "checks": [{"name": name, "status": "passed", "detail": {"syntheticUnitMetadataOnly": True}} for name in names]}
    return fresh_report, mixed_report


class ReportAndBudgetTests(unittest.TestCase):
    def setUp(self):
        self.ids = {role: value["nativeImageId"] for role, value in selection_fixture().items()}

    def test_partial_failed_missing_queue_or_unresolved_cleanup_cannot_pass_shape_gate(self):
        good_fresh, good_mixed = synthetic_subreports(self.ids)
        self.assertTrue(qualification.subproofs_complete(good_fresh, good_mixed, selected_native_ids=self.ids))
        mutations = (
            lambda a, b: a.update(success=False), lambda a, b: a.update(cleanupSuccess=False),
            lambda a, b: a.update(manualReconciliationRequired=True), lambda a, b: b.update(browserContinuityQualified=False),
            lambda a, b: b["checks"].pop(), lambda a, b: b["checks"][0].update(status="failed"),
            lambda a, b: b["cleanup"]["errors"].append("owned-resource-unresolved"),
            lambda a, b: a["checks"].pop("newWebProducerRetainedWorker"),
            lambda a, b: a["checks"]["newWebProducerRetainedWorker"].update(producerImageId=self.ids["old_web"]),
            lambda a, b: a.update(deploymentAuthorized=True),
        )
        for mutate in mutations:
            a, b = deepcopy(good_fresh), deepcopy(good_mixed)
            mutate(a, b)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                qualification.subproofs_complete(a, b, selected_native_ids=self.ids)

    def test_native_executor_cannot_be_selected_by_synthetic_report_booleans(self):
        with patch.object(qualification.platform, "system", return_value="Darwin"), patch.object(qualification, "admit_reuse", side_effect=AssertionError("No admission expected")):
            with self.assertRaisesRegex(ValueError, "Actual native"):
                qualification.execute_reuse({}, Path("/unexecuted"), expected_handoff_sha256="a" * 64)

    def test_private_publication_alias_must_be_absent_and_owned_before_tagging(self):
        registry = qualification._PrivateRegistry.__new__(qualification._PrivateRegistry)
        registry.repository_prefix = "127.0.0.1:33333/wd-sdk-reuse-123456abcdef"
        registry.owned_tags = {}
        docker = SimpleNamespace(run=lambda *_args, **_kw: SimpleNamespace(returncode=0, stdout="[]", stderr=""))
        registry.docker = docker
        with self.assertRaises(ValueError):
            registry.tag_image(self.ids["worker"], registry.repository_prefix + "/worker:fixture")
        with self.assertRaises(ValueError):
            registry.tag_image(self.ids["worker"], "external.invalid/worker:fixture")

    def test_expired_command_and_low_disk_stop_before_docker_and_cleanup_window_is_not_renewed(self):
        docker = FakeDocker()
        bounded = qualification._BudgetDocker(docker, deadline=1, disk_root=Path("/unused"))
        with patch.object(qualification.time, "monotonic", return_value=2):
            with self.assertRaises(ValueError):
                bounded.run(["info"])
        self.assertEqual(docker.calls, [])
        bounded = qualification._BudgetDocker(docker, deadline=1000, disk_root=Path("/unused"))
        with patch.object(qualification.time, "monotonic", return_value=2), patch.object(qualification.shutil, "disk_usage", return_value=SimpleNamespace(free=0)):
            with self.assertRaises(ValueError): bounded.run(["info"])
            with bounded.cleanup_window(): bounded.run(["container", "rm", "owned-id"])
            first_limit = bounded.cleanup_limit
        with patch.object(qualification.time, "monotonic", return_value=5), bounded.cleanup_window():
            self.assertEqual(bounded.cleanup_limit, first_limit)
        self.assertEqual(len(docker.calls), 1)

    def test_unknown_native_command_latches_before_inherited_mixed_cleanup_and_keeps_docker_resources(self):
        docker = SimpleNamespace(run=lambda *_args, **_options: (_ for _ in ()).throw(qualification.fresh.FreshMutationUnknown("synthetic unknown")))
        bounded = qualification._BudgetDocker(docker, deadline=1000, disk_root=Path("/unused"))
        with patch.object(qualification.time, "monotonic", return_value=2), patch.object(qualification.shutil, "disk_usage", return_value=SimpleNamespace(free=8 * 1024**3)):
            with self.assertRaises(qualification.fresh.FreshMutationUnknown):
                bounded.run(["run", "owned-runtime"])
        self.assertTrue(bounded.unknown_outcome)
        fixture = qualification._PreloadedMixed.__new__(qualification._PreloadedMixed)
        fixture.docker = bounded
        fixture.browser, fixture.relays = None, []
        fixture.fixture = SimpleNamespace(cleanup=lambda: (_ for _ in ()).throw(AssertionError("Destructive cleanup forbidden")))
        self.assertFalse(fixture.cleanup_docker_allowed())
        cleanup = fixture.cleanup()
        self.assertFalse(cleanup["success"])
        self.assertFalse(cleanup["fixtureResourcesAbsent"])
        self.assertIn("owned-docker-unknown-native-command", cleanup["errors"])


class NewsletterStateTests(unittest.TestCase):
    """These are synthetic metadata cases, not installed newsletter acceptance."""

    def setUp(self):
        self.selection = selection_fixture()
        self.web = {"id": "a" * 64, "name": "/accepted-old-web", "imageId": self.selection["old_web"]["nativeImageId"],
            "pid": 101, "startedAt": "2026-11-14T10:00:00Z", "finishedAt": "0001-01-01T00:00:00Z", "restartCount": 0,
            "configSha256": "b" * 64, "project": "accepted", "service": "app"}
        self.chain = {"active": {"slot": {"runtime": {"runtimeId": self.web["id"], "imageId": self.web["imageId"], "name": "accepted-old-web"}}}}
        self.disabled = {"schemaVersion": 1, "kind": qualification.DISABLED_NEWSLETTER_KIND, "web": deepcopy(self.web),
            "configuration": {"integrationConfigured": False, "deliveryEnabled": False, "publicSignupEnabled": False}}
        self.protected = [{"running": True, "witness": deepcopy(self.web)}]

    def test_disabled_incumbent_allows_only_truthful_synthetic_engine_role(self):
        original = deepcopy((self.disabled, self.chain, self.selection, self.protected))
        result = qualification.newsletter_binding(self.disabled, self.chain, self.selection, self.protected)
        self.assertEqual(result, {"mode": "disabled-integration", "selectedEngineRole": "synthetic-fixture-only",
            "actualEngineWitnessPresent": False, "installedNewsletterAcceptance": False})
        self.assertNotEqual(self.web["imageId"], self.selection["engine"]["nativeImageId"])
        self.assertEqual((self.disabled, self.chain, self.selection, self.protected), original)

    def test_disabled_witness_is_closed_false_only_and_binds_actual_active_web(self):
        mutations = (
            lambda value: value.update(schemaVersion=True),
            lambda value: value.update(extra=False),
            lambda value: value["configuration"].update(integrationConfigured=True),
            lambda value: value["configuration"].update(deliveryEnabled=0),
            lambda value: value["configuration"].update(publicSignupEnabled=True),
            lambda value: value["configuration"].update(unknown=False),
            lambda value: value["web"].update(id="c" * 64),
            lambda value: value["web"].update(name="/another-web"),
            lambda value: value["web"].update(imageId=self.selection["new_web"]["nativeImageId"]),
        )
        for mutate in mutations:
            value = deepcopy(self.disabled)
            mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                qualification.newsletter_binding(value, self.chain, self.selection, self.protected)

    def test_complete_running_protected_incumbent_required_not_just_same_id(self):
        for protected in ([], [{"running": False, "witness": self.web}],
                          [{"running": True, "witness": self.web | {"configSha256": "f" * 64}}]):
            with self.subTest(protected=protected), self.assertRaises(ValueError):
                qualification.newsletter_binding(self.disabled, self.chain, self.selection, protected)
        selected = deepcopy(self.selection)
        selected["old_web"]["nativeImageId"] = selected["new_web"]["nativeImageId"]
        with self.assertRaises(ValueError):
            qualification.newsletter_binding(self.disabled, self.chain, selected, self.protected)

    def test_original_running_engine_still_requires_actual_selected_image_and_full_witness(self):
        actual = self.web | {"id": "c" * 64, "name": "/actual-engine", "imageId": self.selection["engine"]["nativeImageId"], "service": "newsletter-engine"}
        protected = self.protected + [{"running": True, "witness": actual}]
        self.assertEqual(qualification.newsletter_binding(actual, self.chain, self.selection, protected),
            {"mode": "running-engine", "selectedEngineRole": "actual-retained-engine", "actualEngineWitnessPresent": True,
             "installedNewsletterAcceptance": False})
        for witness, peers in ((actual | {"imageId": self.selection["new_web"]["nativeImageId"]}, protected),
                               (actual, self.protected), (actual | {"pid": 999}, protected)):
            with self.subTest(witness=witness, peers=peers), self.assertRaises(ValueError):
                qualification.newsletter_binding(witness, self.chain, self.selection, peers)


if __name__ == "__main__":
    unittest.main()
