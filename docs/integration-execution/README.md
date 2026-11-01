# Integration programme execution

Persistent goal: active from 31 October 2026, with no token budget. The acceptance
contract remains the 446 tasks across 23 packages in the source project plan.

## Authoritative status

[The live task register](tasks.csv) is the single execution-status source. The older
`docs/integration-platform-tasks.csv`, Markdown checklist and plan-summary JSON retain
the dated starting snapshot. They do not override this register. Preserve all task IDs,
acceptance criteria, stage and dependency scope when updating status. Completion needs
attributable evidence; a narrower implementation subcase does not close a broader row.

The active branch is `codex/integration-platform-preview` in
`/tmp/warpdrive-integrations-preview-20261031`. Git metadata remains in
`/tmp/warpdrive-integrations-20261031`; do not delete either until an independent bundle
restore is verified. Origin still points to a local auth checkout. No push, merge to main,
public deployment or provider installation is implied by local execution.

BASE and ARCH are complete as their recorded runtime-baseline/design-review tasks.
CONN-001 through CONN-003, CONN-023, QA-001/002, AISEC-001/002 and eight reviewed UX design tasks are complete:
**40 of 446 tasks**, with 406 remaining planned. [Prior provider foundation qualification](provider-contract-qualification.md)
records its exact source and evidence. [The current foundation batch](foundation-qualification-20261031.md)
separates new focused checks from pending broad qualification.
Design closure does not implement their future grant, event, lifecycle or sandbox behavior.

The latest application/test source is `7c8bb7ed013ef5eb9543399566bc5175a12df633`.
[The numbering correction and current qualification](numbering-qualification-20261101.md)
records independent digit choices across FA/DE/EN, **6,040/6,040 unit cases in 963 files**,
whole-repository i18n/Biome/ESLint, standalone types, a production Next build and five
compiled worker bundles. These are source/unit/static/compile results. Other native
journeys, full real-PG, providers and release remain separate gates.
The 149 focused cases are included in 6,040, not another total. Task status is unchanged.

[Actual native browser qualification](native-browser-qualification-20261101.md) adds
supported invitation/email/password/TOTP and fresh step-up, six FA/EN/DE account cases
surviving regional-cookie removal, paired rendered previews, and bounded DE geometry/
Escape evidence. R1 refusal and original runner timing failures remain preserved.
The actual R2 window completed and all owned services/context closed inside 20 minutes.
Visual truncation, settled navigation and a visible Next development issue remain open.
This closes no broader UX/security/provider/release task and does not change 40/446.
The [earlier source-only fixture](native-browser-fixture-20261101.md) is historical.

UX-001 through UX-007 and UX-009 have reviewed flow/pattern/copy, fresh Mobbin,
Farsi terminology and regional/date scenario evidence. The later numbering correction resolves the earlier digit-display restriction.
Week-start coupling and unsupported recurrence remain explicit. The local fake harness and
synthetic CRM factory passed their bounded contract/fixture checks and independent review.
Current-source standalone types passed. A later finite four-shard unit campaign passed
all 6,040 cases in 963 files at `7c8bb7e`, after the earlier pressure interruption. These closures do not qualify
browser geometry, accessibility, live providers or future runtime journeys.

[UX-006's trilingual design catalog](locale-copy-review.md) adds 100 messages in each
language, including 45 traced source messages and 55 proposed messages with exact state
guards. Independent copy/source review and all 300 ICU parses passed. The future runtime
bindings, rendered journeys and native-speaker acceptance remain open. See the
[sequential validation record](validation-windows-20261101.md) for the later focused
actor/Slack checks. The later qualification record identifies completed regression gates.

[AISEC-001's operation inventory](mcp-operation-inventory.md) reconciles all 35 current
MCP tools, including indirect effects, with a separately reviewed 58-row source matrix.
Activity reminders can conditionally reach notification email; the inventory includes
that downstream credential path and its missing origin-grant provenance. This is source
inventory acceptance, not granular grants, tool invocation or provider qualification.

[AISEC-002's consent design](mcp-consent-review.md) specifies 37 finite canonical
capabilities in FA/DE/EN, including a narrowly versioned notes-creation addition.
All 555 localized fields parsed as ICU, and independent consent review corrected
conversion disclosure and derived reminder-email admission. AISEC-003 and the actual
grant store/evaluator, resource projection and worker-origin enforcement remain open.

[The earlier 1 November qualification](qualification-20261101.md) records 59 affected PG16 cases,
6,024 full-lane unit cases in 961 files, standalone types and scoped lint, a production
Next.js build and five compiled worker bundles at `d2257ce`. An independent clean clone's
Bun 1.4.4 frozen install passed with unchanged package/lock hashes. Its whole-source lint
failed at Biome with 22 errors before ESLint. After a docs-only correction, the independent
clone passed the full i18n/Biome/ESLint chain at `d238bcb`; the earlier failure remains recorded. Full PG, service/runtime, browser, provider and release acceptance stay open.

## BASE evidence

| Tasks            | Evidence                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| BASE-001/002/003 | [Branch, ownership and eight UI-commit inventory](branch-ui-audit.md)                                                                             |
| BASE-004         | Workflow merge `0894630`, calendar merge `80ba5c4`, regression fixes `a01ca83`, migration red/green and current suite in the qualification record |
| BASE-005         | [Pinned Bun and independent frozen install](local-runtime.md)                                                                                     |
| BASE-006         | [Existing jobs, events and workflow engine](queue-event-audit.md)                                                                                 |
| BASE-007         | [Authorization and account boundaries](authorization-account-audit.md)                                                                            |
| BASE-008/009     | [Isolated service profile](local-runtime.md), [actual service smoke](runtime-smoke.md)                                                            |
| BASE-010         | [Qualification record](qualification.md)                                                                                                          |
| BASE-011         | [Restart and restoration](restart.md), source-only output bundle and checksum manifest                                                            |
| BASE-012         | [First delivery slice ranges](first-slice-estimates.md), copied into the live task register                                                       |

The current integrations UI and all eight refinement commits are preserved. The
integration icon fallback received a semantic foreground fix after the broad unit suite
caught a dark-mode token regression; geometry and provider artwork remain unchanged.

The integration 0083 migration is retained. Committed workflow source is reconciled as
0084 with a combined generated snapshot; its original pinned-version and immutable-version
SQL safeguards remain. The real PostgreSQL test first failed with missing workflow tables,
then passed clean install and upgrade while retaining integration credentials/settings,
existing identity and independent display preferences. Do not renumber historical migrations
on an installed peer database. See the restart record for the divergent-peer upgrade boundary.

## Peer work and next action

Committed Better Auth main `8539fe8`, workflow `b8f25a4` and calendar `9f0e9cc` were in the
prior qualified ancestry. New clean auth `a1a8f6d` and workflow `d0c83e8` cuts are now adopted
through `d32b7a7` and `b8b2708`. See [the new source inventory](peer-adoption-20261031.md).
The mail owner's isolated runtime-safety patch is adopted as `6b71b77`; its larger immutable
MAIL cut and combined migration candidate are separate pending work. Their focused evidence
does not extend the prior full qualification to current source. Other dirty peer work remains
peer-owned. Re-inventory heads and dirty paths before any further adoption.
Do not reset, stash, bulk-stage or copy the peer dirty trees.

The web preview on 3160 remains stopped. The earlier unit run was deliberately stopped at
373 MiB free disk; its workers exited, and that historical run remains interrupted. The later
finite full-unit and production-build windows completed with their own receipts, most
recently for 7c8bb7e in the current numbering record. No service
startup followed. Recheck ownership and fresh headroom, and coordinate each finite next
campaign; no broad campaign is inherited from a completed window.

[Local migration reservations](migration-allocation.md) now carry an execution hold for the
published-main Privacy 83..85 collision. Local 85..93 reservations allocate no global slots;
local 94 is reserved only for MAIL candidate private-intake provenance; local 95 remains
unallocated. An unaccepted work-only reconciliation proposal does not
establish a merged source, installed upgrade, Privacy coverage or accepted numbering.

The ARCH design contracts passed independent scenario review after concrete corrections;
see [architecture acceptance](architecture-review.md) and [evidence taxonomy](evidence-taxonomy.md).
Continue the first UX/QA foundations and shared connection/event/Slack slice under those contracts. Reuse
the committed workflow engine and pg-boss, retaining realtime notifications. The new durable
CRM outbox belongs in the mutation transaction; NOTIFY is not a durable event store.
Coordinate shared connection schema with the independent mail peer via an immutable handoff,
without blocking unrelated local architecture/security work or duplicating its implementation.

Farsi is the first workflow/copy-review language, with German and English in the same
acceptance gate. Language, numbering, Iranian/Gregorian calendar and time zone remain
independent. Provider simulation, real provider validation and public hosting/publication
are separate stages. Continue all locally authorized work without inventing external
resources or treating unrelated external gates as foundation dependencies.
