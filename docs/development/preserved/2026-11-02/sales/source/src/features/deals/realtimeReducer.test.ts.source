import { describe, expect, it } from "vitest";
import type { BoardData } from "./boardCache";
import type { BoardCard } from "./dealRepo";
import { reduceRealtime } from "./realtimeReducer";

function card(id: string, stageId: string): BoardCard {
  return {
    id,
    title: id,
    value: null,
    stageId,
    boardPosition: "1",
    ownerId: "u",
    personId: null,
    orgId: null,
    nextActivityAt: null,
    lastActivityAt: null,
    stageEnteredAt: new Date(),
    updatedAt: new Date(),
    writeVersion: "00000000-0000-4000-8000-000000000001",
  };
}

const data: BoardData = { cards: [card("a", "s1")] };
const movedEvent = {
  v: 1 as const,
  type: "deal_moved" as const,
  channel: "pipeline:1",
  ts: "2026-06-29T00:00:00.000Z",
  actorId: "u2",
  data: { dealId: "a", toStageId: "s2", boardPosition: "2" },
};

describe("reduceRealtime", () => {
  it("refetches the complete write-precondition snapshot after a remote move", () => {
    const lastReadAt = new Date("2001-02-02T10:00:00.000Z");
    const snapshot: BoardData = {
      cards: [{ ...card("a", "s1"), updatedAt: lastReadAt }],
    };
    const out = reduceRealtime(
      { lastSeq: 4, data: snapshot },
      { kind: "event", event: movedEvent, seq: 5, selfActorId: "me" },
    );
    // The event has stage/order only, so it cannot establish a current write precondition.
    expect(out).toEqual({ lastSeq: 5, effect: "invalidate" });
    expect(snapshot.cards[0]).toMatchObject({
      stageId: "s1",
      boardPosition: "1",
      updatedAt: lastReadAt,
    });
  });

  it("invalidates on a seq gap", () => {
    const out = reduceRealtime(
      { lastSeq: 4, data },
      { kind: "event", event: movedEvent, seq: 7, selfActorId: "me" },
    );
    expect(out.effect).toBe("invalidate");
  });

  it("ignores an echo of the client own action but still advances lastSeq", () => {
    const out = reduceRealtime(
      { lastSeq: 4, data },
      {
        kind: "event",
        event: { ...movedEvent, actorId: "me" },
        seq: 5,
        selfActorId: "me",
      },
    );
    expect(out.effect).toBe("ignore");
    expect(out.lastSeq).toBe(5);
  });

  it("invalidates a self-actor deal_updated (delete/archive), which the board never applied optimistically", () => {
    // Delete/archive originate from the deal workspace, not the board, so there is no local
    // optimistic apply to echo-suppress. The acting user's own board must still refetch to drop
    // the card. Echo suppression is reserved for deal_moved (the only board-optimistic action).
    const updatedEvent = {
      ...movedEvent,
      type: "deal_updated" as const,
      actorId: "me",
      data: { dealId: "a", pipelineId: "1" },
    };
    const out = reduceRealtime(
      { lastSeq: 4, data },
      { kind: "event", event: updatedEvent, seq: 5, selfActorId: "me" },
    );
    expect(out.effect).toBe("invalidate");
  });

  it("invalidates on a resync frame", () => {
    expect(reduceRealtime({ lastSeq: 4, data }, { kind: "resync" }).effect).toBe("invalidate");
  });

  it("ignores a duplicate or out-of-order seq", () => {
    const out = reduceRealtime(
      { lastSeq: 4, data },
      { kind: "event", event: movedEvent, seq: 4, selfActorId: "me" },
    );
    expect(out.effect).toBe("ignore");
    expect(out.lastSeq).toBe(4);
  });

  describe("first-event off-by-one (lastSeq init -1)", () => {
    it("invalidates for the first event (seq=0) from lastSeq=-1", () => {
      const out = reduceRealtime(
        { lastSeq: -1, data },
        { kind: "event", event: movedEvent, seq: 0, selfActorId: "me" },
      );
      expect(out).toEqual({ lastSeq: 0, effect: "invalidate" });
    });

    it("invalidates for the second event (seq=1) after the first (lastSeq=0)", () => {
      const data2: BoardData = { cards: [card("a", "s2")] };
      const event2 = {
        ...movedEvent,
        data: { dealId: "a", toStageId: "s3", boardPosition: "3" },
      };
      const out = reduceRealtime(
        { lastSeq: 0, data: data2 },
        { kind: "event", event: event2, seq: 1, selfActorId: "me" },
      );
      expect(out).toEqual({ lastSeq: 1, effect: "invalidate" });
    });

    it("ignores a repeated seq=0 after it was already applied (lastSeq=0)", () => {
      const out = reduceRealtime(
        { lastSeq: 0, data },
        { kind: "event", event: movedEvent, seq: 0, selfActorId: "me" },
      );
      expect(out.effect).toBe("ignore");
      expect(out.lastSeq).toBe(0);
    });
  });
});

it("revalidates filtered movement on the server instead of patching across filter semantics", () => {
  const filtered = { ...data, filterKey: "stage-equals-s1", filterIsActive: true };
  const out = reduceRealtime(
    { lastSeq: 4, data: filtered },
    { kind: "event", event: movedEvent, seq: 5, selfActorId: "me" },
  );
  expect(out).toEqual({ lastSeq: 5, effect: "invalidate" });
  expect(filtered.cards[0]?.stageId).toBe("s1");
});
