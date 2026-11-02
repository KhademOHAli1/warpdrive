# Regional money slice: Settings adoption review

1 November 2026, Europe/Berlin. **Accept the independent rial/toman display contract and the bounded adoption approach. Return the supplied source slice for the three corrections below before treating it as a complete merged candidate.** Do not cherry-pick the full source commit. This review applies no source and supplies no test, native, financial or release qualification.

Reviewed packet: `/Users/ali/Documents/Codex/2026-10-31/warpdrive-agency-projects-implementation/outputs/agency-regional-money-adoption-review/README.md`, `paths.json` and `review.patch`.

- Source owner: MAIL/regional, `/Users/ali/Developer/warpdrive-integrations`.
- Source: `297c1dd5dbff4e19f6d1559a16bb258cc3368577`; parent: `aab6c3d0d64eb014a526d270a9bada92a01dc5a8`.
- Later source cut, also current owner HEAD at inspection: `56210f31307701c7e545bf05f6b93ce4621605a3`.
- Agency base and HEAD at inspection: `6855645499b5f5878f7b2d2eb431dd6e6d4b7fbc`. Its unrelated dirty work was preserved.
- Patch SHA-256: `26dd1c77faee9dffdfc924dc8267dbce4f67428271d1d3d936a6cea9c4a4b35a`.
- Manifest SHA-256: `42128522b90c2e1de8e0b72f86d284f7d5257af847e8c70c991348dce44f0613`.

## Identity and scope checks

Read-only Git/blob checks matched all 25 manifest paths and hashes against the recorded source parent, source, later source and Agency base. All 25 selected source files are unchanged at `56210f3`. All target working files still matched their Agency-base bytes at inspection. In-memory reconstruction of every patch context/addition produced exactly the selected source bytes; no patch application occurred.

The reported composition is correct: 9 additions, 14 exact source-parent matches and 2 manual-merge paths; 22 TS/TSX and 3 JSON files, including 4 tests. All seven listed prerequisites match the later source cut: account resolution/persistence hook, identity preference schema/repository, root layout, Select and CurrencyProvider. The selected slice requires no package, environment, database schema or migration change. This does not make the full 466-path source commit suitable for adoption.

## Accepted behavior and mandatory merges

Canonical currency remains IRR/rial. An explicit toman preference changes display by a factor of ten, preserves the fifth toman decimal arising from four-place canonical values, and performs no FX or storage/input conversion. The decimal-string algorithm is sound by inspection for its accepted fixed-decimal input domain. Default rial and non-IRR formatting branches remain unchanged.

Preference validation, action/cookie read/write propagation, account persistence and LocaleProvider/formatter propagation form a coherent source path. The existing persistence hook merges independent choices, serializes saves, and restores the saved value on failure. The new control disables while pending and has localized preview/help text. The supplied tests meaningfully cover FA-to-DE unit preservation, failed-save rollback, account persistence and canonical custom-field read-to-edit behavior; their presence is not an execution result from this review.

Two paths require additive manual merges:

1. `src/features/i18n/catalog.ts`: add the three dataConventions imports and language namespace entries while preserving every current Agency/Sales/Settings/workflow/pipeline/view-compatibility namespace and translation. The three new catalogs have matching money keys and factor interpolation. Unused phone/date copy in that namespace does not admit those executable features.
2. `src/app/(app)/settings/profile/LanguageSettings.tsx`: import/place IranianMoneySetting in the current regional card. Preserve Agency's settings surfaces, previews and numbering control in **all** languages. Source `297c1dd` still wraps its numbering controls in `locale === "fa"`; replacing that file would regress the adopted independent digit choice.

Keep Agency `src/lib/numberingSystem.ts` byte-for-byte, SHA-256 `fdcd51b3c58c9d59b806c9d4868977da7ba80b4fa04b187af5ced23c5dce375e`. Do not import the source owner's older locale-forces-Latin implementation.

## Corrections required for complete adoption

### 1. Preserve supported numeric amounts instead of displaying an empty value

Source `src/lib/iranianMoney.ts:7–10` accepts `string | number`, then validates `String(value)` with a fixed-decimal-only regex. A finite number such as `1e21` stringifies using exponent notation and is rejected; the IRR+toman branch therefore displays an empty string. The existing ordinary currency formatter accepts that numeric input. Expanded decimal text for the same magnitude passes the new converter.

This is reachable through the existing monetary custom-field contract: `src/features/custom-fields/validate.ts:43–44` allows finite numeric multiples of 0.01 without a maximum, and `render.tsx:50–51` passes those numbers to formatCurrency. The source's canonical fixed-decimal examples do not narrow that existing caller contract.

Handle supported numeric representations while preserving decimal-string conversion, or separately review and enforce a compatible bounded input contract across every caller. Do not silently drop numeric support or turn valid values into an empty display. Add a failing-then-passing regression for a supported exponent-form number and its expanded-string equivalent, alongside negative/zero/sign and precision cases. This is a source-derived P2 regression; no execution was performed here.

### 2. Make monetary description IDs unique per mounted control

Source `src/features/custom-fields/render.widgets.tsx:44` uses `cf-${def.key}` and `render.numeric-control.tsx:41` derives `${id}-unit`. Keys are unique per entity (`defsRepo.ts:97–100`), while AddDeal/AddLead mount person, organization and main-entity fields together. Same-key Budget fields can therefore produce repeated `cf-budget-unit` IDs, so an input's accessible description may resolve to another field's hint.

Use a per-mounted-control unique identity and keep input/error/unit references coherent. Test simultaneous same-key definitions across the three entity sections, unique description targets and correct accessible descriptions, including a validation error. The shared key-only input-ID pattern predates this slice; the newly added unit descriptions make correcting their association part of this adoption's accessibility closure.

### 3. Include the omitted source bulk-currency fix

The existing `src/features/deal-workspace/sidebar/DetailsBlock.tsx:42–47` does not pass its `currency` to DetailsBulkEditor, whose control call at `:129–133` also omits it. Normal inline mode uses the supplied currency; the new bulk unit hint falls back to CurrencyProvider instead. Current top-level routes normally supply the company currency, so this is an exposed component-contract inconsistency, not a demonstrated common-route mismatch.

The source owner already fixes all three boundaries in `src/features/deal-workspace/sidebar/DetailsBlock.tsx` at the reviewed source cut: it passes currency to DetailsBulkEditor, accepts/types that prop, and passes it to CustomFieldFormControl. Those four added lines are missing from the 25-path packet. Include that existing narrow source delta in the revised manifest/patch, with an explicit IRR-under-EUR-provider bulk regression that saves the unchanged canonical amount. Preserve any later Agency edits during adoption. The supplied 25 paths therefore do not yet close the entire explicit-currency caller contract.

Keep AddDeal/AddLead custom fields on `baseCurrency`, as supplied. Existing custom monetary fields have no per-field currency metadata and remain in company currency. Their hints must not follow the selectable deal/lead value currency. Other create/conversion controls may use the existing company-provider fallback where that is their actual currency contract. Ordinary numeric fields should receive no money instructions.

## Qualification and latest-cut interpretation

The latest byte-verified source cut is `56210f3`; it contains the same selected implementation as `297c1dd`. Its committed `docs/local-integrations-progress.md:43` reports 144 related UI/unit cases for monetary entry labels. I found that source-owner checkpoint report, not raw runner receipts proving a newly merged Agency/numbering candidate. Its later real-PostgreSQL/TLS results concern mail behavior and do not qualify this regional adoption.

There is **no merged or tested Agency regional-money cut from this review**. After correcting and re-exporting the bounded slice, qualify the exact immutable merged cut with:

- New money tests plus affected formatter/locale/preference/custom-field/create/bulk and retained numbering/LanguageSettings suites. Explicitly combine toman with `arabext` in DE/EN and `latn` in FA; changing only the unit must rerender without changing calendar, zone, digits or drafts.
- Existing account/action/cookie/SSR boundaries: old accounts with no unit, invalid cookie/unit recovery, account precedence, CSRF rejection, cookie persistence and transport failure. The new DB test exercises the repository/resolver, not the complete server-action/browser round trip.
- Same-key multi-entity add forms, company currency different from record currency, bulk/inline unit descriptions, error descriptions and canonical saved values.
- Catalog parity, type/static checks and native FA/DE/EN save/reload, pending/failure recovery, RTL/LTR placement and keyboard/screen-reader journeys. Inspect built-in amount read/edit views too: several unchanged read callers append IRR after the new toman label; ensure the combined wording distinguishes display unit from canonical currency clearly.

Financial authority remains outside this review. Display conversion, shared money helpers and a mutable deal amount do not establish an approved quotation/budget/cost baseline, missing-cost coverage, financial permission, invoice or posting. No finance/quote contract is inferred or accepted.

No source, index/ref, provider, service, schema or migration was changed; no test/static/build/database/native campaign was run. Only read-only source inspection and this decision artifact were produced. Settings remains unchanged at `ec9b3f8943e42736edc6713c099fd2ef14068d0a`.
