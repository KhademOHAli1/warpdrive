"""Privately seal an accepted functional Web pair. The caller holds the installation lock."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path

from caddy_web_repeat import compile_repeat_web_configs
from installed_core_lineage import verify_projected_core_predecessor
from installed_web_chain import REPOSITORY, _admit_journals, _directory, _generation as read_generation, _state
from installed_web_functional_image import verify_received_functional
from installed_web_lineage import OPERATION, _generation
from installed_web_operator import HOST, network_peer, read_direct_web
from installed_web_relay import read_autosave
from installed_web_repeat_lineage import _predecessor, _sealed_pair
from installed_web_stage import read_record
from installed_web_successor import read_admitted_web_slot
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate
from web_switch import HASH, _lock, _matches, canonical, content_hash, require


def _acceptance(state, operation, plan, chain):
    """Require the healthy promote, reverse, reapply sequence under one qualification."""
    require(plan["operationId"] == operation + "-reapply"
            and chain["acceptedOperationId"] not in {operation, operation + "-rollback", plan["operationId"]},
            "Exact final functional Web reapply required")
    common = {key: value for key, value in plan.items() if key not in {"operationId", "before", "after"}}
    expected = {
        operation: {**common, "operationId": operation, "before": chain["active"]["slot"], "after": plan["after"]},
        operation + "-rollback": {**common, "operationId": operation + "-rollback", "before": plan["after"], "after": plan["before"]},
        plan["operationId"]: plan,
    }
    operations = state / "web-rollouts"
    for identifier, value in expected.items():
        _validate(value)
        require(_state(operations / (identifier + ".json")) == {"plan": value, "state": "accepted"},
                "Exact functional Web promote, healthy rollback and reapply journals required")
    _admit_journals(operations, plan)


def _provenance(receipt, loaded, chain, after):
    retained, image = chain["active"]["provenance"], receipt["image"]
    runtime, provenance = after["runtime"], receipt["provenance"]
    expected = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
                "deploymentAuthorized": False, "sourceRevision": receipt["revision"], "origin": receipt["origin"],
                "baselineRevision": retained["revision"], "baselineManifestSha256": retained["manifestSha256"],
                **provenance, "testedConfigDigest": image["imageId"], "manifestDigest": runtime["imageId"], "imageId": runtime["imageId"]}
    require(type(loaded) is dict and all(canonical(loaded.get(key)) == canonical(value) for key, value in expected.items()),
            "Functional native Web load receipt differs from publication or accepted runtime")
    return {"repository": REPOSITORY, "revision": receipt["revision"], "manifestSha256": provenance["bundleManifestSha256"],
            "archiveSha256": provenance["archiveSha256"], "testedConfigDigest": image["imageId"]}


def seal_functional_installed_web_lineage(
    state_dir, *, output_dir, admitted_chain, expected_chain_sha256, expected_operation_id, expected_plan_sha256,
    bundle_dir, publication_bytes, expected_publication_sha256, import_record, loaded, candidate_alias, observe_installed,
    core_activation_operation_id=None, core_activation_lineage_sha256=None,
):
    """Seal the accepted Web pair after promote, healthy reverse, and reapply.

    The caller supplies independently pinned predecessor and publication evidence,
    an owned native observation callback, and the shared production lock. The
    index appears only after two exact observations. This operation makes no
    Docker load or routing call. The first rollout after Core activation seals a
    retained receipt under the new backend while preserving the original receipt
    in its historical custody. Subsequent rollouts reuse the new receipt bytes.
    """
    state, output, bundle = map(Path, (state_dir, output_dir, bundle_dir))
    for path in (state, output, bundle):
        _directory(path)
    require(all(not output.is_relative_to(path) and not path.is_relative_to(output) for path in (state, bundle)),
            "Distinct private functional lineage output required")
    selection = OPERATION.fullmatch(expected_operation_id) if isinstance(expected_operation_id, str) else None
    require(selection and expected_operation_id.endswith("-reapply") and candidate_alias == "warpdrive-web-" + selection[1]
            and _matches(HASH, expected_plan_sha256) and _matches(HASH, expected_publication_sha256)
            and callable(observe_installed), "Exact accepted functional Web reapply, artifact and observer required")
    require((core_activation_operation_id is None) == (core_activation_lineage_sha256 is None),
            "Paired Core activation lineage pins required")
    chain, imported, load = map(deepcopy, (admitted_chain, import_record, loaded))

    def verify_predecessor():
        if core_activation_operation_id is None:
            _predecessor(state, chain, expected_chain_sha256)
        else:
            require(_matches(HASH, expected_chain_sha256) and content_hash(chain) == expected_chain_sha256,
                    "Independently pinned projected Web chain required")
            verify_projected_core_predecessor(
                state, chain=chain, activation_operation_id=core_activation_operation_id,
                expected_activation_lineage_sha256=core_activation_lineage_sha256,
            )

    with _lock(state):
        verify_predecessor()
        operations = state / "web-rollouts"
        _directory(operations)
        journal_path = operations / (expected_operation_id + ".json")
        journal = _state(journal_path)
        plan = journal["plan"]
        _validate(plan)
        before, after = (plan[key] for key in ("before", "after"))
        require(journal == {"plan": plan, "state": "accepted"} and content_hash(plan) == expected_plan_sha256
                and plan["targetKey"] == chain["targetKey"] and plan["backendFingerprint"] == chain["backendFingerprint"]
                and before["runtime"] == chain["active"]["slot"]["runtime"] and after["runtime"]["name"] == candidate_alias,
                "Exact functional Web acceptance differs from the admitted predecessor")
        _acceptance(state, "web-" + selection[1], plan, chain)
        receipt = verify_received_functional(bundle, publication_bytes, expected_publication_sha256=expected_publication_sha256,
            expected_lineage_sha256=expected_chain_sha256, expected_revision=after["runtime"]["sourceRevision"],
            installed_chain=chain, import_record=imported)
        require(plan["qualificationSha256"] == content_hash({"installedChainSha256": expected_chain_sha256,
                                                             "releaseQualificationSha256": content_hash(receipt)}),
                "Functional artifact admission differs from the accepted plan qualification")
        active = _provenance(receipt, load, chain, after) | {"authoritySha256": expected_publication_sha256}
        previous = chain["active"]["provenance"]
        require(all(active[key] != chain[side]["provenance"][key] for side in ("active", "previous")
                    for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256")),
                "Exact distinct functional and retained Web artifacts required")

        aliases = {"active": candidate_alias, "previous": chain["active"]["alias"]}
        records = {name: canonical(_generation(plan, side, aliases[name], provenance)) + b"\n"
                   for name, side, provenance in (("active", "after", active), ("previous", "before", previous))}
        pins = {name: sha256(raw).hexdigest() for name, raw in records.items()}
        if core_activation_operation_id is None:
            require(pins["previous"] == chain["active"]["receiptSha256"],
                    "The retained Web generation receipt differs from its original immutable bytes")
        route = after["route"]
        expected = {"beforeRuntime": before["runtime"], "afterRuntime": after["runtime"],
                    "backendFingerprint": plan["backendFingerprint"], "route": route,
                    "aliases": {after["route"]["generation"]: aliases["active"], before["route"]["generation"]: aliases["previous"]},
                    "liveConfigSha256": route["fingerprint"], "autosaveConfigSha256": route["fingerprint"],
                    "publicSourceRevision": after["runtime"]["sourceRevision"], "publicHealthy": True, "ingressReady": True}
        pointer = state / "accepted-web-generation.json"
        accepted = _record(plan, after)

        def check():
            require(canonical(observe_installed()) == canonical(expected) and _state(journal_path) == journal
                    and _state(pointer) == accepted, "Installed functional Web acceptance, route or protected backend changed")

        require(_state(pointer) == accepted, "Accepted Web pointer differs from the functional reapply")
        check()
        admitted = {"targetKey": plan["targetKey"], "backendFingerprint": plan["backendFingerprint"],
                    "acceptedOperationId": expected_operation_id, "acceptedPlanSha256": expected_plan_sha256,
                    **{name: {"slot": slot, "alias": aliases[name], "provenance": provenance, "receiptSha256": pins[name]}
                       for name, slot, provenance in (("active", after, active), ("previous", before, previous))}}
        index = {"schemaVersion": 1, "kind": "warpdrive-functional-installed-web-lineage",
                 "targetKey": plan["targetKey"], "acceptedOperationId": expected_operation_id,
                 "acceptedPlanSha256": expected_plan_sha256, "predecessorChainSha256": expected_chain_sha256,
                 "backendFingerprint": plan["backendFingerprint"], "liveConfigSha256": route["fingerprint"],
                 "activeSha256": pins["active"], "previousSha256": pins["previous"], "chainSha256": content_hash(admitted)}
        records.update({"chain": canonical(admitted), "accepted-plan": canonical(plan)})

        def finish():
            for name, side in (("active", "after"), ("previous", "before")):
                require(read_generation(output / (name + ".json"), pins[name], plan, side) == admitted[name],
                        "Sealed functional generation readback differs")
            _acceptance(state, "web-" + selection[1], plan, chain)
            check()
            if core_activation_operation_id is not None:
                verify_predecessor()

        _sealed_pair(output, index, records, finish)
        return index


def functional_installed_observer(install, *, plan, loaded, release, candidate_alias):
    """Return a read-only observer for the two currently routed native Web slots."""
    _validate(plan)
    chain = install.chain
    before, after = (plan[key] for key in ("before", "after"))
    old, new = (slot["runtime"] for slot in (before, after))
    new_generation = WebGeneration(after["route"]["generation"], candidate_alias)
    relay = install.relay_alias
    inputs = install.inputs
    current, previous = (install.generations[name] for name in ("active", "previous"))
    expected = compile_repeat_web_configs(install.preimage, expected_sha256=sha256(install.preimage).hexdigest(),
        host=HOST, traefik_ip=inputs["edgeIP"], relay_alias=relay, current=current, previous=previous,
        candidate=new_generation, core_alias=install.core_alias)["after"]
    stage = read_record(install.operation / "candidate/stage-ready.json")
    require(old == chain["active"]["slot"]["runtime"] and new["name"] == candidate_alias
            and release["revision"] == new["sourceRevision"]
            and loaded["daemon"] == install.binding["daemon"] and loaded["imageId"] == new["imageId"]
            and stage["id"] == new["runtimeId"] and stage["alias"] == candidate_alias
            and {**stage["runtime"], "schemaSha256": new["schemaSha256"]} == new
            and stage["qualificationSha256"] == content_hash(release)
            and content_hash(expected) == after["route"]["fingerprint"],
            "Exact staged and accepted native functional Web route required")

    def process(row):
        return row["Id"], row["State"]["Pid"], row["State"]["StartedAt"], row["RestartCount"]

    def sample():
        backend = install.backend()
        install._verify_ingress()
        live, etag = install.admin.config()
        durable = read_autosave(install.relay_dir)
        require(live == durable == expected, "Live and durable functional Web route differs")
        witnesses = []
        for generation, slot in ((current, before), (new_generation, after)):
            runtime = slot["runtime"]
            row = install.docker.inspect(runtime["runtimeId"])
            read_admitted_web_slot(row, item={"slot": slot, "alias": generation.target}, network_ids=inputs["networkIds"],
                                   runtime_secret=inputs["runtimeSecret"], schema_sha256=backend["schemaSha256"])
            address = network_peer(install.docker, install.network, row, generation.target)
            require(read_direct_web(address, runtime["sourceRevision"], inputs["version"]),
                    "An admitted functional Web slot is unhealthy")
            witness = process(row)
            require(type(witness[1]) is int and witness[1] > 0, "Admitted Web native process is unavailable")
            witnesses.append((generation, slot, witness))
        require(install._public_health(new, backend, failure=lambda: False) is True,
                "Public functional Web generation is unhealthy")
        for generation, slot, witness in witnesses:
            row = install.docker.inspect(witness[0])
            read_admitted_web_slot(row, item={"slot": slot, "alias": generation.target}, network_ids=inputs["networkIds"],
                                   runtime_secret=inputs["runtimeSecret"], schema_sha256=backend["schemaSha256"])
            require(process(row) == witness, "Admitted Web native process changed during observation")
        install._verify_ingress()
        require(install.admin.config() == (live, etag) and read_autosave(install.relay_dir) == live
                and install.backend() == backend, "Functional route or protected backend changed during observation")
        return {"beforeRuntime": old, "afterRuntime": new, "backendFingerprint": backend["backendFingerprint"],
                "route": after["route"], "aliases": {current.deployment_id: current.target, new_generation.deployment_id: new_generation.target},
                "liveConfigSha256": content_hash(live), "autosaveConfigSha256": content_hash(durable),
                "publicSourceRevision": new["sourceRevision"], "publicHealthy": True, "ingressReady": True}

    return sample
