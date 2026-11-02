import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import {
  insertLegacyWriteVersionDeal,
  previousDealFields,
  SUPPLIED_VERSION,
  seedWriteVersionParents,
  storedWriteVersion,
  UUID_V4,
  writeVersionFixtureLedger,
} from "./dealWriteVersion.fixtures";
import { installDealWriteVersionFixture } from "./dealWriteVersion.test-helpers";

describe("database-owned deal write versions", () => {
  it("replaces supplied, copied and null INSERT tokens instead of trusting producers", async () => {
    const h = await makeTestDb();
    try {
      await installDealWriteVersionFixture(h.pool);
      const parents = await seedWriteVersionParents(h.db);
      const original = await insertLegacyWriteVersionDeal(h.pool, parents);
      const originalVersion = await storedWriteVersion(h.pool, original);
      const inserted = await h.pool.query<{ version: string }>(
        `INSERT INTO deals (title, pipeline_id, stage_id, owner_id, currency, visibility_level, write_version)
         SELECT label, d.pipeline_id, d.stage_id, d.owner_id, d.currency, d.visibility_level, supplied
         FROM deals AS d CROSS JOIN LATERAL (
           VALUES ('Explicit token', $2::uuid), ('Copied token', d.write_version), ('Null token', NULL::uuid)
         ) AS input(label, supplied)
         WHERE d.id = $1 RETURNING write_version::text AS version`,
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

  it("invalidates a snapshot on a derived-date write that preserves updatedAt", async () => {
    const h = await makeTestDb();
    try {
      await installDealWriteVersionFixture(h.pool);
      const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h.db));
      const version = await storedWriteVersion(h.pool, id);
      const before = await previousDealFields(h.pool, id);
      await h.pool.query(
        `UPDATE deals SET next_activity_at = '2031-01-02T03:04:05.654321Z',
                          updated_at = updated_at WHERE id = $1`,
        [id],
      );
      const after = await previousDealFields(h.pool, id);
      expect(after.updated_at).toBe(before.updated_at);
      expect(after).toEqual({ ...before, next_activity_at: after.next_activity_at });
      const instant = await h.pool.query<{ expected: boolean }>(
        `SELECT next_activity_at = '2031-01-02T03:04:05.654321Z'::timestamptz AS expected
         FROM deals WHERE id = $1`,
        [id],
      );
      expect(instant.rows).toEqual([{ expected: true }]);
      expect(await storedWriteVersion(h.pool, id)).not.toBe(version);
    } finally {
      await h.close();
    }
  });

  it("rotates on a SQL no-op without changing other persisted fields", async () => {
    const h = await makeTestDb();
    try {
      await installDealWriteVersionFixture(h.pool);
      const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h.db));
      const before = await previousDealFields(h.pool, id);
      const version = await storedWriteVersion(h.pool, id);
      await h.pool.query("UPDATE deals SET title = title, updated_at = updated_at WHERE id = $1", [
        id,
      ]);
      expect(await previousDealFields(h.pool, id)).toEqual(before);
      expect(await storedWriteVersion(h.pool, id)).not.toBe(version);
    } finally {
      await h.close();
    }
  });

  it("cannot restore an earlier token through an explicit UPDATE", async () => {
    const h = await makeTestDb();
    try {
      await installDealWriteVersionFixture(h.pool);
      const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h.db));
      const original = await storedWriteVersion(h.pool, id);
      await h.pool.query("UPDATE deals SET title = 'First update' WHERE id = $1", [id]);
      const intermediate = await storedWriteVersion(h.pool, id);
      await h.pool.query("UPDATE deals SET write_version = $2::uuid WHERE id = $1", [id, original]);
      const current = await storedWriteVersion(h.pool, id);
      expect(current).toMatch(UUID_V4);
      expect(current).not.toBe(original);
      expect(current).not.toBe(intermediate);
    } finally {
      await h.close();
    }
  });

  it("retains UUID and NOT NULL constraints independently of the producer trigger", async () => {
    const h = await makeTestDb();
    try {
      await installDealWriteVersionFixture(h.pool);
      const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h.db));
      await expect(
        h.pool.query("UPDATE deals SET write_version = 'invalid' WHERE id = $1", [id]),
      ).rejects.toMatchObject({ code: "22P02" });
      // This privileged fixture isolates the column constraint from trigger repair.
      await h.pool.query("ALTER TABLE deals DISABLE TRIGGER deals_write_version_owned");
      await expect(
        h.pool.query("UPDATE deals SET write_version = NULL WHERE id = $1", [id]),
      ).rejects.toMatchObject({ code: "23502", column: "write_version" });
    } finally {
      await h.close();
    }
  });

  it("does not rotate existing versions or fabricate receipts when the fixture overlay is reused", async () => {
    const h = await makeTestDb();
    try {
      await installDealWriteVersionFixture(h.pool);
      const id = await insertLegacyWriteVersionDeal(h.pool, await seedWriteVersionParents(h.db));
      const version = await storedWriteVersion(h.pool, id);
      const before = await previousDealFields(h.pool, id);
      const ledger = await writeVersionFixtureLedger(h.pool);
      await installDealWriteVersionFixture(h.pool);
      expect(await storedWriteVersion(h.pool, id)).toBe(version);
      expect(await previousDealFields(h.pool, id)).toEqual(before);
      expect(await writeVersionFixtureLedger(h.pool)).toEqual(ledger);
    } finally {
      await h.close();
    }
  });
});
