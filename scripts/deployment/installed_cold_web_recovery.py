"""Read-only admission of the installed Web recovery inputs under the existing hold."""

from collections.abc import Callable
from copy import deepcopy
from itertools import islice
from pathlib import Path

from installed_cold_ingress_route import INSTALLED_WATCHED_DIRECTORY, observe_installed_cold_ingress_route
from installed_cold_relay_storage import INSTALLED_PRIVATE_ROOT, STAGE_NAME, observe_installed_cold_relay_storage
from installed_cold_web_slots import observe_installed_cold_web_slots
from installed_core_lineage import InstalledWebChain, _validate_generation, verify_projected_core_predecessor
from installed_web_chain import _admit_journals, _directory, _state, _witness
from installed_web_readback_lock import installed_web_readback_locks
from installed_web_relay import INGRESS
from installed_web_runtime import NETWORKS
from recovery import RecoveryError, absolute, no_overlap, require
from traefik_web_handoff import TraefikWebHandoff
from traefik_web_handoff_state import _MAX_ROUTE, _alias
from web_rollout import _record, _validate
from web_switch import HASH, NAME, SwitchError, _matches, canonical, content_hash


_MAX_CONTAINERS = 1024
_MAX_INVENTORY_BYTES = 16 * 1024**2


def _accepted_lineage(state, chain, chain_sha256, activation_id, activation_sha256):
    require(type(chain) is dict and set(chain) == set(InstalledWebChain.__annotations__)
            and chain["targetKey"] == "pitant-warpdrive" and _matches(HASH, chain_sha256)
            and _matches(NAME, chain["acceptedOperationId"]) and content_hash(chain) == chain_sha256,
            "Exact independently admitted installed Web chain required")
    operations = state / "web-rollouts"
    _directory(operations)
    selected = _state(operations / (chain["acceptedOperationId"] + ".json"))
    plan = selected["plan"]
    _validate(plan)
    require(selected == {"plan": plan, "state": "accepted"} and plan["targetKey"] == chain["targetKey"]
            and plan["operationId"] == chain["acceptedOperationId"]
            and content_hash(plan) == chain["acceptedPlanSha256"], "Exact accepted installed Web plan required")
    _admit_journals(operations, plan)

    if activation_id is None:
        require(chain["backendFingerprint"] == plan["backendFingerprint"], "Accepted Web backend differs from the plan")
        _validate_generation(chain["active"], plan["after"])
        _validate_generation(chain["previous"], plan["before"])
        pointer = _record(plan, plan["after"])
    else:
        projection = verify_projected_core_predecessor(state, chain=chain, activation_operation_id=activation_id,
                                                       expected_activation_lineage_sha256=activation_sha256)
        pointer = projection.accepted_pointer
    require(chain["active"]["receiptSha256"] != chain["previous"]["receiptSha256"],
            "Distinct accepted Web generation receipts required")
    pointer_path = state / "accepted-web-generation.json"
    require(_state(pointer_path) == pointer, "Installed Web current pointer differs from the admitted lineage")

    entries = list(islice(operations.iterdir(), 1001))
    require(len(entries) <= 1000, "Installed Web journal inventory exceeds its bound")
    return {
        "acceptedOperationId": plan["operationId"], "acceptedPlanSha256": chain["acceptedPlanSha256"],
        "chainSha256": chain_sha256, "pointerSha256": content_hash(pointer),
        "pointerMetadata": list(_witness(pointer_path.lstat())),
        "journalInventorySha256": content_hash({entry.name: list(_witness(entry.lstat())) for entry in entries}),
        "coreActivationOperationId": activation_id, "coreActivationLineageSha256": activation_sha256,
    }


def _inventory(observe):
    value = observe()
    require(type(value) is dict and set(value) == {"containers", "networks"}
            and type(value["containers"]) is list and 3 <= len(value["containers"]) <= _MAX_CONTAINERS
            and type(value["networks"]) is dict and set(value["networks"]) == set(NETWORKS),
            "Exact bounded native Docker container and bridge inventory required")
    rows, bytes_seen = {}, 0
    for row in value["containers"]:
        require(type(row) is dict and _matches(HASH, row.get("Id")) and row["Id"] not in rows,
                "Native Docker inventory has an invalid or duplicate container")
        bytes_seen += len(canonical(row))
        require(bytes_seen <= _MAX_INVENTORY_BYTES, "Native Docker inventory exceeds its byte bound")
        rows[row["Id"]] = row
    bytes_seen += len(canonical(value["networks"]))
    require(bytes_seen <= _MAX_INVENTORY_BYTES, "Native Docker inventory exceeds its byte bound")
    return rows, value["networks"], content_hash({"containers": rows, "networks": value["networks"]})


def _cold_bridge_aliases(rows, networks, pair, relay, relay_alias):
    protected = {row["Id"]: row["Name"][1:] for row in pair.values()} | {relay["Id"]: relay_alias}
    endpoint = relay["NetworkSettings"]["Networks"][INGRESS]
    require(endpoint.get("EndpointID") == "" and endpoint.get("IPAddress") == ""
            and not endpoint.get("GlobalIPv6Address"), "Installed relay is still attached to ingress")
    protected_names = set(protected.values())
    endpoints = {identifier: row["NetworkSettings"]["Networks"] for identifier, row in rows.items()}
    require(all(type(networks_by_name) is dict for networks_by_name in endpoints.values()),
            "Native Docker endpoint inventory is incomplete")
    for name, network in networks.items():
        members = network["Containers"]
        require(not set(members) & protected.keys() and all(
            identifier in endpoints and name in endpoints[identifier]
            and member["EndpointID"] == endpoints[identifier][name].get("EndpointID")
            and member["Name"] == rows[identifier]["Name"].removeprefix("/")
            for identifier, member in members.items()), "Installed bridge membership differs from native Docker inventory")
        for identifier, networks_by_name in endpoints.items():
            if name not in networks_by_name:
                continue
            endpoint = networks_by_name[name]
            require(not endpoint.get("EndpointID") or identifier in members,
                    "Native Docker live endpoint is missing from its bridge")
            names = [rows[identifier]["Name"].removeprefix("/")]
            for field in ("Aliases", "DNSNames"):
                aliases = endpoint.get(field)
                require(aliases is None or (type(aliases) is list and len(aliases) <= 128
                        and all(type(alias) is str and 0 < len(alias) <= 253 for alias in aliases)),
                        "Native Docker DNS alias inventory is incomplete")
                names.extend(aliases or [])
            claimed = {candidate.rstrip(".").casefold() for candidate in names} & protected_names
            require(claimed <= {protected.get(identifier)}, "Another Docker endpoint claims an installed Web or relay DNS alias")


def _protect_source_paths(rows, paths, relay_id):
    # Relay overlap, alias identity, special files and unsupported mount types
    # have already been checked on all peer rows by the relay storage guard.
    for identifier, row in rows.items():
        if identifier == relay_id:
            continue
        for mount in row["Mounts"]:
            if mount["Type"] in {"bind", "volume"} and mount.get("RW") is not False:
                source = absolute(mount["Source"])
                require(all(no_overlap(source, path) for path in paths),
                        "Another Docker container can write installed Web recovery sources")


def observe_installed_cold_web_recovery(
    original: Path, state: Path, *, chain: dict, chain_sha256: str, before_stop: dict, before_stop_sha256: str,
    network_ids: dict, runtime_secret: Path, database_role: str, database_name: str, relay_id: str,
    relay_image_id: str, relay_manifest: dict, ingress_handoff: TraefikWebHandoff, ingress_route_sha256: str,
    ingress_journal_sha256: str, expected_roots: list, observe_inventory: Callable[[], dict],
    sealed_route_source: Path | None = None, core_activation_operation_id: str | None = None,
    core_activation_lineage_sha256: str | None = None,
) -> tuple[bytes, dict]:
    """Admit the installed Web evidence while retaining the existing release locks.

    The caller independently pins the installed chain, pre-stop witness, relay
    image and identity, ingress handoff, and exact list of {name, path} roots.
    The Caddy autosave comes first, followed by the sorted Web secret names. The inventory callback supplies all container inspect rows and both
    named bridge rows from one read-only native observation per call. The caller
    supplies the complete inventory and keeps the installed hold against host
    and Docker writers throughout this observation and any later private copy.

    The returned ingress bytes are separate from the filesystem roots. This
    witness has no capture authority and does not create a copy or a snapshot.
    """
    try:
        original, state = (absolute(str(path)) for path in (original, state))
        require(state.name == "rollout" and state.parent.parent == INSTALLED_PRIVATE_ROOT
                and STAGE_NAME.fullmatch(state.parent.name) and original.is_relative_to(INSTALLED_PRIVATE_ROOT)
                and original != INSTALLED_PRIVATE_ROOT and no_overlap(original, state.parent),
                "Exact distinct original production and installed Web state paths required")
        require((core_activation_operation_id is None) == (core_activation_lineage_sha256 is None),
                "Paired installed Core activation lineage pins required")
        chain, before_stop, network_ids, relay_manifest, expected_roots = map(
            deepcopy, (chain, before_stop, network_ids, relay_manifest, expected_roots),
        )
        relay_directory = state.parent / "relay"
        relay_alias = "warpdrive-web-relay-" + state.parent.name.removeprefix("first-web-release-")
        require(type(ingress_handoff) is TraefikWebHandoff and type(ingress_handoff.after_document) is bytes
                and 0 < len(ingress_handoff.after_document) <= _MAX_ROUTE
                and _alias(ingress_handoff.after_document) == relay_alias, "Installed ingress does not target the stable relay")

        def lineage():
            return _accepted_lineage(state, chain, chain_sha256, core_activation_operation_id, core_activation_lineage_sha256)

        def observe():
            rows, networks, inventory_sha256 = _inventory(observe_inventory)
            pair = {side: rows[chain[side]["slot"]["runtime"]["runtimeId"]] for side in ("active", "previous")}
            require(relay_id not in {row["Id"] for row in pair.values()}, "Installed relay and Web slot identities overlap")
            slots = observe_installed_cold_web_slots(
                pair, networks, chain=chain, chain_sha256=chain_sha256, before_stop=before_stop,
                before_stop_sha256=before_stop_sha256, network_ids=network_ids, runtime_secret=runtime_secret,
                database_role=database_role, database_name=database_name,
            )
            relay = observe_installed_cold_relay_storage(
                rows[relay_id], [row for identifier, row in rows.items() if identifier != relay_id],
                relay_directory, relay_id=relay_id, alias=relay_alias, image_id=relay_image_id, manifest=relay_manifest,
                ingress_id=network_ids[INGRESS], accepted_route_sha256=chain["active"]["slot"]["route"]["fingerprint"],
            )
            _cold_bridge_aliases(rows, networks, pair, rows[relay_id], relay_alias)
            route_bytes, ingress = observe_installed_cold_ingress_route(
                ingress_handoff, watched_dir=INSTALLED_WATCHED_DIRECTORY, state_dir=state,
                expected_route_sha256=ingress_route_sha256, expected_journal_sha256=ingress_journal_sha256,
                sealed_route_source=sealed_route_source,
            )
            secrets = slots["witness"]["slots"]["active"]["secrets"]
            roots = [{"name": name, "path": secret["path"]} for name, secret in sorted(secrets.items())]
            require(sorted(item["path"] for item in roots) == slots["roots"], "Installed Web secret roots differ")
            roots = [{"name": "caddy-autosave", "path": relay["root"]}, *roots]
            require(type(expected_roots) is list and roots == expected_roots
                    and len({item["path"] for item in roots}) == len(roots),
                    "Exact named installed Web roots differ from the admitted list")
            source_paths = [absolute(item["path"]) for item in roots] + [absolute(ingress["routePath"])]
            if ingress["sealedRoutePath"] is not None:
                source_paths.append(absolute(ingress["sealedRoutePath"]))
            _protect_source_paths(rows, source_paths, relay_id)
            return route_bytes, {"inventorySha256": inventory_sha256, "roots": roots,
                                 "slots": slots["witness"], "relay": relay["witness"], "ingress": ingress}

        # The target lock here is a file. The ingress guard locks the watched
        # and state directories in that order, as the installed handoff does.
        with installed_web_readback_locks(original, state):
            accepted = lineage()
            first = observe()
            second = observe()
            require(first == second and lineage() == accepted, "Installed cold Web observation changed during readback")
            raw, witness = first
            return raw, {"schemaVersion": 1, "kind": "installed-cold-web-recovery-witness", "lineage": accepted, **witness}
    except (AttributeError, KeyError, OSError, TypeError, ValueError, RecursionError, SwitchError):
        raise RecoveryError("Installed cold Web recovery evidence is unverified") from None
