# CONN-023: local fake-provider qualification

Date: 2026-10-31. **Status: local contract acceptance reviewed and accepted by root.** The original author did not change the tracker. The execution owner subsequently marked CONN-023 complete with its bounded evidence; broader current-source regressions remain resource-gated.

Exact acceptance: “Simulate OAuth, refresh, paging, outages and revocation without storing real provider credentials.” Verification: `contract suite`; stage: `local`; dependencies: reviewed ARCH local foundations and CONN-001. This record supplies source review and executed in-process unit/contract evidence. It is not native HTTP/OAuth, real-PostgreSQL ownership, actual-provider or deployment qualification.

## Reviewed source and reusable entry point

The bounded verification ran from `/tmp/warpdrive-integrations-preview-20261031` with Git anchor `6b71b771d921df8930eebc15259ec0648bff0b73`. The ten new `src/test/fakeProvider*.ts` files were uncommitted additions at that anchor, so that run is attributed to the source manifest below. They were subsequently committed unchanged as `45b722b`. Current frozen source `bc40519` passes standalone types; [the batch record](foundation-qualification-20261031.md) distinguishes its interrupted broad unit campaign from the passing bounded contract suite.

`src/test/fakeProvider.ts:12` exports `createFakeProvider(config)`. It returns a typed `ProviderAdapter` with all seven operation slots and fixture controls: `approve`, `bindCredential`, `advanceTime`, `failNext`, `holdNext` and `calls` (`:51-60`). Consumers call `invokeProvider` with a required `AbortSignal`, rather than treating the fixture control methods as application authorization.

| Source file                                                                          | Responsibility                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `fakeProvider.ts`                                                                    | Reusable adapter composition and explicit fixture controls.                                                        |
| `fakeProviderModels.ts`                                                              | Validated synthetic account/resource/fault inputs, logical clock and fixture TTLs.                                 |
| `fakeProviderState.ts`                                                               | Isolated in-memory attempts/codes/families/cursors; synthetic token candidates and fixture-only reference binding. |
| `fakeProviderOAuth.ts`                                                               | Consent, single-use exchange, expected attempt/redirect binding and rotating refresh generation.                   |
| `fakeProviderResources.ts`                                                           | Account/grant-generation paging, health metadata, revoke state and capability vocabulary.                          |
| `fakeProviderControl.ts`                                                             | One-shot fault queues, deterministic barriers, operation counts and cooperative cancellation cleanup.              |
| `fakeProviderTestFixtures.ts`                                                        | Synthetic FA/DE-labeled accounts with overlapping resource IDs and test setup helpers.                             |
| `fakeProvider.test.ts`, `fakeProviderFailures.test.ts`, `fakeProviderScopes.test.ts` | Eighteen behavior cases through the shared invocation boundary.                                                    |

Source inspection found no network calls, environment reads, database access, queue registration or server startup in these fixture implementation files. URL strings use `.invalid` domains and are never fetched. Access/refresh/code/cursor strings have a `synthetic:` prefix. Credential reference UUIDs and token candidates exist only in the in-memory instance and do not authorize a real upstream account.

## Acceptance and test evidence

| Acceptance area                | Actual behavior exercised                                                                                                                                                                                                                                                                        | Evidence location                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| OAuth simulation               | Explicit authorize then fixture approval; selected upstream account, state echo, code/attempt/redirect correlation, single-use exchange, code expiry and code substitution/replay rejection.                                                                                                     | `src/test/fakeProvider.test.ts:14`, `:51`; `fakeProviderFailures.test.ts:13`.                            |
| Scope preservation             | Explicit empty selection remains empty through exchange/reference binding/check. Requested subsets remain exact; unsupported names reject consent. Omitted selection uses the explicitly configured synthetic account default. A substituted redirect does not consume an empty-scope code.      | `src/test/fakeProviderScopes.test.ts:18`, `:49`, `:66`, `:79`.                                           |
| Refresh                        | Same family ID with a new credential generation; old candidate/reference and forged generation rejected. Access expiry can be followed by refresh while the simulated refresh family remains valid.                                                                                              | `src/test/fakeProvider.test.ts:95`; `fakeProviderFailures.test.ts:13`.                                   |
| Paging/account isolation       | Bounded pages and exhaustion; a cursor from account A cannot be used by account B despite overlapping resource IDs. Refresh invalidates an old generation's cursor. Identical fixture labels/account IDs/attempt IDs across two instances produce noninterchangeable credential/code identities. | `src/test/fakeProvider.test.ts:124`, `:164`.                                                             |
| Outages/rate limits            | One-shot rate-limit response preserves `retryAfterMs`; an injected refresh outage returns conservative unknown outcome through `invokeProvider`; subsequent operations demonstrate deterministic recovery without automatic retry.                                                               | `src/test/fakeProviderFailures.test.ts:51`.                                                              |
| Revocation and ambiguity       | Normal revocation blocks subsequent use; repeated revoke is already-invalid. Both ambiguous-not-applied and ambiguous-applied revocation return unknown, with one attempt and different observed in-memory state.                                                                                | `src/test/fakeProvider.test.ts:14`; `fakeProviderFailures.test.ts:71`.                                   |
| Cancellation                   | Controlled barrier exposes operation start; aborting a waiting exchange preserves the caller's abort and does not consume its code. Pre-aborted invocation performs zero fixture operations and does not consume the next injected fault.                                                        | `src/test/fakeProviderFailures.test.ts:93`, `:111`.                                                      |
| No real credential/network use | Returned tokens are visibly synthetic, endpoints are invalid-domain strings, and exercised operations make zero calls to the spied `fetch`. Source inspection complements that test; it is not a network-sandbox claim.                                                                          | `src/test/fakeProvider.test.ts:17-18`; `fakeProviderFailures.test.ts:125`; fixture source imports/calls. |
| Shared contract compatibility  | Complete happy path invokes authorize, exchange, refresh, listResources, check, disconnect and discoverCapabilities through the actual `invokeProvider` input/output/error/signal boundary.                                                                                                      | `src/test/fakeProvider.test.ts:14`; combined suite below.                                                |

All evidence logs below are private local records under `/tmp/warpdrive-integration-program-private/`. They contain source/test diagnostics and synthetic values, not private provider configuration. Their basenames are restart pointers, not a claim that temporary storage is a durable final archive.

| Run / review                             | Observed result                                                                                                                                                  | Log                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Initial test-first import red            | Missing new module prevented suite collection. This alone is not the behavioral red evidence.                                                                    | `fake-provider-red.log`, first run.                                          |
| Behavioral red before implementation     | Both suites collected; all 12 behavior tests failed against the unsupported adapter scaffold.                                                                    | `fake-provider-red.log`, second run, lines 511-514.                          |
| Initial green and invocation regressions | 5 files, 40 tests passed: 12 harness tests plus 28 existing provider boundary tests.                                                                             | `fake-provider-green.log`.                                                   |
| Independent scope finding                | Reviewer reproduced empty requested scopes being widened to the account's scopes. The finding was treated as a defect, not accepted as a fixture limitation.     | Independent review in the active execution chat; corrective red/green below. |
| Scope regression red                     | 6 cases collected, 2 failed and 4 controls passed. Empty consent and its valid exchange after rejected redirect incorrectly returned the full account scope set. | `fake-provider-scope-red.log`, lines 59-62.                                  |
| Scope regression green                   | 3 harness files, all 18 tests passed after preserving omitted versus explicit-empty semantics.                                                                   | `fake-provider-scope-green.log`.                                             |
| Independent final rerun                  | Separate author/reviewer reported final scope fix accepted and ran 6 files, 46 tests passing.                                                                    | `fake-provider-independent-review.log`; root relayed acceptance of the fix.  |
| Latest bounded draft verification        | 6 files, all 46 tests passed. The log records the Git anchor and SHA-256 manifest of all ten fixture files before executing the suite.                           | `fake-provider-qualification-unit.log`.                                      |
| Formatting                               | Initial nine fixture files and the three scope-change files passed Biome after formatting.                                                                       | `fake-provider-biome.log`, `fake-provider-scope-biome.log`.                  |
| Earlier lint/type check                  | Focused ESLint and full TypeScript passed before the subsequent scope patch. These earlier passes are not advertised as final gates for the patched tree.        | `fake-provider-eslint.log`, `fake-provider-types.log`.                       |

The scope fix changes only scope preservation/validation in fixture models/OAuth logic and adds its regression file. Final current-tree lint/type/build gates remain root-owned and pending the coordinated resource window. No PostgreSQL instance, production build or type-check process was started for this draft while the mail/auth lane owned its finite database window. A Vite configuration-loader warning remains in the unit logs; the tests completed successfully despite it.

Reproduce the small local contract run, using declared Bun 1.4.4:

```sh
cd /tmp/warpdrive-integrations-preview-20261031
/tmp/warpdrive-bun144/bin/bun --bun vitest run --project unit \
  src/test/fakeProvider.test.ts \
  src/test/fakeProviderFailures.test.ts \
  src/test/fakeProviderScopes.test.ts \
  src/features/integrations/providers
```

This command needs no provider account or private runtime configuration. Keep the ordinary test lane's synthetic environment setup; do not load actual provider credentials to run the fixture.

## Tested working-tree manifest

SHA-256 values captured immediately before the latest 46-test run:

| File under `src/test/`         | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `fakeProvider.test.ts`         | `0aa7d30781beb9a0ec821cf5bfe08e01894a6de627a2b8ae9c82ce7af1dafbaf` |
| `fakeProvider.ts`              | `ed739bd6178c15ceabfdb1b3805489137d3e64275c50bb32e86de53c95db071f` |
| `fakeProviderControl.ts`       | `21196afd7221aa3101ffbd631663da046b1a44c9d3bead6fa16cbc638307877f` |
| `fakeProviderFailures.test.ts` | `f5ab1bf6063e89ca73c44f60d5e8deeab38b9cf1cf9ab6089b6e543921d84f00` |
| `fakeProviderModels.ts`        | `3a3c96fa3e777b344a85ad7a48175c5c0fd8041b527ac232b7d138243ee935ad` |
| `fakeProviderOAuth.ts`         | `7c84c866fddf431db497d7b163fc96ed9b24cbc768bca5d9427856db690782d5` |
| `fakeProviderResources.ts`     | `b90c0a55737e399f684227e21f67f8a36daf9d5da26e5db53d7f12932a253d60` |
| `fakeProviderScopes.test.ts`   | `92d5d94bfb29ebd6b2796e7fa25b6aa0eb8fb45b371dffc80395d0a7c526ccff` |
| `fakeProviderState.ts`         | `b584d3d4a2e17fe214f6b15b0b6ef42721cf21ff85418b6deabace13d0682209` |
| `fakeProviderTestFixtures.ts`  | `03f511c40d7e3cf8806a40b8754d20c5f774147eab6f54aed7e599bd7974c108` |

## Explicit limits and acceptance handoff

- This is an in-process model of an upstream provider. It does not listen on HTTP, run a browser or prove a real provider adapter's OAuth, redirect, cookie, PKCE, issuer, webhook, network or native-protocol conformance. State is echoed for a future broker test; the fixture does not establish a production callback-state/session policy.
- `bindCredential` is an explicit fixture-only mapping from an issued synthetic candidate to an opaque reference. It is not the production credential broker, encryption/key rotation, database uniqueness, actor ownership, app-grant evaluator or delayed-effect authority enforcement. Those require real PostgreSQL and their own CONN/AISEC/QA evidence.
- Scope tests validate consent metadata and retained granted scope sets, including the empty-set defect fix. Resource listing does not implement real provider-specific scope-to-method enforcement or CRM permissions. Capability discovery declares the fixture vocabulary/available upstream scope names; it is not a granted-capability or public-support claim. Consumer tests must still exercise their real broker/permission boundary.
- The fixture's 60-second code/access and 24-hour refresh lifetimes are named test defaults, not vendor requirements. `advanceTime` controls this logical provider clock. `invokeProvider` owns its independent real monotonic invocation budget. Blocking trusted synchronous code cannot be preempted by this fixture; the shared invocation boundary rejects overdue results after it yields.
- Instance identity uses a process-local creation sequence. It is deterministic for a fixed construction/operation order, not a promise of identical UUID/token bytes across workers or test scheduling. Do not use fixture tokens as stable golden output. All state ends with that in-memory instance; no persistence, crash-restart, queue, rate-budget scheduler, retention service or load/performance qualification exists here.
- One-shot faults and held operations are explicitly controlled test inputs. They do not reproduce every provider status/body/rotation-family rule. Ambiguous revocation tests distinguish possibly applied state without retry; they do not prove arbitrary message delivery, provider reconciliation or exactly-once effects. No send operation is invented beyond the seven current connector contracts.
- Known unsupported requested scopes are rejected, not silently dropped. Omission intentionally selects the configured synthetic account default for fixture convenience; production grants must follow their reviewed minimal-consent policy rather than copy that fixture default.
- Fixture setup misuse is a programmer/configuration error validated by Zod. Provider operation failures return the shared Result contract; cancellation propagates. Hold controls expose explicit release for deterministic tests and create no external handles or background service.
- No real-provider credentials were read/stored, no domain/vendor was selected, and no live account action was authorized or attempted. Local fixtures cannot close any live-provider, public-hosting or publication task.

Root accepted the exact local task after independent final review and the 46-case combined contract/harness pass, attaching this manifest and the precise limits above. The incomplete broader campaign is not called a pass. QA-003's broader per-adapter simulator contracts, actual adapters, provider grants and application authorization remain separately tracked work.
