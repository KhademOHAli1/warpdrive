import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { hasOpenSalesDemand } from "../sales/lifecycle";
import { inventoryItems, inventoryOrderMaterials, inventoryOrders } from "../schema";
import type {
  CatalogCategory,
  CatalogCommand,
  CatalogError,
  CatalogPart,
  CatalogProfile,
} from "./contracts";
import {
  catalogCategoryPath,
  catalogLinkCycle,
  defaultCatalogUnit,
  effectiveCatalogParameters,
  normalizeCatalogParameters,
  validCatalogParameterDefinitions,
} from "./parameters";
import { createLegacyPartProfile } from "./policy";
import type { readCatalogRecords } from "./reads";
import {
  inventoryPartCategories,
  inventoryPartFamilies,
  inventoryPartProfiles,
  inventoryPartStates,
} from "./schema";

export class CatalogCommandFailure extends Error {
  constructor(readonly code: CatalogError) {
    super(code);
  }
}

export function failCatalog(code: CatalogError): never {
  throw new CatalogCommandFailure(code);
}

type Records = Awaited<ReturnType<typeof readCatalogRecords>>;
type SavePart = Extract<CatalogCommand, { type: "savePart" }>;

function checkCategoryAmendment(
  parts: CatalogPart[],
  categories: ReadonlyMap<string, CatalogCategory>,
  changedId: string,
) {
  for (const { profile } of parts) {
    if (profile.values.length === 0) continue;
    const lineage = catalogCategoryPath(categories, profile.categoryId);
    if (
      lineage?.some((category) => category.id === changedId) === true &&
      normalizeCatalogParameters(profile.values, effectiveCatalogParameters(lineage)) === null
    ) {
      failCatalog("unitMismatch");
    }
  }
}

async function saveCategory(
  tx: Db,
  records: Records,
  command: Extract<CatalogCommand, { type: "saveCategory" }>,
) {
  const { id: existing, code, name, parentId, defaultUnit, parameters } = command;
  const fields = { code, name, parentId, defaultUnit, parameters };
  const id = existing ?? randomUUID();
  const categories = new Map(records.categories.map((entry) => [entry.id, entry]));
  if (existing !== null && !categories.has(existing)) failCatalog("invalid");
  if (fields.parentId === id) failCatalog("cycle");
  if (fields.parentId !== null && !categories.has(fields.parentId)) failCatalog("invalid");
  if (!validCatalogParameterDefinitions(fields.parameters)) failCatalog("invalid");
  if (records.categories.some((entry) => entry.id !== id && entry.code === fields.code))
    failCatalog("duplicate");

  categories.set(id, { id, ...fields });
  if (catalogCategoryPath(categories, id) === null) failCatalog("cycle");
  checkCategoryAmendment(records.parts, categories, id);
  if (existing === null) await tx.insert(inventoryPartCategories).values({ id, ...fields });
  else
    await tx.update(inventoryPartCategories).set(fields).where(eq(inventoryPartCategories.id, id));
  return id;
}

async function saveState(
  tx: Db,
  records: Records,
  command: Extract<CatalogCommand, { type: "saveState" }>,
) {
  const { id: existing, code, name, active, locked } = command;
  const fields = { code, name, active, locked };
  const id = existing ?? randomUUID();
  if (existing !== null && !records.states.some((entry) => entry.id === existing))
    failCatalog("invalid");
  if (records.states.some((entry) => entry.id !== id && entry.code === fields.code))
    failCatalog("duplicate");
  if (
    existing !== null &&
    !active &&
    (await hasOpenSalesDemand(tx, {
      itemIds: records.parts
        .filter(({ profile }) => profile.stateId === existing)
        .map(({ id }) => id),
    }))
  ) {
    failCatalog("conflict");
  }
  if (existing === null) await tx.insert(inventoryPartStates).values({ id, ...fields });
  else await tx.update(inventoryPartStates).set(fields).where(eq(inventoryPartStates.id, id));
  return id;
}

function assertExistingPart(part: CatalogPart | undefined, version: number): CatalogPart {
  if (part === undefined) failCatalog("invalid");
  if (part.profile.version !== version) failCatalog("conflict");
  return part;
}

async function ensureLegacyPart(tx: Db, records: Records, part: CatalogPart) {
  if (records.storedItemIds.has(part.id)) return;
  if (!(await createLegacyPartProfile(tx, part))) failCatalog("duplicate");
}

async function setPartState(
  tx: Db,
  records: Records,
  command: Extract<CatalogCommand, { type: "setPartState" }>,
) {
  const part = assertExistingPart(
    records.parts.find(({ id }) => id === command.id),
    command.version,
  );
  if (command.stateId !== null && !records.states.some(({ id }) => id === command.stateId))
    failCatalog("invalid");
  if (part.profile.stateId === command.stateId) return part.id;
  if (
    records.states.find(({ id }) => id === command.stateId)?.active === false &&
    (await hasOpenSalesDemand(tx, { itemIds: [part.id] }))
  )
    failCatalog("conflict");
  await ensureLegacyPart(tx, records, part);
  await tx
    .update(inventoryPartProfiles)
    .set({ stateId: command.stateId, version: command.version + 1 })
    .where(eq(inventoryPartProfiles.itemId, part.id));
  return part.id;
}

function partIdentity(records: Records, command: SavePart) {
  const current =
    command.id === null
      ? null
      : assertExistingPart(
          records.parts.find(({ id }) => id === command.id),
          command.profile.version,
        );
  if (current !== null) {
    if (records.states.find(({ id }) => id === current.profile.stateId)?.locked === true)
      failCatalog("locked");
    if (
      current.kind !== command.kind ||
      current.code !== command.code ||
      current.revision.trim() !== command.revision
    ) {
      failCatalog("invalid");
    }
  } else if (command.profile.version !== 0) {
    failCatalog("conflict");
  }
  const priorRevision = current ?? records.parts.find(({ code }) => code === command.code) ?? null;
  const id = current?.id ?? randomUUID();
  return { current, id, familyId: priorRevision?.familyId ?? id, priorRevision };
}

function validatePartTemplate(
  partLookup: ReadonlyMap<string, CatalogPart>,
  id: string,
  familyId: string,
  profile: SavePart["profile"],
) {
  const { templateItemId, isTemplate } = profile;
  if (templateItemId === id) failCatalog("cycle");
  if (isTemplate) {
    if (templateItemId !== null) failCatalog("invalid");
  } else if ([...partLookup.values()].some((part) => part.profile.templateItemId === id)) {
    failCatalog("invalid");
  }
  if (templateItemId === null) return;
  const template = partLookup.get(templateItemId);
  if (template === undefined || !template.profile.isTemplate || template.familyId === familyId)
    failCatalog("invalid");
}

function validatePartLinks(
  records: Records,
  id: string,
  familyId: string,
  profile: SavePart["profile"],
) {
  const partLookup = new Map(records.parts.map((part) => [part.id, part]));
  validatePartTemplate(partLookup, id, familyId, profile);
  const { supersedesItemId, relatedItemIds } = profile;
  if (
    catalogLinkCycle(
      id,
      supersedesItemId,
      (targetId) => partLookup.get(targetId)?.profile.supersedesItemId ?? null,
    )
  )
    failCatalog("cycle");
  if (supersedesItemId !== null && partLookup.get(supersedesItemId)?.familyId !== familyId)
    failCatalog("invalid");
  if (relatedItemIds.includes(id)) failCatalog("cycle");
  if (relatedItemIds.some((relatedId) => !partLookup.has(relatedId))) failCatalog("invalid");
}

function normalizeProfile(records: Records, profile: SavePart["profile"]): CatalogProfile {
  if (profile.stateId !== null && !records.states.some(({ id }) => id === profile.stateId))
    failCatalog("invalid");
  const categories = new Map(records.categories.map((entry) => [entry.id, entry]));
  const path = catalogCategoryPath(categories, profile.categoryId);
  if (path === null) failCatalog("invalid");
  const values = normalizeCatalogParameters(profile.values, effectiveCatalogParameters(path));
  if (values === null) failCatalog("unitMismatch");
  return {
    ...profile,
    version: profile.version + 1,
    unit: profile.unit ?? defaultCatalogUnit(path),
    relatedItemIds: [...new Set(profile.relatedItemIds)],
    tags: [...new Map(profile.tags.map((tag) => [tag.toLowerCase(), tag])).values()],
    values,
  };
}

async function validateNonStockTransition(
  tx: Db,
  current: CatalogPart | null,
  profile: CatalogProfile,
) {
  if (current === null || (profile.stockMode !== "virtual" && !profile.isTemplate)) return;
  if (current.profile.stockMode === "virtual" || current.profile.isTemplate) return;
  if (current.onHand !== 0 || current.reserved !== 0) failCatalog("conflict");
  const [order] = await tx
    .select({ id: inventoryOrders.id })
    .from(inventoryOrders)
    .leftJoin(inventoryOrderMaterials, eq(inventoryOrderMaterials.orderId, inventoryOrders.id))
    .where(
      and(
        inArray(inventoryOrders.status, ["awaiting_materials", "in_production", "ready"]),
        or(
          eq(inventoryOrders.itemId, current.id),
          eq(inventoryOrderMaterials.componentId, current.id),
        ),
      ),
    )
    .limit(1);
  if (order !== undefined) failCatalog("conflict");
}

async function insertRevision(
  tx: Db,
  records: Records,
  identity: ReturnType<typeof partIdentity>,
  command: SavePart,
  profile: CatalogProfile,
) {
  const { id, familyId, priorRevision } = identity;
  const { code, name, revision, kind } = command;
  const revisionKey = sql`upper(btrim(${revision}))`;
  if (priorRevision !== null) {
    await ensureLegacyPart(tx, records, priorRevision);
    const [duplicate] = await tx
      .select({ id: inventoryPartProfiles.itemId })
      .from(inventoryPartProfiles)
      .where(
        and(
          eq(inventoryPartProfiles.familyId, familyId),
          eq(inventoryPartProfiles.revisionKey, revisionKey),
        ),
      );
    if (duplicate !== undefined) failCatalog("duplicate");
  } else {
    const [family] = await tx
      .insert(inventoryPartFamilies)
      .values({ id: familyId, code })
      .onConflictDoNothing()
      .returning({ id: inventoryPartFamilies.id });
    if (family === undefined) failCatalog("duplicate");
  }
  const sku = priorRevision === null ? code : `RID-${id.replaceAll("-", "").toUpperCase()}`;
  const [item] = await tx
    .insert(inventoryItems)
    .values({ id, sku, name, revision, kind })
    .onConflictDoNothing()
    .returning({ id: inventoryItems.id });
  if (item === undefined) failCatalog("duplicate");
  await tx.insert(inventoryPartProfiles).values({ itemId: id, familyId, revisionKey, ...profile });
}

async function savePart(tx: Db, records: Records, command: SavePart) {
  const identity = partIdentity(records, command);
  const { current, id, familyId } = identity;
  validatePartLinks(records, id, familyId, command.profile);
  const profile = normalizeProfile(records, command.profile);
  await validateNonStockTransition(tx, current, profile);
  if (
    current !== null &&
    (profile.stockMode === "virtual" ||
      profile.isTemplate ||
      !profile.flags.salable ||
      profile.unit !== current.profile.unit ||
      profile.flags.trackable !== current.profile.flags.trackable ||
      profile.visibility !== current.profile.visibility ||
      records.states.find(({ id }) => id === profile.stateId)?.active === false) &&
    (await hasOpenSalesDemand(tx, { itemIds: [id] }))
  )
    failCatalog("conflict");

  if (current === null) await insertRevision(tx, records, identity, command, profile);
  else {
    await ensureLegacyPart(tx, records, current);
    if (current.name !== command.name)
      await tx.update(inventoryItems).set({ name: command.name }).where(eq(inventoryItems.id, id));
    await tx.update(inventoryPartProfiles).set(profile).where(eq(inventoryPartProfiles.itemId, id));
  }
  return id;
}

export function applyCatalogCommand(
  tx: Db,
  records: Records,
  command: CatalogCommand,
): Promise<string> {
  switch (command.type) {
    case "savePart":
      return savePart(tx, records, command);
    case "setPartState":
      return setPartState(tx, records, command);
    case "saveCategory":
      return saveCategory(tx, records, command);
    case "saveState":
      return saveState(tx, records, command);
  }
}
