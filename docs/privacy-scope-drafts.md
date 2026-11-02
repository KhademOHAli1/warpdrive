# Unsealed disclosure scope drafts

`buildScopeDraftPlan(input, trustedContext, signal)` creates a deterministic proposal, always with `formatVersion:1` and `state:unsealed`. It cannot authorize disclosure, grant permission, attest current source contents, mint approval or return an approved `DisclosureContext`. An empty blocker list has the same unsealed meaning.

The server-supplied coverage describes exact categories, record references, native locators, source fingerprints, provenance and field names. Submitted decisions must account for that declared coverage, including zero-record categories. The utility does not discover the database or prove that this supplied coverage covers the installation; the future durable resolver/sealer must establish that independently.

## Binding and identity

The canonical hash includes the case, explicit subject, identity scope version, separate disclosure scope/revision, recipient/verification versions, policy version/generation, registry/catalog/source fingerprints, mode and adapter versions. Editing a disclosure proposal does not rewrite or accidentally invalidate the subject verification generation.

A server-owned opaque `recordRef` is separate from its adapter-native key. UUID primary keys retain their store identity; equal UUIDs in `users` and `auth_users` are distinct records. Mail records require both native UUID and account UUID, while repeated same-store native primary IDs with inconsistent mailbox accounts are rejected. Activity guest/participant and deal-participant rows use their real composite keys. No composite string is cast to a UUID, and UUID syntax does not prove subject identity or record existence.

## Canonical decisions and blockers

Category/record/field/provenance order does not affect the canonical JSON or SHA-256. Semantic changes to bindings, locators, fingerprints, decisions, replacement descriptors or portability/third-party attestations change it. Missing or duplicated categories, records or field decisions fail closed. Record descriptors must match the trusted metadata exactly.

Replacements are opaque reference/type/hash descriptors, never raw replacement text or arbitrary JSON. Review flags and hashes remain proposals until the future sealer validates authenticated decisions and loads the actual protected replacement/source contents. Unsupported stores, incomplete enumeration, unresolved provenance/review/third-party/portability and invalid access exclusions remain explicit blockers. Unknown stores have no inferred adapter.

The returned object and blocker entries are frozen. Canonical JSON is immutable; each `canonicalBytes` access returns a fresh UTF-8 copy, so caller mutation cannot change the retained snapshot/hash. This is metadata integrity, not proof of source or approval integrity. Native locators and hashes remain protected derived data and do not belong in routine telemetry.

## Bounds and evidence

Before schema parsing, descriptor inspection rejects getters, cycles and non-plain objects. Limits are 128 categories, 10,000 total records per input/context, 32 fields/provenance entries per record, 256 characters per metadata string, bounded traversal and 32 MiB canonical output. These bounds do not establish the full DPL-32 resource profile.

On 1 November 2026, all 40 draft unit tests passed as part of a five-file, 45-test selection at 04:46:45 Europe/Berlin. Initial resumed tests recorded 38 failures against the deliberately incomplete stub before implementation. The suite covers permutation stability, semantic commitments, native/composite identities, duplicate/missing coverage, unsupported/pending material, mutation isolation, hostile keys/getters and limits/cancellation. An independent source review found no consequential defect in that bounded slice. A later inherited-array getter regression then failed before plain-array prototype validation was added. All 41 draft tests subsequently passed at 05:10:00 Europe/Berlin (292 ms); this remains source/unit evidence, not runtime or installation qualification.

Durable scope tables/current pointer, authenticated decision storage, source revalidation, immutable sealing/invalidation, exact file/object descriptors, jobs, publication and recipient delivery remain open. No new SQL or shared migration allocation is introduced by this utility. The full DPL-01 through DPL-36 goal remains active.
