"""Operate one exact installed Web release without creating or restarting backend services."""
from __future__ import annotations

from copy import deepcopy
from http.client import HTTPConnection, HTTPException
from ipaddress import IPv4Address
from pathlib import Path
import re
import time

from caddy_admin import CaddyAdmin
from caddy_web_config import _generation_handler, compile_successor_web_configs
from caddy_core_config import core_api_routes
from component_inputs import decode
from installed_web_backend import observe_backend, process_witness
from installed_web_emergency import restore_failed_installed_web
from installed_web_handoff import apply_installed_handoff
from installed_web_hops import observe_route_hints
from installed_web_intent_recovery import recover_failed_installed_web_intent
from installed_web_probe import Endpoint, TlsProbe, probe_public
from installed_web_relay import create_document, read_autosave, seed_autosave, verify_relay, verify_running
from installed_web_runtime import build_candidate, installed_profile, require, verify_candidate
from installed_web_stage import exclusive, read_record, start_private
from installed_web_target import InstalledWebTarget
from traefik_web_handoff import compile_traefik_web_handoff
from traefik_web_handoff_state import verify_accepted_traefik_web_handoff
from traefik_web_relay import _caddy_config
from web_generation_routes import WebGeneration, compile_web_generation_routes
from web_rollout import rollout_web
from web_switch import SwitchHeld, _read, content_hash


HOST = "crm.pitant.de"
S3 = "s3.crm.pitant.de"
INGRESS = "pitant-warpdrive-ingress"
MAX_BODY = 8192
SLOT_ALIAS = re.compile(r"warpdrive-web-[a-f0-9]{12}\Z")


def network_peer(docker, network_id, row, alias):
    network = docker.network(network_id)
    peer = row["NetworkSettings"]["Networks"][INGRESS]
    linked = network["Containers"][row["Id"]]
    require(network["Id"] == network_id and network["Name"] == INGRESS and network["Driver"] == "bridge"
            and peer["NetworkID"] == network_id and linked["Name"] == row["Name"].removeprefix("/")
            and peer["EndpointID"] == linked["EndpointID"] and peer["EndpointID"]
            and IPv4Address(peer["IPAddress"]).is_private
            and linked["IPv4Address"].split("/", 1)[0] == peer["IPAddress"]
            and alias in (peer.get("Aliases") or []) + (peer.get("DNSNames") or []), "Exact installed ingress endpoint required")
    claims = []
    require(2 <= len(network["Containers"]) <= 20, "Bounded installed ingress inventory required")
    for identifier in network["Containers"]:
        member = docker.inspect(identifier)
        endpoint = member["NetworkSettings"]["Networks"][INGRESS]
        if alias in (endpoint.get("Aliases") or []) + (endpoint.get("DNSNames") or []):
            claims.append(identifier)
    require(claims == [row["Id"]], "Installed ingress alias has ambiguous ownership")
    return peer["IPAddress"]


def _request(address, port, method, path, *, headers=None, timeout=3):
    connection = HTTPConnection(address, port, timeout=timeout)
    try:
        base = {"Host": HOST, "Connection": "close", "Accept-Encoding": "identity", "X-Forwarded-Proto": "https"}
        connection.request(method, path, body=b"" if method == "POST" else None, headers=base | (headers or {}))
        with connection.getresponse() as response:
            body = response.read(MAX_BODY + 1)
            require(len(body) <= MAX_BODY, "Installed Web probe response exceeds its bound")
            return response.status, response.headers, body
    finally:
        connection.close()


def read_direct_web(address, revision, version):
    status, _, body = _request(address, 3000, "GET", "/api/health")
    if status != 200:
        return False
    require(decode(body) == {"ok": True}, "Installed Web health response differs")
    status, headers, body = _request(address, 3000, "GET", "/api/runtime/web-identity")
    require(status == 200 and headers.get_all("Cache-Control") == ["no-store"]
            and decode(body) == {"component": "web", "contract": "warpdrive.web.identity.v1",
                                 "sourceRevision": revision, "version": version}, "Installed Web identity differs")
    return True


def observe_direct_failure(docker, *, runtime_id, alias, network, inspect_candidate):
    """Identify a definite application failure at the admitted private Web slot."""
    def witness():
        row = docker.inspect(runtime_id)
        runtime = inspect_candidate(row)
        if not runtime["running"] or row["State"]["Status"] != "running":
            return None
        address = network_peer(docker, network, row, alias)
        endpoint = row["NetworkSettings"]["Networks"][INGRESS]
        return (runtime, row["State"]["Pid"], row["State"]["StartedAt"], endpoint["EndpointID"], address)

    before = witness()
    if before is None:
        return None
    try:
        status, headers, body = _request(before[-1], 3000, "GET", "/api/health", timeout=7)
        content_type = headers.get_all("Content-Type") or []
        if (len(content_type) != 1 or content_type[0].split(";", 1)[0].lower() != "application/json"
                or headers.get_all("Content-Encoding") not in (None, ["identity"]) or witness() != before):
            return None
        observed = decode(body)
    except (OSError, ValueError, HTTPException):
        return None
    if type(observed) is not dict or set(observed) != {"ok"}:
        return None
    if status == 503 and observed["ok"] is False:
        return True
    if status == 200 and observed["ok"] is True:
        return False
    return None


def candidate_ready(docker, network_id, alias, document, network_ids, runtime_secret, revision, version, row):
    witness = verify_candidate(row, document, alias=alias, network_ids=network_ids, runtime_secret=runtime_secret)
    if not (witness["running"] and row["State"].get("Health", {}).get("Status") == "healthy"):
        return None
    verify_candidate(row, document, alias=alias, network_ids=network_ids, runtime_secret=runtime_secret, require_ready=True)
    address = network_peer(docker, network_id, row, alias)
    if not read_direct_web(address, revision, version):
        return None
    return witness


def _relay_admin(directory, witness):
    return CaddyAdmin(directory / "socket/control.sock", socket_uid=10001, socket_gid=10001, socket_mode=0o600,
                      peer_pid=witness["pid"], peer_uid=10001, peer_gid=10001, directory_uid=10001)


def _relay_ready(directory, row, document, alias, network, manifest, expected):
    if not row["State"]["Running"] or not (directory / "socket/control.sock").exists():
        return None
    witness = verify_running(row, document, alias=alias, ingress_id=network, manifest=manifest)
    try:
        live, _ = _relay_admin(directory, witness).config()
    except SwitchHeld:
        return None
    require(live == read_autosave(directory) and live == expected, "Prepared relay and durable exact config differ")
    return witness


def open_private_web(docker, evidence, *, operation, incumbent, load_receipt, expected_backend, observe_only=False):
    """Stage the independently loaded Web and private Caddy relay. No public route changes."""
    inputs = evidence["inputs"]
    old, new = inputs["baselineRevision"], inputs["candidateRevision"]
    require(load_receipt["kind"] == "warpdrive-installed-web-image-load" and load_receipt["state"] == "verified"
            and load_receipt["imageId"] == load_receipt["manifestDigest"]
            and load_receipt["sourceRevision"] == new and load_receipt["baselineRevision"] == old
            and load_receipt["testedConfigDigest"] == inputs["testedConfigDigest"]
            and load_receipt["bundleManifestSha256"] == inputs["bundleManifestSha256"]
            and load_receipt["archiveSha256"] == inputs["archiveSha256"], "Installed Web image differs from accepted artifact")
    app, current_relay = (docker.inspect(incumbent[name]["id"]) for name in ("app", "relay"))
    require(current_relay["Image"] == incumbent["relay"]["imageId"] and current_relay["State"]["Running"]
            and current_relay["Name"] == "/" + incumbent["relay"]["alias"], "Installed original relay changed")
    network_ids = inputs["networkIds"]
    public = network_ids[INGRESS]
    alias, relay_alias = inputs["candidateAlias"], inputs["successorRelayAlias"]
    require(SLOT_ALIAS.fullmatch(alias), "Exact owned candidate Web alias required")
    old_image = incumbent["app"]["imageId"]
    candidate_image = load_receipt["imageId"]
    document, fingerprint = build_candidate(
        app, incumbent_id=incumbent["app"]["id"], incumbent_image=old_image, incumbent_revision=old,
        candidate_image=candidate_image, candidate_revision=new, alias=alias, network_ids=network_ids,
        runtime_secret=inputs["runtimeSecret"],
    )
    require(observe_backend(docker, evidence["backendPins"]) == expected_backend, "Protected backend changed before staging")
    slots = operation / "candidate"
    relay_dir = operation / "relay"
    if not observe_only:
        slots.mkdir(mode=0o700, exist_ok=True)
        relay_dir.mkdir(mode=0o700, exist_ok=True)
    caddy = compile_successor_web_configs(inputs["installedCaddyBytes"].encode(),
        expected_sha256=inputs["installedCaddySha256"], host=HOST, traefik_ip=inputs["edgeIP"],
        installed_relay_alias=incumbent["relay"]["alias"], successor_relay_alias=relay_alias,
        current=WebGeneration("wd-" + old, "app"), candidate=WebGeneration("wd-" + new, alias))
    if not observe_only and not (relay_dir / "stage-intent.json").exists() and not (relay_dir / "config").exists():
        seed_autosave(relay_dir, caddy["successorA"])
    relay_doc = create_document(relay_dir, alias=relay_alias, image=incumbent["relay"]["imageId"], ingress_id=public)
    manifest = current_relay["ImageManifestDescriptor"]
    if observe_only:
        slot = read_record(slots / "stage-ready.json")
        relay = read_record(relay_dir / "stage-ready.json")
        for record, name, expected_document in ((slot, alias, document), (relay, relay_alias, relay_doc)):
            require(record["alias"] == name and record["configSha256"] == content_hash(expected_document)
                    and record["qualificationSha256"] == content_hash(evidence), "Installed private stage binding changed")
    else:
        slot = start_private(docker, operation=slots, alias=alias, document=document, qualification=evidence,
                             verify_created=lambda row: verify_candidate(row, document, alias=alias, network_ids=network_ids,
                                 runtime_secret=inputs["runtimeSecret"], created=True)["running"] is False,
                             ready=lambda row: candidate_ready(docker, public, alias, document, network_ids,
                                 inputs["runtimeSecret"], new, inputs["version"], row), timeout=60)
        relay = start_private(docker, operation=relay_dir, alias=relay_alias, document=relay_doc, qualification=evidence,
                             verify_created=lambda row: verify_relay(row, relay_doc, alias=relay_alias, ingress_id=public,
                                                                    manifest=manifest, running=False)["pid"] == 0,
                             ready=lambda row: _relay_ready(relay_dir, row, relay_doc, relay_alias, public, manifest,
                                                            caddy["successorA"]))
    require(observe_backend(docker, evidence["backendPins"]) == expected_backend, "Protected backend changed during staging")
    return {"slot": slot, "relay": relay, "caddy": caddy, "candidateConfig": document, "baselineConfigSha256": fingerprint,
            "successorDirectory": str(relay_dir), "relayConfig": relay_doc, "relayManifest": manifest}


def operation_plan(inputs, evidence, old_runtime, staged, backend):
    schema = backend["schemaSha256"]
    pair = (old_runtime, staged["slot"]["runtime"])
    documents = (staged["caddy"]["successorA"], staged["caddy"]["successorB"])
    slots = [{"runtime": {**runtime, "schemaSha256": schema}, "route": {
        "generation": "wd-" + runtime["sourceRevision"], "fingerprint": content_hash(document),
        "runtimeId": runtime["runtimeId"],
    }} for runtime, document in zip(pair, documents, strict=True)]
    return {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": inputs["operationId"], "targetKey": "pitant-warpdrive",
            "before": slots[0], "after": slots[1], "backendFingerprint": backend["backendFingerprint"],
            "qualificationSha256": content_hash(evidence)}


def healthy_rollback(plan, documents, *, current, candidate, core_alias=None):
    """Return a qualified A-active route that continues to serve healthy B tabs."""
    restored = deepcopy(documents["successorA"])
    gate = restored["apps"]["http"]["servers"]["web-relay"]["routes"][0]["match"][0]
    host, = gate["host"]
    peer, = gate["remote_ip"]["ranges"]
    reversed_web = _caddy_config(host, peer, compile_web_generation_routes(current=current, previous=candidate))
    routes = _generation_handler(restored)["routes"]
    prefix = [] if core_alias is None else core_api_routes(core_alias, current, candidate)
    routes[1:] = [*prefix, *_generation_handler(reversed_web)["routes"]]
    old = {**plan["before"], "route": {**plan["before"]["route"], "fingerprint": content_hash(restored)}}
    reverse = {**plan, "operationId": plan["operationId"] + "-rollback", "before": plan["after"], "after": old}
    reapplied = {**plan, "operationId": plan["operationId"] + "-reapply", "before": old}
    return reverse, reapplied, restored


def _old_runtime(row, inputs, app, schema):
    profile = installed_profile(row, image_id=app["imageId"], revision=inputs["baselineRevision"],
                                network_ids=inputs["networkIds"], runtime_secret=inputs["runtimeSecret"])
    require(row["Id"] == app["id"] and row["State"]["Running"] and row["State"]["StartedAt"] == app["startedAt"],
            "Exact original Web process changed")
    return {"runtimeId": row["Id"], "imageId": row["Image"], "name": row["Name"].removeprefix("/"),
            "sourceRevision": inputs["baselineRevision"], "configSha256": content_hash(profile), "schemaSha256": schema,
            "restartCount": row["RestartCount"], "running": row["State"]["Running"]}


def _execute(docker, *, evidence, operation, incumbent, load_receipt, expected_backend, watched,
             release_observer, direct_relay_probe, action):
    require(release_observer(evidence) is True, "Exact tested Web release and backup authority required")
    inputs = evidence["inputs"]
    state = operation / "rollout"
    state.mkdir(mode=0o700, exist_ok=True)
    accepted = state / "accepted-web-generation.json"
    require(action in ("promote", "rollback", "reapply", "rollback-reapplied", "recover")
            and (action == "promote" or accepted.exists()),
            "A follow-up operation requires an installed accepted Web generation")
    network = inputs["networkIds"][INGRESS]
    staged = open_private_web(docker, evidence, operation=operation, incumbent=incumbent,
                              load_receipt=load_receipt, expected_backend=expected_backend, observe_only=accepted.exists())
    old_relay = incumbent["relay"]
    successor = staged["relay"]
    successor_dir = Path(staged["successorDirectory"])
    successor_alias = inputs["successorRelayAlias"]
    old_alias = old_relay["alias"]
    edge, realtime = (expected_backend["processes"][name] for name in ("edge", "realtime"))
    upstream = "http://ws:8080"

    def backend():
        return observe_backend(docker, evidence["backendPins"])

    def relay_witness(receipt, alias):
        row = docker.inspect(receipt["id"])
        process = process_witness(row, running=True)
        require(process["imageId"] == receipt["imageId"] and process["startedAt"] == receipt["startedAt"],
                "A protected Web relay generation changed")
        if alias == successor_alias:
            require(verify_running(row, staged["relayConfig"], alias=alias, ingress_id=network, manifest=staged["relayManifest"]) == receipt,
                    "Successor relay configuration or runtime witness changed")
        return network_peer(docker, network, row, alias)

    def hops():
        old_ip = relay_witness(old_relay, old_alias)
        relay_ip = relay_witness(successor["runtime"], successor_alias)
        edge_ip = network_peer(docker, network, docker.inspect(edge["id"]), "traefik")
        require(edge_ip == inputs["edgeIP"], "Installed Traefik peer address changed")
        ws_ip = network_peer(docker, network, docker.inspect(realtime["id"]), "ws")
        return observe_route_hints(host=HOST, edge_id=edge["id"], edge_pid=edge["pid"], edge_ip=edge_ip,
            web_peers={old_ip: f"http://{old_alias}:8080", relay_ip: f"http://{successor_alias}:8080"},
            realtime_peers={ws_ip: upstream})

    web, storage = TlsProbe(Endpoint(HOST, inputs["publicIP"])), TlsProbe(Endpoint(S3, inputs["publicStorageIP"]))
    handoff_plan = compile_traefik_web_handoff(inputs["installedRouteBytes"].encode(),
        expected_sha256=inputs["installedRouteSha256"], original_alias=old_alias, successor_alias=successor_alias)
    def verify_handoff():
        verify_accepted_traefik_web_handoff(handoff_plan, watched_dir=watched, state_dir=state)
        require(not (watched / "warpdrive-maintenance.yaml").exists(), "The installed maintenance route changed")
    if not accepted.exists():
        handoff = apply_installed_handoff(installed_bytes=inputs["installedRouteBytes"].encode(), route_sha256=inputs["installedRouteSha256"],
            incumbent_alias=old_alias, successor_alias=successor_alias, watched_dir=watched, state_dir=state,
            web=web, storage=storage, host=HOST, storage_host=S3, revision=inputs["baselineRevision"], version=inputs["version"],
            edge_runtime_id=edge["id"], realtime_upstream=upstream, observe_hops=hops, observe_protected=backend,
            expected_protected=expected_backend, retained_relay_healthy=lambda: direct_relay_probe(old_relay, False),
            successor_verified=lambda: direct_relay_probe(successor["runtime"], True))
        require(handoff["state"] == "accepted", "The installed ingress did not accept the successor relay")
    verify_handoff()
    before_app = docker.inspect(incumbent["app"]["id"])
    old = _old_runtime(before_app, inputs, incumbent["app"], expected_backend["schemaSha256"])
    plan = operation_plan(inputs, evidence, old, staged, expected_backend)
    admin = _relay_admin(successor_dir, successor["runtime"])

    def inspect_candidate(row):
        return verify_candidate(row, staged["candidateConfig"], alias=inputs["candidateAlias"],
            network_ids=inputs["networkIds"], runtime_secret=inputs["runtimeSecret"])

    def observe_runtimes():
        verify_handoff()
        witness = backend()
        schema = witness["schemaSha256"]
        before = _old_runtime(docker.inspect(old["runtimeId"]), inputs, incumbent["app"], schema)
        candidate = inspect_candidate(docker.inspect(staged["slot"]["id"]))
        return {"beforeRuntime": before, "afterRuntime": {**candidate, "schemaSha256": schema},
                "backendFingerprint": witness["backendFingerprint"]}

    def candidate_failure(runtime):
        return observe_direct_failure(docker, runtime_id=runtime["runtimeId"], alias=inputs["candidateAlias"],
                                      network=network, inspect_candidate=inspect_candidate)

    def probe_health(slot, *, proxied):
        runtime = slot["runtime"]
        if proxied:
            verify_handoff()
            retained = runtime["runtimeId"] == old["runtimeId"]
            deadline = time.monotonic() + (22 if retained and action != "recover" else 0)
            while True:
                health = web("GET", "/api/health", {}, read_body=True)
                if health.status == 200:
                    value = decode(health.body)
                    require(type(value) is dict and set(value) == {"ok"} and value["ok"] is True,
                            "Public Web database health response differs")
                    probe = probe_public(web, storage, host=HOST, storage_host=S3, revision=runtime["sourceRevision"],
                        version=inputs["version"], successor_alias=successor_alias, incumbent_upstream=f"http://{old_alias}:8080",
                        successor_upstream=f"http://{successor_alias}:8080", realtime_upstream=upstream, edge_runtime_id=edge["id"],
                        read_route_hints=hops)
                    proof = probe.handoff_observation(peers_unchanged=backend() == expected_backend)
                    require(proof.peers_unchanged is True, "Protected backend changed during public Web observation")
                    if proof.at("after"):
                        require(proof.websocket_healthy is True and type(proof.public_healthy) is bool,
                                "The exact relay or retained peer health is unresolved")
                        healthy = proof.public_healthy
                        break
                elif health.status in (502, 503, 504) and not retained and candidate_failure(runtime) is True:
                    healthy = False
                    break
                elif health.status not in (502, 503, 504):
                    raise SwitchHeld("Public Web database health is unresolved")
                if time.monotonic() >= deadline:
                    raise SwitchHeld("The exact active Web relay is awaiting public readback")
                time.sleep(0.5)
                verify_handoff()
        else:
            row = docker.inspect(runtime["runtimeId"])
            alias = "app" if runtime["runtimeId"] == old["runtimeId"] else inputs["candidateAlias"]
            address = network_peer(docker, network, row, alias)
            healthy = read_direct_web(address, runtime["sourceRevision"], inputs["version"])
        return {"healthy": healthy, "runtimeId": runtime["runtimeId"], "generation": slot["route"]["generation"]}

    def make_target(selected, documents, *, generations=None):
        def runtimes():
            observed = observe_runtimes()
            if selected["before"]["runtime"] == plan["before"]["runtime"]:
                return observed
            return {**observed, "beforeRuntime": observed["afterRuntime"], "afterRuntime": observed["beforeRuntime"]}

        return InstalledWebTarget(selected, admin=admin, documents=documents, generations=generations,
            verify_release=lambda actual, initialize: actual == selected and release_observer(evidence) is True,
            observe_runtimes=runtimes, probe_health=probe_health, read_durable_config=lambda: read_autosave(successor_dir))

    current = WebGeneration(plan["before"]["route"]["generation"], "app")
    candidate = WebGeneration(plan["after"]["route"]["generation"], inputs["candidateAlias"])
    reverse, reapplied, restored = healthy_rollback(plan, staged["caddy"], current=current, candidate=candidate)
    pair = ((current, candidate), (candidate, current))
    new = staged["caddy"]["successorB"]
    if action == "recover":
        forward = make_target(plan, staged["caddy"])

        def observe_failure(slot):
            return candidate_failure(slot["runtime"])

        journal = _read(state / "web-rollouts" / f"{plan['operationId']}.json")
        if journal.get("state") in ("switch-intent", "switch-acknowledged", "rollback-intent", "rolled-back"):
            return recover_failed_installed_web_intent(plan, state_dir=state, target=forward,
                                                        observe_candidate_failure=observe_failure)
        history = state / "web-rollouts" / f"{reapplied['operationId']}.json"
        recovery_source = reapplied if history.exists() and _read(history) == {"plan": reapplied, "state": "accepted"} else plan
        return restore_failed_installed_web(plan, state_dir=state, target=forward, accepted_plan=recovery_source,
                                            observe_candidate_failure=observe_failure)
    if action == "promote":
        receipt = rollout_web(plan, state_dir=state, target=make_target(plan, staged["caddy"]), initialize=not accepted.exists())
    else:
        prerequisite, followup = {
            "rollback": (plan, reverse),
            "reapply": (reverse, reapplied),
            "rollback-reapplied": (reapplied, {**reverse, "operationId": inputs["operationId"] + "-rollback-reapplied"}),
        }[action]
        require(_read(state / "web-rollouts" / f"{prerequisite['operationId']}.json") == {"plan": prerequisite, "state": "accepted"},
                "The previous qualified installed Web operation was never accepted")
        before, after = (restored, new) if action == "reapply" else (new, restored)
        target = make_target(followup, {"successorA": before, "successorB": after},
                             generations=pair if action == "reapply" else pair[::-1])
        receipt = rollout_web(followup, state_dir=state, target=target)
    active = next(slot for slot in (plan["before"], plan["after"])
                  if slot["route"]["generation"] == receipt["acceptedGeneration"])
    require(probe_health(active, proxied=True)["healthy"] is True, "Installed terminal Web outcome is not healthy")
    return receipt


def execute(docker, *, evidence, operation, incumbent, load_receipt, expected_backend, watched,
            installation_lock, release_observer, direct_relay_probe, action="promote"):
    """Stage, hand off same-generation ingress, and promote exactly one Web image."""
    with exclusive(installation_lock):
        return _execute(docker, evidence=evidence, operation=operation, incumbent=incumbent,
                        load_receipt=load_receipt, expected_backend=expected_backend, watched=watched,
                        release_observer=release_observer, direct_relay_probe=direct_relay_probe, action=action)
