# Current main reconciliation gate

Read-only source observation, 1 November 2026. Sales remains on its own candidate;
this is no adoption, allocation, installation or release qualification.

GitHub main is `a0490c16a9954d9a03c3bb22bfb69944db433a77`, merging privacy
source `65a579eec99755b587f33b97445374093d91e4ff`. Sales source/documentation
`1377e10` retains the selected b8 history: 85 journal entries ending at 0084.
Main has 86 entries ending at 0085. The later local committed MAIL candidate
`a66003916ac7c96ec69e884d4601044052b02b40` has 92 entries ending at 0091.

| Slot | Main a0490c1                            | Sales/platform history                                                       |
| ---- | --------------------------------------- | ---------------------------------------------------------------------------- |
| 0083 | privacy_foundations, 1793457595775      | integration_connections, 1793443475394                                       |
| 0084 | privacy_policy_deadlines, 1793458105911 | visual_workflows, 1793452709228                                              |
| 0085 | privacy_identity, 1793458528968         | Not present in Sales; reserved/implemented as MAIL in the combined candidate |

The read-only lineage CLI returns the intended exit 1: Sales/main and main/MAIL
share 83 entries, then diverge at index 83 in tag, timestamp and SQL hash.
MAIL extends all 85 Sales entries. Source review also found all 162 historical
SQL/snapshot blobs through 0082 unchanged. No actual applied installation ledger
was inspected. See `evidence/current-main-source-lineage-2026-11-01.json`.

The committed allocator ledger at preview source `d2257ceb368b36ae45cd5d05d9569f252ae4512c`
still reserves 0083 for platform, 0084 for workflows and 0085 through 0093 for
MAIL. It explicitly leaves 0094 unreserved and unallocated. Those reservations
predate main's committed privacy tail; they do not resolve the collision or grant
Sales a number. Earlier reviewed MAIL cuts `571ba2c` and `bea49e7` stop at 0090
and do not qualify a660039's 0091 or privacy reconciliation.

The integration allocator and privacy/MAIL owners need an immutable reconciled
cut against current main, Sales/platform history and the selected MAIL source.
Preserve retained applied identities and data. Do not resolve this by renaming
applied SQL, reusing timestamps, replacing snapshots or copying dirty peer work.
The cut needs independent SQL/snapshot/journal review, clean installation,
applicable retained upgrades, repeat-run behavior, data/authority preservation,
SQL guards and dump/fresh restore, followed by exact-candidate application checks.

Sales technical coordination authorization remains pending in this chat. Do not
infer it from resource-only coordination or a goal continuation. The earlier
storage request remains available; this note adds the newly verified source
constraint without changing that reviewed request or claiming shared interfaces.

The queue's scoped PostgreSQL evidence used the explicitly selected synthetic
85-entry Sales history. It remains valid for that source boundary, and proves no
upgrade from current main. No merge, migration, service or database command ran
during this inventory. Current source work and finite independently granted
checks can continue while the reconciliation gate remains open.
