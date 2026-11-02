# Iranian and German data conventions (IG-06)

## Approved meaning

Ali approved the following examples on 31 October 2026: canonical currency remains **IRR**; 1,234,560 rials displays as 123,456 toman; 1 rial displays as 0.1 toman. There is no rounding and no foreign-exchange conversion. Changing the interface to German preserves the selected currency and display unit.

The profile's regional settings now offer an independent rial/toman display choice. The default remains rial. Canonical amounts and currency codes are untouched. Canonical amounts have four fractional decimal places; dividing their decimal strings by ten preserves up to five fractional toman places, including 0.0001 IRR → 0.00001 toman. UI digits and separators follow the user's existing language/number preferences. Native deal/lead amount entry continues to use the record's currency and canonical value.

Existing custom monetary fields remain in company base currency, as documented in `multicurrency.md`; they have no per-field currency metadata. Their inline, bulk and create controls now show the actual canonical entry unit with its currency code and localized name, including an accessible description. For example, a stored 1 IRR can read as 0.1 toman, while its editor remains 1 and explicitly says IRR/rial. A toman display preference never converts editor input, changes another currency or changes the submitted amount. FA/DE regression fixtures exercise that read-to-edit transition and preserve canonical saves.

## Phone numbers

Phone fields keep `value` exactly as authored, including Persian/Arabic digits and spacing. An optional selected ISO country is the default context for national numbers; it is never inferred from interface language. An explicit international prefix takes precedence. The server derives optional `e164` and `normalization` metadata from `value` and `country`, ignoring any client-supplied canonical identity.

| Original input     | Selected country | Separate canonical number |
| ------------------ | ---------------- | ------------------------- |
| `۰۹۱۲ ۳۴۵ ۶۷۸۹`    | Iran (`IR`)      | `+989123456789`           |
| `٠٩١٢ ٣٤٥ ٦٧٨٩`    | Iran (`IR`)      | `+989123456789`           |
| `۰۲۱ ۸۸۷۷ ۶۶۵۵`    | Iran (`IR`)      | `+982188776655`           |
| `030 23125 000`    | Germany (`DE`)   | `+493023125000`           |
| `+49 30 23125 000` | Iran (`IR`)      | `+493023125000`           |

Without country context, a national number remains available for review. Invalid or incomplete numbers, short service codes and numbers with extensions do not become verified recipient identities. Structural validity never proves ownership, assignment or reachability. Suffix matches are review suggestions; full international numbers with different country codes cannot match by suffix. Multiple matching contacts require the user's choice, and existing visibility permissions filter candidates before phone details reach the UI.

Country choices are available in contact/create/edit workflows and CSV mapping. CSV originals remain in the import row's raw data. Phone metadata is JSON only; no database migration or replacement of historic contact identifiers is required. Existing MCP contact writes use the same server schema and recomputation as UI writes.

## Date imports

Source calendar and time zone are explicit import choices, independent of interface language, profile calendar and profile time zone. New mappings of built-in date fields default to Gregorian/UTC. Historic mappings with neither option retain their previous Gregorian/UTC behavior.

Accepted configured civil formats are `YYYY-MM-DD`, `YYYY/MM/DD` and German `DD.MM.YYYY`. Persian and Arabic digits normalize at the input boundary. Ambiguous slash orders such as `04/03/2026` are rejected. A year such as 1405 is never guessed to mean a Persian year.

- Close dates and custom date values are Gregorian civil dates in storage; no time zone shifts their day.
- Offsetless timestamps use the selected source calendar and zone, then become UTC instants.
- Explicit ISO `Z` or UTC offsets identify Gregorian instants and remain authoritative.
- Configured date-only activity imports store canonical `allDay`/`dueDate` metadata plus a compatibility anchor in the selected zone. The actor's profile zone cannot change that civil date.
- Missing local clock times fail validation. Repeated local clock times require an explicit UTC offset in the source, with localized review guidance.

Examples: Persian `۱۴۰۵/۰۱/۰۱ ۰۹:۳۰` in Tehran → `2026-03-21T06:00:00.000Z`; its date-only form keeps civil `2026-03-21` with anchor `2026-03-20T20:30:00.000Z`. Berlin `2026-03-29 02:30` does not exist. Berlin `2026-10-25 02:30` requires an offset: `+02:00` → `00:30Z`, `+01:00` → `01:30Z`.

## Dependency and qualification boundary

The package manager remains Bun 1.4.4. Phone normalization uses pinned **libphonenumber-js 1.13.15**, MIT, with `/max` metadata and strict whole-input parsing. Metadata updates must rerun Iranian mobile/landline, German geographic/mobile, localized-digit, explicit-foreign-prefix, short-code/extension, client-forgery, import persistence, match visibility and FA/DE screen tests. New allocations can require metadata updates; original input must survive an unsupported range.

Automated tests use synthetic contact details, real isolated PostgreSQL, deterministic provider doubles and local UI fixtures. They establish parsing, persistence and authority behavior; they do not establish real-number ownership or live SMS/voice delivery.

Primary implementation references:

- [Iran numbering plan supplied by its regulator to ITU](https://www.itu.int/dms_pub/itu-t/opb/sp/T-SP-OB.1173-2019-OAS-PDF-E.pdf): country code +98 and national prefix 0.
- [Bundesnetzagentur numbering](https://www.bundesnetzagentur.de/EN/Areas/Telecommunications/Numbering/start.html): German country code +49 and numbering authority.
- [libphonenumber-js official README](https://gitlab.com/catamphetamine/libphonenumber-js/-/raw/master/README.md): explicit default country, strict extraction, metadata and validity limits.
- [Temporal time-zone documentation](https://tc39.es/proposal-temporal/docs/timezone.html): civil dates, exact instants and daylight-saving ambiguity.
- [tzdb Asia source](https://raw.githubusercontent.com/eggert/tz/main/asia) and [Europe source](https://raw.githubusercontent.com/eggert/tz/main/europe): time-zone rules underlying the Tehran/Berlin examples.
