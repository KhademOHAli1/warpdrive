# Local integration migration reservations

Allocator for this local preview lineage: the integration-platform owner. Updated
1 November 2026. This ledger records local source reservations, not global published
numbering, applied migration state or acceptance. Recheck the live source,
candidate, peer ownership and this ledger before every new allocation. Do not allocate by
looking only at the latest migration in a peer's installed database.

## Published-main conflict, execution hold

Fork `main` was verified at `a0490c16a9954d9a03c3bb22bfb69944db433a77`, whose tree
matches Privacy `65a579eec99755b587f33b97445374093d91e4ff`. Its Privacy 83/84/85
are different from this preview's Integration 83/Workflow 84 and MAIL mappings below.
Only the SQL/snapshot/journal prefix through 82 matches byte-for-byte. The local table
below therefore allocates no published-main slot. Local 94 remains unallocated.

The installed Drizzle 0.45.4 migrator admits SQL using the highest stored `created_at`,
not migration numbers, tags or hash equality. Committed MAIL 91's timestamp
`1793504444945` is later than Privacy 85's `1793458528968`; merely appending or renaming
files skips missing domains on at least one historical route. Never rewrite applied
hashes/times, synthesize historical rows, or replay existing-schema backfills to bridge
this conflict. The prior local timestamp guidance below is historical lineage guidance,
not authorization to retimestamp a published or installed migration.

A work-only admission proposal retains published Privacy 0..85 and defines candidate
append guards for exact known histories. It has no accepted combined application commit,
new SQL hashes or measured physical fingerprints and cannot execute. Maintainer and
Platform/Workflow/Privacy/MAIL owners must resolve the source cut, supported routes,
numbering and Privacy store coverage before implementation. Fresh installation, every
supported upgrade, no-op reruns, functional SQL guards, data preservation and restore
drills require actual disposable PostgreSQL qualification. No DDL, ledger edit or source
adoption follows from this warning.

## Local preview reservations

| Local integrated slots | Owner                    | Status and purpose                                                                                                                         |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0000 through 0082      | Historical common source | Immutable SQL, snapshots and journal entries.                                                                                              |
| 0083                   | Platform                 | Existing integration connections, immutable.                                                                                               |
| 0084                   | Platform/workflows       | Existing integrated workflow schema and SQL safeguards, immutable.                                                                         |
| 0085 through 0090      | MAIL                     | Reserved mapping of MAIL local 0083 through 0088; combined source/metadata review pending.                                                 |
| 0091                   | MAIL                     | Reserved locator sourceFingerprint extension, separate combined candidate only.                                                            |
| 0092                   | MAIL                     | Reserved additive delivery-observation table for account-scoped structured DSN/bounce evidence; design/source/DDL/qualification pending.   |
| 0093                   | MAIL                     | Reserved additive notification-purpose/account binding uniqueness and durable suppression marker; design/source/DDL/qualification pending. |

Within this local lineage, no other writer may use 0085 through 0093. Its next
unreserved number is 0094, which remains unallocated and grants no global slot. Request a reservation from the allocator before generating
new shared/SMS/provider DDL. Preserve disjoint deltas; stop on common-key conflicts.

The unadopted local combined MAIL candidate maps its original MAIL deltas above
platform 0084 (`1793452709228`), preserving this preview's SQL/snapshots/journal through 84.
That local candidate metadata addressed one timestamp cutoff only. It is not a route from
published Privacy 85 or already installed MAIL 91, and grants no permission to change their
history. New snapshot IDs or larger numbers alone do not repair a divergent installed
ledger. The published-main execution hold above supersedes any inferred adoption permission
from this historical candidate guidance.

The 0092 reservation does not approve a parser or schema. Generic delivery-status reports
are untrusted observations. Accepted, partial and unknown submission outcomes remain
unchanged; reports never trigger automatic resend, suppression or workflows. MAIL owns
source/outbound visibility and any explicit owner-reviewed association. Do not attach a
report to private outbound content through an untrusted Message-ID alone. Actual review
and migration/data/authorization tests remain required before adoption.

The 0093 reservation likewise accepts no schema yet. Use the existing notification queue;
bind a trusted notification purpose to one account atomically so concurrent first jobs cannot
select different accounts. Keep immutable prepared business payloads unchanged. Final send
admission and recovery must retain native account/generation fences, current visibility,
recipient policy and opt-out checks. Suppression never clears accepted/partial/unknown holds
or turns a known accepted submission into an automatic retry.

The originally inspected MAIL domain cut used its independent local 0083 through 0088
sequence. The current committed MAIL candidate must be re-inventoried at its exact cut,
including the later 91 cutoff discussed above. These local reservations change no running
preview or installed ledger and grant no live-provider action.
