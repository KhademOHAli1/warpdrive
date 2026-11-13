# Multiple currencies

Each lead or deal stores its currency with its amount. Changing the display
language preserves that currency. Totals are grouped by currency and changing a
record's currency leaves conversion to the user. Migration
`0075_multicurrency.sql` assigns the company base currency to existing records,
including archived, deleted, and converted records.

## Impact assessment

- Storage previously held a bare numeric(14,2). Add a currency to leads, deals and goals, and
  widen native monetary values to four decimal places so three-place currencies are preserved.
- Pipeline and server-side list aggregates use decimal arithmetic and group totals
  by currency. The deal list footer uses the loaded matching rows when the
  client-side owner filter is active.
- Cards, lists, detail editors and linked contact deals must display the record's own unit.
- Conversion in either direction and duplication must preserve currency alongside value.
- Dashboard sums, averages, medians, trends, stage values and lost reasons must all be scoped
  to a selected currency. Reports do not combine their values across currencies.
- Value goals carry their own currency; count goals continue to count all matching records.
- CSV mapping accepts currency codes. Exports must include unambiguous codes. API and MCP
  schemas carry currency; older callers that omit it receive the company currency on creation.
- Currency edits remain subject to existing permissions, visibility and concurrency checks,
  and the deal change log records the changed unit.
- Sorting monetary records groups currency codes before comparing amounts. Numeric filters
  compare native amounts; use the currency filter when comparing one unit.

Organization annual revenue and existing custom monetary fields remain in the company base
currency, since their stored values have no per-field currency metadata. The company base
currency remains read-only: relabelling it would reinterpret those existing amounts.

The selectable code list is a fixed snapshot of [SIX List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml), the ISO 4217 current currency register. [List Three](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-three.xml) keeps historical units valid on existing records. Browser ICU is used only for localized names, with the code as fallback. This prevents different browser/server versions from disagreeing about valid units. IRR means rial; a non-ISO toman
unit is not substituted for it. No external exchange-rate provider or paid service is added.

Catalog retrieved 2026-10-29. List One publication: 2026-09-17.
SHA-256 List One: `33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff`.
SHA-256 List Three: `98fde2423cdb916dd59dcf5fe96222edad8fa198d865c1c83dbc464b9cc52387`.

## API and CSV compatibility

Deal-list responses include `currencyTotals` for the full filtered set. The legacy `totalValue`
is null when that set contains multiple currencies or is denominated in a foreign currency. It remains available only when it can represent the company-currency amount without conversion. Integrators must use `currencyTotals` in
that case. Stage-sum rows are keyed by both stage and currency. New clients display the unit
alongside the amount rather than inferring it from the company setting.

The decimal API retains two places for existing cent-based values (`1200.00`) while preserving
real third and fourth places. Money inputs accept canonical decimal strings as well as legacy numeric inputs. Large native amounts keep their fractional precision. Aggregate sums have no per-record size cast. Both the SQL result and UI formatter preserve decimal strings;
large totals are not converted to floating-point numbers just to render them.

Lead CSV exports that include Value now include a separate Currency column. Value is a raw,
canonical decimal rather than a localized amount with a symbol, so exported values can be
mapped back to Value and Currency on import. Exports without Value keep their existing columns.

The original qualification checked the migration against a disposable PostgreSQL
database before local application. The local migration preserved the existing
amounts and record counts.

## Verification scope

Focused Bun tests cover currency validation, Persian input, exact aggregation and formatting,
large-value sorting, create forms, pipeline/list rendering, CSV mapping/export and daily goal
arithmetic. Real PostgreSQL checks cover migration backfill, default currency, value precision,
full-set totals, lead/deal conversion, duplication, report isolation and currency-specific goals.
The Farsi picker was also exercised in the local browser and the draft was cancelled.

The focused suites passed: 172 Bun unit tests and 38 real PostgreSQL integration tests. The
PostgreSQL suite ran with the Node Vitest runner against a disposable PostgreSQL 16 instance.

An earlier full-repository type-check reported errors in the parallel localization work
(locale typing and notification messages). Currency files had no errors in that snapshot.
Final lint and full-type-check retries stalled on reads of existing repository files, so those
retries do not establish a clean final lint or full-project type-check result. No production
build was run against the shared development checkout.
