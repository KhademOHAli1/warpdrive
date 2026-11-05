# Inventory movement evidence reader

## Contract

Read two private, creator-owned `pipeline-inventory` snapshots from the same activation and reconcile the complete transaction-final changes admitted between them. The first implementation uses the current viewer's authorization throughout. Claims about what the actor was entitled to see at a historical instant require a separate entitlement history.

```ts
type InventoryMovementRequest = {
  openingSnapshotId: string;
  closingSnapshotId: string;
};

type InventoryEvidenceFailure =
  | "invalid-request"
  | "snapshot-transaction-unavailable"
  | "snapshot-unavailable"
  | "snapshot-incompatible"
  | "snapshot-order-unproven"
  | "snapshot-boundary-unproven"
  | "history-coverage-unavailable"
  | "history-permission-limited"
  | "retained-history-authority-unavailable"
  | "unmodeled-membership-change"
  | "history-limit"
  | "history-incomplete"
  | "reconciliation-failed"
  | "movement-read-failed";

type InventoryMovementRead =
  | { state: "unavailable"; reason: InventoryEvidenceFailure }
  | {
      state: "available";
      basis: "current-authorized-pinned-inventory";
      opening: { snapshotId: string; observedAt: string };
      closing: { snapshotId: string; observedAt: string };
      timeZone: string;
      calendar: "gregory" | "persian";
      result: Extract<InventoryMovementResult, { ok: true }>;
    };

async function readInventoryMovementBetweenSnapshots(
  db: Db,
  actor: PermSetUser,
  input: InventoryMovementRequest,
  signal: AbortSignal,
): Promise<InventoryMovementRead>;
```

Keep the evidence collector private to the service and pass its `InventoryMovementInput` directly to `reconcileInventoryMovement`. Keep raw states, unrelated events, storage metadata, SQL snapshot strings and failure counts out of the result. The service is internal until a dedicated authorization review approves its use by a router or exporter. Missing and foreign snapshot IDs share `snapshot-unavailable`. When exposed to a caller, permission, source scope and aggregate scan failures also need a generic unavailable response that reveals neither hidden membership nor its size.

## Read protocol

1. **Own the current observation.** Require a fresh pool-owned repeatable-read, read-only transaction with statement and lock timeouts and a live request abort signal. Rehydrate the actor and retain the request's original authority ceiling. Verify capture installation and guards in that same transaction. Select both requested IDs with `created_by = live.id` and `kind = 'pipeline-inventory'`. Refuse borrowed or nested transactions. Parse exact UUIDs, decimal strings, UTC microseconds, snapshot witness shape and bounded JSON. Normalize resolved owner sets. Require the exact admitted writer definition/version, the same activation, currency, selected pipeline, effective owner selection, resolved owner IDs, calendar and zone. Re-resolve owner selection and the named pipeline for the current viewer. A changed resolved selection makes the comparison unavailable. The writer's shared private metadata and parsers should live beside both services so their definitions cannot drift.

2. **Prove ordered native cuts.** Require a strictly increasing recorded cutoff and both cuts at or after this activation. Check that opening native visibility is a subset of closing and closing is a subset of the reader's fresh native snapshot, on the admitted capture lineage. For a pair of PostgreSQL witnesses `A, B`, require `xmax(B) >= xmax(A)` and no in-progress XID in `B` that `pg_visible_in_snapshot(xid, A)` admits. Ordinary table MVCC bounds the reader's source, and the stored native predicates establish historical membership. Bound snapshot strings before expanding `pg_snapshot_xip`. In the SQL evidence query classify each event by these two native membership predicates. The interval is `visible_in_closing AND NOT visible_in_opening`. Row observation time, maximum ordinal and insertion order cannot define interval membership. Ordinals order each captured entity chain and deterministically identify its tip. They do not order transactions across different entities.

3. **Build a complete bounded corpus.** For the initial low-volume implementation, materialize a bounded activation corpus from the currently visible event relation and fail the entire read at the scan limit. Include deal, pipeline and required stage histories. Recover the last admitted event per entity/incarnation at each boundary from the classified corpus and collect every interval deal event. The candidate universe includes stored fact keys, any deal whose independent boundary projection could belong to either book, and interval-only deals that could enter the selected stock. Independently evaluate before/after eligibility from transaction-final sides. A create, transfer or return between both boundaries still matters when the deal is absent from both stored books. A stable eligible deal omitted from both stored books is also detectable by independent endpoint enumeration. Use database-side scan, byte and record bounds with `limit + 1` and stop the entire comparison when any bound is exceeded. A preview or a paginated subset cannot establish completeness. Apply the kernel's existing 5,000 union-key, 10,000 change and 50,000 witness bounds or tighter repository caps. Avoid returning an unbounded raw activation JSON aggregate to the application.

4. **Separate historical identity, selection and authorization.** For every relevant incarnation, require the current active matching deal head and an exact live source/tip projection, authorized through the current deal and pipeline visibility policy. Reapply the current actor's ceiling to the explicit before/after deal projections and the pipeline identity and visibility facts they depend on. Verify actual pipeline and stage identity under both cuts and the corresponding capture incarnation. A replaced UUID cannot authorize a prior incarnation. A historical owner filter may evaluate to false while a row remains authorized. It must never convert denied evidence to `inScope: false`. A relevant hidden pipeline or deal makes the entire comparison unavailable, even when its movements would sum to zero. Hard-deleted or currently archived/deleted records need a qualified retained-history authority. Do not let a historical owner or an allow-list embedded in an event substitute for current entitlement.

5. **Reject membership changes outside deal capture.** A pipeline archive, restore, visibility-group change or lifecycle/recreation can move a book's eligibility without generating deal writes. For the first reader, detect such changes on relevant pipelines, including changes reversed in a later transaction within the interval. Return `unmodeled-membership-change` unless positive evidence proves there was no possible effect on this comparison. Title/order edits have no stock impact by themselves. Likewise require stable scope and access evidence where uncaptured role, group or team changes could affect a claim. A future pipeline fan-out adapter needs its own transaction-final deal population, evidence identity and attribution rule. Do not fabricate a deal event ID for a pipeline change.

6. **Reconstruct and cross-check both books.** A present endpoint fact comes from that incarnation's final admitted event at the boundary. Validate the complete origin/chain/tip evidence, require a captured stage attached to the deal's pipeline at that boundary and check exact projection fields including original `tipOrdinal`. Independently reconstruct the writer's admitted active same-currency set at both cuts, including won and lost deals. Compare its keys and exact fields against each immutable stored fact list. An out-of-scope, closed or other-currency but authorized physical row can still be a positive kernel fact. Emit an explicit null only when first-insert or final-delete evidence at the native cut proves physical absence of that incarnation. A baseline supplies opening presence. A missing saved key or live database row supplies no absence evidence. An unauthorized relevant key or an unproven boundary disables the whole result.

7. **Fold and reconcile.** Read every interval event for admitted deal incarnations and verify exact raw predecessor continuity, per-incarnation terminal tips, origin kind and evidence uniqueness. Group by top-level transaction and incarnation using `foldTransactionHistory`; ensure membership contains complete transaction groups. Preserve first/last ordinals and all raw witness event IDs. Reduce each projected side to `InventoryState` with archive/delete lifecycle, owner/pipeline selection independent of currency, and exact decimal value. Preserve both positive and proven null facts for the same union of keys in both frames. Call the kernel once. A kernel failure returns `reconciliation-failed` internally and exposes no partial totals. Definition IDs identify the admitted writer version and movement semantics. The exact snapshot IDs and pinned observation times identify the comparison.

## Source constraints

- `inventorySnapshotRepository.ts` currently persists a viewer-specific live same-currency book with deal tip ordinals and resolved owner scope. It stores neither the creator's complete historical authority nor historical group, role or team changes. It cannot independently vouch for an out-of-scope or absent fact. Reconstruct and compare both full books under the constant current-authorization contract. If a caller requires historical entitlement or a shared recipient report, return unavailable until entitlement and sharing evidence are qualified.
- The snapshot SQL currently makes rows immutable after insert. Generic table JSON constraints do not attest that a stored row came from the qualified application writer or that its snapshot string was produced by an observed cut. Installed use requires a qualified writer-only insert capability and documented native capture lineage through migration and restore. If row provenance or lineage is unproved, fail closed rather than treat a well-formed snapshot string as an authenticated observation.
- The capture source records pipeline archive and restriction state, deal visibility fields, and stage membership. It does not capture live actor authority history or provide a retained-record authorization policy. Deletion/archive transitions whose needed identity or authority is unresolved cannot be emitted even though the movement kernel supports the category.
- The existing capture indexes support activation and per-incarnation lookup but do not give a qualified scalable range plan for the native snapshot difference. The bounded full-corpus implementation can prove low-volume cases. Production-scale coverage needs a typed top-level XID/index plan or a separately qualified, complete candidate materialization. A cutoff timestamp index cannot substitute for snapshot membership. A stored native snapshot string cannot reopen vacuumed ordinary table versions.

## Native fixture plan

| Fixture | Required result |
| --- | --- |
| Unchanged books, open-to-won, exact value change and active authorized transfer | Both stored books match independently reconstructed facts. Exact signed movements reconcile with the original event IDs. |
| Transaction allocates a low ordinal before opening and commits after opening while a higher ordinal is already visible | Lower ordinal enters the interval only when closing admits its top-level XID. |
| Net-zero active interval round trip or transient same-transaction state | Whole transaction folds once. Distinct committed interval changes remain represented even when endpoint totals match. |
| Stable eligible fact omitted from both stored books | Comparison is unavailable after independent boundary enumeration. |
| Snapshot member disappears through hard delete or becomes inaccessible through archive or restriction | Permission or retained-authority failure. No omitted member, partial total or inferred null. |
| Reused deal, stage or pipeline UUID and now-public replacement | Original incarnation stays unavailable. |
| Pipeline archive/restriction or a round trip without a deal write | Membership-change failure unless the collector proves it cannot affect this comparison. |
| Foreign and missing IDs, stale actor, changed team scope, currency mismatch or reversed native cut | Fail without revealing another creator's snapshot or event count. |
| Scan, fact, payload or witness cap and capture integrity failure | Whole report unavailable. No partial comparison. |
