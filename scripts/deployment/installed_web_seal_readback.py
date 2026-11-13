"""Read back a completed functional Web seal with independently admitted authority."""

from hashlib import sha256
from pathlib import Path

from component_inputs import decode
from installed_web_chain import REPOSITORY, _admit_journals, _directory, _generation, _private_bytes, _state
from installed_web_operator import network_peer, read_direct_web
from installed_web_relay import read_autosave
from installed_web_successor import read_admitted_web_slot
from web_rollout import _record, _validate
from web_switch import HASH, canonical, content_hash, require


SEALED_NAMES = ("accepted-plan", "active", "chain", "lineage", "previous")


def _records(output):
    _directory(output)
    require({path.name for path in output.iterdir()} == {name + ".json" for name in SEALED_NAMES},
            "Exact completed functional Web seal inventory required")
    return {name: _private_bytes(output / (name + ".json"), modes=(0o400,)) for name in SEALED_NAMES}


def read_seal_acknowledgement(install, *, controller, expected_plan_sha256, loaded, release,
                              publication_sha256, observe_installed):
    """Return the native sealed response without creating or altering native state.

    The caller owns the existing native locks and authenticates the predecessor,
    installed import, exact release and loaded image. The observer must inspect
    the installed relay, runtimes and protected backend without making changes.
    """
    output = Path(install.operation) / "lineage"
    state = Path(install.state)
    for pin in (expected_plan_sha256, publication_sha256, install.chain_sha256):
        require(isinstance(pin, str) and HASH.fullmatch(pin), "Exact independently admitted functional seal pins required")
    predecessor = install.chain
    require(content_hash(predecessor) == install.chain_sha256, "Admitted functional predecessor differs")
    plan = controller.plan("reapply")
    _validate(plan)
    require(plan["operationId"].endswith("-reapply") and content_hash(plan) == expected_plan_sha256
            and plan["before"]["runtime"] == predecessor["active"]["slot"]["runtime"]
            and plan["backendFingerprint"] == predecessor["backendFingerprint"]
            and plan["qualificationSha256"] == content_hash({
                "installedChainSha256": install.chain_sha256, "releaseQualificationSha256": content_hash(release),
            }), "Exact functional reapply plan and qualified release required")
    raw = _records(output)
    index, sealed, sealed_plan = (decode(raw[name]) for name in ("lineage", "chain", "accepted-plan"))
    before, after = plan["before"], plan["after"]
    runtime = after["runtime"]
    provenance = release["provenance"]
    require(sealed_plan == plan and raw["accepted-plan"] == canonical(plan)
            and runtime["sourceRevision"] == release["revision"] == loaded["sourceRevision"]
            and runtime["imageId"] == loaded["imageId"]
            and release["image"]["imageId"] == loaded["testedConfigDigest"]
            and loaded["bundleManifestSha256"] == provenance["bundleManifestSha256"]
            and loaded["archiveSha256"] == provenance["archiveSha256"],
            "Functional seal differs from the exact selected Web artifact")
    pins = {name: sha256(raw[name]).hexdigest() for name in ("active", "previous")}
    if getattr(install, "core_activation_operation_id", None) is None:
        require(pins["previous"] == predecessor["active"]["receiptSha256"], "Retained Web generation receipt differs")
    accepted = {side: _generation(output / (side + ".json"), pins[side], plan, position)
                for side, position in (("active", "after"), ("previous", "before"))}
    require(accepted["previous"]["provenance"] == predecessor["active"]["provenance"]
            and accepted["previous"]["alias"] == predecessor["active"]["alias"]
            and accepted["active"]["alias"] == runtime["name"]
            and accepted["active"]["provenance"] == {
                "repository": REPOSITORY, "revision": release["revision"],
                "manifestSha256": provenance["bundleManifestSha256"], "archiveSha256": provenance["archiveSha256"],
                "testedConfigDigest": release["image"]["imageId"], "authoritySha256": publication_sha256,
            }, "Sealed Web generations differ from the selected release and retained predecessor")
    expected_chain = {"targetKey": plan["targetKey"], "backendFingerprint": plan["backendFingerprint"],
                      "acceptedOperationId": plan["operationId"], "acceptedPlanSha256": expected_plan_sha256, **accepted}
    expected_index = {"schemaVersion": 1, "kind": "warpdrive-functional-installed-web-lineage",
                      "targetKey": plan["targetKey"], "acceptedOperationId": plan["operationId"],
                      "acceptedPlanSha256": expected_plan_sha256, "predecessorChainSha256": install.chain_sha256,
                      "backendFingerprint": plan["backendFingerprint"], "liveConfigSha256": after["route"]["fingerprint"],
                      "activeSha256": pins["active"], "previousSha256": pins["previous"], "chainSha256": content_hash(expected_chain)}
    require(sealed == expected_chain and raw["chain"] == canonical(expected_chain)
            and index == expected_index and raw["lineage"] == canonical(expected_index) + b"\n",
            "Completed functional Web seal differs from the exact accepted pair")
    _verify_accepted_rollout(state, controller, plan)
    observed = {"beforeRuntime": before["runtime"], "afterRuntime": runtime, "backendFingerprint": plan["backendFingerprint"],
                "route": after["route"], "aliases": {after["route"]["generation"]: accepted["active"]["alias"],
                                                    before["route"]["generation"]: accepted["previous"]["alias"]},
                "liveConfigSha256": after["route"]["fingerprint"], "autosaveConfigSha256": after["route"]["fingerprint"],
                "publicSourceRevision": runtime["sourceRevision"], "publicHealthy": True, "ingressReady": True}
    require(canonical(observe_installed()) == canonical(observed), "Native functional seal observation differs")
    _verify_accepted_rollout(state, controller, plan)
    require(_records(output) == raw, "Completed functional Web seal changed during observation")
    return {"state": "sealed", "sourceRevision": runtime["sourceRevision"], "lineage": index}


def _verify_accepted_rollout(state, controller, final):
    operations = state / "web-rollouts"
    _directory(operations)
    _admit_journals(operations, final)
    selections = [controller.plan(phase) for phase in ("promote", "rollback", "reapply")]
    require(selections[-1] == final, "Functional reapply plan changed during seal readback")
    for plan in selections:
        _validate(plan)
        require(_state(operations / (plan["operationId"] + ".json")) == {"plan": plan, "state": "accepted"},
                "Exact accepted functional Web phase journal required")
    require(controller.verify_predecessor()
            and _state(state / "accepted-web-generation.json") == _record(final, final["after"]),
            "Native accepted Web lineage changed during seal readback")


def observe_functional_seal(install, plan):
    """Read the two exact native slots and live route with GET-only health probes."""
    from installed_web_rollout_readback import read_public_web_health

    before, after = plan["before"], plan["after"]
    aliases = {before["route"]["generation"]: install.chain["active"]["alias"],
               after["route"]["generation"]: after["runtime"]["name"]}
    backend, _ = install._retained()
    live, etag = install.admin.config()
    persisted = read_autosave(install.relay_dir)
    route = after["route"]
    require(live == persisted and content_hash(live) == route["fingerprint"],
            "Live and durable functional Web seal route differs")
    witnesses = {}
    for slot in (before, after):
        runtime = slot["runtime"]
        alias = aliases[slot["route"]["generation"]]
        row = install.docker.inspect(runtime["runtimeId"])
        read_admitted_web_slot(row, item={"slot": slot, "alias": alias}, network_ids=install.inputs["networkIds"],
                               runtime_secret=install.inputs["runtimeSecret"], schema_sha256=backend["schemaSha256"])
        address = network_peer(install.docker, install.network, row, alias)
        require(read_direct_web(address, runtime["sourceRevision"], install.inputs["version"]) is True,
                "Native admitted Web slot is unhealthy")
        witnesses[runtime["runtimeId"]] = _process_witness(row)
    selected = after["runtime"]["sourceRevision"]
    require(read_public_web_health(install, selected) is True, "Public functional Web seal generation is unhealthy")
    require(all(_process_witness(install.docker.inspect(identifier)) == witness for identifier, witness in witnesses.items())
            and install.admin.config() == (live, etag) and read_autosave(install.relay_dir) == persisted
            and install._retained()[0] == backend, "Native Web seal changed during observation")
    return {"beforeRuntime": before["runtime"], "afterRuntime": after["runtime"], "backendFingerprint": backend["backendFingerprint"],
            "route": route, "aliases": aliases, "liveConfigSha256": content_hash(live), "autosaveConfigSha256": content_hash(persisted),
            "publicSourceRevision": selected, "publicHealthy": True, "ingressReady": True}


def _process_witness(row):
    state = row["State"]
    require(state["Running"] is True and type(state["Pid"]) is int and state["Pid"] > 0
            and state.get("Health", {}).get("Status") == "healthy", "Exact native healthy Web process required")
    return row["Id"], row["Image"], state["Pid"], state["StartedAt"], row["RestartCount"]
