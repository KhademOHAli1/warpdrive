# Filtered run history: bounded WF027 / #684 increment

This increment adds status and live/simulation filters plus older-page navigation
to one workflow's run history. The original WF027 acceptance criterion also covers
inspector detail, causation and progress through the real-time layer. Those broader
requirements and formal blockers #670, #674 and #682 remain on the issue.

## Read contract and compatibility

The protected `workflows.runsPage` query uses `readRunHistoryPage` and accepts a
workflow identity, optional status/mode filters and optional continuation cursor.
Omitted filters normalize to `all`. The server fixes the page size at 50, fetches
one lookahead row, then hydrates steps and recovery metadata for only the displayed
50. Callers cannot increase the limit.

The existing `workflows.runs` route and `readRunHistory(db, actor, workflowId, signal)`
keep their array response and existing behavior. Retry, submission and cancellation
keep their authoritative mutation acknowledgments when subsequent history reads
fail. Both history query caches are invalidated without resending a mutation.

Every page request rehydrates current server authority and authorizes its workflow
before decoding continuation state or reading run metadata. The returned item
projection retains the existing safe history fields. Trigger values, cumulative
outputs, CRM payloads, retry request keys and session identifiers are not added.
The separate inspector keeps its existing current-access checks and redaction.

## Ordering and continuation

Pages order by `(created_at DESC, id DESC)`. The strict, bounded continuation token
binds its version/type, current actor/owner-admin context, workflow, normalized
filters and fixed page size to the last displayed row's timestamp and identity.
It carries navigation state; current server authorization governs the read.
Malformed or mismatched tokens are rejected after the authority check.

The pagination timestamp is projected directly from PostgreSQL with six fractional
digits in UTC. It is retained verbatim for the SQL tuple boundary. A JavaScript
`Date` or `toISOString()` must not create this key because they discard PostgreSQL
microseconds. Display dates continue through the existing localized formatter.
Internal cursor-key columns are removed before public items are hydrated/returned.

A page is a live read rather than a historical snapshot. New runs and status changes
between requests can change matching membership. No point-in-time snapshot or
exact-time progress-delivery guarantee is introduced.

## User controls

Run status and Run mode are named controls in EN/DE/FA. Their changes clear the
continuation cursor. Older runs follows the next cursor; Newest runs clears it.
Refresh returns to the newest matching page. A different workflow identity starts
with its own first-page state, and old filter rows must not appear under new
filter labels while loading. Loading, empty and read-error states retain useful
filter/recovery controls. Existing active-run polling remains a separate behavior.

Read-only views keep timing/inspection while hiding cancellation. Pending and
acknowledged actions preserve current focus, duplicate-submission protection and
truthful outcomes if a subsequent query fails. Display/calendar preferences do not
change filter values or pagination keys.

## Qualification and remaining gates

The preproduction existing-API baseline recorded three passing controls and three
missing-behavior failures: status, mode and older-page controls. Original baseline
assertions are preserved; later transport-fixture adaptations are recorded against
that freeze. Pure cursor/input/projection, native PostgreSQL pagination/authority and
UI cases have their actual results in the PR and retained qualification receipts.
Definitions, mocks and source review do not establish native execution.

Response row bounds do not bound database scan/sort work. No history index or schema
change is included. Finite representative `EXPLAIN` evidence is diagnostic; installed
volume, latency and capacity qualification remain separate. Actual native/human
journeys, broader inspector/real-time acceptance, included-main CI, release, deployment
and installation acceptance remain open until their own evidence exists.
