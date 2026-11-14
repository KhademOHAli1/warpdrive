"""Daemon-free tests for authenticated native bootstrap custody and lifecycle."""

from copy import deepcopy
from contextlib import redirect_stdout
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
from tempfile import TemporaryDirectory, TemporaryFile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

from candidate import CandidateError
from engine_image_smoke import CONTEXT_LABEL, REQUIRED_CHECKS, UPSTREAM_SOURCE, engine_metadata
import fresh_compose_qualification as qualification
from image_smoke import COMPONENTS, SmokeError


REVISION = "a" * 40
ENGINE_REVISION = "b" * 40
WEB_REVISION = "c" * 40
CONTEXT = {"sha256": "d" * 64, "files": {"Dockerfile": "e" * 64}}


def row(identifier, revision=REVISION, user="bun"):
    return {"Id": identifier, "Os": "linux", "Architecture": "amd64", "Size": 1024,
            "Config": {"User": user, "Labels": {"org.opencontainers.image.revision": revision}}, "RepoDigests": []}


def engine_tar(*, legacy=False):
    config = {"os": "linux", "architecture": "amd64", "config": {"User": "65532:65532", "WorkingDir": "/listmonk",
        "Entrypoint": ["/usr/local/bin/warpdrive-engine-entrypoint.sh"], "Cmd": ["./listmonk"], "Env": [],
        "Labels": {"org.opencontainers.image.revision": ENGINE_REVISION, CONTEXT_LABEL: CONTEXT["sha256"],
                   "org.opencontainers.image.source": UPSTREAM_SOURCE}}}
    raw = json.dumps(config).encode()
    image_id = "sha256:" + sha256(raw).hexdigest()
    name = image_id[7:] + ".json" if legacy else "blobs/sha256/" + image_id[7:]
    manifest = [{"Config": name, "RepoTags": None, "Layers": ["layer.tar"]}]
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w") as archive:
        for path, data in ((name, raw), ("manifest.json", json.dumps(manifest).encode()), ("layer.tar", b"layer")):
            item = tarfile.TarInfo(path)
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
    inspection = {"Id": image_id, "Os": "linux", "Architecture": "amd64", "Config": config["config"]}
    image = engine_metadata([inspection], ENGINE_REVISION, CONTEXT["sha256"])
    return result.getvalue(), image, inspection


def engine_zip(*, extra=(), report_change=None):
    saved, image, inspection = engine_tar()
    report = {"success": True, "cleanup": {"success": True}, "expectedRevision": ENGINE_REVISION,
              "context": CONTEXT, "image": image, "checks": [{"name": name, "status": "passed"} for name in REQUIRED_CHECKS]}
    if report_change:
        report_change(report)
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("engine-image.tar", saved)
        archive.writestr("engine-image.tar.sha256", sha256(saved).hexdigest() + "  /runner/temp/production-engine/engine-image.tar\n")
        archive.writestr("smoke/report.json", json.dumps(report))
        for path, content in extra:
            archive.writestr(path, content)
    raw = data.getvalue()
    artifact = {"id": 81, "name": "engine", "sizeBytes": len(raw), "digest": "sha256:" + sha256(raw).hexdigest()}
    return raw, artifact, image, inspection


class OriginTests(unittest.TestCase):
    def setUp(self):
        self.environment = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_REPOSITORY": qualification.REPO,
                            "GITHUB_SHA": REVISION, "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main",
                            "GITHUB_RUN_ID": "100", "GITHUB_RUN_ATTEMPT": "2"}
        self.run = {"id": 100, "run_attempt": 2, "workflow_id": 12, "path": ".github/workflows/production-images.yml",
                    "head_sha": REVISION, "head_branch": "main", "event": "workflow_dispatch", "status": "in_progress",
                    "conclusion": None, "repository": {"id": 15}, "head_repository": {"id": 15}}
        self.api = Mock()
        self.api.request.side_effect = lambda endpoint: ({"full_name": qualification.REPO, "id": 15} if endpoint == f"repos/{qualification.REPO}" else
            {"id": 12, "path": ".github/workflows/production-images.yml"} if "workflows/" in endpoint else self.run)

    def test_current_origin_is_bound_to_actual_api_run(self):
        origin, repository = qualification.producer_origin(self.api, REVISION, self.environment)
        self.assertEqual(repository, 15)
        self.assertEqual(origin["runId"], 100)
        self.assertEqual(origin["runAttempt"], 2)

    def test_caller_origin_and_environment_cannot_replace_api_source(self):
        for field, value in (("head_sha", "f" * 40), ("run_attempt", 1), ("workflow_id", 13), ("head_repository", {"id": 16}),
                             ("path", ".github/workflows/foreign.yml"), ("status", "completed"), ("event", "pull_request")):
            with self.subTest(field=field):
                old = deepcopy(self.run)
                self.run[field] = value
                with self.assertRaises(CandidateError):
                    qualification.producer_origin(self.api, REVISION, self.environment)
                self.run = old

    def test_nonhosted_nondispatch_and_invalid_attempt_hold(self):
        for field, value in (("GITHUB_ACTIONS", "false"), ("RUNNER_ENVIRONMENT", "self-hosted"), ("GITHUB_REPOSITORY", "foreign/repo"),
                             ("GITHUB_RUN_ID", "--help"), ("GITHUB_RUN_ATTEMPT", "0"), ("GITHUB_EVENT_NAME", "push")):
            with self.subTest(field=field), self.assertRaises(CandidateError):
                qualification.producer_origin(self.api, REVISION, {**self.environment, field: value})

    def test_historical_engine_requires_actual_successful_runtime_step(self):
        api = Mock()
        run = {"id": 9, "run_attempt": 1, "head_sha": ENGINE_REVISION}
        job = {"name": qualification.ENGINE_JOB, "status": "completed", "conclusion": "success",
               "steps": [{"name": qualification.ENGINE_STEP, "conclusion": "success"}]}
        api.pages.return_value = [job]
        with patch.object(qualification, "successful_main_run", return_value=run) as verify, patch.object(qualification, "artifact_for_run", return_value={"id": 81}) as artifact:
            self.assertEqual(qualification.engine_origin(api, 9, ENGINE_REVISION, 15), {"id": 81})
            verify.assert_called_once_with(api, qualification.ENGINE_WORKFLOW, 9, ENGINE_REVISION, 15, events={"push", "workflow_dispatch"})
            self.assertEqual(artifact.call_args.kwargs["maximum"], qualification.MAX_ENGINE_ZIP)
            job["steps"][0]["conclusion"] = "skipped"
            with self.assertRaises(CandidateError):
                qualification.engine_origin(api, 9, ENGINE_REVISION, 15)

    def test_external_exception_text_cannot_enter_shareable_receipt(self):
        self.assertEqual(qualification.failure_fact(RuntimeError("password=private")), {"failureType": "RuntimeError"})
        self.assertEqual(qualification.failure_fact(qualification.QualificationError("Fixed admission fact")),
                         {"failureType": "QualificationError", "failureFact": "Fixed admission fact"})


class EngineCustodyTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory())).resolve()

    def extract(self, raw, artifact):
        archive = self.directory / "engine.zip"
        archive.write_bytes(raw)
        return qualification.extract_engine(archive, self.directory / "extracted", artifact)

    def test_api_hashed_engine_archive_is_privately_extracted(self):
        raw, artifact, image, _ = engine_zip()
        report, archive_hash = self.extract(raw, artifact)
        self.assertEqual(report["image"], image)
        self.assertEqual(stat.S_IMODE((self.directory / "extracted/engine-image.tar").stat().st_mode), 0o600)
        self.assertRegex(archive_hash, r"^[a-f0-9]{64}$")

    def test_caller_hash_cannot_override_api_artifact_digest(self):
        raw, artifact, _, _ = engine_zip()
        artifact["digest"] = "sha256:" + "0" * 64
        with self.assertRaises(CandidateError):
            self.extract(raw, artifact)

    def test_zip_traversal_and_symlink_hold_before_extraction(self):
        for name in ("../escape", "/absolute", "path\\escape"):
            with self.subTest(name=name):
                raw, artifact, _, _ = engine_zip(extra=[(name, "unsafe")])
                with self.assertRaises(CandidateError):
                    self.extract(raw, artifact)
                self.assertFalse((self.directory / "extracted").exists())

    def test_duplicate_required_member_holds(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            raw, artifact, _, _ = engine_zip(extra=[("smoke/report.json", "{}")])
        with self.assertRaises(CandidateError):
            self.extract(raw, artifact)

    def test_zip_symlink_holds_before_any_files_are_extracted(self):
        raw, _, _, _ = engine_zip()
        output = io.BytesIO(raw)
        with zipfile.ZipFile(output, "a") as archive:
            symlink = zipfile.ZipInfo("unsafe-link")
            symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(symlink, "../outside")
        raw = output.getvalue()
        artifact = {"sizeBytes": len(raw), "digest": "sha256:" + sha256(raw).hexdigest()}
        with self.assertRaises(CandidateError):
            self.extract(raw, artifact)
        self.assertFalse((self.directory / "extracted").exists())

    def test_saved_engine_original_identity_is_checked_before_load(self):
        for legacy in (False, True):
            raw, image, _ = engine_tar(legacy=legacy)
            path = self.directory / "saved.tar"
            path.write_bytes(raw)
            qualification.engine_archive_identity(path, image, ENGINE_REVISION, CONTEXT["sha256"])
            with self.assertRaises(Exception):
                qualification.engine_archive_identity(path, image, REVISION, CONTEXT["sha256"])

    def test_saved_engine_multiple_images_hold(self):
        raw, image, _ = engine_tar()
        saved = io.BytesIO()
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as old, tarfile.open(fileobj=saved, mode="w") as new:
            for entry in old:
                content = old.extractfile(entry).read()
                if entry.name == "manifest.json":
                    manifest = json.loads(content)
                    content = json.dumps(manifest + manifest).encode()
                    entry.size = len(content)
                new.addfile(entry, io.BytesIO(content))
        path = self.directory / "multiple.tar"
        path.write_bytes(saved.getvalue())
        with self.assertRaises(CandidateError):
            qualification.engine_archive_identity(path, image, ENGINE_REVISION, CONTEXT["sha256"])

    def test_engine_api_custody_rechecked_and_only_engine_archive_loaded_once(self):
        raw, artifact, image, inspection = engine_zip()
        args = SimpleNamespace(engine_run_id=9, engine_revision=ENGINE_REVISION, expected_revision=REVISION)
        docker = Mock()
        docker.json.return_value = [inspection]
        def fetch(_artifact, path):
            path.write_bytes(raw)
        with patch.object(qualification, "git_value", return_value="e" * 40), patch.object(qualification, "context_record", return_value=CONTEXT), patch.object(qualification, "engine_origin", return_value=artifact) as origin:
            actual, custody = qualification.authenticate_engine(Mock(), docker, args, 15, self.directory, fetch=fetch)
        self.assertEqual(actual, image)
        self.assertEqual(custody["revision"], ENGINE_REVISION)
        self.assertEqual(origin.call_count, 2)
        self.assertEqual(docker.run.call_count, 1)
        self.assertEqual(docker.run.call_args.args[0][:3], ["image", "load", "--input"])
        self.assertIn("engine-image.tar", docker.run.call_args.args[0][-1])
        self.assertEqual(json.loads((self.directory / "engine-load-progress.json").read_text())["state"],
                         "loaded-and-independently-verified")

    def test_nonzero_engine_load_or_missing_readback_holds_without_replay(self):
        raw, artifact, _image, inspection = engine_zip()
        args = SimpleNamespace(engine_run_id=9, engine_revision=ENGINE_REVISION, expected_revision=REVISION)
        for failure in (SmokeError("PRIVATE_COMMAND_DIAGNOSTIC"), qualification.FreshCommandUnknown("Owned deadline"), None):
            with self.subTest(failure=type(failure).__name__), TemporaryDirectory(dir=self.directory) as directory:
                docker = Mock()
                docker.run.side_effect = failure
                docker.json.return_value = [] if failure is None else [inspection]
                output = Path(directory)
                with patch.object(qualification, "git_value", return_value="e" * 40), \
                        patch.object(qualification, "context_record", return_value=CONTEXT), \
                        patch.object(qualification, "engine_origin", return_value=artifact), \
                        self.assertRaises(qualification.FreshMutationUnknown):
                    qualification.authenticate_engine(Mock(), docker, args, 15, output,
                        fetch=lambda _artifact, path: path.write_bytes(raw))
                docker.run.assert_called_once()
                self.assertTrue(qualification.pending_outcome(output))

    def test_changed_historical_source_projection_holds_before_download(self):
        args = SimpleNamespace(engine_run_id=9, engine_revision=ENGINE_REVISION, expected_revision=REVISION)
        fetch = Mock()
        docker = Mock()
        with patch.object(qualification, "git_value", side_effect=["a" * 40, "b" * 40]), self.assertRaises(CandidateError):
            qualification.authenticate_engine(Mock(), docker, args, 15, self.directory, fetch=fetch)
        fetch.assert_not_called()
        docker.run.assert_not_called()

    def test_nonliteral_engine_revision_holds_before_git_or_download(self):
        args = SimpleNamespace(engine_run_id=9, engine_revision="--help", expected_revision=REVISION)
        with patch.object(qualification, "git_value") as git, self.assertRaises(CandidateError):
            qualification.authenticate_engine(Mock(), Mock(), args, 15, self.directory, fetch=Mock())
        git.assert_not_called()

    def test_changed_api_artifact_holds_before_image_load(self):
        raw, artifact, _, _ = engine_zip()
        args = SimpleNamespace(engine_run_id=9, engine_revision=ENGINE_REVISION, expected_revision=REVISION)
        docker = Mock()
        with patch.object(qualification, "git_value", return_value="e" * 40), patch.object(qualification, "context_record", return_value=CONTEXT), patch.object(qualification, "engine_origin", side_effect=[artifact, {**artifact, "id": 82}]), self.assertRaises(CandidateError):
            qualification.authenticate_engine(Mock(), docker, args, 15, self.directory, fetch=lambda _a, path: path.write_bytes(raw))
        docker.run.assert_not_called()


class PreloadedAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.args = SimpleNamespace(expected_revision=REVISION, bundle_dir=self.directory / "bundle", web_scratch=self.directory / "scratch",
                                    web_build_proof=self.directory / "build.json", web_archive_proof=self.directory / "archive.json",
                                    storage_client_bin="mc")
        self.images = {}
        components = {}
        for index, role in enumerate(COMPONENTS, 1):
            identifier = "sha256:" + str(index) * 64
            self.images[identifier] = row(identifier)
            components[role] = {"imageId": identifier, "runtimeUser": "bun"}
        self.web_id = "sha256:" + "5" * 64
        self.images[self.web_id] = row(self.web_id, WEB_REVISION)
        self.proof = {"candidateWebImageId": self.web_id, "sourceDelta": {"releaseRevision": WEB_REVISION},
                      "availableDiskBytesAfterBuild": 5 * 1024**3, "sourceVerifiedAfterBuild": True}
        self.archive = {"image": {"imageId": self.web_id, "sourceRevision": WEB_REVISION, "runtimeUser": "bun", "generation": "wd-" + WEB_REVISION},
                        "archiveSha256": "e" * 64, "archiveSizeBytes": 100}
        self.args.web_build_proof.write_text(json.dumps(self.proof))
        self.args.web_archive_proof.write_text(json.dumps(self.archive))
        for index, role in enumerate(qualification.SUPPORT, 7):
            identifier = "sha256:" + format(index, "x") * 64
            reference = "fixture/" + role + "@sha256:" + format(index, "x") * 64
            setattr(self.args, role + "_image", reference)
            self.images[reference] = {**row(identifier), "RepoDigests": [reference]}
        self.origin = {"kind": "github-actions", "runId": 100}
        self.loaded = {"origin": self.origin, "candidate": {"components": components},
                       "provenance": {"bundleManifestSha256": "f" * 64, "archiveSha256": "e" * 64}}
        self.docker = Mock()
        self.docker.run.return_value.stdout = "linux x86_64"
        self.docker.json.side_effect = lambda arguments, **_kw: [self.images[arguments[2]]]
        self.enterContext(patch.object(qualification, "git_value", return_value=REVISION))
        self.enterContext(patch.object(qualification, "producer_origin", return_value=(self.origin, 15)))
        self.loader = self.enterContext(patch.object(qualification, "load_bundle", return_value=self.loaded))
        self.enterContext(patch.object(qualification, "verify_built", return_value=self.proof))
        self.enterContext(patch.object(qualification, "verify_saved_web_image", return_value=self.archive))
        self.engine = self.enterContext(patch.object(qualification, "authenticate_engine", return_value=({"id": "sha256:" + "6" * 64, "revision": ENGINE_REVISION}, {"artifact": {"id": 81}})))

    def admit(self):
        return qualification.admit_images(Mock(), self.docker, self.args, {}, self.directory)

    def test_authenticated_baseline_is_reused_without_reload_or_rebuild(self):
        roles, revisions, supports, custody = self.admit()
        self.assertEqual(len(roles), 6)
        self.assertEqual(revisions["engine"], ENGINE_REVISION)
        self.assertEqual(len(supports), 5)
        self.assertEqual(custody["producer"], self.origin)
        self.loader.assert_called_once_with(self.args.bundle_dir, expected_revision=REVISION)
        self.assertEqual(self.docker.run.call_args_list[0].args[0][0], "info")
        self.assertFalse(any(call.args[0][:2] == ["image", "load"] for call in self.docker.run.call_args_list))

    def test_forged_bundle_origin_holds_before_engine_transport(self):
        self.loaded["origin"] = {"kind": "local"}
        with self.assertRaises(CandidateError):
            self.admit()
        self.engine.assert_not_called()

    def test_baseline_id_platform_and_runtime_user_are_bound(self):
        identifier = self.loaded["candidate"]["components"]["worker"]["imageId"]
        for change in ({"Id": self.web_id}, {"Architecture": "arm64"}, {"Config": {"User": "root", "Labels": {"org.opencontainers.image.revision": REVISION}}}):
            with self.subTest(change=change):
                original = self.images[identifier]
                self.images[identifier] = {**original, **change}
                with self.assertRaises(Exception):
                    self.admit()
                self.images[identifier] = original

    def test_support_mutable_missing_digest_or_wrong_platform_holds_before_engine(self):
        reference = self.args.caddy_image
        for change in ({"RepoDigests": []}, {"Architecture": "arm64"}):
            original = self.images[reference]
            self.images[reference] = {**original, **change}
            with self.assertRaises(CandidateError):
                self.admit()
            self.images[reference] = original
        self.args.caddy_image = "caddy:latest"
        with self.assertRaises(CandidateError):
            self.admit()
        self.engine.assert_not_called()

    def test_archive_proof_must_match_actual_retained_bytes(self):
        self.args.web_archive_proof.write_text(json.dumps({**self.archive, "archiveSha256": "0" * 64}))
        with self.assertRaises(CandidateError):
            self.admit()
        self.engine.assert_not_called()

    def alias_support(self, first, second):
        first_ref, second_ref = (getattr(self.args, role + "_image") for role in (first, second))
        self.images[second_ref] = {**deepcopy(self.images[first_ref]), "RepoDigests": [first_ref, second_ref]}

    def test_bundled_mcli_explicitly_admits_only_storage_client_identity_alias(self):
        self.args.storage_client_bin = "mcli"
        self.alias_support("storage", "storage_init")
        _, _, supports, _ = self.admit()
        self.assertEqual(supports["storage"]["imageId"], supports["storage_init"]["imageId"])

    def test_default_mc_rejects_storage_client_identity_alias(self):
        self.alias_support("storage", "storage_init")
        with self.assertRaises(CandidateError):
            self.admit()
        self.engine.assert_not_called()

    def test_mcli_rejects_every_other_support_role_alias(self):
        self.args.storage_client_bin = "mcli"
        for first, second in (("caddy", "postgres"), ("registry", "storage"), ("storage_init", "caddy")):
            with self.subTest(pair=(first, second)):
                original = deepcopy(self.images)
                self.alias_support(first, second)
                with self.assertRaises(CandidateError):
                    self.admit()
                self.images = original
        self.engine.assert_not_called()

    def test_mcli_cannot_hide_application_identity_as_storage_pair(self):
        self.args.storage_client_bin = "mcli"
        for role in ("storage", "storage_init"):
            self.images[getattr(self.args, role + "_image")]["Id"] = self.web_id
        with self.assertRaises(CandidateError):
            self.admit()
        self.engine.assert_not_called()

    def test_build_proof_must_match_actual_reverified_source(self):
        self.args.web_build_proof.write_text(json.dumps({**self.proof, "sourceVerifiedAfterBuild": False}))
        with self.assertRaises(CandidateError):
            self.admit()
        self.engine.assert_not_called()


class RegistrySessionTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.args = SimpleNamespace(output_dir=self.directory, bundle_dir=self.directory / "bundle", expected_revision=REVISION)
        self.roles = {role: "sha256:" + str(index) * 64 for index, role in enumerate(("web", "worker", "realtime", "migrator", "candidate_web", "engine"), 1)}
        self.revisions = {role: ENGINE_REVISION if role == "engine" else WEB_REVISION if role == "candidate_web" else REVISION for role in self.roles}
        self.supports = {role: {"reference": "support/" + role + "@sha256:" + format(index, "x") * 64} for index, role in enumerate(qualification.SUPPORT, 7)}
        self.references = {role: "127.0.0.1:43210/owned/" + role + "@sha256:" + str(index) * 64 for index, role in enumerate(self.roles, 1)}
        self.registry = Mock(prefix="owned-registry")
        self.registry.cleanup.return_value = []
        self.factory = Mock(return_value=self.registry)
        self.events = []

    def session(self, fresh=None, recovery=None):
        self.registry.cleanup.side_effect = lambda: self.events.append("registry-cleanup") or []
        with patch.object(qualification, "publish_roles", return_value=self.references):
            return qualification.exercise_session(Mock(), self.args, self.roles, self.revisions, self.supports,
                fresh=fresh or (lambda *_args, **_kwargs: {"success": True, "cleanupSuccess": True}), recovery=recovery, registry_factory=self.factory)

    def test_registry_survives_both_fixtures_and_cleanup_order_is_explicit(self):
        def fresh(baseline, candidate, *, storage_client_bin):
            self.events.append("fresh-cleanup")
            self.assertEqual({**candidate, "app": baseline["app"]}, baseline)
            self.assertEqual(len(baseline), 10)
            self.assertEqual(storage_client_bin, "mc")
            return {"success": True, "cleanupSuccess": True}

        def recovery(*_):
            self.events.append("recovery-cleanup")
            self.registry.cleanup.assert_not_called()
            return {"success": True, "cleanupSuccess": True}

        receipt = self.session(fresh, recovery)
        self.assertTrue(receipt["success"])
        self.assertFalse(receipt["deploymentAuthorized"])
        self.assertFalse(receipt["nativeExecutionPending"])
        self.assertEqual(self.events, ["fresh-cleanup", "recovery-cleanup", "registry-cleanup"])
        self.assertEqual(self.factory.call_args.kwargs, {"registry_image": self.supports["registry"]["reference"], "registry_preloaded": True})
        self.assertEqual(stat.S_IMODE((self.directory / "baseline-images.env").stat().st_mode), 0o600)

    def test_explicit_mcli_is_forwarded_to_fresh_fixture(self):
        self.args.storage_client_bin = "mcli"
        fresh = Mock(return_value={"success": True, "cleanupSuccess": True})
        receipt = self.session(fresh=fresh)
        self.assertTrue(receipt["success"])
        self.assertEqual(receipt["storageClientBinary"], "mcli")
        self.assertEqual(fresh.call_args.kwargs, {"storage_client_bin": "mcli"})
        for phase in ("baseline", "candidate"):
            self.assertIn("WARPDRIVE_STORAGE_CLIENT_BIN=mcli\n", (self.directory / f"{phase}-images.env").read_text())

    def test_cli_explicit_mcli_is_forwarded_to_recovery_fixture(self):
        output = self.directory / "qualification"
        argv = ["--run-native", "--bundle-dir", str(self.args.bundle_dir), "--web-scratch", str(self.directory / "scratch"),
                "--web-build-proof", str(self.directory / "build.json"), "--web-archive-proof", str(self.directory / "archive.json"),
                "--output-dir", str(output), "--expected-revision", REVISION, "--engine-revision", ENGINE_REVISION,
                "--engine-run-id", "9", "--with-recovery", "--storage-client-bin", "mcli", "--restic", "/fixture/restic",
                "--restic-sha256", "d" * 64, "--pg-control", "/fixture/pg_controldata", "--pg-control-sha256", "e" * 64]
        for role in qualification.SUPPORT:
            argv.extend(("--" + role.replace("_", "-") + "-image", self.supports[role]["reference"]))

        def session(_docker, _args, _roles, _revisions, _supports, *, recovery):
            recovery({"app": "baseline"}, {"app": "candidate"})
            return {"success": True}

        with patch.object(qualification, "_native_host"), patch.object(qualification.os, "geteuid", return_value=0), \
                patch.object(qualification, "IsolatedDocker") as docker_factory, patch.object(qualification, "GitHub"), \
                patch.object(qualification, "admit_images", return_value=(self.roles, self.revisions, self.supports, {})), \
                patch.object(qualification, "exercise_session", side_effect=session), \
                patch("fresh_compose_recovery_smoke.run") as recovery, redirect_stdout(io.StringIO()):
            self.assertEqual(qualification.main(argv), 0)
        self.assertEqual(recovery.call_args.kwargs["storage_client_bin"], "mcli")
        self.assertEqual(recovery.call_args.kwargs["output_parent"], output)
        docker_factory.assert_called_once_with(output / "docker", runner=qualification.run_owned_fixture_command)

    def test_source_admission_failure_cannot_reach_privileged_recovery(self):
        output = self.directory / "held-before-recovery"
        argv = ["--run-native", "--bundle-dir", str(self.args.bundle_dir), "--web-scratch", str(self.directory / "scratch"),
                "--web-build-proof", str(self.directory / "build.json"), "--web-archive-proof", str(self.directory / "archive.json"),
                "--output-dir", str(output), "--expected-revision", REVISION, "--engine-revision", ENGINE_REVISION,
                "--engine-run-id", "9", "--with-recovery", "--sudo-recovery", "--restic", "/fixture/restic",
                "--restic-sha256", "d" * 64, "--pg-control", "/fixture/pg_controldata", "--pg-control-sha256", "e" * 64]
        for role in qualification.SUPPORT:
            argv.extend(("--" + role.replace("_", "-") + "-image", self.supports[role]["reference"]))
        with patch.object(qualification, "_native_host"), patch.object(qualification.os, "geteuid", return_value=1001), \
                patch.object(qualification, "IsolatedDocker"), patch.object(qualification, "GitHub"), \
                patch.object(qualification, "admit_images", side_effect=qualification.QualificationError("source admission held")), \
                patch.object(qualification.subprocess, "Popen") as process, patch.object(qualification, "sudo_recovery") as privileged, \
                redirect_stdout(io.StringIO()), patch.object(qualification.sys, "stderr", io.StringIO()):
            self.assertEqual(qualification.main(argv), 1)
        process.assert_not_called()
        privileged.assert_not_called()
        self.assertEqual(json.loads((output / "report.json").read_bytes())["state"], "held")

    def test_sudo_callback_runs_only_after_ordinary_admission_and_preserves_runner_owner(self):
        output = self.directory / "runner-owned-qualification"
        argv = ["--run-native", "--bundle-dir", str(self.args.bundle_dir), "--web-scratch", str(self.directory / "scratch"),
                "--web-build-proof", str(self.directory / "build.json"), "--web-archive-proof", str(self.directory / "archive.json"),
                "--output-dir", str(output), "--expected-revision", REVISION, "--engine-revision", ENGINE_REVISION,
                "--engine-run-id", "9", "--with-recovery", "--sudo-recovery", "--storage-client-bin", "mcli",
                "--restic", "/fixture/restic", "--restic-sha256", "d" * 64,
                "--pg-control", "/fixture/pg_controldata", "--pg-control-sha256", "e" * 64]
        for role in qualification.SUPPORT:
            argv.extend(("--" + role.replace("_", "-") + "-image", self.supports[role]["reference"]))
        events = []
        owner = os.geteuid()

        def admit(*_args):
            events.append("ordinary-source-api-archive-admission")
            self.assertEqual(output.stat().st_uid, owner)
            return self.roles, self.revisions, self.supports, {}

        def session(_docker, _args, _roles, _revisions, _supports, *, recovery):
            self.assertEqual(events, ["ordinary-source-api-archive-admission"])
            recovery({"app": "baseline"}, {"app": "candidate"})
            return {"success": True}

        # Model the ordinary-runner branch even when the pure suite itself runs
        # as root; keep the actual filesystem-owner witness unchanged.
        with patch.object(qualification.os, "geteuid", return_value=owner or 1001), \
                patch.object(qualification, "_native_host"), patch.object(qualification, "IsolatedDocker"), \
                patch.object(qualification, "GitHub"), patch.object(qualification, "admit_images", side_effect=admit), \
                patch.object(qualification, "exercise_session", side_effect=session), \
                patch.object(qualification, "sudo_recovery", side_effect=lambda *_args, **_kw: events.append("cold-callback")) as privileged, \
                patch("fresh_compose_recovery_smoke.run") as inprocess, redirect_stdout(io.StringIO()):
            self.assertEqual(qualification.main(argv), 0)
        self.assertEqual(events, ["ordinary-source-api-archive-admission", "cold-callback"])
        self.assertEqual(output.stat().st_uid, owner)
        self.assertEqual(privileged.call_args.kwargs["storage_client_bin"], "mcli")
        inprocess.assert_not_called()

    def test_unknown_fresh_cleanup_preserves_registry_and_private_configuration(self):
        receipt = self.session(lambda *_args, **_kwargs: {"success": False, "cleanupSuccess": False})
        self.assertFalse(receipt["success"])
        self.assertTrue(receipt["manualReconciliationRequired"])
        self.assertEqual(receipt["retainedRegistryOwner"], "owned-registry")
        self.registry.cleanup.assert_not_called()
        self.assertTrue((self.directory / "candidate-images.env").is_file())

    def test_nonzero_unknown_or_interrupted_publication_holds_without_cleanup_or_replay(self):
        for error in (SmokeError("PRIVATE_COMMAND_DIAGNOSTIC"),
                      qualification.FreshCommandUnknown("Owned deadline"), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                fresh = Mock()
                self.registry.cleanup.reset_mock()
                with patch.object(qualification, "publish_roles", side_effect=error) as publish:
                    receipt = qualification.exercise_session(Mock(), self.args, self.roles, self.revisions, self.supports,
                        fresh=fresh, registry_factory=self.factory)
                publish.assert_called_once()
                fresh.assert_not_called()
                self.registry.cleanup.assert_not_called()
                self.assertTrue(receipt["mutationOutcomeUnknown"])
                self.assertTrue(receipt["manualReconciliationRequired"])
                self.assertEqual(receipt["retainedRegistryOwner"], self.registry.prefix)
                self.assertNotIn("PRIVATE_COMMAND_DIAGNOSTIC", json.dumps(receipt))
                self.assertTrue(qualification.pending_outcome(self.directory))

    def test_failed_intent_persistence_prevents_publication(self):
        with patch.object(qualification, "write_progress", side_effect=OSError("disk unavailable")), \
                patch.object(qualification, "publish_roles") as publish:
            receipt = qualification.exercise_session(Mock(), self.args, self.roles, self.revisions, self.supports,
                registry_factory=self.factory)
        publish.assert_not_called()
        self.registry.cleanup.assert_not_called()
        self.assertTrue(receipt["manualReconciliationRequired"])
        self.assertFalse(receipt["success"])

    def test_publication_waits_for_file_rename_and_directory_durability(self):
        events = []
        real_sync, real_replace = os.fsync, os.replace

        def sync(descriptor):
            events.append("directory-sync" if stat.S_ISDIR(os.fstat(descriptor).st_mode) else "file-sync")
            return real_sync(descriptor)

        def replace(*args, **options):
            events.append("rename")
            return real_replace(*args, **options)

        def publish(*_args):
            self.assertEqual(events, ["file-sync", "rename", "directory-sync"])
            return self.references

        with patch.object(qualification.os, "fsync", side_effect=sync), \
                patch.object(qualification.os, "replace", side_effect=replace), \
                patch.object(qualification, "publish_roles", side_effect=publish):
            receipt = qualification.exercise_session(Mock(), self.args, self.roles, self.revisions, self.supports,
                fresh=lambda *_args, **_kw: {"success": True, "cleanupSuccess": True}, registry_factory=self.factory)
        self.assertTrue(receipt["success"])

    def test_directory_sync_failure_prevents_publication(self):
        real_sync = os.fsync

        def sync(descriptor):
            if stat.S_ISDIR(os.fstat(descriptor).st_mode):
                raise OSError("directory sync unavailable")
            return real_sync(descriptor)

        with patch.object(qualification.os, "fsync", side_effect=sync), \
                patch.object(qualification, "publish_roles") as publish:
            receipt = qualification.exercise_session(Mock(), self.args, self.roles, self.revisions, self.supports,
                registry_factory=self.factory)
        publish.assert_not_called()
        self.registry.cleanup.assert_not_called()
        self.assertTrue(receipt["manualReconciliationRequired"])

    def test_fresh_manual_hold_preserves_registry_even_if_cleanup_flag_is_true(self):
        receipt = self.session(lambda *_args, **_kwargs: {"success": True, "cleanupSuccess": True,
                                                        "manualReconciliationRequired": True})
        self.assertTrue(receipt["manualReconciliationRequired"])
        self.registry.cleanup.assert_not_called()

    def test_unknown_recovery_cleanup_preserves_registry(self):
        receipt = self.session(recovery=lambda *_: {"success": False, "cleanupSuccess": False})
        self.assertTrue(receipt["manualReconciliationRequired"])
        self.registry.cleanup.assert_not_called()

    def test_recovery_manual_hold_preserves_registry_even_if_cleanup_flag_is_true(self):
        receipt = self.session(recovery=lambda *_: {"success": False, "cleanupSuccess": True, "manualReconciliationRequired": True})
        self.assertTrue(receipt["manualReconciliationRequired"])
        self.registry.cleanup.assert_not_called()

    def test_failed_but_clean_fixture_still_removes_owned_registry(self):
        receipt = self.session(lambda *_args, **_kwargs: {"success": False, "cleanupSuccess": True})
        self.assertFalse(receipt["success"])
        self.assertTrue(receipt["registryCleanupSuccess"])
        self.registry.cleanup.assert_called_once()

    def test_registry_cleanup_ownership_failure_never_reports_success(self):
        self.registry.cleanup.side_effect = RuntimeError("ownership changed")
        with patch.object(qualification, "publish_roles", return_value=self.references):
            receipt = qualification.exercise_session(Mock(), self.args, self.roles, self.revisions, self.supports,
                fresh=lambda *_args, **_kwargs: {"success": True, "cleanupSuccess": True}, registry_factory=self.factory)
        self.assertFalse(receipt["success"])
        self.assertTrue(receipt["manualReconciliationRequired"])
        self.assertEqual(receipt["registryCleanupFailureType"], "RuntimeError")

    def test_six_role_publication_is_bound_to_manifest_config_and_local_digest(self):
        docker = Mock()
        registry = Mock(repository_prefix="127.0.0.1:43210/owned")
        current = {}

        def push(image, tag):
            current["image"] = image

        registry.adapter.push.side_effect = push
        registry.client.manifest.side_effect = lambda _tag: ("sha256:" + current["image"][7:], {"config": {"digest": current["image"]}})
        registry.client.verify_config.side_effect = lambda _ref, image, _revision: {"imageId": image}

        def inspect(arguments, **_kw):
            reference = arguments[2]
            if "@" in reference:
                return [{"Id": current["image"], "RepoDigests": [reference]}]
            role = next(role for role, image in self.roles.items() if image == reference)
            return [row(reference, self.revisions[role])]

        docker.json.side_effect = inspect
        refs = qualification.publish_roles(registry, docker, self.roles, self.revisions)
        self.assertEqual(len(refs), 6)
        self.assertEqual(registry.image_ids, self.roles)
        self.assertEqual(registry.adapter.push.call_count, 6)
        self.assertEqual(registry.client.verify_config.call_count, 6)
        self.assertEqual(COMPONENTS, ("web", "worker", "realtime", "migrator"))

    def test_local_digest_substitution_holds_after_independent_manifest_readback(self):
        docker = Mock()

        def inspect(arguments, **_kw):
            reference = arguments[2]
            if "@" in reference:
                return [{"Id": self.roles["web"], "RepoDigests": []}]
            role = next(role for role, image in self.roles.items() if image == reference)
            return [row(reference, self.revisions[role])]

        docker.json.side_effect = inspect
        registry = Mock(repository_prefix="127.0.0.1:43210/owned")
        registry.client.manifest.return_value = ("sha256:" + "a" * 64, {})
        registry.client.verify_config.return_value = {"imageId": self.roles["web"]}
        with self.assertRaises(CandidateError):
            qualification.publish_roles(registry, docker, self.roles, self.revisions)


class PrivilegedRecoveryTransportTests(unittest.TestCase):
    """Real local byte streams, fake process boundary; no sudo or native fixture runs."""

    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.baseline = {service: "fixture.invalid/" + service + "@sha256:" + f"{index:064x}"
                         for index, service in enumerate(sorted({name for names in qualification.IMAGES.values() for name in names}), 1)}
        self.candidate = {**self.baseline, "app": "fixture.invalid/new-web@sha256:" + "a" * 64}
        self.options = {"restic": Path("/fixture/restic"), "restic_pin": "b" * 64,
                        "pg_control": Path("/fixture/pg_controldata"), "pg_control_pin": "c" * 64,
                        "output_parent": self.directory, "storage_client_bin": "mcli"}
        self.request = qualification.recovery_request(self.baseline, self.candidate, **self.options)
        self.result = {"schemaVersion": 1, "kind": qualification.RECOVERY_KIND, "success": True, "cleanupSuccess": True,
            "manualReconciliationRequired": False, "fixtureWritersMayBeRunning": False,
            "sourceWritersStopped": True, "sourceAbsentAtIndependentRestore": True,
            "writerSlotRevoked": True, "applicationRecoveryAccepted": False,
            "offHostAccepted": False, "keyCustodyAccepted": False, "writerResumptionAuthorized": False,
            "storageClientBin": "mcli", "project": "wd-fresh-" + "d" * 16,
            "outputDirectory": str(self.directory / "recovery-root/wd-fresh-recovery-abcdefgh"),
            "recovery": {"snapshotId": "d" * 64, "manifestSha256": "e" * 64, "receiptSha256": "f" * 64,
                         "restoredBytes": 1024, "restoredEntries": 10, "isolatedRestoreBytesVerified": True,
                         "restartedSyntheticServicesQualified": True}}

    def process(self, output, *, errors=b"", status=0):
        class Input:
            def __init__(self):
                self.file = TemporaryFile()
                self.received = b""

            def fileno(self):
                return self.file.fileno()

            def close(self):
                if not self.file.closed:
                    self.file.seek(0)
                    self.received = self.file.read()
                    self.file.close()
        source, diagnostics = TemporaryFile(), TemporaryFile()
        source.write(output)
        source.seek(0)
        diagnostics.write(errors)
        diagnostics.seek(0)
        return SimpleNamespace(pid=123456789, stdin=Input(), stdout=source, stderr=diagnostics,
                               wait=Mock(return_value=status))

    def run_transport(self, process):
        with patch.object(qualification.subprocess, "Popen", return_value=process) as launch, \
                patch.object(qualification.os, "killpg") as stop:
            result = qualification.sudo_recovery(self.baseline, self.candidate, **self.options)
        return result, launch, stop

    def test_only_cold_helper_is_elevated_and_protocol_has_no_github_credentials(self):
        self.result["unreviewedSecret"] = "PRIVATE_DO_NOT_EXPORT"
        process = self.process(json.dumps(self.result).encode())
        with patch.dict(os.environ, {"GH_TOKEN": "PRIVATE_GH_TOKEN", "GITHUB_ACTIONS": "true", "SUDO_UID": "untrusted"}):
            result, launch, stop = self.run_transport(process)
        self.assertTrue(result["success"])
        self.assertNotIn("PRIVATE_DO_NOT_EXPORT", json.dumps(result))
        self.assertEqual(launch.call_args.args[0][:2], ["sudo", "-n"])
        self.assertEqual(launch.call_args.args[0][-2:], [str(Path(qualification.__file__).resolve()), "--internal-cold-recovery"])
        self.assertEqual(launch.call_args.kwargs["env"], qualification.RECOVERY_ENV)
        self.assertTrue(launch.call_args.kwargs["start_new_session"])
        self.assertEqual(json.loads(process.stdin.received), self.request)
        self.assertNotIn(b"PRIVATE_GH_TOKEN", process.stdin.received)
        stop.assert_not_called()

    def test_nonzero_terminal_held_result_is_returned_without_claiming_cleanup(self):
        process = self.process(json.dumps(qualification.held_recovery("privileged-coordinator-held")).encode(), status=1)
        result, _, stop = self.run_transport(process)
        self.assertFalse(result["success"])
        self.assertTrue(result["manualReconciliationRequired"])
        self.assertFalse(result["cleanupSuccess"])
        stop.assert_not_called()

    def test_invalid_status_json_flags_and_paths_remain_unknown(self):
        bad_values = [b"PRIVATE_RAW_TOOL_OUTPUT", json.dumps({**self.result, "offHostAccepted": True}).encode(),
                      json.dumps({**self.result, "outputDirectory": "/outside/private-control"}).encode()]
        for output in bad_values:
            with self.subTest(output=output[:30]):
                result, _, stop = self.run_transport(self.process(output))
                self.assertTrue(result["manualReconciliationRequired"])
                self.assertTrue(result["outcomeUnknown"])
                self.assertFalse(result["cleanupSuccess"])
                self.assertNotIn("PRIVATE_RAW_TOOL_OUTPUT", json.dumps(result))
                self.assertEqual(stop.call_count, 2)
        result, _, _ = self.run_transport(self.process(json.dumps(self.result).encode(), status=1))
        self.assertTrue(result["outcomeUnknown"])

    def test_streams_are_bounded_before_json_decode_and_stderr_is_never_exported(self):
        cases = ((b"x" * (qualification.RECOVERY_OUTPUT_BYTES + 1), b""),
                 (json.dumps(self.result).encode(), b"PRIVATE_DIAGNOSTIC" * (qualification.RECOVERY_ERROR_BYTES // 5)))
        for output, errors in cases:
            result, _, stop = self.run_transport(self.process(output, errors=errors))
            self.assertTrue(result["outcomeUnknown"])
            self.assertNotIn("PRIVATE_DIAGNOSTIC", json.dumps(result))
            self.assertEqual(stop.call_count, 2)

    def test_timeout_and_failed_group_signal_never_claim_privileged_descendants_are_terminal(self):
        process = self.process(b"")
        process.wait.side_effect = subprocess.TimeoutExpired("owned-helper", 2)
        with patch.object(qualification.subprocess, "Popen", return_value=process), \
                patch.object(qualification.time, "monotonic", side_effect=[0, qualification.RECOVERY_TRANSPORT_SECONDS + 1]), \
                patch.object(qualification.os, "killpg", side_effect=PermissionError) as stop:
            result = qualification.sudo_recovery(self.baseline, self.candidate, **self.options)
        self.assertTrue(result["outcomeUnknown"])
        self.assertTrue(result["manualReconciliationRequired"])
        self.assertFalse(result["cleanupSuccess"])
        self.assertEqual({item.args[0] for item in stop.call_args_list}, {process.pid})
        self.assertFalse(any("terminal" in key.lower() for key in result))

    def test_unknown_request_fields_mutable_images_and_unpinned_tools_are_refused_before_process(self):
        changes = [{"GH_TOKEN": "PRIVATE"}, {"resticSha256": "wrong"}, {"outputParent": "/private/../outside"},
                   {"baseline": {**self.baseline, "app": "fixture.invalid/web:latest"}}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(CandidateError):
                qualification.validate_recovery_request({**self.request, **change})
        with patch.object(qualification.subprocess, "Popen") as launch:
            with self.assertRaises(CandidateError):
                qualification.sudo_recovery(self.baseline, self.candidate, **{**self.options, "pg_control_pin": "wrong"})
        launch.assert_not_called()

    def test_success_requires_source_absence_revoked_writer_and_complete_byte_proof(self):
        for change in ({"sourceAbsentAtIndependentRestore": False}, {"writerSlotRevoked": False},
                       {"sourceWritersStopped": False}, {"storageClientBin": None},
                       {"fixtureWritersMayBeRunning": True}, {"recovery": {}}, {"cleanupSuccess": False}):
            with self.subTest(change=change), self.assertRaises(CandidateError):
                qualification.recovery_result({**self.result, **change}, self.request)

    def test_internal_entrypoint_refuses_non_sudo_and_oversized_input_without_coordinator(self):
        for raw in (json.dumps(self.request).encode(), b"x" * (qualification.RECOVERY_REQUEST_BYTES + 1)):
            with patch.object(qualification.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(raw))), \
                    patch.object(qualification.os, "geteuid", return_value=1001), \
                    patch("fresh_compose_recovery_smoke.run") as run, redirect_stdout(io.StringIO()) as output:
                self.assertEqual(qualification.internal_cold_recovery(), 1)
            run.assert_not_called()
            self.assertTrue(json.loads(output.getvalue())["manualReconciliationRequired"])
        self.assertFalse((self.directory / "recovery-root").exists())


if __name__ == "__main__":
    unittest.main()
