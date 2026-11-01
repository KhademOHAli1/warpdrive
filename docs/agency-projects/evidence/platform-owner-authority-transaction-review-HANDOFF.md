# Agency authority transaction candidate review

The reviewed packet matches immutable Agency checkpoint `6855645499b5f5878f7b2d2eb431dd6e6d4b7fbc`. The candidate transaction helper is absent; its eleven PostgreSQL cases are unrun. Parser qualification remains owner-reported and separate from this source review.

The central finding is transaction ownership: rejecting a Drizzle PgTransaction alone cannot exclude a base database wrapper around an already-open PoolClient transaction. That could preserve an old snapshot or commit another caller's transaction. The contract needs an enforceable owned-connection boundary and a real-PG control for this case.

The review also requires stable configuration capture, explicit rollback and uncertain-COMMIT handling, bounded cancellation/disposal, and complete writer participation before accepting a shared authorization fence. The explicit integer-key parser supplies no production namespace allocation.

This is an independent source review only. It accepts no shared API/key, enables no Agency module, applies no DDL and closes no programme task. No tests, runtime, browser or provider operation was started. No chat/API reply was sent to the implementation chat.

See `independent-review.md` for exact fingerprints, findings and proposed verification gates.
