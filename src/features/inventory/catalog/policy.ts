import { eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { inventoryItems } from "../schema";
import { blankCatalogProfile, type CatalogPart, type CatalogProfile } from "./contracts";
import { inventoryPartFamilies, inventoryPartProfiles, inventoryPartStates } from "./schema";

export type CatalogItemPolicy = Pick<
  CatalogProfile,
  "visibility" | "stockMode" | "isTemplate" | "flags"
> & {
  code: string;
  active: boolean;
  locked: boolean;
};

/** Take under current native authority and before locking stock rows or file ownership. */
export async function lockInventoryCatalog(
  tx: Db,
  signal: AbortSignal,
  mode: "read" | "write" = "read",
) {
  await tx.execute(
    mode === "write"
      ? sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-inventory-catalog'), hashtext('catalog-v1'))`
      : sql`SELECT pg_advisory_xact_lock_shared(hashtext('warpdrive-inventory-catalog'), hashtext('catalog-v1'))`,
  );
  signal.throwIfAborted();
}

function policyRows(tx: Db) {
  return tx
    .select({
      id: inventoryItems.id,
      sku: inventoryItems.sku,
      kind: inventoryItems.kind,
      code: inventoryPartFamilies.code,
      visibility: inventoryPartProfiles.visibility,
      isTemplate: inventoryPartProfiles.isTemplate,
      stockMode: inventoryPartProfiles.stockMode,
      flags: inventoryPartProfiles.flags,
      active: inventoryPartStates.active,
      locked: inventoryPartStates.locked,
    })
    .from(inventoryItems)
    .leftJoin(inventoryPartProfiles, eq(inventoryItems.id, inventoryPartProfiles.itemId))
    .leftJoin(inventoryPartFamilies, eq(inventoryPartProfiles.familyId, inventoryPartFamilies.id))
    .leftJoin(inventoryPartStates, eq(inventoryPartProfiles.stateId, inventoryPartStates.id));
}

type PolicyRow = Awaited<ReturnType<typeof policyRows>>[number];

function policy(row: PolicyRow): CatalogItemPolicy {
  return {
    code: row.code ?? row.sku,
    active: row.active ?? true,
    locked: row.locked ?? false,
    visibility: row.visibility ?? "staff",
    isTemplate: row.isTemplate ?? false,
    stockMode: row.stockMode ?? "stocked",
    flags: row.flags ?? blankCatalogProfile(row.kind).flags,
  };
}

export async function catalogItemPolicy(tx: Db, itemId: string): Promise<CatalogItemPolicy | null> {
  const [row] = await policyRows(tx).where(eq(inventoryItems.id, itemId));
  return row === undefined ? null : policy(row);
}

export async function catalogItemPolicies(tx: Db): Promise<Map<string, CatalogItemPolicy>> {
  return new Map((await policyRows(tx)).map((row) => [row.id, policy(row)]));
}

/** Bind old Inventory create to the business code namespace in the caller's write transaction. */
export async function createLegacyPartProfile(
  tx: Db,
  {
    id,
    sku,
    revision,
    kind,
  }: Pick<CatalogPart, "id" | "sku" | "revision"> & { kind?: CatalogPart["kind"] },
): Promise<boolean> {
  const [family] = await tx
    .insert(inventoryPartFamilies)
    .values({ id, code: sku })
    .onConflictDoNothing()
    .returning({ id: inventoryPartFamilies.id });
  if (family === undefined) return false;
  const itemKind =
    kind ??
    (
      await tx
        .select({ kind: inventoryItems.kind })
        .from(inventoryItems)
        .where(eq(inventoryItems.id, id))
    )[0]?.kind;
  if (itemKind === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Legacy catalog profile requires an inventory item");
  }
  await tx.insert(inventoryPartProfiles).values({
    itemId: id,
    familyId: id,
    revisionKey: sql`upper(btrim(${revision}))`,
    flags: blankCatalogProfile(itemKind).flags,
  });
  return true;
}
