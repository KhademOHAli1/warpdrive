"""Stage and control a Web successor using only its currently admitted Web pair."""

from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import time

from caddy_web_repeat import compile_repeat_web_configs
from component_inputs import decode
from installed_core_lineage import verify_projected_core_predecessor
from installed_web_backend import observe_backend
from installed_web_chain import _admit_journals, _directory, _state
from installed_web_hops import observe_route_hints
from installed_web_operator import HOST, INGRESS, S3, _relay_admin, candidate_ready, network_peer, observe_direct_failure, read_direct_web
from installed_web_probe import Endpoint, TlsProbe, probe_public
from installed_web_relay import create_document, read_autosave, verify_running
from installed_web_repeat import InstalledWebRepeat
from installed_web_runtime import ALIAS, COMMAND, ENTRYPOINT, IMAGE, NETWORKS, OWNER_LABEL, REVISION, installed_profile, require, verify_candidate
from installed_web_stage import read_record, start_private
from traefik_web_handoff import compile_traefik_web_handoff
from traefik_web_handoff_state import verify_accepted_traefik_web_handoff
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate
from web_switch import HASH, NAME, SwitchHeld, _lock, _matches, canonical, content_hash


def _document(profile, *, image, revision, alias):
    values = {**profile["environment"], "APP_COMMIT": revision, "NEXT_DEPLOYMENT_ID": "wd-" + revision}
    return {"Image": image, "User": "1000:1000", "WorkingDir": "/app", "Entrypoint": ENTRYPOINT.copy(),
            "Cmd": COMMAND.copy(), "StopTimeout": 40, "ExposedPorts": {"3000/tcp": {}}, "Healthcheck": deepcopy(profile["healthcheck"]),
            "Env": [f"{key}={value}" for key, value in sorted(values.items())], "Labels": {OWNER_LABEL: alias, "traefik.enable": "false"},
            "HostConfig": {**deepcopy(profile["limits"]), "NetworkMode": NETWORKS[0], "Mounts": deepcopy(profile["mounts"]),
                           "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0}},
            "NetworkingConfig": {"EndpointsConfig": {name: {"NetworkID": identifier, "Aliases": [alias]}
                                                       for name, identifier in profile["networks"].items()}}}


def read_admitted_web_slot(row, *, item, network_ids, runtime_secret, schema_sha256):
    """Validate a live private Web slot against the accepted immutable runtime."""
    runtime, alias = item["slot"]["runtime"], item["alias"]
    require(ALIAS.fullmatch(alias) and runtime["name"] == alias and row["Id"] == runtime["runtimeId"],
            "Exact private retained Web runtime and alias required")
    profile = installed_profile(row, image_id=runtime["imageId"], revision=runtime["sourceRevision"],
                                network_ids=network_ids, runtime_secret=runtime_secret)
    document = _document(profile, image=runtime["imageId"], revision=runtime["sourceRevision"], alias=alias)
    observed = verify_candidate(row, document, alias=alias, network_ids=network_ids, runtime_secret=runtime_secret)
    require({**observed, "schemaSha256": schema_sha256} == runtime and row["State"]["Status"] == "running"
            and row["State"]["Health"]["Status"] == "healthy", "Accepted private Web runtime, profile or health differs")
    return profile


_IMAGE_INDEX_TYPES = {"application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"}
_IMAGE_MANIFEST_TYPES = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
_RELAY_PLATFORM = {"os": "linux", "architecture": "amd64"}


def _relay_manifest(docker, relay):
    """Bind the stable relay's running platform manifest to its immutable image target."""
    identifier, image_id = relay["id"], relay["imageId"]
    require(IMAGE.fullmatch(image_id), "Exact stable relay image target required")
    row = docker.inspect(identifier)
    selected = row.get("ImageManifestDescriptor")
    image = docker.request("GET", f"/images/{image_id}/json?manifests=true")
    descriptor = image.get("Descriptor")
    require(row.get("Id") == identifier and row.get("Image") == image_id and image.get("Id") == image_id
            and type(selected) is dict and type(descriptor) is dict and descriptor.get("digest") == image_id
            and type(descriptor.get("size")) is int and descriptor["size"] > 0
            and _valid_platform_manifest(selected), "Exact stable relay native image descriptor required")
    if descriptor.get("mediaType") in _IMAGE_MANIFEST_TYPES:
        require(all(descriptor[key] == selected[key] for key in ("digest", "mediaType", "size")),
                "Stable relay single-platform image differs from its running manifest")
        return selected
    summaries = image.get("Manifests")
    require(descriptor.get("mediaType") in _IMAGE_INDEX_TYPES and type(summaries) is list and 0 < len(summaries) <= 256,
            "Exact stable relay image index inventory required")
    require(all(type(summary) is dict and type(summary.get("Descriptor")) is dict for summary in summaries),
            "Stable relay image index inventory is malformed")
    candidates = [summary for summary in summaries if summary["Descriptor"].get("platform") == _RELAY_PLATFORM]
    require(len(candidates) == 1 and candidates[0]["Descriptor"] == selected and candidates[0].get("ID") == selected["digest"]
            and candidates[0].get("Kind") == "image" and candidates[0].get("Available") is True
            and type(candidates[0].get("ImageData")) is dict and candidates[0]["ImageData"].get("Platform") == _RELAY_PLATFORM,
            "Stable relay index does not admit one available exact running platform manifest")
    return selected


def _valid_platform_manifest(descriptor):
    digest, size = descriptor.get("digest"), descriptor.get("size")
    return (isinstance(digest, str) and IMAGE.fullmatch(digest) and type(size) is int and size > 0
            and descriptor.get("mediaType") in _IMAGE_MANIFEST_TYPES and descriptor.get("platform") == _RELAY_PLATFORM)


class InstalledWebSuccessor:
    """Use trusted original backend authority and two independently admitted private slots.

    The caller holds the shared installation lock, validates current Docker daemon
    identity and supplies the original binding with its independent journal pin.
    `preimage` is exact canonical C+B bytes retained at stage for later recovery.
    The class uses the original state directory and stable relay throughout.
    """

    def __init__(self, docker, *, first, operation, binding, expected_binding_sha256, chain, chain_sha256, watched, preimage,
                 retained_core=None, expected_retained_core_sha256=None,
                 core_activation_operation_id=None, expected_core_activation_lineage_sha256=None):
        self.first, self.operation = map(Path, (first, operation))
        self.state, self.watched = self.first / "rollout", Path(watched)
        for path in (self.first, self.operation, self.state):
            _directory(path)
        require(not self.first.is_relative_to(self.operation) and not self.operation.is_relative_to(self.first)
                and content_hash(binding) == expected_binding_sha256
                and content_hash(chain) == chain_sha256,
                "Exact original installation authority and current Web chain required")
        self.docker, self.binding, self.chain, self.chain_sha256 = docker, deepcopy(binding), deepcopy(chain), chain_sha256
        self.inputs = self.binding["inputs"]
        self.network = self.inputs["networkIds"][INGRESS]
        self.expected_backend = deepcopy(self.binding["backend"])
        self.core_pin, self.core_alias = None, None
        self.core_authority_sha256 = expected_retained_core_sha256
        require((retained_core is None) == (expected_retained_core_sha256 is None)
                and "core" not in self.expected_backend["processes"],
                "Retained Core needs its own authority beside the original protected backend")
        if retained_core is not None:
            self._admit_core(retained_core, expected_retained_core_sha256, expected_binding_sha256)
        require((core_activation_operation_id is None) == (expected_core_activation_lineage_sha256 is None)
                and (core_activation_operation_id is None or retained_core is not None), "Paired Core activation lineage pins required")
        self.core_activation_operation_id = core_activation_operation_id
        self.core_activation_lineage_sha256 = expected_core_activation_lineage_sha256
        require(self.chain["backendFingerprint"] == self.expected_backend["backendFingerprint"],
                "Exact protected backend required for the current Web chain")
        self.aliases = {name: self.chain[name]["alias"] for name in ("active", "previous")}
        require(all(ALIAS.fullmatch(alias) for alias in self.aliases.values()) and len(set(self.aliases.values())) == 2,
                "Both admitted Web generations must be distinct private runtime slots")
        self.generations = {name: WebGeneration(self.chain[name]["slot"]["route"]["generation"], alias)
                            for name, alias in self.aliases.items()}
        require(type(preimage) is bytes and 0 < len(preimage) <= 128 * 1024
                and sha256(preimage).hexdigest() == self.chain["active"]["slot"]["route"]["fingerprint"],
                "Exact retained canonical Web Caddy preimage required")
        self.preimage = preimage
        self.relay_alias = self.inputs["successorRelayAlias"]
        self.relay_dir = self.first / "relay"
        stage = read_record(self.relay_dir / "stage-ready.json")
        self.relay = stage["runtime"]
        old_relay = self.binding["incumbent"]["relay"]
        self.relay_doc = create_document(self.relay_dir, alias=self.relay_alias, image=old_relay["imageId"], ingress_id=self.network)
        require(stage["id"] == self.relay["id"] and stage["alias"] == self.relay_alias
                and stage["qualificationSha256"] == expected_binding_sha256 and stage["configSha256"] == content_hash(self.relay_doc)
                and self.relay["imageId"] == old_relay["imageId"], "Exact stable relay stage receipt required")
        self.relay_manifest = _relay_manifest(docker, self.relay)
        self.handoff = compile_traefik_web_handoff(self.inputs["installedRouteBytes"].encode(),
            expected_sha256=self.inputs["installedRouteSha256"], original_alias=old_relay["alias"], successor_alias=self.relay_alias)
        self._old_upstream = f"http://{old_relay['alias']}:8080"
        self.admin = _relay_admin(self.relay_dir, self.relay)
        self.web = TlsProbe(Endpoint(HOST, self.inputs["publicIP"]))
        self.storage = TlsProbe(Endpoint(S3, self.inputs["publicStorageIP"]))

    def _admit_core(self, profile, expected_hash, original_hash):
        keys = {"schemaVersion", "kind", "originalBindingSha256", "acceptedChainSha256", "corePin", "coreWitness"}
        require(type(profile) is dict and set(profile) == keys and _matches(HASH, expected_hash)
                and content_hash(profile) == expected_hash
                and type(profile["schemaVersion"]) is int and profile["schemaVersion"] == 1
                and profile["kind"] == "warpdrive-installed-retained-core"
                and profile["originalBindingSha256"] == original_hash and profile["acceptedChainSha256"] == self.chain_sha256,
                "Exact independently admitted retained Core authority required")
        pin, witness = deepcopy(profile["corePin"]), deepcopy(profile["coreWitness"])
        require(type(pin) is dict and type(pin.get("ingress")) is dict and type(pin.get("database")) is dict
                and type(witness) is dict and isinstance(pin.get("id"), str) and pin["id"] == witness.get("id")
                and pin["ingress"].get("networkId") == self.network
                and pin["database"].get("networkId") == self.inputs["networkIds"][NETWORKS[1]]
                and isinstance(pin["ingress"].get("alias"), str),
                "Retained Core must use the admitted installation networks and process")
        self.core_pin, self.core_alias = pin, pin["ingress"]["alias"]
        facts = {"schemaSha256": self.expected_backend["schemaSha256"],
                 "processes": {**self.expected_backend["processes"], "core": witness}}
        self.expected_backend = {**facts, "backendFingerprint": content_hash(facts)}

    def _verify_ingress(self):
        verify_accepted_traefik_web_handoff(self.handoff, watched_dir=self.watched, state_dir=self.state)
        require(not os.path.lexists(self.watched / "warpdrive-maintenance.yaml"), "Installed maintenance route is active")
        row = self.docker.inspect(self.relay["id"])
        require(verify_running(row, self.relay_doc, alias=self.relay_alias, ingress_id=self.network,
                               manifest=self.relay_manifest) == self.relay, "Stable installed Web relay changed")
        return row

    def _backend(self):
        if self.core_pin is None:
            observed = observe_backend(self.docker, self.binding["backendPins"])
        else:
            observed = observe_backend(self.docker, self.binding["backendPins"], core_pin=self.core_pin)
        require(observed == self.expected_backend, "Protected original backend or schema changed")
        return observed

    def backend(self):
        return self._backend()

    def _retained(self):
        backend = self._backend()
        self._verify_ingress()
        profiles = {}
        for name in ("active", "previous"):
            item = self.chain[name]
            row = self.docker.inspect(item["slot"]["runtime"]["runtimeId"])
            profiles[name] = read_admitted_web_slot(row, item=item, network_ids=self.inputs["networkIds"],
                runtime_secret=self.inputs["runtimeSecret"], schema_sha256=backend["schemaSha256"])
        return backend, profiles["active"]

    def _candidate_document(self, loaded, alias, revision):
        require(ALIAS.fullmatch(alias) and alias not in self.aliases.values() and REVISION.fullmatch(revision)
                and all("wd-" + revision != generation.deployment_id for generation in self.generations.values())
                and loaded["kind"] == "warpdrive-installed-web-image-load" and loaded["state"] == "verified"
                and loaded["sourceRevision"] == revision and IMAGE.fullmatch(loaded["imageId"])
                and loaded["imageId"] == loaded["manifestDigest"] and loaded["daemon"] == self.binding["daemon"]
                and all(loaded["imageId"] != item["slot"]["runtime"]["imageId"] for item in (self.chain["active"], self.chain["previous"])),
                "Exact new verified Web candidate and Docker daemon required")
        backend, profile = self._retained()
        return _document(profile, image=loaded["imageId"], revision=revision, alias=alias), backend

    def _candidate(self, row, document, alias, *, created=False):
        return verify_candidate(row, document, alias=alias, network_ids=self.inputs["networkIds"],
                                runtime_secret=self.inputs["runtimeSecret"], created=created)

    def _stage_preimage(self, *, check_journals=False):
        operation = self.chain["acceptedOperationId"]
        require(isinstance(operation, str) and NAME.fullmatch(operation), "Exact accepted Web predecessor required")
        journal = _state(self.state / "web-rollouts" / (operation + ".json"))
        plan = journal["plan"]
        _validate(plan)
        if self.core_activation_operation_id is None:
            require(plan["backendFingerprint"] == self.chain["backendFingerprint"] and plan["after"] == self.chain["active"]["slot"],
                    "Current accepted Web predecessor changed")
            pointer = _record(plan, plan["after"])
        else:
            projection = verify_projected_core_predecessor(self.state, chain=self.chain, activation_operation_id=self.core_activation_operation_id,
                expected_activation_lineage_sha256=self.core_activation_lineage_sha256)
            require(projection.core_authority_sha256 == self.core_authority_sha256, "Projected lineage Core authority differs")
            pointer = projection.accepted_pointer
        require(journal["state"] == "accepted" and plan["operationId"] == operation
                and content_hash(plan) == self.chain["acceptedPlanSha256"] and plan["targetKey"] == self.chain["targetKey"]
                and plan["before"] == self.chain["previous"]["slot"]
                and _state(self.state / "accepted-web-generation.json") == pointer,
                "Current accepted Web predecessor changed")
        if check_journals:
            operations = self.state / "web-rollouts"
            _directory(operations)
            _admit_journals(operations, plan)
        current, etag = self.admin.config()
        require(canonical(current) == self.preimage and current == read_autosave(self.relay_dir)
                and self.admin.config() == (current, etag), "Exact live and persisted predecessor Web route is unavailable")

    def stage(self, *, loaded, alias, revision, release):
        with _lock(self.state):
            return self._stage(loaded=loaded, alias=alias, revision=revision, release=release)

    def _stage(self, *, loaded, alias, revision, release):
        doc, _ = self._candidate_document(loaded, alias, revision)
        compile_repeat_web_configs(self.preimage, expected_sha256=sha256(self.preimage).hexdigest(), host=HOST,
            traefik_ip=self.inputs["edgeIP"], relay_alias=self.relay_alias, current=self.generations["active"],
            previous=self.generations["previous"], candidate=WebGeneration("wd-" + revision, alias), core_alias=self.core_alias)
        self._stage_preimage(check_journals=True)
        private = self.operation / "candidate"
        private.mkdir(mode=0o700, exist_ok=True)
        slot = start_private(self.docker, operation=private, alias=alias, document=doc, qualification=release,
            verify_created=lambda row: self._candidate(row, doc, alias, created=True)["running"] is False,
            ready=lambda row: candidate_ready(self.docker, self.network, alias, doc, self.inputs["networkIds"],
                                              self.inputs["runtimeSecret"], revision, self.inputs["version"], row), timeout=60)
        self._retained()
        self._stage_preimage()
        return slot

    def _route_hints(self, backend):
        edge, realtime = (backend["processes"][name] for name in ("edge", "realtime"))
        relay = network_peer(self.docker, self.network, self._verify_ingress(), self.relay_alias)
        ws = network_peer(self.docker, self.network, self.docker.inspect(realtime["id"]), "ws")
        return observe_route_hints(host=HOST, edge_id=edge["id"], edge_pid=edge["pid"], edge_ip=self.inputs["edgeIP"],
            web_peers={relay: f"http://{self.relay_alias}:8080"}, realtime_peers={ws: "http://ws:8080"})

    def _public_health(self, runtime, backend, *, failure):
        self._verify_ingress()
        retained = runtime["runtimeId"] == self.chain["active"]["slot"]["runtime"]["runtimeId"]
        deadline = time.monotonic() + (22 if retained else 0)
        while True:
            response = self.web("GET", "/api/health", {}, read_body=True)
            if response.status not in (502, 503, 504):
                break
            if not retained and failure() is True:
                return False
            if time.monotonic() >= deadline:
                raise SwitchHeld("Exact successor Web public health is unresolved")
            time.sleep(0.5)
        value = decode(response.body)
        require(response.status == 200 and type(value) is dict and set(value) == {"ok"} and value["ok"] is True,
                "Exact successor Web database health required")
        proof = probe_public(self.web, self.storage, host=HOST, storage_host=S3, revision=runtime["sourceRevision"],
            version=self.inputs["version"], successor_alias=self.relay_alias, incumbent_upstream=self._old_upstream,
            successor_upstream=f"http://{self.relay_alias}:8080", realtime_upstream="http://ws:8080",
            edge_runtime_id=backend["processes"]["edge"]["id"], read_route_hints=lambda: self._route_hints(backend))
        observation = proof.handoff_observation(peers_unchanged=self._backend() == backend)
        if not observation.at("after") or observation.websocket_healthy is not True or observation.peers_unchanged is not True:
            raise SwitchHeld("Exact successor Web ingress or protected peer is unresolved")
        if observation.public_healthy is True:
            return True
        if not retained and failure() is True:
            return False
        raise SwitchHeld("Exact public Web readiness or definite candidate failure is unresolved")

    def controller(self, *, loaded, alias, revision, release, verify_release):
        doc, backend = self._candidate_document(loaded, alias, revision)
        stage = read_record(self.operation / "candidate/stage-ready.json")
        require(stage["alias"] == alias and stage["id"] == stage["runtime"]["runtimeId"] and stage["configSha256"] == content_hash(doc)
                and stage["qualificationSha256"] == content_hash(release), "Exact successor private stage receipt required")
        selected = {**stage["runtime"], "schemaSha256": backend["schemaSha256"]}
        aliases = {self.chain[name]["slot"]["runtime"]["runtimeId"]: value for name, value in self.aliases.items()}
        aliases[selected["runtimeId"]] = alias

        def observe():
            current, _ = self._retained()
            candidate = self._candidate(self.docker.inspect(stage["id"]), doc, alias)
            return {"backendFingerprint": current["backendFingerprint"], "runtimes": {
                **{self.generations[name].deployment_id: self.chain[name]["slot"]["runtime"] for name in self.generations},
                "wd-" + revision: {**candidate, "schemaSha256": current["schemaSha256"]}}}

        def failure(value):
            require(value["runtime"]["runtimeId"] == selected["runtimeId"], "Failure proof requires the exact new Web runtime")
            return observe_direct_failure(self.docker, runtime_id=stage["id"], alias=alias, network=self.network,
                                          inspect_candidate=lambda row: self._candidate(row, doc, alias))

        def health(value, *, proxied):
            runtime = value["runtime"]
            healthy = self._public_health(runtime, backend, failure=lambda: failure(value)) if proxied else read_direct_web(network_peer(
                self.docker, self.network, self.docker.inspect(runtime["runtimeId"]), aliases[runtime["runtimeId"]]),
                runtime["sourceRevision"], self.inputs["version"])
            return {"runtimeId": runtime["runtimeId"], "generation": value["route"]["generation"], "healthy": healthy}

        return InstalledWebRepeat(self.state, admitted_chain=self.chain, expected_chain_sha256=self.chain_sha256,
            installed_bytes=self.preimage, expected_installed_sha256=sha256(self.preimage).hexdigest(), host=HOST,
            traefik_ip=self.inputs["edgeIP"], relay_alias=self.relay_alias, candidate_runtime=selected, candidate_alias=alias,
            qualification_sha256=content_hash(release), admin=self.admin, verify_release=verify_release, observe_installed=observe,
            probe_health=health, read_durable_config=lambda: read_autosave(self.relay_dir), observe_candidate_failure=failure,
            core_alias=self.core_alias, core_activation_operation_id=self.core_activation_operation_id,
            expected_core_authority_sha256=self.core_authority_sha256 if self.core_activation_operation_id is not None else None,
            expected_core_activation_lineage_sha256=self.core_activation_lineage_sha256)
