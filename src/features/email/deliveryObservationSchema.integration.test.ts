import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";

// This actual-PostgreSQL assertion is the first RED gate, before any DSN DDL.
it("allocates separate delivery observations and review history without changing send status", async () => {
  await withTestDb(async (db) => {
    const row = (
      await db.execute(sql`SELECT
      to_regclass('public.email_delivery_reports') IS NOT NULL AS reports,
      to_regclass('public.email_delivery_reviews') IS NOT NULL AS reviews`)
    ).rows[0];
    expect(row).toEqual({ reports: true, reviews: true });
    const statuses = (
      await db.execute(sql`SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_enum.enumtypid=pg_type.oid
      WHERE typname='email_send_status' ORDER BY enumsortorder`)
    ).rows.map((entry) => entry.enumlabel);
    expect(statuses).toEqual(["pending", "sending", "sent", "failed", "needs_review"]);
  });
});
