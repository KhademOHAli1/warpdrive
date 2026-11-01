# Main and Agency migration lineage audit

1 November2026. Source audit only; no migration, database, source merge or install was run. Frozen fork main is `a0490c16a9954d9a03c3bb22bfb69944db433a77`, with parents `a1a8f6da1ce366c35002900bf33508356dfbb995` and Privacy `65a579eec99755b587f33b97445374093d91e4ff`. Its tree equals that Privacy checkpoint. Frozen Agency is `8564cd72a4eb95a0b6f5320b7c667460bd7d6f0d`; common ancestor is `a1a8f6d`.

All162 common historical Drizzle files and journal prefix through0082 match byte-for-byte. Common0082 snapshot ID is `168c84d2-83f8-4fe7-a5a0-99b5060dc9d7`, SHA256 `3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a`. Its82 common table definitions are unchanged on both sides.

| Lineage | Journal tail | when | Snapshot tables |
| --- | --- | ---: | ---: |
| Agency | 0083_integration_connections | 1793443475394 | 85 |
| Agency | 0084_visual_workflows | 1793452709228 | 89 |
| Main | 0083_privacy_foundations | 1793457595775 | 87 |
| Main | 0084_privacy_policy_deadlines | 1793458105911 | 92 |
| Main | 0085_privacy_identity | 1793458528968 | 93 |

The seven Agency Integration/WF additions and eleven Privacy additions have disjoint schema keys. A100-table pre-MAIL union is hypothetical metadata, not a qualified database. Snapshot IDs/prevId chains differ. The installed Drizzle migration implementation at `node_modules/drizzle-orm/pg-core/dialect.js` selects each migration against the latest ledger `created_at` and its journal time; it does not validate source branch tags/hashes for admission. Against an existing Privacy0085 cutoff, older Platform/WF entries may be skipped. Selecting main metadata on an installed Platform0084 can select the later Privacy SQL while dropping Platform/WF declarations from source metadata. Neither side alone represents the combined system.

Preserve actual SQL-only guards as well as snapshot definitions: Workflow pinned-version FK/immutability, Privacy receipt/event, activated-policy and deadline protections. Fresh/rerun plus both historical installed-lineage upgrades and restore need actual accepted sources/ledger evidence and realPostgreSQL. Peer private applied ledgers were not queried or changed. No applied history was renamed, and no DDL, journal or snapshot was generated/reconciled.

Main's Privacy0085 overlaps the allocator's inspected MAIL0085..0093 reservation.0094 remains unallocated. The PR merge does not settle canonical lineage, reservation or Agency allocation. Platform/MAIL/Privacy owners must resolve those decisions before a supported combined migration campaign. No Agency migration is requested or inferred by this audit.

Main's Privacy physical discovery coverage also lacks all seven existing Integration/WF tables. Their presence in a future combined database would trigger `unclassified_store` until reviewed declarations exist. The narrow proposed `owner-review/privacy-platform-coverage-review.patch` adds only unsupported/candidate_links_only declarations for those existing tables, preserving visible blockers/complete:false. No reader/adapters, lifecycle grants or future Agency tables are added. Exact source/writer registry and digest review remains separate. The patch is review-only and was not applied.

Nonmigration merges appear structurally additive: retain `@xyflow/react` and Sales scripts while adding tar-stream dependencies through Bun1.4.4; keep Integration/WF/Pipeline error IDs and schema exports while adding Privacy. The package/lock, registry and schema-index source still need a real guarded merge. Settings/Sales/Platform cuts are preserved in Agency; main/Privacy are not adopted by this audit.

`main-lineage-audit-20261101.json` retains exact journal tails, table keys, source hashes and common file paths. This evidence changes the next action to owner-reviewed lineage reconciliation; source comparison is not upgrade acceptance.
