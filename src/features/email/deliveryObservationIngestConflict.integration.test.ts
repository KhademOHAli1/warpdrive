import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import {
  deliveryMachinePart,
  deliverySignal,
  seedDeliveryFixture,
} from "./deliveryObservation.test-helpers";
import { ingestDeliveryReports } from "./deliveryObservationIngest";
import { DELIVERY_REPORT_LIMITS } from "./deliveryReportTypes";

it.each([
  { name: "invalid UTF-8", content: Buffer.from([0xc0, 0xaf]) },
  { name: "oversized", content: Buffer.alloc(DELIVERY_REPORT_LIMITS.messageBytes + 1, 65) },
])("rolls back new evidence when an existing part changes to $name bytes", async ({ content }) => {
  await withTestDb(async (db) => {
    const f = await seedDeliveryFixture(db);
    const input = {
      accountId: f.accountId,
      sourceMessageId: f.source.messageId,
      parts: [deliveryMachinePart()],
    };
    expect((await ingestDeliveryReports(db, input, deliverySignal())).ok).toBe(true);
    const evidence = sql`SELECT id,part_key,content_hash,content_bytes,parsed
      FROM email_delivery_reports WHERE account_id=${f.accountId} ORDER BY part_key`;
    const before = (await db.execute(evidence)).rows;
    expect(before).toHaveLength(1);

    const changed = await ingestDeliveryReports(
      db,
      {
        ...input,
        parts: [
          { ...deliveryMachinePart(), partKey: "3" },
          { ...deliveryMachinePart(), content },
        ],
      },
      deliverySignal(),
    );
    expect.soft(changed).toEqual({ ok: false, error: "conflict" });
    expect((await db.execute(evidence)).rows).toEqual(before);
  });
});
