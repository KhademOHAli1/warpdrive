# Visual workflow implementation status

Updated: 31 October 2026. Branch: `codex/visual-workflows`. The branch incorporates fork main
`8539fe8`, including Better Auth and its current UI, and remains separate from other active
checkouts. No workflow changes have been merged into main by this work.

## Current milestone

The connectable manual node builder is implemented: choose a blank canvas or follow-up
template, insert nodes, drag/save positions, draw/reconnect/remove edges, configure exclusive
conditions and ancestor mappings, save, publish with fresh authentication, choose a visible
deal, simulate or execute in the background, inspect coarse history, and cancel. A focused
canvas and per-node connection selects complement the regular editor. English, Farsi RTL,
and German retain the existing application shell.

Supported execution is manual start, reading a visible deal, strict text/boolean conditions,
and undated follow-up tasks assigned to the initiator. Conditions offer equals, not-equals,
exists, and string contains; only one branch executes. Other registry entries, money/numeric
comparisons, and additional activity fields remain blocked. This is an early-access milestone
within R1, not completion of the approved 42-task plan.

The root README, documentation index, introduction, architecture, setup, updating,
contributing, regional-settings guide, workflow user guide, and operations notes were
refreshed. The index now also links the merged authentication documentation.

## Task ledger

| Tasks      | Current state and remaining scope                                                                                                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF-001–004 | Inventory, ten-flow Mobbin research, release scope, journeys, and screen specifications recorded. Implementation reconciled with merged Better Auth main.                                                                                                                                                       |
| WF-005–006 | Working manual-flow UI and execution contracts implemented; remaining prototype states and broader execution semantics stay open.                                                                                                                                                                               |
| WF-007     | Initial schemas, graph validation, typed ancestor bindings, JSON safety, and exact-money typing implemented. Dynamic CRM metadata remains.                                                                                                                                                                      |
| WF-008–010 | Definitions/versions/runs/steps, six capabilities, owner checks, revision saves, immutable/idempotent publication, and pause implemented. Events/effects/attempts, retention, archive, duplicate, and restore remain.                                                                                           |
| WF-011     | Transactional CRM trigger outbox not implemented.                                                                                                                                                                                                                                                               |
| WF-012–014 | Manual admission deduplication, version pinning, resumable cursor, worker boot/minutely reconciliation, current authority, and atomic database effects implemented. Automatic dispatch, waits, external effects, ambiguous outcomes, quotas, and needs-review remain.                                           |
| WF-015     | Manual deal-to-task slice verified with real PostgreSQL and real pg-boss, plus the browser journey. See evidence below.                                                                                                                                                                                         |
| WF-016–020 | Library/routes, blank/follow-up creation, connectable draggable nodes, persisted positions, explicit edge reconnection/deletion, auto-layout, focused view, step/connection controls, and typed ancestor mappings implemented. Library search/filter, undo/redo, richer lifecycle, and dynamic metadata remain. |
| WF-021     | Deal read and undated self-assigned task creation implemented. Other CRM actions remain.                                                                                                                                                                                                                        |
| WF-022–024 | Basic exclusive text/boolean conditions and both branch paths implemented and tested. Grouped AND/OR filters, money/numeric comparison semantics, durable delays, and controlled email remain.                                                                                                                  |
| WF-025–028 | Published-version simulation, publication validation/fresh authentication, coarse run history, polling, and cancellation implemented. Draft simulation, impact review, payload inspection, manual retry, and alerts remain.                                                                                     |
| WF-029–038 | Three complete R1 acceptance templates, calendar recurrence/business calendars, webhooks, provider actions, approvals, iterators/parallelism, sub-workflows, and extensions remain.                                                                                                                             |
| WF-039–040 | Initial English/Farsi/German catalogs, localized formatters, RTL, shared Radix controls, keyboard step selection, and browser checks implemented. Full state/accessibility review remains a release gate.                                                                                                       |
| WF-041–042 | Initial local qualification and documentation recorded. Retention, budgets, infrastructure failure handling, complete security/operations review, and production release remain open.                                                                                                                           |

## Verification

Evidence on the merged Better Auth baseline:

- Full unit suite: **5,753 tests across 930 files passed**, under root Bun 1.4.4.
- Workflow integration suite: **21 tests across seven files passed**, using real PostgreSQL
  and the actual migration chain through `0083_visual_workflows.sql`.
- The pg-boss test boots a real queue instance and recovers a partially completed run.
- Database tests cover concurrent/idempotent publication and admission, stale drafts,
  immutable snapshots, pinned runs after republishing, competing workers, exact-one task
  creation, simulation rollback and archived-record parity, invalid mappings, deactivated
  users, downgraded/hidden-record access, unsupported action refusal, cancellation, and
  rollback when persisting progress fails.
- Unit coverage includes fresh authentication at publication, typed graph validation,
  explicit graph edits, strict conditional evaluation, localized generated names/status choices, Farsi/German task editing, prototype-safe output resolution, and live language feedback.
- Type generation/typecheck and lint passed. Lint retains the existing eleven cookie
  warnings. The broad unit run first caught a page-title token mismatch, corrected and
  verified; a new red test also caught blank task titles, now rejected before publication.
- After the node-builder refinements, **43 workflow unit tests across fourteen files passed**.
  New red-to-green regressions cover retained node measurements, live feedback translation,
  translated status choices with stable stored codes, inherited output-property rejection, and
  responsive camera behavior without unnecessary resets.
  The broad unit run precedes the final measurement regression; the focused run covers the
  current feature sources.
- Application production build: **passed** with the current editor and merged authentication,
  using ignored synthetic build-only configuration.
- Worker/WebSocket/operator bundles: **passed**, including the workflow handlers.
- Documentation production build: **passed**, including the new Farsi screenshot asset and
  link validation. Documentation uses its own declared Bun version and lockfile.
- Application frozen-lockfile install under Bun 1.4.4: **passed without changes**.

Browser checks use a loopback-only disposable database, synthetic CRM records, and a
synthetic test authentication session. They qualify workflow behavior, not real identity
provider/MFA onboarding. Creation and Persian text editing, stale-freshness refusal,
publication, visible-deal selection, simulation, live execution, and completed history
were observed in Chrome. A five-node branch graph was connected through real drag gestures,
reconnected by its endpoint, saved, reloaded, and switched between all three languages.
Database inspection showed zero tasks after simulation, one Persian task after the true-path
live run, and one additional German task after the false-path run. Native Farsi and German templates were created through
the UI. See [UI review](ui-review.md) for current captures and remaining design gates.

No customer records, real provider messages, external integrations, or production
deployment were involved.

## Next implementation milestone

Implement the committed CRM event outbox and automated trigger admission, then grouped
conditions and durable waits. Expand the action/configuration/mapping UI alongside each qualified
handler. Complete the three R1 acceptance templates and the release gates in the approved
plan before describing R1 as production-ready.
