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
CONN-001 through CONN-003, CONN-023, QA-001/002 and seven reviewed UX design tasks are complete:
**37 of 446 tasks**, with 409 remaining planned. [Prior provider foundation qualification](provider-contract-qualification.md)
records its exact source and evidence. [The current foundation batch](foundation-qualification-20261031.md)
separates new focused checks from pending broad qualification.
Design closure does not implement their future grant, event, lifecycle or sandbox behavior.

UX-001 through UX-005, UX-007 and UX-009 have reviewed flow/pattern/copy, fresh Mobbin,
Farsi terminology and regional/date scenario evidence. Current digit-display restrictions,
week-start coupling and unsupported recurrence remain explicit. The local fake harness and
synthetic CRM factory passed their bounded contract/fixture checks and independent review.
Current-source standalone types passed; broad unit validation was deliberately interrupted
at critical disk pressure and other broad gates remain pending. These closures do not qualify
browser geometry, accessibility, live providers or future runtime journeys.

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

The web preview on 3160 is deliberately stopped during shared disk/swap pressure. The broad
unit run was also deliberately stopped when free disk reached 373 MiB; its workers exited.
Source review continues, while test/build campaigns remain held. Use agreed sequential
windows after stable headroom returns; recheck ownership, free space and restart instructions.

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
