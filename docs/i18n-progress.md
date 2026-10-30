# Multilingual CRM delivery

English and Iranian Persian are the completed first localization milestone. German is the next
milestone, with the same calendar, numeric-input, accessibility and contextual-copy requirements.
The earlier dated sections below are historical evidence; this section and the newest checkpoint
supersede their pending statuses.

The Bun/Farsi work through `610e0ea` is consolidated on the user's
[main branch](https://github.com/KhademOHAli1/warpdrive/tree/main). The exact commit passed all
three [hosted CI jobs](https://github.com/KhademOHAli1/warpdrive/actions/runs/40965697019),
including 5,392 CRM unit checks and 30 marketing checks. The merged task branches are closed.
The repository remains an open source fork with its upstream relationship and MIT attribution.
Concurrent unpublished interface redesign work remains preserved in its separate live checkout.

German now covers all 22 catalog groups, with integrated checks and production browser
verification recorded in the newest checkpoint below. Hosted CI validates each published commit.
A catalog check alone does not establish workflow acceptance.

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

- [x] Establish server/client translation, typed ICU catalogs and persistent preferences.
- [x] Complete Iranian calendar, account-zone dates, numeric input, RTL and Persian typography.
- [x] Complete Farsi source migration, contextual review and representative browser workflows.
- [x] Pass final Bun typecheck, lint, unit tests, app/worker builds and hosted three-job CI for Farsi.
- [x] Draft and review complete German resources, preserving authored data and protocol values.
- [x] Adapt German date controls and protect canonical numbers from locale-dependent parsing.
- [x] Finish integrated German checks and representative browser workflows; publish this verified source on main.

## Audit commands

`bun run i18n:audit` checks catalog syntax and key/argument parity and prints remaining source
migration candidates. `bun run i18n:audit -- --report` writes the detailed inventory to
`docs/i18n-inventory.json`. The source scan covers JSX text, selected user-facing attributes,
conditional/interpolated strings, local const-map references, rendered React state setter copy
and legacy English catalog imports. Binding analysis is bounded, preserves lexical scope and
fails visibly on resource limits. Arbitrary helper output and server-returned copy still need
feature review; an empty static inventory does not prove complete translation coverage.

`bun run i18n:audit -- --check` additionally rejects new unresolved candidates relative to the
explicit migration baseline. `--strict` fails while any source migration candidate remains.
Only deliberate review may update the baseline with `--write-baseline`; it is not a way to
declare untranslated text complete. Catalog checks always fail on missing or extra translation
keys, invalid ICU messages or changed argument contracts.

## Initial verification limits

The public checkout omits a private deployment workflow referenced by two upstream test files.
Production Docker build and broad lint were interrupted under heavy machine contention in the
initial Bun migration. Later checks and the public CI work are recorded below; production
deployment qualification remains separate from local verification.

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

## Historical GitHub branch checkpoint, 2026-10-29

This checkpoint supersedes the in-progress checks listed above. It publishes the Bun/package
migration, shared UI updates, multicurrency work and Farsi-first internationalization together.
It is a development branch, with final language and release acceptance still open.

- The combined Bun TypeScript check passed at publication, before subsequent follow-up changes.
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
- At publication, the complete lint command failed at Biome: 43 errors and 13 warnings, covering
  formatting/import order and correctness rules. This branch is not qualified as lint-clean.
  A separate complete ESLint pass also completed with 53 errors.

Remaining acceptance includes the full production/Docker build, complete lint cleanup,
representative English/Farsi browser workflows and contextual language review. German catalogs
and workflow verification follow the Farsi milestone; German is not selectable yet.

## Current verification checkpoint, 2026-10-29

This checkpoint supersedes the earlier in-progress verification status. Commit `7b841de` was
pushed to [KhademOHAli1/warpdrive, feat/farsi-first-bun](https://github.com/KhademOHAli1/warpdrive/tree/feat/farsi-first-bun).
The subsequent changes described here have not yet been pushed.

- Farsi follow-ups now cover saved-calendar choices independently of language, date-picker
  navigation, account-zone email scheduling, preserved time drafts and invalid-time guards
  before manual mutations. Contextual workspace/sidebar copy and accessibility labels were
  also refined. Focused worker checks passed; their overlapping counts are not additive.
- The stronger source/catalog guard passed 28 tests. Its current inventory has zero unresolved
  candidates and four explicitly reviewed exceptions. This is static evidence, not semantic
  or workflow completeness, and the baseline was not reset.
- A production build succeeded in a separate QA copy served on port 3101. Later sidebar and
  contextual-label changes followed that build, so the final source still needs build confirmation.
  Worker bundles also built successfully.
- The latest complete unit run reported 5,311 passes and four failures. Targeted follow-ups
  for those four failures passed 44 and 52 tests. A complete green rerun has not yet been recorded.
  A fresh real PostgreSQL integration run passed 21 tests; no external email was sent.
- Public CI now defines CRM, site and documentation jobs. Its local contract checks passed
  21 tests; remote CI remains pending. Final integrated typecheck and lint results for the latest
  source are still awaiting confirmation.
- The native local server returned HTTP 200 for `/login` without a process restart. Development
  read-only artifact warnings remain under separate diagnosis. Chrome update activity is left
  untouched at the user's request; its completion is unconfirmed. Current in-app-browser attempts
  time out, so full browser workflow acceptance remains incomplete. Earlier browser evidence above
  is retained as historical verification. Current work prioritizes code, validation and the GitHub checkpoint.

The active Farsi goal remains open. Remaining acceptance includes current-source build and
regression confirmation, complete contextual English/Farsi browser workflows, real Gmail
integration and production Docker/deployment verification. German remains the next language
and is not selectable yet.


## Isolated publication checkpoint — 2026-10-29

This checkpoint exports the Bun/i18n hardening onto `7b841de`; the concurrent Finance OS/sidebar/settings and contacts redesigns remain in the live working tree and are excluded from this publication. They are not dependencies of the exported calendar, numeric input, scheduling, import diagnostics, or accessibility changes.

The exported tree passed a fresh frozen Bun 1.4.2 install, route generation/typecheck, the strict translation audit (zero unresolved findings, zero catalog issues, four explicitly reviewed exceptions), full lint (12 nonblocking Biome warnings; ESLint clean), the Next production build, and all server-entrypoint builds. The isolated full unit run passed **5,335 tests in 856 files**. Subsequent small composer-label, MCP type-only, and PostHog patch changes passed their targeted checks; the final export passed 51 import/composer tests, and the final build/typecheck/lint passed with those changes included. Hosted CI must still validate the final commit as a complete tree.

Fresh independent marketing-site checks passed using its own TypeScript 7.0.2 installation: frozen install, route generation, typecheck, 30 tests in seven files, and production/static build. Fresh documentation checks passed frozen install, TypeScript 7.0.2 typecheck and Docusaurus production build. These are local macOS results, not hosted Linux results or deployment acceptance.

Database evidence includes 21 activity/notification checks, five import-report route checks, and 28 MCP checks on disposable PostgreSQL databases. MCP uses server/client SDK 2.4.0 and mcp-handler 2.3.0; its tests cover all 35 tools, schema validation, per-actor permissions/isolation and revoked tokens. PostHog is 5.60.1. The direct-package audit found 129 of 131 dependency entries current; CRM TypeScript 6.0.3 and jsdom 29.1.1 have reproduced compatibility constraints documented in [Bun runtime compatibility](bun-runtime-compatibility.md).

Browser work resumed in the built-in browser without further Chrome update work. The earlier production preview verified Persian font, RTL document/layout and accessible card labels; English/Farsi switching updated client and server text/title/direction while preserving an unsaved name draft; Iranian calendar preference persisted after reload; Gregorian and Iranian date pickers represented the same day; Persian and Arabic time digits supported activity creation/editing/completion and rejected invalid drafts. Scheduling controls displayed Iranian dates and the account time zone; no email was sent or scheduled. The final isolated build is served separately on local port 3102 for exact-tree follow-up. The calendar type-label and email-field accessibility gaps found during these checks are fixed and tested in this checkpoint.

The native development server was restarted with the persistent Next/Bun logger patch. Warm health requests succeeded; no read-only logger rejection or underlying timeout was reproduced after compilation settled. Compilation and request-queue delays remain distinct from application/database handling time.

Publication/hosted-CI status: pending at the time this section was written. Full final-build browser acceptance remains in progress. German remains the next language and is not selectable as a completed CRM translation. External OAuth/Gmail delivery and production Docker/deployment qualification remain separate from this local i18n checkpoint.


## Phone-input and hosted-CI follow-up — 2026-10-29

The published `e91e794` checkpoint passed all 5,340 assertions in 857 files on hosted Linux, but the CRM job correctly failed on an uncaught recipient-field blur timer after teardown. The timer now cancels on unmount while preserving its 150 ms interaction delay; focused regression, typecheck and lint checks passed. Site and documentation jobs passed in that run. The complete next-commit hosted run is still pending.

Final browser contact creation exposed a real Farsi input defect: an identical phone number failed with Persian digits and saved with ASCII digits. Contact-point and custom-field phone validation now checks normalized digits without rewriting authored values. Related matching, optional US display formatting and telephone links preserve digits across Persian, Arabic and ASCII scripts. Phone links normalize only the actionable href; display/storage remain authored text. Malformed custom phone values containing no digit are rejected.

The follow-up passed full export typecheck, translation audit (zero unresolved findings, four reviewed exceptions), lint, production/worker builds and 144 targeted unit checks. Real PostgreSQL create/update checks preserve authored phone values, and six MCP wire/auth checks confirm all 35 tool schemas remain representable and permissions/isolation/revocation work. After rebuilding the exact isolated app, Persian-digit contact creation succeeded in the browser. No telephone call or email delivery was initiated.

The checked build continues on local port 3102. Final hosted CI and publication of this follow-up remain pending at the time of writing. German implementation follows Farsi closeout; its planned registry entry is still unavailable in the language picker.


## German delivery checkpoint, 2026-10-30

German is available beside English and Iranian Persian across all 22 message-catalog groups.
The 2,425 source messages have complete German resources and retain their ICU arguments,
plural/select contracts and rich-text tags. Established German terms, brands and unit symbols
that match English have individually reviewed, keyed invariant reasons. The strict audit has
zero catalog issues, zero unresolved source findings and the same four reviewed source
exceptions; the migration baseline was not reset.

The contextual review aligned Verkaufschance, Vertriebspipeline, Verantwortliche Person,
Folgeaktivität and Fehlende Daten ergänzen. It also corrected one-row/one-opportunity grammar,
automatic-title help and the team-visibility permission label. The latter now describes access
to team members' records in English, Farsi and German; the permission ID and grant are unchanged.

German Gregorian date pickers use dotted dates and German controls; the Iranian calendar uses
German CLDR month/day names with its own calendar math. Language, calendar, account zone and
Farsi digit choice remain independent. Typed locale-resource maps preserve exact required keys
while permitting translated text even with generated English literal declarations.

Canonical decimal strings are displayed directly through Intl without lossy Number coercion.
Creation forms, money/goal editors, contact numeric fields, filter rows and integer preferences
keep an authored draft's input locale across a language change. Filters normalize only once,
reject invalid numeric drafts before Apply and emit canonical primitives to existing APIs.
Successful cache-TTL writes end that draft's locale while preserving newer input.

Local Bun verification passed route generation/typecheck, the strict audit, full lint (12 existing
nonblocking Biome warnings), the production build, all four worker-entrypoint builds, and a
complete unit run of 5,462 tests in 865 files. The narrow history-display follow-up
passed 62 focused unit checks and 15 real PostgreSQL checks, covering exact numeric strings,
digit-only cache changes, validated read preferences and preserved payloads/visibility. Hosted CI reruns the complete suite on the published commit.

Production browser checks verified persisted German server titles/lang/ltr, English/Farsi/German
switching without losing an unsaved name, retained Iranian preference, saved Gregorian selection,
German DD.MM.YYYY controls, the full German Iranian activities calendar, activity completion
across reload, decimal-comma creation and exact four-place amount editing after the server write.
The German missing-record recovery screen and composer labels were also checked. Authored demo
records, external product names and stored identifiers remain content. No email was sent.

The verified app runs separately on local port 3103. External OAuth/Gmail delivery and production
Docker/deployment acceptance remain installation-specific; they are not inferred from local
translation checks. The user's repository remains an open source fork of sneg55/warpdrive, with
upstream history and MIT attribution preserved. Concurrent unpublished interface redesign work
in the original checkout remains separate from this qualified source.
