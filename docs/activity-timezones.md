# Activity dates, time zones and the Iranian calendar

Timed activities store instants (`due_at` and optional `end_at`). The resolved
time zone controls input, hour lanes, current-day defaults, grouping, date filters,
day-load counts, due labels and overdue checks. In browser mode, requests use
the device time zone when available. Background work uses the saved account
time zone. Outside browser mode, a valid profile time zone takes precedence
over the saved UI preference. Older accounts can use a request fallback. UTC
is the default when no valid zone is available. Switching the display calendar
preserves the stored instants and Gregorian ISO civil dates.

Forms freeze the draft timezone when opened and display its identifier and offset. A timezone preference change while the form remains open does not reinterpret the draft. Unchanged date/time inputs are omitted from patches, preserving seconds, milliseconds, an existing repeated-hour offset and duration. A new or changed clock time during a DST gap is rejected. A new ambiguous clock time uses the earlier occurrence and the form explains this choice; an untouched later occurrence keeps its original offset. Conversion uses the same Temporal polyfill in server and browser code.

New and date-edited all-day activities store canonical Gregorian `due_date` and optional inclusive `end_date` civil dates. Their compatibility `due_at`/`end_at` anchors are assembled in the frozen draft timezone. A deliberate `00:00` with `all_day=false` remains timed. Canonical all-day dates do not move when the viewer changes timezone. An all-day activity is overdue only after its last civil date has ended in the account timezone. Free/busy includes the full civil days, including 23/25-hour DST days. List date filters and calendar query upper bounds are half-open; existing inclusive activity end-day coverage is retained.

Migration `0076_activity_civil_dates.sql` only adds two nullable date columns. It has no default, backfill or timestamp rewrite. Older `all_day=true` rows with null canonical dates have no recoverable original timezone: the compatibility decoder projects the stored anchor into the current account timezone, and editors explain this uncertainty. Reading or saving unrelated fields does not backfill or rewrite these rows. A user-confirmed date/time edit establishes canonical metadata. Historic midnight timed records are not reclassified.

The source checks cover Tehran midnight and Nowruz, Esfand 30, Berlin's skipped
and repeated hours, New York's 23-hour civil day, month and week grouping, query
bounds, and all-day dates. Read-only PostgreSQL `VALUES` fixtures exercise
calendar and due-day predicates. From the repository root,
`bun run scripts/check-activity-timezones.ts` exercises the repositories with
temporary table clones in a transaction. Run it against a disposable database
with the repository migrations applied. The temporary clones omit foreign keys,
so use separate tests for referential integrity and permission changes.
Migration `0076` leaves previously queued reminders intact. For the newer native
reminder path, see the dated
[reminder qualification record](activities/native-reminder-runtime-qualification-20261103.md).
