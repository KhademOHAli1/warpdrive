# Project lifecycle policy v1

31 October 2026. Implemented pure policy under product/owner review. No route, store, permission grant, migration or effect is enabled.

| Command | Allowed source | Destination | Reason |
| --- | --- | --- | --- |
| start | planned | active | Optional |
| hold | active | on-hold | Required |
| resume | on-hold | active | Optional |
| complete | active | completed | Optional |
| cancel | planned, active, on-hold | canceled | Required |
| archive | Any unarchived state | archived, retaining prior state | Required |
| restore | archived with known prior state | Exact prior state | Required |
| reopen | completed, canceled | planned | Required |

All other pairs fail. Restoring a completed or canceled project leaves it terminal; only explicit reopen returns it to planned. Reopen does not erase old decisions or authorize new versions. Every successful decision increments the revision once and returns a policy-versioned receipt. A stale expected revision takes precedence over invalid action/reason diagnostics. Exhausted exact-number revisions fail.

`projectSchemas.ts` is the ingress boundary: strict known keys/actions, safe nonnegative integer revisions, bounded control-safe reasons and coherent archive history. It preserves Persian/German text. Pure policy consumes trusted parsed values and performs no I/O. Callers must not pass raw client or database JSON directly to it.

`projectLifecycle.test.ts` exhausts the proposed state/command matrix and checks archive/restore, reasons, receipt/input preservation, stale replay and revision exhaustion. Its replay case proves stale-revision rejection only. Persistent logical request identity, current native actor permission, immutable history, transaction rollback and actual concurrent one-winner behavior remain unimplemented and require real PostgreSQL evidence.

Cancellation/archive produce no communication or task effects. The Calendar bridge and canonical reminder ownership remain separate owner-reviewed gates. Source/unit success does not qualify those features.
