import { describe, expect, test } from "vitest";
import { foldTransactionHistory, sameHistoryState } from "./fold";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const state = (stage: number, value = "100.0000") => ({
  title: "Observed opportunity",
  status: "open",
  value,
  currency: "EUR",
  pipelineId: uuid(10),
  stageId: uuid(stage),
  ownerId: uuid(12),
});

function event(patch: Record<string, unknown> = {}) {
  return {
    eventId: uuid(1),
    ordinal: "1",
    activationId: uuid(2),
    entityKind: "deal",
    entityId: uuid(3),
    incarnationId: uuid(4),
    eventKind: "update",
    schemaVersion: 1,
    transactionId: "100",
    observationSnapshot: "100:200:150,175",
    observedAt: "2026-11-05T12:00:00.123456Z",
    beforeState: state(20),
    afterState: state(21),
    beforeWriteVersion: uuid(30),
    afterWriteVersion: uuid(31),
    actorId: null,
    commandId: null,
    ...patch,
  };
}

describe("snapshot-input transaction history folding", () => {
  test("orders exact large ordinals rather than delivery or tied timestamp order", () => {
    const first = event({ ordinal: "9007199254740992" });
    const second = event({
      eventId: uuid(5),
      ordinal: "9007199254740993",
      beforeState: state(21),
      afterState: state(22),
    });
    const result = foldTransactionHistory([second, first]);
    expect(result).toMatchObject({ ok: true, duplicateDeliveries: 0 });
    if (!result.ok) return;
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      firstOrdinal: "9007199254740992",
      lastOrdinal: "9007199254740993",
      beforeState: state(20),
      afterState: state(22),
      eventIds: [uuid(1), uuid(5)],
      evidence: "observed-row-change",
      netChange: true,
    });
  });

  test("does not treat observation-clock order or transaction-number order as commit order", () => {
    const first = event({ ordinal: "9", transactionId: "200", observedAt: "2026-11-05T12:00:01Z" });
    const second = event({
      eventId: uuid(5),
      ordinal: "10",
      transactionId: "100",
      observedAt: "2026-11-05T12:00:00Z",
      beforeState: state(21),
      afterState: state(22),
    });
    const result = foldTransactionHistory([second, first]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.map((change) => change.transactionId)).toEqual(["200", "100"]);
    expect(result.changes.map((change) => change.firstOrdinal)).toEqual(["9", "10"]);
    expect(result.changes[0]?.observedFrom).toBe("2026-11-05T12:00:01Z");
    expect(result.changes[1]?.observedFrom).toBe("2026-11-05T12:00:00Z");
  });

  test("retains first-before and final-after across multiple internal updates", () => {
    const first = event();
    const second = event({
      eventId: uuid(5),
      ordinal: "2",
      beforeState: state(21),
      afterState: state(22, "200.0001"),
      beforeWriteVersion: uuid(99),
    });
    const third = event({
      eventId: uuid(6),
      ordinal: "3",
      beforeState: state(22, "200.0001"),
      afterState: state(23, "300.0002"),
    });
    const result = foldTransactionHistory([third, first, second]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.beforeState).toEqual(state(20));
    expect(result.changes[0]?.afterState).toEqual(state(23, "300.0002"));
    expect(result.changes[0]?.eventIds).toEqual([uuid(1), uuid(5), uuid(6)]);
  });

  test("keeps a same-transaction stage round trip as a zero net change", () => {
    const back = event({
      eventId: uuid(5),
      ordinal: "2",
      beforeState: state(21),
      afterState: state(20),
    });
    const result = foldTransactionHistory([back, event()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes[0]).toMatchObject({
      beforeState: state(20),
      afterState: state(20),
      netChange: false,
    });
    expect(result.changes[0]?.eventIds).toHaveLength(2);
  });

  test("folds intermediate stage-definition reorder positions into the published transaction result", () => {
    const initial = { name: "Proposal", order: 2, pipelineId: uuid(10), rottingDays: 14 };
    const temporary = { ...initial, order: -1000000 };
    const a = event({ entityKind: "stage", beforeState: initial, afterState: temporary });
    const b = event({
      eventId: uuid(5),
      ordinal: "2",
      entityKind: "stage",
      beforeState: temporary,
      afterState: initial,
    });
    const result = foldTransactionHistory([b, a]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      entityKind: "stage",
      beforeState: initial,
      afterState: initial,
      netChange: false,
    });
  });

  test("deduplicates identical delivery without multiplying events or changes", () => {
    const input = event();
    const result = foldTransactionHistory([input, input, { ...input }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicateDeliveries).toBe(2);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.eventIds).toEqual([uuid(1)]);
  });

  test("treats JSON object key order as immaterial for duplicate delivery and chain continuity", () => {
    const input = event();
    const reordered = {
      ...input,
      beforeState: {
        ownerId: uuid(12),
        stageId: uuid(20),
        pipelineId: uuid(10),
        currency: "EUR",
        value: "100.0000",
        status: "open",
        title: "Observed opportunity",
      },
    };
    const result = foldTransactionHistory([input, reordered]);
    expect(result).toMatchObject({ ok: true, duplicateDeliveries: 1 });
    expect(sameHistoryState({ nested: { a: 1, b: 2 } }, { nested: { b: 2, a: 1 } })).toBe(true);
  });

  test("refuses conflicting deliveries of the same event ID", () => {
    expect(foldTransactionHistory([event(), event({ afterState: state(22) })])).toEqual({
      ok: false,
      reason: "conflicting-event",
    });
    expect(foldTransactionHistory([event(), event({ ordinal: "2" })])).toEqual({
      ok: false,
      reason: "conflicting-event",
    });
    expect(foldTransactionHistory([event(), event({ observationSnapshot: "100:200:" })])).toEqual({
      ok: false,
      reason: "conflicting-event",
    });
  });

  test("refuses two distinct events claiming the same global ordinal", () => {
    expect(foldTransactionHistory([event(), event({ eventId: uuid(5) })])).toEqual({
      ok: false,
      reason: "conflicting-ordinal",
    });
  });

  test("fails closed when a transaction's material projected chain is incomplete", () => {
    const broken = event({
      eventId: uuid(5),
      ordinal: "2",
      beforeState: state(99),
      afterState: state(22),
    });
    expect(foldTransactionHistory([event(), broken])).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
  });

  test("fails closed rather than relabeling an unsupported or malformed event", () => {
    expect(foldTransactionHistory([event({ schemaVersion: 2 })])).toEqual({
      ok: false,
      reason: "invalid-event",
    });
    expect(() => foldTransactionHistory([event({ ordinal: "not-an-ordinal" })])).not.toThrow();
    expect(foldTransactionHistory([event({ ordinal: "not-an-ordinal" })])).toEqual({
      ok: false,
      reason: "invalid-event",
    });
    expect(foldTransactionHistory([event({ observationSnapshot: undefined })])).toEqual({
      ok: false,
      reason: "invalid-event",
    });
    expect(foldTransactionHistory([event({ observationSnapshot: "not-a-snapshot" })])).toEqual({
      ok: false,
      reason: "invalid-event",
    });
  });

  test.each([{ entityId: uuid(50) }, { incarnationId: uuid(51) }, { activationId: uuid(52) }])(
    "does not merge a separately identified entity/incarnation/activation: %s",
    (patch) => {
      const next = event({ eventId: uuid(5), ordinal: "2", ...patch });
      const result = foldTransactionHistory([event(), next]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.changes).toHaveLength(2);
      expect(result.changes.map((change) => change.eventIds)).toEqual([[uuid(1)], [uuid(5)]]);
    },
  );

  test("never merges different entity kinds even when their UUIDs match", () => {
    const next = event({
      eventId: uuid(5),
      ordinal: "2",
      entityKind: "pipeline",
      beforeState: { name: "Old", order: 1 },
      afterState: { name: "New", order: 1 },
    });
    const result = foldTransactionHistory([event(), next]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.map((change) => change.entityKind)).toEqual(["deal", "pipeline"]);
  });

  test("does not merge different transaction boundaries into one change", () => {
    const next = event({
      eventId: uuid(5),
      ordinal: "2",
      transactionId: "101",
      beforeState: state(21),
      afterState: state(22),
    });
    const result = foldTransactionHistory([event(), next]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(2);
    expect(result.changes.map((change) => change.transactionId)).toEqual(["100", "101"]);
  });

  test("keeps activation baselines distinct from an observed creation or transition", () => {
    const baseline = event({ eventKind: "baseline", beforeState: null, afterState: state(20) });
    const later = event({ eventId: uuid(5), ordinal: "2", transactionId: "101" });
    const result = foldTransactionHistory([later, baseline]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.map((change) => change.evidence)).toEqual([
      "activation-baseline",
      "observed-row-change",
    ]);
    expect(result.changes[0]?.netChange).toBe(false);
    expect(result.changes[1]?.netChange).toBe(true);
  });

  test("a final update in the activation transaction does not promote its baseline to observed creation", () => {
    const baseline = event({ eventKind: "baseline", beforeState: null, afterState: state(20) });
    const update = event({ eventId: uuid(5), ordinal: "2" });
    const result = foldTransactionHistory([update, baseline]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      evidence: "activation-baseline",
      beforeState: null,
      afterState: state(21),
      netChange: false,
    });
  });

  test("does not let a new baseline splice into an existing transaction chain", () => {
    const baseline = event({
      eventId: uuid(5),
      ordinal: "2",
      eventKind: "baseline",
      beforeState: null,
      afterState: state(21),
    });
    expect(foldTransactionHistory([event(), baseline])).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
  });

  test("retains a delete's last state and a fresh incarnation's insertion separately", () => {
    const deleted = event({ eventKind: "delete", beforeState: state(20), afterState: null });
    const inserted = event({
      eventId: uuid(5),
      ordinal: "2",
      incarnationId: uuid(99),
      eventKind: "insert",
      beforeState: null,
      afterState: state(21),
    });
    const result = foldTransactionHistory([inserted, deleted]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toMatchObject({
      incarnationId: uuid(4),
      beforeState: state(20),
      afterState: null,
    });
    expect(result.changes[1]).toMatchObject({
      incarnationId: uuid(99),
      beforeState: null,
      afterState: state(21),
    });
  });

  test("state equality preserves array order and distinctions below floating-point money precision", () => {
    expect(sameHistoryState({ ids: ["a", "b"] }, { ids: ["b", "a"] })).toBe(false);
    expect(
      sameHistoryState({ value: "99999999999999.1234" }, { value: "99999999999999.1235" }),
    ).toBe(false);
    expect(sameHistoryState(null, {})).toBe(false);
  });

  test("returns an empty observed input without inventing rows or transitions", () => {
    expect(foldTransactionHistory([])).toEqual({ ok: true, changes: [], duplicateDeliveries: 0 });
  });
});
