# UX and synthetic foundation qualification, 31 October 2026

This batch continues the active 446-task programme. The earlier full qualification at
`89adc81` remains historical. Current source additionally adopts clean auth/workflow cuts,
the mail owner's isolated queue/privacy patch, narrowly corrected integration copy, and
local test foundations. New full validation is resource-gated after freezing the code below.
No external provider or published installation is involved. Frozen application/test source:
`bc40519b4f8f7147f6232897c26450bb8c478816`; later record-only commits may share its gates.

## Source and ownership

- Auth `a1a8f6d` adopted by merge `d32b7a7`; workflow `d0c83e8` by `b8b2708`.
  The [source inventory](peer-adoption-20261031.md) identifies exact deltas and exclusions.
- Mail runtime-safety `aab6c3d` adopted separately as `6b71b77`. This observes pg-boss
  background errors before startup without inspecting payloads, preserves native retry and
  fatal startup failure, sanitizes framework startup errors, and disables development
  server-action argument logging. The installed Next logging guide confirms that option.
- Larger MAIL source `297c1dd` and its combined migration candidate are not adopted by
  this record. [Reserved integrated MAIL migrations](migration-allocation.md) also include
  separate delivery-observation and notification-binding reservations; their DDL is not accepted.
  Do not allocate competing numbers or reuse timestamps older than platform 0084.
- Incoming 586-slot planning edits remain peer-owned and unimported. No bulk staging,
  peer dirty-tree copying, public push or installed peer ledger rewrite occurred.

## UX scope and evidence

[Flow/pattern/copy specification](ux-flows-patterns-copy.md) maps existing member/admin
discovery, detail, consent, resource/configuration, health/error/reconnect and removal
journeys. It identifies current shadcn adapters for provider/account/permission/recovery
and history patterns, with guarded FA/DE/EN availability terminology. The full future state
matrix is a design specification, not implemented lifecycle or delivery UI.

[Fresh Mobbin research](mobbin-research-20261031.md) records five directly inspected flows
and 21 frames covering integration, automation, permission review and app management.
It attributes adaptations and limitations, including absent update-permission-diff research,
and redistributes no source-product assets. Reference captures do not qualify Warpdrive
locales, browser geometry, accessibility, upstream APIs or provider execution.

The narrow UI changes preserve layout and current controls. The overview counts saved
rows, matching its tab badge, without claiming active authorization or health. Access-check
success describes the actual check. Slack removal explains immediate local blocking,
fallible remote revocation and retained records/already-sent messages. Catalog and market
copy distinguish code in this version from a planned installation capability.

Observed test-first evidence:

- Initial truth-copy tests failed nine cases, then the focused integration suite passed
  121 tests across 24 files. Catalog/market wording added four expected failures before
  the expanded suite passed 124 tests across 24 files.
- Connection-specific retention/removal wording first failed its three locale cases.
  The final narrow suite passed all 12 cases, covering FA/DE/EN with calendar, numbering
  and timezone supplied independently. These are DOM/component checks, not browser or
  actual account authorization tests.
- Scoped Biome checks passed all six changed UI/test/catalog files. The complete static
  i18n inventory passed with no catalog issues or new source findings. This does not
  establish full translated browser journeys.

Independent final UX review passed with no remaining findings after the queued/no-send-start,
saved-counter, historical-source and natural-language corrections. The reviewer also accepted
all four UX-002 evidence areas against the exact task. UI code is committed as `4099c9f`;
the seven design-task records are committed in `87809b8` and accepted in the live register.
[Farsi terminology](farsi-terminology.md) and [regional/date scenarios](regional-date-scenarios.md)
also passed independent review after correcting path attribution, calendar-field wording and
the guard required before saying no message was sent. Existing digit/week-start restrictions
remain explicit; no recurrence, ICS or provider-sync capability is implied.

## Synthetic provider and CRM fixtures

The [fake-provider record](fake-provider-qualification.md) supplies local CONN-023 evidence,
committed as `45b722b`.
Independent review passed all 46 combined harness/contract cases after the empty-scope
regression was corrected. In-memory fixture behavior does not qualify a native provider,
production credential broker, network protocol, database authority or sandbox isolation.

Reusable CRM fixture hardening is committed as `bc40519`. The first real-PostgreSQL review run caught
four intended timeout/acquisition/abort defects; its positive valid OAuth refresh control
passed. The first correction passed 13 PostgreSQL/startup validators. Independent review
then reproduced an unbounded idle shutdown using an isolated loopback protocol-fault stub
that withholds socket close. That is transport-fault evidence, not a simulated database used
for CRM query claims. A separate owned socket and bounded close corrected that regression.
Final observer/half-open units passed 2/2 and the final one-worker PostgreSQL/startup profile
passed 13/13. Scoped Biome/ESLint and final independent source review passed. Broad gates
below remain pending; the owning fixture record describes current-model scope and limits.

## Current validation and service state

| Gate | Current evidence |
| --- | --- |
| Runtime-safety focused units | 26 passed across four unit-classified files at `6b71b77`; worker wiring belongs to the real-PG lane and was not counted here. |
| Integration-copy components | 124 focused cases before final wording refinement, then all 12 final narrow regressions passed; broad rerun pending frozen source. |
| Provider harness/contracts | Independent 46/46 pass; scoped checks recorded in its owning document. |
| CRM fixtures | Final 13 PostgreSQL/startup validators and two transport helper units passed after both review corrections. |
| Standalone typecheck | Route generation and no-emit TypeScript passed on frozen source. |
| Full current unit lane | Started with two workers; deliberately terminated with exit 143 at 373 MiB free disk before a final result. Incomplete, no aggregate pass claim. |
| Relevant PostgreSQL selection | 64 files selected, including auth, workflow, fixture and queue/worker coverage; broader rerun not started. |
| Current build/full lint/worker/UI gates | Not started in this window; resource-gated. Do not transfer the prior full counts. |
| Actual app runtime | Web 3160 deliberately stopped during shared disk/swap pressure; no current healthy-web claim. |

The mail owner completed its exclusive five-file PG window with 22 passing cases, then
released the window. This programme's fixture campaign is sequential with one worker;
broad campaigns and builds are not overlapped. Only owned ignored build caches were
reclaimed. PostgreSQL, worker, realtime, S3, peer services and private data were preserved.
Fresh free-space checks precede each heavier campaign, with the agreed 5 GiB minimum.

The independent clean qualification clone was moved from the Documents work folder to
`/tmp/warpdrive-integration-qualification-20261031` after source/ownership checks, preserving
its own Git metadata and dependencies. This prevents future generated-file churn in the
Documents file-provider tree. Read [restart](restart.md) before resuming services or gates.

At 15:36 UTC the Data volume had only 373 MiB available. The owner verified and terminated
only its Vitest parent, then verified the parent and two workers exited. Space recovered
to about 2.1 GiB, still below the agreed start threshold; swap used about 19.6 of 20 GiB.
No new test/build/type campaign or preview start followed. This is a resource interruption,
not evidence of failed assertions or a completed broad suite. No shared process, user data,
global cache or Docker resource was deleted.

The 37 completed rows include CONN-023 and QA-002 because their recorded bounded contract
and fixture acceptance is executed and independently reviewed. Those rows explicitly retain
the broader current-source regression limitation. UX-013 and QA-005 remain open: their new
asset and authorization audits identify concrete appearance/sanitization and authority gaps.
The programme goal remains active, with 409 rows planned and no release/live-provider claim.
