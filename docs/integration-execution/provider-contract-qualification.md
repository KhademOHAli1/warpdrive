# Provider contract and registry qualification

Application source: `89adc8158f3e04c14e48ed6258e14abf3f179cc7`, 31 October 2026.
Registry extraction is commit `90ad0f4`; typed contracts and invocation are `89adc81`.
Qualification runs in the independent clean checkout at
`/Users/ali/Documents/Codex/2026-10-31/warpdrive-integration-program/work/qualification`.
Its frozen Bun 1.4.4 install has no lockfile change and does not touch peer previews.

## CONN-002 contract acceptance

`ProviderAdapter` defines correlated input/output slots for authorize, exchange, refresh,
resource listing, check, disconnect and capability discovery. Every supported handler takes
a required AbortSignal and returns Result. Unsupported methods are explicit and never
fabricated successful support. Current candidate/input shapes describe the initial OAuth2
profile; API-key/custom provider handshakes remain their own later implementation work.
Opaque credential IDs/generations are internal references. Exchange/refresh candidates are
server-internal secret material for the owning broker, never a UI/job/log DTO or new store.

`invokeProvider` validates unknown inputs and adapter responses with Zod. It returns only
finite error codes, bounded retry hints and effect certainty, stripping raw messages,
headers, unknown failure details and unexpected success fields. A provider adapter's explicit
rejection codes assert definite no-effect rejection; its actual protocol implementation must
prove those classifications. Uncertain mutation failures conservatively retain unknown
outcome. The helper performs no automatic retries.

The caller's cancellation is preserved before startup, during I/O and after awaits.
Invocation time defaults to 15 seconds and is limited to 60 seconds. Monotonic elapsed-time
checks reject overdue input/handler/response results, including when timer scheduling is
late. Owned timers/listeners are cleared and late noncooperative promise rejection is
consumed. Trusted synchronous CPU cannot be forcibly preempted by this JavaScript wrapper;
it rejects overdue success once control returns. Untrusted execution requires ARCH-009's
real OS/container isolation, not this helper as a security sandbox.

28 deterministic contract tests exercise all seven operation shapes, correlated types,
support discovery, invalid boundary values, safe failures, rate limits, expired authority,
mutation ambiguity, pre/mid cancellation, elapsed deadlines, late results/rejections and
resource cleanup. The fixture is synthetic and makes no provider network call.

Observed red evidence includes missing initial contract exports, inappropriate ambiguous
read-only discovery, malformed URL parser throws, lost mutation uncertainty, timer-late
success, cancellation during validation and a throwing input getter. Corrected code passed
both the author's suite and an independent re-review's 28-test run/reproductions.

## CONN-003 registry acceptance

The existing 21 provider IDs/order and current card/detail/mark layout remain. One registry
now supplies local asset paths, localized description keys, implemented auth types and
local/planned availability. Planned entries advertise no implemented auth types. Consumers
read the selected metadata rather than independently constructing it. Existing server
configuration, current account authorization and connection health remain distinct state.
No token, private account field or client secret enters registry metadata.

New red tests caught absent metadata and a mark bypassing the registry-selected asset.
The focused integration directory/catalog/asset/palette suite then passed 63 tests across
11 files, including FA/DE/EN description resolution. Independent review confirmed stable
IDs/delivery discrimination, current presentation/copy and accurate evidence limits.
Those checks preserve existing journeys; they do not establish new complete provider setup,
recovery or actual host/browser/provider authorization workflows.

## Authority and provider boundaries still open

The helper is an internal contract runner, not an HTTP endpoint, permission evaluator,
credential broker, endpoint/DNS resolver or OAuth state/PKCE service. Its caller must first
resolve current actor/grant/installation/connection/resource authority and use an accepted
provider profile. Generic HTTP URL syntax validation does not replace exact registered
callback and provider-origin policy. Capability discovery is not consent or CRM permission.

Current Slack production functions still use their prior service/transport path. They have
not been adapted to this helper or qualified as conforming merely because the fixture passes.
No real Slack/Gmail installation, refresh rotation, provider delivery, shared ownership
migration, lifecycle engine, public host or external release was performed in this batch.
CONN package completion requires the remaining shared lifecycle/credential/ownership work
and two providers exercising it; three foundation rows do not satisfy that package exit.

The independent mail peer retains its uncommitted domain/endpoint/schema work. No source,
credentials, migration or test claims were copied from that dirty tree. The newer clean
workflow peer remains a separate review/adoption checkpoint. The active register stays at
446 rows; proposed SMS scope and its vocabulary extension remain unimported planning input.

## Exact-head validation

The independent checkout was clean at the exact source head above. All broad checks passed:

| Gate                            | Observed result                                                   |
| ------------------------------- | ----------------------------------------------------------------- |
| Frozen install                  | 1,013 packages installed under Bun 1.4.4 without lockfile changes |
| Full root unit lane             | 5,856 tests passed across 941 files                               |
| Applicable real PostgreSQL lane | 116 tests passed across 34 files                                  |
| Production build                | Passed, Webpack, private synthetic compile-only configuration     |
| Standalone typecheck            | Route generation and no-emit TypeScript passed                    |
| Full lint/i18n                  | Passed, same 11 pre-existing cookie/optional-chain warnings       |
| Worker/WS/operator bundles      | Passed                                                            |
| UI registry                     | 23 pristine files verified and registry dry-run passed            |
| Actual isolated service smoke   | Ten checks passed again; synthetic fixture cleanup included       |

Logs are retained privately and copied with private values redacted into the durable checkpoint.
The clean qualification checkout contains committed source only; live peer planning edits in
preview were not staged or used as completion evidence. No application source changed after
this run while the execution register and handoff were finalized.

Final broad checks are recorded in the durable checkpoint and logs on the source above.
The relevant unit, PostgreSQL, build, type, lint/i18n, worker bundle, UI registry and local
service results remain distinct evidence classes under [QA-001](evidence-taxonomy.md).
Subsequent documentation/register-only commits can reuse these results after confirming
that application/runtime/schema/dependency source is unchanged.
