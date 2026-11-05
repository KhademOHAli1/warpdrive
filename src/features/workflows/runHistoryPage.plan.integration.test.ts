import { sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { z } from "zod";
import type { Db } from "@/db/client";
import { readRunHistoryCursor } from "./runHistoryCursor";
import { buildRunHistoryPageQuery } from "./runHistoryPage";
import {
  HISTORY_TEST_TIMEOUT,
  historicalSpecs,
  historyCursorBody,
  historyPage,
  publishHistoryWorkflow,
  seedHistoricalRuns,
  withHistory,
} from "./runHistoryPage.test-helpers";
import { runHistoryPageInputSchema } from "./runHistoryPageInput";

// Frozen, UNRUN native diagnostic. Actual plans qualify this finite synthetic
// corpus only, with no scan-cost, timing, index-shape or production capacity SLA.
// Plan-only metadata has no unused synthetic step receipts. The normal 29 behavior
// cases retain receipt seeding; no entire 900-run history is hydrated here.
const explainSchema = z
  .array(
    z
      .object({
        Plan: z.object({ "Actual Rows": z.number().int().nonnegative() }).passthrough(),
        "Planning Time": z.number().nonnegative().optional(),
        "Execution Time": z.number().nonnegative().optional(),
      })
      .passthrough(),
  )
  .length(1);

async function recordPlan(
  db: Db,
  label: string,
  query: ReturnType<typeof buildRunHistoryPageQuery>,
) {
  const result = await db.execute<{ "QUERY PLAN": unknown }>(
    sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
  );
  const document = explainSchema.parse(result.rows[0]?.["QUERY PLAN"]);
  expect(document[0]?.Plan["Actual Rows"]).toBeLessThanOrEqual(51);
  console.warn(JSON.stringify({ label, workflows: 2, runs: 900, document }));
}

it(
  "records actual bounded default, filtered and exact-cursor plans over 900 synthetic runs",
  async () => {
    await withHistory(async (test, signal) => {
      const visible = await seedHistoricalRuns(
        test,
        historicalSpecs(180).map((row, index) => ({
          ...row,
          status: index % 3 === 0 ? ("waiting" as const) : ("succeeded" as const),
          mode: index % 2 === 0 ? ("live" as const) : ("simulation" as const),
        })),
        test,
        { receipts: false },
      );
      const hidden = await publishHistoryWorkflow(
        test,
        test.outsider,
        "Synthetic hidden plan history",
      );
      const hiddenRows = await seedHistoricalRuns(test, historicalSpecs(720), hidden, {
        receipts: false,
      });
      const first = await historyPage(test, signal);
      expect(first.items).toHaveLength(50);
      expect(first.items.every((row) => visible.some((own) => own.id === row.id))).toBe(true);
      for (const row of first.items)
        expect(hiddenRows.some((other) => other.id === row.id)).toBe(false);
      assert(first.nextCursor !== null);
      const body = historyCursorBody(first.nextCursor);
      const fingerprint = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(body.fingerprint);
      const cursor = readRunHistoryCursor(first.nextCursor, fingerprint);
      assert(cursor.ok);
      const defaultInput = runHistoryPageInputSchema.parse({ id: test.workflow.id });
      const filteredInput = runHistoryPageInputSchema.parse({
        id: test.workflow.id,
        status: "waiting",
        mode: "live",
      });
      const filtered = await historyPage(test, signal, { status: "waiting", mode: "live" });
      expect(filtered.items).toHaveLength(30);
      const next = await historyPage(test, signal, { cursor: first.nextCursor });
      expect(next.items).toHaveLength(50);
      expect(next.items.some((row) => first.items.some((prior) => prior.id === row.id))).toBe(
        false,
      );
      await test.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
        await tx.execute(sql`ANALYZE workflow_runs, workflow_versions`);
        await recordPlan(tx, "history-default", buildRunHistoryPageQuery(tx, defaultInput));
        await recordPlan(tx, "history-waiting-live", buildRunHistoryPageQuery(tx, filteredInput));
        await recordPlan(
          tx,
          "history-exact-keyset",
          buildRunHistoryPageQuery(tx, defaultInput, cursor.value),
        );
        signal.throwIfAborted();
      });
    });
  },
  HISTORY_TEST_TIMEOUT,
);
