# Saved-view definition compatibility

SP-03.1 candidate implementation: compatible decoding and stored-view read/recovery gating.
The current application-source checkpoint is `c655b8e3aa0d9aada5ac3c533bef13688b8ec700`.
Source, unit/component/cache checks, isolated PostgreSQL routes and the declared synthetic native
journey establish the evidence below. Retained-installation migration, full revocation/export
coverage, human native-language review, pilot acceptance and production operation remain separate
gates. [Checkpoint verification](verification.md) records the full run and earlier failures.

## Observed contracts and callers

- `src/db/schema/savedFilters.ts` stores a JSONB definition, default `{}`, alongside target entity,
  owner, sharing and favorite columns. The definition itself is not an access grant.
- `src/features/saved-filters/schemas.ts` defines entity-specific validators for deal, person,
  organization and lead. Historic deal filters can omit conditions; all supported definitions
  default an omitted combinator to AND. Deal-only `rotting` and legacy `sort` retain their meaning.
- `scripts/seed-demo-collab.ts` authors a bare owner/status definition and a `{ rotting: true }`
  definition. Existing source tests cover person email, organization industry, lead source,
  OR conditions, date presets, numeric strings, labels and valueless operators.
- `src/features/saved-filters/parseDefinition.ts` currently collapses malformed definitions into an
  empty filter. Previously `src/features/saved-filters/router.ts` used its entity-aware parser
  through `savedFilterList.ts`; `src/features/deals/dealRouter.ts` used the deal parser. An invalid saved
  filter previously became an unfiltered query within the viewer's existing record ceiling. Both
  stored-read routes now use `listCompatibleSavedFilterViews` and `storedViewDefinition` instead.
- `savedFilterActions.ts` validates new and updated bare definitions against the row's target
  entity. Board, deal-list and other entity-list clients consume the parsed definition. No automatic
  persistence rewrite is performed by compatibility reads. Existing create/update services still
  author bare definitions; V1 encoding is available but is not silently enabled for writes.

This is a source inventory, not an assertion that all installed definitions match these examples.
An authorized, bounded inventory of retained rows is still needed before enabling compatibility
changes. Unknown historic keys must be examined instead of rewritten or discarded.

## Adapter contract

`viewDefinitionVersion.ts` exports `decodeSavedViewDefinition(targetEntity, raw)` and
`encodeSavedViewDefinition(targetEntity, raw)`. Both return `Result` values and do no I/O.

A successful decode identifies `source: "legacy" | "v1"` and returns this V1 envelope:

```json
{
  "version": 1,
  "targetEntity": "deal",
  "definition": {
    "combinator": "and",
    "conditions": [],
    "rotting": true,
    "sort": { "field": "value", "dir": "desc" }
  }
}
```

The caller supplies the actual row entity. A conflicting envelope entity fails. Definitions use
that entity's existing Zod schema, including operator/field pairing and value validation. Missing
legacy defaults remain the existing defaults, not new query behavior. Encode creates an envelope
explicitly; it neither saves a row nor changes a shared view's permissions.

Malformed data returns `kind: "invalid"`; unknown versions, fields, operators or keys return
`kind: "unsupported"`. Every failure retains `raw` and gives `recovery: "retain-original"` plus
structured paths. It returns no executable definition and no empty-filter fallback. Paths contain
keys/indices, not authored values. Keep raw failure payloads in an authorized recovery boundary;
do not log or expose them to another viewer merely because this function returned them.

Top-level and nested unknown keys fail rather than being silently stripped by Zod. This deliberately
includes unknown metadata: the adapter cannot assume a key is nonsemantic. Existing custom-field
filters remain unsupported until a permission-aware dynamic field resolver is integrated. Numeric
strings, Persian/German text, label names, concrete owner IDs, dates and relative-date keys remain
as authored. The adapter has no locale, currency, calendar, timezone, membership or auth dependency.
It does not mutate caller data or translate stored values.

## Presentation version boundary

An optional, separately versioned `presentation: { "version": 1 }` reserves presentation evolution.
Nonempty columns/sort data and other presentation versions currently return
`unsupported-presentation`. No arbitrary column support is implied. Future columns and presentation
sort need actual entity column registries, per-viewer field visibility, stable keys, persistence and
conflict handling. Existing deal `definition.sort` continues through its established validator;
there is no parallel active sort interpretation in this increment.

Sharing, membership and interface locale are intentionally outside the envelope. Decoding a shared
view never executes it with its author's authority. A successful decode does not establish access
to the filter fields or contributing records; current viewer permission checks remain mandatory.

## Stored read and recovery integration

Stored-read responses retain every authorized row's ID, authored name, ownership, favorites and
sharing metadata. Valid rows retain their existing definition and add `availability: "available"`.
Unsupported/malformed rows carry `availability: "unavailable"`, `definition: null` and a safe
`problem: { kind, code }`. Raw unsupported values remain unchanged in JSONB and are not copied into
browser error metadata. A matching legacy type without an availability marker remains accepted.

The shared picker retains unavailable selections and revalidates fresh metadata. Missing, revoked
or explicitly deleted active selections remain unavailable until the user clears or replaces them.
No automatic selection-to-null path turns those states into an all-records query. Confirmed user
deletion remains the existing explicit delete operation; compatibility reads never delete a row.
Recovery copy distinguishes missing/deleted views from malformed definitions that remain stored.

Board/list server loaders skip record and total reads when the restored selection is unavailable.
Client query admission and rendering also close: no cached cards/rows, counts, monetary totals,
ordinary empty state or bulk record controls are presented as results of that unavailable view.
Checking and persistent query-error/retry states are distinct from an empty result.

The board retains its load-bearing pipeline cache key for existing optimistic/realtime machinery.
Query responses carry an internal filter-scope receipt; mismatched cache data is hidden until the
current query resolves. Optimistic cache helpers preserve that receipt. Filtered realtime movement
invalidates through the existing server query rather than patching across filter semantics. Deal
lists similarly refuse previous-query placeholder rows while a narrower replacement is loading.
Board/list requests pass query cancellation signals to the existing tRPC transport.

People, organizations and leads use the same availability union. Their parent selection/paging
integration is owned by the adjacent entity-list slice, including cached rows/counts/reference
labels, in-flight invalidation and lead export admission. Their combined unit run is recorded
below. That does not establish every cross-entity browser, export or revocation scenario.

FA/DE/EN recovery messages live in `messages/viewCompatibility.*.json`; record names use bidi
isolation and remain authored text. Component tests do not establish native-language usability,
screen-reader acceptance or real-device qualification.

## Current local evidence and failure history

The exact checkpoint's final full unit run passed 6020 tests across 966 files. The affected
PostgreSQL batch passed 239 tests across 50 files. Those totals cover the combined candidate;
they are not counts of newly authored saved-view tests. Typecheck and full lint passed, with
11 warnings and 9 informational notes retained. The optimized web build and worker/WS/operator
bundles also passed; no production service was started or deployed by those build checks.

The native Farsi journey selected a synthetic unsupported version-99 view. Cards and monetary
totals stayed blocked, the selection remained blocked after hard reload, and explicit recovery
showed 29 permitted open cards. The raw JSONB definition was unchanged. Evidence:
[journey record](evidence/r1-lifecycle/native-journey.json) and
[blocked-view capture](evidence/r1-lifecycle/unavailable-view-fa.png).

The initial document's RSC bootstrap had already delivered permitted data before the view switch.
The native observation does not retract those bytes or prove every cache/export surface; the
blocked hard reload separately omitted the initial card/amount payload. This is a synthetic local
Farsi flow, not human contextual-language/accessibility review or complete FA/DE/EN acceptance.

A quiesced synthetic database dump/restore on this checkpoint reconciled counts and ordered row
digests for all 103 `public`, `drizzle` and `pgboss` tables, 1885 rows in total. See the
[restore manifest](evidence/r1-lifecycle/restore.json). This includes stored saved filters and
preferences, but does not establish object-byte restoration, a divergent legacy upgrade,
in-flight queue/external-delivery recovery, RTO/RPO targets or older-binary rollback.

The first slice-wide attempt failed: 3 files, 5 tests and one unhandled render error. Its board
wrapper could turn an absent RPC result into a successful-looking scope receipt without cards;
that defect was fixed so the query-error/retry path remains usable. Date-refetch assertions were
updated to verify cancellation options and the unchanged shared cache key, and the empty-state
test now waits for a completed response instead of treating a transient checking status as empty.
The original filter/date/empty semantics assertions were retained. The later 966-file rerun passed;
see [verification history](verification.md#earlier-unsuccessful-slice-wide-attempt).

## Remaining gates

1. Inventory real retained definitions, unknown keys and entities without destructive rewrites.
2. Qualify versioned writes and old-client compatibility explicitly. This increment reads V1 but
   does not change existing write format or silently reinterpret presentation columns/sort.
3. Exercise permission changes, field loss, server-side export/search/cache/realtime surfaces and
   shared-view contributing records under each executing viewer's current authority. Decoding
   and sharing definitions never grant record access.
4. Extend the observed Farsi recovery journey to complete FA/DE/EN review, unsaved edits, locale
   switches, narrow/theme layouts, keyboard and screen-reader behavior on the exact candidate.
5. Extend the synthetic restore proof to the supported retained installation shapes, object files,
   interruption/queue/unknown-effect recovery and a measured pilot before broader SP-03 acceptance.

Focused verification:

```sh
bun run test:unit src/features/saved-filters/viewDefinitionVersion.test.ts src/features/saved-filters/storedViewDefinition.test.ts --maxWorkers=2
bun run test:integration src/features/saved-filters/router.compatibility.test.ts src/features/saved-filters/router.test.ts --maxWorkers=1
```
