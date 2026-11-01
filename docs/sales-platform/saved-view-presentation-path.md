# Native saved-view presentation path

Read-only implementation map, 1 November 2026. SP-03 remains open. This is the
next full read/write/UI path, not an installed presentation capability. The
existing saved_filters.definition JSONB can hold a reviewed versioned envelope;
no separate table or store is needed for this scope.

## Current native support

| Entity       | Builtin column keys                                                | Supported server sort fields                                            |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Person       | name, org, email, phone, closedDeals                               | name, primaryEmail                                                      |
| Organization | name, address, closedDeals, openDeals, peopleCount                 | name                                                                    |
| Lead         | title, nextActivity, labels, sourceOrigin, value, createdAt, owner | title, nextActivityAt, label, sourceOrigin, value, createdAt, ownerName |

People's email column maps to primaryEmail sort. Unsortable count/address columns
must not acquire implied sort behavior. Resolve only current per-entity builtin
catalogs, enforce the pinned name/title link column and reject duplicate,
cross-entity, unknown, cf: and qualification keys. Current builtin projection has
no per-actor field ACL; hidden_builtin_fields is global UI metadata, not a
confidentiality mechanism. This slice cannot establish independent field privacy.

Deals use a separate saved-view control and currently sort in the browser over
at most 500 returned cards. Persisting that state cannot be described as global
server sorting. Complete its server-sort/query path before closing the common
presentation requirement for all entities.

## Existing path to extend

1. `viewDefinitionVersion.ts` currently reserves presentation version 1. Add the
   exact builtin column/sort resolver, preserving unsupported raw envelopes and
   the unavailable-view recovery state. Do not discard unknown columns through
   resolveVisibleOrder or turn unsupported filters into an unrestricted read.
2. `savedFilterActions.ts` create and definition-update use bare filter schemas.
   Source `db92500` closes their lossy write boundary with a separate strict map
   for all four entities: envelopes and unknown constraint keys are rejected.
   Native defaults and metadata-only updates retain their existing contracts.
   Actual envelope writes later need explicit target/version validation and intact
   encoding, with existing owner-only update and filter.share authority.
3. `storedViewDefinition.ts`, saved-view DTO types and `savedFilterList.ts` must
   retain validated presentation on available reads. Unavailable rows must continue
   withholding executable definitions and authored payload values.
4. `useColumns.ts` and `useColumnSort.ts` need explicit validated apply/reset
   operations. Conditions, columns and sort form one selected-view state; switching
   must not issue a transient broader filter or reuse stale rows/counts.
5. `SavedViewControl.tsx` and `SaveViewDialog.tsx` currently capture/reconcile only
   conditions and require conditions for saving. Capture full presentation, define
   layout-only views explicitly, and compare the entire current view state.
6. `PeopleList.tsx`, `OrgsList.tsx` and `LeadsInbox.tsx` own actual table state and
   already scope page requests by sort. Apply named-view overrides through those
   existing wrappers. Preserve each user's personal layout baseline; selecting a
   named/shared view must not silently overwrite automatic personal preferences.

The first native journey is People: hide/reorder builtin columns, sort email
descending, save a named view, change layout/sort, select that view and restore
the complete state, then reload and recover it again. Extend the same path through
Organizations and Leads, retaining Lead export columns/sort and unavailable-view
export blocking. Complete the separate Deals sorting path afterward; no broad
parent is complete at the first entity's pass.

## Verification and limits

Keep current version/decoder, stored-view, owner/share and metadata-only update
tests. Add actual PostgreSQL create/update/read round trips for envelopes, native
selected-view persistence and late-response recovery, personal-baseline isolation,
unknown/archive/cross-entity fields, scope/revocation and FA/DE/EN complete-state
journeys. Existing read-side strict recovery is not write-side persistence proof.
No database command, source presentation change or UI enablement ran during this
inventory. Native changes require their appropriate finite verification slots.
