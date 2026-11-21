import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listOrgOptions } from "@/features/contacts/orgOptionsRepo";
import type { HydratedActor } from "@/server/hydrateActor";
import type { ProductionBuildRow } from "../production/buildSchema";
import type {
  ProductionDetail,
  SubcontractOptions,
  SubcontractView,
} from "../production/contracts";
import { purchaseOrderLines, purchaseOrders } from "../purchasing/schema";
import { readPurchaseSiteAccess } from "../purchasing/scope";
import { inventoryManufacturerParts, inventorySupplierOffers } from "../sourcing/schema";
import type { WarehouseAccess } from "../warehouse/access";
import { inventoryStockPositions } from "../warehouse/schema";
import {
  inventorySubcontractDispatches,
  inventorySubcontractMaterials,
  inventorySubcontractReceipts,
  inventorySubcontracts,
  type Subcontract,
} from "./schema";

export async function readSubcontract(tx: Db, buildId: string) {
  const [row] = await tx
    .select()
    .from(inventorySubcontracts)
    .where(eq(inventorySubcontracts.buildId, buildId));
  return row ?? null;
}

export async function readSubcontractPurchase(tx: Db, orderId: string) {
  const [order] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
  return order ?? null;
}

export async function companySubcontractMaterials(tx: Db, buildId: string) {
  const rows = await tx
    .select({ id: inventorySubcontractMaterials.materialId })
    .from(inventorySubcontractMaterials)
    .where(eq(inventorySubcontractMaterials.buildId, buildId));
  return rows.map(({ id }) => id);
}

async function eligibleDraftLines(
  tx: Db,
  build: ProductionBuildRow,
  labels: ReadonlyMap<string, string>,
) {
  const lines = purchaseOrderLines;
  const offers = inventorySupplierOffers;
  const rows = await tx
    .select({
      id: lines.id,
      orderId: lines.orderId,
      reference: purchaseOrders.reference,
      supplierId: purchaseOrders.supplierOrganizationId,
      quantity: lines.orderedUnits,
    })
    .from(lines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, lines.orderId))
    .innerJoin(offers, eq(offers.id, lines.offerId))
    .innerJoin(
      inventoryManufacturerParts,
      eq(inventoryManufacturerParts.id, offers.manufacturerPartId),
    )
    .leftJoin(inventorySubcontracts, eq(inventorySubcontracts.lineId, lines.id))
    .where(
      and(
        eq(lines.itemId, build.itemId),
        eq(lines.siteId, build.siteId),
        eq(lines.orderedUnits, build.quantity),
        eq(lines.trackable, build.trackable),
        eq(lines.stockUnit, build.stockUnit),
        eq(lines.offerVersion, offers.version),
        eq(purchaseOrders.status, "draft"),
        inArray(purchaseOrders.supplierOrganizationId, [...labels.keys()]),
        eq(purchaseOrders.supplierOrganizationId, offers.supplierOrganizationId),
        eq(purchaseOrders.supplierOrganizationId, inventoryManufacturerParts.organizationId),
        eq(offers.approved, true),
        eq(offers.available, true),
        isNull(inventorySubcontracts.buildId),
      ),
    )
    .orderBy(desc(purchaseOrders.createdAt), asc(lines.id))
    .limit(120);
  return rows.flatMap(({ supplierId, ...line }) => {
    const supplier = labels.get(supplierId);
    return supplier === undefined ? [] : [{ ...line, supplier }];
  });
}

function externalBins(access: WarehouseAccess, siteId: string) {
  return access.locations
    .filter(({ kind, siteId: id, archived }) => id === siteId && kind === "external" && !archived)
    .map(({ id, code, name }) => ({ id, code, name }));
}

async function readOptions(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  access: WarehouseAccess,
  canManage: boolean,
  signal: AbortSignal,
): Promise<SubcontractOptions | null> {
  if (!canManage || build.status !== "planned") return null;
  const sites = await readPurchaseSiteAccess(tx, actor);
  if (!sites.some(({ site }) => site.id === build.siteId && site.canBuy)) return null;
  const labels = new Map(
    (await listOrgOptions(tx, actor, signal)).map(({ id, name }) => [id, name]),
  );
  return {
    bins: externalBins(access, build.siteId),
    lines: await eligibleDraftLines(tx, build, labels),
  };
}

async function linkedOrderVisibility(
  tx: Db,
  actor: HydratedActor,
  order: NonNullable<Awaited<ReturnType<typeof readSubcontractPurchase>>>,
  signal: AbortSignal,
) {
  const admitted = (await readPurchaseSiteAccess(tx, actor)).find(
    ({ site }) => site.id === order.siteId,
  );
  if (admitted === undefined || (order.status === "draft" && !admitted.canBrowseDrafts))
    return false;
  return (await listOrgOptions(tx, actor, signal)).some(
    ({ id }) => id === order.supplierOrganizationId,
  );
}

async function readLinked(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  access: WarehouseAccess,
  canManage: boolean,
  link: Subcontract,
  signal: AbortSignal,
): Promise<SubcontractView | null> {
  const order = await readSubcontractPurchase(tx, link.orderId);
  if (order === null) return null;
  const visible = await linkedOrderVisibility(tx, actor, order, signal);
  const dispatch = inventorySubcontractDispatches;
  const custody = await tx
    .select({
      id: dispatch.id,
      materialId: dispatch.materialId,
      quantity: dispatch.quantity,
      returned: dispatch.returned,
      consumed: dispatch.consumed,
      lot: inventoryStockPositions.lot,
      serial: inventoryStockPositions.serial,
    })
    .from(dispatch)
    .innerJoin(inventoryStockPositions, eq(inventoryStockPositions.id, dispatch.vendorPositionId))
    .where(eq(dispatch.buildId, build.id))
    .orderBy(desc(dispatch.createdAt), desc(dispatch.id));
  const outputs = await tx
    .select({
      outputId: inventorySubcontractReceipts.outputId,
      receiptLineId: inventorySubcontractReceipts.receiptLineId,
    })
    .from(inventorySubcontractReceipts)
    .where(eq(inventorySubcontractReceipts.buildId, build.id));
  return {
    orderId: visible ? order.id : null,
    reference: visible ? order.reference : null,
    orderStatus: order.status,
    supplierBin: access.locations.find(({ id }) => id === link.supplierBinId)?.name ?? "",
    companyMaterialIds: await companySubcontractMaterials(tx, build.id),
    custody,
    outputs,
    canDispatch:
      canManage &&
      build.status === "issued" &&
      order.status !== "draft" &&
      order.status !== "cancelled",
    canReturn:
      canManage &&
      custody.some(({ quantity, consumed, returned }) => quantity > consumed + returned),
    canRelease:
      canManage &&
      build.status === "issued" &&
      order.status !== "cancelled" &&
      order.status !== "draft",
  };
}

export async function readSubcontractDetail(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  access: WarehouseAccess,
  canManage: boolean,
  signal: AbortSignal,
): Promise<Pick<ProductionDetail, "subcontract" | "subcontractOptions">> {
  const link = await readSubcontract(tx, build.id);
  return link === null
    ? {
        subcontract: null,
        subcontractOptions: await readOptions(tx, actor, build, access, canManage, signal),
      }
    : {
        subcontract: await readLinked(tx, actor, build, access, canManage, link, signal),
        subcontractOptions: null,
      };
}
