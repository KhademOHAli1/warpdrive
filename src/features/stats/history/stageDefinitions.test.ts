import { describe, expect, test } from "vitest";
import type { HistoryState } from "./contracts";
import {
  MAX_STAGE_DEFINITION_EVENTS,
  type StageDefinitionScope,
  selectStageDefinition,
} from "./stageDefinitions";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const scope: StageDefinitionScope = {
  activationId: uuid(1),
  stageId: uuid(2),
  pipelineId: uuid(3),
  authorizedIncarnationId: uuid(4),
  anchorTransactionId: "500",
  ownTransactionPolicy: "exclude-own-transaction",
};

const definition = (patch: HistoryState = {}): HistoryState => ({
  name: "Proposal",
  order: 2,
  pipelineId: scope.pipelineId,
  rottingDays: null,
  ...patch,
});

function row(
  sequence: number,
  beforeState: HistoryState | null,
  afterState: HistoryState | null,
  patch: Record<string, unknown> = {},
) {
  return {
    eventId: uuid(100 + sequence),
    ordinal: String(sequence),
    activationId: scope.activationId,
    entityKind: "stage",
    entityId: scope.stageId,
    incarnationId: scope.authorizedIncarnationId,
    eventKind: beforeState === null ? "insert" : afterState === null ? "delete" : "update",
    schemaVersion: 1,
    transactionId: String(200 + sequence),
    observationSnapshot: "200:700:500",
    observedAt: "2026-11-05T12:00:00.123456Z",
    beforeState,
    afterState,
    beforeWriteVersion: null,
    afterWriteVersion: null,
    actorId: null,
    commandId: null,
    ...patch,
  };
}

function baseline(stage = definition()) {
  return row(1, null, stage, { eventKind: "baseline" });
}

const includeOwn: StageDefinitionScope = {
  ...scope,
  ownTransactionPolicy: "include-final-own-transaction",
};
const invalidProjections: HistoryState[] = [
  { name: null },
  { pipelineId: "not-a-uuid" },
  { order: 2_147_483_648 },
  { order: 2.1 },
  { rottingDays: "30" },
  { rottingDays: -2_147_483_649 },
  { unknownField: "extra" },
];

describe("stage definitions selected from authoritative anchor membership", () => {
  test("matches stored stage and pipeline IDs without inventing an RFC-version requirement", () => {
    const stageId = "00000000-0000-0000-0000-000000000001";
    const pipelineId = "00000000-0000-0000-0000-000000000002";
    const stage = definition({ pipelineId });
    const source = row(1, null, stage, { entityId: stageId, eventKind: "baseline" });
    expect(selectStageDefinition([source], { ...scope, stageId, pipelineId })).toMatchObject({
      ok: true,
      stageId,
      definition: stage,
    });
  });
  test("preserves the earlier name when PostgreSQL excluded a concurrent late rename", () => {
    const base = baseline();
    const lateRename = row(2, definition(), definition({ name: "Negotiation" }), {
      transactionId: "230",
    });
    // These are two repository membership fixtures. The selector does not evaluate MVCC.
    const visibleAtAnchor = [base];
    const visibleAtLaterAnchor = [base, lateRename];
    expect(selectStageDefinition(visibleAtAnchor, scope)).toMatchObject({
      ok: true,
      definition: definition(),
      source: {
        membership: "snapshot-visible",
        evidence: "activation-baseline",
        firstOrdinal: "1",
        lastOrdinal: "1",
        eventIds: [uuid(101)],
      },
    });
    expect(
      selectStageDefinition(visibleAtLaterAnchor, { ...scope, anchorTransactionId: "510" }),
    ).toMatchObject({
      ok: true,
      definition: definition({ name: "Negotiation" }),
      source: {
        membership: "snapshot-visible",
        firstOrdinal: "2",
        lastOrdinal: "2",
        eventIds: [uuid(102)],
      },
    });
  });

  test("selects the final own-transaction reorder only when included", () => {
    const original = definition();
    const intermediate = definition({ order: -1_000_000 });
    const final = definition({ order: 5, rottingDays: 30 });
    const initialOrdinal = "9007199254740992";
    const firstOrdinal = "9007199254740993";
    const lastOrdinal = "9007199254740994";
    const input = [
      row(3, intermediate, final, { transactionId: "500", ordinal: lastOrdinal }),
      row(1, null, original, { ordinal: initialOrdinal }),
      row(2, original, intermediate, { transactionId: "500", ordinal: BigInt(firstOrdinal) }),
    ];
    const copy = structuredClone(input);
    expect(selectStageDefinition(input, includeOwn)).toEqual({
      ok: true,
      activationId: scope.activationId,
      stageId: scope.stageId,
      incarnationId: scope.authorizedIncarnationId,
      definition: final,
      source: {
        membership: "anchor-transaction-final",
        evidence: "observed-row-change",
        firstOrdinal,
        lastOrdinal,
        eventIds: [uuid(102), uuid(103)],
      },
    });
    expect(selectStageDefinition(input, scope)).toMatchObject({
      ok: true,
      definition: original,
      source: {
        membership: "snapshot-visible",
        lastOrdinal: initialOrdinal,
        eventIds: [uuid(101)],
      },
    });
    expect(input).toEqual(copy);
  });

  test("reports missing when the only creation belongs to the excluded anchor transaction", () => {
    const input = [row(1, null, definition(), { transactionId: "500" })];
    expect(selectStageDefinition(input, scope)).toEqual({
      ok: false,
      reason: "missing-definition",
    });
    expect(selectStageDefinition(input, includeOwn)).toMatchObject({
      ok: true,
      definition: definition(),
      source: { membership: "anchor-transaction-final" },
    });
  });

  test("handles own-transaction deletion without using a retired name", () => {
    const input = [baseline(), row(2, definition(), null, { transactionId: "500" })];
    expect(selectStageDefinition(input, includeOwn)).toEqual({
      ok: false,
      reason: "deleted-definition",
    });
    expect(selectStageDefinition(input, scope)).toMatchObject({
      ok: true,
      definition: definition(),
    });
  });

  test("checks UUID reuse through deletion and a new incarnation in one transaction", () => {
    const reused = uuid(6);
    const inserted = definition({ name: "Renewal", order: 1 });
    const final = definition({ name: "Qualified Renewal", order: 3 });
    const input = [
      baseline(),
      row(2, definition(), null, { transactionId: "500" }),
      row(3, null, inserted, { transactionId: "500", incarnationId: reused }),
      row(4, inserted, final, { transactionId: "500", incarnationId: reused }),
    ];
    expect(selectStageDefinition(input, includeOwn)).toEqual({
      ok: false,
      reason: "incompatible-incarnation",
    });
    expect(
      selectStageDefinition(input, { ...includeOwn, authorizedIncarnationId: reused }),
    ).toMatchObject({
      ok: true,
      incarnationId: reused,
      definition: final,
      source: {
        membership: "anchor-transaction-final",
        firstOrdinal: "3",
        lastOrdinal: "4",
        eventIds: [uuid(103), uuid(104)],
      },
    });
    expect(selectStageDefinition(input, { ...scope, authorizedIncarnationId: reused })).toEqual({
      ok: false,
      reason: "incompatible-incarnation",
    });
  });

  test("checks the selected parent after validating history across a pipeline move", () => {
    const moved = definition({ name: "Other pipeline stage", pipelineId: uuid(7) });
    const input = [baseline(), row(2, definition(), moved)];
    expect(selectStageDefinition(input, scope)).toEqual({
      ok: false,
      reason: "incompatible-pipeline",
    });
    expect(selectStageDefinition(input, { ...scope, pipelineId: uuid(7) })).toMatchObject({
      ok: true,
      definition: moved,
    });
  });

  test("does not substitute a present definition when the anchor has none", () => {
    expect(selectStageDefinition([], scope)).toEqual({ ok: false, reason: "missing-definition" });
    expect(selectStageDefinition([baseline(), row(2, definition(), null)], scope)).toEqual({
      ok: false,
      reason: "deleted-definition",
    });
  });

  test("does not fabricate a distinct definition from a same-transaction round trip", () => {
    const temporary = definition({ name: "Intermediate", order: -1 });
    const input = [
      baseline(),
      row(2, definition(), temporary, { transactionId: "500" }),
      row(3, temporary, definition(), { transactionId: "500" }),
    ];
    expect(selectStageDefinition(input, includeOwn)).toMatchObject({
      ok: true,
      definition: definition(),
      source: {
        membership: "anchor-transaction-final",
        firstOrdinal: "2",
        lastOrdinal: "3",
        eventIds: [uuid(102), uuid(103)],
      },
    });
  });

  test("accepts the signed int4 and nullable projection domains used by SQL", () => {
    const captured = definition({ name: "", order: -2_147_483_648, rottingDays: 2_147_483_647 });
    expect(selectStageDefinition([baseline(captured)], scope)).toMatchObject({
      ok: true,
      definition: captured,
    });
    expect(selectStageDefinition([baseline()], scope)).toMatchObject({
      ok: true,
      definition: { rottingDays: null },
    });
  });

  test.each([{ activationId: uuid(9) }, { entityId: uuid(9) }, { entityKind: "pipeline" }])(
    "rejects unexpected event scope %j",
    (patch) => {
      expect(selectStageDefinition([row(1, null, definition(), patch)], scope)).toEqual({
        ok: false,
        reason: "incompatible-event-scope",
      });
    },
  );

  test.each(invalidProjections)("rejects malformed stage projection %j", (patch) => {
    expect(selectStageDefinition([baseline(definition(patch))], scope)).toEqual({
      ok: false,
      reason: "invalid-stage-projection",
    });
  });

  test("validates an intermediate projection even when the transaction final state is valid", () => {
    const malformed = definition({ order: 2.5 });
    const input = [
      baseline(),
      row(2, definition(), malformed, { transactionId: "500" }),
      row(3, malformed, definition({ order: 5 }), { transactionId: "500" }),
    ];
    expect(selectStageDefinition(input, includeOwn)).toEqual({
      ok: false,
      reason: "invalid-stage-projection",
    });
  });

  test("refuses missing origin and a discontinuous visible state chain", () => {
    const update = row(2, definition(), definition({ name: "Renamed" }));
    const disconnected = row(2, definition({ order: 7 }), definition({ name: "Renamed" }));
    expect(selectStageDefinition([update], scope)).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
    expect(selectStageDefinition([baseline(), disconnected], scope)).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
  });

  test("requires deletion before a replacement incarnation can start", () => {
    const reused = uuid(6);
    const replacement = row(2, null, definition(), { incarnationId: reused });
    expect(
      selectStageDefinition([baseline(), replacement], {
        ...scope,
        authorizedIncarnationId: reused,
      }),
    ).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
  });

  test("refuses to revive a deleted incarnation inside a transaction", () => {
    const input = [
      baseline(),
      row(2, definition(), null, { transactionId: "500" }),
      row(3, null, definition({ name: "Revived" }), { transactionId: "500" }),
    ];
    expect(selectStageDefinition(input, includeOwn)).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
  });

  test("refuses a second activation baseline after a lifetime closes", () => {
    const input = [
      baseline(),
      row(2, definition(), null),
      row(3, null, definition(), { eventKind: "baseline", incarnationId: uuid(6) }),
    ];
    expect(selectStageDefinition(input, scope)).toEqual({ ok: false, reason: "incomplete-chain" });
  });

  test("refuses interleaved transaction spans for a single stage", () => {
    const input = [
      row(1, null, definition(), { transactionId: "201" }),
      row(2, definition(), definition({ name: "Different transaction" })),
      row(3, definition(), definition({ name: "First transaction" }), { transactionId: "201" }),
    ];
    expect(selectStageDefinition(input, scope)).toEqual({ ok: false, reason: "incomplete-chain" });
  });

  test("refuses a transaction split across another stage lifetime", () => {
    const transient = uuid(6);
    const replacement = uuid(7);
    const input = [
      baseline(),
      row(2, definition(), null, { transactionId: "500" }),
      row(3, null, definition(), { transactionId: "600", incarnationId: transient }),
      row(4, definition(), null, { transactionId: "600", incarnationId: transient }),
      row(5, null, definition(), { transactionId: "500", incarnationId: replacement }),
    ];
    expect(
      selectStageDefinition(input, { ...includeOwn, authorizedIncarnationId: replacement }),
    ).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
  });

  test("deduplicates repeated origin delivery and rejects conflicting event evidence", () => {
    const original = baseline();
    expect(selectStageDefinition([original, { ...original }], scope)).toMatchObject({
      ok: true,
      source: { eventIds: [uuid(101)] },
    });
    expect(
      selectStageDefinition([original, baseline(definition({ name: "Conflict" }))], scope),
    ).toEqual({
      ok: false,
      reason: "conflicting-event",
    });
  });

  test("rejects invalid event envelopes and oversized input", () => {
    const base = baseline();
    expect(selectStageDefinition([{ ...base, ordinal: "not-an-ordinal" }], scope)).toEqual({
      ok: false,
      reason: "invalid-event",
    });
    expect(
      selectStageDefinition(
        Array.from({ length: MAX_STAGE_DEFINITION_EVENTS + 1 }, () => base),
        scope,
      ),
    ).toEqual({
      ok: false,
      reason: "bounded-limit",
    });
  });

  test.each(["bad", "0", "0500", "18446744073709551616", "9".repeat(1000)])(
    "rejects invalid anchor xid8 %s without throwing",
    (anchorTransactionId) => {
      expect(selectStageDefinition([baseline()], { ...scope, anchorTransactionId })).toEqual({
        ok: false,
        reason: "invalid-scope",
      });
    },
  );

  test("rejects an invalid expected incarnation UUID", () => {
    expect(
      selectStageDefinition([baseline()], { ...scope, authorizedIncarnationId: "bad" }),
    ).toEqual({
      ok: false,
      reason: "invalid-scope",
    });
  });
});
