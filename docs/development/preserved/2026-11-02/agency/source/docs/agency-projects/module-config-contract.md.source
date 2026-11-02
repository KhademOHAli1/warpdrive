# Agency Projects startup configuration, bounded source contract

1 November 2026. **Central parsing implemented after 15 failing cases; 15 selected and 37 affected cases pass. Focused static checks pass for both module-env TS files within the exact 14-file numbering/module-env scope.** `AGENCY_PROJECTS_ENABLED` defaults to false and accepts only exact true/false strings. No real env, deployment, app or worker was changed. Actual Agency readers/commands/consumers remain unimplemented and require their own gates.

The Settings owner's selected mechanism is recorded in `evidence/settings-owner-authority-protocol-review.md`, under `Module admission selection`. It selects one central operator boolean with default false and startup drain/restart semantics. The central `AGENCY_PROJECTS_ENABLED` parsing field and operator documentation are now implemented as the bounded source increment. That selection does not establish native module admission or enable Agency persistence.

## Small central parsing increment

The field is defined in the existing `base` schema of `src/config/env.ts`, beside the other opt-in operational booleans, using the actual private `boolFromString.default(false)`. That parser already accepts only exact lowercase string `true` or `false` and transforms them to booleans. No boolean coercion, trimming, new environment reader, module broker, provider/licence dependency or shared helper is proposed. The actual `Env` type is inferred from `base`; `envSchema`, `parseEnv(raw)` and the import-time `env` singleton already exist.

Implemented parse behavior:

| Input | Parsed field |
| --- | --- |
| Omitted | Boolean `false` |
| Exact string `false` | Boolean `false` |
| Exact string `true` | Boolean `true` |
| Empty, padded, uppercase, numeric-looking or other strings | Validation failure naming `AGENCY_PROJECTS_ENABLED` |

The placed test uses actual `parseEnv()` and `testEnvInput()` from `src/test/envInput.ts`. That fixture serializes the already validated Vitest environment without another raw environment read. The omission case explicitly removes the candidate field from its local fixture so an ambient enabled value cannot decide the result. The explicit cases override the fixture. No real `.env` values were read and no raw `process.env` access is added outside the central boundary. Existing legacy tests' direct environment-spread pattern is not copied.

Root observed all15 new assertions fail before the field existed, followed by15 selected and37 affected cases passing after implementation. This is parsing evidence only. Focused static checks now pass for the2 module-env TS files within the14-file supplement. Import-time startup rejection follows the existing `loadOrThrow()` design, but no actual process boot or native restart result is claimed here.

## Disabled availability contract, not yet an implemented server path

The owner-selected initial disabled policy is all actual future Agency reads and commands unavailable, including history, counts, request-status recovery and protected reasons. Preserve stored data, return the common bounded unavailable outcome and discard now-unavailable client projections. A successful empty list is not disabled admission. Any disabled-history exception needs a separate server disclosure policy.

Current Agency policy/schema/template modules are pure data/domain code; this increment invents no server reader, route, command, consumer, job or grant. Feature-local checks using the existing central `env` value should be added when actual Agency server entrypoints exist. This draft names no unavailable error export, generic availability helper or module-registration API. Actual before-read/before-command denial, cache/history treatment and non-probing responses remain future tests at those real boundaries.

Setting the flag true only selects startup availability. It supplies no user identity, authentication, `project.create` capability, project ownership/membership, CRM parent visibility, financial access, accepted owner eligibility or writer fence. Every admitted native operation retains its own accepted current authority and Privacy rules.

## Operator documentation additions, no deployment action

The bounded patch updates the existing operator surfaces:

| File and existing location | Added documentation |
| --- | --- |
| `.env.example`, beside the existing final `SALES_PIPELINE_LIFECYCLE_ENABLED=false` opt-in block | Add a short Agency startup-availability comment and `AGENCY_PROJECTS_ENABLED=false`. This is not a secret and needs no new `_FILE` or `NEXT_PUBLIC_` variant. |
| `docs/deploy.md`, `## 1. Configure .env` table | Add the flag with omitted/false disabled, exact lowercase true/false syntax, and explicit default false. |
| `docs/deploy.md`, `## Operating the box` | Describe the coordinated startup-admission drain/restart procedure and its limits below. |
| `docs-site/docs/setup.md`, `### Business values` | Mirror the operator flag, exact syntax and default in the maintained setup table. |
| `docs-site/docs/operations/updating.md`, `## Upgrading`, after the migration/restart paragraph | Mirror the startup drain/restart and same-cut/config requirement. |

The `.env.example` entry remains false:

```dotenv
# Agency Projects startup availability. Coordinate drain/restart before changing it.
AGENCY_PROJECTS_ENABLED=false
```

The existing Compose configuration already supplies `.env` via `env_file` to app, worker and ws. This draft changes none of those services or their runtime values. Operators must verify every relevant process receives the intended setting; pure parser tests do not establish actual deployment propagation.

## Startup change procedure and its limits

This value is loaded at process startup, not dynamically reread per request. An environment edit does not immediately revoke work already admitted or change running replicas. The reviewed procedure is: stop new admission, drain bounded admitted transactions/effects, stop/drain relevant consumers, then restart every relevant replica with the intended value. A previously admitted transaction may finish. Verify the same immutable application cut and switch value across app/worker/operator processes before reopening admission. Old unfenced authority writers must not coexist with enabled Agency persistence.

No concrete Agency drain endpoint, consumer-control API or executable drain protocol exists through this proposal. Operator documentation must state the required coordination without claiming such an API has been implemented. If immediate cross-process disablement is required, owners must separately accept and qualify a runtime availability generation/fence. A startup boolean cannot substitute for it.

Future durable jobs must check availability at scheduling and actual consumption/effect admission, preserve pending intents while disabled, avoid acknowledging skipped work as success and avoid consuming retry budgets solely because the module is off. Re-enable reconciles once with fresh authority. This field adds no queue or engine; current project-only core mutations have no required background effect, and queue unavailability cannot relabel an already committed write as unsaved.

## Remaining owner and qualification decisions

1. The Settings owner selected the central parsing mechanism and confirmed the narrow increment. Any downstream source adoption still needs exact-cut review; this implementation does not accept future server admission or shared fencing. No new module broker, provider coupling, permission grant or environment access outside the central boundary is added.
2. Agency/native owners must define each actual future read/command/consumer admission point and its bounded unavailable outcome, protected cache/history behavior and current scope/Privacy handling. These reader/command checks remain unimplemented here.
3. Operators and shared authority owners must agree actual drain coordination, bounded completion, consumer behavior, same-cut/config checks and mixed-version handling. The boolean's selection does not implement immediate revocation or the independent through-commit protocol.
4. Real startup/config propagation, module-off read/write denial, historical-data preservation, re-enable behavior, later durable-job recovery and any immediate-disable requirement need their own observed native tests. Pure `parseEnv` results qualify none of those journeys.

The central field and the listed operator documentation are implemented. The actual observed behavioral red was15 failed/0 passed; selected green was15/1file and affected green37/5files. Focused static checks now pass for the2 module-env TS files within the14-file supplement. No database, app, build, install, app/worker launch, provider action, actual startup propagation or native claim is included in this increment. Availability/server admission and operator drain/restart gates remain unimplemented.


## Current execution evidence

Exact source hashes and guarded red/green/affected commands/receipts are indexed in `qualification-module-config-20261101.json`. The three owned unit groups27223/27333/28095 were terminal/empty, with30-second deadlines and live5GiB floor. No actual startup propagation, native off/re-enable, drain, reader or command behavior follows from parser tests. The historical outside-source draft remains preparation, not an additional executed result.

The exact14-file static supplement is `qualification-numbering-module-source-20261101.json`; it supplies no actual startup/config propagation or server admission proof.
