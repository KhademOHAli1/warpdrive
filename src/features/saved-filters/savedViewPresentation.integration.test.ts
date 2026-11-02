import { eq, getTableColumns, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { savedFilters } from "@/db/schema/savedFilters";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { filterSessionNoFlag, filterSessionWithFlag } from "./filterAst.test-helpers";
import {
  listSavedFilters,
  removeSavedFilter,
  saveFilter,
  toggleFavorite,
  updateSavedFilter,
} from "./savedFilterActions";
import { listCompatibleSavedFilterViews } from "./savedFilterList";
import { storedViewDefinition } from "./storedViewDefinition";
import { decodeSavedViewDefinition } from "./viewDefinitionVersion";

type Db = Parameters<Parameters<typeof withTestDb>[0]>[0];
const fixtures = [
  {
    targetEntity: "person",
    field: "primaryEmail",
    sort: "primaryEmail",
    nextSort: "name",
    columns: ["name", "phone", "org", "closedDeals", "email"],
  },
  {
    targetEntity: "organization",
    field: "industry",
    sort: "name",
    nextSort: "name",
    columns: ["name", "peopleCount", "address", "openDeals", "closedDeals"],
  },
  {
    targetEntity: "lead",
    field: "sourceOrigin",
    sort: "ownerName",
    nextSort: "value",
    columns: ["title", "owner", "value", "createdAt", "nextActivity", "labels", "sourceOrigin"],
  },
] as const;
type Fixture = (typeof fixtures)[number];

function envelopeFor(fixture: Fixture, updated = false) {
  return {
    version: 1,
    targetEntity: fixture.targetEntity,
    definition: {
      combinator: updated ? "and" : "or",
      conditions: [
        {
          field: fixture.field,
          op: "contains",
          value: updated ? "Updated / تهران" : "  ایران / Straße  ",
        },
      ],
    },
    presentation: {
      version: 1,
      columns: updated
        ? [fixture.columns[0], ...fixture.columns.slice(1).reverse()]
        : [...fixture.columns],
      sort: { field: updated ? fixture.nextSort : fixture.sort, dir: updated ? "asc" : "desc" },
    },
  };
}

async function snapshots(db: Db, signal: AbortSignal) {
  signal.throwIfAborted();
  const rows = await db
    .select({
      ...getTableColumns(savedFilters),
      // PostgreSQL text preserves canonical JSONB and timestamp precision for exact no-write checks.
      definition: sql<string>`${savedFilters.definition}::text`,
      createdAt: sql<string>`${savedFilters.createdAt}::text`,
      updatedAt: sql<string>`${savedFilters.updatedAt}::text`,
    })
    .from(savedFilters)
    .orderBy(savedFilters.id);
  signal.throwIfAborted();
  return rows;
}

async function snapshot(db: Db, id: string, signal: AbortSignal) {
  const row = (await snapshots(db, signal)).find((candidate) => candidate.id === id);
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Presentation fixture row missing");
  return row;
}

async function saveOne(db: Db, userId: string, fixture: Fixture, signal: AbortSignal) {
  const saved = await saveFilter(
    db,
    filterSessionNoFlag(userId),
    {
      name: `نمای ${fixture.targetEntity} / Meine Ansicht`,
      targetEntity: fixture.targetEntity,
      definition: envelopeFor(fixture),
      isShared: false,
    },
    signal,
  );
  if (!saved.ok) throw saved.error;
  return saved.value;
}

async function currentList(db: Db, userId: string, fixture: Fixture, signal: AbortSignal) {
  const actor = await hydrateActor(db, userId, signal);
  if (actor === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Presentation fixture actor missing");
  const rows = await listCompatibleSavedFilterViews({ db, actor }, fixture.targetEntity);
  signal.throwIfAborted();
  return rows;
}

test.each(fixtures)(
  "$targetEntity full envelope survives JSONB and the current compatible list",
  async (fixture) => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const signal = AbortSignal.timeout(15_000);
      const raw = envelopeFor(fixture);
      const saved = await saveOne(db, owner.id, fixture, signal);
      const before = await snapshot(db, saved.id, signal);
      const [persisted] = await db.select().from(savedFilters).where(eq(savedFilters.id, saved.id));
      expect(persisted?.definition).toEqual(raw);
      expect(saved.definition).toEqual(raw);
      const rawRows = await listSavedFilters(
        db,
        filterSessionNoFlag(owner.id),
        fixture.targetEntity,
        signal,
      );
      expect(rawRows[0]?.definition).toEqual(raw);
      expect(decodeSavedViewDefinition(fixture.targetEntity, persisted?.definition)).toEqual({
        ok: true,
        value: { source: "v1", envelope: raw },
      });
      const dto = {
        availability: "available",
        definition: raw.definition,
        presentation: raw.presentation,
      };
      expect(storedViewDefinition(fixture.targetEntity, persisted?.definition)).toEqual(dto);
      expect(await currentList(db, owner.id, fixture, signal)).toEqual([
        { ...saved, ...dto, isOwn: true },
      ]);
      expect(await snapshot(db, saved.id, signal)).toEqual(before);
    });
  },
);

test("full definition updates replace presentation while metadata-only updates preserve exact JSONB", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const signal = AbortSignal.timeout(15_000);
    const session = filterSessionNoFlag(owner.id);
    for (const fixture of fixtures) {
      const saved = await saveOne(db, owner.id, fixture, signal);
      expect(await toggleFavorite(db, session, saved.id, signal)).toMatchObject({
        ok: true,
        value: { favorite: true },
      });
      const before = await snapshot(db, saved.id, signal);
      const raw = envelopeFor(fixture, true);
      const changed = await updateSavedFilter(db, session, saved.id, { definition: raw }, signal);
      expect(changed).toMatchObject({ ok: true, value: { id: saved.id, definition: raw } });
      if (changed.ok) expect(changed.value.definition).toEqual(raw);
      const afterDefinition = await snapshot(db, saved.id, signal);
      expect(afterDefinition).toEqual({
        ...before,
        definition: afterDefinition.definition,
        updatedAt: afterDefinition.updatedAt,
      });
      expect(afterDefinition.definition).not.toBe(before.definition);
      const name = `Renamed ${fixture.targetEntity} / تهران`;
      expect(await updateSavedFilter(db, session, saved.id, { name }, signal)).toMatchObject({
        ok: true,
        value: { id: saved.id, name, definition: raw },
      });
      const afterMetadata = await snapshot(db, saved.id, signal);
      expect(afterMetadata).toEqual({
        ...afterDefinition,
        name,
        updatedAt: afterMetadata.updatedAt,
      });
      expect(afterMetadata.definition).toBe(afterDefinition.definition);
      const rows = await currentList(db, owner.id, fixture, signal);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: saved.id,
        name,
        favorite: true,
        isOwn: true,
        availability: "available",
        definition: raw.definition,
        presentation: raw.presentation,
      });
    }
  });
});

test("non-owner update, favorite and delete denials preserve every exact row column", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const outsider = await seedUser(db);
    const signal = AbortSignal.timeout(15_000);
    const other = filterSessionWithFlag(outsider.id, "filter.share");
    for (const fixture of fixtures) {
      const saved = await saveOne(db, owner.id, fixture, signal);
      const before = await snapshots(db, signal);
      expect(
        await updateSavedFilter(
          db,
          other,
          saved.id,
          {
            name: "Must not replace",
            definition: envelopeFor(fixture, true),
            isShared: true,
          },
          signal,
        ),
      ).toMatchObject({ ok: false, error: { id: ERROR_IDS.DEAL_SAVED_FILTER_NOT_FOUND } });
      expect(await snapshots(db, signal)).toEqual(before);
      expect(await toggleFavorite(db, other, saved.id, signal)).toMatchObject({
        ok: false,
        error: { id: ERROR_IDS.DEAL_SAVED_FILTER_NOT_FOUND },
      });
      expect(await snapshots(db, signal)).toEqual(before);
      expect(await removeSavedFilter(db, other, saved.id, signal)).toMatchObject({
        ok: false,
        error: { id: ERROR_IDS.DEAL_SAVED_FILTER_NOT_FOUND },
      });
      expect(await snapshots(db, signal)).toEqual(before);
      expect(await currentList(db, outsider.id, fixture, signal)).toEqual([]);
    }
  });
});

test("share denials do not insert or replace rows, and an allowed share retains the full envelope", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const outsider = await seedUser(db);
    const signal = AbortSignal.timeout(15_000);
    const session = filterSessionNoFlag(owner.id);
    for (const fixture of fixtures) {
      const saved = await saveOne(db, owner.id, fixture, signal);
      const before = await snapshots(db, signal);
      expect(
        await saveFilter(
          db,
          session,
          {
            name: "Unauthorized shared",
            targetEntity: fixture.targetEntity,
            definition: envelopeFor(fixture),
            isShared: true,
          },
          signal,
        ),
      ).toMatchObject({ ok: false, error: { id: ERROR_IDS.PERM_DENIED } });
      expect(await snapshots(db, signal)).toEqual(before);
      expect(
        await updateSavedFilter(
          db,
          session,
          saved.id,
          {
            name: "Must not replace",
            definition: envelopeFor(fixture, true),
            isShared: true,
          },
          signal,
        ),
      ).toMatchObject({ ok: false, error: { id: ERROR_IDS.PERM_DENIED } });
      expect(await snapshots(db, signal)).toEqual(before);
      const privateRow = await snapshot(db, saved.id, signal);
      expect(
        await updateSavedFilter(
          db,
          filterSessionWithFlag(owner.id, "filter.share"),
          saved.id,
          { isShared: true },
          signal,
        ),
      ).toMatchObject({ ok: true, value: { isShared: true } });
      const sharedRow = await snapshot(db, saved.id, signal);
      expect(sharedRow).toEqual({ ...privateRow, isShared: true, updatedAt: sharedRow.updatedAt });
      const raw = envelopeFor(fixture);
      const rows = await currentList(db, outsider.id, fixture, signal);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: saved.id,
        isShared: true,
        isOwn: false,
        availability: "available",
        definition: raw.definition,
        presentation: raw.presentation,
      });
    }
  });
});
