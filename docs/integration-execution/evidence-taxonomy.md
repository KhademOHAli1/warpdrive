# QA-001: test and evidence taxonomy

Quality review date: 31 October 2026. This taxonomy applies to the active 446-task
execution register. It separates verification stages rather than treating a green
command, commit, screenshot or provider catalog entry as interchangeable evidence.
It does not import the incoming peer scope amendment or close other QA tasks.

## Evidence classes and claims

| Class                     | Required owning evidence                                                                                                              | What it can prove                                                                         | Limit                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Design/source review      | Exact head/diff, owning paths, accepted contract, named scenario review and unresolved findings                                       | A selected design and inspected source behavior                                           | No executed runtime, provider, installation or release claim                    |
| Unit                      | Exact application head/diff, pinned Bun, command/exit, test IDs/count, real assertions and mock boundaries                            | Pure logic, schema, component and deterministic adapter-contract cases actually exercised | A fake provider does not prove real protocol, account or database behavior      |
| Real PostgreSQL           | Actual PostgreSQL version/profile, real migration chain, disposable DB ownership, commands/results and concurrency/rollback cases     | Tested SQL, ownership, constraints, upgrade preservation and transaction behavior         | No provider or unrelated schema-path claim; no database mocks                   |
| Local provider simulation | Fixture provenance and supported operation list, deterministic input/output/failure cases, bounds, explicit simulator label           | Adapter behavior against the stated synthetic contract                                    | No actual provider grant, entitlement, delivery or vendor compatibility         |
| Native local protocol     | Real loopback sockets/TLS/storage/queue/WS process identity, synthetic fixture IDs, positive/negative results and cleanup             | The actual local protocol/service boundary exercised                                      | Still not the real vendor/account or browser identity onboarding                |
| Browser/accessibility     | Exact app/build/profile, route, language and independent display preferences, viewport/theme, role, keyboard/focus and observed steps | Rendered behavior and journeys actually observed                                          | A screenshot alone does not prove server authorization or hidden failure states |
| Actual provider/client    | Named finite authorized provider/account/host/version/profile, scoped actions, request/outcome evidence and cleanup                   | Only that real scenario/profile at that date                                              | Simulators, generated packages and plausible URLs cannot substitute             |
| Deployed qualification    | Selected reachable environment, source/artifact/config IDs, TLS/origin/callback/worker/realtime/recovery checks                       | That supplied deployment profile                                                          | A local build or loopback service is insufficient                               |
| Publication               | Actual destination, artifact version/digest, publisher identity, receipt/link and rollback/support record                             | That artifact was published there                                                         | Publication alone does not prove functional or security acceptance              |

Typecheck, lint, i18n inventory, registry verification and builds are separate static/
compile gates. A passing translation inventory establishes catalog coverage, not natural
copy or completed Farsi/German workflows. A successful build is not a running service.
An HTTP health endpoint alone is not worker liveness or provider health. A real worker
consuming a synthetic registered job is actual local service evidence for that job only.

## Minimum evidence record

Every completion refers to a durable record with task IDs and the exact acceptance
subcases covered; source commit plus any working-diff hash; dependency/lockfile/runtime
versions; profile/environment boundaries; command with private values removed; exit/result;
expected failure or test-first red where implementation requires it; assertions/scenario
IDs and counts; privacy/mock/simulation limits; cleanup; and remaining unsupported cases.

Keep logs attributable and finite. Do not count a scoped checkpoint again as an additional
independent test when it is rerun. Distinguish unique passing cases from execution count.
Store private account references/config/key locations privately; export only redacted IDs,
reason codes and hashes. No tokens, credentials, message bodies, production/customer data,
private environment files or database dumps enter source or public handoff artifacts.

Task status is the live `tasks.csv`, with its unchanged acceptance and verification fields.
Design tasks can close on their stated review; implementation tasks need their actual
runtime/test acceptance. Broad tasks remain in progress when only a narrower subcase passes.
Failed, skipped and unavailable cases remain explicit. A later stage is not inferred from
a completed earlier task or from another provider's approval.

## Attribution and regression policy

- Evaluate evidence on the exact source tested. A documentation-only descendant may reuse it
  after confirming no application/runtime/schema/lockfile difference. Any relevant source
  change invalidates its affected assertions until rerun; do not transfer peer test counts
  to a newly reconciled checkout without verification.
- Use the required Bun version and frozen dependency profile. Root, docs and site packages
  may declare separate runtimes/lockfiles; root Bun success does not qualify another package.
- Real-DB tests cover ownership, authorization/revision races, atomicity, migration and
  queue state. Provider responses may be explicitly simulated; database behavior may not.
- A test-first red must fail for the intended missing behavior, not only unavailable Docker,
  malformed configuration or a syntax error. Keep subsequent green with the same assertion.
- Prefer regression suites that cover actual affected behavior. Broaden after failures,
  integration/reconciliation or unresolved concerns; avoid repeatedly running unrelated gates
  once they pass with no source change.
- Locale cases state language, calendar, numbering system and timezone independently. Include
  Farsi/German in the same feature gate with English, mixed-direction IDs/URLs, recovery and
  operator steps. Do not infer calendar, digits, currency or timezone from UI language.
- Permission assertions identify actor, current CRM role/visibility, grant, installation/app
  role, connection/resources and request/job/embedded boundary. UI hiding is not a negative
  security test. Delayed effects require changed-authority and in-flight outcome scenarios.
- Migration records name the starting installed schema/ledger. Clean install and upgrade
  from integration-0083 do not qualify the divergent workflow-0083 installation. Restore
  evidence verifies source, data, keys and queue/execution safety only to the scope exercised.

## Quality review against actual BASE/ARCH evidence

| Review case                                                            | Classification and decision                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| BASE source bundle independently restored, no DB dump/keys             | Source restoration passed; operational data/key restore remains OPS work.                                                                         |
| BASE 5,822 unit tests and 116 relevant PostgreSQL tests on a01ca83     | Accept those named suites/head. Do not claim the complete root integration lane, live provider or current later source without affected reruns.   |
| BASE actual separate worker, native-session WS and local S3 round-trip | Native local service evidence; generated fixture sessions do not qualify browser identity/MFA or real provider access.                            |
| Provider contract fake returns successful exchange/refresh             | Unit/local contract evidence only; actual Slack/Gmail transport conformance and real grants remain open.                                          |
| Registry metadata tests resolve FA/DE/EN descriptions                  | Catalog/consumer regression evidence; no new external capability or complete untranslated journey acceptance inferred.                            |
| ARCH scenario review closes a design task                              | Accept design definition/review. Its proposed authority gate, outbox, sandbox, scope migration and lifecycle are not implemented by the document. |
| Peer clean workflow commit has a passing test report                   | Reviewable source and peer evidence. Adopt/reconcile and rerun applicable tests here before inheriting runtime qualification.                     |
| Incoming planning amendment contains 586 rows                          | Scope-planning input only. The active register remains 446 until authoritative reconciliation; no task completion is reset or manufactured.       |
| Real provider gate cannot run because no account is supplied           | Keep that gate unqualified, continue independent authorized local work, never replace it with a fake success.                                     |

This recorded review satisfies QA-001's taxonomy/quality-review criterion. Reusable fixtures,
per-provider simulators, complete negative matrices, browser sessions and release evidence
remain their own QA tasks and cannot be closed by this classification document.
