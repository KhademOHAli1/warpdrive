import { describe, expect, test } from "vitest";
import { HISTORY_OBSERVATION_BASIS, type HistoryState } from "./contracts";
import { foldTransactionHistory, type TransactionHistoryChange } from "./fold";
import {
  deriveStageEpisodes,
  MAX_STAGE_EPISODE_CHANGES,
  MAX_STAGE_EPISODE_EVENT_WITNESSES,
} from "./stageEpisodes";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const time = (second: number) => `2026-11-05T12:00:${String(second).padStart(2, "0")}Z`;
const state = (
  stage: number,
  status: "open" | "won" | "lost" = "open",
  patch: HistoryState = {},
): HistoryState => ({
  status,
  value: "100.0000",
  currency: "EUR",
  pipelineId: uuid(10),
  stageId: uuid(stage),
  ownerId: uuid(12),
  wonTime: null,
  lostTime: null,
  expectedCloseDate: null,
  archivedAt: null,
  deletedAt: null,
  visibilityLevel: "owner",
  visibilityGroupId: null,
  visibleToUserIds: [],
  ...patch,
});

function event(
  sequence: number,
  beforeState: HistoryState | null,
  afterState: HistoryState | null,
  patch: Record<string, unknown> = {},
) {
  return {
    eventId: uuid(100 + sequence),
    ordinal: String(sequence),
    activationId: uuid(2),
    entityKind: "deal",
    entityId: uuid(3),
    incarnationId: uuid(4),
    eventKind: beforeState === null ? "insert" : afterState === null ? "delete" : "update",
    schemaVersion: 2,
    transactionId: String(100 + sequence),
    observationSnapshot: "100:1000:",
    observedAt: time(sequence),
    beforeState,
    afterState,
    beforeWriteVersion: beforeState === null ? null : uuid(200 + sequence),
    afterWriteVersion: afterState === null ? null : uuid(300 + sequence),
    actorId: null,
    commandId: null,
    ...patch,
  };
}

function changes(events: readonly unknown[]): TransactionHistoryChange[] {
  const result = foldTransactionHistory(events);
  expect(result.ok).toBe(true);
  return result.ok ? result.changes : [];
}

function inserted(): TransactionHistoryChange[] {
  return changes([event(1, null, state(20))]);
}

describe("bounded observed stage episodes", () => {
  test("keeps current elapsed age separate from completed duration samples", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20)),
        event(2, state(20), state(21)),
        event(4, state(21), state(22)),
      ]),
      time(7),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      entityId: uuid(3),
      incarnationId: uuid(4),
      activationId: uuid(2),
      observationBasis: HISTORY_OBSERVATION_BASIS,
      quality: "observed-from-insert",
      initialObservedStatus: "open",
      finalObservedStatus: "open",
    });
    expect(result.completedStays).toHaveLength(2);
    expect(result.completedStays.map((stay) => stay.durationNanoseconds)).toEqual([
      "1000000000",
      "2000000000",
    ]);
    expect(result.completedStays[0]).toMatchObject({
      stageId: uuid(20),
      enteredAt: time(1),
      endedAt: time(2),
      leftCensored: false,
      rightCensored: false,
      entryReason: "insert",
      exitReason: "stage-change",
      entryWitness: { firstOrdinal: "1", lastOrdinal: "1", eventIds: [uuid(101)] },
      exitWitness: { firstOrdinal: "2", lastOrdinal: "2", eventIds: [uuid(102)] },
    });
    expect(result.currentOpenStage).toMatchObject({
      stageId: uuid(22),
      enteredAt: time(4),
      observationCutoff: time(7),
      rightCensored: true,
      ageNanoseconds: "3000000000",
      observedSpanNanoseconds: "3000000000",
    });
    expect(result.currentOpenStage).not.toHaveProperty("durationNanoseconds");
  });

  test("keeps baseline entry and age unknown despite imported business timestamps", () => {
    const result = deriveStageEpisodes(
      changes([event(1, null, state(20), { eventKind: "baseline" })]),
      time(4),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality).toBe("left-censored-at-activation");
    expect(result.completedStays).toEqual([]);
    expect(result.currentOpenStage).toMatchObject({
      enteredAt: null,
      observedFrom: time(1),
      entryReason: "activation-baseline",
      leftCensored: true,
      rightCensored: true,
      ageNanoseconds: null,
      observedSpanNanoseconds: "3000000000",
    });
  });

  test("retains a baseline completed stay as a lower bound and a later entry as observed", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20), { eventKind: "baseline" }),
        event(3, state(20), state(21)),
      ]),
      time(5),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays[0]).toMatchObject({
      enteredAt: null,
      durationNanoseconds: null,
      observedSpanNanoseconds: "2000000000",
      leftCensored: true,
    });
    expect(result.currentOpenStage).toMatchObject({
      enteredAt: time(3),
      leftCensored: false,
      ageNanoseconds: "2000000000",
      entryReason: "stage-change",
    });
  });

  test("does not create visits for a same-transaction stage round trip", () => {
    const folded = changes([
      event(1, null, state(20)),
      event(2, state(20), state(21), { transactionId: "200" }),
      event(3, state(21), state(20), { transactionId: "200" }),
    ]);
    expect(folded[1]?.netChange).toBe(false);
    const result = deriveStageEpisodes(folded, time(5));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays).toEqual([]);
    expect(result.currentOpenStage).toMatchObject({
      stageId: uuid(20),
      enteredAt: time(1),
      ageNanoseconds: "4000000000",
    });
  });

  test("uses only the final stage and final row observation within a transaction", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20)),
        event(2, state(20), state(21), { transactionId: "200" }),
        event(3, state(21), state(22), { transactionId: "200" }),
      ]),
      time(5),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays).toHaveLength(1);
    expect(result.completedStays[0]).toMatchObject({
      stageId: uuid(20),
      endedAt: time(3),
      durationNanoseconds: "2000000000",
      exitWitness: { firstOrdinal: "2", lastOrdinal: "3", eventIds: [uuid(102), uuid(103)] },
    });
    expect(result.currentOpenStage).toMatchObject({
      stageId: uuid(22),
      enteredAt: time(3),
      ageNanoseconds: "2000000000",
    });
  });

  test("keeps an insert transaction final stage at its final observation boundary", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20), { transactionId: "200" }),
        event(2, state(20), state(21), { transactionId: "200" }),
      ]),
      time(3),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays).toEqual([]);
    expect(result.currentOpenStage).toMatchObject({
      stageId: uuid(21),
      enteredAt: time(2),
      ageNanoseconds: "1000000000",
      entryWitness: { firstOrdinal: "1", lastOrdinal: "2", eventIds: [uuid(101), uuid(102)] },
    });
  });

  test.each(["won", "lost"] as const)(
    "closes the same stage on %s without leaving a current age",
    (status) => {
      const result = deriveStageEpisodes(
        changes([event(1, null, state(20)), event(3, state(20), state(20, status))]),
        time(7),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.finalObservedStatus).toBe(status);
      expect(result.completedStays).toHaveLength(1);
      expect(result.completedStays[0]).toMatchObject({
        stageId: uuid(20),
        exitReason: status,
        endedAt: time(3),
        durationNanoseconds: "2000000000",
      });
      expect(result.currentOpenStage).toBeNull();
    },
  );

  test("creates a fresh episode when the same stage reopens", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20)),
        event(2, state(20), state(20, "won")),
        event(5, state(20, "won"), state(20)),
      ]),
      time(7),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays).toHaveLength(1);
    expect(result.currentOpenStage).toMatchObject({
      stageId: uuid(20),
      enteredAt: time(5),
      entryReason: "reopen",
      ageNanoseconds: "2000000000",
    });
  });

  test("does not treat same-transaction close and reopen as a new episode", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20)),
        event(2, state(20), state(20, "won"), { transactionId: "200" }),
        event(3, state(20, "won"), state(20), { transactionId: "200" }),
      ]),
      time(5),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays).toEqual([]);
    expect(result.currentOpenStage).toMatchObject({
      enteredAt: time(1),
      entryReason: "insert",
      ageNanoseconds: "4000000000",
    });
  });

  test("does not create open stays for closed-state corrections or stage movement", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20, "won")),
        event(2, state(20, "won"), state(21, "lost")),
        event(4, state(21, "lost"), state(21)),
      ]),
      time(6),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.initialObservedStatus).toBe("won");
    expect(result.completedStays).toEqual([]);
    expect(result.currentOpenStage).toMatchObject({
      stageId: uuid(21),
      enteredAt: time(4),
      entryReason: "reopen",
      ageNanoseconds: "2000000000",
    });
  });

  test("a closed baseline supplies no fabricated open episode", () => {
    const result = deriveStageEpisodes(
      changes([event(1, null, state(20, "lost"), { eventKind: "baseline" })]),
      time(5),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality).toBe("left-censored-at-activation");
    expect(result.completedStays).toEqual([]);
    expect(result.currentOpenStage).toBeNull();
  });

  test("closes and opens on pipeline changes using only recorded IDs", () => {
    const moved = state(20, "open", { pipelineId: uuid(50) });
    const result = deriveStageEpisodes(
      changes([event(1, null, state(20)), event(3, state(20), moved)]),
      time(4),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays[0]).toMatchObject({
      pipelineId: uuid(10),
      stageId: uuid(20),
      exitReason: "pipeline-change",
    });
    expect(result.currentOpenStage).toMatchObject({
      pipelineId: uuid(50),
      stageId: uuid(20),
      entryReason: "pipeline-change",
      enteredAt: time(3),
    });
    expect(result.currentOpenStage).not.toHaveProperty("stageOrder");
  });

  test("a simultaneous closed status and stage change closes the old stage without visiting the new one", () => {
    const result = deriveStageEpisodes(
      changes([event(1, null, state(20)), event(3, state(20), state(21, "won"))]),
      time(5),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays).toHaveLength(1);
    expect(result.completedStays[0]).toMatchObject({ stageId: uuid(20), exitReason: "won" });
    expect(result.currentOpenStage).toBeNull();
  });

  test("value, owner and expected-close changes do not reset stage age", () => {
    const edited = state(20, "open", {
      value: "0.0001",
      ownerId: uuid(55),
      expectedCloseDate: "2026-12-01",
    });
    const result = deriveStageEpisodes(
      changes([event(1, null, state(20)), event(3, state(20), edited)]),
      time(6),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays).toEqual([]);
    expect(result.currentOpenStage).toMatchObject({
      enteredAt: time(1),
      ageNanoseconds: "5000000000",
    });
  });

  test("retains microsecond evidence and nanosecond cutoff precision", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20), { observedAt: "2026-11-05T12:00:00.000001Z" }),
        event(2, state(20), state(21), { observedAt: "2026-11-05T12:00:00.000002Z" }),
      ]),
      "2026-11-05T12:00:00.000003001Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays[0]?.durationNanoseconds).toBe("1000");
    expect(result.currentOpenStage?.ageNanoseconds).toBe("1001");
  });

  test("allows tied observation instants and an inclusive cutoff with exact zero durations", () => {
    const result = deriveStageEpisodes(
      changes([event(1, null, state(20)), event(2, state(20), state(21), { observedAt: time(1) })]),
      time(1),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays[0]?.durationNanoseconds).toBe("0");
    expect(result.currentOpenStage?.ageNanoseconds).toBe("0");
  });

  test("compares offset instants rather than wall-clock text", () => {
    const result = deriveStageEpisodes(
      changes([
        event(1, null, state(20), { observedAt: "2026-03-29T01:30:00+01:00" }),
        event(2, state(20), state(21), { observedAt: "2026-03-29T03:30:00+02:00" }),
      ]),
      "2026-03-29T02:30:00Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completedStays[0]?.durationNanoseconds).toBe("3600000000000");
    expect(result.currentOpenStage?.ageNanoseconds).toBe("3600000000000");
  });

  test("orders exact ordinals without mutating input or exposing witness array aliases", () => {
    const input = changes([
      event(1, null, state(20), { ordinal: "9007199254740992" }),
      event(2, state(20), state(21), { ordinal: "9007199254740993" }),
    ]).reverse();
    const original = structuredClone(input);
    const result = deriveStageEpisodes(input, time(5));
    expect(result.ok).toBe(true);
    expect(input).toEqual(original);
    if (!result.ok) return;
    expect(result.completedStays[0]?.entryWitness.firstOrdinal).toBe("9007199254740992");
    result.completedStays[0]?.entryWitness.eventIds.push(uuid(999));
    expect(input).toEqual(original);
  });

  test.each([
    [{ entityId: uuid(99) }, "mixed-entity"],
    [{ incarnationId: uuid(99) }, "mixed-incarnation"],
    [{ activationId: uuid(99) }, "mixed-activation"],
    [{ entityKind: "stage" as const }, "invalid-entity-kind"],
  ] as const)("rejects mixed identity %j", (patch, reason) => {
    const input = changes([event(1, null, state(20)), event(2, state(20), state(21))]);
    const second = input[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    expect(deriveStageEpisodes([input[0] ?? second, { ...second, ...patch }], time(5))).toEqual({
      ok: false,
      reason,
    });
  });

  test("rejects a first update because it supplies no observed origin", () => {
    expect(deriveStageEpisodes(changes([event(1, state(20), state(21))]), time(5))).toEqual({
      ok: false,
      reason: "incomplete-state-chain",
    });
  });

  test("requires the complete recorded state chain, including unrelated fields", () => {
    const input = changes([
      event(1, null, state(20)),
      event(2, state(20, "open", { value: "200.0000" }), state(21)),
    ]);
    expect(deriveStageEpisodes(input, time(5))).toEqual({
      ok: false,
      reason: "incomplete-state-chain",
    });
  });

  test("rejects reversed observation order between transactions", () => {
    const input = changes([
      event(1, null, state(20), { observedAt: time(3) }),
      event(2, state(20), state(21)),
    ]);
    expect(deriveStageEpisodes(input, time(5))).toEqual({
      ok: false,
      reason: "nonmonotonic-observation",
    });
  });

  test("rejects reversed observation bounds inside a folded transaction", () => {
    const input = changes([
      event(1, null, state(20), { transactionId: "200", observedAt: time(3) }),
      event(2, state(20), state(21), { transactionId: "200", observedAt: time(2) }),
    ]);
    expect(deriveStageEpisodes(input, time(5))).toEqual({
      ok: false,
      reason: "nonmonotonic-observation",
    });
  });

  test("rejects a cutoff before any supplied evidence instead of silently truncating it", () => {
    const input = changes([event(1, null, state(20)), event(3, state(20), state(21))]);
    expect(deriveStageEpisodes(input, "2026-11-05T12:00:02.999999999Z")).toEqual({
      ok: false,
      reason: "cutoff-before-evidence",
    });
  });

  test("rejects malformed cutoff and observation times without throwing", () => {
    const input = inserted();
    expect(deriveStageEpisodes(input, "not-an-instant")).toEqual({
      ok: false,
      reason: "invalid-observation-time",
    });
    const first = input[0];
    if (first === undefined) return;
    expect(deriveStageEpisodes([{ ...first, observedFrom: "bad" }], time(5))).toEqual({
      ok: false,
      reason: "invalid-observation-time",
    });
  });

  test("marks a hard-deleted current entity unavailable", () => {
    expect(
      deriveStageEpisodes(changes([event(1, null, state(20)), event(2, state(20), null)]), time(5)),
    ).toEqual({ ok: false, reason: "deleted-entity" });
  });

  test("marks a soft-deleted current entity unavailable", () => {
    expect(
      deriveStageEpisodes(
        changes([
          event(1, null, state(20)),
          event(2, state(20), state(20, "open", { deletedAt: time(2) })),
        ]),
        time(5),
      ),
    ).toEqual({ ok: false, reason: "deleted-entity" });
  });

  test("does not age through a deleted and restored interval", () => {
    const deleted = state(20, "open", { deletedAt: time(2) });
    expect(
      deriveStageEpisodes(
        changes([
          event(1, null, state(20)),
          event(2, state(20), deleted),
          event(3, deleted, state(20)),
        ]),
        time(5),
      ),
    ).toEqual({ ok: false, reason: "deleted-state-in-history" });
  });

  test("marks an archived current entity unavailable", () => {
    expect(
      deriveStageEpisodes(
        changes([
          event(1, null, state(20)),
          event(2, state(20), state(20, "open", { archivedAt: time(2) })),
        ]),
        time(5),
      ),
    ).toEqual({ ok: false, reason: "archived-entity" });
  });

  test("does not count an archived and restored interval as active stage age", () => {
    const archived = state(20, "open", { archivedAt: time(2) });
    expect(
      deriveStageEpisodes(
        changes([
          event(1, null, state(20)),
          event(2, state(20), archived),
          event(3, archived, state(20)),
        ]),
        time(5),
      ),
    ).toEqual({ ok: false, reason: "archived-state-in-history" });
  });

  test("returns explicit missing and bounded-history results", () => {
    expect(deriveStageEpisodes([], time(5))).toEqual({ ok: false, reason: "missing-history" });
    const first = inserted()[0];
    if (first === undefined) return;
    expect(
      deriveStageEpisodes(
        Array.from({ length: MAX_STAGE_EPISODE_CHANGES + 1 }, () => first),
        time(5),
      ),
    ).toEqual({ ok: false, reason: "bounded-limit" });
    expect(
      deriveStageEpisodes(
        [
          {
            ...first,
            eventIds: Array.from({ length: MAX_STAGE_EPISODE_EVENT_WITNESSES + 1 }, () =>
              uuid(101),
            ),
          },
        ],
        time(5),
      ),
    ).toEqual({ ok: false, reason: "bounded-limit" });
  });

  test.each(["not-an-ordinal", "9223372036854775808", "9".repeat(1000)])(
    "rejects invalid ordinal %s without bigint conversion exceptions",
    (firstOrdinal) => {
      const first = inserted()[0];
      if (first === undefined) return;
      expect(deriveStageEpisodes([{ ...first, firstOrdinal }], time(5))).toEqual({
        ok: false,
        reason: "invalid-change",
      });
    },
  );

  test("rejects overlapping ordinal spans and duplicate normalized transactions", () => {
    const input = changes([event(1, null, state(20)), event(2, state(20), state(21))]);
    const first = input[0],
      second = input[1];
    if (first === undefined || second === undefined) return;
    expect(deriveStageEpisodes([{ ...first, lastOrdinal: "2" }, second], time(5))).toEqual({
      ok: false,
      reason: "invalid-change",
    });
    expect(
      deriveStageEpisodes([first, { ...second, transactionId: first.transactionId }], time(5)),
    ).toEqual({ ok: false, reason: "invalid-change" });
  });

  test("rejects malformed normalized stage state and empty contributing evidence", () => {
    const first = inserted()[0];
    if (first === undefined) return;
    expect(
      deriveStageEpisodes([{ ...first, afterState: { ...state(20), status: "unknown" } }], time(5)),
    ).toEqual({ ok: false, reason: "invalid-change" });
    expect(
      deriveStageEpisodes([{ ...first, afterState: { ...state(20), stageId: null } }], time(5)),
    ).toEqual({ ok: false, reason: "invalid-change" });
    expect(deriveStageEpisodes([{ ...first, eventIds: [] }], time(5))).toEqual({
      ok: false,
      reason: "invalid-change",
    });
  });
});
