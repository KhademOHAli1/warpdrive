"""Seal a newly accepted repeat Web pair from its protected predecessor chain."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path

from installed_web_chain import REPOSITORY, _admit_journals, _directory, _state
from installed_web_lineage import OPERATION, _assert_existing, _generation, _seal
from installed_web_repeat_image import verify_received_repeat
from web_generation_routes import WebGeneration
from web_rollout import _record, _validate
from web_switch import HASH, NAME, _lock, _matches, canonical, content_hash, require


def _predecessor(state, chain, expected_hash):
    require(type(chain) is dict and set(chain) == {"targetKey", "backendFingerprint", "acceptedOperationId",
                                                  "acceptedPlanSha256", "active", "previous"}
            and _matches(HASH, expected_hash) and content_hash(chain) == expected_hash,
            "Independently admitted predecessor Web chain required")
    operation = chain["acceptedOperationId"]
    require(_matches(NAME, operation), "Exact predecessor operation required")
    journal = _state(state / "web-rollouts" / (operation + ".json"))
    plan = journal["plan"]
    _validate(plan)
    require(journal["state"] == "accepted" and plan["operationId"] == operation
            and content_hash(plan) == chain["acceptedPlanSha256"] and plan["targetKey"] == chain["targetKey"]
            and plan["backendFingerprint"] == chain["backendFingerprint"]
            and plan["after"] == chain["active"]["slot"] and plan["before"] == chain["previous"]["slot"],
            "Predecessor Web chain differs from the accepted journal")


def _publication_provenance(receipt, loaded, chain, plan, authority):
    baseline, image, provenance, origin = (receipt[key] for key in ("baseline", "image", "provenance", "origin"))
    previous = chain["active"]["provenance"]
    runtime = plan["after"]["runtime"]
    active = baseline["activeWeb"]
    require(active["revision"] == previous["revision"] and active["bundleManifestSha256"] == previous["manifestSha256"]
            and active["archiveSha256"] == previous["archiveSha256"] and active["imageId"] == previous["testedConfigDigest"]
            and active["publicationReceiptSha256"] == previous["authoritySha256"],
            "Repeat publication does not bind the retained Web artifact")
    expected = {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified",
                "deploymentAuthorized": False, "sourceRevision": receipt["revision"], "origin": origin,
                "baselineRevision": previous["revision"], "baselineManifestSha256": previous["manifestSha256"],
                "bundleManifestSha256": provenance["bundleManifestSha256"], "archiveSha256": provenance["archiveSha256"],
                "archiveSizeBytes": provenance["archiveSizeBytes"], "testedConfigDigest": image["imageId"],
                "manifestDigest": runtime["imageId"], "imageId": runtime["imageId"]}
    require(type(loaded) is dict and all(canonical(loaded.get(key)) == canonical(value) for key, value in expected.items()),
            "Repeat native Web load receipt differs from publication or accepted runtime")
    current = {"repository": REPOSITORY, "revision": receipt["revision"], "manifestSha256": provenance["bundleManifestSha256"],
               "archiveSha256": provenance["archiveSha256"], "testedConfigDigest": image["imageId"], "authoritySha256": authority}
    require(all(current[key] != previous[key] for key in ("manifestSha256", "archiveSha256", "testedConfigDigest", "authoritySha256")),
            "Distinct retained and active Web artifact provenance required")
    return previous, current


def _sealed_pair(output, index, records, check):
    index_path = output / "lineage.json"
    index_raw = canonical(index) + b"\n"
    complete = _assert_existing(index_path, index_raw)
    for name, raw in records.items():
        present = _assert_existing(output / (name + ".json"), raw)
        require(not complete or present, "Sealed repeat lineage index refers to missing generation evidence")
    for name, raw in records.items():
        _seal(output / (name + ".json"), raw)
    check()
    _seal(index_path, index_raw)


def seal_repeat_installed_web_lineage(
    state_dir, *, output_dir, admitted_chain, expected_chain_sha256, expected_operation_id, expected_plan_sha256,
    bundle_dir, publication_bytes, expected_publication_sha256, import_record, loaded, candidate_alias, observe_installed,
):
    """Seal accepted C and retained B under the shared controller state lock.

    The caller owns the wider installation lock and verifies the protected
    backend, relay and both alias/runtime bindings. `observe_installed` returns
    the exact two-generation live, persisted and public witness given below.
    The authenticated predecessor chain is retained separately, with its original
    receipts. Repeating an exact seal only reads the existing immutable files.
    """
    state, output, bundle = map(Path, (state_dir, output_dir, bundle_dir))
    for path in (state, output, bundle):
        _directory(path)
    require(all(not output.is_relative_to(path) and not path.is_relative_to(output) for path in (state, bundle)),
            "Distinct private repeat lineage output required")
    selected = OPERATION.fullmatch(expected_operation_id) if isinstance(expected_operation_id, str) else None
    require(selected and candidate_alias == "warpdrive-web-" + selected[1] and _matches(HASH, expected_plan_sha256)
            and _matches(HASH, expected_publication_sha256) and type(import_record) is dict and callable(observe_installed),
            "Exact accepted repeat Web operation, artifact and observer required")
    chain, imported, load = map(deepcopy, (admitted_chain, import_record, loaded))
    operations = state / "web-rollouts"
    pointer = state / "accepted-web-generation.json"
    path = operations / (expected_operation_id + ".json")
    with _lock(state):
        _directory(operations)
        _predecessor(state, chain, expected_chain_sha256)
        journal = _state(path)
        plan = journal["plan"]
        _validate(plan)
        before, after = plan["before"], plan["after"]
        require(journal["state"] == "accepted" and plan["operationId"] == expected_operation_id
                and expected_operation_id != chain["acceptedOperationId"] and content_hash(plan) == expected_plan_sha256
                and plan["targetKey"] == chain["targetKey"] and plan["backendFingerprint"] == chain["backendFingerprint"]
                and before["runtime"] == chain["active"]["slot"]["runtime"] and after["runtime"]["name"] == candidate_alias,
                "Exact repeat Web acceptance differs from the admitted predecessor")
        _admit_journals(operations, plan)
        retained = WebGeneration(before["route"]["generation"], chain["active"]["alias"])
        current = WebGeneration(after["route"]["generation"], candidate_alias)
        require(retained.target != current.target, "Distinct accepted Web aliases required")
        receipt = verify_received_repeat(bundle, publication_bytes, expected_publication_sha256=expected_publication_sha256,
            expected_lineage_sha256=expected_chain_sha256, expected_revision=after["runtime"]["sourceRevision"],
            expected_active_revision=before["runtime"]["sourceRevision"], import_record=imported)
        require(plan["qualificationSha256"] == content_hash({"installedChainSha256": expected_chain_sha256,
                                                             "releaseQualificationSha256": content_hash(receipt)}),
                "Repeat artifact admission differs from the accepted plan qualification")
        previous_provenance, active_provenance = _publication_provenance(receipt, load, chain, plan, expected_publication_sha256)
        records = {name: canonical(_generation(plan, side, generation.target, provenance)) + b"\n"
                   for name, side, generation, provenance in (("active", "after", current, active_provenance),
                                                               ("previous", "before", retained, previous_provenance))}
        require(sha256(records["previous"]).hexdigest() == chain["active"]["receiptSha256"],
                "The retained generation receipt differs from its original immutable bytes")
        route = after["route"]
        accepted = _record(plan, after)
        expected = {"beforeRuntime": before["runtime"], "afterRuntime": after["runtime"],
                    "backendFingerprint": plan["backendFingerprint"], "route": route,
                    "aliases": {retained.deployment_id: retained.target, current.deployment_id: current.target},
                    "liveConfigSha256": route["fingerprint"], "autosaveConfigSha256": route["fingerprint"],
                    "publicSourceRevision": after["runtime"]["sourceRevision"], "publicHealthy": True, "ingressReady": True}

        def check():
            require(canonical(observe_installed()) == canonical(expected) and _state(path) == journal
                    and _state(pointer) == accepted, "Installed repeat Web acceptance, route or protected backend changed")

        require(_state(pointer) == accepted, "Accepted Web pointer differs from the repeat plan")
        check()
        index = {"schemaVersion": 1, "kind": "warpdrive-repeat-installed-web-lineage", "targetKey": plan["targetKey"],
                 "acceptedOperationId": expected_operation_id, "acceptedPlanSha256": expected_plan_sha256,
                 "predecessorChainSha256": expected_chain_sha256, "backendFingerprint": plan["backendFingerprint"],
                 "liveConfigSha256": route["fingerprint"],
                 **{name + "Sha256": sha256(raw).hexdigest() for name, raw in records.items()}}
        _sealed_pair(output, index, records, check)
    return index
