import { describe, expect, test } from "vitest";
import {
  type InventoryBoundaryFact,
  type InventoryMovementChange,
  type InventoryState,
  MAX_INVENTORY_CHANGES,
  MAX_INVENTORY_EVENT_WITNESSES,
  MAX_INVENTORY_KEYS,
  reconcileInventoryMovement,
} from "./inventoryMovement";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const frame = { activationId: uuid(1), definitionId: "open-eur-pipeline:v1", currency: "EUR" };

function state(value: string | null, patch: Partial<InventoryState> = {}): InventoryState {
  return {
    status: "open",
    lifecycle: "active",
    inScope: true,
    pipelineId: uuid(2),
    ownerId: uuid(3),
    currency: "EUR",
    value,
    ...patch,
  };
}

function fact(
  entity: number,
  observed: InventoryState | null,
  incarnation = 200 + entity,
): InventoryBoundaryFact {
  return { entityId: uuid(entity), incarnationId: uuid(incarnation), state: observed };
}

function change(
  ordinal: number,
  entity: number,
  beforeState: InventoryState | null,
  afterState: InventoryState | null,
  patch: Partial<InventoryMovementChange> = {},
): InventoryMovementChange {
  return {
    entityId: uuid(entity),
    incarnationId: uuid(200 + entity),
    activationId: frame.activationId,
    transactionId: String(1000 + ordinal),
    firstOrdinal: String(ordinal),
    lastOrdinal: String(ordinal),
    eventIds: [uuid(500 + ordinal)],
    evidence: "observed-row-change",
    beforeState,
    afterState,
    ...patch,
  };
}

function input(
  opening: readonly unknown[],
  closing: readonly unknown[],
  changes: readonly unknown[] = [],
) {
  return { opening: { ...frame, facts: opening }, closing: { ...frame, facts: closing }, changes };
}

const totals = (
  count: number,
  knownValueCount: number,
  missingValueCount: number,
  knownValue: string,
) => ({
  count,
  knownValueCount,
  missingValueCount,
  knownValue,
});

describe("one-currency inventory movement", () => {
  test("retains PostgreSQL legacy keys without changing known-zero stock", () => {
    const legacy = "00000000-0000-0000-0000-000000000001";
    const original = {
      ...fact(10, state("0.0000", { pipelineId: legacy, ownerId: legacy })),
      entityId: legacy,
    };
    expect(reconcileInventoryMovement(input([original], [original]))).toMatchObject({
      ok: true,
      opening: totals(1, 1, 0, "0.0000"),
      closing: totals(1, 1, 0, "0.0000"),
    });
  });
  test("reconciles hand-calculated stock, outcomes, restore, removal and value deltas", () => {
    const opening = [
      fact(10, state("100")),
      fact(11, state("50")),
      fact(12, state(null)),
      fact(13, state("20", { status: "won" })),
      fact(14, null),
      fact(15, state("70")),
      fact(16, state("40", { lifecycle: "archived", status: "lost" })),
      fact(17, state("-2.5000")),
      fact(18, state("80")),
    ];
    const closing = [
      fact(10, state("130.0001")),
      fact(11, state("160", { status: "won", ownerId: uuid(9) })),
      fact(12, state(null, { status: "lost" })),
      fact(13, state("22")),
      fact(14, state("0")),
      fact(15, state("70", { lifecycle: "archived", status: "lost" })),
      fact(16, state("45")),
      fact(17, state("-2.5000", { lifecycle: "removed", status: "won" })),
      fact(18, state("70.2500")),
    ];
    const changes = [
      change(1, 10, state("100.0000"), state("130.0001")),
      change(2, 11, state("50"), state("160", { status: "won", ownerId: uuid(9) })),
      change(3, 12, state(null), state(null, { status: "lost" })),
      change(4, 13, state("20", { status: "won" }), state("22")),
      change(5, 14, null, state("0")),
      change(6, 15, state("70"), state("70", { lifecycle: "archived", status: "lost" })),
      change(7, 16, state("40", { lifecycle: "archived", status: "lost" }), state("45")),
      change(8, 17, state("-2.5000"), state("-2.5000", { lifecycle: "removed", status: "won" })),
      change(9, 18, state("80"), state("70.25")),
    ].reverse();
    const result = reconcileInventoryMovement(input(opening, closing, changes));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.opening).toEqual(totals(6, 5, 1, "297.5000"));
    expect(result.closing).toEqual(totals(5, 5, 0, "267.2501"));
    expect(result.netMovement).toEqual(totals(-1, 0, -1, "-30.2499"));
    expect(result.movements.map(({ category, delta }) => [category, delta])).toEqual([
      ["value-increase", totals(0, 0, 0, "30.0001")],
      ["won", totals(-1, -1, 0, "-50.0000")],
      ["lost", totals(-1, 0, -1, "0.0000")],
      ["reopened", totals(1, 1, 0, "22.0000")],
      ["new", totals(1, 1, 0, "0.0000")],
      ["archived", totals(-1, -1, 0, "-70.0000")],
      ["restore", totals(1, 1, 0, "45.0000")],
      ["removed", totals(-1, -1, 0, "2.5000")],
      ["value-decrease", totals(0, 0, 0, "-9.7500")],
    ]);
    expect(result.movements[1]).toMatchObject({
      entityId: uuid(11),
      incarnationId: uuid(211),
      attribution: { ownerId: uuid(3), currency: "EUR" },
      source: { transactionId: "1002", firstOrdinal: "2", lastOrdinal: "2", eventIds: [uuid(502)] },
    });
  });

  test("moves the before value between attributions and records the value delta separately", () => {
    const before = state("100.0001");
    const after = state("110.0002", { pipelineId: uuid(7), ownerId: uuid(8) });
    const result = reconcileInventoryMovement(
      input(
        [fact(10, before)],
        [fact(10, after)],
        [
          change(1, 10, before, after, {
            firstOrdinal: 9_007_199_254_740_992n,
            lastOrdinal: "9007199254740993",
            eventIds: [uuid(501), uuid(502)],
          }),
        ],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netMovement).toEqual(totals(0, 0, 0, "10.0001"));
    expect(result.movements).toMatchObject([
      {
        category: "transfer-out",
        attribution: { pipelineId: uuid(2), ownerId: uuid(3) },
        delta: totals(-1, -1, 0, "-100.0001"),
      },
      {
        category: "transfer-in",
        attribution: { pipelineId: uuid(7), ownerId: uuid(8) },
        delta: totals(1, 1, 0, "100.0001"),
      },
      {
        category: "value-increase",
        attribution: { pipelineId: uuid(7), ownerId: uuid(8) },
        delta: totals(0, 0, 0, "10.0001"),
      },
    ]);
    expect(result.movements[0]?.source).toMatchObject({
      firstOrdinal: "9007199254740992",
      lastOrdinal: "9007199254740993",
      eventIds: [uuid(501), uuid(502)],
    });
  });

  test("separates known zero from missing value across transfer, set and clear", () => {
    const before = state(null);
    const set = state("0.0000", { ownerId: uuid(8) });
    const clear = state(null, { ownerId: uuid(8) });
    const result = reconcileInventoryMovement(
      input(
        [fact(10, before)],
        [fact(10, clear)],
        [change(1, 10, before, set), change(2, 10, set, clear)],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.opening).toEqual(totals(1, 0, 1, "0.0000"));
    expect(result.closing).toEqual(result.opening);
    expect(result.movements.map(({ category, delta }) => [category, delta])).toEqual([
      ["transfer-out", totals(-1, 0, -1, "0.0000")],
      ["transfer-in", totals(1, 0, 1, "0.0000")],
      ["value-set", totals(0, 1, -1, "0.0000")],
      ["value-clear", totals(0, -1, 1, "0.0000")],
    ]);
  });

  test("gates currency and non-currency scope separately without cross-currency arithmetic", () => {
    const opening = [
      fact(10, state("10")),
      fact(11, state("88", { currency: "USD" })),
      fact(12, state(null)),
      fact(13, state("8", { inScope: false })),
    ];
    const closing = [
      fact(10, state("99", { currency: "USD" })),
      fact(11, state("2")),
      fact(12, state("100", { inScope: false })),
      fact(13, state("4")),
    ];
    const result = reconcileInventoryMovement(
      input(opening, closing, [
        change(1, 10, state("10"), state("99", { currency: "USD" })),
        change(2, 11, state("88", { currency: "USD" }), state("2")),
        change(3, 12, state(null), state("100", { inScope: false })),
        change(4, 13, state("8", { inScope: false }), state("4")),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.opening).toEqual(totals(2, 1, 1, "10.0000"));
    expect(result.closing).toEqual(totals(2, 2, 0, "6.0000"));
    expect(result.netMovement).toEqual(totals(0, 1, -1, "-4.0000"));
    expect(
      result.movements.map(({ category, delta, attribution }) => [
        category,
        delta,
        attribution.currency,
      ]),
    ).toEqual([
      ["transfer-out", totals(-1, -1, 0, "-10.0000"), "EUR"],
      ["transfer-in", totals(1, 1, 0, "2.0000"), "EUR"],
      ["transfer-out", totals(-1, 0, -1, "0.0000"), "EUR"],
      ["transfer-in", totals(1, 1, 0, "4.0000"), "EUR"],
    ]);
  });

  test("retains fixed-four precision after aggregate value exceeds a single captured amount", () => {
    const max = state("99999999999999.9999");
    const lower = state("99999999999999.9998");
    const result = reconcileInventoryMovement(
      input(
        [fact(10, max), fact(11, max)],
        [fact(10, max), fact(11, lower)],
        [change(1, 11, max, lower)],
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      opening: totals(2, 2, 0, "199999999999999.9998"),
      closing: totals(2, 2, 0, "199999999999999.9997"),
      netMovement: totals(0, 0, 0, "-0.0001"),
    });
  });

  test("reconciles same-UUID hard deletion and replacement as distinct incarnations", () => {
    const first = state("5");
    const second = state("7");
    const opening = [fact(10, first), fact(10, null, 310)];
    const closing = [fact(10, null), fact(10, second, 310)];
    const remove = change(1, 10, first, null);
    const insert = change(2, 10, null, second, {
      incarnationId: uuid(310),
      transactionId: remove.transactionId,
    });
    const result = reconcileInventoryMovement(input(opening, closing, [insert, remove]));
    expect(result).toMatchObject({
      ok: true,
      netMovement: totals(0, 0, 0, "2.0000"),
      movements: [
        { category: "removed", incarnationId: uuid(210), delta: totals(-1, -1, 0, "-5.0000") },
        { category: "new", incarnationId: uuid(310), delta: totals(1, 1, 0, "7.0000") },
      ],
    });
    expect(
      reconcileInventoryMovement(
        input(opening, closing, [
          { ...remove, firstOrdinal: "2", lastOrdinal: "2" },
          { ...insert, firstOrdinal: "1", lastOrdinal: "1" },
        ]),
      ),
    ).toEqual({ ok: false, reason: "conflicting-incarnation" });
  });

  test("uses whole-transaction membership when different entities have interleaved raw writes", () => {
    const original = state("10");
    const changed = state("12");
    const book = [fact(10, original), fact(11, original), fact(12, null)];
    const result = reconcileInventoryMovement(
      input(
        book,
        [fact(10, changed), fact(11, changed), fact(12, null)],
        [
          change(1, 10, original, changed, {
            transactionId: "1000",
            lastOrdinal: "6",
            eventIds: [uuid(501), uuid(506)],
          }),
          change(2, 11, original, changed, {
            transactionId: "1000",
            lastOrdinal: "4",
            eventIds: [uuid(502), uuid(504)],
          }),
          change(3, 12, null, null, {
            transactionId: "1000",
            lastOrdinal: "5",
            eventIds: [uuid(503), uuid(505)],
          }),
        ],
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      netMovement: totals(0, 0, 0, "4.0000"),
      movements: [
        { category: "value-increase", entityId: uuid(10) },
        { category: "value-increase", entityId: uuid(11) },
      ],
    });
  });

  test("allows an explicit empty book and never counts opening evidence as new", () => {
    expect(reconcileInventoryMovement(input([], []))).toMatchObject({
      ok: true,
      opening: totals(0, 0, 0, "0.0000"),
      closing: totals(0, 0, 0, "0.0000"),
      movements: [],
    });
    const current = [fact(10, state("5"))];
    expect(reconcileInventoryMovement(input(current, current))).toMatchObject({
      ok: true,
      movements: [],
    });
    expect(
      reconcileInventoryMovement(
        input([fact(10, null)], current, [
          change(1, 10, null, state("5"), { evidence: "activation-baseline" }),
        ]),
      ),
    ).toEqual({ ok: false, reason: "baseline-in-movement" });
  });

  test("requires explicit facts for the same key set in both books and every change", () => {
    expect(reconcileInventoryMovement(input([], [fact(10, null)]))).toEqual({
      ok: false,
      reason: "missing-boundary-fact",
    });
    expect(reconcileInventoryMovement(input([], [], [change(1, 10, null, state("5"))]))).toEqual({
      ok: false,
      reason: "missing-boundary-fact",
    });
    const missing = { entityId: uuid(10), incarnationId: uuid(210) };
    expect(reconcileInventoryMovement(input([missing], [fact(10, null)]))).toEqual({
      ok: false,
      reason: "invalid-boundary-fact",
    });
  });

  test("refuses to resume a hard-deleted incarnation", () => {
    const known = state("5");
    const book = [fact(10, known)];
    expect(
      reconcileInventoryMovement(
        input(book, book, [change(1, 10, known, null), change(2, 10, null, known)]),
      ),
    ).toEqual({
      ok: false,
      reason: "retired-incarnation",
    });
  });

  test("validates non-stock state and rejects missing chain links or closing facts that disagree", () => {
    const original = state("1", { inScope: false });
    const edited = state("2", { inScope: false });
    const later = state("3", { inScope: false });
    const opening = [fact(10, original)];
    const closing = [fact(10, later)];
    expect(
      reconcileInventoryMovement(input(opening, closing, [change(1, 10, edited, later)])),
    ).toEqual({
      ok: false,
      reason: "incomplete-chain",
    });
    expect(
      reconcileInventoryMovement(input(opening, closing, [change(1, 10, original, edited)])),
    ).toEqual({
      ok: false,
      reason: "reconciliation-gap",
    });
    expect(
      reconcileInventoryMovement(input(opening, closing, [change(1, 10, original, later)])),
    ).toMatchObject({
      ok: true,
      opening: totals(0, 0, 0, "0.0000"),
      closing: totals(0, 0, 0, "0.0000"),
      movements: [],
    });
  });

  test("rejects duplicate keys and simultaneous physical incarnations even outside stock", () => {
    const original = fact(10, state("1", { inScope: false }));
    expect(reconcileInventoryMovement(input([original, original], [original]))).toEqual({
      ok: false,
      reason: "duplicate-boundary-fact",
    });
    expect(
      reconcileInventoryMovement(
        input([original, fact(10, state("2", { status: "lost" }), 310)], [original]),
      ),
    ).toEqual({
      ok: false,
      reason: "conflicting-incarnation",
    });
  });

  test.each([{ activationId: uuid(9) }, { definitionId: "other:v1" }, { currency: "USD" }])(
    "rejects mixed boundary frame %j",
    (patch) => {
      const request = input([], []);
      expect(
        reconcileInventoryMovement({ ...request, closing: { ...request.closing, ...patch } }),
      ).toEqual({
        ok: false,
        reason: "incompatible-frame",
      });
    },
  );

  test("rejects change activation mismatches and duplicate transaction, ordinal or event evidence", () => {
    const original = state("1");
    const edited = state("2");
    const opening = [fact(10, original), fact(11, original)];
    const closing = [fact(10, edited), fact(11, edited)];
    const a = change(1, 10, original, edited);
    const b = change(2, 11, original, edited);
    expect(
      reconcileInventoryMovement(input(opening, closing, [{ ...a, activationId: uuid(9) }])),
    ).toEqual({
      ok: false,
      reason: "mixed-activation",
    });
    for (const duplicate of [
      a,
      { ...b, firstOrdinal: "1", lastOrdinal: "1" },
      { ...b, eventIds: a.eventIds },
      {
        ...b,
        entityId: a.entityId,
        incarnationId: a.incarnationId,
        transactionId: a.transactionId,
      },
    ]) {
      expect(reconcileInventoryMovement(input(opening, closing, [a, duplicate]))).toEqual({
        ok: false,
        reason: "duplicate-evidence",
      });
    }
  });

  test.each([1.2345, "1.23456", "100000000000000", "1e3", "1\n", "+1", undefined])(
    "rejects malformed exact value %j",
    (value) => {
      const original = fact(10, state("1"));
      const invalid = { ...original, state: { ...state("1"), value } };
      expect(reconcileInventoryMovement(input([invalid], [original]))).toEqual({
        ok: false,
        reason: "invalid-boundary-fact",
      });
    },
  );

  test("rejects malformed ordinal spans and witness membership", () => {
    const original = state("1");
    const a = change(1, 10, original, state("2"));
    const book = [fact(10, original)];
    for (const invalid of [
      { ...a, firstOrdinal: 1 },
      { ...a, firstOrdinal: "3", lastOrdinal: "2" },
      { ...a, lastOrdinal: "3" },
      { ...a, eventIds: [] },
      { ...a, eventIds: ["not-a-uuid"] },
      { ...a, transactionId: "18446744073709551616" },
      { ...a, beforeState: null, afterState: null },
    ]) {
      expect(reconcileInventoryMovement(input(book, book, [invalid]))).toEqual({
        ok: false,
        reason: "invalid-change",
      });
    }
  });

  test("enforces book, change and total witness bounds before processing oversized arrays", () => {
    const original = fact(10, state("1"));
    const update = change(1, 10, state("1"), state("2"));
    expect(
      reconcileInventoryMovement(
        input(
          Array.from({ length: MAX_INVENTORY_KEYS + 1 }, () => original),
          [],
        ),
      ),
    ).toEqual({
      ok: false,
      reason: "bounded-limit",
    });
    expect(
      reconcileInventoryMovement(
        input(
          [],
          [],
          Array.from({ length: MAX_INVENTORY_CHANGES + 1 }, () => update),
        ),
      ),
    ).toEqual({
      ok: false,
      reason: "bounded-limit",
    });
    const eventIds = Array.from({ length: MAX_INVENTORY_EVENT_WITNESSES + 1 }, () => uuid(501));
    expect(
      reconcileInventoryMovement(input([original], [original], [{ ...update, eventIds }])),
    ).toEqual({
      ok: false,
      reason: "bounded-limit",
    });
  });
});
