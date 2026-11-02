# Pre-receipt Gmail intake gate

The accepted-ID regression cases cover sync after the direct Gmail API acknowledgement
has committed. They do not qualify sync that arrives before that receipt commits.
No pre-receipt intake policy is implemented by this change.

## Proposed regression, real PostgreSQL

Use `gmailNotificationCollisionFixture`, its existing shared/linked `t1` thread and full
ordinary-row snapshots. Prepare the real notification and run `processSendAttempt` with
the existing FakeGmail protocol adapter. Pause `sendRaw` after recording the one provider
effect and before resolving its return value. Confirm the persisted attempt is stamped,
has no provider IDs and has no direct ACK proof. During that pause, run actual
`applyMessageIds` for the newly visible provider message in `t1`.

The privacy oracle is that intake does not insert that candidate into `t1`, does not
touch `t1` for trash reconciliation, and preserves every original thread/message field.
It must not set attempt IDs, acceptance proof or `notifications.email_sent_at`.
Release the direct ACK, complete the worker repair, and assert exactly one provider
effect and one separate private/unlinked copy. The original UUIDs, bodies, associations
and timestamps remain byte-for-byte equal to their snapshots.

Add a second case where the provider accepted but the response is lost. Intake remains
non-authoritative and the stamped attempt reaches manual `needs_review`; replay must not
send again. Add an unrelated message that supplies the same public RFC header. It must
never be adopted, overwritten, reparented, or used to complete the notification.

## Policy proposed for review

A matching RFC hint on a stamped private attempt may justify conservatively skipping
new ordinary intake before any thread/message/touched-set mutation. It cannot identify
the notification's provider message or produce acceptance, association, repair or an
emailed marker. Existing rows are left untouched. Only a later direct API ACK can name
the provider message that the existing private-copy repair may store.

This policy trades automatic intake of an unverified candidate for confidentiality.
An unrelated message with that spoofed hint may also be withheld from local intake;
the remote mailbox remains authoritative for manual review. Cursor advancement and
operator recovery for withheld candidates require a separate design and regression.
Implement this policy only after reviewing that tradeoff and observing its own RED.
