import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { archiveDeal } from "./archiveDeal";
import { moveDeal } from "./dealActions";
import {
  commandState,
  readCommandDeal,
  withCommandFixture,
} from "./dealVersionCommands.test-helpers";

describe("deal command write-version preconditions", () => {
  it("rejects timestamp-only legacy moves without changing row, audit or channels", async () => {
    await withCommandFixture(async ({ h, actor, deal }) => {
      const before = await commandState(h, deal.id);
      const result = await moveDeal(
        h.db,
        actor,
        {
          dealId: deal.id,
          toStageId: deal.stageId,
          beforePosition: "10",
          afterPosition: "20",
          expectedUpdatedAt: deal.updatedAt.toISOString(),
        },
        AbortSignal.timeout(10_000),
      );
      expect(result).toMatchObject({ ok: false, error: { id: ERROR_IDS.DEAL_PRECONDITION } });
      expect(await commandState(h, deal.id)).toEqual(before);
    });
  });

  it("rejects an old token after an A-to-B-to-A write with the original visible timestamp", async () => {
    await withCommandFixture(async ({ h, actor, deal, otherStageId }) => {
      const originalTime = deal.updatedAt.toISOString();
      await h.pool.query(
        "UPDATE deals SET stage_id = $2, updated_at = $3::timestamptz WHERE id = $1",
        [deal.id, otherStageId, originalTime],
      );
      await h.pool.query(
        "UPDATE deals SET stage_id = $2, updated_at = $3::timestamptz WHERE id = $1",
        [deal.id, deal.stageId, originalTime],
      );
      const current = await readCommandDeal(h, deal.id);
      expect(current.stageId).toBe(deal.stageId);
      expect(current.updatedAt.toISOString()).toBe(originalTime);
      expect(current.writeVersion).not.toBe(deal.writeVersion);
      const before = await commandState(h, deal.id);
      const result = await moveDeal(
        h.db,
        actor,
        {
          dealId: deal.id,
          toStageId: deal.stageId,
          beforePosition: "10",
          afterPosition: "20",
          expectedUpdatedAt: originalTime,
          expectedWriteVersion: deal.writeVersion,
        },
        AbortSignal.timeout(10_000),
      );
      expect(result).toMatchObject({ ok: false, error: { id: ERROR_IDS.DEAL_PRECONDITION } });
      expect(await commandState(h, deal.id)).toEqual(before);
    });
  });

  it("rejects a stale human move after a derived-date writer preserves updatedAt", async () => {
    await withCommandFixture(async ({ h, actor, deal, otherStageId }) => {
      await h.pool.query(
        "UPDATE deals SET next_activity_at = $2::timestamptz, updated_at = updated_at WHERE id = $1",
        [deal.id, "2030-01-02T12:00:00Z"],
      );
      const current = await readCommandDeal(h, deal.id);
      expect(current.updatedAt).toEqual(deal.updatedAt);
      expect(current.writeVersion).not.toBe(deal.writeVersion);
      const before = await commandState(h, deal.id);
      const result = await moveDeal(
        h.db,
        actor,
        {
          dealId: deal.id,
          toStageId: otherStageId,
          beforePosition: "10",
          afterPosition: "20",
          expectedUpdatedAt: deal.updatedAt.toISOString(),
          expectedWriteVersion: deal.writeVersion,
        },
        AbortSignal.timeout(10_000),
      );
      expect(result).toMatchObject({ ok: false, error: { id: ERROR_IDS.DEAL_PRECONDITION } });
      expect(await commandState(h, deal.id)).toEqual(before);
    });
  });

  it("checks a stale token even when an unarchive command would leave the logical state unchanged", async () => {
    await withCommandFixture(async ({ h, actor, deal }) => {
      await h.pool.query("UPDATE deals SET updated_at = updated_at WHERE id = $1", [deal.id]);
      const current = await readCommandDeal(h, deal.id);
      expect(current.archivedAt).toBeNull();
      expect(current.writeVersion).not.toBe(deal.writeVersion);
      const before = await commandState(h, deal.id);
      const result = await archiveDeal(
        h.db,
        actor,
        { dealId: deal.id, archived: false, expectedWriteVersion: deal.writeVersion },
        AbortSignal.timeout(10_000),
      );
      expect(result).toMatchObject({ ok: false, error: { id: ERROR_IDS.DEAL_PRECONDITION } });
      expect(await commandState(h, deal.id)).toEqual(before);
    });
  });

  it("keeps malformed tokens invalid instead of falling back to a valid timestamp", async () => {
    await withCommandFixture(async ({ h, actor, deal }) => {
      const before = await commandState(h, deal.id);
      await expect(
        moveDeal(
          h.db,
          actor,
          {
            dealId: deal.id,
            toStageId: deal.stageId,
            beforePosition: "10",
            afterPosition: "20",
            expectedUpdatedAt: deal.updatedAt.toISOString(),
            expectedWriteVersion: "not-a-uuid",
          },
          AbortSignal.timeout(10_000),
        ),
      ).rejects.toBeInstanceOf(ZodError);
      expect(await commandState(h, deal.id)).toEqual(before);
    });
  });
});
