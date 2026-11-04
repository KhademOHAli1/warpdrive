# Typed workflow values — WF020 / #677

This document describes the finite WF020 source increment. Full hosted source
qualification is pending; current evidence is maintained on issue #677. It does not record native acceptance, main
integration, release or deployment. WF019 remains the formal prerequisite.

## Choose an upstream value

The value picker lists supported outputs from the selected step's connected
predecessors. Each choice identifies the source step, field and value type. A
branch sibling, the current step, a downstream step or a disconnected step cannot
supply a value. Ambiguous or malformed paths are unavailable.

Renaming a source changes its display label while preserving the binding's stable
node ID and field path. Deleting a source, disconnecting it or changing its output
contract leaves the authored binding visible for repair. It does not select a new
source automatically. Undo can restore availability without rewriting the binding.
A supported step with incomplete settings shows a configuration-required hint; its
declared output type does not establish that an actual value has executed.
Readonly and denied views cannot commit a selection.

The picker derives compatibility from the actual target setting and current
configuration metadata. It does not treat a field label, a cached choice or a
matching-looking string as authority. Nullable sources show a possible-empty
warning; the actual value must still satisfy the target before an effect occurs.

## Preview and literal input

Literal previews show the value authored in the current draft. Empty text, zero,
false, explicit null, omission and invalid input remain distinguishable.

Reference previews show a clearly labeled synthetic type/format example and source
metadata. They do not fetch or reveal an actual CRM value or historical run output.
The example never enters a binding, saved draft, publication or runtime payload.
Real record-value preview would require a separate current-rights and provenance
design; this source slice does not supply it.

Numbers stay native finite numbers when input is complete. An incomplete numeric
edit such as an empty string, a sign or a trailing decimal retains the exact input
and numeric intent as an invalid draft. It does not become text, zero or the last
valid value. Locale digit handling occurs at the input boundary; stored exact
decimal CRM values are not converted through that parser.

Date and instant literal modes are explicit. A date is a valid Gregorian
`YYYY-MM-DD` civil date. An instant is a strict ISO date-time with an offset or `Z`.
A date-only value or bare wall time cannot become an instant by guessing a
timezone. Display preferences can format values without changing stored data.
Invalid or empty date/instant input retains its mode for repair and draft copying.

## Finite output types

| Output                                             | Meaning                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Manual `recordId`, deal read `id`                  | Deal identity.                                                                    |
| Deal read `title`, `status`, `currency`, `stageId` | Existing text or opaque code.                                                     |
| Deal read `ownerId`                                | User identity; current active-user checks still apply before a custom user write. |
| Deal read `value`                                  | Exact-decimal string or null; never an implicit native number.                    |
| Deal read `expectedCloseDate`                      | Canonical civil date or null, projected by a new actual read.                     |
| Created task `id`                                  | Activity identity.                                                                |
| Condition `result`                                 | Boolean.                                                                          |
| Completed wait `resumeAt`                          | Instant; a still-waiting step has no completed output.                            |

No person, organization, custom CRM field, option, address or range output is
invented from a database column or a nominal schema. Unsupported handlers remain
unavailable. Generic strings are not date/time references; dates, instants, wall
times, ranges, entity identities and option domains have distinct contracts.

## Execution and compatibility

Publication, new-run admission and actual steps validate the same source and target
contracts against the actual pinned graph. Task custom references also use the
fresh complete definitions prepared for the canonical activity writer. Current
original-actor and record/reference visibility checks remain required.

Missing output, explicit null and malformed actual output are separate outcomes.
Missing values cannot silently choose a false condition branch or a default task
value. An old completed deal-read receipt without `expectedCloseDate` stays missing;
it is not backfilled from today's CRM or replaced with null.

Generic text, native numbers, booleans and exact-decimal strings retain strict,
uncoerced equality. Exact-decimal string `contains` remains supported. Two typed
dates compare as civil dates; two typed instants compare on the timeline, including
equivalent offsets and fractional precision. Temporal `contains`, mixed temporal
kinds and generic strings pretending to be dates are incompatible.

The scalar wire adds optional `literalType: "number" | "date" | "instant"` on
literal bindings only. Existing reference bindings and minimal valid numeric
bindings keep their representation. Draft parsing/copying preserves known invalid
intent; executable parsing rejects it. Rich custom literals retain their existing
field-scoped representation and bounds.

Older strict workers may reject the new intent tag. Coordinated application/worker
release is a separate gate. The generic-string-to-date/time and temporal-contains
tightening can reject old pinned graphs before a later effect; historical JSON and
completed effects are retained without conversion or replay. Automatic retry
eligibility is not widened. Explicit scalar intent tags, references to the new
expected-close date output and custom-bearing tasks remain outside the older
failed-task retry profile until its separate recovery qualification.

## Privacy and acceptance boundary

Draft literals and pinned outputs may concern people other than the workflow owner
or runner. Ownership does not grant access to historical CRM payloads. Chips and
reference examples add no payload endpoint, provider, handler, queue, table or
metadata-management permission. Clearing a draft value, closing the picker or
hiding a denied view is not erasure from history, caches, canonical CRM or backups.

Source tests and hosted CI do not establish actual keyboard, assistive-technology,
RTL, theme, calendar/display or human preview acceptance. Issue #677 remains open
until its complete acceptance criterion and remaining delivery stages have evidence.
