# Multilingual CRM delivery

The active work is multilingual infrastructure and application-wide localization. Delivery order:
English regression safety, fully usable Iranian Persian (Farsi), then fully usable German. The
initial active goal names Farsi as its first milestone; the user's subsequent German requirement
is part of the completion scope. German must not be offered as a selectable language while its
catalog and workflows are incomplete.

## Acceptance

- Request-scoped server and client translation, typed message catalogs, ICU interpolation and
  plurals, explicit fallbacks, missing-message reporting and automated catalog validation.
- Persistent account and device language, calendar and timezone choices. Accessible switching
  protects unfinished editing and reports failed preference saves.
- Locale-aware dates, times, numbers and currency formatting, with Persian/Arabic digit and
  separator input normalization. ISO storage, identifiers and machine exports remain stable.
- Iranian Solar Hijri date pickers and full activities calendar with correct month navigation,
  weekday/week-start conventions, leap days and timezone behavior.
- Full RTL layout, directional keyboard behavior and portalled controls, bidi isolation of mixed
  text, and a deliberately chosen, appropriately licensed Persian font.
- Contextual translations of all screens, forms, empty states, validation and error messages,
  notifications, shared controls and accessibility labels. User-entered data is not translated.
- Automated coverage and regression checks plus browser verification of representative complete
  CRM workflows in English and Farsi, followed by German. Passing a catalog check alone is not
  application acceptance.

## Current work

- [x] Establish next-intl request/server/client infrastructure and persistent preferences.
- [x] Add shared locale formatting and numeric input normalization; migrate pipeline/deal/lead consumers.
- [x] Add activities calendar Solar Hijri math, navigation, localized labels and persistent selection.
- [x] Add catalog/ICU validation and an explicit source migration inventory/baseline.
- [ ] Migrate remaining custom-field and feature-specific formatting/parsing.
- [ ] Align event grouping, creation and display with one explicit account timezone contract.
- [ ] Migrate all English catalog imports and literal UI copy.
- [ ] Finish shared controls, forms and feature layout RTL and accessibility adaptation.
- [x] Bundle Vazirmatn with license/provenance and verify its use in the Farsi browser session.
- [ ] Translate and review all Farsi workflows in context.
- [ ] Verify complete Farsi workflows and all applicable regression checks.
- [ ] Add and review German catalogs, formatting and complete workflows after Farsi.

## Audit commands

`bun run i18n:audit` checks catalog syntax and key/argument parity and prints remaining source
migration candidates. `bun run i18n:audit -- --report` writes the detailed inventory to
`docs/i18n-inventory.json`. The source scan covers JSX text, selected user-facing attributes,
simple conditional/interpolated JSX strings and legacy English catalog imports. It does not
prove complete translation coverage.

`bun run i18n:audit -- --check` additionally rejects new unresolved candidates relative to the
explicit migration baseline. `--strict` fails while any source migration candidate remains.
Only deliberate review may update the baseline with `--write-baseline`; it is not a way to
declare untranslated text complete. Catalog checks always fail on missing or extra translation
keys, invalid ICU messages or changed argument contracts.

## Known pre-existing verification limits

The public checkout omits a private deployment workflow referenced by two upstream test files.
Production Docker build and broad lint were interrupted under heavy machine contention in the
initial Bun migration. These limits remain open until independently resolved or revalidated.

## Verified infrastructure checkpoint, 2026-10-29

- Real signed-in language actions saved both English and Farsi to the isolated demo account.
  A fresh Farsi request rendered `lang=fa`, `dir=rtl` and the Vazirmatn font family.
- Browser navigation showed فروردین ۱۴۰۵ at Gregorian anchor `2026-03-21`, then اردیبهشت ۱۴۰۵
  after following the next-month link to `2026-04-21`.
- A browser-discovered RSC crash was fixed by removing DayPicker's React entrypoint from server
  calendar math. The final server-safe math/import regression tests passed (14 tests).
- The activities-calendar suite passed 80 tests before the final RSC correction; foundation
  checks passed 34 tests; formatting checks passed 95 plus 21 summary/lead-cell checks; shared
  UI checks passed 73 tests. These suites overlap and their counts must not be summed.
- Audit helper coverage was subsequently revalidated and expanded; see the cross-feature checkpoint below.
- Whole-project typechecks passed during integration; final compile-only assertions and the
  latest boundary/helper edits still require a complete final integrated typecheck.

The initial inventory found 789 literal-copy candidates and 180 legacy catalog imports across
360 production files. Later backlog snapshots are recorded below; these are not translation percentages.
The active goal remains open. German has planned registry metadata and initial calendar/shared
control catalogs, but is deliberately not offered as a selectable language yet.

## Cross-feature checkpoint, 2026-10-29

The core CRM screens now use typed English/Farsi catalogs: settings, sales, contacts, leads,
activities, email/compose, dashboard/auth, quick-add, shared table/saved-view controls, filters,
inline editors, notifications and recovery UI. Custom fields/files and the complete activity
zone/civil-date path are the current implementation tranche. German remains the next language.

Completed evidence (overlapping suites, not additive):

- Settings: 40 initial workflow tests; later semantic adapter and mixed settings/email checks
  passed. Independent wording review corrected quota units, timezone fallback, whole-phrase
  activity goals and missing assignee labels.
- Contacts/leads: 120 tests across 15 files, plus 11 contact history/email-state checks.
- Sales: 90 tests across eight files, plus 28 review/display/accessibility checks.
- Email/compose: 160 focused tests, with later mixed display regressions also passing.
- Dashboard/auth: 63 tests across 11 files, with truthful Gregorian reporting labels.
- Shared table/saved-view controls: 41 tests across seven files, including keyboard reordering.
- Root shared UI: 60 focused tests passed; quick-add/account fallback checks passed 30 tests;
  recovery checks passed six tests; catalog server-import regression passed under Bun.
- Source/catalog guard helpers passed 14 tests. Reviewed source exceptions match an exact
  file/text/hash and fail when stale. The one current exception compares persisted legacy
  notification summaries as protocol values; those summaries are localized for display.
- Date filters: 27 focused tests, 13 real PostgreSQL predicate checks, and four complete
  router/database tests passed. Selected calendar/week rules and account zone now affect
  relative filters; stored filter keys remain compatible.
- Notification email rendering passed eight tests, including Farsi HTML direction, escaping
  and preserved record links. Date-router/notification job/visibility integration passed
  12 tests across three files with a fake mail sender. No external email was sent.
- A complete integrated TypeScript check passed after the first cross-feature migration.
  Later semantic/custom-field/temporal work requires another combined check.
- Chrome rendered the real demo pipeline with Farsi controls/digits, `lang=fa`, `dir=rtl`, and
  computed Vazirmatn. Complete final workflow/visual acceptance remains open.

The last completed inventory in this tranche found 37 literal candidates and 33 legacy imports
across 48 files, zero catalog issues/new source findings, and one reviewed protocol exception.
This is a backlog snapshot, not a translation percentage. The current report and
`i18n-remaining.md` should be consulted after each tranche. The baseline was not reset.

## Activity civil dates and timezone consistency

The existing activity model stored instants and an all-day flag without an original timezone.
A midnight instant cannot prove an old all-day date. Migration 0076 adds nullable `due_date`
and `end_date` fields; it has been applied to the isolated local demo and performs no backfill.
New/date-edited all-day activities will use explicit Gregorian civil dates, with compatible
instant anchors. Existing instants and ambiguous legacy dates need an explicit decoder.

The in-progress temporal adapter uses one resolved account zone for timed composition, edits,
grouping, calendar windows, day load and labels. It preserves untouched instants, freezes the
draft zone, rejects skipped wall times, and exposes offset/ambiguity information. See the
[Temporal timezone documentation](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)
for the disambiguation model. Complete UI/database checks for this path are still pending.

## Remaining acceptance boundaries

- Finish and verify activity canonical/legacy all-day behavior, timezone query bounds and
  unchanged edits across timezone/DST changes.
- Finish custom-field/file display/input and create validation before inline-entity side effects.
- Align notification Today bands with recipient/account days; complete recipient email wiring checks.
- Complete remaining source/computed-copy review and contextual Farsi workflow acceptance.
- Re-run combined typecheck/lint, required Bun checks and representative English/Farsi browser flows.
- Reporting buckets and business goal periods keep their existing Gregorian/startsOn semantics.
  They are explicitly labeled; a reporting-calendar change needs its own consistent business contract.
- Production build/Docker readiness, missing upstream private-workflow tests and final release
  license/notice qualification remain open from the package migration.
- Add/review German catalogs and workflows after the Farsi milestone. German is not selectable yet.

## GitHub branch checkpoint, 2026-10-29

This checkpoint supersedes the in-progress checks listed above. It publishes the Bun/package
migration, shared UI updates, multicurrency work and Farsi-first internationalization together.
It is a development branch, with final language and release acceptance still open.

- The combined Bun TypeScript check passed after the latest cross-feature changes.
- The email attachment build error was fixed by removing a duplicate client directive.
  All four attachment tests passed, an AST scan of 2,763 source files found no misplaced or
  duplicate directives, and the real Farsi pipeline rendered again in Chrome.
- Activity timezone/civil-date verification passed 76 pure tests, 82 UI/composer checks,
  14 real PostgreSQL repository checks and three SQL boundary checks. Later form/hook
  regressions also passed. These suites overlap and their counts are not additive.
- Custom-field/file localization passed 73 tests, followed by focused validation regressions.
  Quick-add and sales creation passed 26 checks, including invalid numeric drafts before
  linked-entity creation.
- Recipient notification locale and account-day grouping passed 21 tests across five real
  PostgreSQL integration files. Mail delivery used a fake sender; no external email was sent.
- Utility/shortcut localization passed 76 tests across 11 files. Enrichment server imports
  and provider-name handling passed 56 targeted checks, including Bun's react-server condition.
- The publication-time i18n check passed: zero catalog issues or new source findings,
  three literal candidates, one legacy catalog import and one reviewed protocol exception.
- The complete lint command currently fails at Biome: 43 errors and 13 warnings, covering
  formatting/import order and correctness rules. This branch is not qualified as lint-clean.
  A separate complete ESLint pass also completed with 53 errors.

Remaining acceptance includes the full production/Docker build, complete lint cleanup,
representative English/Farsi browser workflows and contextual language review. German catalogs
and workflow verification follow the Farsi milestone; German is not selectable yet.
