import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importBatches, importRows } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { finalize } from "./commitHelpers";
import { loadErrorReportRows } from "./errorReportRows";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];

async function seedRows(
  db: TestDb,
  userId: string,
): Promise<{ batchId: string; ids: Record<string, string> }> {
  const [batch] = await db
    .insert(importBatches)
    .values({ targetEntity: "deal", filename: "d.csv", createdBy: userId })
    .returning();
  if (batch === undefined) throw new Error("batch seed failed");
  const specs = [
    { n: 1, status: "invalid" as const },
    { n: 2, status: "valid" as const },
    { n: 3, status: "valid" as const },
  ];
  const ids: Record<string, string> = {};
  for (const spec of specs) {
    const [row] = await db
      .insert(importRows)
      .values({
        batchId: batch.id,
        rowNumber: spec.n,
        raw: { Title: `r${spec.n}` },
        mapped: { primary: {} },
        status: spec.status,
      })
      .returning();
    if (row === undefined) throw new Error("row seed failed");
    ids[`r${spec.n}`] = row.id;
  }
  return { batchId: batch.id, ids };
}

it("stores warnings on the row and keeps it imported", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { ids } = await seedRows(db, user.id);
    const warnings = [{ field: "owner", message: "owner not found" }];
    const result = await db.transaction((tx) =>
      finalize(tx, ids.r2 ?? "", "imported", null, [], undefined, warnings),
    );
    expect(result.ok && result.value.status).toBe("imported");
    expect(result.ok && result.value.warnings).toEqual(warnings);
    const [row] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, ids.r2 ?? ""));
    expect(row?.status).toBe("imported");
    expect(row?.warnings).toEqual(warnings);
    expect(row?.errors).toEqual([]);
  });
});

it("defaults warnings to an empty list", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { ids } = await seedRows(db, user.id);
    await db.transaction((tx) => finalize(tx, ids.r2 ?? "", "imported", null, []));
    const [row] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, ids.r2 ?? ""));
    expect(row?.warnings).toEqual([]);
  });
});

it("error report rows include failed rows and imported rows with warnings only", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { batchId, ids } = await seedRows(db, user.id);
    const warnings = [{ field: "owner", message: "owner not found" }];
    await db.transaction(async (tx) => {
      await finalize(tx, ids.r2 ?? "", "imported", null, [], undefined, warnings);
      await finalize(tx, ids.r3 ?? "", "imported", null, []);
    });
    const rows = await loadErrorReportRows(db, batchId, AbortSignal.timeout(5000));
    expect(rows.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(rows[1]?.warnings).toEqual(warnings);
  });
});
