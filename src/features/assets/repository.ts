import { and, asc, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { directoryLocations } from "@/features/locations/schema";
import type {
  AssetBalance,
  AssetCategory,
  AssetEvent,
  AssetModel,
  AssetRecord,
  AssetsWorkspace,
} from "./contracts";
import { assetKey } from "./registerRules";
import {
  type AssetRecordRow,
  assetBalances,
  assetCategories,
  assetEvents,
  assetModels,
  assetRecords,
} from "./schema";

type MetadataRow = AssetModel & { codeKey: string };

function publicMetadata(row: MetadataRow): AssetModel {
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    fieldValues: row.fieldValues,
    tags: row.tags,
    version: row.version,
  };
}

function byAsset<T>(rows: T[], assetId: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = assetId(row);
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, [row]);
    else existing.push(row);
  }
  return grouped;
}

function projectRecord(
  row: AssetRecordRow,
  events: AssetEvent[],
  balances: AssetBalance[],
): AssetRecord {
  const { tracking, serial, modelId, locationId } = row;
  const base = {
    ...publicMetadata(row),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    events,
  };
  return tracking === "individual"
    ? { ...base, tracking, serial, modelId, locationId }
    : { ...base, tracking, balances };
}

type RegisterData = Omit<AssetsWorkspace, "sites">;

export async function assetRegisterData(
  tx: Db,
  siteIds: string[],
  history: boolean,
): Promise<RegisterData> {
  if (siteIds.length === 0) return { locations: [], categories: [], models: [], records: [] };
  const locations = await tx
    .select()
    .from(directoryLocations)
    .where(inArray(directoryLocations.siteId, siteIds))
    .orderBy(asc(directoryLocations.name), asc(directoryLocations.id));
  const categories = await tx
    .select({
      id: assetCategories.id,
      siteId: assetCategories.siteId,
      name: assetCategories.name,
      fields: assetCategories.fields,
      version: assetCategories.version,
    })
    .from(assetCategories)
    .where(inArray(assetCategories.siteId, siteIds))
    .orderBy(asc(assetCategories.name), asc(assetCategories.id));
  const models = await tx
    .select()
    .from(assetModels)
    .where(inArray(assetModels.siteId, siteIds))
    .orderBy(asc(assetModels.codeKey), asc(assetModels.id));
  const rows = await tx
    .select()
    .from(assetRecords)
    .where(inArray(assetRecords.siteId, siteIds))
    .orderBy(asc(assetRecords.codeKey), asc(assetRecords.id));
  const balances = await tx
    .select()
    .from(assetBalances)
    .where(inArray(assetBalances.siteId, siteIds));
  const balanceMap = byAsset(balances, (row) => row.assetId);
  const events = history
    ? await tx
        .select({ ...getTableColumns(assetEvents), actor: users.name })
        .from(assetEvents)
        .leftJoin(users, eq(users.id, assetEvents.actorId))
        .where(inArray(assetEvents.siteId, siteIds))
        .orderBy(desc(assetEvents.version))
    : [];
  const eventMap = byAsset(events, (row) => row.assetId);
  const records = rows.map((row) =>
    projectRecord(
      row,
      (eventMap.get(row.id) ?? []).map(
        ({ id, kind, at, actor, reason, fromLocationId, locationId, quantity }) => ({
          id,
          kind,
          at: at.toISOString(),
          actor: actor ?? "",
          reason,
          fromLocationId,
          locationId,
          quantity,
        }),
      ),
      (balanceMap.get(row.id) ?? []).map(({ locationId, quantity }) => ({ locationId, quantity })),
    ),
  );
  return { locations, categories, models: models.map(publicMetadata), records };
}

function changed<T extends { id: string }>(before: T[], after: T[]) {
  const originals = new Map(before.map((row) => [row.id, row]));
  return after
    .filter((row) => row !== originals.get(row.id))
    .map((next) => ({
      before: originals.get(next.id),
      next,
    }));
}

async function saveCategory(tx: Db, category: AssetCategory, create: boolean) {
  const { id, siteId, name, fields, version } = category;
  const values = { name, nameKey: assetKey(name), fields, version };
  if (create) await tx.insert(assetCategories).values({ id, siteId, ...values });
  else await tx.update(assetCategories).set(values).where(eq(assetCategories.id, id));
}

function metadataValues(row: AssetModel) {
  const { code, name, description, categoryId, tags, fieldValues, version } = row;
  return {
    code,
    name,
    description,
    categoryId,
    tags,
    fieldValues,
    version,
    codeKey: assetKey(code),
  };
}

async function saveModel(tx: Db, model: AssetModel, create: boolean) {
  const values = metadataValues(model);
  if (create)
    await tx.insert(assetModels).values({ id: model.id, siteId: model.siteId, ...values });
  else await tx.update(assetModels).set(values).where(eq(assetModels.id, model.id));
}

function recordValues(record: AssetRecord) {
  const serial = record.tracking === "individual" ? record.serial : null;
  return {
    ...metadataValues(record),
    serial,
    serialKey: serial === null ? null : assetKey(serial),
    modelId: record.tracking === "individual" ? record.modelId : null,
    locationId: record.tracking === "individual" ? record.locationId : null,
    archivedAt: record.archivedAt === null ? null : new Date(record.archivedAt),
  };
}

async function saveBalances(tx: Db, current: AssetRecord | undefined, record: AssetRecord) {
  if (record.tracking === "individual") return;
  const previous =
    current === undefined || current.tracking === "individual" ? [] : current.balances;
  const nextIds = new Set(record.balances.map(({ locationId }) => locationId));
  const before = new Map(previous.map(({ locationId, quantity }) => [locationId, quantity]));
  const deleted = previous
    .filter(({ locationId }) => !nextIds.has(locationId))
    .map(({ locationId }) => locationId);
  if (deleted.length > 0) {
    await tx
      .delete(assetBalances)
      .where(and(eq(assetBalances.assetId, record.id), inArray(assetBalances.locationId, deleted)));
  }
  for (const { locationId, quantity } of record.balances) {
    if (before.get(locationId) === quantity) continue;
    await tx
      .insert(assetBalances)
      .values({ assetId: record.id, siteId: record.siteId, locationId, quantity })
      .onConflictDoUpdate({
        target: [assetBalances.assetId, assetBalances.locationId],
        set: { quantity },
      });
  }
}

async function saveRecord(
  tx: Db,
  current: AssetRecord | undefined,
  record: AssetRecord,
  actorId: string,
) {
  const { id, siteId, tracking, version } = record;
  const values = recordValues(record);
  if (current === undefined) {
    await tx.insert(assetRecords).values({ id, siteId, tracking, ...values });
  } else {
    const stored = await tx
      .update(assetRecords)
      .set(values)
      .where(and(eq(assetRecords.id, id), eq(assetRecords.version, current.version)))
      .returning({ id: assetRecords.id });
    if (stored.length !== 1)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Asset changed while site was locked");
  }
  await saveBalances(tx, current, record);
  const [event] = record.events;
  if (event === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Asset change did not record an event");
  await tx.insert(assetEvents).values({
    id: event.id,
    assetId: id,
    siteId,
    version,
    kind: event.kind,
    at: new Date(event.at),
    actorId,
    reason: event.reason,
    fromLocationId: event.fromLocationId,
    locationId: event.locationId,
    quantity: event.quantity,
  });
}

export async function persistAssetChanges(
  tx: Db,
  before: AssetsWorkspace,
  after: AssetsWorkspace,
  actorId: string,
) {
  for (const category of changed(before.categories, after.categories)) {
    await saveCategory(tx, category.next, category.before === undefined);
  }
  for (const model of changed(before.models, after.models)) {
    await saveModel(tx, model.next, model.before === undefined);
  }
  for (const record of changed(before.records, after.records)) {
    await saveRecord(tx, record.before, record.next, actorId);
  }
}
