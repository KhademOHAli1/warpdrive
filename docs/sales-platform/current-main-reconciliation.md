# Current main reconciliation gate

Read-only source observation, 1 November 2026. Sales remains on its own candidate;
this is no adoption, allocation, installation or release qualification.

The earlier verified GitHub main observation was `a0490c16a9954d9a03c3bb22bfb69944db433a77`, merging privacy
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
SQL/snapshot blobs through 0082 unchanged. No retained-installation applied ledger
was inspected in this source inventory. Earlier synthetic Sales fixture evidence
does not establish an upgrade from main. See
`evidence/current-main-source-lineage-2026-11-01.json`.

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

## Local committed-owner refresh, 1 November 2026

The later [committed-owner observation](evidence/committed-owner-source-refresh-2026-11-01.json) rechecks only the already known local owner repositories and refs. It does not replace the earlier source-bound observations or verify current GitHub main.

Privacy HEAD is 7e747e9 with 86 journal entries and unchanged committed Drizzle history from a0490c1. Original MAIL/regional is 56210f3 with 89 entries. Combined MAIL is 70bc46b with 94 entries, adding 0092 delivery observations and 0093 notification send admission beyond the prior a660 cut; it still extends the selected 85-entry Sales chain. Preview is 12dd62c with the unchanged 85-entry selected history. All 162 inspected historical SQL/snapshot blobs through 0082 are identical. The conflicting histories at index 83 remain unreconciled; these source observations allocate no migration number and qualify no retained upgrade.

Two newer committed owner surfaces must be preserved in a future immutable integration cut: privacy d86e3f7 changes auth/settings UI and localized copy; preview 7c8bb7 changes language/digit preferences and date pickers. Three inspected auth UI blobs and five regional/date production blobs differ from Sales. Neither surface is adopted by this observation. Source dependencies, authority and exact combined checks remain required.

Developer repositories still cache origin/main at a0490c1. Preview's 01dd1dd tracking ref is older (30 October, 77 journal entries), so its different hash is not evidence of a newer main cut. No fetch or remote-main query ran. Current allocator state, dirt and retained installations remain separate evidence gates.

## Isolated regional source candidate

A later source preflight found the sole common ancestor 6b71b77, 376 Sales-changed paths and 93 preview-changed paths, with no changed-path overlap. Dependencies and the entire Drizzle tree are identical. Preview's package manifest is unchanged from that ancestor; only Sales adds its two programme-check scripts.

The exact owner source 7c8bb7e was imported locally and normal-merged with Sales 5de8a12 in the isolated branch `codex/sales-regional-source-integration-20261101`, producing `a011879324c5a636aef04506b4dc8db233184ae5`. All 376 Sales-changed blobs/deletions and all 93 owner-changed blobs/deletions were preserved exactly. Sales package scripts, Bun lock, the entire 85-entry Drizzle tree and approved originals were unchanged. The primary Sales branch remains 5de8a12 and has not adopted this candidate. See [the source-convergence record](evidence/regional-source-convergence-2026-11-01.json).

This preserves the complete 7c8bb7e owner source cut, including the other 80 actor-freshness/provider/fixture/documentation paths alongside the 13 regional paths. Later committed owner records report selected 149/21, full unit 6040/963, types/lint/build/workers and native MFA/regional evidence for 7c8bb7e. These are owner-recorded results; raw exports were not independently rechecked and none qualifies the new combined Sales source. Combined units, authority/provider PostgreSQL, full types/lint and separate build/browser checks remain required. Privacy auth/settings d86e3f7 and conflicting migration histories remain held separately.

## Isolated auth UI subset

Source dependency review found nine separable paths in privacy owner commit d86e3f7: three auth UI components, three auth message files, two tests and their fixture. All nine preimages match a011879 and their direct local dependencies are compatible. An exact path patch, without a privacy merge, produced candidate `0443c04f97f57b451facfc342df9804e912af7b7`. Every selected postimage equals d86e3f7; all other 4,158 base blobs remain unchanged. Package, lock, all 167 Drizzle paths and eight approved original documents are preserved. See [the auth source record](evidence/auth-ui-source-convergence-2026-11-01.json).

The subset adds optional new-tab provider confirmation through the existing security route and existing replay/autocapture exclusions on security surfaces and dialog portals. It changes no auth API or server authority. Privacy navigation, route, service graph, catalog registration and conflicting migrations are excluded because the selected Sales storage does not support them.

This is source preservation only. Primary Sales remains at 5de8a12, no dependency link was added, and no combined checks have run. The two new test files describe 14 unexecuted cases. A test-only a011 baseline must establish real assertion RED, followed by candidate GREEN, affected regional/auth/telemetry regressions, full combined types/lint and separate build/native journeys before adoption. Collection failures and startup timeouts count as zero behavioral evidence.
