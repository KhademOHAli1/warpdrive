# Calendar authorization foundation

This is a separate Calendar grant. Sign-in and Gmail credentials are neither read nor
updated. The injected `CalendarOAuthConfig` must come from trusted deployment
configuration; it is not a request payload. An account marked `connected` has a
validated grant stored locally. Durable calendar metadata and explicit local selection
now have their stated local qualification. Event synchronization/mapping, Meet creation,
watch registration and real Google acceptance remain separate work.

## Server entry points

- `beginCalendarAuthorization` creates durable, expiring state for the authenticated
  owner and snapshots that owner's account IDs and connection generations before HTTP.
  It returns the authorization URL and independent browser nonce once.
- `finishCalendarAuthorization` consumes the state before HTTP, exchanges the code,
  validates granted scopes and verified Google identity, and stores the encrypted
  refresh token. A reconnect with an account ID must retain the existing Google `sub`.
  Durable generation pins and owner snapshots prevent older targeted or untargeted
  same-subject callbacks from replacing a newer connection.
- `listCalendarProviderAccounts` returns owner-only metadata. It never selects
  encrypted credentials for its result.
- `getCalendarAccessGrant` returns a short-lived server token with authoritative account
  ID and connection generation after a fresh owner/account check. It refreshes outside database locks, then checks owner, status, and
  credential version and connection generation before storing rotation or returning
  access. Ordinary refresh increments only the credential version. Concurrent refresh callers
  may receive `conflict` and must start a new authorized request rather than reuse
  their stale token response.
- `disconnectCalendarProviderAccount` clears the local refresh token and invalidates
  owner authorization attempts, including callbacks already exchanging their code.
- `revokeCalendarProviderAccountsForUser` is the trusted transaction-level
  offboarding seam, including for an already inactive user. The existing auth
  `revokeUserAccess` lifecycle calls it for deactivation, managed access revocation,
  and recovery cleanup. Ordinary current-device logout retains Calendar grants.

Successful existing-account binding, disconnect, reauthorization-required invalidation
and offboarding advance the connection generation as well as the credential version.
The lifetime fence does not replace credential CAS: an older refresh result cannot
rotate or clear a newly rebound connection.

## Product account controls

Settings > Connections uses the protected owner-scoped `calendars.googleAccounts`
query and CSRF-protected local disconnect action. Missing dedicated app configuration
disables connect/reconnect while local disconnect remains available. OAuth-start
navigation validates the fixed Google authorization destination; callback feedback is
allowlisted and the account list remains authoritative. A connected account is shown
separately from calendar synchronization, which is not available yet.

A committed local disconnect immediately shows disconnected state and hides catalog
metadata and the Disconnect control even if the following account-list read fails.
That confirmation remains until a successful post-commit read can supersede it; stale
pre-commit account data cannot acknowledge the change. Connect/Reconnect remain usable
after the mutation finishes when deployment configuration permits them.

The earlier 28 UI/boundary tests and actual Farsi/German desktop/mobile acceptance cover
their stated account-card boundaries. That browser evidence is the unconfigured workspace
with zero accounts and attempts. The later catalog panel has separate synthetic
browser/server/database acceptance below. Neither run qualifies configured Google
consent/reconnect/disconnect or real provider acceptance.

## Durable catalog and local selection

The protected `calendars.googleCatalog` query reads persisted owner-scoped metadata only;
opening an account's compact inline disclosure never starts provider discovery. Explicit
discovery obtains an authoritative access grant, collects the full CalendarList and publishes
only while its connection generation, independent latest-run authority and deadline remain
valid. A later failure preserves the prior catalog. The safe DTO omits access credentials,
raw provider payloads and sync tokens. Disconnected/reauthorization-required accounts do not
expose old Google catalog metadata.

Catalog rows have stable identities. Generated SHA-256 keys, exact identifier comparison
and returned-row-count checks protect publication of long opaque IDs; an incomplete batch
or identity conflict rolls back. JSON/Unicode validation and the 64 KiB entry, 10,000-entry,
16 MiB aggregate-entry and finite-page bounds are local operational policy.

Add creates a NEW dedicated non-primary provider-source calendar and stable binding
atomically. It never retargets an existing personal/CRM calendar. Catalog and binding
revisions gate selection; missing/invalid time zones and unavailable resources cannot
be added. Remove preserves the source marker, calendar identity and selection tombstone.
Until event projection and outbound adapters exist, internal provider calendars remain
hidden from normal native lists and generic native event/calendar/ACL paths fail closed.

The localized inline panel uses explicit Add/Remove controls and shares its pending gate
with Connect/reconnect/disconnect. Failed discovery or saved-list reads keep Add blocked
until an authoritative successful review/refresh. Returned query errors and thrown read
failures are handled, and a committed selection keeps its receipt and saved acknowledgment
if the following read fails. Missing app configuration disables discovery/Add while a
connected account's saved local Remove remains available. Disconnected selection-management
UI is not delivered: backend Remove supports known local IDs offline, while the current
disconnected-account UI hides metadata and selection controls. No sync or Meet control is
enabled, and saved selection explicitly says that events are not displayed yet.

The earlier 150-native/24-panel/52-affected-unit milestone preceded the separate clock
and disconnect-cache regressions. The current affected native selection passed 152/152
cases across 25 files in 25.31 seconds, and the affected account/UI selection passed
53/53 cases across seven files in 2.21 seconds, including all 25 panel/query cases.
The five UI error/zone failures and the later disconnect-cache failure were observed
before their fixes. Fresh full types and scoped translation/Biome/typed ESLint passed
on 50 TypeScript and three JSON files. One informational Biome null-case suggestion
remains; typed exhaustiveness requires the explicit branch.
Synthetic browser/server/database acceptance passed in Farsi and German at desktop
1512 by 771 and mobile 390 by 844, with mobile scroll width 390 and keyboard disclosure.
Local Add/Remove/re-Add retained the same binding and calendar UUIDs at versions 1/2/3;
availability-only Add stayed disabled. Local disconnect hid provider metadata/disclosure,
advanced account version/generation to 2 and cleared the token. No event import, sync or
Meet outcome was claimed. The isolated `calendar-catalog-<seed>.localhost` host kept its
cookies separate. Exact cleanup restored all original shared fields/versions and zero
provider state; Farsi/Persian/Tehran preferences and viewport were restored, the owned tab
closed, and environment/frozen source stayed unchanged. Five screenshots are recorded in
the acceptance register.

The preserved fixture passed guarded migration 0092 without changing any original
event/calendar field or version. After browser work, the app stopped and independent
process/port checks confirmed its group and port empty. The shutdown wrapper returned
exit 1 because its post-stop group probe hit EPERM. This is a harness limitation, not an
app failure or a clean wrapper pass. The app was not restarted. Actual Google
app/consent, an accepted combined migration cut and installed-upgrade proof remain open.

## Route integration contract

`POST /api/calendar/google/oauth/start` derives owner ID from the live application
session and requires the existing JSON workflow CSRF guard. It accepts only an
optional owned `accountId`; GET is inert. Its response contains the authorization
URL and expiry, and sets the independent nonce in an HttpOnly, SameSite=Lax cookie
named `CALENDAR_OAUTH_BROWSER_COOKIE_<sha256(state)>`. Each attempt has its own cookie.
The cookie is Secure for HTTPS, restricted to `/api/calendar/google/oauth/callback`,
and uses only the persisted absolute Expires deadline, with no issuance Max-Age
override. A delayed start response cannot extend that attempt's browser binding.
This follows [cookie expiry precedence](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.2.2).
The nonce is absent from response JSON and URLs, is inaccessible to client-side
JavaScript, and is not logged by these handlers.

`GET /api/calendar/google/oauth/callback` requires a live owner session plus that
attempt-specific browser cookie, clears only its own cookie on a validated terminal redirect,
and sends only a fixed
`/settings/connections?googleConnect=...` status. It rejects HEAD without consuming
state. Malformed or duplicate callback inputs clear no cookies. There is no legacy
singleton-cookie fallback. Provider denials validate owner, browser binding, expiry, and pinned app
before atomically cancelling and consuming the attempt. Do not expose the PKCE
verifier, refresh ciphertext, or access grant through a client DTO.

Configure `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` and
`GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` together; the secret also supports `_FILE`.
`GOOGLE_CALENDAR_ACCESS` accepts `readOnly` or `readWrite` (default). Both app values
may remain unset. No Gmail or login app fallback exists. The callback URI is derived
from trusted `BASE_URL` and the fixed path above. An unconfigured start returns a
neutral `unavailable` code with HTTP 503 for the product UI to localize.

The existing active-owner lock serializes admission to at most eight unexpired
attempts per owner across all browsers. Pending, consumed and cancelled rows all count
because their responses may still be in transit. Exact expiry frees capacity; another
owner has an independent allowance. A capped start returns `rate_limited` and HTTP
429 without inserting an attempt or issuing a cookie. Expired records still require
a retention sweep. The current account card uses its generic connection-start failure
for 429; contextual quota/retry feedback remains a refinement.

State is opaque and SHA-256 hashed in the database; PKCE uses independent random
material and mandatory S256. A callback requires the matching active session owner,
browser binding, client ID, exact redirect URI, requested access, unexpired unused
state, and an uncancelled attempt. Consuming state removes the encrypted verifier.
The encrypted verifier on abandoned expired attempts still needs a retention cleanup
job; expiry already prevents its use. A rejected or interrupted exchange requires a
fresh start.

Two consume/bind expiry-after-owner-lock-wait regressions failed for the intended
synthetic-transport/grant-acceptance behavior, then passed after the clock callback was
sampled after owner/attempt locks. The focused two cases passed in 0.915 seconds and
the affected 152-case return passed in 25.31 seconds on its unchanged frozen source
manifest. Fresh full types and scoped static checks passed. These results establish
their local clock/lock behavior, not real provider expiry acceptance.

The consented Google account may have a different email from the workspace owner.
Deployments can opt into `requireSameEmail` or an `allowedDomain`; the domain rule
uses verified Google `hd`, never an email suffix. Verified identity comes from the
fixed Google UserInfo endpoint using the exchanged access token. No ID token claims
from the browser are trusted.

## Local disconnect and acceptance limits

Disconnect does not call Google's token-revocation endpoint. Revoking a token for a
shared OAuth app may revoke combined grants used by another feature. External
revocation needs an explicit product choice and a dedicated Calendar app setup.
Requests refuse redirects so client credentials and bearer tokens are not forwarded
to a different endpoint. Provider messages and token payloads are never returned in
operational errors.

Tests use synthetic transports and a real migrated local PostgreSQL database. There
are no registered test accounts or OAuth app yet. External acceptance requires a
registered local callback, enabled Calendar API, configured test users, consent and
refresh checks, then Calendar/Meet and watch qualification with reachable HTTPS for
watch callbacks. Local tests do not establish any of those provider outcomes.

Google protocol references:

- [Web server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OpenID Connect identity and discovery](https://developers.google.com/identity/openid-connect/openid-connect)
- [OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference)

## Connection-generation migration

The connection-generation change needs a stopped-service cutover. Compose gates cold
startup on migration success, but does not itself drain an older running application.
An older binary can still write the old attempt format, and its table-lock order can
conflict with live DDL. Rolling old/new binary coexistence is not qualified.

This worktree's `0091_calendar_connection_generation` is local candidate numbering.
Before deployment, reconcile it with the accepted combined migration history and build
only the reviewed release images. No deployment or migration against a live customer
installation is authorized by the local test evidence.

The newer `0092_calendar_provider_catalog` is also an unreserved local candidate.
Fresh PostgreSQL tests exercise its catalog/binding/source schema. The guarded
preserved-fixture upgrade passed in 0.196 seconds: all four events and the original
calendar retained every field/version, all existing calendars remain native, and
provider account/attempt/catalog/binding counts remain zero. Seed/browser/cleanup
subsequently passed with synthetic provider state and exact restoration. Reconcile both
candidates with the accepted combined history before integration; no installed upgrade
or rolling coexistence is established.

The promoted local source and migration passed 55 real-PostgreSQL cases across nine
files: 21 lifetime/snapshot cases, four actual legacy-migration cases and 30 existing
authorization/token/HTTP/offboarding cases. Earlier lifetime and legacy-retirement
regressions first failed as expected. These fixtures do not qualify an installed
upgrade. The preserved synthetic browser fixture subsequently passed guarded migration
0091 with all four event fields/versions and zero provider accounts/attempts preserved,
without recreation or an application restart. Configured provider flows remain open.

The former shared browser-cookie interference was reproduced by native HTTP cookie-jar
tests before the local per-attempt cookie and owner-cap fixes. Their 14-case RED had
12 failures and two passing controls in 2.91 seconds. The final combined selection
passed 69/69 real-PostgreSQL cases across 11 files in 11.33 seconds: the earlier 55
controls plus eight HTTP cookie-jar and six admission-cap cases. Full types and scoped
Biome/typed ESLint also passed. This covers reversed start responses, delayed terminal
responses, denial, malformed input, cross-flow nonce substitution and the same-subject
generation fence using synthetic transport. It does not establish configured
simultaneous multi-flow browser/provider acceptance or re-age the earlier unconfigured
Farsi/German browser evidence. The preserved fixture later passed 0092 without
recreation. The later synthetic catalog browser/server/database run has its separate
scope above; configured Google consent and provider acceptance remain open.

Build the matching application, WebSocket, worker and migration images first:

```sh
docker compose build
```

Stop ingress and every old application/worker replica. With the bundled topology:

```sh
docker compose stop caddy app ws worker
docker compose ps -a caddy app ws worker
```

Do not run the migration until all old processes have exited. Stop any additional
replicas, external ingress and independently launched jobs as part of the same cutover.
Keep database and object-store volumes intact. Then run the matching migration image:

```sh
docker compose run --rm migrate
```

The migration must preserve credential versions and encrypted refresh tokens, initialize
connection generations to 1, and cancel every legacy attempt, including consumed
in-flight attempts, while clearing verifier ciphertext. Legacy snapshot and pin columns
stay null; do not backfill an empty snapshot. Legacy consent flows must restart after
the stopped-service cutover; the new handler does not read their singleton cookies.
This is not a rolling old/new binary compatibility promise.

Start only the matching new images:

```sh
docker compose up -d app ws worker
docker compose ps app ws worker
```

Check application/WebSocket health and worker startup before reopening ingress:

```sh
docker compose up -d caddy
```

A failed migration keeps ingress and the long-running tier stopped until the reviewed
forward repair succeeds. Do not start an old image over the upgraded authorization
schema. Local migration fixtures prove their stated legacy-data boundaries, not an
installed or rolling-upgrade qualification.
