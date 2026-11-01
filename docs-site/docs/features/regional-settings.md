---
title: Language, region, and appearance
description: "Use Warpdrive in Farsi, German, or English with independent calendar, timezone, digit, and appearance preferences."
---

# Language, region, and appearance

The maintained fork provides English, Iranian Persian (Farsi), and German. Change language in **Settings > Regional settings** (`/settings/regional`). The interface updates its messages and direction, and the authenticated account retains the preference.

## Calendar and timezone

Language, display calendar, and account timezone are independent. You can use the Iranian Solar Hijri calendar with an English or German interface, or the Gregorian calendar with Farsi. The activities calendar and shared date pickers use the selected calendar.

Timed activities preserve an instant; all-day activities preserve a calendar date. Date grouping and composition use the account timezone. A change in display calendar does not reschedule a stored appointment. Review ambiguous or skipped local times when editing around daylight-saving transitions.

The Iranian calendar supports date display and input. Calendar-aware recurring workflow schedules are a separate planned capability. Google Calendar synchronization, Meet, Zoom, and Teams provisioning are not current integrations.

## Digits, numbers, and currencies

Farsi offers Persian or Latin digits. Numeric inputs accept supported regional digits and separators and normalize them before storage. German uses its localized decimal and date conventions. CSV/API values retain their canonical representation.

Currency belongs to the lead, deal, or value goal. Changing language does not change it. Totals remain separate by currency and no exchange-rate conversion is performed. IRR denotes Iranian rial; the application does not silently substitute toman.

## Appearance and navigation

Use **Settings > Appearance** (`/settings/appearance`) for the available theme and display options. The sidebar supports expanded, collapsed, and narrow-screen navigation. Search, quick creation, account controls, and notifications are in the shared top bar.

Farsi uses right-to-left layout and the locally bundled Vazirmatn font. Latin interfaces use the locally bundled Inter font. Email addresses, URLs, and technical identifiers keep their left-to-right reading direction inside Farsi content.

**Settings > Workflow preferences** (`/settings/workflow`) contains personal CRM behavior preferences. It is separate from the planned visual automation builder described in [Visual workflows](./automations.md).

## Reporting a language or layout issue

Include the route, interface language, selected calendar/timezone, theme, and action that failed. Use synthetic records or redact account/customer data in screenshots. A useful report includes the intended meaning; a literal word replacement can miss the underlying workflow.
