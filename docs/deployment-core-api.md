# Core API extraction and acceptance

The first-seam evidence below is retained at its tested source. The optional process checkpoint added afterward extends that seam; installed service acceptance remains open.

The first seam shares the current tRPC Fetch transport and native request authentication.
It does not create a deployed service or move database ownership out of Next. This work
contributes to phases 3 and 4 and OPS-002/OPS-011; all five deployment phases remain open.

## Current boundary

`src/server/trpc/context-core.ts` accepts an explicit database and request cookie reader.
It uses the existing opaque native session credential loader and actor hydration. The HTTP
adapter reads the actual Request cookies, ignores actor/session authority headers, captures
server-owned CSRF facts and keeps each actor local to its request. The existing Next adapter
retains its zero-argument React request cache, database and locale preference behavior.

`src/server/trpc/http.ts` preserves `/api/trpc`, batching, router serialization, response
headers, Server-Timing and the existing expected/unexpected error handling. The public Next
route still supplies the cached Next context. The native fixture supplies the explicit Request
adapter to the same full router. Newsletter commands use the existing input CSRF token and
validation rules with server-captured Cookie/Origin/Host/Sec-Fetch-Site facts. Missing facts
deny writes; request input cannot invent its own CSRF context. The neutral cookie parser is
compared with the installed Next parser in focused tests.

The context shares a five-second abort deadline across session lookup and actor hydration.
These signals do not by themselves prove driver-side query cancellation. Database/pool,
body/header, concurrency and queue admission for any future deployed Core service remain
separate requirements.

## Retained evidence

`docs/deployment-evidence/core-api-native-20261112.json` records seven passing checks against
an actual owned PostgreSQL16 database and Bun loopback HTTP listener. The native gateway
issued the session cookies. Administrator admission required real TOTP enrollment and
verification; the fixture never inserted MFA assurance or treated a session row ID as a bearer.
Interleaved actors retained private-record and management-permission isolation. Direct and
HTTP reads agreed, SuperJSON preserved dates, and batching/timing/expected-error behavior
passed. All named fixture rows, listener, PostgreSQL process, socket and temporary cluster
were removed. Anonymous native rate/security residue required complete cluster teardown.

The accepted run took 3.262 seconds with sampled combined peak RSS 395,460,608 bytes, below
its 180-second/1GiB envelope and 512MiB Bun cap. The report binds the tested source hashes.
This is a source-level selected-read proof with an isolated owner fixture role; it is not
final-image, restricted production-role, installed or cross-version acceptance. The first
failed cleanup attempt remains retained in the task evidence and is not accepted proof.

The full configured typecheck, scoped typed ESLint, formatting and 38 focused Core tests
passed after correcting the generic Fetch options and a test's possibly absent mock call.
Source compilation reached 6.24GiB sampled RSS on its earlier terminal check; the final
incremental check used 2,424,045,568 bytes and typed lint used 3,874,340,864 bytes. Earlier
resource-held checks and the same six-GiB hold on the pre-extraction baseline are retained.
These source-tooling measurements do not establish a cold-build cost reduction or change
the native fixture's one-GiB budget.

## Remaining extraction work

Before introducing an independently deployed Core API, define and qualify the supported
API, WebSocket, job and Engine contract versions and old/new matrix, including open Next
assets and Server Actions. Move the intended writes and their current authorization into
cohesive domain boundaries; SSR and Server Actions still access the database directly today.
Prove bounded pools/query cancellation, current workspace isolation, authenticated transport,
startup/draining, candidate routing and compatible rollback in actual final images.

Connect those contracts to authenticated component provenance, selective builds, mixed-source
assembly and unchanged-artifact staging promotion. An unchanged input hash or passing native
fixture cannot authorize artifact reuse, deployment or uncertain write replay. Add another
service only when the qualified boundary justifies its operational and resource cost.

## Optional Core HTTP process checkpoint

This work adds a process boundary around the **complete existing tRPC router**. It is part of the deployment redesign tracked by #483 and #492. Native service/image qualification and the optional image/routing/provenance profile remain open. The current four-image release receipts retain their original meaning.

The Web process continues to own authentication HTTP routes, Next rendering, assets and Server Actions. Existing SSR callers/actions still have direct domain access. The new entrypoint alone does not establish exclusive Core data ownership or prove independent feature shipping.

### Startup and routing contract

`src/entrypoints/core-api.ts` requires Bun and the explicit `RUNTIME_COMPONENT=core-api` profile. It serves only `/api/trpc`, `/api/trpc/*`, `/healthz` and `/readyz`. The request context uses the actual cookie credential, database-derived actor and captured CSRF facts. Actor headers and RPC inputs cannot install a resolver or authentication authority.

Startup admits the actual runtime database role, reads the Web metadata contract, admits the preprovisioned queue schema, starts a producer without consumers/migrations, checks cheap database/queue health, and then binds the listener. Failure remains unavailable and invokes the same bounded shutdown controller. The startup deadline uses both a timer and monotonic checks at awaited/publication/bind boundaries.

`CORE_WEB_ORIGIN` must follow **accepted Web ingress**, rather than a particular old/new Web slot. The fixed public `/api/runtime/web-identity` endpoint exposes only version and source declarations; it does not attest an inspected image digest or routing acceptance. Core forwards no cookie or provider credential. The version procedure has no local Core-version fallback when this read fails.

The optional routing profile must first install a metadata-capable Web baseline. An older Web without the endpoint cannot admit this Core process. On fresh installation, Web and ingress must serve metadata before Core admission; ingress must **not** wait for Core health to start. Switching the API route remains a deployment readiness gate. Do not retry an uncertain mutation through Web or another Core instance.

### Connection profile

The existing exported application database singleton is reused throughout the full router import graph. Core does not create a second context pool. The defaults below are finite admission settings, not throughput or capacity qualification.

| Setting                | Default | Accepted range                                     |
| ---------------------- | ------: | -------------------------------------------------- |
| `CORE_PORT`            |    3010 | 1–65535                                            |
| `CORE_DB_MAX`          |       8 | 4–16                                               |
| `CORE_PRODUCER_DB_MAX` |       2 | 1–4                                                |
| `CORE_DB_CONNECT_MS`   |    2000 | 250–5000                                           |
| `CORE_DB_STATEMENT_MS` |   30000 | 5000–120000                                        |
| `CORE_DB_QUERY_MS`     |   35000 | 6000–125000; at least 1000 above statement timeout |
| `CORE_DB_LOCK_MS`      |    2000 | 100–5000; below statement timeout                  |

`CORE_HOST` defaults to the container interface `0.0.0.0`; local proofs use loopback. Owner migration credentials are rejected in this profile. The Core database URL declares its user, host and database explicitly. Only the reviewed TLS query parameters are allowed, since installed pg otherwise reparses URL options after explicit timeout settings.

The producer has no LISTEN connection, scheduler or supervisor. Steady pool capacity is application maximum plus producer maximum; startup additionally owns one sequential max-1 queue admission reader. Readiness shares existing pools. Application idle-in-transaction termination stays disabled because existing cohesive transactions can await bounded provider work; transaction-local tighter query limits remain effective.

Absent a Core profile, inactive Core settings do not change legacy configuration admission or pool options. Development hot reload adopts a matching old legacy cache or reuses an identical profile. A changed effective profile requires process restart, rather than creating another pool beside in-flight requests.

### Drain and remaining resource gates

One signal controller stops HTTP admission, awaits native listener/handler/stream/probe completion, detaches and stops the producer, closes the Web identity reader, and ends the application pool. Actual queue startup/catalog/close promises remain owned behind visible timeouts. Failed or unknown cleanup cannot be reported as a clean drain. Deadline expiry is nonzero and does not advance to close dependencies under unfinished work.

The current 80 MiB body envelope preserves the existing ingress limit. Aggregate body reservations and four admitted HTTP requests do **not** bound tRPC procedure batches, materialized result sizes, process RSS or whole transaction duration. Client/server batch compatibility, pagination/output contracts, actual process/final-image failure checks, feature/component monitoring, image custody and installed deployment acceptance remain required. Thousands of workspaces is optional design headroom, not an acceptance target.

### Stable source checkpoint

`docs/deployment-evidence/core-runtime-checkpoint-20261112.json` retains full configured typecheck and changed-source typed lint, 194 focused tests, 28 component guard tests, 45 native PostgreSQL role cases and 12 native HTTP checks. The HTTP proof includes 60 denied commands with unchanged domain state and no Engine effects, plus real authenticated mutations. The existing queue integration suite now also checks the role gate against its migrated restricted-role fixture, including an unsafe grant option and restoration; that integration test still requires the new commit's hosted CI run.

The first native entrypoint run passed its application assertions. Its external supervisor
failed during finalization with a `PermissionError` while signaling an inferred residual
process group. The exact rejected group and complete native before-hash and resource-peak
receipts were unavailable. Separate verification confirmed that all recorded processes,
listeners and fixture files were gone. The standalone bundle rerun below provides the
successful automated native evidence.

Historical committed-source CI at `e9275e69` is separately retained in `docs/deployment-evidence/ci-e927-20261112.json`. It does not cover the newer optional-Core code. No production deployment, publication, merge or completion of the five-stage programme follows from this source checkpoint.

### Standalone bundle and local proof

`scripts/build-core.mjs` builds the Core HTTP entrypoint and workflow code worker
using the same external-package compilation options as the other server processes.
`deploy/images/Core.Dockerfile` packages them with the locked production dependencies
and an exact source revision. Its build needs neither a Next compilation nor the
Web, Worker, Realtime or Migrator artifact.

The standalone Core bundle passed the native Bun 1.4.4 and PostgreSQL 16.10 fixture
in 52.24 seconds, with a 594,214,912-byte sampled combined RSS peak. Core ran with
production configuration in an isolated working directory without checkout source
or Next output. The native fixture used installed host dependencies and a synthetic
Web metadata listener. It verified authenticated ownership and writes, CSRF denial,
Web version refresh without Core restart, producer-only queue operation, repeated
signal drain, and rejection of owner credentials and two incompatible metadata
responses. The supervisor confirmed unchanged inputs and clean process, socket and
fixture teardown. Native Linux image qualification and admission to ingress remain
open.

The optional `deploy/images/compose.core.yml` overlay adds one service with no
published ports and a private runtime configuration. Load it after the existing
image overlay. Set `WARPDRIVE_CORE_IMAGE_REPOSITORY`, the admitted 64-character
`WARPDRIVE_CORE_IMAGE_SHA256` and `WARPDRIVE_CORE_ENV_FILE`. Supply the restricted
database URL and accepted Web ingress origin through that private file. Select the
already observed bridges with `WARPDRIVE_CORE_INGRESS_NETWORK` and
`WARPDRIVE_CORE_DB_NETWORK`, and the unique relay-side alias with
`WARPDRIVE_CORE_INGRESS_ALIAS`. The overlay adds a read-only service with dropped
capabilities and no public router or published ports. Existing services retain their
configuration. The container gets 75 seconds to stop, including the runtime's
60-second drain deadline.

`scripts/deployment/caddy_core_config.py` compiles the optional route from the
exact admitted Web relay. It sends only the tRPC path to the private Core alias,
preserves Web version metadata and previous-generation Server Actions, and gives a
failed Core request no second upstream. In a native macOS rehearsal, two production
Web builds shared the same packaged Core process, producer generation, Worker,
Realtime and PostgreSQL instance. Chromium kept the authenticated draft and used
Core for its Realtime tickets across the switch. Both admitted Web stamps wrote
one authorized report each. Missing CSRF and unknown or retired stamps produced
zero writes. The Web rollback kept serving after a deliberate Core stop.
The optional image smoke also exercises a native Web sign-in, session reuse by
Core, a Web-version read and a CSRF-checked durable write in its fresh database.
Select both `core_image_rehearsal` and `web_release_rehearsal` in the production
image workflow to run the retained-Core check against the two distinct Web
images. It reuses the same archived candidate image ID and the same qualified
Core image ID. It verifies the baseline bundle and the exact local image metadata
before reusing the images loaded by the browser rehearsal. The standalone browser
and Core image checks run in that workflow as well.

The successor controller can retain an independently admitted Core across forward,
rollback, reapply and failed-candidate recovery. Its optional profile pins the original
installation binding, the current accepted Web chain and the separately observed
Core witness. It verifies the exact running Core image, process and network endpoints
around a bounded direct readiness read. The same protected fingerprint and Core alias
must hold throughout every Web route change. Use `installed_core_operator.py` for
the initial route-only operation. It requires independent pins for the existing Web
pair, original installation authority, exact Web-only Caddy preimage and retained Core
profile. The profile binds the projected chain. Its hash can be computed from the
original chain, compiled Core route and pinned backend witness before activation.

`activate` persists intent before one Caddy compare-and-swap and keeps both Web
generations. The probe makes one anonymous GET to `/api/trpc/version.get`. The exact
Core proxy marks the response, strips the probe header before forwarding, and returns
the expected protected tRPC denial. Direct readiness and public Web health are checked
alongside live and persisted Caddy state. An uncertain response leaves the operation held
for readback. `reverse` can restore the original route before lineage acceptance after
it verifies both original Web slots, the old backend, and the exact Core postimage.
Reverse uses its own durable intent and verifies the original public route before
clearing the hold.

`seal` records the proposed route and backend projection while retaining both original
Web artifact receipts. `accept` requires the independently reviewed projection and
acceptance digests. It verifies the route again, writes the accepted lineage, then
advances the Web pointer and clears the hold. The first following Web release supplies
the historical chain and both Core lineage pins. Its new seal records the retained
artifact on the new backend while preserving the historical bytes in their original
custody. Linux images and installed routing still require native qualification.
