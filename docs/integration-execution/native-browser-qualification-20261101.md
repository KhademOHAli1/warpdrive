# Native browser qualification: bounded account and regional scope

1 November 2026. Application source remains
`7c8bb7ed013ef5eb9543399566bc5175a12df633`, served from the clean independent
qualification clone with Bun 1.4.4 and owned PostgreSQL 18.1 on loopback 55436.
Chromium 156.0.8078.79 was observed in the same retained browser after closing the
separate owned context. No provider, hosting, publication or release is qualified.
The authoritative register remains **40 completed, 406 planned, out of 446**.

## Actual execution and preservation

Attempt 1 created a pristine local 0..84 database and verified all 85 ledger
hash/time pairs and 23 empty aggregates. Its driver refused before web/bootstrap:
PostgreSQL rendered the inet-to-text address as `127.0.0.1/32`, which differed from
the harness's expected text. Correct DB, role, PG18, port and binary loopback equality
were confirmed read-only. Group 41083 was empty, port 3160 absent and the window
released. Its failed fixture and actual refusal artifact remain preserved.

R2 used exact binary inet equality, new private profile
`/tmp/warpdrive-native-browser-20261101-r2` and database
`warpdrive_native_browser_20261101_r2`. No existing user or failed fixture was reused.
Its fresh grant retained a 20-minute total including cleanup, 180-second startup
ceiling and fresh/live 5 GiB floor. The existing role is a superuser; this is not
least-privilege isolation. All 85 ledger pairs, 23 empty aggregates, bootstrap and
actual post-web PgBoss/provider/import/revocation guards passed before bootstrap.

Supervisor session 61122 exited 0 after **1169.928 seconds including setup/cleanup**.
Minimum observed available disk space was 12,280,311,808 bytes. Bootstrap 47402 exited
0; web 47355 and auth-driver 47347 shut down with owned SIGTERM, exit 0. All three
groups were empty and the owned BrowserContext closed. Exact source, clean clone,
original configuration and nine peer hashes were preserved. No peer process or
browser context was stopped, and no database or private profile was erased.

Read-only postflight found no R2 clients or listeners on 3160, SMTP 62818 or 18180.
Original programme users/auth users/mailboxes/auth mail/revocations/connections all
remained zero. R2 had one intended active administrator/native identity, password
account and verified TOTP factor; no passkeys, providers, imports, revocations,
queued jobs or schedules; and three auth messages sent through real loopback SMTP.
Private identity, keys, bearer URLs, codes, cookies and raw web logs are excluded.
No full worker, realtime service or S3 behavior was started or qualified by this run.

## Native identity and assurance

Actual supported operator invitation and received SMTP links led to browser signup
200, native email verification 200 and password sign-in 200 through the Next HTTP
gateway. Anonymous Regional Settings redirected to login. The pending verified-password
administrator was denied Regional Settings until enrollment, with needsMfa and
needsEnrollment true and twoFactorEnabled false.

Native TOTP enable returned 200 and ten recovery codes, saved privately before the
real saved-codes checkbox. A known-invalid numeric code returned 401/INVALID_CODE
without granting assurance. A real-clock valid TOTP returned 200; the server reported
the intended verified native administrator, password/twoFactorEnabled true,
needsMfa/needsEnrollment false, fresh true and authMethod verify-totp.

The observed freshness policy is five minutes. The fixture refused stale proof;
two later real native UI TOTP step-ups returned 200 and restored server-computed
freshness. No clock, session, credential row, MFA flag or assurance was fabricated.
An initial code-window refusal was resolved by waiting for a real new timestep.
These are bounded observations, not all native security, replay or revocation cases.

## Six account-persistence and rendering cases

Each completed row saved through the actual controls, removed only the four regional
cookies, retained native/CSRF and other cookies, reloaded, and rechecked all four
choices plus the intended fresh native MFA principal. This excludes anonymous
cookie-only success. A final SQL read independently confirmed T6's exact account
JSON and profile timezone. The source-defined cookie names are
warpdrive_locale, warpdrive_calendar, warpdrive_timezone and warpdrive_numbering_system.

| Case | Language | Calendar | Digits | Zone | Observed sample date / clock |
| --- | --- | --- | --- | --- | --- |
| T1 | FA/RTL | Gregorian | Latin | Europe/Berlin | 21 مارس 2026 / 10:30 |
| T2 | FA/RTL | Iranian | Persian | Asia/Tehran | ۱ فروردین ۱۴۰۵ / ۱۳:۰۰ |
| T3 | EN/LTR | Gregorian | Persian | America/New_York | Mar ۲۱, ۲۰۲۶ / ۰۵:۳۰ |
| T4 | EN/LTR | Iranian | Latin | Europe/Berlin | Farvardin 1, 1405 AP / 10:30 |
| T5 | DE/LTR | Gregorian | Latin | UTC | 21. März 2026 / 09:30 |
| T6 | DE/LTR | Iranian | Persian | Asia/Tehran | ۱. Farwardin ۱۴۰۵ AP / ۱۳:۰۰ |

Canonical samples were civil 2026-03-21, instant 2026-03-21T09:30:00Z and 12345.67.
Six paired DOM checks matched date, known 1405/2026 year, instant date, timezone
clock, number and direction. The oracle shares browser Intl: it proves rendered
preference binding, not independent calendar authority or every date/DST case.

The frozen seven-tool runner had two initial SSR-readiness timeouts after navigation.
A manual real calendar selection succeeded through its server action. A separate,
independently reviewed helper waited for actual hydrated React pointer handlers,
then performed the six cases with the same native/cookie checks. It inspected readiness
without injecting/calling handlers or app state. Original timeouts and freshness
refusals are retained. This is not a whole-pass claim for that frozen runner.

## Geometry and visual limits

German Regional Settings had document/client widths 320, 390, 768 and 1440, with all
four regional controls enabled and inside each viewport. At 320, calendar ArrowDown
and Escape closed the list, restored focus and preserved selection. Five safe Settings
captures include FA390. No keyboard-commit scenario was completed.

Visual review found limits beyond these metrics: the DE320 calendar label truncates;
lower internally scrolling content is not fully shown; DE1440 global navigation is
cropped, possibly during resize, with settled state unproved. DE captures show Next
development's red 1 Issue badge. Its cause/client console was not captured before
closure and remains unresolved. A server-log keyword scan found none of its checked
error strings; that absence cannot clear a client-side issue.

No full UX-008/010/011/012/013, settled navigation, long-label readability, scrolling,
screen reader, contrast, reduced motion, provider artwork, picker callback/draft,
recurrence, full real-PG suite or release acceptance follows.

## Evidence and restart

Exact public receipts, helper fingerprints, reviews, safe captures and source restore
bundle are in
`/Users/ali/Documents/Codex/2026-10-31/warpdrive-integration-program/outputs/native-browser-qualified-20261101`.
Earlier R1 source/refusal and R2 source-only packets remain immutable.

Private R1/R2 databases and files were retained, not dropped/erased. R2 is populated
and bootstrap-closed: never rerun its empty-profile preparer or fabricate recovery
or a session. Browser cookies were discarded at context closure; the driver's TOTP
secret lived only in memory. Supported future login or a fresh fixture needs reviewed
ownership/configuration and a new finite window. Recovery material stays private.
A completed grant cannot authorize another launch. Follow restart.md and the HANDOFF.
