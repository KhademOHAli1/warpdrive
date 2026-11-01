# Agency authority transaction candidate: bounded independent review

Reviewed the new packet at `/Users/ali/Documents/Codex/2026-10-31/warpdrive-agency-projects-implementation/outputs/agency-authority-transaction-evidence/` against `work/agency-authority-protocol-review-20261101.md`. No code, refs, environment, DB, runtime, browser, provider or peer source was changed; no tests, imports or native campaign were run. Only this document was written. No external chat/API reply, shared API/key approval or Agency enablement was issued.

## Independently verified evidence boundary

The packet contract and all four source files below match the actual committed bytes at `6855645499b5f5878f7b2d2eb431dd6e6d4b7fbc` in the Agency checkout, verified with read-only committed-object reads and SHA-256 comparisons:

| File relative to packet | SHA-256 |
| --- | --- |
| `docs/agency-projects/authority-transaction-candidate-contract.md` | `9ea50df0530cc332c322cc325590bcd92e0dd89422683cdf3c578b12b1766893` |
| `src/features/agency-projects/authorityTransactionSpec.ts` | `2c4048f55c768440751bceefe7bf9865a522ad9a90975ff1795c8360bf171611` |
| `src/features/agency-projects/authorityTransactionSpec.test.ts` | `5f8db288fc041291a46e6662bd2d2ecff9d3417fc15f4855524cb9c0baf00271` |
| `src/features/agency-projects/authorityTransactionCandidate.test.ts` | `294c737f7213b9f790a7708088eb106a5e2b8c18afc06218ddd5361d9a850807` |
| `src/features/agency-projects/authorityTransactionCandidate.test-support.ts` | `e4e3c257b0146019fef8a4aefaa64c35732cba46597e40f284fdaf7d0105b175` |

`authorityTransactionCandidate.ts` is absent both from that immutable commit and the packet. The transaction suite has ten declarations with one two-mode expansion, giving eleven proposed cases. No transaction helper or runtime guarantee can be reviewed as implemented yet.

The README/qualification manifest **owner-report** 114 parser cases passing after 10 failed/104 passed behavioral RED, selected TS/Biome/typed ESLint checks, seven terminal processes, resource floors and cleanup. This reviewer verified the source/manifest distinctions, not those executions, tool groups or live release. Private control copies were read only where relevant to test bounds; their full operational behavior was not independently qualified. The absence-stage input is prepared metadata, not a grant. Collection/import absence remains distinct from later functional RED.

## Actionable contract findings

### 1. Define ownership for client-backed Db wrappers, not only PgTransaction rejection

Contract line 13 correctly rejects normal PgTransaction/savepoint inputs and says a plain Db type does not prove an outer transaction. That warning must become an enforceable accepted-input boundary before implementation is used as an authority fence. The configured-commit control deliberately creates `drizzle(client,{schema})` on a checked-out PoolClient (`test-support:41–64`). Such a wrapper is a base NodePgDatabase even if its underlying client has already executed BEGIN; an instanceof PgTransaction check cannot distinguish that case.

Installed Drizzle `node-postgres/session.js:180–193` sends BEGIN, runs the callback and then sends COMMIT for a client-backed database, without establishing ownership of an already-open backend transaction. PostgreSQL documents that nested BEGIN only warns and leaves the existing transaction unchanged. Thus accepting an arbitrary client-backed wrapper can preserve a stale outer snapshot and allow the helper's COMMIT to end someone else's transaction. The current ambient-default test changes a session default on an **idle** client; it does not cover an already-open transaction. [PostgreSQL 16 BEGIN](https://www.postgresql.org/docs/16/sql-begin.html)

**Gate:** settle a connection-owner/accepted-handle contract without private driver-field inspection. Add a real-PG case with an actual client-backed wrapper over an established REPEATABLE READ transaction/snapshot, a separately committed authority change and uncommitted sentinel data. Require rejection before business work, no hidden savepoint, and no accidental outer COMMIT/ROLLBACK. Do not claim READ COMMITTED/outermost ownership for arbitrary Db inputs from the existing eleven tests alone. This review selects no replacement API.

### 2. Snapshot the exact accepted key/mode/timeouts before asynchronous work

`authorityTransactionSpec.ts:4–21` has the intended strict syntax: required two signed int32 keys, explicit shared/exclusive mode, explicit integer timeouts in 1..60000 and ordered lock <= statement <= idle. No defaults, coercion, implicit namespace or production key allocation appears. The parser tests also establish detached input copies, but accepted objects remain mutable (`Spec.test:155–178`), and the candidate tests construct plain typed specs without calling the parser.

**Gate:** document where validated native configuration is owned and captured. A caller mutation during connection/lock waits must not make one operation use a changed key, changed mode or a mixture of timeout versions. Snapshot the accepted values before the first await, or establish an equivalent immutable owner boundary, and add a delayed-acquisition mutation test. A TypeScript alias alone is not runtime validation or immutability. All real cases currently use one positive synthetic tuple; include signed key boundary controls before claiming runtime support across the parser's entire accepted range, including correct pg_locks observation. No production key is approved by valid syntax.

### 3. Keep Result rollback, rollback acknowledgement and COMMIT uncertainty separate

Contract line 15's explicit tx.rollback() is necessary: installed Drizzle commits a normally returned callback value even if that value is an error Result. Public PgTransaction.rollback throws TransactionRollbackError; the existing native gateway's outside-transaction catch demonstrates the intended mechanism. The business-error case (`Candidate.test:43–57`) meaningfully requires earlier SQL to disappear and preserves the exact error object rather than converting it to a generic failure.

**Gate:** return that business Result only after the required rollback outcome is established. Preserve an explicit captured-result/sentinel distinction so unrelated TransactionRollbackError, rollback failure or lost connection is not mistaken for the application's intended business error. Installed Drizzle attempts ROLLBACK in catch; a rollback error can replace the original error, and pooled release in finally is ordinary release rather than destructive disposal. The test does not cover these failure paths.

`authority_commit_outcome_unknown` is only a proposed return alternative: none of the eleven cases injects COMMIT acknowledgement loss or checks receipt/idempotency recovery. An OK callback is not proof that COMMIT succeeded, and an AbortError/connection failure after COMMIT may have started is not proof of rollback.

**Gate:** define stage-sensitive failure classification and accepted receipt/recovery behavior before enabling automatic retry. Add real connection-loss/COMMIT uncertainty and rollback-failure controls under an agreed owned-client design. Do not invent a replay store, protected receipt, lifetime, codec or Privacy capability; those owner contracts are explicitly unsupported/unselected here.

### 4. The prepared waits and cleanup are not an immediate-cancellation proof

The eleven cases test pre-abort and abort after awaited SQL before callback return (`Candidate.test:190–218`); neither aborts while a real query/lock wait is in flight. SQL lock/statement/idle settings bound different server states, not an entire command or pool acquisition. The contract openly retains this limit and it should remain visible.

The amended `waitForSettlement` does race a two-second timer (`test-support:121–132`), allowing a failed timeout assertion to reach finally. However, `waitForWaiter` awaits an advisoryLocks query inside its polling loop without its own independent timeout race (`:146–165`); its nominal deadline is checked only after that query returns. `closeHeldFixture` awaits all held runs without its own settlement deadline (`:168–174`), and `releaseOwnedClient` attempts ROLLBACK/RESET then calls ordinary release even if cleanup failed (`:177–182`). Vitest's test timeout does not cancel those SQL/promises.

**Gate:** retain the outer finite process/container watchdog and classify an interrupted/incomplete fixture honestly. Before any whole-command/cancellation/disposal claim, add bounded acquisition, signal during advisory wait, signal during awaited business SQL, callback stall, rollback/reset failure and exactly-once destructive-disposal cases. Verify no locks/tainted client are reused and preserve uncertain COMMIT outcomes. No public AbortSignal support or safe release(true) integration is established merely by mentioning those APIs in the contract.

## What the eleven cases can qualify, and what remains outside them

The proposed cases are meaningful **primitive** coverage once a valid implementation and functional RED exist: explicit RC/local settings with session restoration, actual commit, business Result rollback, shared/shared overlap, exclusive/shared and exclusive/exclusive ordering, both synthetic revocation orders with reads after the awaited lock, SQL lock timeout, pre-abort, pre-commit abort and normal PgTransaction rejection. Their barriers/pg_locks checks are stronger than timing sleeps, and early settlement races prevent a simple rejection scaffold masquerading as a lock holder.

The revocation examples use actual synthetic user rows and direct `users.isActive` reads. They demonstrate a planned DB ordering specimen, **not native-session/MFA admission proof**. They neither invoke every real writer nor establish no-touch authentication, current actor hydration, policy/factor freshness, project permissions/CAS, module admission, protected-content atomicity or shared authority runtime exports.

The earlier protocol review's minimum writer and phantom obligations are therefore still acceptance gates, not superseded by 114 parser cases or eleven prospective primitive cases:

| Gate retained from prior review | Required closure evidence before enablement |
| --- | --- |
| First entry and one connection | Fence before native session touches/lastSeenAt and existing account/MCP/admin/lifecycle locks; fresh final authority reads and all guarded writes on the same pinned transaction connection. A callback can still close over a base pool or cached actor unless actual callers are audited. |
| Complete shared/exclusive participation | Immutable combined-cut manifest for native gateway/operator/logout/recovery/status/admin/permission-set/factor/policy writers; CRM owner/link/merge/delete/import/undo; teams/managers/roster; visibility/restricted-pipeline phantoms; future project/Privacy/app/MCP/module writers. Include raw SQL, underlying libraries, cascades, old versions and maintenance scope. No mode upgrades; settle the existing session/user and admin-row/MCP lock-order hazards. |
| Absent predicates and dependency changes | Stable coverage for first inserted policy/team/membership/restricted pipeline, permission-set fanout and late new dependencies. Account anchors or retrieved-row locks alone do not close these. Refresh the old inventory to the selected combined cut rather than assuming old byte comparisons still establish current coverage. |
| Both authority commit orders and time | Actual participating entry-point races with real otherwise-authorized native fixtures and deterministic barriers. Recheck expiry/freshness after waits; do not advertise physical-commit-time validity from advisory locking alone. |
| Module and Privacy admission | Default-denied command/worker/config/rolling-version behavior and accepted protected-reason/receipt/disposition representations. UI hiding, provider invocation admission and parser syntax do not supply these contracts. |

The candidate currently proves no new writer participation. Its explicit two-integer lock uses a database-local advisory namespace, so owners must also settle the authority database/key scope and supported writers; valid integer input is not namespace ownership. [PostgreSQL 16 advisory lock and pg_locks documentation](https://www.postgresql.org/docs/16/view-pg-locks.html)

**Disposition:** retain this as an explicit-key primitive test preparation packet with the findings above. The absent helper, unrun PostgreSQL cases, outer-transaction ownership, cancellation/disposal/COMMIT recovery and complete participating-writer contract prevent acceptance as a shared authority API or revocation-through-commit guarantee. This review approves neither the proposed key/API nor Agency project enablement, DDL, task closure or an execution window.
