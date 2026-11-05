import { describe, expect, test } from "vitest";
import {
  type InventoryBoundaryEvidence,
  verifyInventoryBoundaryEvidence,
} from "./inventoryBoundaryEvidence";
import { MAX_INVENTORY_EVENT_WITNESSES, reconcileInventoryMovement } from "./inventoryMovement";

type Frame = InventoryBoundaryEvidence["opening"];
type Event = InventoryBoundaryEvidence["events"][number];
type State = NonNullable<Event["afterState"]>;
type Stored = Frame["records"][number];
type Selection = Frame["selections"][number];

function uuid(value: number) {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

const activationId = uuid(1);
const pipelineId = uuid(2);
const stageId = uuid(3);
const ownerId = uuid(4);
const scope: Frame["scope"] = { pipelineId, owners: { everyone: true } };
const base: State = {
  pipelineId,
  stageId,
  ownerId,
  status: "open",
  currency: "EUR",
  value: "10.0000",
  lifecycle: "active",
  pipelineActive: true,
};

function event(
  ordinal: number,
  key: number,
  beforeState: State | null,
  afterState: State | null,
  patch: Partial<Event> = {},
): Event {
  return {
    entityId: uuid(key + 100),
    incarnationId: uuid(key + 200),
    activationId,
    eventId: uuid(ordinal + 300),
    ordinal: String(ordinal),
    transactionId: String(ordinal + 400),
    kind: beforeState === null ? "baseline" : "update",
    membership: beforeState === null ? "both-cuts" : "closing-only",
    beforeState,
    afterState,
    ...patch,
  };
}

function present(tip: Event): Selection {
  return {
    entityId: tip.entityId,
    incarnationId: tip.incarnationId,
    kind: "present",
    eventId: tip.eventId,
    ordinal: tip.ordinal,
  };
}

function absentBeforeInsert(origin: Event): Selection {
  return {
    entityId: origin.entityId,
    incarnationId: origin.incarnationId,
    kind: "absent-before-insert",
    insertEventId: origin.eventId,
  };
}

function record(tip: Event, state: State): Stored {
  return {
    entityId: tip.entityId,
    incarnationId: tip.incarnationId,
    tipOrdinal: tip.ordinal,
    pipelineId: state.pipelineId,
    stageId: state.stageId,
    ownerId: state.ownerId,
    status: state.status,
    currency: state.currency,
    value: state.value,
  };
}

function frames(
  events: readonly Event[],
  opening: Pick<Frame, "records" | "selections">,
  closing: Pick<Frame, "records" | "selections">,
): InventoryBoundaryEvidence {
  const book = { activationId, definitionId: "inventory-v1", currency: "EUR", scope };
  return {
    proof: {
      completeness: "complete",
      cutOrder: "native-ordered",
      authority: "current-live-authorized",
      membershipDrivers: "qualified",
    },
    opening: {
      ...book,
      ...opening,
      snapshotId: uuid(5),
      observedAt: "2026-11-05T20:30:00.123456Z",
    },
    closing: {
      ...book,
      ...closing,
      snapshotId: uuid(6),
      observedAt: "2026-11-05T20:30:00.123457Z",
    },
    events,
  };
}

function fixture() {
  const start = event(1, 1, null, base);
  const intermediate = { ...base, value: "15.0000" };
  const final = { ...base, value: "13.0001" };
  const changed = event(2, 1, base, intermediate);
  const end = event(3, 1, intermediate, final, { transactionId: changed.transactionId });
  const input = frames(
    [end, start, changed],
    { records: [record(start, base)], selections: [present(start)] },
    { records: [record(end, final)], selections: [present(end)] },
  );
  return { input, start, changed, end, final };
}

describe("bounded inventory boundary evidence", () => {
  test("checks both original books and produces one transaction-final movement with all witnesses", () => {
    const { input, changed, end } = fixture();
    const result = verifyInventoryBoundaryEvidence(input);
    expect(result).toMatchObject({
      state: "ready",
      movement: {
        opening: { facts: [{ state: { value: "10.0000" } }] },
        closing: { facts: [{ state: { value: "13.0001" } }] },
        changes: [
          {
            transactionId: changed.transactionId,
            firstOrdinal: changed.ordinal,
            lastOrdinal: end.ordinal,
            eventIds: [changed.eventId, end.eventId],
          },
        ],
      },
    });
    if (result.state !== "ready") return;
    expect(reconcileInventoryMovement(result.movement)).toMatchObject({
      ok: true,
      opening: { count: 1, knownValue: "10.0000" },
      closing: { count: 1, knownValue: "13.0001" },
      netMovement: { count: 0, knownValue: "3.0001" },
    });
  });

  test("admits a lower interval ordinal even when another entity has a higher opening tip", () => {
    const first = event(1, 1, null, base);
    const second = event(2, 2, null, base);
    const highOpeningTip = event(12, 1, base, base, { membership: "both-cuts" });
    const changed = { ...base, status: "won" as const };
    const lowClosingTip = event(11, 2, base, changed);
    const input = frames(
      [first, second, highOpeningTip, lowClosingTip],
      {
        records: [record(highOpeningTip, base), record(second, base)],
        selections: [present(highOpeningTip), present(second)],
      },
      {
        records: [record(highOpeningTip, base), record(lowClosingTip, changed)],
        selections: [present(highOpeningTip), present(lowClosingTip)],
      },
    );
    const result = verifyInventoryBoundaryEvidence(input);
    expect(result).toMatchObject({
      state: "ready",
      movement: { changes: [{ eventIds: [lowClosingTip.eventId] }] },
    });
    if (result.state !== "ready") return;
    expect(reconcileInventoryMovement(result.movement)).toMatchObject({
      ok: true,
      closing: { count: 1 },
      movements: [{ category: "won" }],
    });
  });

  test("keeps an authorized out-of-scope fact distinct from physical absence", () => {
    const outside = { ...base, pipelineId: uuid(7), stageId: uuid(8) };
    const start = event(1, 1, null, outside);
    const end = event(2, 1, outside, base);
    const input = frames(
      [start, end],
      { records: [], selections: [present(start)] },
      { records: [record(end, base)], selections: [present(end)] },
    );
    const result = verifyInventoryBoundaryEvidence(input);
    expect(result).toMatchObject({
      state: "ready",
      movement: {
        opening: { facts: [{ state: { pipelineId: outside.pipelineId, inScope: false } }] },
      },
    });
    if (result.state === "ready") {
      expect(reconcileInventoryMovement(result.movement)).toMatchObject({
        ok: true,
        movements: [{ category: "transfer-in" }],
      });
    }
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        opening: { ...input.opening, selections: [absentBeforeInsert(start)] },
      }),
    ).toEqual({ state: "unavailable", reason: "boundary-selection-mismatch" });
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        opening: { ...input.opening, selections: [] },
      }),
    ).toEqual({ state: "unavailable", reason: "boundary-selection-mismatch" });
  });

  test("uses null only when a closing-admitted insert proves prior physical absence", () => {
    const origin = event(1, 1, null, base, { kind: "insert", membership: "closing-only" });
    const input = frames(
      [origin],
      { records: [], selections: [absentBeforeInsert(origin)] },
      { records: [record(origin, base)], selections: [present(origin)] },
    );
    const result = verifyInventoryBoundaryEvidence(input);
    expect(result).toMatchObject({
      state: "ready",
      movement: {
        opening: { facts: [{ state: null }] },
        changes: [{ beforeState: null, eventIds: [origin.eventId] }],
      },
    });
    if (result.state === "ready") {
      expect(reconcileInventoryMovement(result.movement)).toMatchObject({
        ok: true,
        movements: [{ category: "new" }],
      });
    }
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        opening: {
          ...input.opening,
          selections: [absentBeforeInsert({ ...origin, eventId: uuid(404) })],
        },
      }),
    ).toEqual({ state: "unavailable", reason: "boundary-selection-mismatch" });
  });

  test("does not drop interval-only entries that transfer out before closing", () => {
    const outside = { ...base, pipelineId: uuid(7), stageId: uuid(8) };
    const origin = event(1, 1, null, base, { kind: "insert", membership: "closing-only" });
    const tip = event(2, 1, base, outside);
    const result = verifyInventoryBoundaryEvidence(
      frames(
        [origin, tip],
        { records: [], selections: [absentBeforeInsert(origin)] },
        { records: [], selections: [present(tip)] },
      ),
    );
    expect(result.state).toBe("ready");
    if (result.state !== "ready") return;
    expect(reconcileInventoryMovement(result.movement)).toMatchObject({
      ok: true,
      opening: { count: 0 },
      closing: { count: 0 },
      movements: [
        { category: "new", source: { eventIds: [origin.eventId] } },
        { category: "transfer-out", source: { eventIds: [tip.eventId] } },
      ],
    });
  });

  test("requires exact writer fact values, stage identity, tip ordinal and closed-row membership", () => {
    const { input, end, final } = fixture();
    const valueOrStage = [{ value: "13.0002" }, { stageId: uuid(404) }, { tipOrdinal: "2" }];
    for (const patch of valueOrStage) {
      expect(
        verifyInventoryBoundaryEvidence({
          ...input,
          closing: { ...input.closing, records: [{ ...record(end, final), ...patch }] },
        }),
      ).toEqual({ state: "unavailable", reason: "boundary-book-mismatch" });
    }
    const closed = { ...base, status: "lost" as const };
    const stable = event(1, 1, null, closed);
    const omitted = frames(
      [stable],
      { records: [], selections: [present(stable)] },
      { records: [], selections: [present(stable)] },
    );
    expect(verifyInventoryBoundaryEvidence(omitted)).toEqual({
      state: "unavailable",
      reason: "boundary-book-mismatch",
    });
  });

  test("rejects unmatched tips, incomplete chains and inconsistent native transaction membership", () => {
    const { input, start, changed, end } = fixture();
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        closing: { ...input.closing, selections: [present(changed)] },
      }),
    ).toEqual({ state: "unavailable", reason: "boundary-selection-mismatch" });
    expect(verifyInventoryBoundaryEvidence({ ...input, events: [start, end] })).toEqual({
      state: "unavailable",
      reason: "invalid-chain",
    });
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        events: [start, changed, { ...end, membership: "both-cuts" }],
      }),
    ).toEqual({ state: "unavailable", reason: "cut-order-unproven" });
    expect(
      verifyInventoryBoundaryEvidence({ ...input, events: [start, changed, end, end] }),
    ).toEqual({ state: "unavailable", reason: "duplicate-evidence" });
  });

  test("rejects hard deletion, reused identities and pipeline-only eligibility drift", () => {
    const start = event(1, 1, null, base);
    const deleted = event(2, 1, base, null, { kind: "delete" });
    const reused = event(3, 1, null, base, {
      incarnationId: uuid(500),
      kind: "insert",
      membership: "closing-only",
    });
    const { input } = fixture();
    expect(verifyInventoryBoundaryEvidence({ ...input, events: [start, deleted] })).toEqual({
      state: "unavailable",
      reason: "retained-history-authority-unavailable",
    });
    expect(verifyInventoryBoundaryEvidence({ ...input, events: [start, reused] })).toEqual({
      state: "unavailable",
      reason: "conflicting-incarnation",
    });
    const archivedPipeline = event(2, 1, base, { ...base, pipelineActive: false });
    expect(
      verifyInventoryBoundaryEvidence({ ...input, events: [start, archivedPipeline] }),
    ).toEqual({ state: "unavailable", reason: "unmodeled-membership-change" });
  });

  test.each([
    [{ completeness: "incomplete" }, "history-incomplete"],
    [{ cutOrder: "unproven" }, "cut-order-unproven"],
    [{ authority: "permission-limited" }, "history-permission-limited"],
    [{ authority: "retained-history-unavailable" }, "retained-history-authority-unavailable"],
    [{ membershipDrivers: "unmodeled" }, "unmodeled-membership-change"],
  ] as const)("withholds incomplete source proof %j", (patch, reason) => {
    const { input } = fixture();
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        proof: { ...input.proof, ...patch },
      }),
    ).toEqual({ state: "unavailable", reason });
  });

  test("rejects incompatible scope, non-increasing cuts and an over-limit corpus", () => {
    const { input } = fixture();
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        closing: { ...input.closing, scope: { ...scope, pipelineId: uuid(999) } },
      }),
    ).toEqual({ state: "unavailable", reason: "snapshot-incompatible" });
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        closing: { ...input.closing, observedAt: input.opening.observedAt },
      }),
    ).toEqual({ state: "unavailable", reason: "cut-order-unproven" });
    expect(
      verifyInventoryBoundaryEvidence({
        ...input,
        events: Array<null>(MAX_INVENTORY_EVENT_WITNESSES + 1).fill(null),
      }),
    ).toEqual({ state: "unavailable", reason: "bounded-limit" });
  });
});
