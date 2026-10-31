# Privacy deadline calculation decisions

Scope: the pure deadline engine for DPL-05. This does not establish installation policy or task acceptance. Durable case decisions, permissions, notice delivery evidence and database concurrency remain separate qualification work.

`createPrivacyDeadline(receivedAt, policy)` accepts a canonical instant and an explicitly activated, versioned policy with jurisdiction, IANA time zone, Gregorian response-month count and maximum extension-month count. Missing or invalid configuration returns a failure. Display language, selected display calendar and user time zone do not select jurisdiction or alter calculations.

The policy is a snapshot in the returned record. Receipt and original due instant remain unchanged when `extendPrivacyDeadline` returns a new record. Both helpers return `Result` values. They perform no I/O and send no notifications.

## Calculation table

| Receipt                                | Policy                        | Due instant                                                     |
| -------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| 31 January 2026, 16:00 Europe/Berlin   | One Gregorian calendar month  | 28 February 2026, 16:00 Europe/Berlin                           |
| 31 January 2024, 16:00 Europe/Berlin   | One Gregorian calendar month  | 29 February 2024, 16:00 Europe/Berlin                           |
| 15 March 2026, 13:00 Europe/Berlin     | One Gregorian calendar month  | 15 April 2026, 13:00 Europe/Berlin, with the changed UTC offset |
| 31 March 2026, 11:30 Asia/Tehran       | One Gregorian calendar month  | 30 April 2026, 11:30 Asia/Tehran                                |
| 31 January 2024, 02:30 Europe/Berlin   | Two Gregorian calendar months | Target falls in a DST gap, requires explicit policy resolution  |
| 27 September 2024, 02:30 Europe/Berlin | One Gregorian calendar month  | Target falls in a DST fold, requires explicit policy resolution |

Month arithmetic constrains an unavailable day to the target month's final day. It retains local wall-clock time, then resolves the target instant using the configured DST choice. The default `reject` leaves gaps/folds unresolved; explicit `earlier` or `later` choices are recorded in the policy snapshot. These engineering choices need operator review before activating an installation policy.

Instants use UTC ISO strings with at least millisecond precision and preserve supplied submillisecond precision. The helper does not replace receipt time with verification time, extension time or the current clock.

## Extension decisions

An extension requires a nonempty reason, a notice reference and notice timestamp between receipt and the original due instant, inclusive. The caller must bind that reference to actual authorized notice evidence. A string reference by itself is not delivery proof.

The total extension must remain within the activated policy maximum. The due date is recalculated from the original receipt plus response months plus total extension months, preventing month-end drift. Replaying an identical notice reference and content is idempotent. Reusing its reference with changed content fails.

The engine permits response periods of one to twelve months and extension maxima of zero to twelve months as technical bounds. These are not statutory defaults or legal conclusions. An unconfigured installation has no enabled deadline policy, and the synthetic test profile is not deployment authority.

## Test-first evidence

- Initial command: `bun run test:unit src/features/privacy/deadlines.test.ts`. It failed because `./deadlines` did not exist before production implementation.
- A later precision regression was written and observed failing: a receipt ending in `.123456Z` had been truncated to `.123Z`. The canonical formatter was corrected to preserve precision.
- Tests cover month ends, leap years, DST offset/gap/fold behavior, explicit Tehran policy time zone, unknown/disabled policies, invalid receipts, extension evidence, cumulative limits, nonmutation and idempotent replay.

Exact-revision green results belong in the shared implementation evidence register after integration. This document does not claim database, UI, external delivery or legal acceptance.
