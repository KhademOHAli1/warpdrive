import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { deals } from "@/db/schema/deals";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { createDeal } from "./dealActions";
import { adminSession, createSession, seedSettings } from "./dealMove.test-helpers";
import { installDealWriteVersionFixture } from "./dealWriteVersion.test-helpers";

type Harness = Awaited<ReturnType<typeof makeTestDb>>;

export async function readCommandDeal(h: Harness, id: string) {
  const [row] = await h.db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (row === undefined) {
    // eslint-disable-next-line no-restricted-syntax -- A missing test fixture is not a domain error.
    throw new Error("command fixture deal disappeared");
  }
  return row;
}

export async function commandState(h: Harness, id: string) {
  const row = await h.pool.query<{ value: unknown }>(
    "SELECT to_jsonb(d) AS value FROM deals d WHERE id = $1",
    [id],
  );
  const audit = await h.pool.query<{ value: unknown }>(
    "SELECT to_jsonb(c) AS value FROM change_logs c WHERE entity_type = 'deal' AND entity_id = $1 ORDER BY id",
    [id],
  );
  const channels = await h.pool.query<{ value: unknown }>(
    "SELECT to_jsonb(c) AS value FROM channel_versions c ORDER BY channel",
  );
  return {
    rows: row.rows.map((item) => item.value),
    audit: audit.rows.map((item) => item.value),
    channels: channels.rows.map((item) => item.value),
  };
}

type Fixture = {
  h: Harness;
  actor: ReturnType<typeof adminSession>;
  deal: Awaited<ReturnType<typeof readCommandDeal>>;
  otherStageId: string;
};

export async function withCommandFixture(check: (fixture: Fixture) => Promise<void>) {
  const h = await makeTestDb();
  const failures: unknown[] = [];
  try {
    await installDealWriteVersionFixture(h.pool);
    await seedSettings(h.db);
    const user = await seedUser(h.db, { isAdmin: true });
    const { pipeline, stages } = await seedPipelineWithStages(h.db, ["A", "B"]);
    const first = stages[0];
    const second = stages[1];
    if (first === undefined || second === undefined) {
      // eslint-disable-next-line no-restricted-syntax -- Missing test stages are not a domain error.
      throw new Error("fixture stages are missing");
    }
    const created = await createDeal(
      h.db,
      createSession(user.id),
      { title: "Versioned command", pipelineId: pipeline.id, stageId: first.id },
      AbortSignal.timeout(10_000),
    );
    if (!created.ok) throw created.error;
    const deal = await readCommandDeal(h, created.value.id);
    expect(created.value).toEqual(deal);
    await check({ h, actor: adminSession(user.id), deal, otherStageId: second.id });
  } catch (error) {
    failures.push(error);
  }
  try {
    await h.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "command fixture and cleanup failed");
}
