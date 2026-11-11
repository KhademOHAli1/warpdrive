from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from candidate import COMPONENTS, PENDING, SMOKE_CHECKS
from registry_candidate import (
    DockerRegistryAdapter, PromotionUnknown, RegistryConflict, RegistryError, RemoteImage,
    candidate_tag, content_hash, promote_candidate, validate_repository_prefix,
)


REVISION = "a" * 40
PREFIX = "ghcr.io/example/warpdrive"
PROVENANCE = {"archiveSha256": "b" * 64, "bundleManifestSha256": "c" * 64}


def fixtures():
    components, local = {}, {}
    for index, name in enumerate(COMPONENTS, 1):
        image_id = f"sha256:{str(index) * 64}"
        components[name] = {"imageId": image_id, "runtimeUser": "bun", "registryRef": None}
        local[image_id] = {
            "Id": image_id, "Os": "linux", "Architecture": "amd64",
            "Config": {"User": "bun", "Labels": {"org.opencontainers.image.revision": REVISION}},
        }
    candidate = {
        "schemaVersion": 1, "kind": "warpdrive-image-candidate", "revision": REVISION,
        "platform": "linux/amd64", "components": components,
        "qualification": {"state": "image-smoke-passed", "reportSha256": "d" * 64,
                          "checks": list(SMOKE_CHECKS), "limitations": ["Synthetic local fixture only"]},
        "compatibility": "unassessed", "deploymentAuthorized": False, "pendingGates": list(PENDING),
    }
    return candidate, local


def manifest(image_id: str) -> dict:
    return {
        "schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": {"mediaType": "application/vnd.oci.image.config.v1+json",
                   "digest": image_id, "size": 100},
        "layers": [],
    }


class FakeRegistry:
    def __init__(self, local):
        self.local = copy.deepcopy(local)
        self.tags = {}
        self.manifests = {}
        self.pushes = []
        self.inspections = []
        self.outcomes = {}
        self.indeterminate = set()
        self.on_push = None
        self.after_push = None

    def inspect_local(self, image_id):
        self.inspections.append(image_id)
        return copy.deepcopy(self.local[image_id])

    def resolve_tag(self, tag):
        if tag in self.indeterminate:
            raise TimeoutError("synthetic registry timeout")
        return copy.deepcopy(self.tags.get(tag))

    def fetch_manifest(self, immutable_ref):
        return copy.deepcopy(self.manifests[immutable_ref])

    def seed(self, tag, image_id):
        body = manifest(image_id)
        digest = f"sha256:{hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()}"
        self.tags[tag] = RemoteImage(digest, body)
        self.manifests[f"{tag.rsplit(':', 1)[0]}@{digest}"] = copy.deepcopy(body)

    def push(self, image_id, tag):
        if self.on_push is not None:
            self.on_push(image_id, tag)
        self.pushes.append((image_id, tag))
        outcome = self.outcomes.get(tag)
        if outcome != "fail":
            self.seed(tag, image_id)
        if self.after_push is not None:
            self.after_push(image_id, tag)
        if outcome in {"fail", "lost-response"}:
            raise TimeoutError("synthetic lost push response")


class RegistryCandidateTest(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix="warpdrive-registry-unit-")
        self.addCleanup(scratch.cleanup)
        self.directory = Path(scratch.name)
        self.journal = self.directory / "publication.json"
        self.output = self.directory / "candidate.json"
        self.candidate, local = fixtures()
        self.registry = FakeRegistry(local)

    def tag(self, component="web", prefix=PREFIX):
        return candidate_tag(prefix, component, REVISION, self.candidate["components"][component]["imageId"])

    def promote(self, **changes):
        options = {
            "expected_revision": REVISION, "repository_prefix": PREFIX, "attempt_id": "run-1-attempt-1",
            "journal_path": self.journal, "output_path": self.output,
            "bundle_provenance": PROVENANCE, "adapter": self.registry,
        }
        options.update(changes)
        return promote_candidate(self.candidate, **options)

    def journal_payload(self):
        return json.loads(self.journal.read_text())["payload"]

    def rewrite_journal(self, transform):
        envelope = json.loads(self.journal.read_text())
        transform(envelope["payload"])
        envelope["sha256"] = content_hash(envelope["payload"])
        self.journal.write_text(json.dumps(envelope))

    def test_repository_prefix_rejects_options_schemes_tags_and_ambiguous_names(self):
        for value in (
            "", "--flag", "https://ghcr.io/example/app", "ghcr.io/Example/app", "ghcr.io/app:latest",
            "ghcr.io/app@sha256:123", "user:password@ghcr.io/app", "owner/app", "ghcr.io/a b",
            "ghcr.io//app", "ghcr.io/../app", "ghcr.io/", "localhost:70000/app", "ghcr..io/app",
        ):
            with self.subTest(value=value), self.assertRaises(RegistryError):
                validate_repository_prefix(value)
        self.assertEqual(validate_repository_prefix("localhost:5000/owned/warpdrive"),
                         "localhost:5000/owned/warpdrive")

    def test_candidate_tag_binds_source_and_tested_content_not_mutable_release_names(self):
        tag = self.tag()
        self.assertEqual(tag, f"{PREFIX}-web:candidate-{REVISION}-{'1' * 64}")
        self.assertLessEqual(len(tag.rsplit(":", 1)[1]), 128)
        self.assertNotEqual(tag, self.tag("worker"))
        with self.assertRaises(RegistryError):
            self.promote(attempt_id="unsafe/attempt")
        self.assertEqual(self.registry.pushes, [])

    def test_success_emits_only_verified_immutable_refs_and_preserves_all_boundaries(self):
        result = self.promote()
        self.assertEqual(len(self.registry.pushes), 4)
        self.assertEqual(result["pendingGates"], self.candidate["pendingGates"])
        self.assertEqual(result["compatibility"], "unassessed")
        self.assertIs(result["deploymentAuthorized"], False)
        self.assertEqual(result["provenance"]["archiveSha256"], PROVENANCE["archiveSha256"])
        self.assertEqual(json.loads(self.output.read_text()), result)
        self.assertEqual({row["state"] for row in self.journal_payload()["components"].values()}, {"VERIFIED"})
        for name, component in result["components"].items():
            self.assertIn("@sha256:", component["registryRef"])
            self.assertNotIn(":candidate-", component["registryRef"])
            self.assertEqual(self.registry.fetch_manifest(component["registryRef"])["config"]["digest"],
                             self.candidate["components"][name]["imageId"])

    def test_push_intent_is_written_and_fsynced_before_transport_mutates_registry(self):
        original_fsync = os.fsync
        with patch("registry_candidate.os.fsync", wraps=original_fsync) as synced:
            def inspect_intent(_image_id, tag):
                payload = self.journal_payload()
                name = next(name for name in COMPONENTS if payload["components"][name]["tag"] == tag)
                self.assertEqual(payload["components"][name]["state"], "INTENT")
                self.assertGreaterEqual(synced.call_count, 4)
            self.registry.on_push = inspect_intent
            self.promote()

    def test_matching_existing_candidates_are_adopted_without_any_push(self):
        for name in COMPONENTS:
            self.registry.seed(self.tag(name), self.candidate["components"][name]["imageId"])
        self.promote()
        self.assertEqual(self.registry.pushes, [])

    def test_conflicting_later_tag_rejects_before_any_fresh_component_push(self):
        self.registry.seed(self.tag("migrator"), self.candidate["components"]["worker"]["imageId"])
        with self.assertRaises(RegistryConflict):
            self.promote()
        self.assertEqual(self.registry.pushes, [])
        self.assertFalse(self.output.exists())

    def test_multi_platform_manifest_is_not_admitted_as_a_single_native_image(self):
        self.registry.tags[self.tag()] = RemoteImage(f"sha256:{'e' * 64}", {
            "schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
            "manifests": [{"digest": f"sha256:{'f' * 64}",
                           "platform": {"os": "linux", "architecture": "amd64"}}],
        })
        with self.assertRaises(RegistryError):
            self.promote()
        self.assertEqual(self.registry.pushes, [])

    def test_wrong_local_source_user_platform_or_image_is_rejected_before_external_write(self):
        image_id = self.candidate["components"]["web"]["imageId"]
        original = copy.deepcopy(self.registry.local[image_id])
        for changes in (
            {"Id": f"sha256:{'f' * 64}"}, {"Architecture": "arm64"}, {"Os": "windows"},
            {"Config": {"User": "root", "Labels": {"org.opencontainers.image.revision": REVISION}}},
            {"Config": {"User": "bun", "Labels": {"org.opencontainers.image.revision": "f" * 40}}},
        ):
            with self.subTest(changes=changes):
                self.registry.local[image_id] = {**original, **changes}
                with self.assertRaises(RegistryError):
                    self.promote()
                self.assertEqual(self.registry.pushes, [])
                self.assertFalse(self.journal.exists())

    def test_lost_push_response_is_recovered_by_readback_without_replaying_that_push(self):
        self.registry.outcomes[self.tag()] = "lost-response"
        with self.assertRaises(PromotionUnknown):
            self.promote()
        self.assertEqual(self.journal_payload()["components"]["web"]["state"], "UNKNOWN")
        result = self.promote()
        self.assertEqual(sum(tag == self.tag() for _, tag in self.registry.pushes), 1)
        self.assertEqual(len(self.registry.pushes), 4)
        self.assertEqual(result["publication"]["state"], "immutable-registry-configs-verified")

    def test_unknown_absent_push_stays_unknown_and_is_never_replayed(self):
        self.registry.outcomes[self.tag()] = "fail"
        with self.assertRaises(PromotionUnknown):
            self.promote()
        before = list(self.registry.pushes)
        self.registry.outcomes.clear()
        with self.assertRaises(PromotionUnknown):
            self.promote()
        self.assertEqual(self.registry.pushes, before)
        self.assertFalse(self.output.exists())

    def test_partial_publication_preserves_verified_first_image_and_blocks_later_writes(self):
        self.registry.outcomes[self.tag("worker")] = "fail"
        with self.assertRaises(PromotionUnknown):
            self.promote()
        rows = self.journal_payload()["components"]
        self.assertEqual([rows[name]["state"] for name in COMPONENTS],
                         ["VERIFIED", "UNKNOWN", "PENDING", "PENDING"])
        accepted_manifest = self.registry.fetch_manifest(rows["web"]["registryRef"])
        self.assertEqual(accepted_manifest["config"]["digest"], self.candidate["components"]["web"]["imageId"])
        with self.assertRaises(PromotionUnknown):
            self.promote()
        self.assertEqual(len(self.registry.pushes), 2)

    def test_crashed_intent_is_ambiguous_and_not_a_permission_to_retry(self):
        self.registry.outcomes[self.tag()] = "fail"
        with self.assertRaises(PromotionUnknown):
            self.promote()
        self.rewrite_journal(lambda payload: payload["components"]["web"].update(state="INTENT"))
        with self.assertRaises(PromotionUnknown):
            self.promote()
        self.assertEqual(len(self.registry.pushes), 1)
        self.assertEqual(self.journal_payload()["components"]["web"]["state"], "UNKNOWN")

    def test_postpush_readback_timeout_is_unknown_then_adopted_after_independent_recovery(self):
        self.registry.after_push = lambda _image, tag: self.registry.indeterminate.add(tag)
        with self.assertRaises(PromotionUnknown):
            self.promote()
        self.registry.after_push = None
        self.registry.indeterminate.clear()
        self.promote()
        self.assertEqual(len(self.registry.pushes), 4)

    def test_journal_checksum_tamper_and_changed_binding_reject_before_additional_push(self):
        self.registry.outcomes[self.tag()] = "fail"
        with self.assertRaises(PromotionUnknown):
            self.promote()
        original = self.journal.read_text()
        tampered = json.loads(original)
        tampered["payload"]["components"]["web"]["state"] = "PENDING"
        self.journal.write_text(json.dumps(tampered))
        with self.assertRaises(RegistryError):
            self.promote()
        self.journal.write_text(original)
        for changed in ({"attempt_id": "different-attempt"},
                        {"repository_prefix": "ghcr.io/example/other"},
                        {"bundle_provenance": {**PROVENANCE, "archiveSha256": "e" * 64}}):
            with self.subTest(changed=changed), self.assertRaises(RegistryError):
                self.promote(**changed)
        self.assertEqual(len(self.registry.pushes), 1)

    def test_inconsistent_resume_sequence_rejected_even_with_a_recomputed_checksum(self):
        self.registry.outcomes[self.tag()] = "fail"
        with self.assertRaises(PromotionUnknown):
            self.promote()
        def reorder(payload):
            payload["components"]["web"]["state"] = "PENDING"
            payload["components"]["worker"]["state"] = "UNKNOWN"
        self.rewrite_journal(reorder)
        with self.assertRaises(RegistryError):
            self.promote()
        self.assertEqual(len(self.registry.pushes), 1)

    def test_completed_resume_is_idempotent_and_remote_tag_drift_does_not_replace_output(self):
        original = self.promote()
        output_bytes = self.output.read_bytes()
        self.assertEqual(self.promote(), original)
        self.assertEqual(len(self.registry.pushes), 4)
        self.registry.seed(self.tag(), self.candidate["components"]["worker"]["imageId"])
        with self.assertRaises(RegistryConflict):
            self.promote()
        self.assertEqual(len(self.registry.pushes), 4)
        self.assertEqual(self.output.read_bytes(), output_bytes)
        self.assertEqual(self.registry.fetch_manifest(original["components"]["web"]["registryRef"])["config"]["digest"],
                         self.candidate["components"]["web"]["imageId"])

    def test_existing_unrelated_output_and_concurrent_journal_owner_block_publication(self):
        self.output.write_text("unrelated")
        with self.assertRaises(RegistryError):
            self.promote()
        self.assertEqual(self.registry.pushes, [])
        self.output.unlink()
        lock = self.journal.with_name(self.journal.name + ".lock")
        with lock.open("w") as owned:
            fcntl.flock(owned, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(RegistryError):
                self.promote()
        self.assertEqual(self.registry.pushes, [])

    def test_candidate_gate_removal_provenance_mismatch_and_symlinks_are_rejected(self):
        self.candidate["pendingGates"].remove(PENDING[0])
        with self.assertRaises(RegistryError):
            self.promote()
        self.candidate["pendingGates"] = list(PENDING)
        with self.assertRaises(RegistryError):
            self.promote(bundle_provenance={"archiveSha256": "bad"})
        target = self.directory / "unrelated.json"
        target.write_text("untouched")
        self.journal.symlink_to(target)
        with self.assertRaises(RegistryError):
            self.promote()
        self.assertEqual(target.read_text(), "untouched")
        self.assertEqual(self.registry.pushes, [])


class DockerRegistryAdapterTest(unittest.TestCase):
    def test_explicit_manifest_unknown_is_absent_but_auth_network_or_plain404_are_indeterminate(self):
        for detail, absent in (
            ("MANIFEST_UNKNOWN: manifest unknown", True),
            ("manifest unknown: unauthorized", False),
            ("unexpected status 404 Not Found", False),
            ("lookup registry: no such host", False),
            ("connection timed out", False),
        ):
            with self.subTest(detail=detail):
                docker = SimpleNamespace(run=lambda *_args, **_kw: SimpleNamespace(
                    returncode=1, stderr=detail, stdout=""))
                adapter = DockerRegistryAdapter(docker)
                if absent:
                    self.assertIsNone(adapter.resolve_tag("ghcr.io/example/app:candidate-fixture"))
                else:
                    with self.assertRaises(RegistryError):
                        adapter.resolve_tag("ghcr.io/example/app:candidate-fixture")

    def test_registry_digest_is_read_from_descriptor_not_hash_of_rendered_json(self):
        calls = []
        image_id = f"sha256:{'1' * 64}"
        digest = f"sha256:{'f' * 64}"
        def run(arguments, **_options):
            calls.append(arguments)
            document = {"digest": digest} if "--format" in arguments else manifest(image_id)
            return SimpleNamespace(returncode=0, stdout=json.dumps(document, indent=2), stderr="")
        adapter = DockerRegistryAdapter(SimpleNamespace(run=run))
        resolved = adapter.resolve_tag("ghcr.io/example/app:candidate-fixture")
        self.assertEqual(resolved.digest, digest)
        self.assertEqual(calls[1][-1], f"ghcr.io/example/app@{digest}")
        self.assertEqual(resolved.manifest["config"]["digest"], image_id)


if __name__ == "__main__":
    unittest.main()
