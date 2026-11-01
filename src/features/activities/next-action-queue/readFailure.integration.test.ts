import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { expect, test } from "vitest";
import * as schema from "@/db/schema";
import { actor, addDeal, NOW, signal, withQueueDb } from "./queue.test-helpers";
import { readNextActionQueue } from "./readNextActionQueue";

test("an actual PostgreSQL read timeout returns a safe read error without SQL or record labels", async () => {
  await withQueueDb(async (f) => {
    const deal = await addDeal(f, { title: "Private failure fixture / متن مشتری" });
    const blocker = await f.h.pool.connect();
    const reader = new Pool({ connectionString: f.h.url, max: 1, options: "-c lock_timeout=50ms" });
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE activities IN ACCESS EXCLUSIVE MODE");
    try {
      const result = await readNextActionQueue(
        drizzle(reader, { schema }),
        actor(f),
        { scope: "all-permitted", limit: 25, offset: 0 },
        signal(),
        NOW,
      );
      expect(result).toMatchObject({ ok: false, error: { id: "E_DB_004" } });
      expect(result).not.toHaveProperty("value");
      if (!result.ok) {
        expect(result.error.message).not.toMatch(
          /SELECT|activities|lock timeout|canceling statement/i,
        );
        expect(JSON.stringify(result.error)).not.toContain(deal.title);
        expect(JSON.stringify(result.error)).not.toContain(f.viewer.id);
      }
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await reader.end();
    }
  });
});
