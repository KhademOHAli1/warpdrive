import { describe, expect, it } from "vitest";
import { applyBoardAck } from "./boardAck";
import type { BoardData } from "./boardCache";
import { dealClientFixture, FIRST_DEAL_VERSION, SECOND_DEAL_VERSION } from "./dealClientFixture";

describe("final deal acknowledgment", () => {
  it("advances the token with all persisted server fields rather than an optimistic patch", () => {
    const initial: BoardData = {
      cards: [
        {
          ...dealClientFixture({ title: "Optimistic title", ownerId: "old-owner" }),
          updatedAt: new Date("2026-06-29T00:00:00.000Z"),
          ownerName: "Old owner",
        },
      ],
    };
    const final = dealClientFixture({
      title: "Final server title",
      ownerId: "new-owner",
      value: "25",
      stageId: "s3",
      boardPosition: "17",
      writeVersion: SECOND_DEAL_VERSION,
      updatedAt: "2026-06-29T00:00:01.000Z",
    });
    const out = applyBoardAck(initial, final);
    expect(out.cards[0]).toMatchObject({
      title: final.title,
      ownerId: final.ownerId,
      ownerName: null,
      value: final.value,
      stageId: final.stageId,
      boardPosition: final.boardPosition,
      writeVersion: SECOND_DEAL_VERSION,
      updatedAt: new Date(final.updatedAt),
    });
    expect(initial.cards[0]?.writeVersion).toBe(FIRST_DEAL_VERSION);
  });

  it("removes a final closed deal instead of keeping a fresh token on an open card", () => {
    const initial: BoardData = { cards: [{ ...dealClientFixture(), updatedAt: new Date() }] };
    expect(
      applyBoardAck(
        initial,
        dealClientFixture({ status: "won", writeVersion: SECOND_DEAL_VERSION }),
      ).cards,
    ).toEqual([]);
  });
});
