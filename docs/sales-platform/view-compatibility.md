# Saved-view definition compatibility

SP-03.1 candidate implementation: compatible decoding and stored-view read/recovery gating.
Source, focused component/cache checks and isolated PostgreSQL route tests establish the evidence
below. Retained-installation migration, full revocation/export coverage, native-language browser
review, pilot acceptance and production operation remain separate gates.

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
labels, in-flight invalidation and lead export admission. Validate both slices together before
accepting the complete cross-entity journey.

FA/DE/EN recovery messages live in `messages/viewCompatibility.*.json`; record names use bidi
isolation and remain authored text. Component tests do not establish native-language usability,
screen-reader acceptance or real-device qualification.

## Remaining gates

1. Inventory real retained definitions, unknown keys and entities without destructive rewrites.
2. Qualify versioned writes and old-client compatibility explicitly. This increment reads V1 but
   does not change existing write format or silently reinterpret presentation columns/sort.
3. Exercise permission changes, field loss, server-side export/search/cache/realtime surfaces and
   shared-view contributing records under each executing viewer's current authority. Decoding
   and sharing definitions never grant record access.
4. Review actual FA/DE/EN recovery, unsaved edits, locale switches, narrow/theme layouts, keyboard
   and screen-reader behavior on the exact combined candidate.
5. Rehearse installation/recovery and pilot acceptance before enabling the broader SP-03 roadmap.

Focused verification:

```sh
bun run test:unit src/features/saved-filters/viewDefinitionVersion.test.ts src/features/saved-filters/storedViewDefinition.test.ts --maxWorkers=2
bun run test:integration src/features/saved-filters/router.compatibility.test.ts src/features/saved-filters/router.test.ts --maxWorkers=1
```
