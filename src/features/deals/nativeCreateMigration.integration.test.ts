import { expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { applyMigrations } from "@/db/migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import {
  insertLegacyWriteVersionDeal,
  seedWriteVersionParents,
  unrelatedRevisionRows,
} from "./dealWriteVersion.test-helpers";
import { createNativeDeal } from "./nativeCreate";
import { creationFixture, creationSignal } from "./nativeCreate.test-helpers";

test("canonical receipt upgrade preserves populated legacy deals, exact tokens and all predecessor receipts", async () => {
  const h = await freshMigrationDb();
  const candidate = await migrationFolder(102);
  try {
    await installPrefix(h, 101);
    expect(
      (
        await h.pool.query<{ absent: boolean }>(
          "SELECT to_regclass('public.deal_create_operations') IS NULL AS absent",
        )
      ).rows,
    ).toEqual([{ absent: true }]);
    const parents = await seedWriteVersionParents(h);
    for (const shape of [
      {},
      { status: "won" as const },
      { status: "lost" as const, archived: true },
      { deleted: true },
    ])
      await insertLegacyWriteVersionDeal(h.pool, parents, shape);
    const oldDeals = (
      await h.pool.query<{ data: Record<string, unknown> }>(
        "SELECT to_jsonb(d) AS data FROM deals d ORDER BY id",
      )
    ).rows;
    const unrelated = await unrelatedRevisionRows(h.pool),
      oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(101);
    const source = await readCanonicalMigrations(candidate.folder, creationSignal());
    if (!source.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, source.error);
    expect(source.value).toHaveLength(102);
    expect(source.value[101]?.idx).toBe(101);
    expect(await applyMigrations(h.db, creationSignal(), candidate.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(
      (
        await h.pool.query<{ data: Record<string, unknown> }>(
          "SELECT to_jsonb(d) AS data FROM deals d ORDER BY id",
        )
      ).rows,
    ).toEqual(oldDeals);
    expect(await unrelatedRevisionRows(h.pool)).toEqual(unrelated);
    expect((await ledger(h)).slice(0, 101)).toEqual(oldLedger);
    expect(await ledger(h)).toHaveLength(102);
    expect(
      (
        await h.pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM deal_create_operations",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    const f = await creationFixture(h);
    const first = await createNativeDeal(h.db, f.who, f.input, creationSignal());
    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      deal: { id: expect.any(String), writeVersion: expect.any(String) },
    });
    expect(await createNativeDeal(h.db, f.who, f.input, creationSignal())).toEqual({
      ...first,
      replayed: true,
    });
  } finally {
    await candidate.dispose();
    await h.close();
  }
});
