# Agency project core: privacy interface review

31 October 2026. Read-only review of `docs/agency-projects/project-core-delta.md` at agency source `8e6e2a65349ea6ebd6e652228ffe46c7caac6327`. Privacy reference source is committed `86ea68f6f8680ea67206148c96205a3e90830f99` plus its locally qualified, unpublished M2 checkpoint. This review changes no peer source, reserves no migration and accepts no installation or retention policy.

The four-store proposal is suitable for continued design with the following conditions. It does not yet establish lifecycle compatibility or a generic writer fence.

## Canonical deletion and references

The current `deletePerson`, `deleteOrg` and both deal deletion paths soft-delete canonical records. Restrictive foreign keys do not block those updates. They also do not detect a soft-deleted parent, so project get/list/count/search and mutation admission must check the current parent ceiling explicitly. A deleted parent must not broaden access through a surviving organization or owner.

Physical erasure is different. Restrictive project, owner, member, request-actor and history-recorder references can block future deletion of a person, organization, deal or user. This is a visible dependency requiring an approved retain/redact/transfer/delete decision, not an automatic legal hold and not evidence that erasure completed. Keep restrictive behavior until a reviewed executor and replacement visibility anchor exist. Do not solve a failing purge by silently cascading history or clearing the only visibility anchor.

User deactivation can preserve a row while ending access. It does not erase that user's owner/member/request/history references. A project closure or archive likewise does not erase project content. Tests must distinguish all four operations.

## Store and writer register

| Proposed store | Subject and duplicate surfaces | Initial lifecycle disposition |
| --- | --- | --- |
| `agency_projects` | Canonical linked person and organization; client data written into title; owner and creator/recorder relationships. Owner alone does not make all project content that user's subject data. Multiple authoritative links must remain separate. | Purpose-specific candidate discovery and reviewed safe projection required. No full-row archive or owner-wide erasure. Shared production content can require a retained or redacted outcome. |
| `agency_project_members` | The internal member, grantor if retained, project/client relationship and access history. Read/edit/coordinate grants are separate from privacy authority. | Membership revocation and subject-data erasure need separate actions. A staff removal must not delete the client's project. |
| `agency_project_requests` | Actor, project, intent/correlation identifiers, input digest and committed result revision. The digest is derived potentially personal data, not anonymous evidence. | Minimal idempotency receipt with explicit retention purpose. Expiring it must not permit an old logical request to execute again. A bounded tombstone design and replay policy require review before cleanup is enabled. |
| `agency_project_history` | Recorder, title/reason content if present, client/project references, past lifecycle and revision metadata. Free-form reasons can contain personal or third-party data even when bounded. | Separate minimal immutable transition facts from any redactable sensitive payload. Indefinitely immutable raw reasons cannot be assumed compatible with erasure. Explicit retained exceptions, key/evidence expiry and audit access are required. |

Register create, transition, ownership transfer, member/grant mutation, request replay/recovery, history insertion and any future repair/import writer separately. Include audit events, change logs, outbox/notification payloads, search/index/cache copies, realtime envelopes, export projections and backup copies when introduced. A minimal routine audit event must not duplicate title, reason, raw input or request body.

For the initial registry entry, mark discovery/disclosure/erasure/restriction/retention capabilities unsupported or review-required until each actual adapter exists and passes the relevant tests. The current registry can fail closed for new tables/writers; a literal classification is an inventory decision, not enablement. A proposed table in another worktree is not yet part of this privacy branch's 93-table migrated catalog.

## Hashes, tombstones and history

Specify canonical request serialization, format version and semantic input fields before using SHA-256 for conflict detection. Include actor/operation/intent domain binding and preserve field distinctions; exclude transport noise. A low-entropy title or reason can be guessed from an unkeyed digest. Keep digests private; consider a domain-separated keyed replay fingerprint if canonical content is sensitive, with an explicit rotation/replay strategy. Never return a stored digest as an existence oracle.

A minimal tombstone can retain the logical-key binding and a non-replayable terminal outcome under an approved purpose/expiry. It must not retain erased free text or resurrect a deleted project. Recovery must recheck current actor and parent visibility, including after a receipt has become a tombstone. Specify how the same key with changed input behaves after payload removal, and test it rather than assuming the original full comparison remains possible.

Physical immutability must distinguish event identity/revision/correlation facts from sensitive content. If a history reason is required, keep it in an explicitly protected payload with a reviewed redaction/expiry path. An encryption key shared with live records cannot be destroyed solely to erase one history entry. No retention period or legal exception is approved by this technical review.

## Authority and concurrent writers

The proposed project authority must remain native project authority intersected with every authoritative CRM parent. `withPrivacyAuthority` authorizes a privacy case operation; it cannot authorize a project create/update or serve as a restriction fence. No general project writer, restriction or erasure fence is implemented by the current privacy source.

Revision CAS gives one winner for edits to the same project. It does not fence a concurrently revoked member, changed permission set, deactivated actor, hidden/deleted parent or newly imposed privacy restriction. The command needs a reviewed transaction lock/generation contract covering those dependencies in the owning source. Auth identity locks alone do not cover them. Until that contract exists, do not claim revocation-through-commit or restriction enforcement.

The required SQL allocation and clean/upgrade tests remain separate. Current platform/MAIL reservations must be respected; no number is assigned by this review.

## Required evidence before enabling the delta

- Real PostgreSQL tests for soft-deleted parents, physical FK failures, explicit retained dependencies and non-probing errors.
- Simultaneous parent deletion/visibility change, actor deactivation, member revocation and permission changes at the final mutation boundary, with a documented lock order.
- Actor/owner/client-separated discovery fixtures; safe title/reason projections; unrelated party and secret sentinels excluded.
- Idempotency replay after project deletion, receipt expiry, tombstoning and key rotation; changed payload never silently re-executes an old intent.
- History redaction/retention behavior and minimal audit sentinel scans, including rollback and restore behavior.
- Catalog/writer inventory reconciliation only after actual adopted source exists, with unsupported capabilities still visible.

These are technical design conditions, not acceptance of all Agency tasks or Privacy DPL-01 through DPL-36. This review has not been sent to another chat; the sending tool requires direct human authorization beyond the earlier one-handoff approval.

## 1 November supplement: Agency ba2aeb0

The committed `project-core-delta.md` at Agency `ba2aeb0` now identifies both independent coverage gates against Privacy `65a579e`: the source/writer registry and the actual PostgreSQL catalog versus `DISCOVERY_COVERAGE`. Its proposed initial `unsupported`/`candidate_links_only` dispositions for all four stores are appropriate for the unavailable readers. They are classification proposals, not accepted discovery or lifecycle support.

The required owner patch, on an actual combined source candidate, is concrete:

1. Add four explicit unsupported declarations in `discoveryCoverage.ts` with a reason naming the unavailable agency reader and the source owner. Keep `complete:false` and visible blockers. No entry belongs in `DISCOVERY_ADAPTER_TABLES` or `discoveryAdapters` until a real reviewed candidate reader exists.
2. Classify the adopted physical tables, exact create/transition/member/request/history writers, source digests and any projection/copy surfaces in the literal registry entries/IDs. Keep every generic lifecycle operation unsupported. Merely naming a table in documentation or automatically accepting discovered IDs is insufficient.
3. Exercise the accepted combined migrations and catalog tests: an omitted new table must fail closed, declared unsupported tables must remain visible blockers, and existing candidate readers must still apply their own current proof/authority checks. Candidate links never establish an approved export scope.
4. Before deciding immutable-history DDL, specify the protected, redactable reason payload separately from minimal immutable transition facts. Plaintext free-form reasons plus permanently immutable rows would leave the requested erasure/retention path undefined. Preserve explicit historical subject/link provenance without copying CRM bodies into routine audit.
5. Treat intent hashes and tombstones as protected derived data with an explicit purpose and replay/expiry strategy. A raw SHA-256 does not remove that classification. No retention period, automatic purge or legal exception is approved here.

Restrictive FKs remain technically compatible with the current soft-delete commands, but they do not enforce soft-delete visibility. Physical deletion still needs a reviewed dependency outcome and cannot be reported complete when a reference blocks it. The proposed source document correctly retains the general writer/restriction fence, shared native-authority race, migration-allocation and full installation gates. No production or peer source was changed by this supplement.
