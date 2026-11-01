# Internationalization

English, Iranian Persian, and German are active interface languages in `registry.ts`. Existing CRM URLs
stay stable; language selection uses the authenticated account preference and mirrored cookies.

## Translations

Use namespaced ICU messages from JSON catalogs. `messages/en.json` defines the canonical base
catalog, and domain catalogs live beside their owning feature. `catalog.ts` combines them and
fills absent localized values from English. The audit command reports missing translations even
when a runtime fallback exists.

Client components use `useAppTranslations("namespace")` from `LocaleProvider.tsx`. Async server
components use `await getAppTranslations("namespace")` from `server.ts`. Pure functions that
already receive a locale can use `createAppTranslator(locale, "namespace")` from `catalog.ts`.
Native next-intl APIs are also configured through `request.ts`. Do not store a request locale or
translator in a mutable module-level singleton.

Use ICU placeholders and plurals instead of concatenating translated sentence fragments. Adding
a namespace requires JSON catalogs, a `catalog.ts` entry, and its canonical English JSON path in
the Next plugin's `createMessagesDeclaration` list. `bun run typecheck` generates declarations
before checking message keys and ICU argument names/types. `bun run i18n:audit` checks translation
coverage and ICU parity. Generated `.d.json.ts` files are ignored by Git.

## Language and regional preferences

`useLocalePreferences()` returns `{ locale, calendar, timeZone, numberingSystem }`; `useCalendarSystem()` returns
the selected calendar. Change preferences with `useSetLocalePreferences()`, which accepts a
partial preference object and returns a promise indicating whether persistence succeeded.

The shared action validates all input. Authenticated writes require a valid CSRF token and save
to the account; signed-out choices are cookie-only. Account settings win on the next request.
The existing profile time zone remains authoritative for an authenticated account. The fallback
is UTC, and no browser time zone is inferred during server rendering.

The provider applies direction immediately and saves preferences without a page reload. Cookie
writes trigger a server render that preserves mounted client form state. Failed saves visibly
revert the preference and preserve the draft. Language is selected in personal settings with the
shared keyboard-accessible Select control.

## Dates, numbers and direction

Keep stored date and numeric contracts unchanged. Use the shared locale formatters and numeric
normalization for display and input, and pass an explicit preference object in server/pure code.
Language and calendar are independent: an English interface may use Solar Hijri dates, and a
Persian interface may use Gregorian dates.

Personal settings expose Persian (`arabext`) and Latin (`latn`) digits in Farsi, German and
English. An explicit digit choice is independent of language, calendar and time zone. When
omitted, Farsi defaults to Persian digits and German/English to Latin digits; rendering or a
language-only change does not save that fallback as an explicit preference.
The optional `numberingSystem` preference is saved with the account and mirrored in a cookie.
Pass the full preference object to formatters and its numbering system to pure translation
factories. `useFormatters` and `useAppTranslations` do this automatically for dates, money and
ICU numeric arguments. DatePicker also applies the choice to triggers, grids, captions and
accessible dates, while retaining caller-supplied labels. Keep stored numbers, ISO dates,
raw year-option values and user-authored text unchanged.

Use logical CSS directions and the shared control adapters. Root rendering sets `lang` and `dir`
before hydration, and the provider carries direction into Radix's context and portals. Isolate
emails, URLs and other embedded left-to-right values inside Persian copy.

These modules provide infrastructure. A screen is localized only after its visible copy, errors,
accessibility labels, formatting, input, layout and workflow have been migrated and verified.
