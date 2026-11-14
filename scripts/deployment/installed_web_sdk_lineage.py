"""Seal/read an admitted full-SDK Web pair without changing legacy lineage.

The composition root authenticates the original publication, byte custody,
backend/Engine reuse and native daemon before supplying these pinned records.
Hashes here bind evidence; they are not publication authentication. The caller
owns the installation mutation lock. This module uses the existing target lock,
generation schema, terminal journals and immutable index-last publication.
New SDK input/evidence records use component_inputs canonical UTF-8 JSON.
Existing Web rollout, chain, generation and index canonicalization stays local
to its unchanged web_switch protocol; original publication authority is raw.
"""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path

from caddy_web_repeat import compile_repeat_web_configs
from component_inputs import canonical as sdk_canonical, content_hash as sdk_content_hash, decode
from installed_core_lineage import verify_projected_core_predecessor
from installed_web_chain import REPOSITORY, _directory, _generation as read_generation, _private_bytes, _state
from installed_web_functional_image import _installed
from installed_web_functional_lineage import _acceptance
from installed_web_lineage import OPERATION, _generation
from installed_web_operator import HOST, network_peer, read_direct_web
from installed_web_relay import read_autosave
from installed_web_repeat_lineage import _predecessor, _sealed_pair
from installed_web_seal_readback import _process_witness, _verify_accepted_rollout
from installed_web_stage import read_record
import installed_web_sdk_runtime as sdk
from web_candidate import MAX_ARCHIVE_BYTES
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate
from web_switch import HASH, IMAGE, MAX_BYTES, NAME, REVISION, _lock, _matches, canonical, content_hash, require


KIND = "warpdrive-sdk-installed-web-lineage"
RELEASE_KIND = "warpdrive-installed-sdk-web-release"
REGISTRY_KIND = "warpdrive-sdk-web-runtime-binding-registry"
RELEASE_KEYS = {"schemaVersion", "kind", "sourceRevision", "publicationReceiptSha256", "image", "provenance",
                "projectionReceiptSha256", "runtimeBindingSha256", "backendReuseQualificationSha256"}
SEALED_NAMES = ("accepted-plan", "active", "previous", "chain", "lineage", "predecessor-chain",
                "source-publication", "projection-receipt", "runtime-bindings", "release", "loaded-image",
                "backend-reuse-qualification", "acceptance")
INDEX_KEYS = {"schemaVersion", "kind", "targetKey", "acceptedOperationId", "acceptedPlanSha256",
              "predecessorChainSha256", "backendFingerprint", "liveConfigSha256", "activeSha256", "previousSha256",
              "chainSha256", "sourcePublicationSha256", "projectionReceiptSha256", "runtimeBindingsSha256",
              "releaseSha256", "loadedImageSha256", "runtimeBindingSha256", "backendReuseQualificationSha256",
              "acceptanceSha256", "coreActivation"}


def _authority(callback):
    require(callable(callback) and callback() is True,
            "Independent SDK publication, backend/Engine and native authority required")


def _core(value):
    require(value is None or (type(value) is dict and set(value) == {"operationId", "lineageSha256"}
            and _matches(NAME, value["operationId"]) and _matches(HASH, value["lineageSha256"])),
            "Exact completed Core activation pins required")
    return deepcopy(value)


def _predecessor_authority(state, chain, pin, core):
    if core is None:
        _predecessor(state, chain, pin)
    else:
        require(_matches(HASH, pin) and content_hash(chain) == pin, "Exact projected SDK predecessor chain required")
        verify_projected_core_predecessor(state, chain=chain, activation_operation_id=core["operationId"],
            expected_activation_lineage_sha256=core["lineageSha256"])


def _release(release):
    require(type(release) is dict and set(release) == RELEASE_KEYS
            and type(release["schemaVersion"]) is int and release["schemaVersion"] == 1
            and release["kind"] == RELEASE_KIND and _matches(REVISION, release["sourceRevision"])
            and all(_matches(HASH, release[key]) for key in ("publicationReceiptSha256", "projectionReceiptSha256",
                    "runtimeBindingSha256", "backendReuseQualificationSha256")), "Exact admitted SDK release required")
    image, provenance = release["image"], release["provenance"]
    require(type(image) is dict and set(image) == {"imageId", "sourceRevision", "runtimeUser", "generation"}
            and _matches(IMAGE, image["imageId"]) and image["sourceRevision"] == release["sourceRevision"]
            and image["generation"] == "wd-" + release["sourceRevision"]
            and type(image["runtimeUser"]) is str and 0 < len(image["runtimeUser"]) <= 260
            and type(provenance) is dict and set(provenance) == {"bundleManifestSha256", "archiveSha256", "archiveSizeBytes"}
            and all(_matches(HASH, provenance[key]) for key in ("bundleManifestSha256", "archiveSha256"))
            and type(provenance["archiveSizeBytes"]) is int and 0 < provenance["archiveSizeBytes"] <= MAX_ARCHIVE_BYTES,
            "Exact SDK generic-loader image and derived archive provenance required")
    return deepcopy(release)


def _provenance(release):
    release = _release(release)
    return {"repository": REPOSITORY, "revision": release["sourceRevision"],
            "manifestSha256": release["provenance"]["bundleManifestSha256"],
            "archiveSha256": release["provenance"]["archiveSha256"],
            "testedConfigDigest": release["image"]["imageId"],
            "authoritySha256": release["publicationReceiptSha256"]}


def _load(loaded, release, chain, runtime, *, origin=None, daemon=None):
    retained, provenance = chain["active"]["provenance"], release["provenance"]
    expected = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
                "deploymentAuthorized": False, "sourceRevision": release["sourceRevision"],
                "baselineRevision": retained["revision"], "baselineManifestSha256": retained["manifestSha256"],
                **provenance, "testedConfigDigest": release["image"]["imageId"],
                "manifestDigest": runtime["imageId"], "imageId": runtime["imageId"]}
    require(type(loaded) is dict and set(loaded) == set(expected) | {
                "origin", "daemon", "beforeInventorySha256", "afterInventorySha256"}
            and all(sdk_canonical(loaded.get(key)) == sdk_canonical(value) for key, value in expected.items())
            and type(loaded["origin"]) is dict and type(loaded["daemon"]) is dict and bool(loaded["daemon"])
            and all(_matches(HASH, loaded[key]) for key in ("beforeInventorySha256", "afterInventorySha256"))
            and (origin is None or loaded["origin"] == origin) and (daemon is None or loaded["daemon"] == daemon),
            "Native SDK load differs from exact config, platform manifest, archive or daemon")


def _binding(record, pin, release, runtime):
    require(pin == release["runtimeBindingSha256"] and sdk_content_hash(record) == pin
            and runtime["sourceRevision"] == release["sourceRevision"],
            "SDK release runtime-binding pin or source differs")
    return sdk.validate_runtime_binding(record, expected_sha256=pin,
        authority_sha256=release["publicationReceiptSha256"], source_revision=release["sourceRevision"],
        image_id=runtime["imageId"], tested_config_digest=release["image"]["imageId"])


def _registry(chain, release, runtime, binding, pin, retained):
    bindings = sdk.validate_retained_bindings(retained)
    authority = release["publicationReceiptSha256"]
    require(authority not in bindings, "New SDK publication authority already belongs to a retained generation")
    bindings[authority] = (_binding(binding, pin, release, runtime), pin)
    candidates = [chain[name] for name in ("active", "previous")] + [
        {"slot": {"runtime": runtime}, "provenance": _provenance(release)}]
    for key, (record, digest) in bindings.items():
        selected = [item for item in candidates if item["provenance"]["authoritySha256"] == key]
        require(len(selected) == 1, "SDK registry includes authority outside the exact three admitted generations")
        item = selected[0]
        sdk.validate_runtime_binding(record, expected_sha256=digest, authority_sha256=key,
            source_revision=item["provenance"]["revision"], image_id=item["slot"]["runtime"]["imageId"],
            tested_config_digest=item["provenance"]["testedConfigDigest"])
    return {"schemaVersion": 1, "kind": REGISTRY_KIND,
            "bindings": {key: {"binding": record, "bindingSha256": digest}
                         for key, (record, digest) in sorted(bindings.items())}}


def _read_registry(document):
    require(type(document) is dict and set(document) == {"schemaVersion", "kind", "bindings"}
            and type(document["schemaVersion"]) is int and document["schemaVersion"] == 1
            and document["kind"] == REGISTRY_KIND and type(document["bindings"]) is dict,
            "Exact sealed SDK runtime-binding registry required")
    pairs = {}
    for authority, item in document["bindings"].items():
        require(type(item) is dict and set(item) == {"binding", "bindingSha256"}, "Exact SDK registry entry required")
        pairs[authority] = (item["binding"], item["bindingSha256"])
    return sdk.validate_retained_bindings(pairs)


def successor_sdk_bindings(chain, bindings):
    """Narrow admitted sealed evidence to the pair a next successor retains.

    The full immutable registry also proves predecessor.previous, which may no
    longer belong to this returned chain. Keep that evidence sealed, without
    carrying its retired binding into every later three-generation controller.
    Missing entries still mean strict legacy readback, never live-Cmd inference.
    """
    _installed(chain, content_hash(chain))
    registry = sdk.validate_retained_bindings(bindings)
    selected = {}
    for name in ("active", "previous"):
        item = chain[name]
        authority = item["provenance"]["authoritySha256"]
        if authority in registry:
            record, pin = registry[authority]
            sdk.validate_runtime_binding(record, expected_sha256=pin, authority_sha256=authority,
                source_revision=item["provenance"]["revision"], image_id=item["slot"]["runtime"]["imageId"],
                tested_config_digest=item["provenance"]["testedConfigDigest"])
            selected[authority] = (record, pin)
    return selected


def _phase_records(plan, predecessor):
    operation = plan["operationId"].removesuffix("-reapply")
    require(plan["operationId"] == operation + "-reapply"
            and predecessor["acceptedOperationId"] not in {operation, operation + "-rollback", plan["operationId"]},
            "Exact new SDK promote, rollback and reapply required")
    common = {key: value for key, value in plan.items() if key not in {"operationId", "before", "after"}}
    plans = {"promote": {**common, "operationId": operation, "before": predecessor["active"]["slot"], "after": plan["after"]},
             "rollback": {**common, "operationId": operation + "-rollback", "before": plan["after"], "after": plan["before"]},
             "reapply": plan}
    for value in plans.values():
        _validate(value)
    return {name: {"plan": value, "state": "accepted"} for name, value in plans.items()}


def _evidence(chain, plan, release, publication, publication_pin, projection, binding, binding_pin, retained, reuse, loaded):
    release = _release(release)
    runtime = plan["after"]["runtime"]
    require(type(publication) is bytes and 0 < len(publication) <= MAX_BYTES
            and _matches(HASH, publication_pin) and sha256(publication).hexdigest() == publication_pin
            and release["publicationReceiptSha256"] == publication_pin,
            "Original sealed SDK publication bytes and independent raw SHA required")
    original_publication = decode(publication)
    require(type(original_publication) is dict and type(projection) is dict
            and sdk_content_hash(projection) == release["projectionReceiptSha256"]
            and type(reuse) is dict and bool(reuse) and sdk_content_hash(reuse) == release["backendReuseQualificationSha256"],
            "Admitted SDK projection and backend/Engine reuse qualification pins differ")
    require(projection.get("kind") == "warpdrive-sdk-web-archive-projection"
            and type(projection.get("schemaVersion")) is int and projection["schemaVersion"] == 1
            and projection.get("sourceRevision") == release["sourceRevision"] and projection.get("platform") == "linux/amd64"
            and projection.get("projectionOnly") is True and projection.get("backendReuseQualified") is False
            and projection.get("installationAuthorized") is False and projection.get("deploymentAuthorized") is False
            and type(projection.get("original")) is dict and type(projection.get("selectedWeb")) is dict
            and type(projection.get("derived")) is dict
            and projection["original"].get("kind") == "warpdrive-tested-image-bundle"
            and type(projection["original"].get("schemaVersion")) is int and projection["original"]["schemaVersion"] == 3
            and projection["original"].get("publicationAdmissionSha256") == sdk_content_hash(original_publication)
            and type(projection["original"].get("origin")) is dict
            and projection["original"].get("bundleManifestSha256") == release["provenance"]["bundleManifestSha256"]
            and _matches(IMAGE, projection["original"].get("testedNativeImageId"))
            and projection["selectedWeb"].get("configDigest") == release["image"]["imageId"]
            and projection["selectedWeb"].get("manifestDigest") == runtime["imageId"]
            and projection["derived"].get("archiveSha256") == release["provenance"]["archiveSha256"]
            and projection["derived"].get("archiveSizeBytes") == release["provenance"]["archiveSizeBytes"]
            and projection.get("image") == release["image"] and projection.get("provenance") == release["provenance"],
            "SDK projection changed original custody, config/platform identities or its non-admission scope")
    _load(loaded, release, chain, runtime, origin=projection["original"].get("origin"))
    _binding(binding, binding_pin, release, runtime)
    provenance = _provenance(release)
    require(runtime["sourceRevision"] == release["sourceRevision"]
            and all(provenance[key] != chain[side]["provenance"][key] for side in ("active", "previous")
                    for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256"))
            and plan["qualificationSha256"] == content_hash({"installedChainSha256": content_hash(chain),
                                                            "releaseQualificationSha256": content_hash(release)}),
            "SDK release differs from exact accepted qualification or retained artifacts")
    registry = _registry(chain, release, runtime, binding, binding_pin, retained)
    records = {"source-publication": publication, "projection-receipt": sdk_canonical(projection),
               "runtime-bindings": sdk_canonical(registry), "release": sdk_canonical(release),
               "loaded-image": sdk_canonical(loaded), "backend-reuse-qualification": sdk_canonical(reuse),
               "predecessor-chain": canonical(chain), "acceptance": canonical(_phase_records(plan, chain))}
    require(all(0 < len(raw) <= MAX_BYTES for raw in records.values()), "Bounded SDK lineage authority records required")
    return provenance, records, registry


def _expected_observation(plan, predecessor, candidate_alias):
    before, after = plan["before"], plan["after"]
    return {"beforeRuntime": before["runtime"], "afterRuntime": after["runtime"],
            "backendFingerprint": plan["backendFingerprint"], "route": after["route"],
            "aliases": {before["route"]["generation"]: predecessor["active"]["alias"], after["route"]["generation"]: candidate_alias},
            "liveConfigSha256": after["route"]["fingerprint"], "autosaveConfigSha256": after["route"]["fingerprint"],
            "publicSourceRevision": after["runtime"]["sourceRevision"], "publicHealthy": True, "ingressReady": True}


def _index(plan, chain, admitted, records, core):
    return {"schemaVersion": 1, "kind": KIND, "targetKey": plan["targetKey"],
            "acceptedOperationId": plan["operationId"], "acceptedPlanSha256": content_hash(plan),
            "predecessorChainSha256": content_hash(chain), "backendFingerprint": plan["backendFingerprint"],
            "liveConfigSha256": plan["after"]["route"]["fingerprint"], "chainSha256": content_hash(admitted),
            "activeSha256": sha256(records["active"]).hexdigest(), "previousSha256": sha256(records["previous"]).hexdigest(),
            "sourcePublicationSha256": sha256(records["source-publication"]).hexdigest(),
            "projectionReceiptSha256": sha256(records["projection-receipt"]).hexdigest(),
            "runtimeBindingsSha256": sha256(records["runtime-bindings"]).hexdigest(),
            "releaseSha256": sha256(records["release"]).hexdigest(), "loadedImageSha256": sha256(records["loaded-image"]).hexdigest(),
            "runtimeBindingSha256": decode(records["release"])["runtimeBindingSha256"],
            "backendReuseQualificationSha256": sha256(records["backend-reuse-qualification"]).hexdigest(),
            "acceptanceSha256": sha256(records["acceptance"]).hexdigest(), "coreActivation": _core(core)}


def sdk_installed_observer(install, *, plan, loaded, release, candidate_alias, verify_authority):
    """Observe both real slots twice through the admitted SDK/legacy dispatcher."""
    _validate(plan)
    release = _release(release)
    _installed(install.chain, install.chain_sha256)
    _authority(verify_authority)
    chain, inputs = install.chain, install.inputs
    before, after = plan["before"], plan["after"]
    require(plan["targetKey"] == chain["targetKey"] and plan["backendFingerprint"] == chain["backendFingerprint"]
            and plan["qualificationSha256"] == content_hash({"installedChainSha256": install.chain_sha256,
                                                            "releaseQualificationSha256": content_hash(release)}),
            "SDK observer plan differs from admitted chain and release")
    _load(loaded, release, chain, after["runtime"], daemon=install.binding["daemon"])
    _binding(install.candidate_binding, install.candidate_binding_sha256, release, after["runtime"])
    require(release["publicationReceiptSha256"] == install.candidate_publication_sha256,
            "SDK observer publication differs from independently admitted runtime")
    current, previous = (install.generations[name] for name in ("active", "previous"))
    candidate = WebGeneration(after["route"]["generation"], candidate_alias)
    expected = compile_repeat_web_configs(install.preimage, expected_sha256=sha256(install.preimage).hexdigest(),
        host=HOST, traefik_ip=inputs["edgeIP"], relay_alias=install.relay_alias, current=current, previous=previous,
        candidate=candidate, core_alias=install.core_alias)["after"]
    stage = read_record(install.operation / "candidate/stage-ready.json")
    require(before["runtime"] == chain["active"]["slot"]["runtime"] and after["runtime"]["name"] == candidate_alias
            and stage["id"] == after["runtime"]["runtimeId"] and stage["alias"] == candidate_alias
            and {**stage["runtime"], "schemaSha256": after["runtime"]["schemaSha256"]} == after["runtime"]
            and stage["qualificationSha256"] == content_hash(release)
            and content_hash(expected) == after["route"]["fingerprint"], "Exact staged SDK Web and route required")
    old_item = {**deepcopy(chain["active"]), "slot": deepcopy(before)}
    new_item = {"slot": deepcopy(after), "alias": candidate_alias, "provenance": _provenance(release)}

    def sample():
        _authority(verify_authority)
        backend, _ = install._retained()
        live, etag = install.admin.config()
        durable = read_autosave(install.relay_dir)
        require(live == durable == expected, "Live and durable SDK Web route differs")
        witnesses = []
        for item in (old_item, new_item):
            runtime = item["slot"]["runtime"]
            row = install.docker.inspect(runtime["runtimeId"])
            install.read_admitted_slot(row, item=item, schema_sha256=backend["schemaSha256"])
            address = network_peer(install.docker, install.network, row, item["alias"])
            require(read_direct_web(address, runtime["sourceRevision"], inputs["version"]) is True,
                    "An admitted SDK/legacy Web slot is unhealthy")
            witnesses.append((item, _process_witness(row)))
        require(install._public_health(after["runtime"], backend, failure=lambda: False) is True,
                "Public SDK Web generation is unhealthy")
        for item, witness in witnesses:
            row = install.docker.inspect(item["slot"]["runtime"]["runtimeId"])
            install.read_admitted_slot(row, item=item, schema_sha256=backend["schemaSha256"])
            require(_process_witness(row) == witness, "Admitted SDK Web process changed during observation")
        require(install.admin.config() == (live, etag) and read_autosave(install.relay_dir) == live
                and install._retained()[0] == backend, "SDK Web route or protected backend changed during observation")
        _authority(verify_authority)
        return _expected_observation(plan, chain, candidate_alias)

    _authority(verify_authority)
    return sample


def seal_sdk_installed_web_lineage(state_dir, *, output_dir, admitted_chain, expected_chain_sha256,
        expected_operation_id, expected_plan_sha256, release, source_publication_bytes, expected_publication_sha256,
        projection_receipt, runtime_binding, expected_runtime_binding_sha256, retained_sdk_bindings,
        backend_reuse_qualification, loaded, candidate_alias, observe_installed, verify_authority,
        core_activation_operation_id=None, core_activation_lineage_sha256=None):
    """Seal only after accepted promote/rollback/reapply and exact live readbacks.

    Optional Core pins verify an already completed activation with the existing
    projector. This does not implement or qualify a future Core-upgrade driver.
    No historical receipt is overwritten. A projected retained receipt may be
    sealed under the new backend in this new output, as in the existing sealer.
    """
    state, output = map(Path, (state_dir, output_dir))
    for path in (state, output):
        _directory(path)
    require(not output.is_relative_to(state) and not state.is_relative_to(output)
            and callable(observe_installed), "Distinct private SDK lineage output and observer required")
    require((core_activation_operation_id is None) == (core_activation_lineage_sha256 is None),
            "Paired completed Core activation pins required")
    core = _core(None if core_activation_operation_id is None else {
        "operationId": core_activation_operation_id, "lineageSha256": core_activation_lineage_sha256})
    selection = OPERATION.fullmatch(expected_operation_id) if isinstance(expected_operation_id, str) else None
    require(selection and expected_operation_id.endswith("-reapply") and candidate_alias == "warpdrive-web-" + selection[1]
            and _matches(HASH, expected_plan_sha256), "Exact SDK final reapply and candidate alias required")
    chain = deepcopy(admitted_chain)
    _installed(chain, expected_chain_sha256)
    with _lock(state):
        _authority(verify_authority)
        _predecessor_authority(state, chain, expected_chain_sha256, core)
        operations = state / "web-rollouts"
        _directory(operations)
        path = operations / (expected_operation_id + ".json")
        journal = _state(path)
        plan = journal["plan"]
        _validate(plan)
        require(journal == {"plan": plan, "state": "accepted"} and content_hash(plan) == expected_plan_sha256
                and plan["targetKey"] == chain["targetKey"] and plan["backendFingerprint"] == chain["backendFingerprint"]
                and plan["before"]["runtime"] == chain["active"]["slot"]["runtime"]
                and plan["after"]["runtime"]["name"] == candidate_alias, "SDK reapply differs from admitted predecessor")
        _acceptance(state, "web-" + selection[1], plan, chain)
        provenance, records, _ = _evidence(chain, plan, release, source_publication_bytes,
            expected_publication_sha256, projection_receipt, runtime_binding, expected_runtime_binding_sha256,
            retained_sdk_bindings, backend_reuse_qualification, loaded)
        entries = (("active", "after", candidate_alias, provenance),
                   ("previous", "before", chain["active"]["alias"], chain["active"]["provenance"]))
        records.update({name: canonical(_generation(plan, side, alias, source)) + b"\n"
                        for name, side, alias, source in entries})
        if core is None:
            require(sha256(records["previous"]).hexdigest() == chain["active"]["receiptSha256"],
                    "Retained Web receipt differs from its original immutable bytes")
        admitted = {"targetKey": plan["targetKey"], "backendFingerprint": plan["backendFingerprint"],
                    "acceptedOperationId": expected_operation_id, "acceptedPlanSha256": expected_plan_sha256,
                    **{name: {"slot": deepcopy(plan[side]), "alias": alias, "provenance": deepcopy(source),
                              "receiptSha256": sha256(records[name]).hexdigest()}
                       for name, side, alias, source in entries}}
        records.update({"chain": canonical(admitted), "accepted-plan": canonical(plan)})
        index = _index(plan, chain, admitted, records, core)
        require({path.name for path in output.iterdir()} <= {name + ".json" for name in SEALED_NAMES},
                "Unexpected SDK lineage output inventory")
        expected = _expected_observation(plan, chain, candidate_alias)

        def check():
            _authority(verify_authority)
            _predecessor_authority(state, chain, expected_chain_sha256, core)
            _acceptance(state, "web-" + selection[1], plan, chain)
            require(canonical(observe_installed()) == canonical(expected) and _state(path) == journal
                    and _state(state / "accepted-web-generation.json") == _record(plan, plan["after"]),
                    "SDK acceptance, route or protected backend changed during sealing")
            _authority(verify_authority)

        check()

        def finish():
            for name, side in (("active", "after"), ("previous", "before")):
                require(read_generation(output / (name + ".json"), index[name + "Sha256"], plan, side) == admitted[name],
                        "Sealed SDK generation readback differs")
            check()

        _sealed_pair(output, index, records, finish)
        return index


def _records(output):
    _directory(output)
    require({path.name for path in output.iterdir()} == {name + ".json" for name in SEALED_NAMES},
            "Exact completed SDK lineage inventory required")
    return {name: _private_bytes(output / (name + ".json"), modes=(0o400,)) for name in SEALED_NAMES}


def _history(output, chain_pin, index_pin):
    require(_matches(HASH, chain_pin) and _matches(HASH, index_pin), "Independent SDK chain and index pins required")
    raw = _records(output)
    require(sha256(raw["chain"]).hexdigest() == chain_pin and sha256(raw["lineage"]).hexdigest() == index_pin,
            "Sealed SDK chain or index SHA differs")
    values = {name: decode(value) for name, value in raw.items()}
    chain, plan, index, predecessor = (values[name] for name in ("chain", "accepted-plan", "lineage", "predecessor-chain"))
    _installed(chain, chain_pin)
    _validate(plan)
    require(type(index) is dict and set(index) == INDEX_KEYS and index.get("kind") == KIND
            and type(index.get("schemaVersion")) is int and index["schemaVersion"] == 1,
            "Exact SDK lineage index kind and schema required")
    _installed(predecessor, index["predecessorChainSha256"])
    registry = _read_registry(values["runtime-bindings"])
    release = _release(values["release"])
    authority = release["publicationReceiptSha256"]
    require(authority in registry, "SDK active generation runtime binding is missing")
    binding, pin = registry[authority]
    retained = {key: pair for key, pair in registry.items() if key != authority}
    source, evidence, normalized_registry = _evidence(predecessor, plan, release, raw["source-publication"],
        index["sourcePublicationSha256"], values["projection-receipt"], binding, pin, retained,
        values["backend-reuse-qualification"], values["loaded-image"])
    expected_entries = (("active", "after", plan["after"]["runtime"]["name"], source),
                        ("previous", "before", predecessor["active"]["alias"], predecessor["active"]["provenance"]))
    for name, side, alias, provenance in expected_entries:
        evidence[name] = canonical(_generation(plan, side, alias, provenance)) + b"\n"
        require(raw[name] == evidence[name]
                and read_generation(output / (name + ".json"), sha256(raw[name]).hexdigest(), plan, side) == chain[name],
                "SDK sealed generation differs from exact source and retained provenance")
    require(plan["before"]["runtime"] == predecessor["active"]["slot"]["runtime"]
            and chain["acceptedOperationId"] == plan["operationId"] and chain["acceptedPlanSha256"] == content_hash(plan)
            and chain["targetKey"] == plan["targetKey"] == predecessor["targetKey"]
            and chain["backendFingerprint"] == plan["backendFingerprint"] == predecessor["backendFingerprint"],
            "SDK accepted chain differs from final plan or predecessor")
    core = _core(index["coreActivation"])
    if core is None:
        require(sha256(raw["previous"]).hexdigest() == predecessor["active"]["receiptSha256"],
                "SDK historical retained receipt differs from immutable predecessor")
    evidence.update({"chain": canonical(chain), "accepted-plan": canonical(plan)})
    require(normalized_registry == values["runtime-bindings"] and all(raw[name] == value for name, value in evidence.items())
            and index == _index(plan, predecessor, chain, evidence, core)
            and raw["lineage"] == canonical(index) + b"\n", "Completed SDK lineage authority or canonical bytes differ")
    return chain, plan, registry, index, raw


def read_sdk_installed_web_history(lineage_dir, *, expected_chain_sha256, expected_index_sha256, verify_authority):
    """Read a pinned SDK index/registry without inferring any live profile.

    The caller authenticates publication and predecessor custody independently
    and owns installation locks. No Core upgrade or native health is admitted.
    """
    output = Path(lineage_dir)
    _authority(verify_authority)
    chain, plan, registry, _, raw = _history(output, expected_chain_sha256, expected_index_sha256)
    _authority(verify_authority)
    require(_records(output) == raw, "SDK historical evidence changed during authority verification")
    return deepcopy(chain), deepcopy(plan), successor_sdk_bindings(chain, registry)


def read_installed_web_history(lineage_dir, *, expected_chain_sha256, expected_index_sha256, verify_authority):
    """Dispatch only from an independently pinned index; legacy reader unchanged."""
    output = Path(lineage_dir)
    _authority(verify_authority)
    raw = _private_bytes(output / "lineage.json", modes=(0o400, 0o600))
    require(_matches(HASH, expected_index_sha256) and sha256(raw).hexdigest() == expected_index_sha256,
            "Independent historical Web index pin differs")
    index = decode(raw)
    if type(index) is dict and index.get("kind") == KIND:
        return read_sdk_installed_web_history(output, expected_chain_sha256=expected_chain_sha256,
            expected_index_sha256=expected_index_sha256, verify_authority=verify_authority)
    from installed_web_functional_operator import _historical
    chain, plan = _historical(output, expected_chain_sha256, expected_index_sha256)
    _authority(verify_authority)
    require(_private_bytes(output / "lineage.json", modes=(0o400, 0o600)) == raw,
            "Legacy historical index changed during authority verification")
    return chain, plan, {}


def read_sdk_seal_acknowledgement(install, *, controller, expected_plan_sha256, expected_index_sha256,
        loaded, release, publication_sha256, observe_installed, verify_authority):
    """Read exact completed SDK authority and live acceptance under target lock."""
    state, output = Path(install.state), Path(install.operation) / "lineage"
    require(_matches(HASH, expected_plan_sha256) and _matches(HASH, expected_index_sha256)
            and callable(observe_installed), "Independent SDK seal plan/index and observer required")
    with _lock(state):
        _authority(verify_authority)
        plan = controller.plan("reapply")
        _validate(plan)
        require(content_hash(plan) == expected_plan_sha256, "SDK final plan differs")
        raw_index = _private_bytes(output / "lineage.json", modes=(0o400,))
        require(sha256(raw_index).hexdigest() == expected_index_sha256, "SDK seal index pin differs")
        index = decode(raw_index)
        sealed, accepted, registry, actual_index, raw = _history(output, index["chainSha256"], expected_index_sha256)
        require(accepted == plan and raw["release"] == sdk_canonical(release) and raw["loaded-image"] == sdk_canonical(loaded)
                and raw["predecessor-chain"] == canonical(install.chain)
                and actual_index["predecessorChainSha256"] == install.chain_sha256
                and actual_index["sourcePublicationSha256"] == publication_sha256 == install.candidate_publication_sha256
                and registry[publication_sha256] == (install.candidate_binding, install.candidate_binding_sha256),
                "SDK completed seal differs from independently admitted release/runtime")
        core = actual_index["coreActivation"]
        expected_core = None if install.core_activation_operation_id is None else {
            "operationId": install.core_activation_operation_id, "lineageSha256": install.core_activation_lineage_sha256}
        require(core == expected_core and decode(raw["runtime-bindings"]) == _registry(install.chain, release,
                plan["after"]["runtime"], install.candidate_binding, install.candidate_binding_sha256,
                install.retained_sdk_bindings), "SDK seal Core pins or retained registry differ from admitted operator")
        _predecessor_authority(state, install.chain, install.chain_sha256, core)
        _verify_accepted_rollout(state, controller, plan)
        require(canonical(observe_installed()) == canonical(_expected_observation(plan, install.chain, sealed["active"]["alias"])),
                "Native SDK seal observation differs")
        _authority(verify_authority)
        _predecessor_authority(state, install.chain, install.chain_sha256, core)
        _verify_accepted_rollout(state, controller, plan)
        require(_records(output) == raw, "SDK completed evidence changed during readback")
        return {"state": "sealed", "sourceRevision": plan["after"]["runtime"]["sourceRevision"], "lineage": actual_index}
