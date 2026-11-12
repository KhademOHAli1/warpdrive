#!/usr/bin/env python3
"""Test exact-image registry transport using a disposable loopback-only registry.

No build, public registry, provider account, deployment or production credential is
accepted. Actual runtime results, rather than this harness's unit tests, establish
the bounded registry fixture qualification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import tempfile
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

try:
    from .image_smoke import Docker, SmokeError, COMPONENTS, admit_endpoint, image_metadata, sanitized_log, utc_now, validate_reference, validate_revision
    from .loopback_forwarder import ForwarderError, owned_bridge_forwarder
except ImportError:
    from image_smoke import Docker, SmokeError, COMPONENTS, admit_endpoint, image_metadata, sanitized_log, utc_now, validate_reference, validate_revision
    from loopback_forwarder import ForwarderError, owned_bridge_forwarder


OWNER_LABEL = "io.warpdrive.registry-smoke.owner"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
MANIFEST_TYPES = (
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
)
LIMITATIONS = [
    "Disposable local HTTP registry transport only; no live registry/provider publication or production deployment.",
    "No registry authentication, TLS, remote durability, signature policy or provider permissions are qualified.",
    "No source qualification, compatibility, staging switch, application rollback or data recovery is established here.",
    "Registry disk checks are admission/growth checks, not a filesystem quota or concurrent-workload guarantee.",
]


class RegistrySmokeError(SmokeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise RegistrySmokeError("Local registry redirect refused")


def loopback_authority(value: str) -> str:
    parsed = urlsplit("http://" + value)
    try:
        port = parsed.port
    except ValueError as error:
        raise RegistrySmokeError("Invalid local registry port") from error
    if (parsed.hostname != "127.0.0.1" or parsed.username or parsed.password or parsed.path
            or parsed.query or parsed.fragment or not port or not 1 <= port <= 65535
            or value != f"127.0.0.1:{port}"):
        raise RegistrySmokeError("Registry fixture must use its exact loopback authority")
    return value


def endpoint_diagnostics(network_rows: Any, container_rows: Any, network_name: str) -> dict:
    """Retain narrow nonsecret shape facts, never full inspect/config/environment data."""
    network = network_rows[0] if isinstance(network_rows, list) and len(network_rows) == 1 and isinstance(network_rows[0], dict) else {}
    container = container_rows[0] if isinstance(container_rows, list) and len(container_rows) == 1 and isinstance(container_rows[0], dict) else {}
    settings = container.get("NetworkSettings") or {}
    attachments = settings.get("Networks") or {}
    endpoint = attachments.get(network_name) if isinstance(attachments, dict) else {}
    endpoint = endpoint if isinstance(endpoint, dict) else {}
    def identifier(value):
        return value if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) else "unavailable"
    address = endpoint.get("IPAddress")
    address = address if isinstance(address, str) and re.fullmatch(r"[0-9.]{7,15}", address) else "unavailable"
    return {"networkId": identifier(network.get("Id")), "containerId": identifier(container.get("Id")),
            "internal": network.get("Internal") if type(network.get("Internal")) is bool else None,
            "bridgeDriver": network.get("Driver") == "bridge", "localScope": network.get("Scope") == "local",
            "attachmentCount": len(attachments) if isinstance(attachments, dict) else None,
            "expectedAttachmentPresent": network_name in attachments,
            "endpointNetworkId": identifier(endpoint.get("NetworkID")), "containerIPv4": address,
            "dockerPublishedPortCount": sum(bool(value) for value in (settings.get("Ports") or {}).values()),
            "networkMembershipCount": len(network.get("Containers") or {})}


class IsolatedDocker(Docker):
    """Reuse local-context admission but use an empty auth config for all daemon work."""

    def __init__(self, config_dir: Path, environment: dict[str, str] | None = None,
                 **options):
        self.endpoint = None
        super().__init__(environment, **options)
        endpoint = super().run([
            "context", "inspect", self.context, "--format", "{{.Endpoints.docker.Host}}",
        ], timeout=10).stdout.strip()
        admit_endpoint(endpoint)
        config_dir.mkdir(parents=True, exist_ok=False)
        (config_dir / "config.json").write_text("{}\n")
        original_config = self.environment.get("DOCKER_CONFIG")
        if not original_config and self.environment.get("HOME"):
            original_config = str(Path(self.environment["HOME"]) / ".docker")
        if original_config:
            # setup-buildx-action may install its executable beneath the original
            # config. Preserve only that executable; never copy auth/config/helpers.
            plugin = Path(original_config) / "cli-plugins/docker-buildx"
            try:
                executable = plugin.resolve(strict=True)
                if executable.is_file() and os.access(executable, os.X_OK):
                    (config_dir / "cli-plugins").mkdir(mode=0o700)
                    (config_dir / "cli-plugins/docker-buildx").symlink_to(executable)
            except OSError:
                # Missing/unreadable optional local plugin leaves system discovery intact.
                pass
        self.context = None
        self.endpoint = endpoint
        self.environment["DOCKER_CONFIG"] = str(config_dir)

    def run(self, arguments, **options):
        prefix = ["--host", self.endpoint] if self.endpoint is not None else []
        return super().run([*prefix, *arguments], **options)


class RegistryClient:
    """Independently read content-addressed manifests/configs with no proxy or redirects."""

    def __init__(self, authority: str, opener=None):
        self.authority = loopback_authority(authority)
        self.opener = opener or build_opener(ProxyHandler({}), NoRedirect())

    def split_reference(self, reference: str, *, immutable: bool = False) -> tuple[str, str]:
        prefix = self.authority + "/"
        if not isinstance(reference, str) or not reference.startswith(prefix):
            raise RegistrySmokeError("Registry reference escapes the owned loopback endpoint")
        path = reference[len(prefix):]
        if immutable:
            pieces = path.rsplit("@", 1)
            if len(pieces) != 2 or not DIGEST.fullmatch(pieces[1]):
                raise RegistrySmokeError("Immutable manifest digest required")
        else:
            pieces = path.rsplit(":", 1)
            if len(pieces) != 2 or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", pieces[1]):
                raise RegistrySmokeError("Exact fixture tag required")
        if not re.fullmatch(r"[a-z0-9]+(?:[._/-][a-z0-9]+)*", pieces[0]):
            raise RegistrySmokeError("Invalid fixture repository")
        return pieces[0], pieces[1]

    def get(self, path: str, *, manifest: bool = False) -> tuple[bytes, Any, int]:
        if not path.startswith("/v2/") or ".." in path or "?" in path or "#" in path:
            raise RegistrySmokeError("Invalid local registry API path")
        request = Request("http://" + self.authority + path, headers={
            "Accept": ", ".join(MANIFEST_TYPES) if manifest else "application/json",
        })
        try:
            with self.opener.open(request, timeout=10) as response:
                content = response.read(2 * 1024 * 1024 + 1)
                if len(content) > 2 * 1024 * 1024:
                    raise RegistrySmokeError("Registry response exceeds the metadata bound")
                return content, response.headers, response.status
        except HTTPError as error:
            with error:
                if error.code != 404:
                    raise RegistrySmokeError("Registry API rejected the bounded request") from error
                content = error.read(65537)
                if len(content) > 65536:
                    raise RegistrySmokeError("Registry error response exceeds its bound") from error
                return content, error.headers, error.code
        except (URLError, OSError, ValueError) as error:
            raise RegistrySmokeError("Local registry API outcome is unavailable") from error

    def manifest(self, reference: str, *, immutable: bool = False):
        repository, identifier = self.split_reference(reference, immutable=immutable)
        body, headers, status = self.get(
            f"/v2/{repository}/manifests/{quote(identifier, safe=':')}", manifest=True)
        try:
            value = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RegistrySmokeError("Registry manifest response is invalid") from error
        if status == 404:
            errors = value.get("errors") if isinstance(value, dict) else None
            if (not immutable and isinstance(errors, list) and len(errors) == 1
                    and isinstance(errors[0], dict) and errors[0].get("code") == "MANIFEST_UNKNOWN"):
                return None
            raise RegistrySmokeError("Registry absence is not a definite missing tag")
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        if headers.get("Docker-Content-Digest") != digest:
            raise RegistrySmokeError("Registry manifest digest differs from its actual bytes")
        if immutable and identifier != digest:
            raise RegistrySmokeError("Registry returned different immutable manifest bytes")
        if (status != 200 or not isinstance(value, dict) or value.get("schemaVersion") != 2
                or value.get("mediaType") not in MANIFEST_TYPES
                or not isinstance(value.get("config"), dict)
                or not DIGEST.fullmatch(str(value["config"].get("digest", "")))):
            raise RegistrySmokeError("Expected a single-platform version-two image manifest")
        return digest, value

    def verify_config(self, reference: str, expected_image_id: str, revision: str) -> dict:
        result = self.manifest(reference, immutable=True)
        if result is None:
            raise RegistrySmokeError("Accepted immutable manifest disappeared")
        digest, manifest = result
        if manifest["config"]["digest"] != expected_image_id:
            raise RegistrySmokeError("Registry config differs from the tested local image ID")
        repository, _ = self.split_reference(reference, immutable=True)
        content, _, status = self.get(f"/v2/{repository}/blobs/{expected_image_id}")
        if status != 200 or "sha256:" + hashlib.sha256(content).hexdigest() != expected_image_id:
            raise RegistrySmokeError("Registry config blob bytes do not match the tested image ID")
        try:
            config = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RegistrySmokeError("Registry config blob is invalid") from error
        if (config.get("os") != "linux" or config.get("architecture") != "amd64"
                or (config.get("config", {}).get("Labels") or {}).get("org.opencontainers.image.revision") != revision):
            raise RegistrySmokeError("Registry config lost its source/platform identity")
        return {"registryRef": reference, "manifestDigest": digest, "imageId": expected_image_id,
                "revision": revision, "platform": "linux/amd64"}


class RegistryAdapter:
    def __init__(self, fixture: "RegistrySmoke", client: RegistryClient):
        self.fixture, self.client = fixture, client

    def inspect_local(self, image_id):
        rows = self.fixture.docker.json(["image", "inspect", image_id])
        if not isinstance(rows, list) or len(rows) != 1:
            raise RegistrySmokeError("Local immutable image inspection failed")
        return rows[0]

    def resolve_tag(self, tag):
        try:
            from .registry_candidate import RemoteImage
        except ImportError:
            from registry_candidate import RemoteImage
        result = self.client.manifest(tag)
        return RemoteImage(*result) if result is not None else None

    def fetch_manifest(self, reference):
        result = self.client.manifest(reference, immutable=True)
        if result is None:
            raise RegistrySmokeError("Immutable manifest is unavailable")
        return result[1]

    def push(self, image_id, tag):
        self.client.split_reference(tag)
        if image_id not in self.fixture.image_ids.values():
            raise RegistrySmokeError("Publication attempted to use an untested image ID")
        self.fixture.capacity()
        self.fixture.tag_image(image_id, tag)
        self.fixture.docker.run(["push", tag], timeout=300)
        self.fixture.capacity()


class RegistrySmoke:
    def __init__(self, docker: Docker, bundle_dir: Path, expected_revision: str, output_dir: Path,
                 image_refs: dict[str, str] | None = None,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        if image_refs is not None and set(image_refs) != set(COMPONENTS):
            raise ValueError("All four source image references are required")
        self.docker, self.bundle_dir, self.output_dir = docker, bundle_dir, output_dir
        self.image_refs = ({name: validate_reference(value) for name, value in image_refs.items()}
                           if image_refs is not None else None)
        self.revision = validate_revision(expected_revision)
        self.clock, self.sleep = clock, sleep
        self.prefix = "wd-registry-smoke-" + uuid.uuid4().hex[:12]
        self.resources: list[tuple[str, str]] = []
        self.owned_tags: dict[str, str] = {}
        self.registry_name = self.prefix + "-registry"
        self.registry_secret = secrets.token_hex(32)
        self.image_ids: dict[str, str] = {}
        self.root_dir: Path | None = None
        self.disk_limit = 0
        self.client = None
        self.adapter = None
        self.forwarder = None
        self.report = {"schemaVersion": 1, "kind": "warpdrive-local-registry-smoke",
                       "success": False, "revision": self.revision, "startedAt": utc_now(),
                       "checks": [], "images": {}, "limitations": LIMITATIONS,
                       "failure": None, "diagnostics": {}, "endpointMetadata": {},
                       "cleanup": {"success": False, "errors": []}}

    def check(self, name, function):
        try:
            detail = function()
        except Exception:
            self.report["checks"].append({"name": name, "status": "failed"})
            raise
        self.report["checks"].append({"name": name, "status": "passed", "detail": detail or {}})
        return detail

    def load(self):
        try:
            from .bundle import load_bundle
        except ImportError:
            from bundle import load_bundle
        loaded = load_bundle(self.bundle_dir, expected_revision=self.revision)
        self.candidate, self.provenance = loaded["candidate"], loaded["provenance"]
        self.image_ids = {name: self.candidate["components"][name]["imageId"] for name in COMPONENTS}
        # Reuse the transported tested archive. This command does not rebuild images.
        self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.assert_sources(self.image_refs or self.image_ids)
        sizes = []
        for name in COMPONENTS:
            rows = self.docker.json(["image", "inspect", self.image_ids[name]])
            metadata = image_metadata(rows, self.revision)
            size = rows[0].get("Size")
            if type(size) is not int or size <= 0:
                raise RegistrySmokeError("Image storage budget is unavailable")
            sizes.append(size)
            self.report["images"][name] = metadata
        self.disk_limit = sum(sizes) + 256 * 1024 ** 2
        return {"archiveSha256": self.provenance["archiveSha256"], "loadedTestedImageIds": self.image_ids,
                "rebuilds": 0}

    def assert_sources(self, refs):
        for name in COMPONENTS:
            rows = self.docker.json(["image", "inspect", refs[name]])
            inspected = image_metadata(rows, self.revision)
            if inspected["id"] != self.image_ids[name]:
                raise RegistrySmokeError("Mutable source reference no longer selects the tested image")

    def owned_registry(self):
        labels = self.docker.json(["container", "inspect", self.registry_name,
                                   "--format", "{{json .Config.Labels}}"], timeout=5)
        if not isinstance(labels, dict) or labels.get(OWNER_LABEL) != self.prefix:
            raise RegistrySmokeError("Registry fixture ownership is not established")

    def setup_registry(self):
        root = self.docker.run(["info", "--format", "{{.DockerRootDir}}"], timeout=10).stdout.strip()
        self.root_dir = Path(root)
        if not root.startswith("/") or not self.root_dir.is_dir():
            raise RegistrySmokeError("Native fixture requires measurable local Docker storage")
        if shutil.disk_usage(self.root_dir).free < self.disk_limit + 1024 ** 3:
            raise RegistrySmokeError("Insufficient disk for bounded registry fixture plus operating reserve")
        volume, network = self.prefix + "-data", self.prefix + "-network"
        self.resources.append(("volume", volume))
        self.docker.run(["volume", "create", "--label", f"{OWNER_LABEL}={self.prefix}", volume])
        self.resources.append(("network", network))
        self.docker.run(["network", "create", "--internal", "--label", f"{OWNER_LABEL}={self.prefix}", network])
        self.resources.append(("container", self.registry_name))
        self.docker.run([
            "run", "--detach", "--pull", "missing", "--name", self.registry_name,
            "--label", f"{OWNER_LABEL}={self.prefix}", "--network", network,
            "--memory", "384m", "--memory-swap", "384m",
            "--cpus", "1", "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
            "--mount", f"type=volume,source={volume},target=/var/lib/registry",
            "--env", "REGISTRY_LOG_LEVEL=error", "--env", "REGISTRY_HTTP_ADDR=0.0.0.0:5000",
            "--env", f"REGISTRY_HTTP_SECRET={self.registry_secret}", "registry:2",
        ], timeout=120)
        self.owned_registry()
        network_rows = self.docker.json(["network", "inspect", network])
        container_rows = self.docker.json(["container", "inspect", self.registry_name])
        self.report["endpointMetadata"] = endpoint_diagnostics(network_rows, container_rows, network)
        self.forwarder = owned_bridge_forwarder(
            self.docker, owner_label=OWNER_LABEL, owner=self.prefix, network_name=network,
            container_name=self.registry_name, port=5000, max_connections=8,
        ).start()
        authority = loopback_authority(self.forwarder.authority)
        self.report["endpointMetadata"] = {**self.forwarder.target_metadata, "access": "owned-host-loopback-forwarder",
                                           "authority": authority}
        self.client = RegistryClient(authority)
        self.adapter = RegistryAdapter(self, self.client)
        deadline = self.clock() + 45
        while True:
            self.owned_registry()
            state = self.docker.json(["container", "inspect", self.registry_name, "--format", "{{json .State}}"])
            if not isinstance(state, dict) or state.get("Running") is not True or state.get("OOMKilled"):
                raise RegistrySmokeError("Registry process failed before readiness")
            try:
                _, _, status = self.client.get("/v2/")
                if status == 200:
                    break
            except RegistrySmokeError:
                if self.clock() >= deadline:
                    raise
            if self.clock() >= deadline:
                raise RegistrySmokeError("Registry fixture readiness timed out")
            self.sleep(1)
        self.capacity()
        self.repository_prefix = authority + "/" + self.prefix + "-accepted"
        return {"authority": authority, "loopbackOnly": True, "internalNetwork": True,
                "dockerPublishedPorts": 0, "access": "owned-host-loopback-forwarder",
                "diskAdmissionLimitBytes": self.disk_limit, "operatingReserveBytes": 1024 ** 3}

    def capacity(self):
        self.owned_registry()
        if self.root_dir is None or shutil.disk_usage(self.root_dir).free < 1024 ** 3:
            raise RegistrySmokeError("Registry fixture operating reserve reached")
        usage = self.docker.run(["exec", self.registry_name, "du", "-sk", "/var/lib/registry"], timeout=10).stdout.split()
        if not usage or not usage[0].isdigit() or int(usage[0]) * 1024 > self.disk_limit:
            raise RegistrySmokeError("Registry fixture storage growth exceeded its admitted bound")

    def tag_image(self, image_id, reference):
        if reference in self.owned_tags and self.owned_tags[reference] != image_id:
            # Deliberate source-drift probes may update their own tag, never an input tag.
            if not reference.startswith(self.prefix + "/"):
                raise RegistrySmokeError("Owned publication tag changed unexpectedly")
        self.owned_tags[reference] = image_id
        self.docker.run(["image", "tag", image_id, reference])

    def publish(self):
        try:
            from .registry_candidate import promote_candidate
        except ImportError:
            from registry_candidate import promote_candidate
        self.accepted_path = self.output_dir / "accepted-candidate.json"
        promote_candidate(self.candidate, expected_revision=self.revision,
                          repository_prefix=self.repository_prefix, attempt_id="accepted",
                          journal_path=self.output_dir / "accepted-journal.json", output_path=self.accepted_path,
                          adapter=self.adapter, bundle_provenance=self.provenance)
        self.accepted_hash = hashlib.sha256(self.accepted_path.read_bytes()).hexdigest()
        return {"publicationRecordSha256": self.accepted_hash, "rebuilds": 0}

    def production_transport_absence(self):
        """Qualify the real shipping adapter's missing-tag path before any publication."""
        try:
            from .registry_candidate import DockerRegistryAdapter, candidate_tag
        except ImportError:
            from registry_candidate import DockerRegistryAdapter, candidate_tag
        tag = candidate_tag(self.repository_prefix, "web", self.revision, self.image_ids["web"])
        resolved = DockerRegistryAdapter(self.docker).resolve_tag(tag)
        if resolved is not None:
            raise RegistrySmokeError("Owned fresh registry destination unexpectedly already contains the candidate")
        return {"adapter": "DockerRegistryAdapter", "definiteMissingTag": True,
                "scope": "Fresh owned destination before first publication", "newPushes": 0}

    def readback(self):
        try:
            from .registry_candidate import candidate_tag
        except ImportError:
            from registry_candidate import candidate_tag
        self.accepted_refs = {}
        results = {}
        for name in COMPONENTS:
            tag = candidate_tag(self.repository_prefix, name, self.revision, self.image_ids[name])
            remote = self.client.manifest(tag)
            if remote is None:
                raise RegistrySmokeError("Published candidate tag missing on independent read")
            reference = tag.rsplit(":", 1)[0] + "@" + remote[0]
            results[name] = self.client.verify_config(reference, self.image_ids[name], self.revision)
            self.accepted_refs[name] = reference
        return results

    def production_transport_readback(self):
        """Exercise the shipping Buildx adapter against independently checked fixture bytes."""
        try:
            from .registry_candidate import DockerRegistryAdapter, candidate_tag
        except ImportError:
            from registry_candidate import DockerRegistryAdapter, candidate_tag
        transport = DockerRegistryAdapter(self.docker)
        results = {}
        for name in COMPONENTS:
            tag = candidate_tag(self.repository_prefix, name, self.revision, self.image_ids[name])
            reference = self.accepted_refs[name]
            independently_read = self.client.manifest(reference, immutable=True)
            if independently_read is None:
                raise RegistrySmokeError("Accepted fixture manifest disappeared before Buildx readback")
            expected_digest, expected_manifest = independently_read
            resolved = transport.resolve_tag(tag)
            if (resolved is None or resolved.digest != expected_digest
                    or not isinstance(resolved.manifest, dict)
                    or resolved.manifest.get("config", {}).get("digest") != self.image_ids[name]
                    or resolved.manifest != expected_manifest):
                raise RegistrySmokeError("Production Buildx tag resolution differs from independent HTTP readback")
            immutable = transport.fetch_manifest(reference)
            if (not isinstance(immutable, dict) or immutable.get("config", {}).get("digest") != self.image_ids[name]
                    or immutable != expected_manifest):
                raise RegistrySmokeError("Production Buildx immutable readback differs from tested artifact")
            results[name] = {"registryRef": reference, "manifestDigest": expected_digest,
                             "imageId": self.image_ids[name]}
        return {"adapter": "DockerRegistryAdapter", "descriptorSource": "Buildx .Manifest JSON",
                "independentComparison": "loopback HTTP manifest bytes", "newPushes": 0,
                "components": results}

    def source_drift(self):
        try:
            from .registry_candidate import promote_candidate
        except ImportError:
            from registry_candidate import promote_candidate
        refs = {}
        for name in COMPONENTS:
            refs[name] = f"{self.prefix}/source-{name}:tested"
            self.tag_image(self.image_ids[name], refs[name])
        self.assert_sources(refs)
        alternate = next((value for value in self.image_ids.values() if value != self.image_ids["web"]), None)
        if alternate is None:
            raise RegistrySmokeError("Distinct component images required for source-drift rehearsal")
        self.tag_image(alternate, refs["web"])
        changed = self.docker.json(["image", "inspect", refs["web"]])
        if not isinstance(changed, list) or len(changed) != 1 or changed[0].get("Id") != alternate:
            raise RegistrySmokeError("Owned mutable source tag did not actually change")

        class ExistingPublicationOnly:
            def inspect_local(inner, image_id):
                return self.adapter.inspect_local(image_id)

            def resolve_tag(inner, tag):
                return self.adapter.resolve_tag(tag)

            def fetch_manifest(inner, reference):
                return self.adapter.fetch_manifest(reference)

            def push(inner, image_id, tag):
                # Reconciliation must read the accepted publication, never replay it.
                raise RegistrySmokeError("Source-drift reconciliation unexpectedly attempted another push")

        result = promote_candidate(self.candidate, expected_revision=self.revision,
                                   repository_prefix=self.repository_prefix, attempt_id="accepted",
                                   journal_path=self.output_dir / "accepted-journal.json", output_path=self.accepted_path,
                                   adapter=ExistingPublicationOnly(), bundle_provenance=self.provenance)
        if hashlib.sha256(self.accepted_path.read_bytes()).hexdigest() != self.accepted_hash:
            raise RegistrySmokeError("Mutable source tag drift changed the accepted publication record")
        for name, reference in self.accepted_refs.items():
            component = result["components"][name]
            if component.get("imageId") != self.image_ids[name] or component.get("registryRef") != reference:
                raise RegistrySmokeError("Mutable source tag drift changed content-bound publication identity")
            self.client.verify_config(reference, self.image_ids[name], self.revision)
        return {"changedOwnedSourceTag": True, "contentBoundImageIdsPreserved": True,
                "acceptedRecordUnchanged": True, "acceptedImmutableRefsUnchanged": True,
                "newPushes": 0, "originalInputTagsModified": False}

    def conflict(self):
        try:
            from .registry_candidate import RegistryConflict, candidate_tag, promote_candidate
        except ImportError:
            from registry_candidate import RegistryConflict, candidate_tag, promote_candidate
        alternate = next(value for value in self.image_ids.values() if value != self.image_ids["web"])
        conflict_prefix = self.client.authority + "/" + self.prefix + "-conflict"
        conflict_tag = candidate_tag(conflict_prefix, "web", self.revision, self.image_ids["web"])
        self.adapter.push(alternate, conflict_tag)
        seeded = self.client.manifest(conflict_tag)
        if seeded is None or seeded[1]["config"]["digest"] != alternate:
            raise RegistrySmokeError("Conflict fixture was not independently established")
        rejected_output = self.output_dir / "rejected-candidate.json"
        try:
            promote_candidate(self.candidate, expected_revision=self.revision,
                              repository_prefix=conflict_prefix, attempt_id="conflict",
                              journal_path=self.output_dir / "conflict-journal.json", output_path=rejected_output,
                              adapter=self.adapter, bundle_provenance=self.provenance)
        except RegistryConflict:
            pass
        else:
            raise RegistrySmokeError("Conflicting registry tag was incorrectly accepted")
        if rejected_output.exists():
            raise RegistrySmokeError("Rejected candidate produced an accepted publication record")
        if hashlib.sha256(self.accepted_path.read_bytes()).hexdigest() != self.accepted_hash:
            raise RegistrySmokeError("Failed candidate changed the accepted publication record")
        for name, reference in self.accepted_refs.items():
            self.client.verify_config(reference, self.image_ids[name], self.revision)
        return {"conflictRejected": True, "acceptedRecordUnchanged": True,
                "acceptedImmutableReferencesStillReadable": self.accepted_refs}

    def diagnostics(self):
        try:
            self.owned_registry()
            state = self.docker.json(["container", "inspect", self.registry_name, "--format", "{{json .State}}"], timeout=5)
            logs = self.docker.run(["logs", "--tail", "80", self.registry_name], timeout=5, check=False)
            return {"state": {key: state[key] for key in ("Running", "ExitCode", "OOMKilled") if isinstance(state.get(key), (bool, int))},
                    "endpointMetadata": self.report["endpointMetadata"],
                    "forwarder": self.forwarder.snapshot() if self.forwarder is not None else None,
                    "log": sanitized_log((logs.stdout or "") + (logs.stderr or ""), [self.registry_secret])}
        except Exception:
            return {"status": "unavailable-or-unowned"}

    def cleanup(self):
        errors = []
        if self.forwarder is not None:
            try:
                self.forwarder.close()
                self.report["forwarder"] = self.forwarder.snapshot()
            except Exception:
                errors.append("owned loopback forwarder cleanup failed")
        for reference, expected_id in reversed(list(self.owned_tags.items())):
            try:
                rows = self.docker.json(["image", "inspect", reference])
                if not isinstance(rows, list) or len(rows) != 1 or rows[0].get("Id") != expected_id:
                    raise RegistrySmokeError("Owned local tag identity changed; removal refused")
                self.docker.run(["image", "rm", reference])
            except Exception:
                errors.append("owned local tag cleanup failed")
        for kind, name in reversed(self.resources):
            try:
                field = ".Config.Labels" if kind == "container" else ".Labels"
                result = self.docker.run([kind, "inspect", name, "--format", "{{json " + field + "}}"], check=False, timeout=5)
                if result.returncode != 0:
                    if "No such" in (result.stderr or ""):
                        continue
                    raise RegistrySmokeError("Owned resource inspection unavailable")
                labels = json.loads(result.stdout)
                if not isinstance(labels, dict) or labels.get(OWNER_LABEL) != self.prefix:
                    raise RegistrySmokeError("Owned resource label mismatch")
                self.docker.run([kind, "rm", *(["--force"] if kind == "container" else []), name])
            except Exception:
                errors.append(f"owned {kind} cleanup failed")
        return errors

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("tested-bundle-load-and-source-identities", self.load)
            self.check("owned-loopback-registry-and-capacity", self.setup_registry)
            self.check("production-buildx-adapter-definite-tag-absence", self.production_transport_absence)
            self.check("exact-tested-image-publication", self.publish)
            self.check("independent-immutable-manifest-and-config-readback", self.readback)
            self.check("production-buildx-adapter-readback", self.production_transport_readback)
            self.check("mutable-source-tag-cannot-change-tested-publication", self.source_drift)
            self.check("registry-conflict-preserves-accepted-candidate", self.conflict)
        except Exception as error:
            try:
                from .registry_candidate import RegistryError
            except ImportError:
                from registry_candidate import RegistryError
            # Both error families expose fixed safe messages, never command argv or credentials.
            self.report["failure"] = str(error) if isinstance(error, (SmokeError, RegistryError, ForwarderError)) else type(error).__name__
            self.report["diagnostics"] = self.diagnostics()
        finally:
            errors = self.cleanup()
            self.report["cleanup"] = {"success": not errors, "errors": errors}
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and not errors
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        return self.report["success"]


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", required=True, type=Path)
    parser.add_argument("--expected-revision", required=True, type=validate_revision)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(arguments)
    try:
        with tempfile.TemporaryDirectory(prefix="wd-registry-auth-") as directory:
            docker = IsolatedDocker(Path(directory) / "docker")
            harness = RegistrySmoke(docker, args.bundle_dir, args.expected_revision, args.output_dir)
            passed = harness.run()
    except (SmokeError, ValueError, OSError) as error:
        print(f"Local registry smoke rejected: {error}", file=sys.stderr)
        return 1
    print(f"Local registry smoke {'passed' if passed else 'failed'}; report: {args.output_dir / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
