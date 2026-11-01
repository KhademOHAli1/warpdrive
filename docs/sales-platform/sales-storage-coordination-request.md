# Sales storage and interface coordination request

1 November 2026. Prepared for the platform allocator chat
`01a19217-d257-7813-88e0-cf41cb36d93a`.

Sales source is `f006b5a5026449fd2bf792439b9149ba3517feb8`. Existing pipeline
archive/restore, saved-view recovery and guarded rename are implemented. Strict
stage-only template manifests and deterministic previews exist; installation
remains unavailable. Full unit 6068/972 files, affected PostgreSQL 245/51 files,
typecheck and lint passed. After an initial coordinated stop, the later explicitly granted production
webpack build passed on f006. No production service was started or deployed.

Please review and allocate the additive Sales persistence increment below, or
return an owner-reviewed alternative. This requests coordination and a schema
reservation, not migration execution or release acceptance. Sales will preserve
the combined history and will not independently claim 0094 or renumber applied
history. The inspected committed platform ledger reserves 0085 through 0093 for
MAIL and explicitly leaves 0094 unallocated.

## Proposed persistence responsibility

| Proposed table                          | Stored identity and constraints                                                                                                                                                                                   | Purpose                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `sales_pipeline_command_receipts`       | Server UUID; actor, operation and creation-intent UUID unique together; payload-contract version and SHA-256; canonical target pipeline UUID; optional duplicate source reference; committed result revision/time | One durable result for one intended create, duplicate or template installation; retry identity is not the pipeline name |
| `sales_process_template_versions`       | Server UUID; stable template key and positive content version unique; manifest schema/canonicalization version, exact canonical manifest content/hash, provenance and creation time                               | Bind a historical template version to immutable content; same key/version with different content conflicts              |
| `sales_process_template_installations`  | Server UUID; template-version reference, target pipeline, command receipt, chosen copy locale and creation time; receipt and target consistency                                                                   | Preserve which template/version intentionally created which pipeline; no automatic upgrade                              |
| `sales_process_template_stage_mappings` | Installation and stable stage key unique; canonical stage UUID with pipeline-consistent foreign key; installed name/order/rotting-days baseline                                                                   | Explicit mapping for later reviewed upgrades and local overrides; no matching by translated name                        |

These are proposed names and fields for owner review, not exports or an applied
schema. Use existing native actor and CRM UUIDs. No CRM customer organization is
an authentication workspace. The currently single-tenant record ownership must
remain attributable for the later SP-14 isolation/backfill work; the server,
never client input, owns any eventual workspace namespace.

Receipts retain minimal identity, hash and result references. Do not store
credentials, communication bodies or an arbitrary request bag. Please align
retention/deletion and protected-removal constraints with the owning privacy
contract before allocation. A deleted/revoked source must not turn an old receipt
into a disclosure path. Do not reuse audit correlation or workflow admission
uniqueness as this domain's idempotency store.

## Required transaction and retry behavior

1. Validate a strict versioned request; derive current native actor, fresh proof,
   capability and source/target scope on the server. Check current authorization
   before returning an existing receipt or result.
2. Identical actor/operation/intent plus identical normalized payload returns the
   original permitted result reference. The same intent with a changed payload
   conflicts. Two deliberate intents may create identical pipeline names.
3. Commit the pipeline, exact stage set, template binding/mapping when applicable,
   audit and receipt in one transaction. Failure at any point leaves none of
   those partial records. Competing identical requests produce one result.
4. Duplicate copies only reviewed configuration with new native IDs. It never
   copies opportunities, history, views, runs or effects. Bind the source preview
   to an exact configuration fingerprint and recheck it under parent/stage locks;
   the legacy parent timestamp alone does not cover every stage mutation.
5. Basic installation creates a new pipeline only. Preserve existing IDs and raw
   text. Locale chooses new draft labels; it does not rewrite existing records.
   No rule, workflow, message, provider call or historical effect is activated.
6. Upgrade support remains a later explicit diff/review transaction with local
   overrides and dependency mapping. Historical manifests and accepted mappings
   are never silently overwritten.

Qualification will include real PostgreSQL concurrency, response-loss retry,
changed-payload conflict, current-auth revocation, audit/receipt failure rollback,
preserved rows/IDs and supported-lineage recovery. Source review or a reservation
will not be described as those outcomes.

## Actual shared interfaces and requested owner response

The current committed source inventory finds manual WF execution and the existing
provider dispatcher. It does not find a qualified transactional CRM event outbox,
automatic admission/durable wait or shared MAIL effect bindings. Sales will
consume actual reviewed exports and will not create a second auth, workflow or
sender authority from proposed names.

Please return:

- The owning migration allocation and exact committed base/journal to target,
  including whether the four proposed tables should be split across migrations.
- Any required changes to receipt identity, version binding, privacy retention or
  future workspace attribution before implementation.
- Actual committed shared interface names and qualification limits for the later
  Sales automation/effect integration; proposed interfaces should remain labeled.
- A source-review and finite-validation sequence consistent with the current
  coordinated resource window.

This request stays within the full approved Sales roadmap. It does not take over
MAIL, WF, privacy or platform ownership, adopt dirty peer source, or authorize a
production migration.
