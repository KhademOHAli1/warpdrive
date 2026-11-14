"""Pure native-shaped readback cases; no Docker, filesystem or endpoint calls."""

from copy import deepcopy
from hashlib import sha256
import json
import unittest

import installed_web_runtime as legacy
import installed_web_sdk_runtime as sdk
import installed_web_successor as successor
from test_installed_web_operator import ALIAS, NETWORK_IDS, RUNTIME_SECRET, candidate_fixture
from web_switch import RUNTIME_KEYS, content_hash


AUTHORITY = "e" * 64
TESTED_CONFIG = "sha256:" + "9" * 64
SCHEMA = "d" * 64


def binding_for(row, authority=AUTHORITY, tested_config=TESTED_CONFIG):
    revision = legacy.environment(row["Config"])["APP_COMMIT"]
    return {"kind": "warpdrive-sdk-web-runtime-binding", "schemaVersion": 1,
            "publicationReceiptSha256": authority, "sourceRevision": revision,
            "imageId": row["Image"], "testedConfigDigest": tested_config,
            "profileId": sdk.PROFILE_ID, "command": list(sdk.COMMAND)}


class SdkRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.legacy_document, self.legacy_row = candidate_fixture()
        self.document, self.row = deepcopy(self.legacy_document), deepcopy(self.legacy_row)
        self.document["Cmd"] = list(sdk.COMMAND)
        self.row["Config"]["Cmd"] = list(sdk.COMMAND)
        self.binding = binding_for(self.row)

    def options(self, binding=None):
        binding = self.binding if binding is None else binding
        return {"binding": binding, "expected_binding_sha256": content_hash(binding),
                "authority_sha256": AUTHORITY, "tested_config_digest": TESTED_CONFIG,
                "network_ids": NETWORK_IDS, "runtime_secret": RUNTIME_SECRET}

    def verify(self, *, row=None, document=None, **options):
        return sdk.verify_candidate(self.row if row is None else row,
            self.document if document is None else document, alias=ALIAS, **(self.options() | options))

    def item(self):
        runtime = {**self.verify(), "schemaSha256": SCHEMA}
        return {"slot": {"runtime": runtime}, "alias": ALIAS,
                "provenance": {"authoritySha256": AUTHORITY, "revision": runtime["sourceRevision"],
                               "testedConfigDigest": TESTED_CONFIG}}

    def read(self, item=None, bindings=None):
        return sdk.read_admitted_web_slot(self.row, item=self.item() if item is None else item,
            network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET, schema_sha256=SCHEMA,
            sdk_bindings=bindings)

    def test_sdk_hash_binds_profile_and_command_without_adding_runtime_schema_keys(self):
        actual = self.verify()
        profile = sdk.installed_profile(self.row, image_id=self.row["Image"],
            revision=self.binding["sourceRevision"], **self.options())
        self.assertEqual(actual["configSha256"], content_hash(profile))
        self.assertEqual(profile["profileId"], sdk.PROFILE_ID)
        self.assertEqual(profile["command"], ["bun", "--bun", "next", "start"])
        self.assertEqual(set(actual) | {"schemaSha256"}, RUNTIME_KEYS)
        base = {key: value for key, value in profile.items() if key not in {"profileId", "command"}}
        self.assertNotEqual(content_hash(profile), content_hash(base))
        for key in ("profileId", "command"):
            changed = deepcopy(profile)
            changed[key] = "changed"
            self.assertNotEqual(content_hash(profile), content_hash(changed))

    def test_legacy_profile_shape_command_and_hash_remain_exact(self):
        document, row = self.legacy_document, self.legacy_row
        expected = {"environment": dict(item.split("=", 1) for item in document["Env"]),
                    "mounts": deepcopy(document["HostConfig"]["Mounts"]),
                    "limits": {key: deepcopy(document["HostConfig"][key]) for key in legacy.HOST_KEYS},
                    "healthcheck": deepcopy(document["Healthcheck"]), "networks": deepcopy(NETWORK_IDS)}
        profile = legacy.installed_profile(row, image_id=row["Image"],
            revision=self.binding["sourceRevision"], network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET)
        independent_hash = sha256(json.dumps(expected, sort_keys=True, separators=(",", ":"),
                                             ensure_ascii=False, allow_nan=False).encode()).hexdigest()
        self.assertEqual(profile, expected)
        self.assertEqual(content_hash(profile), independent_hash)
        self.assertEqual(legacy.COMMAND, ["bun", "node_modules/next/dist/bin/next", "start"])
        self.assertEqual(legacy.verify_candidate(row, document, alias=ALIAS, network_ids=NETWORK_IDS,
            runtime_secret=RUNTIME_SECRET)["configSha256"], independent_hash)

    def test_legacy_default_reader_and_validator_reject_sdk_command(self):
        with self.assertRaises(legacy.WebRuntimeError):
            legacy.verify_candidate(self.row, self.document, alias=ALIAS,
                network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET)
        with self.assertRaises(legacy.WebRuntimeError):
            successor.read_admitted_web_slot(self.row, item=self.item(), network_ids=NETWORK_IDS,
                runtime_secret=RUNTIME_SECRET, schema_sha256=SCHEMA)
        with self.assertRaises(legacy.WebRuntimeError):
            self.read()  # No SDK binding must NOT infer the profile from live Cmd.

    def test_binding_requires_external_publication_and_independent_record_hash(self):
        expected = {"expected_sha256": content_hash(self.binding), "authority_sha256": AUTHORITY,
                    "source_revision": self.binding["sourceRevision"], "image_id": self.binding["imageId"],
                    "tested_config_digest": TESTED_CONFIG}
        self.assertEqual(sdk.validate_runtime_binding(self.binding, **expected), self.binding)
        for change in ({"expected_sha256": "0" * 64}, {"authority_sha256": "0" * 64},
                       {"source_revision": "a" * 40}, {"image_id": TESTED_CONFIG},
                       {"tested_config_digest": self.binding["imageId"]}):
            with self.subTest(change=change), self.assertRaises(legacy.WebRuntimeError):
                sdk.validate_runtime_binding(self.binding, **(expected | change))

    def test_self_rehashed_wrong_kind_profile_command_source_image_or_config_cannot_pass(self):
        mutations = (
            lambda record: record.update(kind="legacy"),
            lambda record: record.update(schemaVersion=True),
            lambda record: record.update(profileId="warpdrive.sdk-full.web-runtime.v2"),
            lambda record: record.update(command=legacy.COMMAND.copy()),
            lambda record: record.update(command=["bun", "--bun", "next", "start", "--port", "80"]),
            lambda record: record.update(publicationReceiptSha256="0" * 64),
            lambda record: record.update(sourceRevision="a" * 40),
            lambda record: record.update(imageId=TESTED_CONFIG),
            lambda record: record.update(testedConfigDigest=self.binding["imageId"]),
            lambda record: record.update(extra=True),
            lambda record: record.pop("profileId"),
        )
        for mutate in mutations:
            record = deepcopy(self.binding)
            mutate(record)
            with self.subTest(record=record), self.assertRaises(legacy.WebRuntimeError):
                self.verify(binding=record, expected_binding_sha256=content_hash(record))

    def test_live_cmd_document_image_source_and_manifest_are_not_projected_away(self):
        mutations = (
            lambda row: row["Config"].update(Cmd=legacy.COMMAND.copy()),
            lambda row: row["Config"].update(Cmd=list(sdk.COMMAND) + ["--port", "80"]),
            lambda row: row["Config"].update(Image=TESTED_CONFIG),
            lambda row: row.update(Image=TESTED_CONFIG),
            lambda row: row["ImageManifestDescriptor"].update(digest=TESTED_CONFIG),
            lambda row: row["Config"].update(Env=[item.replace("APP_COMMIT=b", "APP_COMMIT=a")
                                                for item in row["Config"]["Env"]]),
        )
        for mutate in mutations:
            row = deepcopy(self.row)
            mutate(row)
            with self.subTest(mutate=mutate), self.assertRaises(legacy.WebRuntimeError):
                self.verify(row=row)
        document = deepcopy(self.document)
        document["Cmd"] = legacy.COMMAND.copy()
        with self.assertRaises(legacy.WebRuntimeError):
            self.verify(document=document)

    def test_native_privilege_secret_mount_limits_network_and_readiness_remain_strict(self):
        mutations = (
            lambda row: row["Config"].update(User="0:0"),
            lambda row: row["HostConfig"].update(Privileged=True),
            lambda row: row["HostConfig"].update(PortBindings={"3000/tcp": [{"HostPort": "80"}]}),
            lambda row: row["HostConfig"].update(Memory=0),
            lambda row: row["HostConfig"]["Mounts"][0].update(ReadOnly=False),
            lambda row: row["HostConfig"]["Mounts"][0].update(Source="/root/owner/postgres_admin_password"),
            lambda row: row["NetworkSettings"]["Networks"].pop(legacy.NETWORKS[1]),
            lambda row: row["Config"]["Env"].append("MIGRATION_DATABASE_URL=owner"),
            lambda row: row["Config"]["Labels"].update({"traefik.http.routers.bad.rule": "bad"}),
            lambda row: row.update(RestartCount=1),
            lambda row: row["State"].update(OOMKilled=True),
            lambda row: row["NetworkSettings"]["Networks"][legacy.NETWORKS[0]].update(EndpointID=""),
        )
        for mutate in mutations:
            row = deepcopy(self.row)
            mutate(row)
            with self.subTest(mutate=mutate), self.assertRaises(legacy.WebRuntimeError):
                self.verify(row=row, require_ready=True)

    def test_created_state_allows_only_base_created_network_exception(self):
        row = deepcopy(self.row)
        row["State"].update(Running=False, Status="created")
        for endpoint in row["NetworkSettings"]["Networks"].values():
            endpoint.update(NetworkID="", EndpointID="")
        self.assertFalse(self.verify(row=row, created=True)["running"])
        with self.assertRaises(legacy.WebRuntimeError):
            self.verify(row=row)
        with self.assertRaises(legacy.WebRuntimeError):
            self.verify(row=row, created=True, require_ready=True)

    def test_retained_sdk_requires_matching_authority_and_runtime_profile_hash(self):
        registry = {AUTHORITY: (self.binding, content_hash(self.binding))}
        profile = self.read(bindings=registry)
        self.assertEqual(profile["profileId"], sdk.PROFILE_ID)
        for mutate in (
            lambda item: item["provenance"].pop("authoritySha256"),
            lambda item: item["provenance"].update(authoritySha256="a" * 64),
            lambda item: item["provenance"].update(revision="a" * 40),
            lambda item: item["provenance"].update(testedConfigDigest=self.binding["imageId"]),
            lambda item: item["slot"]["runtime"].update(configSha256="0" * 64),
        ):
            item = self.item()
            mutate(item)
            with self.subTest(mutate=mutate), self.assertRaises(legacy.WebRuntimeError):
                self.read(item=item, bindings=registry)

    def test_retained_registry_is_authority_keyed_not_live_image_keyed(self):
        for registry in ({self.binding["imageId"]: (self.binding, content_hash(self.binding))},
                         {AUTHORITY: (self.binding, "0" * 64)},
                         {"a" * 64: (self.binding, content_hash(self.binding))}):
            with self.subTest(registry=registry), self.assertRaises(legacy.WebRuntimeError):
                self.read(bindings=registry)

    def test_legacy_dispatch_without_binding_preserves_original_hash(self):
        observed = legacy.verify_candidate(self.legacy_row, self.legacy_document, alias=ALIAS,
            network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET)
        item = {"slot": {"runtime": {**observed, "schemaSha256": SCHEMA}}, "alias": ALIAS}
        options = {"item": item, "network_ids": NETWORK_IDS, "runtime_secret": RUNTIME_SECRET,
                   "schema_sha256": SCHEMA}
        self.assertEqual(sdk.read_admitted_web_slot(self.legacy_row, **options),
                         successor.read_admitted_web_slot(self.legacy_row, **options))

    def test_projection_never_mutates_live_row_document_or_binding(self):
        before = deepcopy((self.row, self.document, self.binding))
        self.verify(require_ready=True)
        self.assertEqual((self.row, self.document, self.binding), before)


if __name__ == "__main__":
    unittest.main()
