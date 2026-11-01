# Project-create grant-service source qualification

1 November 2026. **Source-only final GREEN; eight real-Postgres service cases remain NOT RUN.** Base observed at capture: `651295aa648255c2d11e378b8bcd236678375868`. The machine-readable companion is [qualification-project-create-grant-services-source-20261101.json](qualification-project-create-grant-services-source-20261101.json). No source/control/runtime/Git mutation or runner was performed by this documentation capture.

## Exact scope and outcome

Root completed six serial source-tool invocations in an authorized 60-second window. TypeScript covered two primary test files plus two private TypeScript controls through the recorded narrow configuration and their ordinary imports. Biome and unchanged-rule typed ESLint targeted only the two primary files. This is not database execution or broader source qualification.

| Run | Phase and attempt | PID/group | Exit | Raw log |
| --- | --- | --- | --- | --- |
| 1 | `types` 1 | 7532 | 0 | [project-create-pg-source-types-1.log](evidence/project-create-pg-source-types-1.log) |
| 2 | `biome-check` 1 | 7593 | 1 | [project-create-pg-source-biome-check-1.log](evidence/project-create-pg-source-biome-check-1.log) |
| 3 | `biome-write` 1 | 7622 | 0 | [project-create-pg-source-biome-write-1.log](evidence/project-create-pg-source-biome-write-1.log) |
| 4 | `eslint` 1 | 7634 | 0 | [project-create-pg-source-eslint-1.log](evidence/project-create-pg-source-eslint-1.log) |
| 5 | `types` 2 | 7647 | 0 | [project-create-pg-source-types-2.log](evidence/project-create-pg-source-types-2.log) |
| 6 | `biome-check` 2 | 7665 | 0 | [project-create-pg-source-biome-check-2.log](evidence/project-create-pg-source-biome-check-2.log) |

The initial Biome check found one formatting difference in the new test: a three-line `toMatchObject` assertion would be one line. The write invocation fixed that one test file. The final TypeScript and Biome checks passed; the post-format typed ESLint invocation passed with unchanged repository rules. No behavioral source change or test execution is established by that formatting step. Empty TypeScript/ESLint logs are preserved alongside their exit-zero receipts.

## Exact recorded commands

Commands below are captured evidence, not commands run by this documentation task. Working directory for each was `/Users/ali/Developer/warpdrive-agency-projects`.

1. `types` attempt 1, PID 7532:

```text
/Users/ali/Developer/warpdrive-agency-projects/.runtime/bin/bun --smol node_modules/typescript/bin/tsc --noEmit -p .runtime/tsconfig.project-create-pg.json
```

2. `biome-check` attempt 1, PID 7593:

```text
/Users/ali/Developer/warpdrive-agency-projects/.runtime/bin/bun node_modules/@biomejs/biome/bin/biome check src/features/identity/projectCreateGrantServices.test.ts src/features/identity/projectCreateGrantServices.test-support.ts
```

3. `biome-write` attempt 1, PID 7622:

```text
/Users/ali/Developer/warpdrive-agency-projects/.runtime/bin/bun node_modules/@biomejs/biome/bin/biome check --write src/features/identity/projectCreateGrantServices.test.ts src/features/identity/projectCreateGrantServices.test-support.ts
```

4. `eslint` attempt 1, PID 7634:

```text
/Users/ali/Developer/warpdrive-agency-projects/.runtime/bin/bun --smol node_modules/eslint/bin/eslint.js --config .runtime/project-create-pg-eslint.mjs src/features/identity/projectCreateGrantServices.test.ts src/features/identity/projectCreateGrantServices.test-support.ts
```

5. `types` attempt 2, PID 7647:

```text
/Users/ali/Developer/warpdrive-agency-projects/.runtime/bin/bun --smol node_modules/typescript/bin/tsc --noEmit -p .runtime/tsconfig.project-create-pg.json
```

6. `biome-check` attempt 2, PID 7665:

```text
/Users/ali/Developer/warpdrive-agency-projects/.runtime/bin/bun node_modules/@biomejs/biome/bin/biome check src/features/identity/projectCreateGrantServices.test.ts src/features/identity/projectCreateGrantServices.test-support.ts
```

## Final source and private code-control identity

These are SHA-256 hashes of current raw bytes captured after final checks. Pre-format primary hashes are retained separately in the JSON and source-target receipt. No current runtime-input JSON values are captured or hashed here, and no later profile values are described as having been checked before native attempt 1.

| Source or private code control | SHA-256 |
| --- | --- |
| `src/features/identity/projectCreateGrantServices.test.ts` | `1225065a11599a59d1bf8d6f023704234bd625304e4ea48a3f25b0365780f332` |
| `src/features/identity/projectCreateGrantServices.test-support.ts` | `e158ec0b0a9bd7d085bc3fd091383eef38c3a80b791c0bb173cdee6ebe0b14d2` |
| `.runtime/project-create-owned-global-setup.ts` | `4b9215064c426a20b9987b7f46ec3bc4d1532fc972b1db71130539778b06da40` |
| `.runtime/vitest.project-create-pg.config.ts` | `a09277eca48f3d635c17a133e3e3c8eea8ba269cd9be62fac5546a84cb4ac323` |

The two private controls are type-check inputs only. Their source refers to runtime input `.runtime/project-create-pg-run.json`; that runtime input is intentionally not copied or hashed in this source packet. Static source checks do not execute the setup, validate a daemon/cache profile, or establish canonical migration/bootstrap behavior.

## Configurations and guard evidence

| Original source/configuration | Evidence copy | SHA-256 |
| --- | --- | --- |
| `.runtime/tsconfig.project-create-pg.json` | [pg-source-tsconfig.project-create-pg.json.txt](evidence/pg-source-tsconfig.project-create-pg.json.txt) | `da0e6c4e07b5d179e8653b61b8b7aaeb8e041f17112916f9f0a5f6fb3189be57` |
| `.runtime/project-create-pg-eslint.mjs` | [pg-source-project-create-pg-eslint.mjs.txt](evidence/pg-source-project-create-pg-eslint.mjs.txt) | `57edc66bde25e6f300c66ef7da184225bd53c451bbd1441b4614eaee848772e4` |
| `.runtime/run-project-create-pg-source-batch.py` | [pg-source-run-project-create-pg-source-batch.py.txt](evidence/pg-source-run-project-create-pg-source-batch.py.txt) | `3d7df8c6e7d635d14affa14d0885fb5c7f3243cfb8ba9e71b4d826c7e8d2781a` |
| `.runtime/project-create-pg-source-window.json` | [pg-source-project-create-pg-source-window.json.txt](evidence/pg-source-project-create-pg-source-window.json.txt) | `18f58693a5b20d39d24cc2e1f3d4da04ca94d931cfe5594cc125080a81295d47` |
| `.runtime/project-create-pg-source-targets.json` | [pg-source-project-create-pg-source-targets.json.txt](evidence/pg-source-project-create-pg-source-targets.json.txt) | `c862bfde42a26c37c936c95ac7e953cbbc55f2d38deba68420d112c144ee0930` |
| `.runtime/project-create-owned-global-setup.ts` | [pg-source-project-create-owned-global-setup.ts.txt](evidence/pg-source-project-create-owned-global-setup.ts.txt) | `4b9215064c426a20b9987b7f46ec3bc4d1532fc972b1db71130539778b06da40` |
| `.runtime/vitest.project-create-pg.config.ts` | [pg-source-vitest.project-create-pg.config.ts.txt](evidence/pg-source-vitest.project-create-pg.config.ts.txt) | `a09277eca48f3d635c17a133e3e3c8eea8ba269cd9be62fac5546a84cb4ac323` |
| `tsconfig.json` | [pg-source-base-tsconfig.json.txt](evidence/pg-source-base-tsconfig.json.txt) | `3e482742ee772ce6c49ed50d2d5fc83592588b9e43b6a3890c409ae834c77ccb` |
| `eslint.config.mjs` | [pg-source-base-eslint.config.mjs.txt](evidence/pg-source-base-eslint.config.mjs.txt) | `06a95b81d1e159118cbbe4351eb7becf4ab70b32505819de40f77463ca57e26f` |

The typed ESLint adapter imports the unchanged repository base rules and overrides only the parser project selection for the two primary files. The source guard records a live 5 GiB floor (`5,368,709,120` bytes), 60 seconds total including a one-second teardown reserve, 0.1-second sampling, and a 0.5-second TERM grace before KILL if needed. Every run was terminal with null `stopReason`. The recorded overall minimum was `17,337,454,592` free bytes, elapsed `15.287281` seconds, and the window was released. The receipt records all six owned groups empty: `7532, 7593, 7622, 7634, 7647, 7665`. This capture did not rescan or operate those groups. Raw receipt: [project-create-pg-source-batch-handles.json](evidence/project-create-pg-source-batch-handles.json).

## Native attempt 1 was held, not executed

The separately preserved [attempt-1 held receipt](evidence/project-create-pg-source-native-attempt1-held-handles.json) records the default socket `unix:///var/run/docker.sock`, no cached images, and `run:GateFailure:cached-image-required`. It stopped during preflight before native Popen, with `noNativeProcessLaunched: true`. Elapsed was `0.17270883393939584` seconds, minimum free bytes `17,326,227,456`. This is a held environmental admission, not a behavioral test red, migration result, database pass or eight-case execution.

At root's documentation handoff, a fresh attempt 2 was queued against a verified Colima/cache profile, with no native launch yet. This packet contains no attempt-2 execution evidence and makes no current-state or success claim about it. Native runtime inputs may be independently frozen or changed by their owner. Their values are neither modified nor retroactively described as the values type-checked before attempt 1.

## Remaining limits

All eight real-PG cases remain **NOT RUN in this packet**. The preceding registration unit/source results are separate exact-source evidence; no combined unit total or DB qualification is inferred. No full-project checks, Docker/PG run, DDL, combined-lineage validation, native UI, provider delivery, source adoption or release is established.

Trusted-service-actor tests do not prove live native/session freshness, originating app/MCP grants, current project/CRM scope or revocation through commit. Future row-plus-audit success is not create/update atomic rollback proof, and ordinary assignment cases do not qualify revocation races. Actual owned canonical-bootstrap execution and applicable native/Privacy acceptance remain separate gates. Ledgers, progress records, main contracts, source files, private controls and runtime inputs were left untouched.
