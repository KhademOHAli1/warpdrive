"""Exercise repeat Web archive custody against independent A and B fixtures."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from candidate import CandidateError
import component_inputs as inputs
from test_component_inputs import rehash
from test_web_candidate import WebDocker, encoded, digest, phase
import test_web_repeat_inputs as repeat_fixture
import web_repeat_candidate as repeat
from web_candidate import REVISION_LABEL, load_web_bundle


STAMP = "2026-01-01T00:00:00.000000000Z"
TARGET = "wd-image-smoke-aaaaaaaaaaaa"
CURRENT, PROFILE = repeat_fixture.NEXT, repeat_fixture.PROFILE
TOOLS = "c" * 40
ORIGIN = {"kind": "github-actions", "repository": repeat.REPO, "event": "workflow_dispatch",
          "ref": "refs/heads/main", "runId": 72, "runAttempt": 1}


def slot(revision, image, name, salt, schema):
    runtime = {"runtimeId": salt * 64, "name": name, "imageId": image, "sourceRevision": revision,
               "configSha256": "b" * 64, "schemaSha256": schema, "restartCount": 0, "running": True}
    return {"runtime": runtime, "route": {"generation": "wd-" + revision, "runtimeId": runtime["runtimeId"],
                                         "fingerprint": salt * 64}}


class RepeatWebCandidateTests(unittest.TestCase):
    def setUp(self):
        fixture = repeat_fixture.WebRepeatInputsTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.composite, self.current, self.presentation = fixture.composite, fixture.next, fixture.presentation
        self.private = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="repeat-web-candidate-"))).resolve()
        self.root, self.output = self.private / "src", self.private / "out"
        self.root.mkdir()
        self.inputs_path, self.mixed_path = self.private / "inputs.json", self.private / "report.json"
        self.inputs_path.write_bytes(encoded(self.current))
        self.docker = WebDocker()
        self.docker.config["Labels"][REVISION_LABEL] = CURRENT
        self.docker.config["Env"][1:] = ["APP_COMMIT=" + CURRENT, "NEXT_DEPLOYMENT_ID=wd-" + CURRENT]
        self.docker.raw_config = encoded({"architecture": "amd64", "os": "linux", "config": self.docker.config,
                                          "rootfs": {"type": "layers", "diff_ids": ["sha256:" + digest(self.docker.layer)]}})
        self.docker.image_id = "sha256:" + digest(self.docker.raw_config)
        self.lineage = self.make_lineage()
        self.lineage_sha = inputs.content_hash(self.lineage)
        self.baseline = repeat._authority(self.composite, self.lineage_sha, self.lineage, CURRENT, TOOLS, ORIGIN)
        self.assembly = repeat._assembly(self.composite, self.baseline, repeat._image(self.docker.image_id, CURRENT))
        self.report = self.make_report()
        self.mixed_path.write_bytes(encoded(self.report))

    def make_lineage(self):
        def generation(bundle, salt, name, image_id, authority_sha):
            revision, provenance = bundle["sourceRevision"], bundle["provenance"]
            return {"alias": name, "receiptSha256": salt * 64,
                    "slot": slot(revision, image_id, name, salt, "7" * 64),
                    "provenance": {"repository": repeat.REPO, "revision": revision,
                                   "manifestSha256": provenance["bundleManifestSha256"],
                                   "archiveSha256": provenance["archiveSha256"],
                                   "testedConfigDigest": image_id, "authoritySha256": authority_sha}}

        active, original = (self.composite[key] for key in ("web", "backend"))
        return {"targetKey": "private-edge-identity", "backendFingerprint": "6" * 64,
                "acceptedOperationId": "private-first-operation", "acceptedPlanSha256": "5" * 64,
                "active": generation(active, "1", "private-active-web", active["image"]["imageId"],
                                     active["publicationReceiptSha256"]),
                "previous": generation(original, "2", "private-previous-web", "sha256:" + "2" * 64, "4" * 64)}

    def make_report(self):
        names = repeat.CHECKS
        image_ids = self.assembly["retainedBackendImages"]
        old, new = (self.assembly[key] for key in ("activeWebImage", "newWeb"))
        generations = [old["generation"], new["generation"]]
        schema = "3" * 64
        slots = {item["generation"]: slot(item["sourceRevision"], item["imageId"], f"{TARGET}-web-{suffix}", salt, schema)
                 for item, salt, suffix in zip((old, new), "89", "ab")}
        protected = {
            name: {"runtimeId": salt * 64, "imageId": image_ids.get(name, "sha256:" + salt * 64),
                   "restartCount": 0, "startedAt": STAMP, "configSha256": "a" * 64}
            for name, salt in zip(("postgres", "worker", "realtime", "caddy"), "4567")
        }
        backend = repeat.runtime_hash(protected)
        direct = {
            item["generation"]: {
                "identity": {"contract": "warpdrive.web.identity.v1", "component": "web", "version": "1.0.0",
                             "sourceRevision": item["sourceRevision"]},
                "pageAssetCount": 2, "assets": {
                    kind: {"path": f"/_next/static/fixture.{kind}?dpl={item['generation']}", "bytes": 15, "sha256": "c" * 64}
                    for kind in ("css", "js")
                },
            } for item in (old, new)
        }
        qualification = {"assembly": self.assembly, "protectedRuntimes": protected, "backendFingerprint": backend,
                         "webStartTimes": {item["runtime"]["name"]: STAMP for item in slots.values()},
                         "web": direct, "slots": slots}
        qualification_sha = repeat.runtime_hash(qualification)

        def transition(operation, state, generation, assets, writes):
            before, after = (reversed(generations) if operation == "rollback" else generations)
            plan = repeat._plan(operation, TARGET, slots[before], slots[after], backend, qualification_sha)
            return {"receipt": {"schemaVersion": 1, "kind": "warpdrive-web-rollout-receipt", "operationId": operation,
                                "planSha256": repeat.runtime_hash(plan), "state": state, "acceptedGeneration": generation,
                                "backendFingerprint": backend},
                    "ingress": {"activeGeneration": generation, "identity": direct[generation]["identity"],
                                "verifiedAssetGenerations": assets, "verifiedAssetsPerGeneration": 2,
                                "unknownGenerationStatus": 409, "backendFingerprint": backend, "schemaSha256": schema},
                    "routeWrites": writes, "repeatReadOnly": True}

        details = [
            self.assembly,
            {"schemaSha256": schema, "commonWebConfigSha256": "b" * 64, "migratorImageId": image_ids["migrator"],
             "migrations": {"successfulRuns": 2, "canonicalMigrationCount": 100, "emptyFiles": True,
                            "runtimeRole": "smoke_runtime", "ownerCredentialsRuntime": False, "deniedDdl": 5}},
            {"qualification": qualification, "qualificationSha256": qualification_sha},
            {"initial": phase("initial-ready"), "freshBoundBaselineSeed": True, "forgedSession": False, "matchingActivityRows": 0},
            transition("forward", "accepted", generations[1], generations, 1),
            {"preSwitch": phase("pre-switch-ready"), "complete": {**phase("complete"), "freshStampedPage": True},
             "matchingActivityRows": 1, "generatedLoopbackTls": True},
            transition("rollback", "accepted", generations[0], generations, 1),
            {**transition("candidate-fault", "rolled-back", generations[0], [generations[0]], 2), "candidateStopped": True},
        ]
        return {"schemaVersion": 2, "kind": "warpdrive-native-repeat-web-smoke", "scope": "owned-native-staging-fixture", "success": True,
                "revision": old["sourceRevision"], "startedAt": STAMP, "finishedAt": STAMP,
                "checks": [{"name": name, "status": "passed", "detail": detail} for name, detail in zip(names, details)],
                "images": self.assembly, "limitations": repeat.REPEAT_LIMITATIONS, "failure": None, "diagnostics": [],
                "cleanup": {"success": True, "errors": [], "fixtureResourcesAbsent": True,
                            "closedRelays": [dict(closed=True, openSockets=0, activeConnections=0, ownershipFailures=0,
                                                  streamLimitReached=0) for _ in range(5)]},
                "deploymentAuthorized": False, "browserContinuityQualified": True,
                "browserProfile": {"kind": repeat.REPEAT_BROWSER_PROFILE, "harnessRevision": TOOLS,
                                   "seedRevision": self.assembly["originalBackendRevision"]}}

    def create(self, *, tooling=None, **overrides):
        with patch.object(repeat, "verify_repeat_presentation_git", return_value=tooling) as git, \
                patch.object(inputs, "verify_current") as verify, patch.object(inputs, "verify_source_revision") as post:
            options = {"expected_revision": CURRENT, "composite": self.composite, "presentation": self.presentation,
                       "expected_installed_lineage_sha256": self.lineage_sha, "expected_profile_sha256": PROFILE,
                       "expected_harness_revision": TOOLS, "input_receipt_path": self.inputs_path,
                       "mixed_report_path": self.mixed_path, "candidate_web_image_id": self.docker.image_id,
                       "origin": ORIGIN, "docker": self.docker}
            result = repeat.create_repeat_web_bundle(self.root, self.output, **(options | overrides))
            git.assert_called_once_with(self.root, self.presentation, active_inputs=self.composite["web"]["inputReceipt"],
                                        active_revision=self.composite["web"]["sourceRevision"],
                                        tooling_revision=overrides.get("expected_tooling_revision"))
            verify.assert_called_once_with(self.root, self.current, expected_revision=CURRENT)
            post.assert_called_once_with(self.root, self.current, CURRENT)
            return result

    def load(self, manifest, **overrides):
        options = {"expected_revision": CURRENT, "expected_manifest_sha256": manifest, "composite": self.composite,
                   "expected_installed_lineage_sha256": self.lineage_sha, "expected_profile_sha256": PROFILE,
                   "expected_harness_revision": TOOLS, "expected_origin": ORIGIN}
        return repeat.load_repeat_web_bundle(self.output, **(options | overrides))

    def test_hosted_single_image_archive_reconstructs_offline_with_full_installed_lineage(self):
        value = self.create()
        result = self.load(value["provenance"]["bundleManifestSha256"], installed_lineage=self.lineage)
        self.assertEqual(value, result)
        self.assertEqual(self.docker.calls, [["image", "inspect", self.docker.image_id],
                         ["image", "save", "--platform", "linux/amd64", "--output", str(self.output / repeat.ARCHIVE),
                          self.docker.image_id], ["image", "inspect", self.docker.image_id]])
        candidate = result["candidate"]
        self.assertFalse(candidate["deploymentAuthorized"])
        self.assertEqual(candidate["baseline"]["installedLineageSha256"], self.lineage_sha)
        self.assertEqual(candidate["image"]["sourceRevision"], CURRENT)
        self.assertEqual(candidate["inputProvenance"]["buildComponents"], ["web"])
        for file in self.output.iterdir():
            if file.name != repeat.ARCHIVE:
                self.assertNotIn(b"private-edge-identity", file.read_bytes())
                self.assertNotIn(b"private-active-web", file.read_bytes())

    def test_external_lineage_harness_profile_and_origin_pins_are_required(self):
        value = self.create()
        manifest = value["provenance"]["bundleManifestSha256"]
        for change in ({"expected_installed_lineage_sha256": "0" * 64}, {"expected_harness_revision": "e" * 40},
                       {"expected_profile_sha256": "0" * 64}, {"expected_origin": {**ORIGIN, "runAttempt": 2}},
                       {"expected_tooling_revision": TOOLS},
                       {"installed_lineage": {**self.lineage, "acceptedPlanSha256": "0" * 64}}):
            with self.subTest(change=change), self.assertRaises(CandidateError):
                self.load(manifest, **change)
        with self.assertRaises(CandidateError):
            load_web_bundle(self.output, expected_revision=CURRENT, expected_manifest_sha256=manifest,
                            baseline_revision=self.composite["web"]["sourceRevision"],
                            baseline_manifest_sha256=self.baseline["activeWeb"]["bundleManifestSha256"],
                            expected_origin=ORIGIN)

    def test_wrong_c_image_fails_before_docker_or_output(self):
        with self.assertRaisesRegex(CandidateError, "Distinct immutable C"):
            self.create(candidate_web_image_id=self.assembly["activeWebImage"]["imageId"])
        self.assertFalse(self.output.exists())
        self.assertEqual(self.docker.calls, [])

    def test_explicit_tooling_transition_is_bound_and_cannot_downgrade(self):
        path = "scripts/deployment/web_repeat_source.py"
        records = self.current["components"]["web"]["inputs"]
        records.append({"path": path, "bytes": 7, "sha256": "0" * 64})
        records.sort(key=lambda row: row["path"])
        rehash(self.current)
        self.inputs_path.write_bytes(encoded(self.current))
        self.presentation["baselineRevision"] = TOOLS
        tooling = {"activeWebRevision": self.assembly["activeWebRevision"], "toolingRevision": TOOLS,
                   "candidateRevision": CURRENT, "toolingPaths": [path], "toolingSourceSha256": "e" * 64}
        value = self.create(tooling=tooling, expected_tooling_revision=TOOLS)
        self.assertEqual(value["candidate"]["inputProvenance"]["toolingTransition"], tooling)
        manifest = value["provenance"]["bundleManifestSha256"]
        self.assertEqual(self.load(manifest, expected_tooling_revision=TOOLS), value)
        for wrong in (None, "e" * 40):
            with self.subTest(tooling=wrong), self.assertRaisesRegex(CandidateError, "external pin"):
                self.load(manifest, expected_tooling_revision=wrong)

    def test_report_rejects_partial_mixed_authority_or_cleanup(self):
        mutations = (
            lambda r: r["checks"].pop(),
            lambda r: r["checks"][1]["detail"].update(migratorImageId=self.docker.image_id),
            lambda r: r["checks"][3]["detail"].update(matchingActivityRows=False),
            lambda r: r["checks"][5]["detail"]["complete"].pop("freshStampedPage"),
            lambda r: r["checks"][6]["detail"]["ingress"].update(verifiedAssetGenerations=[]),
            lambda r: r["checks"][7]["detail"].update(candidateStopped=False),
            lambda r: r["checks"][7]["detail"]["receipt"].update(acceptedGeneration=self.assembly["newWeb"]["generation"]),
            lambda r: r["checks"][4]["detail"]["receipt"].update(planSha256="e" * 64),
            lambda r: r["cleanup"]["closedRelays"][0].update(openSockets=1),
            lambda r: r["browserProfile"].update(seedRevision=CURRENT),
        )
        for index, mutation in enumerate(mutations):
            report = deepcopy(self.report)
            mutation(report)
            with self.subTest(index=index), self.assertRaises(CandidateError):
                repeat.validate_repeat_mixed_report(report, assembly=self.assembly, expected_harness_revision=TOOLS)

    def test_metadata_replacement_and_extra_archive_members_fail(self):
        value = self.create()
        manifest = value["provenance"]["bundleManifestSha256"]
        (self.output / repeat.MIXED).write_bytes(b"{}")
        with self.assertRaisesRegex(CandidateError, "metadata changed"):
            self.load(manifest)
        (self.output / "extra").touch()
        with self.assertRaisesRegex(CandidateError, "inventory"):
            self.load(manifest)


if __name__ == "__main__":
    unittest.main()
