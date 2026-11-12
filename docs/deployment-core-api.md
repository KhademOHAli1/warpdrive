# Core API extraction and acceptance

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
