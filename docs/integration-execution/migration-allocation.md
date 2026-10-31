# Integrated migration allocation

Allocator: the integration-platform owner. Updated 31 October 2026. This ledger records
source reservations, not applied migration state or acceptance. Recheck the live source,
candidate, peer ownership and this ledger before every new allocation. Do not allocate by
looking only at the latest migration in a peer's installed database.

| Integrated slots | Owner | Status and purpose |
| --- | --- | --- |
| 0000 through 0082 | Historical common source | Immutable SQL, snapshots and journal entries. |
| 0083 | Platform | Existing integration connections, immutable. |
| 0084 | Platform/workflows | Existing integrated workflow schema and SQL safeguards, immutable. |
| 0085 through 0090 | MAIL | Reserved mapping of MAIL local 0083 through 0088; combined source/metadata review pending. |
| 0091 | MAIL | Reserved locator sourceFingerprint extension, separate combined candidate only. |
| 0092 | MAIL | Reserved additive delivery-observation table for account-scoped structured DSN/bounce evidence; design/source/DDL/qualification pending. |
| 0093 | MAIL | Reserved additive notification-purpose/account binding uniqueness and durable suppression marker; design/source/DDL/qualification pending. |

No other writer may use 0085 through 0093. The next unreserved number is 0094, but this
sentence does not allocate it. Request a reservation from the allocator before generating
new shared/SMS/provider DDL. Preserve disjoint deltas; stop on common-key conflicts.

For integrated MAIL entries, use fresh strictly increasing journal `when` values above
platform 0084 (`1793452709228`). Preserve platform SQL, snapshots and journal entries
through 0084 byte-for-byte. Old local MAIL timestamps all predate that boundary and would
be skipped by the installed Drizzle migrator. Use fresh snapshot IDs/prevId links and verify
both clean installation and actual platform-0084 upgrade. Never rewrite installed peer
ledgers or relabel their divergent history as an integrated upgrade.

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

The MAIL owner's current preview uses its independent local 0083 through 0088 sequence.
This allocation changes neither running preview and grants no live-provider action.
