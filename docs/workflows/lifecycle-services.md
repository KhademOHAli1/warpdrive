# Workflow draft and publication lifecycle

The WF-010 backend uses the existing workflow row, immutable versions and pinned runs.
The current source and qualification checkpoints are recorded on
[issue #668](https://github.com/KhademOHAli1/warpdrive/issues/668) and
[PR #958](https://github.com/KhademOHAli1/warpdrive/pull/958).
This guide does not establish main integration, user-journey, release, installation or
provider acceptance. The library and lifecycle controls in the UI remain WF-016 work.

Every command requires an AbortSignal. Inputs are strict: UUID workflow IDs, positive
safe-integer expected revisions and trimmed names of 1–120 characters. Current database
authority is checked at the service boundary; a previously hydrated actor is not a
permission grant. Existing publication still requires fresh authentication at its server
action boundary.

## Commands

All existing-row lifecycle decisions serialize on the workflow row. Denied, hidden and
missing workflows share WORKFLOW_DENIED. Current authority is checked before reporting
revision/state information. Authorized stale revisions return WORKFLOW_CONFLICT without
overwriting the saved draft. Invalid input returns WORKFLOW_INVALID.

| Service | Input | Result |
| --- | --- | --- |
| createWorkflow | name, definition | New caller-owned draft. Incomplete structurally valid drafts remain saveable. |
| saveWorkflowDraft | id, revision, name, definition | Change draft/name and increment revision; publication and activation are unchanged. |
| publishWorkflow | id, revision | Validate the saved definition and executable handlers, then publish/activate atomically. Draft revision is unchanged. Same-definition retry reuses the current immutable version. |
| pauseWorkflow | id, revision | Current view and edit authority required. Deactivate and increment revision; existing runs are not cancelled. |
| archiveWorkflow | id, revision | Current edit authority required. Set archive time, deactivate and increment revision; retain draft, pointer, versions, runs and effects. |
| unarchiveWorkflow | id, revision | Current edit authority required. Clear archive time and increment revision; remain inactive, preserving publication/history. |
| duplicateWorkflow | id, revision, name | Current source view plus create authority required. Copy persisted reviewed configuration into a new caller-owned revision-1, inactive, unpublished and unarchived draft. Archived sources are eligible. |
| restoreWorkflowDraft | id, revision, versionNumber | Current edit authority on an unarchived workflow required. Replace only draft name/definition/layout, increment revision and update time. The immutable version must belong to that same workflow. |

Restoring an identical version still consumes a revision. Restore never changes activation,
the published pointer or existing runs. A later explicit publication can create a new
version. Unarchive never implicitly reactivates a previously published workflow.

The four new lifecycle commands return a safe WORKFLOW_WRITE_FAILED on a database failure.
Cancellation rejects with its original reason, with changes rolled back before commit.
Do not interpret a transport failure as proof that a command was rejected: reread current
state and revision before deciding whether to retry.

## Copy policy

Duplication has explicit credential-free policies for the seven current v1 action types.
It preserves graph/layout, custom names, declared CRM references and representable
incomplete known configuration. It does not require execution readiness and does not
enable unsupported handlers. Publication and execution retain their existing checks.

Unknown versions, actions, config fields, mixed/unknown binding fields and connection or
authority fields fail the entire copy. Nothing is silently stripped. The result is
WORKFLOW_NOT_READY with the stable reason `copy-unavailable`, without raw config or error
details. Known free-text literals still need human review; the copier cannot certify that
a user never typed a secret into a title. Runtime owners, publishers, run/request/effect
identities, connection grants, versions and runs are not cloned.

## Archived reads and run behavior

Current authorized viewers can inspect archived workflow configuration and safe run
history/detail. Ordinary edit, publish, restore and run capabilities are false while
archived. Underlying edit authority can independently permit unarchive; source view plus
create can permit duplication; cancellation remains independently authorized.

readWorkflowVersions returns the latest 100 summaries in descending version order:
id, number, name and createdAt. readWorkflowVersion accepts strict id/versionNumber input
and returns that same-workflow summary plus its immutable definition. Publisher identity,
stored trigger values and CRM outputs are not added to these projections. A known older
version remains accessible through the exact-version read. Missing or out-of-storage-range
positive version numbers return WORKFLOW_DENIED after authorization.

Archival blocks later admission. An already admitted run retains its immutable version,
history and completed effects. A later advance that observes archive fails incomplete work
and clears the active deadline. Archival is not bulk cancellation or a global barrier
against in-flight effect commits. Pause does not stop eligible continuations. No provider,
automatic trigger, retention, purge or erasure capability is introduced.
