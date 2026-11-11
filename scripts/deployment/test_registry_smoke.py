"""Unit tests for fixture admission/orchestration; these do not qualify a registry."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from urllib.error import HTTPError

try:
    from . import registry_smoke as smoke
except ImportError:
    import registry_smoke as smoke


SHA = "a" * 40
IDS = {name: "sha256:" + str(index) * 64 for index, name in enumerate(smoke.COMPONENTS, 1)}


def inspected(identifier):
    return {"Id": identifier, "Os": "linux", "Architecture": "amd64", "Size": 1024,
            "Config": {"User": "bun", "Labels": {"org.opencontainers.image.revision": SHA}},
            "RepoDigests": []}


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.owner = None
        self.foreign = False
        self.inspect_failure = False
        self.remove_failure = False
        self.missing = False
        self.images = {value: inspected(value) for value in IDS.values()}
        self.buildx = {}
        self.buildx_errors = {}

    def run(self, arguments, **options):
        self.calls.append(arguments)
        stdout, stderr, code = "", "", 0
        if arguments[:2] == ["image", "tag"]:
            self.images[arguments[3]] = self.images[arguments[2]]
        elif len(arguments) > 1 and arguments[1] == "inspect" and arguments[0] != "image":
            if self.missing:
                code, stderr = 1, "Error: No such container"
            elif self.inspect_failure:
                code, stderr = 1, "Daemon unavailable"
            elif ".State" in arguments[-1]:
                stdout = json.dumps({"Running": False, "ExitCode": 1, "OOMKilled": False})
            else:
                stdout = json.dumps({smoke.OWNER_LABEL: "foreign" if self.foreign else self.owner})
        elif len(arguments) > 1 and arguments[1] == "rm" and self.remove_failure:
            raise smoke.RegistrySmokeError("Removal failed")
        elif arguments[0] == "logs":
            stdout = "registry failure\n"
        elif arguments[0] == "buildx":
            stdout = self.buildx.get(tuple(arguments), "")
            if tuple(arguments) in self.buildx_errors:
                code, stderr = self.buildx_errors[tuple(arguments)]
        return subprocess.CompletedProcess(arguments, code, stdout, stderr)

    def json(self, arguments, **options):
        if arguments[:2] == ["image", "inspect"]:
            self.calls.append(arguments)
            return [self.images[arguments[2]]]
        result = self.run(arguments, **options)
        if result.returncode:
            raise smoke.RegistrySmokeError("Inspection failed")
        return json.loads(result.stdout)


def fixture(output_dir=Path("unused"), docker=None):
    value = smoke.RegistrySmoke(docker or FakeDocker(), Path("bundle"), SHA, output_dir)
    value.docker.owner = value.prefix
    value.image_ids = dict(IDS)
    return value


class Response:
    def __init__(self, body, headers=None, status=200):
        self.body, self.headers, self.status = body, headers or {}, status

    def read(self, limit):
        return self.body[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *arguments):
        return False


class Opener:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def open(self, request, **options):
        self.calls.append((request, options))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def manifest(config_id=IDS["web"]):
    value = {"schemaVersion": 2, "mediaType": smoke.MANIFEST_TYPES[0],
             "config": {"digest": config_id, "size": 1, "mediaType": "application/vnd.oci.image.config.v1+json"},
             "layers": []}
    body = json.dumps(value).encode()
    digest = "sha256:" + hashlib.sha256(body).hexdigest()
    return body, digest


class AdmissionTests(unittest.TestCase):
    def test_only_exact_owned_loopback_authority_is_admitted(self):
        self.assertEqual(smoke.loopback_authority("127.0.0.1:49152"), "127.0.0.1:49152")
        for value in ("localhost:5000", "0.0.0.0:5000", "127.0.0.1:5000/path",
                      "127.0.0.1:5000?target=remote", "user:secret@127.0.0.1:5000",
                      "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:05000", "registry.example.com:5000"):
            with self.subTest(value=value), self.assertRaises(smoke.RegistrySmokeError):
                smoke.loopback_authority(value)

    def test_endpoint_diagnostics_record_safe_network_shape_without_environment(self):
        network = [{"Id": "1" * 64, "Internal": True, "Driver": "bridge", "Scope": "local", "Containers": {}}]
        container = [{"Id": "2" * 64, "Config": {"Env": ["REGISTRY_HTTP_SECRET=private"]},
                      "NetworkSettings": {"Ports": {"5000/tcp": None}, "Networks": {"owned": {
                          "NetworkID": "1" * 64, "IPAddress": "172.30.0.2"}}}}]
        result = smoke.endpoint_diagnostics(network, container, "owned")
        self.assertTrue(result["internal"])
        self.assertEqual(result["attachmentCount"], 1)
        self.assertEqual(result["dockerPublishedPortCount"], 0)
        self.assertNotIn("private", json.dumps(result))
        self.assertNotIn("Env", json.dumps(result))

    def test_private_auth_config_keeps_admitted_unix_endpoint_without_inherited_credentials(self):
        calls = []

        def runner(command, **options):
            calls.append((command, options))
            output = "default\n" if command[-2:] == ["context", "show"] else "unix:///var/run/docker.sock\n"
            return subprocess.CompletedProcess(command, 0, output, "")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "docker"
            docker = smoke.IsolatedDocker(path, {"PATH": "/bin", "HOME": "/tmp/fixture",
                                                 "DOCKER_CONFIG": "/private/auth", "REGISTRY_PASSWORD": "private"}, runner=runner)
            docker.run(["version"])
            self.assertEqual(calls[-1][0][:3], ["docker", "--host", "unix:///var/run/docker.sock"])
            self.assertEqual(calls[-1][1]["env"]["DOCKER_CONFIG"], str(path))
            self.assertNotIn("REGISTRY_PASSWORD", calls[-1][1]["env"])
            self.assertEqual(json.loads((path / "config.json").read_text()), {})

    def test_invalid_endpoint_is_rejected_before_auth_config_or_daemon_work(self):
        def runner(command, **options):
            output = "remote\n" if command[-2:] == ["context", "show"] else "ssh://production\n"
            return subprocess.CompletedProcess(command, 0, output, "")

        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "docker"
            with self.assertRaises(smoke.SmokeError):
                smoke.IsolatedDocker(config, {"PATH": "/bin"}, runner=runner)
            self.assertFalse(config.exists())

    def test_only_original_buildx_executable_is_preserved_without_registry_auth(self):
        def runner(command, **options):
            output = "default\n" if command[-2:] == ["context", "show"] else "unix:///var/run/docker.sock\n"
            return subprocess.CompletedProcess(command, 0, output, "")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "private-docker"
            (original / "cli-plugins").mkdir(parents=True)
            executable = root / "verified-buildx"
            executable.write_text("#!/bin/sh\nexit 0\n")
            executable.chmod(0o700)
            (original / "cli-plugins/docker-buildx").symlink_to(executable)
            (original / "config.json").write_text('{"auths":{"remote":{"auth":"private"}},"credsStore":"private-helper"}')
            (original / "cli-plugins/docker-unrelated").write_text("unrelated")
            private = root / "isolated-docker"
            smoke.IsolatedDocker(private, {"PATH": "/bin", "HOME": str(root),
                                            "DOCKER_CONFIG": str(original)}, runner=runner)
            copied = private / "cli-plugins/docker-buildx"
            self.assertTrue(copied.is_symlink())
            self.assertEqual(copied.resolve(), executable.resolve())
            self.assertEqual(json.loads((private / "config.json").read_text()), {})
            self.assertFalse((private / "cli-plugins/docker-unrelated").exists())


class RegistryReadbackTests(unittest.TestCase):
    def test_references_cannot_escape_fixture_or_become_api_traversal(self):
        client = smoke.RegistryClient("127.0.0.1:5000", Opener([]))
        for reference in ("registry.example.com/web:tag", "127.0.0.1:5000/../web:tag",
                          "127.0.0.1:5000/web:tag?target=external"):
            with self.subTest(reference=reference), self.assertRaises(smoke.RegistrySmokeError):
                client.split_reference(reference)
        with self.assertRaises(smoke.RegistrySmokeError):
            client.get("/v2/../config")

    def test_manifest_must_match_actual_remote_bytes_and_requested_immutable_digest(self):
        body, digest = manifest()
        client = smoke.RegistryClient("127.0.0.1:5000", Opener([
            Response(body, {"Docker-Content-Digest": digest}),
            Response(body, {"Docker-Content-Digest": "sha256:" + "f" * 64}),
        ]))
        self.assertEqual(client.manifest("127.0.0.1:5000/web@" + digest, immutable=True)[0], digest)
        with self.assertRaises(smoke.RegistrySmokeError):
            client.manifest("127.0.0.1:5000/web@" + digest, immutable=True)

    def test_only_explicit_manifest_unknown_404_is_definite_tag_absence(self):
        for body, accepted in (({"errors": [{"code": "MANIFEST_UNKNOWN"}]}, True),
                               ({"errors": [{"code": "UNAUTHORIZED"}]}, False), ({}, False)):
            stream = io.BytesIO(json.dumps(body).encode())
            error = HTTPError("http://127.0.0.1:5000", 404, "missing", {}, stream)
            client = smoke.RegistryClient("127.0.0.1:5000", Opener([error]))
            if accepted:
                self.assertIsNone(client.manifest("127.0.0.1:5000/web:missing"))
            else:
                with self.assertRaises(smoke.RegistrySmokeError):
                    client.manifest("127.0.0.1:5000/web:missing")
            self.assertTrue(stream.closed)

    def test_rejected_or_oversized_error_responses_close_their_owned_connection(self):
        for status, body in ((500, b"error"), (404, b"x" * 65537)):
            stream = io.BytesIO(body)
            error = HTTPError("http://127.0.0.1:5000", status, "rejected", {}, stream)
            client = smoke.RegistryClient("127.0.0.1:5000", Opener([error]))
            with self.subTest(status=status), self.assertRaises(smoke.RegistrySmokeError):
                client.manifest("127.0.0.1:5000/web:missing")
            self.assertTrue(stream.closed)

    def test_independent_config_readback_binds_bytes_revision_and_platform(self):
        config = json.dumps({"os": "linux", "architecture": "amd64", "config": {
            "Labels": {"org.opencontainers.image.revision": SHA}}}).encode()
        identifier = "sha256:" + hashlib.sha256(config).hexdigest()
        body, digest = manifest(identifier)
        opener = Opener([Response(body, {"Docker-Content-Digest": digest}), Response(config)])
        client = smoke.RegistryClient("127.0.0.1:5000", opener)
        result = client.verify_config("127.0.0.1:5000/web@" + digest, identifier, SHA)
        self.assertEqual(result["imageId"], identifier)
        self.assertTrue(all(request.full_url.startswith("http://127.0.0.1:5000/") for request, _ in opener.calls))
        self.assertFalse(any(request.has_header("Authorization") for request, _ in opener.calls))

    @staticmethod
    def production_transport_fixture():
        try:
            from .registry_candidate import candidate_tag
        except ImportError:
            from registry_candidate import candidate_tag
        value = fixture()
        value.repository_prefix = "127.0.0.1:5000/test-accepted"
        value.accepted_refs, responses = {}, {}
        for name in smoke.COMPONENTS:
            body, digest = manifest(IDS[name])
            parsed = json.loads(body)
            tag = candidate_tag(value.repository_prefix, name, SHA, IDS[name])
            reference = tag.rsplit(":", 1)[0] + "@" + digest
            value.accepted_refs[name] = reference
            responses[reference] = (digest, parsed)
            value.docker.buildx[("buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", tag)] = json.dumps({"digest": digest})
            value.docker.buildx[("buildx", "imagetools", "inspect", "--raw", reference)] = json.dumps(parsed)
        value.client = SimpleNamespace(manifest=lambda reference, **options: responses[reference])
        return value

    def test_shipping_adapter_is_exercised_for_existing_tags_and_immutable_refs_without_push(self):
        value = self.production_transport_fixture()
        result = value.production_transport_readback()
        self.assertEqual(result["newPushes"], 0)
        self.assertEqual(set(result["components"]), set(smoke.COMPONENTS))
        calls = value.docker.calls
        self.assertEqual(sum(args[:3] == ["buildx", "imagetools", "inspect"] for args in calls), 12)
        self.assertFalse(any("push" in args or "build" in args for args in calls))

    def test_shipping_missing_tag_path_is_required_before_first_publication(self):
        try:
            from .registry_candidate import candidate_tag
        except ImportError:
            from registry_candidate import candidate_tag
        value = fixture()
        value.repository_prefix = "127.0.0.1:5000/test-fresh"
        tag = candidate_tag(value.repository_prefix, "web", SHA, IDS["web"])
        command = ("buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", tag)
        value.docker.buildx_errors[command] = (1, "ERROR: manifest unknown: manifest unknown")
        result = value.production_transport_absence()
        self.assertTrue(result["definiteMissingTag"])
        self.assertEqual(result["newPushes"], 0)
        self.assertFalse(any("push" in args for args in value.docker.calls))

    def test_existing_destination_cannot_qualify_as_fresh_absence(self):
        value = self.production_transport_fixture()
        with self.assertRaises(smoke.RegistrySmokeError):
            value.production_transport_absence()

    def test_shipping_adapter_metadata_mismatch_cannot_pass_the_independent_gate(self):
        value = self.production_transport_fixture()
        key = next(key for key in value.docker.buildx if "--format" in key)
        wrong_digest = "sha256:" + "f" * 64
        original_reference = value.accepted_refs["web"]
        wrong_reference = original_reference.rsplit("@", 1)[0] + "@" + wrong_digest
        value.docker.buildx[key] = json.dumps({"digest": wrong_digest})
        value.docker.buildx[("buildx", "imagetools", "inspect", "--raw", wrong_reference)] = value.docker.buildx[
            ("buildx", "imagetools", "inspect", "--raw", original_reference)]
        with self.assertRaises(smoke.RegistrySmokeError):
            value.production_transport_readback()


class OwnershipAndFailureTests(unittest.TestCase):
    def test_foreign_registry_is_not_read_or_removed(self):
        value = fixture()
        value.resources = [("container", value.registry_name)]
        value.docker.foreign = True
        self.assertEqual(value.diagnostics(), {"status": "unavailable-or-unowned"})
        self.assertEqual(value.cleanup(), ["owned container cleanup failed"])
        self.assertFalse(any(args[0] == "logs" or args[1] == "rm" for args in value.docker.calls))

    def test_cleanup_does_not_remove_changed_tag_or_original_image_id(self):
        value = fixture()
        reference = value.prefix + "/web:tested"
        value.owned_tags = {reference: IDS["web"]}
        value.docker.images[reference] = inspected(IDS["worker"])
        self.assertEqual(value.cleanup(), ["owned local tag cleanup failed"])
        self.assertFalse(any(args[:2] == ["image", "rm"] for args in value.docker.calls))

    def test_cleanup_is_exact_reversed_and_does_not_prune_or_delete_remote_blobs(self):
        value = fixture()
        value.resources = [("volume", "owned-data"), ("network", "owned-network"),
                           ("container", "owned-registry")]
        self.assertEqual(value.cleanup(), [])
        removals = [args for args in value.docker.calls if args[1] == "rm"]
        self.assertEqual(removals, [["container", "rm", "--force", "owned-registry"],
                                    ["network", "rm", "owned-network"], ["volume", "rm", "owned-data"]])
        self.assertFalse(any("prune" in args for args in value.docker.calls))

    def test_forwarder_cleanup_runs_first_and_failure_prevents_clean_result(self):
        value = fixture()
        sequence = []

        def failed_close():
            sequence.append("forwarder-close")
            raise smoke.ForwarderError("Owned socket cleanup failed")

        value.forwarder = SimpleNamespace(close=failed_close)
        value.resources = [("container", "owned-registry")]
        original = value.docker.run

        def run(arguments, **options):
            if arguments[:2] == ["container", "rm"]:
                sequence.append("container-remove")
            return original(arguments, **options)

        value.docker.run = run
        self.assertEqual(value.cleanup(), ["owned loopback forwarder cleanup failed"])
        self.assertEqual(sequence, ["forwarder-close", "container-remove"])

    def test_real_publisher_reconciliation_preserves_content_ids_after_owned_source_tag_drift(self):
        try:
            from .candidate import PENDING, SMOKE_CHECKS
            from .registry_candidate import RemoteImage, candidate_tag
        except ImportError:
            from candidate import PENDING, SMOKE_CHECKS
            from registry_candidate import RemoteImage, candidate_tag
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory))
            value.repository_prefix = "127.0.0.1:5000/test-accepted"
            value.provenance = {"archiveSha256": "b" * 64, "bundleManifestSha256": "c" * 64}
            value.candidate = {
                "schemaVersion": 1, "kind": "warpdrive-image-candidate", "revision": SHA,
                "platform": "linux/amd64", "components": {name: {"imageId": IDS[name],
                    "runtimeUser": "bun", "registryRef": None} for name in smoke.COMPONENTS},
                "qualification": {"state": "image-smoke-passed", "reportSha256": "d" * 64,
                                  "checks": list(SMOKE_CHECKS), "limitations": ["Unit fixture only"]},
                "compatibility": "unassessed", "deploymentAuthorized": False, "pendingGates": list(PENDING),
            }
            tags, immutable = {}, {}
            for name in smoke.COMPONENTS:
                body, digest = manifest(IDS[name])
                parsed = json.loads(body)
                tag = candidate_tag(value.repository_prefix, name, SHA, IDS[name])
                tags[tag] = RemoteImage(digest, parsed)
                immutable[tag.rsplit(":", 1)[0] + "@" + digest] = parsed
            pushes = []
            value.adapter = SimpleNamespace(
                inspect_local=lambda image_id: value.docker.images[image_id],
                resolve_tag=lambda tag: tags.get(tag),
                fetch_manifest=lambda reference: immutable[reference],
                push=lambda image_id, tag: pushes.append((image_id, tag)),
            )
            value.publish()
            accepted = json.loads(value.accepted_path.read_text())
            value.accepted_refs = {name: accepted["components"][name]["registryRef"] for name in smoke.COMPONENTS}
            reads = []

            def verify(reference, image_id, revision):
                self.assertEqual(immutable[reference]["config"]["digest"], image_id)
                self.assertEqual(revision, SHA)
                reads.append(reference)

            value.client = SimpleNamespace(verify_config=verify)
            result = value.source_drift()
            self.assertTrue(result["contentBoundImageIdsPreserved"])
            self.assertTrue(result["acceptedRecordUnchanged"])
            self.assertTrue(result["acceptedImmutableRefsUnchanged"])
            self.assertEqual(result["newPushes"], 0)
            self.assertEqual(pushes, [])
            self.assertEqual(len(reads), 4)
            self.assertFalse(result["originalInputTagsModified"])
            tag_calls = [args for args in value.docker.calls if args[:2] == ["image", "tag"]]
            self.assertTrue(all(args[3].startswith(value.prefix + "/") for args in tag_calls))
            self.assertFalse(any(args[0] == "build" for args in value.docker.calls))

    @staticmethod
    def no_op_phases(value):
        for name in ("load", "setup_registry", "production_transport_absence", "publish", "readback", "production_transport_readback", "source_drift", "conflict"):
            setattr(value, name, lambda: {"unitFixture": True})

    def test_failed_publication_preserves_failure_and_cleanup_does_not_hide_it(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)

            def fail():
                raise smoke.RegistrySmokeError("Publication unresolved")

            value.publish = fail
            self.assertFalse(value.run())
            report = json.loads((value.output_dir / "report.json").read_text())
            self.assertEqual(report["failure"], "Publication unresolved")
            self.assertTrue(report["cleanup"]["success"])
            self.assertEqual(report["checks"][-1]["status"], "failed")
            self.assertNotIn("registry-conflict-preserves-accepted-candidate", [item["name"] for item in report["checks"]])

    def test_shipping_registry_error_retains_its_fixed_safe_diagnostic_message(self):
        try:
            from .registry_candidate import RegistryError
        except ImportError:
            from registry_candidate import RegistryError
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)

            def fail():
                raise RegistryError("registry tag resolution is indeterminate")

            value.production_transport_absence = fail
            self.assertFalse(value.run())
            self.assertEqual(value.report["failure"], "registry tag resolution is indeterminate")
            self.assertEqual(value.report["checks"][-1]["name"], "production-buildx-adapter-definite-tag-absence")

    def test_cleanup_failure_prevents_success_and_evidence_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            value = fixture(Path(directory) / "run")
            self.no_op_phases(value)
            value.cleanup = lambda: ["owned registry could not be removed"]
            self.assertFalse(value.run())
            self.assertFalse(value.report["cleanup"]["success"])
            with self.assertRaises(FileExistsError):
                value.run()


if __name__ == "__main__":
    unittest.main()
