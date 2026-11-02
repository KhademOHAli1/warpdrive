# Builtin saved-view presentation contract

Checked source: `03100336a1053155d282f4f8e016e509bdb7ec31`, locally adopted by
`7c10761647633a6d2c0f701f3a1426d58357ee96` on the task-owned Sales branch.
Both commits have the identical tree `4924b8a4a7ad4abad9b12db18c0aa7142656a93b`.
This records implemented source and bounded local evidence. SP-03 and deployment
acceptance remain open; no GitHub main merge, push or release follows from adoption.

## Stored definition and safe read boundary

People (`person`), organizations (`organization`) and leads (`lead`) accept the
existing bare entity-specific condition definition or an explicit V1 envelope:

```json
{
  "version": 1,
  "targetEntity": "person",
  "definition": { "combinator": "and", "conditions": [] },
  "presentation": {
    "version": 1,
    "columns": ["name", "email"],
    "sort": { "field": "primaryEmail", "dir": "asc" }
  }
}
```

The envelope target must match the actual row/write target. Full presentation
requires a unique, known column order with its pinned column first, plus one
allowlisted sort field and `asc`/`desc`. Column keys and server sort fields are
separate registries:

| Target       | Pinned; builtin columns                                                                   | Sort fields                                                                           |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| person       | `name`; `name`, `org`, `email`, `phone`, `closedDeals`                                    | `name`, `primaryEmail`                                                                |
| organization | `name`; `name`, `address`, `closedDeals`, `openDeals`, `peopleCount`                      | `name`                                                                                |
| lead         | `title`; `title`, `nextActivity`, `labels`, `sourceOrigin`, `value`, `createdAt`, `owner` | `title`, `nextActivityAt`, `label`, `sourceOrigin`, `value`, `createdAt`, `ownerName` |

Create and explicit definition updates validate the full entity-specific payload,
including nested keys, instead of stripping unsupported constraints. Metadata-only
updates leave the stored definition intact. Existing owner/share capability rules
remain the authority; sharing a definition grants no record or field access.

Compatibility reads never rewrite JSONB. Invalid definitions, unsupported versions,
fields, operators, presentation or keys become safe unavailable DTOs:
`definition: null` with a bounded problem kind/code. They never become an executable
empty filter. Original JSONB stays stored for authorized recovery; raw unsupported
values are not sent in browser error metadata. Available DTOs expose the validated
bare definition plus a full `presentation` sibling when present.

Legacy bare definitions, envelopes with absent presentation and the reserved
`presentation: {"version":1}` inherit the personal baseline. Reserved presentation
is omitted from the safe DTO; it does not mean empty columns or a second sort.
Existing Deal `definition.sort` is separate. Full Deal presentation writes are not
part of this contract; Deal writes retain their existing strict bare format.

## Capture and save admission

A successful builtin presentation capture permits a layout-only save, including
when applied conditions are empty/null. The dialog writes the explicit V1 envelope
and returns its bare definition plus safe presentation for immediate selection.
Without the optional capture, the prior conditions-only/bare-write behavior remains.

`unsupported-column`, `unsupported-sort` or `unsupported-scope` disables saving
with FA/DE/EN recovery guidance. Failure cannot downgrade the request to a weaker
conditions-only view, including if capture becomes unsupported while the dialog is
open. Unavailable/malformed active selections also block saving.

Search and quick-filter scope is not encoded in this envelope. Contact search draft,
applied search or settling debounce blocks capture. A Leads archived tab, owner,
label or next-activity quick filter also blocks capture. Selecting a named view
clears old contact search or resets Leads to Inbox with those quick filters cleared,
so unrelated transient scope is not silently carried into its execution.

## Native selected-view preference and initial reads

Three independent native UI preference keys store only `{version:1,savedViewId}`:
`peopleSavedViewSelection`, `orgsSavedViewSelection`, `leadsSavedViewSelection`.
The ID is UUID/null; no copied filter, layout, search, authority or owner identity is
stored in these selection values. Missing preference/null means personal mode.
Malformed stored selection becomes a blocked read sentinel rather than All records.

Server resolution uses only the current actor's already-visible own/shared views
for the intended entity. A missing/private/wrong-entity ID gets an unavailable
placeholder without an inaccessible lookup/name. People/organization routes resolve
this before initial rows/counts/ref-label reads and skip those reads when blocked;
People also skips its organization options. Leads receives the blocked seed and
keeps its client list/export/bulk admission closed. No fake ID is invented for a
malformed selection, and its picker does not claim All records is active.

The selection action validates CSRF, current native actor/session, strict target/ID
and visibility before writing only that actor's selection key. Pending/failure
status is visible. A persisted selection is a preference, not an access grant;
record queries still execute under the current viewer's existing visibility.

## Personal baseline, local detach and actor fence

Selecting a named view snapshots the current personal columns/sort and applies its
validated presentation, or the personal baseline for legacy/reserved presentation.
Personal persistence is disabled in view mode: queued debounce and pending unmount
flush are cancelled. Explicit Clear restores the baseline and personal mode; its
seed is not immediately re-saved. Subsequent personal edits persist normally.
Existing granularity remains: contacts persist columns, Leads persists columns/sort.

Editing an applied view locally detaches its selected ID and persists null while
keeping the current presentation/conditions as local work. It remains in view mode,
so temporary changes cannot overwrite the personal baseline. This differs from
explicit Clear. Detached local work is not a new durable saved-view definition.

Client preference writes are ordered for actor/entity and fence deferred sends and
status delivery against principal changes. Routes key list clients by native actor.
The optional expected-actor hint can only refuse a write for a changed principal;
it never supplies authentication or expands authority. These fences do not prove
current shared authorization after every database wait, nor cancel an already-sent
request. Durable creation intents, cross-tab/global ordering and final execution-time
revocation guarantees remain open.

## Existing Leads CSV path

The native export call continues to pass the current effective builtin column order,
sort, conditions and quick filters to the existing CSV route. A blocked view cannot
invoke it. The existing route independently checks the native session, `data.export`
and record visibility. This is reuse of the existing exporter, not a new asynchronous
export/download authority or complete adversarial URL qualification. Existing raw
amount/currency, ISO date and CSV escaping behavior is unchanged.

## Checked evidence and remaining limits

On checked source 03100336, **425 affected unit tests across 33 files** passed.
Full Next route type generation and TypeScript passed in 12.185 seconds. Actual
PostgreSQL 16 tests passed **18 cases across three files** in 5.101 seconds:
six envelope read/write cases, nine native preference cases and three strict-write
preservation cases. The disposable container returned to the original peer baseline.
The selected synthetic Sales history has 85 entries; the dependency lock and
migration journal were unchanged. This is not current-main or retained-installation
upgrade evidence.

Full-repository lint passed in 39.529 seconds, including i18n, Biome over 3697
files and typed ESLint, with 11 existing warnings and nine informational notices.
The preceding scoped lint's 18 errors and full typecheck's 44 diagnostics are
retained with their repairs. Behavioral RED receipts and the one corrected fixture
ambiguity are separately classified in the [source-bound record](evidence/saved-view-presentation-2026-11-01.json).

Native FA/DE/EN browser journeys for this source, production build, accessibility,
provider operation and release acceptance remain unqualified. The latest production
build-checked application is the earlier f006b5a5026449fd2bf792439b9149ba3517feb8.
The separate Deals global server sorting/paging path is not adopted by this change.

No Sales DDL/migration is introduced. The historical local fixture's 85-entry chain
is synthetic evidence; primary privacy migration history and retained-installation
lineages remain unreconciled. Custom-field presentation and dynamic field-permission
resolution, persisted search/quick-filter scope, broader execution-time shared
revocation, durable intents and complete export/workspace isolation remain open.
No provider, production deployment, human language/accessibility review or pilot
acceptance follows from the source/unit evidence.
