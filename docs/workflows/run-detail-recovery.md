# Run-detail read recovery

This is a bounded run-inspector increment for roadmap issue #684. It changes the display and recovery of the existing `workflows.run` read. It does not add a procedure, DTO field, or authorization rule.

## Display and identity

The inspector renders `RunTrace` only when the current query has no read error, is not supplying placeholder data, and returns the requested run ID. If a background read fails or is denied, the historical graph and its inspector controls unmount even when TanStack Query retains a previously successful response. The dialog presents the existing localized load error and an explicit read-retry control, without exposing transport diagnostics.

The query and inspector view are keyed by the requested workflow/run tuple. Changing either identity resets the read-recovery state and historical selection while leaving the outer dialog and its caller-provided close/focus callbacks in place. The read explicitly disables inherited placeholder data, so another query's snapshot cannot stand in for the new target.

The existing run DTO contains its run `id`, but no `workflowId`. Workflow context remains bound by the existing `{ id: workflowId, runId }` query input and server read. The client run-ID guard does not independently establish workflow ownership or authorization.

## Background reads and explicit recovery

A successful, matching run in `queued`, `running`, or `waiting` status continues to poll every 2.5 seconds. Its last successful snapshot and historical selection remain visible during a healthy background read, avoiding a graph remount on each poll. A read error or mismatched run ID stops automatic polling. Terminal statuses do not poll. Existing mount, focus, reconnect and invalidation policies remain in effect and can trigger separate revalidation.

Automatic query retries are disabled for this read. The retry button requests the same existing run-detail read once; it does not retry or restart workflow execution. While that read is in flight, the control remains visible and disabled, and the existing localized loading message is announced. `cancelRefetch: false` prevents another click from replacing an already running read. A successful, matching response restores the inspector; another read failure leaves recovery available.

The existing dialog preserves its close control, Escape handling, direction, and caller-provided focus restoration. English, German, and Persian reuse the existing `loading`, `loadError`, and `retry` messages.

## Evidence and limits

`RunDetailDialog.recovery.test.tsx` exercises the real dialog and locale provider with a real TanStack Query cache and observer. The transport hook and `RunTrace` are fixtures. Its 15 cases cover cached success followed by a denied background read, bounded manual recovery in three locales, healthy background progress, stopped error polling, workflow/run retargeting, retained run-ID mismatch, and localized loading with Escape/focus restoration. Existing `RunTrace` tests cover its separate historical-step behavior. The current local focused run passed all 18 cases across these three files, plus formatting and the selected cognitive-complexity rule; hosted type/lint/full-suite checks remain separate.

Hiding or unmounting the inspector does not erase previously authorized query-cache data, revoke already delivered bytes, establish a retention policy, or prove immediate response to an authorization change. This change reacts to an observed failed, denied, placeholder, or mismatched read. It does not establish continuous authorization, browser qualification, server-denial coverage, deployment, release, or completion of WF-027 or issue #684 as a whole.
