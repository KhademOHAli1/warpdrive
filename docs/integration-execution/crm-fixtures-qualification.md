# QA-002: reusable synthetic CRM fixtures

Qualification date: 31 October 2026. This record covers QA-002's acceptance:
"Include visible/hidden records, admin/member roles, stale grants, multiple
accounts and known calendar boundaries without real customer data."
Verification is fixture validation against the existing real PostgreSQL harness.
It does not change task status or qualify a real provider, browser login,
deployment or release.

## Source and profile

The final campaign used repository baseline
`a697067c39d85fc7051a6847d95e569d0ff74ee0` plus the 12 new
`src/test/integrationPlatformFixtures*.ts` files. The observed descendant
`87809b81185752bbed68db3abf60a33f7d969c69` changes only five integration
execution Markdown documents relative to that baseline.

Fixture source/test manifest SHA-256:
`e30ffc575d5dff4372c247cb59377f7d2136fe05d449330818043ef661077f22`.
The manifest is the concatenation, in sorted repository-path order, of
`sha256(file-bytes)`, two spaces, path and newline for every
`src/test/integrationPlatformFixtures*.ts` file. The digest includes all 12 files.
Later code changes require affected verification again.
These 12 files are committed as `bc40519b4f8f7147f6232897c26450bb8c478816`.
The independent clean-checkout broad gates are recorded in
[the current batch qualification](foundation-qualification-20261031.md); this record does not
replace their exact-source results.

Runtime was pinned Bun 1.4.4. Real database tests reused `makeTestDb` and the
Testcontainers `postgres:16-alpine` profile from `vitest.globalSetup.ts`, applying
the actual migration journal ending at `0084_visual_workflows`. Each case owns a
fresh `t_<uuid>` database and closes it through `h.close()` in teardown. No second
database harness, migration, production connection store or queue was added.

The finite review campaign ran with one integration worker, after coordination
with the mail peer. No build/type campaign ran alongside it. Free disk was checked
before the campaign and remained above 5 GiB. No private configuration, customer
records, database dumps or real provider credentials were copied into fixtures
or evidence. The factory requires no real provider credential or provider I/O.

## Reusable API and current-model boundaries

`createIntegrationPlatformFixtures(h, { namespace, now }, signal)` returns a
`Result<IntegrationPlatformFixtures, IntegrationFixtureError>`. `now` is explicit;
the factory does not change global time. Names, addresses, account identities and
credential preimages are synthetic. Namespace collisions return a safe error and
roll back the new attempted dataset.

The factory requires the disposable database name, a PostgreSQL URL with explicit
host/port and no query/hash overrides, and a matching actual `current_database()`.
It opens its own bounded client against that URL rather than acquiring a client
from the harness pool. Its writes remain in one transaction. Use this test-only
factory with an owned `makeTestDb` result, not a preview/private runtime profile.

| Acceptance area | Fixture and executed validation |
| --- | --- |
| Roles and visibility | Four CRM actors: administrator, member, outsider and inactive user. Three deals exercise own-visible, foreign-hidden and restricted-pipeline visibility, including the pipeline gate denying the member who owns the deal. Tests hydrate actual actors and use current `can`/`canSee`. |
| Current native identity | Matching `auth_users` rows and hashed password-session fixtures. The member satisfies fresh native-session policy. The administrator's password session remains MFA-pending and fails privileged fresh access; pending authentication may be inspected for enrollment. No legacy session or fabricated completed MFA enrollment is used. |
| Current OAuth grants | Actual client, access-row, refresh-hash and authorization-code records encode valid, expired, revoked/consumed and inactive-owner cases. Expired, revoked and inactive-owner refresh exchanges fail through the current production exchange path. |
| Positive OAuth control | The valid synthetic refresh preimage successfully exchanges through `exchangeMcpGrant`, produces a rotated successor, rejects replay of the old preimage and accepts the successor. The suite freezes only Date coherently, covering both `Date.now()` and `new Date()` while real network/driver timers continue running. |
| Multiple upstream accounts | Two distinct synthetic Slack workspaces are shared connections owned by the administrator. Current admin credential-use policy succeeds locally; member use is denied. Encrypted fixture material is synthetic and no provider request is made. |
| Personal mailbox limit | Two personal Gmail account rows belong to different users. Actual owner/foreign-owner checks are exercised, and a second mailbox for the same user violates the current real database uniqueness constraint. This does not introduce multi-personal-mailbox support. |
| Independent preferences | Administrator: FA/Gregorian/Latin digits/Berlin. Member: DE/Iranian calendar/Persian digits/Tehran. Outsider: EN/Gregorian/Persian digits/Tehran. The exact preferences survive PostgreSQL round trips independently. |
| Temporal boundaries | Canonical Gregorian date-only Nowruz activity with Tehran midnight anchor; Iranian display correspondence to 1405-01-01; two distinct Berlin repeated-hour instants; and an explicitly rejected Berlin spring-gap wall time. Tests use persisted rows and the existing temporal helpers. |

OAuth access fixtures expose row JTIs, not signed bearer JWTs. The positive
exchange control creates only local test-key tokens while exercising the actual
server path. The current OAuth model has no per-grant capability/scopes column;
the factory explicitly reports that limit rather than pretending a read-only
grant exists. Upstream Slack scopes remain separate from CRM capabilities.

Native identity/session rows are synthetic policy fixtures. They do not establish
real password sign-in, passkey/TOTP enrollment, provider account ownership, browser
cookie onboarding or an administrator MFA ceremony. Preference storage and temporal
fixtures do not establish a complete translated browser journey or provider sync.

## Bounded acquisition, cancellation and cleanup

The owned client's driver configuration is active before connect/preflight:
1,000 ms connection timeout, 4,000 ms server statement timeout and 5,000 ms client
query timeout. The disposable profile is explicitly non-TLS, with `pipeline:false`
and a dedicated `node:net` Socket supplied through pg's supported `stream` option.
URI query overrides are rejected before that client is constructed.

The client installs an `error` event observer before connect. It retains only a
boolean failure state, without logging or storing raw errors, URL or credentials.
The factory checks that state before committing and after cleanup; a background
transport event cannot silently become a reported successful fixture operation.

Caller abort before the commit cutoff closes only the owned transport and the
factory awaits the active operation/transaction failure and cleanup. Startup
cancellation waits for the finite driver connect bound before cleanup, avoiding
pg's unfinished-connect/end race. No write promise is raced away to continue
unobserved. A real unique-key lock test confirms that cancellation finishes before
the blocker is released and that partial user/native-identity rows are absent.

`close(signal)` is idempotent. It awaits `client.end()` and has a 250 ms watchdog
that destroys its owned Socket and records transport failure if an idle peer
withholds FIN. Timer and abort-listener cleanup run in `finally`. The native
transport regression uses only AuthenticationOk/ReadyForQuery framing and a
half-open loopback socket; it simulates no SQL, database rows or database ownership.

Commit certainty is explicit:

| Outcome | Meaning |
| --- | --- |
| Abort observed before the cutoff | Prevent COMMIT, drain the failed transaction/close, and preserve the original caller AbortError. The blocked-write rollback case is executed. |
| Abort after the final pre-COMMIT check | Await COMMIT under driver/server bounds. An acknowledged successful commit remains committed; a late abort does not promise rollback. Cleanup has its own signal so that a late caller abort does not redefine persistence. |
| `commit_outcome_unknown` | COMMIT started and failed or its acknowledgment is uncertain. Do not assume that retrying the whole namespace is harmless. |
| `committed_cleanup_failed` | COMMIT was acknowledged, but a connection/cleanup failure was recorded. Data is already committed; this is not a rollback result. |

The two commit-error classifications are source-reviewed defensive paths, not
claims that COMMIT acknowledgment loss or a post-COMMIT fault was injected in
this campaign. The explicit startup/query/teardown bounds are per-operation
bounds, not a hard total-wall-time promise for an arbitrary fixture or stalled
JavaScript event loop.

## Test-first and final evidence

Logs are in `/tmp/warpdrive-integration-program-private/`; retain redacted copies
in the execution evidence package before deleting that private profile.

| Evidence | Result and scope | Log |
| --- | --- | --- |
| Initial factory API red | Missing fixture module before implementation. | `fixtures-red.log` |
| Native-model behavior red | Real PostgreSQL had zero `auth_users` fixture rows where four were required. Subsequent implementation added native identity/policy fixtures. | `fixtures-auth-red.log` |
| Bounded-I/O review red | Four intended failures: timeout URL override accepted, blocked write still waiting after abort, exhausted shared-pool acquisition still waiting, and supplied startup endpoint ignored. Seven controls, including positive valid refresh exchange, passed. | `fixtures-bounded-red.log` |
| Observer component red/green | Missing owned-client helper first; then the real Client EventEmitter error was safely observed before any connection. | `fixtures-client-red.log`, `fixtures-client-green.log` |
| Teardown behavior red | Unbounded idle `client.end()` stayed pending past one second while the native peer withheld FIN. The test drained/destroyed all stub resources. | `fixtures-close-red.log` |
| Final observer/teardown unit profile | 2/2 pass, including forced close with stable failure state. | `fixtures-close-green.log` |
| Final real PostgreSQL/native-startup profile | 13/13 pass across four files with one worker, after the bounded-close correction. | `fixtures-bounded-green.log` |
| Static checks | Biome, scoped type-aware ESLint and diff whitespace checks pass. ESLint log is empty. Full repository type/build qualification belongs to the owning execution gate. | `fixtures-bounded-lint.log` |

There are 15 unique final fixture cases: 13 integration/native-startup cases and
two constructor/teardown unit cases. Earlier checkpoints and reruns are not added
again to that count.

The final integration command was:

```sh
PATH=/tmp/warpdrive-bun144/bin:$PATH \
DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock \
TESTCONTAINERS_RYUK_DISABLED=true \
/tmp/warpdrive-bun144/bin/bun run test:integration --maxWorkers=1 \
  src/test/integrationPlatformFixtures.integration.test.ts \
  src/test/integrationPlatformFixturesAuth.integration.test.ts \
  src/test/integrationPlatformFixturesConnection.integration.test.ts \
  src/test/integrationPlatformFixturesTemporal.integration.test.ts
```

The final unit command selected only
`src/test/integrationPlatformFixturesClient.test.ts` under `test:unit`.
Independent source re-review accepted acquisition guarding, the positive refresh
control, owned-socket shutdown bounds and commit-certainty distinctions after the
reported findings were corrected. No live provider, public service, customer data
or production database was involved. Broader QA simulator, authorization-matrix,
operations/recovery and actual-provider tasks retain their own acceptance gates.
