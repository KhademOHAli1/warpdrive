import { afterEach, expect, test } from "vitest";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createDeal } from "@/features/deals/dealActions";
import { makeTestDb, type TestDb } from "@/test/db";

let h: TestDb;
afterEach(async () => {
  await h?.close();
});

test("deal creation waiting behind archive cannot insert a newly hidden record", async () => {
  h = await makeTestDb();
  const user = await seedUser(h.db);
  const p = await seedPipelineWithStages(h.db, ["Entry"]);
  const stage = p.stages[0];
  if (!stage) throw new Error("Fixture stage missing");
  const locker = await h.pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM pipelines WHERE id=$1 FOR UPDATE", [p.pipeline.id]);
    const creating = createDeal(
      h.db,
      {
        userId: user.id,
        isAdmin: true,
        isActive: true,
        sessionLive: true,
        primaryVisibilityGroupId: null,
        flags: {},
        visibilityGroupIds: [],
      },
      { title: "Concurrent creation", pipelineId: p.pipeline.id, stageId: stage.id },
      AbortSignal.timeout(15000),
    );
    let waiting = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await h.pool.query<{ waiting: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') AS waiting",
      );
      if (result.rows[0]?.waiting === true) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await locker.query("UPDATE pipelines SET is_archived=true WHERE id=$1", [p.pipeline.id]);
    await locker.query("COMMIT");
    expect((await creating).ok).toBe(false);
    expect(
      (
        await h.pool.query("SELECT count(*)::int AS n FROM deals WHERE pipeline_id=$1", [
          p.pipeline.id,
        ])
      ).rows,
    ).toEqual([{ n: 0 }]);
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
});
