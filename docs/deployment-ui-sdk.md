# Installed full-SDK Web releases

This path releases one Web image from the ordinary full-source schema3 producer.
It preserves the admitted backend, private Web generations, existing data and
legacy release paths. Source and unit checks alone do not authorize installation.

## Custody and admission

1. Admit the original schema3 bundle through `publication_gate.verify_downloaded`.
   Keep the API-bound ZIP, full bundle, original archive, publication receipt and
   their independently verified hashes. Keep the original artifact kinds and
   pending gates unchanged.
2. Use `web_sdk_archive.py` to project the selected Web OCI closure into a separate
   archive. Retain its projection receipt and both original and derived custody.
   The tested native image ID, image config digest and loaded platform-manifest
   ID are distinct identities; do not substitute one for another.
3. Compare the genuine original four-component input receipt with the new SDK
   input receipt through `installed_web_sdk_admission.py`. Differences remain
   differences. A matching hash or input comparison is not runtime qualification.
4. Supply independently pinned native qualification, current installed chain,
   backend fingerprint, newsletter-state witness and reviewed contract evidence.
   Required qualification covers native custody, SDK packaging, authenticated
   HTTP/UI/Realtime, retained Worker queues, generation assets, newsletter state
   and unchanged schema. Synthetic reports cannot satisfy these checks.
5. Bind the runtime to the original raw publication-receipt SHA, exact source,
   loaded platform manifest and tested config digest. The SDK profile fixes
   `bun --bun next start`; neither the CLI nor Docker readback selects a command.

The release object and admission retain their closed schema1 shapes. The original
full-bundle publication remains the authority; the projection is not a replacement
publication or independent permission to reuse a backend.

## Operator and installed toolkit

The direct entry point is `installed_web_sdk_operator.py`. The installed toolkit
dispatches the same fixed entry through `installed_toolkit_current.py sdk-web
<action>`, with its required current-pointer SHA and exact operation/lineage pins.
The toolkit must explicitly include the SDK entry and both pinned import-policy
JSON files. Archive projection and native qualification use their separate source
capsules, not an expanded or arbitrary toolkit command.

Each private SDK operation holds these inputs at its fixed paths:

- `artifact/bundle/`, adjacent `artifact/bundle.zip`, and the original raw
  `artifact/publication-receipt.json`;
- `artifact/projected-web/web-image.tar` and `artifact/projection.json`;
- `original-backend-inputs.json`, `backend-comparison.json`, `runtime-binding.json`,
  `backend-reuse-qualification.json`, `engine-witness.json`, `contract-review.json`
  and the independently pinned `sdk-admission.json`.

Use the admitted lifecycle: `stage`, `observe`, `promote`, `rollback`, `reapply`,
then `seal`. Staging is private; promotion changes routing. Existing generation
assets and the retained runtime remain available for qualified old-tab behavior.
The controller verifies publication, custody, backend and newsletter authority
around operations and uses the existing installation locks and rollout journals.

**Sealing is not completed acceptance.** `seal` returns
`lineage-written-not-readback`. Review the written index independently, then run
`seal-readback` with that exact raw index SHA and accepted-plan pin. Successful
native readback produces immutable `sdk-seal-readback.json`; a later SDK release
requires this acknowledgement before accepting that SDK predecessor.

Unknown mutation acknowledgements hold. Preserve journals and inspect the actual
state; use only the matching explicit `recover`, `recover-reapply` or
`reconcile-failed-stamps` path. Do not retry creates, loads or route writes blindly.

## Newsletter and compatibility boundaries

Newsletter code remains available for future use. This shipment preserves the
current **unconfigured** integration, with delivery and public signup disabled.
Its disabled-state witness is bound to the accepted incumbent Web process and
checks native configuration, including file-based settings. It does not assert
that an Engine exists, is hosted, is qualified or can deliver mail.

Engine hosting, credentials, Worker configuration/restarts, provider setup, DNS
and delivery/signup activation require their own later reviewed operation. No
newsletter activation profile or Worker-transition draft belongs to this path.

Legacy commands, default readers, runtime/rollout schemas and historical seals
remain unchanged. Any already completed Core activation needs its existing
independent authority and lineage pins; this path adds no Core-upgrade controller.
Rollback changes the admitted Web route, not database contents or backend history.
Passing source checks, local tests, artifact admission, native qualification,
installed readback and production/customer acceptance are separate evidence gates.
