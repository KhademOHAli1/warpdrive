import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import * as schema from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import {
  historyMigrationReceipts,
  historySourceRows,
  insertHistoryDeal,
  readCaptureEvents,
} from "./capture.test-helpers";
import { readHistoryInstallation } from "./repository";

const signal = () => AbortSignal.timeout(10_000);

function proposal(name: "history-storage-dormant" | "history-activate-locked") {
  return readFile(new URL(`../../../../docs/analytics/${name}.sql`, import.meta.url), "utf8");
}

async function withBoundedClient<T>(
  pool: Awaited<ReturnType<typeof makeTestDb>>["pool"],
  use: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  let reusable = false;
  try {
    await client.query(
      "SET lock_timeout='2000ms'; SET statement_timeout='5000ms'; SET idle_in_transaction_session_timeout='10000ms'",
    );
    return await use(client);
  } finally {
    try {
      await client.query("ROLLBACK; RESET ALL");
      reusable = true;
    } finally {
      client.release(!reusable);
    }
  }
}

function counts(client: PoolClient) {
  return client.query<{ coverage: number; events: number; heads: number; snapshots: number }>(`
    SELECT (SELECT count(*) FROM public.analytics_history_coverage)::int AS coverage,
      (SELECT count(*) FROM public.analytics_history_events)::int AS events,
      (SELECT count(*) FROM public.analytics_history_heads)::int AS heads,
      (SELECT count(*) FROM public.analytics_report_snapshots)::int AS snapshots
  `);
}

async function setBudgets(client: PoolClient, dealLimit: number) {
  await client.query(
    `SELECT set_config('warpdrive.analytics_activation_max_pipelines', '100', false),
      set_config('warpdrive.analytics_activation_max_stages', '100', false),
      set_config('warpdrive.analytics_activation_max_deals', $1::text, false)`,
    [String(dealLimit)],
  );
}

test("keeps the populated canonical prefix dormant until a separate admitted activation", async () => {
  const h = await makeTestDb();
  try {
    const user = await seedUser(h.db);
    const seeded = await seedPipelineWithStages(h.db, ["Initial", "Proposal"]);
    const [first, second] = seeded.stages;
    if (!first || !second) throw new Error("Expected fixture stages");
    const ids = {
      userId: user.id,
      pipelineId: seeded.pipeline.id,
      stageId: first.id,
      otherStageId: second.id,
    };
    const existing = await insertHistoryDeal(h.pool, ids);
    const source = await historySourceRows(h.pool);
    const receipts = await historyMigrationReceipts(h.pool);
    const [storage, activation] = await Promise.all([
      proposal("history-storage-dormant"),
      proposal("history-activate-locked"),
    ]);

    await withBoundedClient(h.pool, async (client) => {
      await client.query(storage);
      expect(await historySourceRows(client)).toEqual(source);
      expect(await historyMigrationReceipts(client)).toEqual(receipts);
      expect((await counts(client)).rows).toEqual([
        { coverage: 0, events: 0, heads: 0, snapshots: 0 },
      ]);
      expect(await readHistoryInstallation(drizzle(client, { schema }), signal())).toEqual({
        state: "unavailable",
        reason: "capture-metadata-invalid",
      });
      const later = await insertHistoryDeal(client, ids);
      expect((await counts(client)).rows[0]?.events).toBe(0);
      const populated = await historySourceRows(client);

      await setBudgets(client, 1);
      await expect(client.query(activation)).rejects.toMatchObject({
        code: "55000",
        message: "analytics activation exceeds its per-source row budgets",
      });
      await client.query("ROLLBACK");
      expect((await counts(client)).rows).toEqual([
        { coverage: 0, events: 0, heads: 0, snapshots: 0 },
      ]);
      expect(await historySourceRows(client)).toEqual(populated);

      await setBudgets(client, 100);
      await client.query(activation);
      expect((await counts(client)).rows).toEqual([
        {
          coverage: 1,
          events: populated.length,
          heads: populated.length,
          snapshots: 0,
        },
      ]);
      expect(await readHistoryInstallation(drizzle(client, { schema }), signal())).toMatchObject({
        state: "installed",
      });
      expect(
        (await readCaptureEvents(client, "deal", existing.id)).map(({ eventKind }) => eventKind),
      ).toEqual(["baseline"]);
      expect(
        (await readCaptureEvents(client, "deal", later.id)).map(({ eventKind }) => eventKind),
      ).toEqual(["baseline"]);
      expect(await historySourceRows(client)).toEqual(populated);
      expect(await historyMigrationReceipts(client)).toEqual(receipts);

      const newDeal = await insertHistoryDeal(client, ids);
      expect(
        (await readCaptureEvents(client, "deal", newDeal.id)).map(({ eventKind }) => eventKind),
      ).toEqual(["insert"]);
      await expect(client.query(activation)).rejects.toMatchObject({
        code: "55000",
        message: "analytics activation requires a fresh dormant ledger",
      });
    });
  } finally {
    await h.close();
  }
});

test("treats dormant storage with no history SELECT as safely unavailable", async () => {
  const h = await makeTestDb();
  try {
    const storage = await proposal("history-storage-dormant");
    await withBoundedClient(h.pool, async (client) => {
      await client.query(storage);
      await client.query("BEGIN");
      const role = `analytics_dormant_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOINHERIT`);
      await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await client.query(`SET LOCAL ROLE "${role}"`);
      expect(await readHistoryInstallation(drizzle(client, { schema }), signal())).toEqual({
        state: "unavailable",
        reason: "capture-safety-unavailable",
      });
    });
  } finally {
    await h.close();
  }
});
