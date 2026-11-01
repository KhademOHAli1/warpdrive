# Native saved-view presentation path

Implemented source map, 1 November 2026. Checked source
`03100336a1053155d282f4f8e016e509bdb7ec31` is locally adopted at
`7c10761647633a6d2c0f701f3a1426d58357ee96` with an identical tree.
People, Organizations and Leads now have builtin presentation read/write, capture,
selection and personal-baseline handling. SP-03 remains open. Read the
[contract](saved-view-presentation-contract.md) and
[source-bound evidence](evidence/saved-view-presentation-2026-11-01.json).

## Native builtin support

| Entity       | Builtin column keys                                                | Supported server sort fields                                            |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Person       | name, org, email, phone, closedDeals                               | name, primaryEmail                                                      |
| Organization | name, address, closedDeals, openDeals, peopleCount                 | name                                                                    |
| Lead         | title, nextActivity, labels, sourceOrigin, value, createdAt, owner | title, nextActivityAt, label, sourceOrigin, value, createdAt, ownerName |

People's email column maps to primaryEmail sort. Count/address columns have no
implied sort. The full envelope requires known unique columns with the pinned
name/title first and an allowed entity-specific sort. Unknown, cross-entity,
`cf:` and qualification keys are refused intact. Existing builtin projection has
no per-actor field ACL; hidden_builtin_fields remains global UI metadata. This
increment establishes no independent field-privacy contract.

## Implemented path

1. `viewPresentation.ts` and `viewPresentationSchema.ts` define pure capture and
   strict presentation validation. `viewDefinitionVersion.ts` decodes supported
   envelopes without rewriting raw stored JSONB or widening unknown definitions.
2. Native create/definition updates validate the complete explicit V1 envelope
   for person, organization and lead. Legacy bare writes stay strict. Metadata-only
   patches preserve definition bytes; existing owner/share authority is retained.
3. Available saved-view DTOs expose validated conditions and full presentation.
   Unavailable rows expose no executable definition or authored payload values.
4. `useColumns` and `useColumnSort` apply validated view state. Personal preference
   debounce and unmount flush are cancelled in view mode; Clear restores baseline,
   while local edits detach the selected ID without overwriting that baseline.
5. `SavedViewControl` and `SaveViewDialog` permit layout-only saves, compare full
   view state and refuse unsupported capture with FA/DE/EN recovery guidance.
   Contact search and Leads quick-filter/archived scope cannot silently disappear
   from a saved view; named selection explicitly clears that transient scope.
6. People, Organizations and Leads use native actor ID-only selection preferences.
   Initial route resolution happens before data admission; malformed/private/missing
   selections block rows/counts/reference labels and Leads export/bulk admission.
   Ordered client preference writes fence deferred dispatch against actor changes.

Deals still use a separate saved-view control and client sorting over at most 500
returned cards in the adopted source. Its independent global server sorting/paging
work is unadopted. The six-case native attempt stopped during dependency loading
before database setup or assertions, so it establishes no behavioral RED or GREEN.
The later UI diagnostic also executed zero cases. Read the
[runner status and next-step handoff](deal-list-runner-status.md). That future
client branch remains unqualified; complete Deal presentation is still open.

## Verification and next journeys

Actual affected units passed 425 cases/33 files. Full typecheck and full repository
lint passed. Actual PostgreSQL passed 18 cases/three files for envelope round trips,
native selection and strict-write preservation, using the selected synthetic
85-entry Sales history. Failed type/lint attempts and behavioral RED classifications
remain in the source-bound record. No migration/dependency change was introduced.

Next native journey is People: hide/reorder builtin columns, sort email descending,
save, change state, select the named view, reload and recover its complete state;
then verify Clear and personal-baseline isolation. Extend through Organizations and
Leads, including export columns/sort and unavailable-view export blocking, in
FA/DE/EN. Browser operation requires a separately coordinated finite window and
review of native development import-worker startup before starting the profile.

Custom-field presentation, real retained definitions, broader revocation after waits,
current-main/retained upgrades, complete export authority and release acceptance
remain open. The latest production build-checked application is still f006b5a.
