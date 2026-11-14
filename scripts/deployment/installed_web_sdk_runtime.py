"""An explicitly admitted full-SDK Web runtime beside the unchanged legacy one.

The caller authenticates original full-bundle publication, native image custody
and generation lineage before supplying bindings and their independent pins.
Canonical hashes bind these records; they do not authenticate a publication.
No command is selected from Docker readback and no CLI accepts a command.
"""

from copy import deepcopy

import installed_web_runtime as legacy
import installed_web_successor as successor
from web_switch import content_hash


PROFILE_ID = "warpdrive.sdk-full.web-runtime.v1"
COMMAND = ("bun", "--bun", "next", "start")
BINDING_KEYS = frozenset({"kind", "schemaVersion", "publicationReceiptSha256", "sourceRevision",
                          "imageId", "testedConfigDigest", "profileId", "command"})


def _match(pattern, value):
    return type(value) is str and pattern.fullmatch(value) is not None


def validate_runtime_binding(record, *, expected_sha256, authority_sha256, source_revision,
                             image_id, tested_config_digest):
    """Check one caller-authenticated publication/native-image binding exactly.

    ``image_id`` is the actual loaded platform manifest, not the tested native
    image identity or its config digest. ``tested_config_digest`` is the generic
    loader's independently admitted tested config pin. Neither substitutes for
    the other, even on a daemon where two identities happen to coincide.
    """
    legacy.require(type(record) is dict and set(record) == BINDING_KEYS
                   and _match(legacy.ID, expected_sha256)
                   and _match(legacy.ID, authority_sha256)
                   and _match(legacy.REVISION, source_revision)
                   and _match(legacy.IMAGE, image_id)
                   and _match(legacy.IMAGE, tested_config_digest)
                   and content_hash(record) == expected_sha256
                   and type(record["schemaVersion"]) is int and record["schemaVersion"] == 1
                   and record["kind"] == "warpdrive-sdk-web-runtime-binding"
                   and record["profileId"] == PROFILE_ID
                   and type(record["command"]) is list and record["command"] == list(COMMAND)
                   and record["publicationReceiptSha256"] == authority_sha256
                   and record["sourceRevision"] == source_revision
                   and record["imageId"] == image_id
                   and record["testedConfigDigest"] == tested_config_digest,
                   "Exact independently admitted SDK runtime binding required")
    return deepcopy(record)


def _profile_projection(row):
    # Validate the actual command first. The only projected field is this one
    # fixed, already bound command; every other live invariant remains native.
    legacy.require(type(row) is dict and type(row.get("Config")) is dict
                   and type(row["Config"].get("Cmd")) is list and row["Config"]["Cmd"] == list(COMMAND),
                   "Exact admitted SDK runtime command required")
    projected = deepcopy(row)
    projected["Config"]["Cmd"] = legacy.COMMAND.copy()
    return projected


def sdk_profile(profile):
    """Add the fixed SDK profile identity to a freshly validated base profile."""
    legacy.require(type(profile) is dict
                   and set(profile) == {"environment", "mounts", "limits", "healthcheck", "networks"},
                   "Exact validated base Web profile required")
    return {**deepcopy(profile), "profileId": PROFILE_ID, "command": list(COMMAND)}


def installed_profile(row, *, image_id, revision, network_ids, runtime_secret, binding,
                      expected_binding_sha256, authority_sha256, tested_config_digest, created=False):
    """Reuse all legacy native invariants after an explicit fixed-Cmd binding."""
    validate_runtime_binding(binding, expected_sha256=expected_binding_sha256,
        authority_sha256=authority_sha256, source_revision=revision, image_id=image_id,
        tested_config_digest=tested_config_digest)
    profile = legacy.installed_profile(_profile_projection(row), image_id=image_id, revision=revision,
        network_ids=network_ids, runtime_secret=runtime_secret, created=created)
    return sdk_profile(profile)


def document(profile, *, image, revision, alias):
    """Create only the fixed SDK command, never a caller-provided command."""
    legacy.require(type(profile) is dict and profile.get("profileId") == PROFILE_ID
                   and type(profile.get("command")) is list and profile["command"] == list(COMMAND)
                   and set(profile) == {"environment", "mounts", "limits", "healthcheck", "networks", "profileId", "command"}
                   and _match(legacy.IMAGE, image) and _match(legacy.REVISION, revision)
                   and _match(legacy.ALIAS, alias), "Exact SDK profile and candidate pins required")
    result = successor._document(profile, image=image, revision=revision, alias=alias)
    result["Cmd"] = list(COMMAND)
    return result


def verify_candidate(row, document, *, alias, network_ids, runtime_secret, binding,
                     expected_binding_sha256, authority_sha256, tested_config_digest,
                     require_ready=False, created=False):
    """Return the existing runtime schema with an SDK-specific config hash."""
    legacy.require(type(document) is dict and type(document.get("Cmd")) is list
                   and document["Cmd"] == list(COMMAND), "Exact fixed SDK candidate document required")
    values = legacy.environment({"Env": document["Env"]})
    profile = installed_profile(row, image_id=document["Image"], revision=values["APP_COMMIT"],
        network_ids=network_ids, runtime_secret=runtime_secret, binding=binding,
        expected_binding_sha256=expected_binding_sha256, authority_sha256=authority_sha256,
        tested_config_digest=tested_config_digest, created=created)
    projected = deepcopy(document)
    projected["Cmd"] = legacy.COMMAND.copy()
    observed = legacy.verify_candidate(_profile_projection(row), projected, alias=alias,
        network_ids=network_ids, runtime_secret=runtime_secret, require_ready=require_ready, created=created)
    return {**observed, "configSha256": content_hash(profile)}


def validate_retained_bindings(bindings):
    """Copy a bounded registry keyed only by authenticated lineage authority."""
    legacy.require(type(bindings) is dict and len(bindings) <= 256,
                   "Bounded admitted retained SDK binding registry required")
    result = {}
    for authority, pair in bindings.items():
        legacy.require(_match(legacy.ID, authority) and type(pair) is tuple and len(pair) == 2,
                       "Authority-keyed SDK binding and independent pin required")
        record, pin = pair
        legacy.require(type(record) is dict, "Exact retained SDK binding required")
        result[authority] = (validate_runtime_binding(record, expected_sha256=pin,
            authority_sha256=authority, source_revision=record.get("sourceRevision"),
            image_id=record.get("imageId"), tested_config_digest=record.get("testedConfigDigest")), pin)
    return result


def read_admitted_sdk_web_slot(row, *, item, network_ids, runtime_secret, schema_sha256,
                               binding, expected_binding_sha256):
    """Read a later SDK active/previous slot from its exact sealed provenance."""
    runtime, alias = item["slot"]["runtime"], item["alias"]
    provenance = item.get("provenance")
    legacy.require(type(provenance) is dict and provenance.get("revision") == runtime["sourceRevision"]
                   and _match(legacy.ID, provenance.get("authoritySha256"))
                   and _match(legacy.IMAGE, provenance.get("testedConfigDigest"))
                   and _match(legacy.ALIAS, alias) and runtime["name"] == alias
                   and row["Id"] == runtime["runtimeId"],
                   "Exact admitted SDK generation authority, runtime and alias required")
    options = {"binding": binding, "expected_binding_sha256": expected_binding_sha256,
               "authority_sha256": provenance["authoritySha256"],
               "tested_config_digest": provenance["testedConfigDigest"]}
    profile = installed_profile(row, image_id=runtime["imageId"], revision=runtime["sourceRevision"],
        network_ids=network_ids, runtime_secret=runtime_secret, **options)
    expected = document(profile, image=runtime["imageId"], revision=runtime["sourceRevision"], alias=alias)
    observed = verify_candidate(row, expected, alias=alias, network_ids=network_ids,
        runtime_secret=runtime_secret, **options)
    legacy.require({**observed, "schemaSha256": schema_sha256} == runtime
                   and row["State"]["Status"] == "running" and row["State"]["Health"]["Status"] == "healthy",
                   "Accepted SDK runtime, profile or health differs")
    return profile


def read_admitted_web_slot(row, *, item, network_ids, runtime_secret, schema_sha256, sdk_bindings=None):
    """Dispatch from admitted authority, never from a live command or image.

    With no matching binding, the unchanged strict legacy reader must pass.
    Thus an unbound SDK process holds instead of selecting its own profile.
    """
    bindings = validate_retained_bindings({} if sdk_bindings is None else sdk_bindings)
    provenance = item.get("provenance", {})
    authority = provenance.get("authoritySha256") if type(provenance) is dict else None
    options = {"item": item, "network_ids": network_ids, "runtime_secret": runtime_secret,
               "schema_sha256": schema_sha256}
    if authority in bindings:
        binding, pin = bindings[authority]
        return read_admitted_sdk_web_slot(row, binding=binding, expected_binding_sha256=pin, **options)
    return successor.read_admitted_web_slot(row, **options)
