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

The separate real Core entrypoint exercised native-cookie owner isolation, CSRF rejection and saved-report writes, Web version refresh without Core restart, a live producer without consumers, repeated-signal drain and three rejected startup configurations. Its assertions passed, but its external supervisor failed during finalization with a `PermissionError` while signaling an inferred residual process group. The exact rejected group and complete native before-hash/resource-peak receipts were not retained. Separate verification confirmed every recorded process gone, all six recorded listeners closed and the exact owned fixture/private configuration removed. **This is not a clean automated native qualification pass.** Repairing that task runner and retaining a successful rerun remains open; the runtime, image and installed acceptance gates are not closed by this checkpoint.

Historical committed-source CI at `e9275e69` is separately retained in `docs/deployment-evidence/ci-e927-20261112.json`. It does not cover the newer optional-Core code. No production deployment, publication, merge or completion of the five-stage programme follows from this source checkpoint.
