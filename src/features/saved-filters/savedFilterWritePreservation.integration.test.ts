import { randomUUID } from "node:crypto";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { savedFilters } from "@/db/schema/savedFilters";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { filterSessionNoFlag, filterSessionWithFlag } from "./filterAst.test-helpers";
import { saveFilter, toggleFavorite, updateSavedFilter } from "./savedFilterActions";
import type { SavedFilterTargetEntity } from "./schemas";

type Db = Parameters<Parameters<typeof withTestDb>[0]>[0];
const entities = [
  ["deal", "title"],
  ["person", "primaryEmail"],
  ["organization", "industry"],
  ["lead", "sourceOrigin"],
] as const;

function unsupportedDefinitions(targetEntity: SavedFilterTargetEntity, field: string) {
  const condition = { field, op: "contains", value: "Acme" };
  const definition = { conditions: [condition] };
  return [
    ...(targetEntity === "deal" ? [{ version: 1, targetEntity, definition }] : []),
    { version: 1, targetEntity, definition, presentation: { version: 1, columns: ["unknown"] } },
    { version: 99, targetEntity, definition },
    { ...definition, version: 99, targetEntity, definition },
    { ...definition, futureNarrowing: { teams: ["managed-team"] } },
    { conditions: [{ ...condition, futureScope: "managed-team" }] },
    ...(targetEntity === "deal"
      ? [{ ...definition, sort: { field: "value", dir: "asc", nulls: "first" } }]
      : []),
  ];
}

async function snapshot(db: Db, id: string) {
  const [row] = await db
    .select({
      ...getTableColumns(savedFilters),
      // Compare PostgreSQL's canonical JSONB text, without a JavaScript JSON round trip.
      definition: sql<string>`${savedFilters.definition}::text`,
      createdAt: sql<string>`${savedFilters.createdAt}::text`,
      updatedAt: sql<string>`${savedFilters.updatedAt}::text`,
    })
    .from(savedFilters)
    .where(eq(savedFilters.id, id));
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Saved-filter preservation fixture missing");
  return row;
}

async function seedFuture(db: Db, ownerId: string, targetEntity: SavedFilterTargetEntity) {
  const id = randomUUID();
  const definition = JSON.stringify({
    version: 99,
    targetEntity,
    definition: { conditions: [], futureNarrowing: { teams: ["managed-team"], invert: false } },
    presentation: { version: 7, columns: ["unknown-column"], label: "فروش / Vertrieb" },
  });
  // An existing future payload must bypass today's native writer, never its persistence layer.
  await db.execute(sql`
    INSERT INTO saved_filters
      (id, name, target_entity, definition, owner_id, is_shared, favorite, created_at, updated_at)
    VALUES (${id}, ${"Original view"}, ${targetEntity}, ${definition}::jsonb, ${ownerId},
      false, true, '2020-01-01T00:00:00.123456Z', '2020-01-02T00:00:00.654321Z')
  `);
  return snapshot(db, id);
}

test("unsupported envelopes and unknown constraints reject creates without inserting rows", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const session = filterSessionWithFlag(owner.id, "filter.share");
    const signal = AbortSignal.timeout(10_000);
    for (const [targetEntity, field] of entities) {
      for (const definition of unsupportedDefinitions(targetEntity, field)) {
        expect(
          await saveFilter(
            db,
            session,
            { name: "Must not exist", targetEntity, definition, isShared: true },
            signal,
          ),
        ).toMatchObject({ ok: false, error: { id: "E_DEAL_008" } });
        expect(await db.select().from(savedFilters)).toEqual([]);
      }
    }
  });
});

test("rejected definition updates preserve the original raw payload and every row column", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const session = filterSessionWithFlag(owner.id, "filter.share");
    const signal = AbortSignal.timeout(10_000);
    for (const [targetEntity, field] of entities) {
      const before = await seedFuture(db, owner.id, targetEntity);
      for (const definition of unsupportedDefinitions(targetEntity, field)) {
        expect(
          await updateSavedFilter(
            db,
            session,
            before.id,
            { name: "Must not replace", definition, isShared: true },
            signal,
          ),
        ).toMatchObject({ ok: false, error: { id: "E_DEAL_008" } });
        expect(await snapshot(db, before.id)).toEqual(before);
      }
    }
  });
});

test("name-only updates preserve future JSONB and identity while owner and share gates remain", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const outsider = await seedUser(db);
    const session = filterSessionNoFlag(owner.id);
    const other = filterSessionWithFlag(outsider.id, "filter.share");
    const signal = AbortSignal.timeout(10_000);
    for (const [targetEntity] of entities) {
      const before = await seedFuture(db, owner.id, targetEntity);
      expect(
        await updateSavedFilter(db, other, before.id, { name: "Stolen" }, signal),
      ).toMatchObject({ ok: false, error: { id: "E_DEAL_007" } });
      expect(await snapshot(db, before.id)).toEqual(before);
      expect(await toggleFavorite(db, other, before.id, signal)).toMatchObject({
        ok: false,
        error: { id: "E_DEAL_007" },
      });
      expect(await snapshot(db, before.id)).toEqual(before);
      expect(
        await updateSavedFilter(db, session, before.id, { isShared: true }, signal),
      ).toMatchObject({ ok: false, error: { id: "E_PERM_001" } });
      expect(await snapshot(db, before.id)).toEqual(before);

      const name = `Renamed ${targetEntity}`;
      const result = await updateSavedFilter(db, session, before.id, { name }, signal);
      expect(result).toMatchObject({ ok: true, value: { id: before.id, name } });
      const after = await snapshot(db, before.id);
      expect(after).toEqual({ ...before, name, updatedAt: after.updatedAt });
      expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
    }
  });
});
