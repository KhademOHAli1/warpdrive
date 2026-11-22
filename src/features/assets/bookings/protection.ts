import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directorySites } from "@/features/locations/schema";
import type { AssetsWorkspace } from "../contracts";
import { kitUsesAsset } from "../kits/usage";
import { type BookingCapacityInventory, planBookingCapacity } from "./availability";
import type { BookingDemand } from "./contracts";
import {
  emptyHandoverSession,
  type HandoverAllocation,
  type HandoverState,
  remainingPickup,
} from "./handover/fixtureState";
import { handoverCapacity } from "./handover/handoverCapacity";
import { loadHandoverState } from "./handover/repository";
import {
  assetBookingHandoverAllocations as allocations,
  assetBookingHandoverInspections as inspections,
} from "./handover/schema";
import { nativeBookingAssets } from "./nativeResources";
import { bookingMaintenance, bookingRecords } from "./repository";
import type { BookingState } from "./transitions";

export type BookingCapacityGuard = (changed: AssetsWorkspace) => boolean;
type BookingClaims = Pick<BookingState, "bookings" | "maintenance">;

async function datedBookingClaims(tx: Db, siteId: string, at: string): Promise<BookingClaims> {
  const bookings = await bookingRecords(tx, [siteId], false, at);
  const maintenance = await bookingMaintenance(tx, [siteId], at);
  return { bookings, maintenance };
}

function stillHasKitCustody(assets: AssetsWorkspace, allocation: HandoverAllocation) {
  const checkout = assets.kits?.checkouts.find(({ id }) => id === allocation.checkoutId);
  if (
    checkout === undefined ||
    checkout.closedAt !== null ||
    checkout.kitId !== allocation.targetId ||
    checkout.locationId !== allocation.sourceLocationId ||
    checkout.lines.length !== allocation.members.length
  )
    return false;
  return allocation.members.every(({ id, targetId, outstanding }) => {
    const member = checkout.lines.find((line) => line.id === id && line.assetId === targetId);
    return (
      member !== undefined && member.quantity - member.returned - member.consumed === outstanding
    );
  });
}

function preservesOutstandingCustody(handovers: HandoverState, changed: AssetsWorkspace) {
  const holdings = new Map((changed.custody?.holdings ?? []).map((row) => [row.id, row]));
  return Object.values(handovers.sessions).every(({ allocations: equipment }) =>
    equipment.every((row) => {
      if (row.outstanding === 0) return true;
      if (row.kind === "kit") return stillHasKitCustody(changed, row);
      const hold = row.holdingId === null ? undefined : holdings.get(row.holdingId);
      return (
        hold !== undefined &&
        hold.assetId === row.targetId &&
        hold.sourceLocationId === row.sourceLocationId &&
        hold.quantity === row.outstanding
      );
    }),
  );
}

function preservesInspections(handovers: HandoverState, changed: AssetsWorkspace) {
  const assets = new Map(changed.records.map((row) => [row.id, row]));
  const underInspection = new Map<string, number>();
  for (const { siteId, targetId, locationId, quantity } of handovers.inspection) {
    const asset = assets.get(targetId);
    if (asset === undefined || asset.siteId !== siteId || asset.archivedAt !== null) return false;
    if (asset.tracking === "individual") {
      if (
        asset.locationId !== locationId ||
        (changed.custody?.holdings.some(({ assetId }) => assetId === targetId) ?? false) ||
        kitUsesAsset(changed.kits, targetId)
      )
        return false;
    } else {
      const key = `${targetId}:${locationId}`;
      const minimum = (underInspection.get(key) ?? 0) + quantity;
      const physical = asset.balances.find((bin) => bin.locationId === locationId)?.quantity ?? 0;
      if (physical < minimum) return false;
      underInspection.set(key, minimum);
    }
  }
  return true;
}

function reducedDemands(
  before: BookingCapacityInventory,
  after: BookingCapacityInventory,
): BookingDemand[] {
  const units = new Map(after.assets.map((row) => [row.id, row]));
  const kits = new Map(after.kits.map((row) => [row.id, row]));
  const pools = new Map(after.pools.map((row) => [`${row.id}:${row.locationId}`, row.quantity]));

  const assetDemands = before.assets.flatMap(({ id, locationId, modelId }): BookingDemand[] => {
    const next = units.get(id);
    if (next?.locationId === locationId && next.modelId === modelId) return [];
    const exact = { kind: "asset", resourceId: id, locationId, quantity: 1 } as const;
    if (modelId === null || next === undefined || modelId === next.modelId) return [exact];
    return [exact, { kind: "model", resourceId: modelId, locationId, quantity: 1 }];
  });
  const kitDemands = before.kits.flatMap(
    ({ id, locationId, definitionVersion }): BookingDemand[] => {
      const next = kits.get(id);
      return next?.locationId === locationId && next.definitionVersion === definitionVersion
        ? []
        : [{ kind: "kit", resourceId: id, locationId, quantity: 1 }];
    },
  );
  const poolDemands = before.pools.flatMap(({ id, locationId, kind, quantity }): BookingDemand[] =>
    (pools.get(`${id}:${locationId}`) ?? 0) >= quantity
      ? []
      : [{ kind, resourceId: id, locationId, quantity }],
  );
  return [...assetDemands, ...kitDemands, ...poolDemands];
}

function touchedCommitments(
  capacity: ReturnType<typeof handoverCapacity>,
  changed: AssetsWorkspace,
  siteId: string,
  demands: readonly BookingDemand[],
) {
  const connected = capacity.commitments(siteId, undefined, demands);
  const connectedModels = new Set(
    connected.flatMap((row) =>
      row.demands.flatMap((demand) => (demand.kind === "model" ? [demand.resourceId] : [])),
    ),
  );
  const touchedAssets = new Set(
    demands.flatMap((demand) => (demand.kind === "asset" ? [demand.resourceId] : [])),
  );
  for (const row of changed.records) {
    if (row.tracking === "individual" && row.modelId !== null && connectedModels.has(row.modelId))
      touchedAssets.add(row.id);
  }
  // Exact holds on sibling serials only interact with a change when a model request can use both.
  return connected.flatMap((row) => {
    const relevant = row.demands.filter(
      (line) => line.kind !== "asset" || touchedAssets.has(line.resourceId),
    );
    return relevant.length > 0 ? [{ ...row, demands: relevant }] : [];
  });
}

export function protectBookingCapacity(
  claims: BookingClaims,
  handovers: HandoverState,
  siteId: string,
  asOf: string,
): BookingCapacityGuard | undefined {
  const before = handoverCapacity(claims, handovers, asOf);
  const hasCustody = Object.values(handovers.sessions).some(({ allocations: equipment }) =>
    equipment.some(({ outstanding }) => outstanding > 0),
  );
  if (
    !hasCustody &&
    handovers.inspection.length === 0 &&
    !before.commitments(siteId).some(({ demands }) => demands.length > 0)
  )
    return undefined;
  return (changed) => {
    const assets = {
      ...changed,
      custody: changed.custody ?? handovers.assets.custody,
      kits: changed.kits ?? handovers.assets.kits,
    };
    if (!preservesOutstandingCustody(handovers, assets) || !preservesInspections(handovers, assets))
      return false;
    const next = handoverCapacity(claims, { ...handovers, assets }, asOf);
    const demands = reducedDemands(before.inventory, next.inventory);
    if (demands.length === 0) return true;
    return planBookingCapacity(next.inventory, touchedCommitments(next, changed, siteId, demands), {
      asOf,
    }).ok;
  };
}

/** The directory and Asset write fences govern both the physical and dated ledgers. */
export async function bookingCapacityGuard(
  tx: Db,
  siteId: string,
  assets: AssetsWorkspace,
): Promise<BookingCapacityGuard | undefined> {
  const asOf = new Date().toISOString();
  const claims = await datedBookingClaims(tx, siteId, asOf);
  const handovers = await loadHandoverState(tx, assets, [siteId]);
  return protectBookingCapacity(claims, handovers, siteId, asOf);
}

/** Serial and model edits can change an exact physical identity without reducing free capacity. */
export async function hasProtectedHandoverAssetIdentity(
  tx: Db,
  siteId: string,
  assetId: string,
): Promise<boolean> {
  const [allocation] = await tx
    .select({ id: allocations.id })
    .from(allocations)
    .where(
      and(
        eq(allocations.siteId, siteId),
        eq(allocations.assetId, assetId),
        gt(allocations.outstanding, 0),
      ),
    )
    .limit(1);
  if (allocation !== undefined) return true;
  const [inspection] = await tx
    .select({ id: inspections.allocationId })
    .from(inspections)
    .where(and(eq(inspections.siteId, siteId), eq(inspections.targetId, assetId)))
    .limit(1);
  return inspection !== undefined;
}

/** Called under the directory's exclusive write lock. */
export async function hasActiveBookingPlacement(
  tx: Db,
  siteId: string,
  locationId: string | null,
): Promise<boolean> {
  const [site] = await tx
    .select({ id: directorySites.id, code: directorySites.code, name: directorySites.name })
    .from(directorySites)
    .where(eq(directorySites.id, siteId))
    .limit(1);
  if (site === undefined) return false;
  const assets = await nativeBookingAssets(tx, [{ ...site, canManage: false }]);
  const handovers = await loadHandoverState(tx, assets, [siteId]);
  const matches = (id: string | null) => locationId === null || id === locationId;
  if (handovers.inspection.some((row) => matches(row.locationId))) return true;
  if (
    Object.values(handovers.sessions).some(({ allocations: equipment }) =>
      equipment.some((row) => row.outstanding > 0 && matches(row.sourceLocationId)),
    )
  )
    return true;

  const { bookings, maintenance } = await datedBookingClaims(tx, siteId, new Date().toISOString());
  return (
    bookings.some((booking) =>
      remainingPickup(booking, handovers.sessions[booking.id] ?? emptyHandoverSession).some(
        (line) => matches(line.locationId),
      ),
    ) || maintenance.some(({ demand }) => matches(demand.locationId))
  );
}
