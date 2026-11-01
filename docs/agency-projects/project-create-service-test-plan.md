# Project-create grant services, proposed real-Postgres tests

1 November 2026. **Test-only source placement, all eight cases NOT RUN.** Owned source files are `src/features/identity/projectCreateGrantServices.test.ts` and `src/features/identity/projectCreateGrantServices.test-support.ts`, plus this plan. The original work draft is historical preparation. Only these new tests/fixtures were placed; no production/helper/registration source, current qualification, runner, database/container, provider, Git mutation or commit action is included.

The registration's existing unit results are separate evidence. These source tests propose actual service-level database checks for `project.create`; they supply no new red, green, static, PostgreSQL, session, native or through-commit result. They are not authority acceptance or project persistence enablement.

## Actual APIs and bounded setup

The placed suite uses only actual `createPermissionSet()` and `updatePermissionSetFlags()` from `src/features/identity/permission-sets.service.ts`, `assignPermissionSet()` from `src/features/identity/users.service.ts`, the existing `createPermissionSetInput`, `updateFlagsInput` and `assignSetInput`, `permissionFlagsSchema`, `completePermissionFlags()`, and `makeTestDb()` from `src/test/db.ts`. There are no database mocks or replacement tables. Fixture constants, seeding and scoped queries are separated into the new test-support file to keep both source files bounded after ordinary formatting.

The existing `makeTestDb()` requires the integration lane's injected `testPg`; it clones the real migrated template and returns the database/pool plus `close()`. The placed suite follows the existing identity setup: one isolated clone, bounded resets of that clone between cases, fixed synthetic UUIDs and `.invalid` identities, then `close()` after the suite. The suite directly imports and calls the actual `makeTestDb()`, retaining the existing integration-classification marker. No test or classification runner has executed. Source placement itself opens no connection or container. Any actual run needs root's separately allocated real-Postgres/resource lane and accepted migration/template state; this suite must not be placed in the container-free unit selection.

Fixtures seed three complete permission maps and three distinct users. The manager has `permissions.manage` and an own set different from the candidate set. The regular target initially points to a baseline set, so denial must preserve a meaningful existing assignment rather than merely leave null unchanged. Admin fixtures have native `isAdmin: true` in their seeded user rows and an empty trusted actor flag set. Carried candidate maps enable only the new `project.create` high-risk flag, with no unrelated high-risk permission that could mask the cause of denial.

All write maps are built using the actual editor completion helper, checked through the actual exhaustive `permissionFlagsSchema`, then parsed through the actual input schema before the service call. A small synthetic fixture helper is not a new production API or native actor loader.

## Eight meaningful cases

| Case | Required database assertions |
| --- | --- |
| Delegated create with true | Exact `granting project.create requires admin` result; full permission-set rows unchanged; no create audit row. |
| Delegated create with explicit false | Ordinary `deal.create` true succeeds; returned set persists the complete intended map; exactly one create audit records manager, target and submitted map. |
| Native-admin create with true | New set persists true and its create audit binds the native-admin fixture. |
| Delegated update retaining true | Candidate already carries true; submission retains it while changing ordinary `deal.create`. Deny exactly, preserve the entire before row including timestamps, and write no update audit. This catches a false-to-true-only grant check. |
| Delegated removal to false | On another set, submission removes the high-risk true value while setting an ordinary flag. Persist the complete new map and record exact old/new audit maps. This does not bypass the separate self-set edit restriction. |
| Delegated assignment carrying true | Deny exactly; target's existing baseline assignment remains; no assignment audit. |
| Delegated assignment with false | Ordinary grant plus explicit project-create false succeeds; target changes to the candidate and the assignment audit binds actor/target/set. |
| Native-admin update and assignment controls | Retaining true during update and assigning its carried set succeed, with the intended maps/assignment and corresponding audits. |

The denied cases use re-reads instead of inferring rollback from the Result alone. Setup inserts are direct synthetic fixture data, so setup audits do not obscure operation audit counts. These cases target the new grant only; they do not establish the existing self-edit, target-administrator, last-admin or broader identity workflows.

## Sparse fixture caveat, no schema relaxation

Existing `src/features/identity/services.test.ts` and `src/features/identity/assignSetEscalation.test.ts` pass sparse values such as `{}`, `{ "deal.create": true }` and `{ "permissions.manage": true }` directly to services. The database JSONB column and service parameter types permit those stored/service shapes, and the service grant checks inspect their true entries. Those fixtures therefore bypass the exhaustive write-schema boundary; they are not evidence that equivalent browser write maps validate.

`permissionFlagsSchema` is Zod 4's exhaustive enum-keyed record. Its trailing TypeScript `Partial` assertion does not make sparse writes valid. Omitted stored keys, the editor's false completion, raw sparse schema writes and an entirely omitted create `flags` property's existing `.default({})` path remain separate boundaries. The placed tests do not copy sparse fixtures, add `partialRecord`, relax the schema, change the grantor to inspect only changed flags, or fix peer services/tests. Any modernization of legacy fixtures needs separate owner scope.

## Important authority and side-effect limits

These are trusted-service-actor tests. They manually pass a consistent `PermSetUser` fixture and seed corresponding users; they do not enter `createContext()`, validate a live session, call freshness/CSRF admission or prove `hydrateActor()` observed current native state. They cannot establish that a permission-set name creates admin authority, nor prove current actor/permission status is serialized through commit. Native freshness, originating app/MCP grants, participating writer fences and revocation races remain independent tests/contracts.

The current permission-set create/update services call `recordAudit()` after their row write without a single enclosing transaction in these functions. Successful state plus audit assertions must not be described as atomic rollback proof. Failure injection, transaction policy and through-commit races are outside this suite and must not trigger unreviewed service edits. `assignPermissionSet()` uses its existing transaction; these ordinary cases still do not exercise concurrent revocation or rollback injection.

`recordAudit()` also writes auth security metadata and successful user assignment enqueues a local security-notice outbox row through existing code. The placed suite never imports or calls a dispatcher, starts a provider worker or sends messages. These intended local test writes are not delivery tests. A future real-Postgres lane must retain isolated synthetic data and existing test configuration; no external recipient or provider action is authorized by this plan.

Project owner/member policy, selected accepted owner admission, canonical CRM ceilings, module/Privacy/schema enablement and project writers remain separate. A successful permission-set mutation or assignment only exercises this existing global capability administration path. It does not authorize or qualify project create/read/edit persistence.

## Next step

Test-only source placement is complete. Root will prepare a finite owned canonical-bootstrap run and request the native slot before any execution. All eight cases remain **NOT RUN**; this placement grants no runner, static, Docker, PostgreSQL or provider action. Existing selected unit/source qualification must not be extended to these database claims by addition or implication.
