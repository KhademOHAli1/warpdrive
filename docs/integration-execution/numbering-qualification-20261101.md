# Independent digit choices: qualification, 1 November 2026

Application/test source: `7c8bb7ed013ef5eb9543399566bc5175a12df633`.
Goal active: **40 of 446 tasks complete, 406 planned**. No task was newly closed for
this bounded correction. Earlier qualification records retain their original source cuts.

## Result and behavior

An explicit Persian (`arabext`) or Latin (`latn`) digit choice now applies in FA/DE/EN,
independently of calendar and time zone. The existing Settings Select is available in all
three languages. Language-only changes preserve an explicit choice; an omitted choice
stays omitted, using FA/Persian or DE/EN/Latin defaults without a render-time save.

DatePicker forwards the choice into its adapters, default triggers, captions, grids and
German accessible labels. Existing date order, month language, caller-supplied labels,
calendar navigation and account-zone Today behavior remain. Its year option values and
Gregorian ISO callbacks stay ASCII. A caller label containing C01234 and a raw ISO date is
preserved even when adjacent picker digits are Persian. Stored numbers and authored text
are not globally rewritten.

The five production files are numberingSystem.ts, LanguageSettings.tsx, DatePicker.tsx,
dateFormat.ts and localizedDayPickers.tsx. A finite 48-key Intl cache includes language,
calendar, digits and style; it excludes arbitrary locale strings and dates. Raw parseYmd,
toYmd and accountToday logic is unchanged. No dependency, schema, migration, auth API or
provider operation changed. The feature README now describes explicit versus default digits.

## Observed test-first evidence

Both REDs ran before production changes at record head c0afff9 plus the saved test-only
patch. The native database was not involved. The existing unit project used pinned Bun 1.4.4
and one worker, with finite deadlines, fresh/live 5 GiB floors, owned groups and source guards.

| Stage                        | Actual result                                                                                                           | Evidence directory or stem                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Preference RED               | 2 failed, 6 controls passed, 8 total; DE/EN returned 12345 instead of ۱۲۳۴۵; group 60867                                | numbering-unit-numbering-preference-red-20261101      |
| Settings/picker RED          | 9 failed, 40 controls passed, 49 total; hidden DE/EN selector and Latin trigger/caption/preview mismatches; group 60929 | numbering-unit-numbering-ui-red-20261101              |
| Initial GREEN                | 57/57 across 6 files; group 63372                                                                                       | numbering-unit-numbering-green-20261101               |
| Refactored GREEN             | 58/58 across 8 files; group 66377                                                                                       | numbering-unit-numbering-refactor-green-20261101      |
| Affected consumer regression | 91/91 across 13 other files; group 66624                                                                                | numbering-unit-numbering-consumer-regression-20261101 |

The final selected total is **149 unique cases in 21 disjoint files**. The earlier greens
are repeated runs, not additional cases. The split moved identical assertions into two
small numbering test files and added one custom-label conservation control. Tests retain
pending/rollback behavior, valid four-axis save payloads, no-save rendering, raw drafts,
calendar/zone changes, civil-date invariance, instant rollover, time input normalization,
number/currency/ICU display and raw year/ISO values. An independent reviewer read actual
reports and the source; no import, setup, stale-CAS or resource failure produced the REDs.

These Settings tests assert the real component's mocked save-action payload, not a real
account-row update or browser sign-in. Existing persistence/schema source accepts the
optional choice; actual native persistence/browser journeys remain a separate gate.

## Complete unit lane and static/compile gates

Every gate below names its actual source. The final full lanes used committed 7c8bb7e;
pre-commit selected/static run-end file hashes were independently matched to its blobs.
Durations are runner observations, not performance benchmarks.

| Gate                     | Actual result and scope                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete unit lane       | **6,040/6,040 passed in 963 unique files**, zero failed/skipped/todo, no missing or duplicate files; exact four-shard partitions 241/241/241/240                        |
| Shard 1                  | group 71222, 95.482s, 1,445 passed; minimum 19,251,961,856 available bytes                                                                                              |
| Shard 2                  | group 73358, 89.191s, 1,596 passed; minimum 19,079,409,664 bytes                                                                                                        |
| Shard 3                  | group 75382, 101.201s, 1,501 passed; minimum 18,976,473,088 bytes                                                                                                       |
| Shard 4                  | group 77708, 92.177s, 1,498 passed; minimum 18,914,172,928 bytes                                                                                                        |
| Scoped Biome             | 13 selected TS/TSX files, exit 0; group 66792, 3.223s                                                                                                                   |
| Scoped type-aware ESLint | The same 13 files, exit 0; group 67085, 9.653s                                                                                                                          |
| Standalone TypeScript    | Whole project `tsc --noEmit -p tsconfig.typecheck.json --incremental false`, exit 0; group 67384, 16.362s; retained route types, not a separate Next typegen invocation |
| Independent whole lint   | Clean clone at 7c8bb7e, complete i18n/Biome/ESLint chain exit 0; group 80483, 45.435s; Biome 3,547 files, zero errors, 11 warnings/nine infos retained                  |
| Production Next build    | `next build --webpack`, exit 0; group 83305, 39.318s; Next 16.4.3, current source and unchanged private profile                                                         |
| Worker compilation       | Sequential build-workers.mjs, exit 0; group 83729, 0.316s; five WS/worker/migrate/sweep-spam/auth-operator bundles, Node 22 target with external packages               |

The installed classifier found 963 unit and 475 integration files. Only the unit lane ran
here. Raw per-file/assertion counters, report hashes, exact SHA1 shard membership and union
coverage reconcile to 6,040. Compared with D225's 6,024/961, the 16 added cases/two files are
accounted for; old assertions remain apart from the three obsolete restriction expectations
replaced by goal-aligned cases and a control parameterized across three locales.

All process groups were empty at their terminal receipts. The initial shard runner detected
surviving descendants but did not forcibly clean them; shard 1 had none, so its result is
valid. Its exact runner is preserved. Shards 2..4 used hardened bounded whole-group cleanup;
none needed cleanup signals. The application source did not change during any shard.

The same nine peer planning files retained their hashes. The scoped list includes 12 changed
TS/TSX files plus the unchanged DatePicker control file. Package/lock hashes were unchanged;
the independent clone retained ordinary dependencies from its earlier frozen install.
The private build profile stayed 0600 with the same hash throughout compilation. Lowest
observed build headroom was 16,836,931,584 bytes. No install, image, service or provider startup
followed from these checks.

## Evidence and remaining gates

Raw evidence is private until sanitized export under `outputs/numbering-20261101`.
The export carries the two RED reports/test patch, later selected runs, all four complete
unit reports, static/lint/build receipts, runner versions and independent review. The
6,040 total already includes the 149 selected cases; do not add them. Historical D225 and
D238 passes keep their old sources and are not relabeled as current runs.

Current full real-PG regression, native account persistence/sign-in, live browser geometry,
keyboard/screen-reader journeys, deployed recovery and actual provider qualification remain
open. Unit/jsdom and compile success do not qualify those stages. Web 3160, realtime 8080 and
the programme worker were absent at the last service inventory; this work started none.
Existing PG/S3 data and keys were preserved. The migration-lineage hold remains in force;
no global number or new local 94 slot was allocated. MCP grants, origin approval, shared
connection lifecycle and transactional authority fences remain separate implementation work.
