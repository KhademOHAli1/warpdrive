# UX-007/009: independent regional preferences and date explanations

Review date: 2026-10-31. Inspected source head: `45b722b51cb8bfa39aa6da56d13982dbbd58e44c`.
Evidence class: source inventory, locale matrix and proposed calendar review scenarios. Existing
test sources were read as assertions of intended behavior, not executed in this work. No browser,
test, build, database or provider action was performed. This document changes no runtime or tracker.
Root source/design review completed on 2026-10-31. Requested corrections are applied: `gregory`
and `persian` are values of one calendar field independent from locale, and source-library paths
are explicit. The reviewed design evidence does not qualify the browser scenarios below.

Exact UX-007 acceptance: “Specify FA with Gregorian or Iranian calendars, DE with either calendar,
numbering preferences and explicit time zones.” Exact UX-009 acceptance: “Explain all-day dates,
time zones, ambiguous times and any unsupported Solar Hijri recurrence conversion clearly.” Both
have UX-001 as their recorded dependency in the active 446-task register.

## Current source and presentation boundaries

| Axis or behavior       | Current source behavior                                                                                                                                                                                                                   | Limit to preserve in design and claims                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language and direction | EN/FA/DE are selectable; FA is RTL, DE/EN LTR (`src/features/i18n/registry.ts:1`). Language patches preserve other saved fields (`usePreferencePersistence.ts:34`).                                                                       | An initial default is not a required pairing. Changing language does not authorize changing stored dates, timezone or calendar.                                                                         |
| Calendar               | `gregory` and `persian` are values of the single `calendar` preference field, independent from `locale`. Missing/obsolete values use the locale default, FA Iranian and DE/EN Gregorian (`preferences.ts:27`, `:34`).                     | Valid explicit choices survive a language change. `persian` means the Iranian Solar Hijri calendar here, not an Arabic-language or lunar calendar.                                                      |
| Numbering              | `arabext` and `latn` are accepted separately; FA defaults to Persian digits. Non-FA display currently forces Latin digits (`src/lib/numberingSystem.ts:5`).                                                                               | This is partial independence: a stored `arabext` value does not make DE/EN display Persian digits. A universal digit selector would be a later product change.                                          |
| Regional controls      | Source composes separate language, timezone and calendar Select controls for every locale; the digit selector is FA-only (`src/app/(app)/settings/profile/LanguageSettings.tsx:60`, `:76`, `:89`, `:105`).                                | This is source evidence of controls, not newly observed browser rendering. The timezone menu is a finite list plus the current value, not a searchable inventory of every IANA zone.                    |
| Explicit timezone      | Preference validation uses `Intl`; unresolved timezone falls back to `UTC`, not render-time browser inference (`preferences.ts:18`, `:46`). A valid profile timezone takes precedence in account resolution (`accountPreferences.ts:12`). | A zone identifier, such as `Europe/Berlin`, is not a fixed UTC offset. Do not infer a zone from FA/DE, provider country, calendar, digits or server clock.                                              |
| Persistence            | Authenticated regional saves update account timezone and locale preferences plus separate cookies (`actions.ts:22`). Writes serialize; the latest failed save rolls back with an error (`usePreferencePersistence.ts:34`).                | Autosave and optimistic display do not prove persistence. Browser/reload and failure scenarios below remain unqualified.                                                                                |
| Formatters             | `src/lib/useFormatters.ts:13` passes all four axes. `src/lib/localeFormatting.ts:58` formats instants in the chosen zone; date-only values use UTC solely as a stable formatting container.                                               | UTC-noon formatting is an implementation detail, not an all-day event's start time. Display conversion never rewrites canonical values.                                                                 |
| Date selection         | `src/components/ui/DatePicker.tsx:125`, `:156` selects FA/DE/EN Gregorian or Iranian picker variants, keeping Gregorian `YYYY-MM-DD` values. Its calendar-toggle override is component-local (`:237`).                                    | Toggling one picker is not saving the account's calendar preference. Calendar-page selection uses saved preferences separately (`src/app/(app)/activities/calendar/CalendarClient.tsx`).                |
| Week layout            | `src/features/activities/calendarSystem.ts:20` starts weeks on Saturday when the calendar is Iranian **or** the language is FA, otherwise Monday.                                                                                         | Week start is currently coupled to language/calendar; it is not a separate user preference. FA Gregorian therefore still uses Saturday. Do not promise full independence for every regional convention. |
| Event time basis       | `CalendarEventDialog.tsx:56` freezes the account zone when opening the draft and shows a zone hint (`:213`). `src/lib/zonedDateTime.ts:22` rejects gaps and chooses the earlier repeated time.                                            | No per-event timezone selector, later-fold selector or full recurrence engine is established by this editor. A preference change must not silently reinterpret an open draft.                           |

Unqualified preference paths in this table are relative to `src/features/i18n/`; unqualified event
components are in `src/features/activities/`. Library helpers have explicit `src/lib/` paths.

## UX-007 locale matrix

The following are review fixtures, not passing browser results. Use the same synthetic activity
and account data, changing only the listed preferences. `YYYY-MM-DD`, technical IDs, URLs and
IANA identifiers stay ASCII in storage and transport; human-readable dates and counts use the
app's formatters. Do not treat localized display strings as API date inputs.

| ID   | Interface | Calendar          | Display digits      | Explicit timezone  | Required observation and current boundary                                                                                                                                                                              |
| ---- | --------- | ----------------- | ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | FA / RTL  | Gregorian         | Persian `arabext`   | `Europe/Berlin`    | Persian prose with Gregorian date selection/display and Persian digits. Week start is currently Saturday. No forced switch to Iranian dates or Tehran.                                                                 |
| R-02 | FA / RTL  | Gregorian         | Latin `latn`        | `UTC`              | Persian prose with Latin date/time/count digits. Changing only digits does not change calendar or instant.                                                                                                             |
| R-03 | FA / RTL  | Iranian `persian` | Persian `arabext`   | `Asia/Tehran`      | Iranian month/day display with the chosen zone. Canonical date-only values remain Gregorian civil dates; this does not create a recurring rule.                                                                        |
| R-04 | FA / RTL  | Iranian `persian` | Latin `latn`        | `Europe/Berlin`    | Iranian calendar and Latin digits in Farsi. Zone stays Berlin; no country inference from calendar.                                                                                                                     |
| R-05 | DE / LTR  | Gregorian         | Latin `latn`        | `Europe/Berlin`    | German labels and Gregorian dates. Change language without resetting an existing explicit zone or calendar.                                                                                                            |
| R-06 | DE / LTR  | Iranian `persian` | Latin `latn`        | `Asia/Tehran`      | German labels with Iranian dates. Month navigation follows Iranian month boundaries; current calendar week starts Saturday.                                                                                            |
| R-07 | DE / LTR  | Iranian `persian` | Requested `arabext` | `UTC`              | Document current restriction: display remains Latin and there is no DE digit selector. Do not describe this requested combination as selectable Persian-digit support. Preserve the stored value when returning to FA. |
| R-08 | EN / LTR  | Gregorian         | Latin `latn`        | `America/New_York` | English does not imply UTC or a server-local zone. Date-only fixtures stay fixed; an instant may appear on a different local civil day.                                                                                |

For R-01 through R-06, open regional settings, change one axis, reload, then reopen a calendar
event and a date-only CRM field. Verify the other explicit preferences survive. Repeat after a
failed save and confirm the error and rollback do not erase an unsaved title. A source test for
the preference provider exercises retained draft text and separate calendar/language writes
(`LocaleProvider.test.tsx:34`, `:73`); it does not qualify all these screens or combinations.

For R-03/R-04/R-06, also toggle a single date picker and close/reopen it. Confirm the local toggle
has not rewritten the account preference or selected canonical day. Readable labels, keyboard
focus, mixed-direction identifiers, mobile clipping and screen-reader announcements require later
browser evidence. No pixel-exact expectation is inferred from server ICU punctuation.

## UX-009: civil dates, instants and clock changes

An all-day activity names civil dates, not a midnight appointment. New or date-edited all-day rows
use canonical `dueDate` and inclusive `endDate`; timestamp columns remain compatibility anchors
(`src/db/schema/activities.ts:29`;
`src/features/deal-workspace/composer/composerHelpers.ts:41`;
`src/features/activities/activityTemporal.ts:24`). A single-day
range may begin and end on the same civil date. A deliberately chosen `00:00` is a timed event.
For a timed event, the date, clock time and draft zone resolve to an instant. Displaying that
instant in another zone can change its local day without moving the event itself.

The Temporal documentation distinguishes exact instants from wall-clock readings and describes
missing/repeated clock times caused by offset changes. The app's policy is narrower than a
generic default: reject missing times and choose the earlier occurrence for a new/changed
ambiguous reading. This policy comes from source, not from a provider promise.
[TC39: Time Zones and Resolving Ambiguity](https://tc39.es/proposal-temporal/docs/timezone.html)
(retrieved 2026-10-31).

| ID   | Synthetic review scenario                                                             | Expected explanation and source basis                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | All-day `dueDate=2026-03-21`, `endDate=2026-03-23`; display in Berlin, UTC and Tehran | It covers the same three civil dates in each zone. Calendar/digit changes alter presentation, not those dates. `activityTemporal.ts:24`, `:34`; canonical model differs from legacy timestamp-only rows.                                                                                                                                               |
| D-02 | Compare the same date with blank time and with explicitly selected `00:00`            | Blank time produces an all-day record; explicit midnight produces an instant. Do not label a timed midnight event “all day” or invent a clock time for a date-only record. `activityTime.ts:18`, `:28`.                                                                                                                                                |
| D-03 | Display `2026-03-20T21:00:00Z` in UTC and `Asia/Tehran`                               | Existing test source expects 20 March in UTC and 21 March in Tehran. The instant is unchanged. State the zone next to editing times. `activityTemporal.test.ts:10`; this fixture is not a claim about future timezone legislation.                                                                                                                     |
| D-04 | New Berlin time `2026-03-29 02:30`                                                    | Reject this missing clock time with localized actionable feedback; retain the draft and ask for a different time. Do not silently move it to another hour. `src/lib/zonedDateTime.ts:22`; `activityTemporal.test.ts:18`; `calendar.fa.json:34`.                                                                                                        |
| D-05 | New Berlin time `2026-10-25 02:30`                                                    | Explain that this clock reading occurs twice. Current source chooses the earlier `+02:00` occurrence, `2026-10-25T00:30:00.000Z`, and shows the offset/ambiguity hint. There is no current “choose second occurrence” control. Same helper and `ActivityTimeZoneHint.tsx:17`.                                                                          |
| D-06 | Existing later-fold instant `2026-10-25T01:30:00.000Z`; edit title only               | Preserve the exact later instant and its displayed offset, rather than reassembling it as the earlier occurrence. Changing its date/time invokes the earlier-occurrence policy. `calendarEventDraft.ts:137`, `:158`, `:211`; `ActivityTimeZoneHint.tsx:24`.                                                                                            |
| D-07 | An open draft began in Berlin; account preference changes to UTC                      | Explain that this draft still uses Berlin, which was frozen on open. Do not shift saved time merely because the account preference changed. Close/reopen behavior and the date-picker Today marker need browser review, especially while their live preference differs from the frozen draft zone. `CalendarEventDialog.tsx:56`; `DatePicker.tsx:156`. |
| D-08 | Legacy all-day row has timestamp but no canonical civil date                          | Show the existing legacy warning: the original zone was not recorded and the account zone is used for projection. A zone change can alter that inferred day. Do not backfill or claim the original day was recovered by viewing or editing only its title. `activityTemporal.ts:38`; `calendar.fa.json:35`.                                            |
| D-09 | Availability for a civil day containing an offset change                              | Compute adjacent local midnights with the explicit zone, not a fixed 24-hour addition. Existing New York fixture expects a 23-hour interval for 8 March 2026. This is range conversion, not a recurrence engine. `src/lib/zonedDateTime.ts:34`; `activityTemporal.test.ts:26`.                                                                         |
| D-10 | Future ICS export of D-01                                                             | Local inclusive 23 March must map to an exclusive 24 March end for an all-day VEVENT. This is a required future adapter scenario; ICS import/export is still planned. Preserve date-only semantics across the round trip.                                                                                                                              |

RFC 5545 defines VEVENT's end as exclusive; this differs from the local inclusive all-day end
and needs an explicit adapter, not a changed UI meaning.
[RFC 5545, section 3.6.1](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6.1).
The current future-work boundary is also recorded in `docs/calendar-implementation-plan.md:38`.

## Iranian recurrence: supported display is not supported recurrence

The current activity schema, create/update schemas, calendar editor and temporal helpers inspected
above contain no recurrence rule, authored calendar, occurrence/exception identity or series-edit
scope. Iranian month navigation and Gregorian-to-Iranian display are implemented source paths;
they do not establish monthly/yearly Iranian recurrence, rule conversion or provider sync.
`docs/calendar-implementation-plan.md:29` through `:38` explicitly leaves these later contracts open.

A later recurrence model must preserve the authored calendar, rule, zone, exceptions and reviewed
conversion outcome separately from the display preferences. Changing FA to DE or Iranian to
Gregorian **display** must not replace a rule authored as “every first day of an Iranian month”
with “every first day of a Gregorian month”. A one-off date conversion does not prove equivalent
future occurrences. Until the relevant implementation and adapter are qualified, explain the
unsupported conversion and block automatic export/sync of that rule. Do not silently flatten an
unbounded series or drop exceptions. A proposed finite occurrence export must disclose its horizon
and lost series behavior and require an explicit user choice; it is not implemented here.

RFC 5545 uses a Gregorian calendar scale. RFC 7529 separately extends recurrence with `RSCALE`
for non-Gregorian rules; the existence of that extension is not evidence that a particular Google,
Microsoft, CalDAV or other account supports it. Provider-specific support remains unqualified.
[RFC 5545, section 3.7.1](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.7.1),
[RFC 7529, sections 3 and 6](https://www.rfc-editor.org/rfc/rfc7529.html#section-3)
(retrieved 2026-10-31).

| ID     | Proposed future scenario                                                                     | Required truthful result; no implementation claim                                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCR-01 | Author “monthly, first day” in the Iranian calendar, then display the series in DE/Gregorian | Preserve the Iranian rule and identify it in the summary. Translating or reformatting dates does not author a Gregorian rule.                                                                                                |
| RCR-02 | Export that rule through an adapter with no qualified Iranian recurrence capability          | Explain unsupported conversion and leave the remote series unchanged. Offer only separately implemented, explicit alternatives; never display “synced” after saving a local rule alone.                                      |
| RCR-03 | Rule touches a short/leap boundary or a timed occurrence falls in a gap/fold                 | Show and review the chosen invalid-date and clock-change policies and a bounded occurrence preview. Do not infer those policies from month navigation or reuse one-off earlier-fold behavior as an unstated series contract. |
| RCR-04 | Change or cancel one occurrence, future occurrences or the whole series                      | Require explicit scope, stable occurrence identity and preserved exceptions. Do not offer working-looking scope controls before server/provider semantics exist.                                                             |

## Contextual FA/DE/EN explanations

These are design copy, except where the current source wording is identified. They must be bound
to the corresponding evidence/state before use. See [farsi-terminology.md](farsi-terminology.md)
for fixed terms; no catalog was edited here.

| Meaning                                         | فارسی                                                                                                                | Deutsch                                                                                                                                                        | English                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Independent preferences                         | زبان، تقویم، نمایش اعداد و منطقهٔ زمانی تنظیمات جدا هستند. تغییر نمایش، تاریخ ذخیره‌شده را عوض نمی‌کند.                 | Sprache, Kalender, Ziffernanzeige und Zeitzone sind getrennte Einstellungen. Eine andere Darstellung ändert das gespeicherte Datum nicht.                      | Language, calendar, digit display and time zone are separate settings. Changing the display does not change the stored date.  |
| Current digit restriction                       | در این نسخه، انتخاب ارقام فارسی یا لاتین در رابط فارسی در دسترس است؛ رابط آلمانی و انگلیسی ارقام لاتین را نشان می‌دهند. | In dieser Version können Sie die Ziffernanzeige in der persischen Oberfläche wählen. Deutsch und Englisch zeigen lateinische Ziffern.                          | This version offers digit selection in the Farsi interface. German and English display Latin digits.                          |
| All-day                                         | این رویداد تمام‌روز است و ساعت مشخصی ندارد. تاریخ پایان هم جزو رویداد است.                                            | Dieser Termin ist ganztägig und hat keine Uhrzeit. Das Enddatum gehört zum Termin.                                                                             | This is an all-day event with no clock time. Its end date is included.                                                        |
| Frozen draft zone                               | زمان‌های این پیش‌نویس بر اساس {zone} هستند.                                                                            | Die Uhrzeiten dieses Entwurfs beziehen sich auf {zone}.                                                                                                        | Times in this draft use {zone}.                                                                                               |
| Gap, current FA source at `calendar.fa.json:34` | این ساعت در منطقهٔ زمانی انتخاب‌شده وجود ندارد. ساعت دیگری انتخاب کنید.                                                | Diese Uhrzeit gibt es in der gewählten Zeitzone nicht. Wählen Sie eine andere Uhrzeit.                                                                         | This time does not exist in the selected time zone. Choose another time.                                                      |
| Fold, current policy at `calendar.fa.json:33`   | این ساعت دو بار رخ می‌دهد. برای زمان تازه یا ویرایش‌شده، نوبت اول در نظر گرفته می‌شود.                                  | Diese Uhrzeit tritt zweimal auf. Für neue oder geänderte Zeiten wird das frühere Vorkommen verwendet.                                                          | This time occurs twice. A new or changed time uses the earlier occurrence.                                                    |
| Unsupported recurrence conversion, future guard | تبدیل این تکرار هجری شمسی برای {provider} پشتیبانی نمی‌شود. قاعده تغییر نکرده و به آن سرویس ارسال نشده است.           | Die Umwandlung dieser Wiederholung im iranischen Kalender wird für {provider} nicht unterstützt. Die Regel wurde nicht geändert oder an den Anbieter gesendet. | Converting this Iranian-calendar recurrence for {provider} is unsupported. The rule was not changed or sent to that provider. |

The final no-send sentence requires a guard proving no remote attempt/effect. If an attempt may
already have happened, preserve the unsupported-conversion explanation but use the actual pending
or unknown outcome instead of claiming it was not sent. Plain zone IDs, offsets and provider
placeholders need direction isolation in FA; their underlying values remain unchanged.

Acceptance handoff: UX-007 has explicit FA/DE calendar/digit/zone combinations and documented
current limitations; UX-009 has all-day/instant, inclusive-end, explicit-zone, gap/fold, legacy and
unsupported-recurrence explanations. These are reviewable locale/calendar design artifacts.
Root reviewed these artifacts with the corrections recorded above; task-status changes belong to
the register owner. This does not imply browser, recurrence, ICS or live-provider implementation
qualification, or completion of the wider integration programme.
