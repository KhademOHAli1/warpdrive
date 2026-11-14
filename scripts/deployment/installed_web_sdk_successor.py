"""Use the existing protected Web lifecycle for one admitted full-SDK runtime.

No publication, image load, backend equivalence, or deployment is admitted here.
The caller must independently admit those original full-bundle facts and hold
the same installation locks as InstalledWebSuccessor before using this class.
"""

from copy import deepcopy

import installed_web_operator as operator
import installed_web_runtime as legacy
import installed_web_sdk_runtime as sdk
from installed_web_successor import InstalledWebSuccessor


class InstalledWebSdkSuccessor(InstalledWebSuccessor):
    """Keep legacy retained slots, and explicitly bound SDK retained slots, safe.

    ``candidate_binding`` and each registry record come ONLY from the caller's
    original full-SDK artifact admission. Their hashes are integrity pins, not
    authentication. ``expected_candidate_publication_sha256`` is the separate,
    independently sealed original-publication authority pin.
    """

    def __init__(self, *args, candidate_binding, expected_candidate_binding_sha256,
                 expected_candidate_publication_sha256, retained_sdk_bindings=None, **kwargs):
        legacy.require(type(candidate_binding) is dict, "Exact admitted SDK candidate binding required")
        self.candidate_binding = sdk.validate_runtime_binding(candidate_binding,
            expected_sha256=expected_candidate_binding_sha256,
            authority_sha256=expected_candidate_publication_sha256,
            source_revision=candidate_binding.get("sourceRevision"), image_id=candidate_binding.get("imageId"),
            tested_config_digest=candidate_binding.get("testedConfigDigest"))
        self.candidate_binding_sha256 = expected_candidate_binding_sha256
        self.candidate_publication_sha256 = expected_candidate_publication_sha256
        self.retained_sdk_bindings = sdk.validate_retained_bindings(
            {} if retained_sdk_bindings is None else retained_sdk_bindings)
        super().__init__(*args, **kwargs)

    def _retained(self):
        backend = self._backend()
        self._verify_ingress()
        profiles = {}
        for name in ("active", "previous"):
            item = self.chain[name]
            profiles[name] = sdk.read_admitted_web_slot(
                self.docker.inspect(item["slot"]["runtime"]["runtimeId"]), item=item,
                network_ids=self.inputs["networkIds"], runtime_secret=self.inputs["runtimeSecret"],
                schema_sha256=backend["schemaSha256"], sdk_bindings=self.retained_sdk_bindings)
        return backend, profiles["active"]

    def _candidate_document(self, loaded, alias, revision):
        # The generic loader supplies testedConfigDigest (archive config) and
        # imageId == manifestDigest (actual native platform manifest). It does
        # not supply a publication pin; that independent pin is mandatory above.
        sdk.validate_runtime_binding(self.candidate_binding,
            expected_sha256=self.candidate_binding_sha256, authority_sha256=self.candidate_publication_sha256,
            source_revision=revision, image_id=loaded.get("imageId"),
            tested_config_digest=loaded.get("testedConfigDigest"))
        # Keep every base source/daemon/distinct generation/retained invariant.
        base_document, backend = super()._candidate_document(loaded, alias, revision)
        base_document["Cmd"] = list(sdk.COMMAND)
        return base_document, backend

    def _candidate(self, row, document, alias, *, created=False, require_ready=False):
        return sdk.verify_candidate(row, document, alias=alias, network_ids=self.inputs["networkIds"],
            runtime_secret=self.inputs["runtimeSecret"], binding=self.candidate_binding,
            expected_binding_sha256=self.candidate_binding_sha256,
            authority_sha256=self.candidate_publication_sha256,
            tested_config_digest=self.candidate_binding["testedConfigDigest"],
            created=created, require_ready=require_ready)

    def _candidate_ready(self, row, document, alias, revision):
        legacy.require(revision == self.candidate_binding["sourceRevision"], "SDK readiness source differs")
        witness = self._candidate(row, document, alias)
        if not (witness["running"] and row["State"].get("Health", {}).get("Status") == "healthy"):
            return None
        self._candidate(row, document, alias, require_ready=True)
        address = operator.network_peer(self.docker, self.network, row, alias)
        if not operator.read_direct_web(address, revision, self.inputs["version"]):
            return None
        return witness

    def read_admitted_slot(self, row, *, item, schema_sha256):
        """Observer hook for exact retained OR newly staged SDK generations.

        The caller supplies the same admitted provenance used by its lineage
        writer. The candidate authority cannot silently replace a retained
        record with the same publication hash.
        """
        registry = deepcopy(self.retained_sdk_bindings)
        pair = (self.candidate_binding, self.candidate_binding_sha256)
        authority = self.candidate_publication_sha256
        legacy.require(authority not in registry or registry[authority] == pair,
                       "SDK observer authority conflicts with retained binding")
        registry[authority] = pair
        return sdk.read_admitted_web_slot(row, item=item, network_ids=self.inputs["networkIds"],
            runtime_secret=self.inputs["runtimeSecret"], schema_sha256=schema_sha256, sdk_bindings=registry)
