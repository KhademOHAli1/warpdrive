# Workflow lifecycle and library contract

Date: 1 November 2026. Status: implementation decision draft for the bounded WF-010/WF-016
milestone. This document specifies intended behavior for implementation review. It does
not establish completed source, database, browser, provider or production acceptance, and
does not require another general user approval to proceed with the authorized roadmap.

Supersession, 2 November 2026: Main accepted only the
[narrow archive-fence reconciliation](/Users/ali/Documents/Codex/2026-10-31/warpdrive-workflow-continuation/outputs/workflow-library-lifecycle-reconciliation-approval.json).
The earlier archive-continuation promises in this draft are superseded below; this does
not accept the remaining lifecycle implementation or establish WF-010 completion. The
[original draft](/Users/ali/Documents/Codex/2026-10-31/warpdrive-workflow-continuation/outputs/workflow-library-lifecycle-original-draft-20261102.md)
is preserved with SHA-256
`e173cd3a615541fb4224aabece74887e2694c7b2b1602b305499a470bb667066`.
The approved [WF-010 plan](implementation-plan.md) is unchanged.

The inspected services inherit workflow head `92a9432`; the managed continuation is
`codex/workflow-roadmap-managed`. Current-main/privacy/migration reconciliation remains a
separate prerequisite for combined qualification. No migration allocation is made here.
Existing immutable versions, synthetic preview data and peer work must be preserved.

## Scope and invariants

Implement archive/unarchive, duplicate, historical-version restore-as-draft and a searchable,
filterable, paginated library. Reuse current owner/capability checks, server actions, tRPC,
shared Radix adapters and locale catalogs. This milestone does not enable automatic CRM
triggers, new action handlers, payload disclosure, retention deletion or provider effects.

- Draft revision, published version and activation are separate facts. Saving/restoring a
  draft never publishes or activates it. Changing a draft never rewrites a pinned run.
- Archival is reversible visibility/admission control. It retains the draft, immutable
  pinned definitions, history and completed effects, and blocks new admission. It does not
  bulk-cancel runs. A later advance observing archived state fails a nonterminal run and
  clears its active deadline. Explicit cancellation remains available while eligible.
  Archival does not globally abort in-flight work or guarantee that no effect commits
  after archive.
- Every read and command checks current actor authority. Unknown/denied IDs reveal no
  definition, version, run, owner information or global count to an unauthorized caller.
- Publication retains its existing validation, executable-handler checks and fresh
  authentication. There is no new implicit administrator/service execution identity.
- Keep database foreign keys and the published-version immutability trigger. No cascade
  deletion or retention policy is introduced as part of archival.

## Current source and required changes

| Boundary | Existing behavior | Required lifecycle change |
| --- | --- | --- |
| [`persistence.ts`](../../src/features/workflows/persistence.ts) | Create, revision save and row-locked immutable/idempotent publish. | Add bounded lifecycle commands and a shared permission/state/revision check; serialize archive/save/publish/restore against the workflow row. |
| [`queries.ts`](../../src/features/workflows/queries.ts) | `listWorkflows` hides archived rows and truncates at 100; `getWorkflow` also requires `archivedAt IS NULL`. | Add bounded query input/cursors and an explicit archived view. Permit authorized archived detail/history reads while returning read-only authoring capabilities. |
| [`runAdmission.ts`](../../src/features/workflows/runAdmission.ts) | `admitManualRun` locks an active, nonarchived workflow and pins its published version. | Preserve the archived admission refusal and prove its race with archive. Never recreate a run as a side effect of a lifecycle command. |
| [`execution.ts`](../../src/features/workflows/execution.ts) | `advanceWorkflowRun` rejects `workflow.archivedAt !== null`. | Preserve the accepted archive fence: a later advance observing archive fails the nonterminal run and clears its active deadline. Retain current actor/workflow capability, CRM visibility, supported-handler and pinned-version checks. Do not add an `active` requirement to resumed execution. |
| [`runDetail.ts`](../../src/features/workflows/runDetail.ts) | Historical reads call `getWorkflow`, so archived history is currently denied. | Use an authorized read path that includes archived workflows; retain same-workflow pinned joins and withholding of stored trigger/output payloads. |
| [`runControl.ts`](../../src/features/workflows/runControl.ts) | Cancellation locks the run, rehydrates the actor and checks cancel capability; no archive predicate. | Preserve cancellation for an authorized archived run and its existing terminal-state behavior. |
| [`access.ts`](../../src/features/workflows/access.ts) / [`router.ts`](../../src/features/workflows/router.ts) | Six capabilities and owner visibility; list has no input schema. | Keep current privilege boundaries, add validated list/lifecycle inputs, and distinguish read-only archived authoring from cancel/unarchive rights. |

Current `saveWorkflowDraft` does not lock its initial read and its final update lacks an
archive predicate. Merely adding an archive endpoint is insufficient: concurrent lifecycle
operations need a consistent locked state check. Service implementations should rehydrate
the actor at their mutation boundary, following manual admission, rather than accepting a
stale caller permission snapshot as present authority. Existing current-record checks
continue to govern actual CRM effects.

## Command contract

Validate external arguments once with strict Zod schemas. IDs must be UUIDs, expected
revisions positive safe integers, and names trimmed to the existing 1-to-120-character
contract. Commands take a required `AbortSignal`, use the existing `Result`/error-ID model,
and expose no unredacted database exception. Server actions retain live-session and CSRF
checks. UI pending states prevent accidental repeat submission without replacing server
concurrency checks.

Lock the workflow before comparing its expected revision or changing lifecycle state.
Authorize before reporting a revision/state conflict. For an authorized stale revision,
return `WORKFLOW_CONFLICT` without writing. Invalid input uses `WORKFLOW_INVALID`;
missing/hidden/unauthorized objects share `WORKFLOW_DENIED`. Preserve the local draft and
provide reload/copy guidance on conflict rather than silently refreshing over it.

| Proposed command | Authority and source | Atomic result |
| --- | --- | --- |
| Archive | Current edit capability on a nonarchived workflow, expected revision. | Set `archivedAt`, `active=false`, revision + 1 and `updatedAt`; retain draft, published pointer, versions and runs. Hide from default library and reject later admission. |
| Unarchive | Current edit capability on an archived workflow, expected revision. | Clear `archivedAt`, keep `active=false`, increment revision and update time. Preserve the pointer/history; a previously published workflow returns paused, otherwise draft. Publication/reactivation requires its own explicit authorized action. |
| Duplicate | Current view on the persisted source plus create capability, supplied new name and expected source revision. Archived sources may be copied if view remains allowed. | Read one coherent source draft; insert one new workflow owned by the caller, revision 1, inactive, unarchived and unpublished. Copy graph/layout and safe custom names only, with no versions, runs, actors, request keys or connection credentials. Source is unchanged. |
| Restore version as draft | Current edit capability on a nonarchived destination, expected revision, immutable version belonging to that same workflow. | Replace only draft name/graph/layout, increment revision and update time. Leave activation and published pointer unchanged; insert/update/delete no version or run. |

Repeated archive/unarchive requests with an old expected revision conflict; they do not
silently reactivate or overwrite. Restoring an already identical version is still an
explicit draft command and consumes one revision. Duplicate reads saved state, never an
unsaved browser graph; the UI explains that distinction before submitting. All new copies
remain inert until separately configured, validated and published.

Duplication must use a reviewed action-version configuration copier, not a blind clone of
arbitrary JSON. Current `nodeSchema.config` accepts general JSON, including incomplete
drafts; that alone is no secret-safety guarantee. Copy only declared credential-free fields
of supported schema versions, preserving safely representable incomplete configuration.
Unknown fields/versions or an action without a reviewed copy policy fail closed with an
actionable unavailable reason instead of silently copying or stripping unknown material.
Connection/token/secret material and connection grants are never cloned. Free text still
needs user review; no automatic detector can certify that a user never typed a secret into
a title. Future provider nodes require explicit safe-copy/setup behavior before duplication
can accept them. Restore uses an existing same-workflow immutable definition; reusing its
historical references does not validate a revoked connection or authorize execution.

Archived detail is read-only for graph/name/save/restore/publish/run controls. Its permitted
actions may include unarchive, duplicate and cancellation of existing runs, each checked
independently. Do not implement these by making all server mutations trust an archived
read response's generic `edit` flag. Underlying edit authority can allow unarchive while
ordinary authoring stays disabled until the workflow is unarchived.

## Publication, admission and execution races

All definition/lifecycle commands and new admission serialize their state decision on the
same workflow row. Run advancement/cancellation retain their run-row lock. Archive does
not update or lock every run; avoid a workflow-to-run lock path that reverses the worker's
run-to-workflow read order.

- Archive before admission: no new run is inserted or queued. Admission committed before
  archive: retain that run's pinned definition and history. A later advance observing
  archived state fails it without a new downstream effect and clears its active deadline.
  Queue/reconciliation outage does not change the admission boundary. An already in-flight
  transaction may commit; archive is not a global abort or a no-post-archive-commit barrier.
- Archive before a stale save/publish/restore: reject without draft, pointer or version
  changes. Save/restore first increments revision, so an archive using the old revision
  conflicts and must be reviewed against current state.
- Existing publication does not increment the draft revision. If publish commits first,
  then archive with that still-current revision commits, both may succeed in that serial
  order: retain the published snapshot but finish archived/inactive. This is a valid
  outcome, not permission for active archived state. Do not silently change publication
  retry/idempotency semantics while implementing the lifecycle milestone.
- Restoring version 1 while version 2 is active does not change version-2 admissions or
  queued runs. Only a later explicit publication can create/activate version 3. Inactive
  run actors, revoked run rights and newly hidden CRM records still deny effects.
- Cancellation after archive remains independent and cooperative while the run is eligible.
  If the archive fence has already made it terminal, a cancellation retry returns that
  state without rewriting cancellation identity/time. Already committed tasks remain; no
  duplicate compensating task or rollback claim is inferred.

## Library query and presentation

Replace the silently truncated array with a validated server-paginated response such as
`{ items, nextCursor }`. Default page size 25, maximum 100, with one bounded lookahead item.
Allow a trimmed name query of at most 200 characters, explicit archive view, lifecycle
status, permitted owner filter, latest-live-run error filter and declared sort order.
Use parameterized literal substring matching, including safe handling of `%`, `_` and
backslash; verify Persian, German and English queries without modifying stored names or
claiming transliteration/locale collation that the database does not provide.

| Filter / field | Meaning |
| --- | --- |
| Archive view | Default excludes archived; explicit Archived shows authorized archived rows. Unarchive never moves a row directly into Active. |
| Lifecycle status | Draft: no published pointer. Active: published, active and unarchived. Paused: published, inactive and unarchived. Archived is its own visibility state. An active workflow may also have unpublished draft edits. |
| Error / health | Label precisely as latest live run failed. Derive from the latest visible live run for that workflow, with deterministic timestamp/ID ties; simulation failure is not an automatic-workflow failure. Health does not replace lifecycle status or imply the draft is invalid. |
| Owner | `workflows.ownerId`, with an authorized display label. It is the workflow owner, not Mobbin's Created by field. Never infer authorship from this column. |
| Execution identity | Current manual runs execute as `workflow_runs.actorId`, the person starting the run. Display Runs as: person starting the run. Even an administrator running another owner's workflow does not execute as that owner. An automatic execution-owner setting belongs to the later approved identity/trigger work. |
| Sort | Default updated time descending; optional name ascending/descending. Every ordering includes the workflow ID as a deterministic final tie-breaker and is represented in the cursor. |

Apply visibility before filters, latest-run metadata, owner options, counts and pagination.
Regular users see only their currently authorized workflows; administrators retain the
existing explicit bypass. Supplying another owner ID must not disclose that owner's
existence, workflow count or errors. Owner options are derived only from the permitted
scope; do not use an unrestricted user-directory response to populate them.

Cursors contain validated ordering keys, never SQL or authorization. Bind/reject cursor
reuse across changed filter/sort inputs; reset to page one when those controls change.
Explain that updates can reorder a live library between requests; do not promise a frozen
snapshot without implementing one. Never fetch an unbounded list then filter client-side.
Bounded returned rows do not prove bounded query work: examine the latest-run lookup and
pagination index plan on realistic data. Any needed index migration requires the actual
shared allocator check and final combined qualification.

Reuse the existing table/card density and shared input/select/menu/dialog adapters.
Row navigation and contextual actions must be separate keyboard targets. Show owner,
lifecycle, latest-live-run health and updated time without leaking run payloads. Distinguish
no visible workflows, no filter matches, loading, denied and load failure. A matching-empty
state retains the active filter chips and offers Clear filters; the generic first-workflow
message is insufficient. Archived rows expose a visible read-only state and permitted
history/unarchive actions. Show conflicts inline, preserve selection where possible and
return focus to a stable control if filtering/archive removes the originating row.

Archive copy explains that new runs are blocked and a later advance observing archive
fails incomplete work and clears its active deadline. Pinned definitions/history and
completed effects remain; explicit cancellation is available while eligible. Do not
promise to stop all in-flight work or prevent every effect commit after archive. Unarchive
copy explains that the workflow returns inactive. Restore review names the historical
version, current revision and effect on the draft; warn before replacing local unsaved
changes. Duplicate opens the new inactive draft only after a successful command. All
labels, errors, empty states and contextual actions require EN/FA/DE review, Farsi RTL,
German expansion, both themes and narrow keyboard operation.

## Planned acceptance matrix

These are tests to write and observe failing before production implementation. No result
is claimed by this matrix. Persistence/concurrency tests use real disposable PostgreSQL
and the actual reconciled migrations, without database mocks. Existing baseline tests do
not prove these new semantics.

| ID | Scenario / boundary | Required assertion |
| --- | --- | --- |
| LC-01 | Archive a published active workflow | Revision increments once; inactive/archived state commits; draft, pointer, versions and runs remain byte-for-byte unchanged. |
| LC-02 | Archive admission race, both serial orders | Archive first creates no run; admission first retains exactly one run with its pinned definition/history. A later advance observing archive fails it, clears its deadline and creates no new downstream effect. |
| LC-03 | Partial run, archive, worker restart/reconciliation | Completed steps/effects and the pinned definition remain unchanged. After restart, an advance observing archive fails without replay or a downstream task and clears its active deadline. |
| LC-04 | Archive then explicit cancellation | While queued/running/waiting and authorized, explicit cancellation records actor/time and prevents later steps; completed effects remain. If the archive fence already made the run terminal, retry returns that state without rewriting cancellation identity/time. |
| LC-05 | Archive fence and current-authority/CRM controls | An advance observing archive fails without an effect. Eligible nonarchived controls still deny revoked run rights, inactive actors and newly hidden records; do not remove the archive fence to reach a later CRM check. |
| LC-06 | Archived detail, versions and run history | Current view can read safe configuration/metadata; authoring/admission disabled; stored trigger, outputs and credentials are not added to responses. |
| LC-07 | Hidden workflow/archived history, outsider or inactive actor | Reads and every lifecycle/cancel command deny without exposing records; test stale pre-deactivation actor objects as well as fresh sessions. |
| LC-08 | Unarchive formerly active and never-published workflows | Both return inactive, revision increments, pointer/history preserved; admission fails until explicit qualified publication/reactivation. |
| LC-09 | Stale archive/unarchive/save/restore revision | Conflict with zero writes; current draft/pointer and local unsaved input remain recoverable. |
| LC-10 | Concurrent archive versus save, both lock orders | Save first makes stale archive conflict; archive first rejects stale save. No active archived row or lost draft update. |
| LC-11 | Concurrent archive versus publish, both lock orders | Archive first blocks publication; publish first may create one immutable version then archive it inactive. Preserve valid pointer and publication retry behavior. |
| LC-12 | Concurrent unarchive/publish/restore | No publication while archived; stale revisions conflict; no silent reactivation, version rewrite or mixed name/graph snapshot. |
| LC-13 | Duplicate a saved source and an archived source | New caller-owned inactive unpublished revision-1 draft; safe graph/layout copied; no versions/runs/effect identities and no source mutation. |
| LC-14 | Duplicate capability combinations | View without create and create without source view both deny. Source edit/publish authority is not required or copied; new ownership grants no CRM permission. |
| LC-15 | Duplicate stale source / unknown or credential-bearing config | Source-revision mismatch conflicts; unreviewed configuration fails closed; tokens/secret grants never appear in the new draft, logs or error payload. |
| LC-16 | Restore older immutable version while newer version is active | Only draft name/graph/revision change; active pointer and old/new pinned runs remain; later publish yields a new version rather than overwriting either source. |
| LC-17 | Cross-workflow or missing version ID | Restore denies without copying another workflow's configuration; malformed ID/revision is rejected before SQL writes. |
| LC-18 | Database failure or abort before lifecycle commit | Archive/unarchive/duplicate/restore roll back all their changes; no partial new row or graph/name mismatch. Cancellation propagates. |
| LC-19 | Database immutability and referential guards | UPDATE/DELETE of published versions still fail; wrong-workflow pointers and pinned-version references still fail after lifecycle commands. |
| LC-20 | Search/filter/owner/error visibility and query bounds | Apply permissions on server before lookups/counts; correct lifecycle/latest-live error meaning, no simulation contamination and no hidden owner/count leakage. |
| LC-21 | Pagination and sorting with equal names/timestamps | Deterministic ID tie-breaker, bounded pages, usable next cursor and no omission/duplicate on unchanged data; changed-filter cursor rejected/reset. |
| LC-22 | Persian/German/English search and malformed input | Literal wildcard characters do not broaden search; query/name limits, UUID/cursor/schema validation and mixed-language stored text are preserved. |
| LC-23 | Archived and no-match library UI | Correct read-only badges/actions, owner versus run-actor wording, retained filter chips/Clear filters, loading/failure/denied distinction and conflict recovery. |
| LC-24 | Keyboard archive/duplicate/restore/history journeys | Actual shared Radix focus handling; removed-row fallback, unsaved-draft warning, pending/error behavior and EN/FA/DE narrow/light/dark review. |

After targeted red/green real-PG and UI qualification, run the required types, translation,
format/lint, builds and exact-revision CI in coordinated resource slots. Update the task
ledger and public guide only to the scope actually qualified. Privacy inventory must add
reviewed new writer/source IDs and any changed payload digests without claiming lifecycle
erasure/retention support. No customer communication, provider operation, deployment or
destructive cleanup is authorized merely by implementing these reversible controls.
