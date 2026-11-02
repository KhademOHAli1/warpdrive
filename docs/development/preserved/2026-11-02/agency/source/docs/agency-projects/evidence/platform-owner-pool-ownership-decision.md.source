# Authority transaction pool ownership: bounded contract decision

**A new private dedicated-Pool factory is not a universal requirement. The necessary requirement is a clean, exclusively owned transaction lease with safe entry, bounded completion and quarantine of uncertainty.** A private pool hidden behind the helper is the stronger recommended implementation candidate under the trusted-callback protocol; a canonical pool alternative remains admissible only if it establishes the same guarantees and passes real-PG evidence. Neither choice is accepted merely from its constructor or TypeScript type.

This is a source-only clarification of `agency-authority-transaction-candidate-review-20261101.md`, not implementation/API/key approval. Read installed pg 8.23.1, pg-pool 3.14.0 and public @types/pg declarations in the Agency checkout. No code, environment, DB, service or test was executed or changed. Only this document was written; no external chat/API reply was sent.

## What the installed public boundary establishes

- `pool.connect()` supplies a checked-out client; `PoolClient.release(err?: Error | boolean)` is public (`@types/pg/index.d.ts:320`). The pool gives the next borrower exclusive pool use **during that checkout interval**, not proof of prior backend transaction/session state.
- `pg-pool/index.js:369` wraps release to reject double release. Its ordinary release path (`:384–428`) can put a queryable client straight back in the idle list. It does not issue ROLLBACK/RESET or establish that the backend is outside a transaction. “Idle in the pool” therefore is not “clean idle transaction state.”
- The truthy error/destroy release path removes the client; `release(true)` is an available disposal primitive. Its existence does not prove that a proposed helper invokes it exactly once on every uncertain path, bounds disposal, or classifies an in-flight COMMIT correctly.
- `instanceof Pool` checks the runtime class. It does not certify pool history, trusted connect/acquire hooks, immutable configuration, a clean backend or compliance of other borrowers. `idleCount` and successful `SELECT 1` likewise are not transaction-cleanliness proofs.
- `connectionTimeoutMillis` can bound pool waiting/connect paths (`pg-pool/index.js:190–225`); `pool.end()` marks the pool ending and waits through pool lifecycle (`:488`). It is not a substitute for an explicit bounded lease cleanup/cancellation contract.

Inspecting implementation source explains these limits; production code must use supported public APIs, not pg's `_queryable`, `_ending`, session internals or an invented public transaction-status flag.

## Required invariant versus implementation choice

| Necessary guarantee | What an acceptable design must establish |
| --- | --- |
| Safe entry | The helper starts its own outer transaction on a known clean backend, selects READ COMMITTED explicitly and snapshots the validated key/mode/timeouts before asynchronous work. Unsupported Db/PgTransaction/client wrappers are refused before business work. |
| Exclusive lifecycle ownership | One owner retains the same checked-out connection through local settings, fence, post-lock reads, business writes and COMMIT/ROLLBACK acknowledgement or destructive disposal. No early release or second borrower may overlap. |
| Clean return or quarantine | A successfully completed known-clean lease may be reused. Query/cancellation/rollback/reset/connection uncertainty never returns a tainted client as clean. Cleanup is exactly once and bounded; COMMIT uncertainty remains unknown even after destruction. |
| Trusted callback discipline | Operations use the supplied transaction, preserve the fence through final writes and return Result according to contract. They do not issue their own transaction controls, nested savepoints/transactions or escape through another DB handle. |

**Recommended sufficient ownership candidate, subject to tests:** a private pool in a closure, with reviewed configuration and hooks, only helper-controlled checkout/release, no pool/client escape hatch and destroy-on-uncertainty. It can be one owned pool per relevant runtime lifetime; this decision does not require a new pool per command or mandate a particular factory signature. Exclusive provenance reduces the number of borrowers whose cleanup must be trusted. The first connection and every subsequent helper lease still need correct lifecycle handling.

**Canonical-pool alternative:** acceptable in principle if its explicit ownership protocol covers **every** borrower, startup/old pool generations, session initialization, successful release and all failed cleanup paths. It must prevent or detect/quarantine a client returned with an open REPEATABLE READ transaction, failed rollback/reset, in-flight query or other unaccepted session state. Accepting the canonical Pool object and immediately calling BEGIN is insufficient; nested BEGIN can leave an existing transaction intact, as the prior review explains. No reset recipe or public “clean” flag is selected here.

Quarantining an already released contaminated shared-pool lease is a separately defined ownership/failure outcome; it must never silently commit its previous borrower's sentinel work or return business success. It is distinct from accepting an actively owned external client wrapper: that wrapper should be rejected without taking over its transaction. Any chosen quarantine/reset behavior must be explicit and tested, not hidden in an unconditional cleanup query.

## Required callback and authority limits

A dedicated pool is not a JavaScript or SQL sandbox. A callback receiving Drizzle transaction access can issue raw COMMIT/ROLLBACK/BEGIN or nested transaction control, releasing the transaction fence before the helper believes the operation ended. Its closure can also use another pool, a cached actor or external I/O. Hiding the pool does not prevent those escapes. Keep an explicit trusted-source callback contract and review actual participating command implementations; do not claim runtime prevention without a separately designed, tested restriction mechanism.

Neither pool choice provides native-session/MFA admission, all-writer participation, absent-predicate/phantom coverage, module disablement, Privacy admission, remote-effect ordering, production key ownership or receipt/replay recovery. Those gates from the existing reviews remain independent.

## Evidence before either alternative is accepted

Use real PostgreSQL and owned finite barriers, not DB mocks or constructor-only assertions:

1. Reject actual PgTransaction and already-open client-backed REPEATABLE READ wrappers without entering work or accidentally ending the outer transaction.
2. For a canonical/shared design, deliberately return a contaminated connection through the ordinary pool path, then attempt helper checkout. Prove safe refusal/quarantine and that previous sentinel work cannot be committed by the helper. Demonstrate the chosen supported borrower protocol rather than inferring it from instanceof.
3. Show healthy reuse restores the accepted session baseline and READ COMMITTED; caller config mutation cannot change a waiting operation's key/mode/timeouts.
4. Exercise acquisition timeout, abort during lock/business wait, rollback/reset failure and COMMIT acknowledgement loss. Observe exactly-once release/destruction, no leaked locks or reused tainted client, and no false saved/unsaved receipt or automatic replay.
5. Review forbidden raw transaction controls/handle escape in the actual trusted operations and prove the agreed fence/commit order with participating writers. The primitive callback's synthetic user-row tests do not supply this authority proof.

**Local decision:** recommend the private-pool closure as the simpler ownership candidate. Require the listed invariants and evidence for it, or equivalent explicit proof for a canonical-pool alternative. Do not turn that recommendation into a universal factory requirement or an approval of a shared API, production key, migration, module or execution window.
