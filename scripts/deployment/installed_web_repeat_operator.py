"""Bind the next private Web slot to the actual first installed Web pair."""
from __future__ import annotations

from copy import deepcopy
import hashlib
from pathlib import Path
import time

from component_inputs import decode
from installed_web_backend import observe_backend
from installed_web_operator import (
    HOST, INGRESS, S3, _old_runtime, _relay_admin, candidate_ready, network_peer, observe_direct_failure,
    open_private_web, read_direct_web,
)
from installed_web_probe import Endpoint, TlsProbe, probe_public
from installed_web_hops import observe_route_hints
from installed_web_relay import read_autosave, verify_running
from installed_web_repeat import InstalledWebRepeat
from installed_web_runtime import build_candidate, require, verify_candidate
from installed_web_stage import read_record, start_private
from traefik_web_handoff import compile_traefik_web_handoff
from traefik_web_handoff_state import verify_accepted_traefik_web_handoff
from web_switch import SwitchHeld, canonical, content_hash


class RepeatWebInstallation:
    """Use the protected first-rollout receipts and stable relay for the next release."""

    def __init__(self, docker, *, first, operation, binding, first_load, chain, chain_sha256, watched):
        require(content_hash(chain) == chain_sha256 and chain["backendFingerprint"] == binding["backend"]["backendFingerprint"],
                "Exact retained Web chain and protected installation are required")
        self.docker, self.first, self.operation = docker, Path(first), Path(operation)
        self.state, self.watched = self.first / "rollout", Path(watched)
        self.binding, self.chain, self.chain_sha256 = binding, deepcopy(chain), chain_sha256
        self.inputs, self.incumbent = binding["inputs"], binding["incumbent"]
        self.network = self.inputs["networkIds"][INGRESS]
        self.staged = open_private_web(docker, binding, operation=self.first, incumbent=self.incumbent,
            load_receipt=first_load, expected_backend=self.backend(), observe_only=True)
        self.relay_alias = self.inputs["successorRelayAlias"]
        self.relay = self.staged["relay"]["runtime"]
        self.relay_dir = Path(self.staged["successorDirectory"])
        self.admin = _relay_admin(self.relay_dir, self.relay)
        self.handoff = compile_traefik_web_handoff(self.inputs["installedRouteBytes"].encode(),
            expected_sha256=self.inputs["installedRouteSha256"], original_alias=self.incumbent["relay"]["alias"],
            successor_alias=self.relay_alias)
        self.web = TlsProbe(Endpoint(HOST, self.inputs["publicIP"]))
        self.storage = TlsProbe(Endpoint(S3, self.inputs["publicStorageIP"]))

    def backend(self):
        current = observe_backend(self.docker, self.binding["backendPins"])
        require(current == self.binding["backend"], "Protected installed backend differs")
        return current

    def verify_ingress(self):
        verify_accepted_traefik_web_handoff(self.handoff, watched_dir=self.watched, state_dir=self.state)
        require(not (self.watched / "warpdrive-maintenance.yaml").exists(), "An installed maintenance route is active")
        row = self.docker.inspect(self.relay["id"])
        require(verify_running(row, self.staged["relayConfig"], alias=self.relay_alias, ingress_id=self.network,
                manifest=self.staged["relayManifest"]) == self.relay, "Accepted stable relay changed")

    def retained(self):
        backend = self.backend()
        self.verify_ingress()
        old_app = self.incumbent["app"]
        old_row = self.docker.inspect(old_app["id"])
        old = _old_runtime(old_row, self.inputs, old_app, backend["schemaSha256"])
        previous_row = self.docker.inspect(self.staged["slot"]["id"])
        active = verify_candidate(previous_row, self.staged["candidateConfig"], alias=self.inputs["candidateAlias"],
            network_ids=self.inputs["networkIds"], runtime_secret=self.inputs["runtimeSecret"])
        active["schemaSha256"] = backend["schemaSha256"]
        require(self.chain["previous"]["slot"]["runtime"] == old and self.chain["active"]["slot"]["runtime"] == active,
                "Exact retained Web process identity changed")
        return backend, old_row, old, active

    def _document(self, loaded, alias, revision):
        backend, row, old, _ = self.retained()
        require(loaded["state"] == "verified" and loaded["sourceRevision"] == revision
                and loaded["imageId"] == loaded["manifestDigest"], "Exact tested candidate image load required")
        doc, _ = build_candidate(row, incumbent_id=old["runtimeId"], incumbent_image=old["imageId"],
            incumbent_revision=old["sourceRevision"], candidate_image=loaded["imageId"], candidate_revision=revision,
            alias=alias, network_ids=self.inputs["networkIds"], runtime_secret=self.inputs["runtimeSecret"])
        return doc, backend

    def stage(self, *, loaded, alias, revision, release):
        doc, _ = self._document(loaded, alias, revision)
        live, _ = self.admin.config()
        require(live == read_autosave(self.relay_dir) == self.staged["caddy"]["successorB"],
                "The retained active pair changed before repeat staging")
        private = self.operation / "candidate"
        private.mkdir(mode=0o700, exist_ok=True)
        slot = start_private(self.docker, operation=private, alias=alias, document=doc, qualification=release,
            verify_created=lambda row: self._candidate(row, doc, alias, created=True)["running"] is False,
            ready=lambda row: candidate_ready(self.docker, self.network, alias, doc, self.inputs["networkIds"],
                self.inputs["runtimeSecret"], revision, self.inputs["version"], row), timeout=60)
        self.retained()
        live, _ = self.admin.config()
        require(live == read_autosave(self.relay_dir) == self.staged["caddy"]["successorB"],
                "Private repeat staging changed the accepted route")
        return slot

    def _candidate(self, row, doc, alias, *, created=False):
        return verify_candidate(row, doc, alias=alias, network_ids=self.inputs["networkIds"],
                                runtime_secret=self.inputs["runtimeSecret"], created=created)

    def _route_hints(self, backend):
        edge, realtime = (backend["processes"][name] for name in ("edge", "realtime"))
        old = self.incumbent["relay"]
        original_ip = network_peer(self.docker, self.network, self.docker.inspect(old["id"]), old["alias"])
        relay_ip = network_peer(self.docker, self.network, self.docker.inspect(self.relay["id"]), self.relay_alias)
        ws_ip = network_peer(self.docker, self.network, self.docker.inspect(realtime["id"]), "ws")
        return observe_route_hints(host=HOST, edge_id=edge["id"], edge_pid=edge["pid"], edge_ip=self.inputs["edgeIP"],
            web_peers={original_ip: f"http://{old['alias']}:8080", relay_ip: f"http://{self.relay_alias}:8080"},
            realtime_peers={ws_ip: "http://ws:8080"})

    def controller(self, *, loaded, alias, revision, release, verify_release):
        doc, backend = self._document(loaded, alias, revision)
        slot = read_record(self.operation / "candidate/stage-ready.json")
        require(slot["alias"] == alias and slot["configSha256"] == content_hash(doc)
                and slot["qualificationSha256"] == content_hash(release), "Exact repeat private stage receipt required")
        selected = {**slot["runtime"], "schemaSha256": backend["schemaSha256"]}
        aliases = {part["slot"]["runtime"]["runtimeId"]: part["alias"] for part in (self.chain["active"], self.chain["previous"])}
        aliases[selected["runtimeId"]] = alias

        def observe():
            current, _, old, active = self.retained()
            candidate = self._candidate(self.docker.inspect(slot["id"]), doc, alias)
            candidate["schemaSha256"] = current["schemaSha256"]
            return {"backendFingerprint": current["backendFingerprint"],
                    "runtimes": {"wd-" + runtime["sourceRevision"]: runtime for runtime in (old, active, candidate)}}

        def failure(value):
            runtime = value["runtime"]
            require(runtime["runtimeId"] == selected["runtimeId"], "Repeat failure probe requires the exact staged candidate")
            return observe_direct_failure(self.docker, runtime_id=runtime["runtimeId"], alias=alias, network=self.network,
                                          inspect_candidate=lambda row: self._candidate(row, doc, alias))

        def health(value, *, proxied):
            runtime = value["runtime"]
            healthy = self._public_health(runtime, backend, candidate_failure=lambda: failure(value)) if proxied else read_direct_web(network_peer(self.docker,
                self.network, self.docker.inspect(runtime["runtimeId"]), aliases[runtime["runtimeId"]]),
                runtime["sourceRevision"], self.inputs["version"])
            return {"runtimeId": runtime["runtimeId"], "generation": value["route"]["generation"], "healthy": healthy}

        before = canonical(self.staged["caddy"]["successorB"])
        return InstalledWebRepeat(self.state, admitted_chain=self.chain, expected_chain_sha256=self.chain_sha256,
            installed_bytes=before, expected_installed_sha256=hashlib.sha256(before).hexdigest(), host=HOST,
            traefik_ip=self.inputs["edgeIP"], relay_alias=self.relay_alias, candidate_runtime=selected, candidate_alias=alias,
            qualification_sha256=content_hash(release), admin=self.admin, verify_release=verify_release,
            observe_installed=observe, probe_health=health, read_durable_config=lambda: read_autosave(self.relay_dir),
            observe_candidate_failure=failure)

    def _public_health(self, runtime, backend, *, candidate_failure):
        self.verify_ingress()
        retained = runtime["runtimeId"] == self.chain["active"]["slot"]["runtime"]["runtimeId"]
        deadline = time.monotonic() + (22 if retained else 0)
        while True:
            response = self.web("GET", "/api/health", {}, read_body=True)
            if response.status not in (502, 503, 504):
                break
            if not retained and candidate_failure() is True:
                return False
            if time.monotonic() >= deadline:
                raise SwitchHeld("The retained Web relay is awaiting public health readback")
            time.sleep(0.5)
        value = decode(response.body)
        require(response.status == 200 and type(value) is dict and set(value) == {"ok"} and value["ok"] is True,
                "Exact installed database health required")
        edge = backend["processes"]["edge"]
        old_alias = self.incumbent["relay"]["alias"]
        report = probe_public(self.web, self.storage, host=HOST, storage_host=S3, revision=runtime["sourceRevision"],
            version=self.inputs["version"], successor_alias=self.relay_alias, incumbent_upstream=f"http://{old_alias}:8080",
            successor_upstream=f"http://{self.relay_alias}:8080", realtime_upstream="http://ws:8080",
            edge_runtime_id=edge["id"], read_route_hints=lambda: self._route_hints(backend))
        proof = report.handoff_observation(peers_unchanged=self.backend() == backend)
        if not proof.at("after") or proof.websocket_healthy is not True or proof.peers_unchanged is not True:
            raise SwitchHeld("Exact public ingress and protected peer health are unresolved")
        require(type(proof.public_healthy) is bool, "Exact public Web identity is unresolved")
        return proof.public_healthy
