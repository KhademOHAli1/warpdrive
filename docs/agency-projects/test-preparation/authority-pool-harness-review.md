# Pool candidate harness read-only review

Reviewed new authorityConnectionBoundary.test.ts/.test-support.ts, revised authorityTransactionCandidate.test-support.ts and actual src/test/db.ts. No concrete actionable harness/API/type/cleanup issue was found by the independent explorer. No tests, type checks, lints, runtime, Docker, network or writes ran in that review.

The review checked the actual max4 fixture pool, public Pool.waitingCount declaration/getter, public Drizzle(client) overload, and max1 owned pool for ambient isolation. The outer-wrapper case retains its open repeatable-read snapshot and uncommitted sentinel until its own finally rollback. The acquisition-mutation case races queue observation against early candidate settlement; the unavailable scaffold fails its first assertion quickly, releases all four held clients, awaits the already-settled promise and closes the fixture.

This establishes a source review only. PostgreSQL outcomes, runtime Pool input rejection, ownership of every future caller, private-pool versus canonical-lease choice, signed-key runtime range, cancellation, destructive disposal and shared-fence acceptance remain unproved. The existing finite external process/container guard remains necessary because SQL/promise cleanup is not an immediate cancellation guarantee.
