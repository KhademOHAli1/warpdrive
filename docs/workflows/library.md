# Workflow library and lifecycle review

WF-016 / [issue #673](https://github.com/KhademOHAli1/warpdrive/issues/673) extends the
qualified WF-010 lifecycle backend. Source and check results are maintained in
[PR #959](https://github.com/KhademOHAli1/warpdrive/pull/959). This guide does not establish
main integration, native/human journey acceptance, release, deployment or installation.

## Server pages and metadata

`listWorkflows(db, actor, signal, options?)` retains its required third-argument signal.
Its successful value is a page: `items`, `nextCursor`, `scopeHasItems` and current
`capabilities.create/filterOwners`. It no longer returns a truncated array.

Strict options are trimmed literal name search (maximum 200 characters), current/archived
view, all/draft/active/paused lifecycle, optional owner UUID, all/latest-live-failed health,
updated-desc/name-asc/name-desc sort, page size 1–100 (default 25) and an opaque cursor.
Archived view accepts only all lifecycle status. An empty cursor means the first page.
Unknown fields, invalid UUIDs, malformed/mismatched cursors, NUL text and invalid limits
are rejected. A regular user's own owner filter is redundant; any foreign owner is denied.

Every request rehydrates current authority before reading visible rows. Current archive
scope and admin/owner visibility precede returned owner labels, latest-live summaries,
filters, paging and existence. `scopeHasItems` describes only that authorized archive
scope before user filters. It is not a global count or a hidden-workflow existence signal.
The page and existence observation use one PostgreSQL statement snapshot.

Items contain workflow identity/name/revision, publication/active/archive/update metadata,
explicit lifecycle, owner ID/name, latest live-run ID/status/time and independent row
archive/unarchive/duplicate capabilities. Drafts, definitions, stored triggers/outputs,
permission grants, owner emails and directory roles are withheld. Ownership describes
saved workflow provenance; runs still use the person starting the run.

Lifecycle and health are separate. An active publication remains Active when its saved
draft changes. “Latest live run failed” considers only the newest live run ordered by
creation time and ID; simulation does not change this badge. A later live run supersedes
an older failure, regardless of its status. This is not a draft-readiness verdict.

Pagination reads at most limit+1 and returns at most limit. Updated order uses timestamp
and ID descending; cursor timestamps come directly from PostgreSQL with six fractional
digits, preserving precision beyond JavaScript Date. Name ordering uses explicit C
collation and the same ID direction for both ordering and keyset comparison. It promises
deterministic database order, not language-specific German or Persian collation.
Search escapes percent, underscore and backslash as literal substring characters.

Cursor fingerprints bind normalized filters, sort, limit, current actor ID and current
admin/owner scope. They are consistency checks rather than signatures or permission
tokens. Every continuation reapplies current authorization. Permission/scope or filter
changes can require returning to page one; concurrent writes can reorder live results.
A bounded response alone does not establish bounded query work or production latency.

`listWorkflowOwners` is an admin-only, view-authorized endpoint. It returns distinct
owner ID/name options only through visible workflows in the selected archive scope,
with literal label search, UUID order and bounded continuation. It does not query a
free-standing user directory or disclose counts/emails/roles. Ordinary users have no
owner picker and cannot call this endpoint successfully.

## Library and editor behavior

The library distinguishes initial loading, confirmed scope empty, filtered no matches,
empty continuation and read failure. Cached same-key rows can survive transient failures;
new-filter placeholder rows are not confirmed matches. Confirmed denial removes stale
rows and controls. Current server capabilities supersede stale server-page create hints.
Filter/sort/archive changes restart paging; return navigation retains validated internal
library context. Return URLs accept only `/workflows` and declared query keys.

Templates opens the existing starting-point dialog: blank manual workflow or the actual
deal follow-up template. It does not introduce a reusable-template service or automatic
trigger engine. New workflows and duplicates remain inactive and unpublished.

Archive/unarchive/duplicate/restore invoke their own backend commands with current source
revision. They do not implicitly save an editor draft. Archive changes metadata while
retaining authored local name/graph. Archived authoring and run admission are read-only;
unarchive, duplicate, history and cancellation have independent rights. Unarchive returns
inactive and cannot infer publish/run permission; a current read supplies those rights.

Version review reads immutable versions of the same workflow by integer version number.
Restore identifies the current revision, warns before replacing unsaved input and changes
only the draft after a successful response. It adopts the returned saved baseline/history,
without publishing, activating or changing pinned runs. Failures and conflicts retain the
local draft. A current read never silently rebases dirty local content onto a newer
revision; clean reconciliation adopts the complete saved baseline together.

Confirmed write acknowledgements survive later read/navigation errors. A copied workflow's
new ID is retained; Open copy retries only navigation. A lost response has unknown commit
outcome and requires explicit reconciliation before another command. Browser navigation
returns no completion promise. Shared dialogs/menus and exact-opener or stable fallback
focus are required; local component tests do not prove native focus, RTL, theme or screen
reader acceptance.

Archive retains publications, versions, history, completed effects and pinned runs. It
blocks new admission; a later advance observing archive fails incomplete work and clears
the active deadline. It is not bulk cancellation or a global in-flight effect barrier.
Cancellation acknowledgements describe the actual returned terminal status, including
completion races; a failed later history read must not cause another cancellation.

## Qualification checkpoint

The tests-first baseline at `8d05b4a38ee4c9c08b8fb0b6825ba9534887f76b` ran against real
PostgreSQL in CI41731549474. Its sole intended assertion failure received the old array of
61 owned workflows instead of the required page. Setup and row-count controls passed;
3,520 other database cases and 9,458 unit cases passed (3 existing skips). The subsequent
page-length and hidden-metadata assertions were not reached. Types/lint/sites/Delivery
passed; later app/server builds were skipped after the expected failure.

Focused local checks passed 47 editor/save/navigation cases and 73 library/filter/loading/
focus cases at their recorded source cuts, with direct source witnesses and cleanup.
The first library run exposed an access-recovery modal defect; its failure and the narrow
repair are retained. An earlier 46-case editor command passed but lacked complete source
witnesses because a separate Vitest module cache was initially missed; that TRIAGE result
and cache-boundary correction remain preserved. The later checks explicitly disabled that
cache and used private Vite/Bun cache paths. Shared-component/dependency fallbacks limit
these to local focused source evidence.

Full public-head types/lint/PostgreSQL/build qualification, the recorded synthetic query
plans and complete LC20–24 source qualification remain pending at this checkpoint. Exact
source/logs and original failures must be retained. Native journeys, current-main
integration, broader dependency acceptance, release, deployment and provider/installation
gates remain separate and open.
