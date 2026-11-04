# Workflow trigger and action picker

Checkpoint: 4 November 2026, 08:27 UTC. This WF-018 source increment implements the
accepted picker behavior for the finite catalog below. It is a private candidate with
focused component/pure evidence, not whole-candidate qualification, native acceptance,
issue closure or release approval. No pull request has been created for this picker
candidate at this checkpoint.

## Catalog and search

The picker groups all seven existing version-one entries under Triggers, CRM, Logic
and Timing. Search matches localized category, title and description in English,
German and Farsi. Persian/Arabic character normalization applies consistently to query
and searchable text. Descriptions remain visible, and no-match feedback offers Clear.
Wait bounds use the selected numbering system.

| Entry                 | Selection and support                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Manual trigger        | Opens the existing manual entry's inspector; never inserts a second trigger.                         |
| Record-change trigger | Visible with an unavailable-handler explanation; not selectable.                                     |
| Read deal             | Inserts the existing deal-read configuration; other record entities are not advertised as supported. |
| Create task           | Inserts the existing subject/optional linked-deal task configuration.                                |
| Notification          | Visible with an unavailable-handler explanation; not selectable.                                     |
| Condition             | Inserts the existing supported scalar-condition configuration where the graph permits it.            |
| Wait                  | Inserts a literal duration wait; reference-bound durations are not advertised as supported.          |

Catalog presence is not execution support. The picker adds no handler, trigger
execution path, provider adapter, extension loader or database schema. Existing
configuration/publication/runtime validation continues to refuse unsupported variants.

## Authority and prerequisite information

The protected `workflows.palette({id})` read uses a strict UUID, current actor hydration
and existing workflow view/owner/admin checks. Missing, hidden, inactive or revoked-view
access returns a safe denial. The response is bounded to workflow ID/revision, an
authoring decision and seven entry states. It omits actor/owner flags, saved definitions,
CRM records and outputs, connection identifiers and secrets.

Workflow edit permission controls authoring. Create, publish and run do not replace
edit. Archived workflows remain read-only, including for administrators. Fresh negative
authority overrides a stale positive client prop. A positive metadata read is a
snapshot, not an execution grant or authority token.

Missing `activity.create` or the active task activity type produces a distinct task
execution-prerequisite warning. With workflow edit permission, users can still configure
an incomplete draft. These warnings do not change the existing draft-save policy.
Actual target-record visibility, configuration and execution permission are checked
again by the existing backend operations.

Offered local paths say that no external connection is required. The unsupported record
trigger and notification say provider readiness is not assessed because their handler
journey is unavailable. Neither state means a provider is connected, ready, authorized
or qualified. This increment performs no provider setup, consent, delivery or write.

## Compatible input and graph behavior

Input context comes from the current local draft, independently of the server metadata.
A connected request exposes the selected source and its actual ancestors, with localized
step names, field labels and step numbers. Sibling-branch and descendant values are
excluded. A deal ID means the manual trigger's record ID or a deal-read ID, not every
string output. No CRM values or runtime output payloads are shown.

Detached insertion has no trustworthy upstream context. Missing mappings are explained
as incomplete configuration, not confused with unavailable handlers. Newly generated
references to detached/nonancestor sources are removed; literal defaults and all existing
nodes remain unchanged. The existing inspector can configure the resulting draft.

Selection rechecks current edit/metadata confirmation, source existence, port, occupancy,
supported type/version and the 100-node insertion limit. Occupied outputs admit the
existing linear read/task/wait splice; Condition stays visible with a linear-insertion
reason and cannot mutate the graph there. A free valid output can add a Condition.
Direct or repeated callbacks obey the same guards as visible controls.

Successful insertion changes the graph once, preserves existing node/configuration
objects and connection/layout behavior, then selects/reveals the new node and focuses
its Step-name field. Opening the existing manual trigger returns the original graph
without creating undo history or dirty state. Rejected choices keep the picker open.
Escape/cancel restores the actual opener or an enabled stable fallback. Existing
numbering and undo/redo behavior remain in use.

## Read and recovery states

The expected workflow key is required to confirm metadata; another workflow's response
cannot authorize selection. Initial or revalidation loading cannot appear as no matches.
Same-key cached descriptions can remain visible after a transient read error, with
selection disabled and one read-only Retry. Confirmed denial hides cached metadata.
Search and the unsaved local draft remain intact through read recovery.

Queries are network-disabled outside an open, valid workflow context. The real query
owner mounts for each opening and is keyed by workflow ID. Retry is single-flight for
that owner. Retry, reopening or metadata refresh never replays a prior graph insertion,
saves the draft, publishes or runs a workflow.

## Evidence at this checkpoint

Before production changes, the original component baseline actually executed seven
cases: three existing-behavior controls passed and four intended missing-behavior
assertions failed. The failures were category grouping, category search, unavailable
record-trigger discovery and unavailable-notification discovery. This was behavioral
RED, not a missing export, import, collection or setup failure. The original baseline
bytes and raw failure receipts remain preserved separately from its adapted final fixture.

The current focused run passed **84 cases across 11 test files**: 52 new pure/UI/adapter
cases, seven adapted baseline cases and 25 retained legacy cases. Its guarded execution
took 11.054 seconds using Bun 1.4.4, one worker, no environment-file loading and private
caches. All 29 required direct source witnesses matched frozen raw bytes; 350 compared
pins held. The owned process group and temporary dependency link were removed.

Twelve new real-PostgreSQL palette cases are defined but **UNEXECUTED**. Focused UI
fixtures do not prove database authority, task-type reads or denial races. The private
receipts are `work/workflow-675-picker-baseline/` and
`work/workflow-675-complete-focused/`; the integration coverage handoff is
`outputs/675-COVERAGE-AND-LIMITS.md`.

Full same-head hosted qualification, configured types/typed lint, real PostgreSQL,
application/bundle/site builds, native UI/AT/copy review, source-inventory generation,
main integration and release acceptance remain open for this candidate. Its current
parent is the published WF-016 cut `a9f28da`; that parent's separate PostgreSQL run
recorded 26 date-related failures and 3,537 passes. The integration owner is preparing
that forward repair, and this picker must inherit the published repaired parent before
its own hosted qualification. The parent's result is not a result for the picker.

WF-007's broader registry/schema acceptance, WF-009's identity/connection/payload
authority and WF-017's complete canvas/keyboard/AT acceptance remain open. Nothing in
this checkpoint accepts those dependencies, closes issue #675 or claims provider
readiness, deployment or production release.
