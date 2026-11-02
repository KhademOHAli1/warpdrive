import { expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import { ledger } from "@/db/migrationAdmission.test-helpers";
import { makeTestDb } from "@/test/db";
import {
  insertLegacyWriteVersionDeal,
  previousDealFields,
  SUPPLIED_VERSION,
  seedWriteVersionParents,
  storedWriteVersion,
  UUID_V4,
} from "./dealWriteVersion.test-helpers";

it("replaces supplied, copied and null INSERT tokens with database-owned opaque revisions", async () => {
  const h = await makeTestDb();
  try {
    const original = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h));
    const originalVersion = await storedWriteVersion(h.pool, original);
    expect(originalVersion).toMatch(UUID_V4);
    const inserted = await h.pool.query<{ version: string }>(
      `INSERT INTO deals(title, pipeline_id, stage_id, owner_id, currency, visibility_level, write_version)
       SELECT label, d.pipeline_id, d.stage_id, d.owner_id, d.currency, 'owner', supplied
       FROM deals d CROSS JOIN LATERAL (
         VALUES ('Supplied revision', $2::uuid), ('Copied revision', d.write_version), ('Null revision', NULL::uuid)
       ) AS input(label, supplied) WHERE d.id=$1 RETURNING write_version::text AS version`,
      [original, SUPPLIED_VERSION],
    );
    const versions = inserted.rows.map((row) => row.version);
    expect(versions).toHaveLength(3);
    for (const version of versions) {
      expect(version).toMatch(UUID_V4);
      expect(version).not.toBe(SUPPLIED_VERSION);
      expect(version).not.toBe(originalVersion);
    }
    expect(new Set([originalVersion, ...versions]).size).toBe(4);
  } finally {
    await h.close();
  }
});

it("rotates on derived-date updates that preserve the exact microsecond updated_at", async () => {
  const h = await makeTestDb();
  try {
    const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h));
    const version = await storedWriteVersion(h.pool, id);
    expect(version).toMatch(UUID_V4);
    const before = await previousDealFields(h.pool, id);
    await h.pool.query(
      "UPDATE deals SET next_activity_at='2031-01-02T03:04:05.654321Z', updated_at=updated_at WHERE id=$1",
      [id],
    );
    const after = await previousDealFields(h.pool, id);
    expect(after).toEqual({ ...before, next_activity_at: after.next_activity_at });
    expect(
      (
        await h.pool.query<{ preserved: boolean; changed: boolean }>(
          `SELECT updated_at='2001-02-03T04:05:06.123456Z'::timestamptz AS preserved,
       next_activity_at='2031-01-02T03:04:05.654321Z'::timestamptz AS changed FROM deals WHERE id=$1`,
          [id],
        )
      ).rows,
    ).toEqual([{ preserved: true, changed: true }]);
    expect(await storedWriteVersion(h.pool, id)).not.toBe(version);
  } finally {
    await h.close();
  }
});

it("rotates on a SQL no-op while preserving every old field", async () => {
  const h = await makeTestDb();
  try {
    const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h));
    const version = await storedWriteVersion(h.pool, id);
    expect(version).toMatch(UUID_V4);
    const before = await previousDealFields(h.pool, id);
    await h.pool.query("UPDATE deals SET title=title, updated_at=updated_at WHERE id=$1", [id]);
    expect(await previousDealFields(h.pool, id)).toEqual(before);
    expect(await storedWriteVersion(h.pool, id)).not.toBe(version);
  } finally {
    await h.close();
  }
});

it("cannot restore an earlier revision through an explicit UPDATE", async () => {
  const h = await makeTestDb();
  try {
    const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h));
    const original = await storedWriteVersion(h.pool, id);
    expect(original).toMatch(UUID_V4);
    await h.pool.query("UPDATE deals SET title='First update' WHERE id=$1", [id]);
    const intermediate = await storedWriteVersion(h.pool, id);
    expect(intermediate).toMatch(UUID_V4);
    expect(intermediate).not.toBe(original);
    await h.pool.query("UPDATE deals SET write_version=$2::uuid WHERE id=$1", [id, original]);
    const current = await storedWriteVersion(h.pool, id);
    expect(current).toMatch(UUID_V4);
    expect(current).not.toBe(original);
    expect(current).not.toBe(intermediate);
  } finally {
    await h.close();
  }
});

it("retains UUID and NOT NULL constraints independently of the repair trigger", async () => {
  const h = await makeTestDb();
  try {
    const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h));
    expect(await storedWriteVersion(h.pool, id)).toMatch(UUID_V4);
    await expect(
      h.pool.query("UPDATE deals SET write_version='invalid' WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: "22P02" });
    await h.pool.query("ALTER TABLE deals DISABLE TRIGGER deals_write_version_owned");
    await expect(
      h.pool.query("UPDATE deals SET write_version=NULL WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: "23502", column: "write_version" });
  } finally {
    await h.close();
  }
});

it("admits an unchanged canonical rerun without rotating tokens or duplicating receipts", async () => {
  const h = await makeTestDb();
  try {
    const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h));
    const version = await storedWriteVersion(h.pool, id);
    expect(version).toMatch(UUID_V4);
    const before = await previousDealFields(h.pool, id);
    const receipts = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect(await storedWriteVersion(h.pool, id)).toBe(version);
    expect(await previousDealFields(h.pool, id)).toEqual(before);
    expect(await ledger(h)).toEqual(receipts);
  } finally {
    await h.close();
  }
});
