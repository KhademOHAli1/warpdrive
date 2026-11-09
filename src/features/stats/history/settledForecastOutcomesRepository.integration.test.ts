import { describe, expect, test } from "vitest";
import { makeTestDb } from "@/test/db";
import { prepareHistoryCapture, readCaptureEvents } from "./capture.test-helpers";
import {
  markForecastSettlementBarrier,
  readForecastSettlementCut,
} from "./settledForecastOutcomesRepository";

describe("private native forecast settlement fence", () => {
  test("a lower pending writer blocks settlement even after the post-period barrier commits", async () => {
    const h = await makeTestDb();
    try {
      const fixture = await prepareHistoryCapture(h);
      const writer = await h.pool.connect();
      try {
        await writer.query("BEGIN");
        await writer.query(
          "UPDATE public.deals SET status = 'won', won_time = clock_timestamp() WHERE id = $1::uuid",
          [fixture.dealId],
        );
        const events = await readCaptureEvents(writer, "deal", fixture.dealId);
        const pending = events.at(-1);
        if (pending === undefined || pending.afterState?.status !== "won")
          throw new Error("Fixture did not capture the pending win");
        const fence = pending.observedAt;
        const barrierClient = await h.pool.connect();
        let barrier: string | null;
        try {
          barrier = await markForecastSettlementBarrier(barrierClient, fence);
        } finally {
          barrierClient.release();
        }
        if (barrier === null) throw new Error("Fixture failed to commit the barrier");
        expect(BigInt(barrier)).toBeGreaterThan(BigInt(pending.transactionId));
        const read = () =>
          h.db.transaction((tx) => readForecastSettlementCut(tx, barrier, fence), {
            isolationLevel: "repeatable read",
            accessMode: "read only",
          });
        const blocked = await read();
        expect(blocked).toMatchObject({ complete: false });
        expect(
          (await readCaptureEvents(h.pool, "deal", fixture.dealId)).map((event) => event.eventId),
        ).not.toContain(pending.eventId);

        await writer.query("COMMIT");
        const subsequent = await read();
        if (subsequent === null)
          throw new Error("Fixture failed to sample the post-commit snapshot");
        // A parallel database writer could still block global coverage. The original
        // writer must now be visible in the same native observation regardless.
        const visible = await h.pool.query<{ visible: boolean }>(
          "SELECT pg_catalog.pg_visible_in_snapshot($1::pg_catalog.xid8, $2::pg_catalog.pg_snapshot) AS visible",
          [pending.transactionId, subsequent.snapshot],
        );
        expect(visible.rows[0]?.visible).toBe(true);
      } finally {
        try {
          if (writer.getTransactionStatus() !== "I") await writer.query("ROLLBACK");
        } finally {
          writer.release(writer.getTransactionStatus() !== "I");
        }
      }
    } finally {
      await h.close();
    }
  });
});
