# Agency civil-date contract

Decision, 1 November 2026. Source contract for the pure project-start/due-date template preview; implementation and runtime acceptance are separate.

Accept canonical ASCII Gregorian civil dates from **`0001-01-01` through `9999-12-31`, inclusive**, for both project start and every derived due date. Require exactly `YYYY-MM-DD` and a real calendar date. Reject year `0000`, signed/extended years, impossible dates, timestamps, calendar annotations, localized digits and surrounding whitespace. Stored civil dates use this Gregorian contract regardless of display locale or Persian-calendar preference.

Use the existing `addCivilDays` helper with the manifest's validated integer offset in `[-3650, 3650]`. These are calendar-day offsets, without a time zone or conversion to elapsed 24-hour durations. Validate the resulting date against the same input/output range before exposing it. A calculation that crosses either boundary, yields a noncanonical date or fails date calculation returns the typed **`invalid_date`** result. Preserve the existing manifest validation for an invalid offset. Do not clamp, wrap, truncate or silently normalize a date.

Expected boundary examples for later implementation tests:

| Project start | Offset | Result |
| --- | ---: | --- |
| `0001-01-01` | `0` | `0001-01-01` |
| `0001-01-01` | `-1` | `invalid_date` |
| `9999-12-31` | `0` | `9999-12-31` |
| `9999-12-31` | `1` | `invalid_date` |
| `2024-02-28` | `1` | `2024-02-29` |
| `2026-02-29` | any otherwise valid offset | `invalid_date` at ingress |

This chooses the shared displayable range. Current [civil-date parsing and display](/Users/ali/Developer/warpdrive-calendar/src/lib/localeFormatting.ts:72) requires four digits, rejects years below 1 and validates the actual day. The current [calendar-day helper](/Users/ali/Developer/warpdrive-calendar/src/lib/zonedDateTime.ts:43) delegates to Temporal and does not itself enforce this application range, so the preview boundary must validate its output. Current [Activity date fields](/Users/ali/Developer/warpdrive-calendar/src/features/activities/schemas.ts:29) use the broader library date validator without an additional local year-range rule; this decision does not change that existing schema.

Source inspected at Calendar base `2803183809c646a063f78fe954c110adbb2f453f`, working-tree SHA256:

- `src/lib/zonedDateTime.ts`: `f01ed9fba3e61db80fc80c8f21cba77cf1d313b1c183aa7505fd810710160eae`
- `src/lib/localeFormatting.ts`: `6e63b4c79081019ef2c14a55240e5eda03df77388e35ac05ab54ae7675460112`
- `src/features/activities/schemas.ts`: `f4f739a8d357637a57e394029876d46f8e6d4bd9363ebcd238ddf4a80b4771e0`

Only this decision document was written. No renderer, schema, SQL, helper, service or runtime was changed, and the example expectations were not executed as tests. Preview authoring remains separate from Activity installation and approval or finance outcomes.
