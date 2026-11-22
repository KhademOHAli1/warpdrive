import type { BookingCapacityCommitment, BookingCapacityInventory } from "../availability";
import type { Booking, BookingDemand, BookingResource } from "../contracts";
import { assetBookingSources } from "../resources";
import { type BookingState, bookingCommitments } from "../transitions";
import {
  emptyFixtureSession,
  type HandoverFixtureAllocation,
  type HandoverFixtureState,
  pickedPhysicalIds,
  remainingPickup,
} from "./fixtureState";

type Sources = ReturnType<typeof assetBookingSources>;
type Forecast = {
  inventory: { [K in keyof BookingCapacityInventory]: BookingCapacityInventory[K][number][] };
  resources: Sources["resources"];
  returns: Map<string, BookingCapacityCommitment>;
};

function addReturningPool(
  forecast: Forecast,
  booking: Booking,
  allocation: HandoverFixtureAllocation,
  locationId: string,
): BookingDemand {
  const { targetId: id, name, code, sourceBin, outstanding } = allocation;
  const bin = forecast.inventory.pools.find(
    (row) => row.id === id && row.siteId === booking.siteId && row.locationId === locationId,
  );
  const kind = "returnable_pool" as const;
  if (bin === undefined) {
    forecast.inventory.pools.push({
      id,
      siteId: booking.siteId,
      locationId,
      kind,
      quantity: outstanding,
    });
    const resource: BookingResource = {
      siteId: booking.siteId,
      kind,
      resourceId: id,
      locationId,
      name,
      code,
      bin: sourceBin,
      serial: null,
      freeNow: 0,
      contents: [],
      kitDefinitionVersion: null,
    };
    if (
      !forecast.resources.some(
        (existing) =>
          existing.siteId === booking.siteId &&
          existing.kind === kind &&
          existing.resourceId === id &&
          existing.locationId === locationId,
      )
    )
      forecast.resources.push(resource);
  } else {
    bin.quantity += outstanding;
  }
  return { kind, resourceId: id, locationId, quantity: outstanding };
}

function forecastReturn(
  forecast: Forecast,
  { assets }: HandoverFixtureState,
  booking: Booking,
  allocation: HandoverFixtureAllocation,
  kitVersions: Record<string, number>,
): BookingDemand | null {
  const { kind, targetId: id, sourceLocationId: locationId, holdingId, checkoutId } = allocation;
  const { siteId } = booking;
  if (allocation.outstanding === 0) return null;
  if (kind === "kit") {
    const kit = assets.kits?.records.find((row) => row.siteId === siteId && row.id === id);
    const out = assets.kits?.checkouts.find(
      (row) => row.id === checkoutId && row.closedAt === null,
    );
    if (
      kit === undefined ||
      out === undefined ||
      out.definitionVersion !== kit.definitionVersion ||
      !assets.locations.some(
        (bin) => bin.id === kit.locationId && bin.siteId === siteId && !bin.archived,
      )
    )
      return null;
    const restorable = kit.lines.every((line) => {
      const original = out.lines.find((row) => row.id === line.id);
      return (
        original !== undefined &&
        line.packedQuantity + original.quantity - original.returned - original.consumed ===
          line.quantity
      );
    });
    if (!restorable) return null;
    forecast.inventory.kits.push({
      id,
      siteId,
      locationId: kit.locationId,
      definitionVersion: kit.definitionVersion,
    });
    kitVersions[id] = kit.definitionVersion;
    return { kind, resourceId: id, locationId: kit.locationId, quantity: 1 };
  }
  const hold = assets.custody?.holdings.find((row) => row.id === holdingId);
  const asset = assets.records.find(
    (row) => row.id === id && row.siteId === siteId && row.archivedAt === null,
  );
  if (hold === undefined || asset === undefined || hold.quantity < allocation.outstanding)
    return null;
  if (
    locationId !== null &&
    !assets.locations.some((bin) => bin.id === locationId && bin.siteId === siteId && !bin.archived)
  )
    return null;
  if (kind === "asset" && asset.tracking === "individual") {
    forecast.inventory.assets.push({ id, siteId, modelId: asset.modelId, locationId });
    return { kind, resourceId: id, locationId, quantity: 1 };
  }
  return kind === "returnable_pool" && asset.tracking === kind && locationId !== null
    ? addReturningPool(forecast, booking, allocation, locationId)
    : null;
}

function expectedReturns(
  bookings: BookingState,
  handovers: HandoverFixtureState,
  sources: Sources,
  now: string,
): Forecast {
  const forecast: Forecast = {
    ...sources,
    inventory: {
      assets: [...sources.inventory.assets],
      kits: [...sources.inventory.kits],
      pools: sources.inventory.pools.map((pool) => ({ ...pool })),
    },
    resources: [...sources.resources],
    returns: new Map(),
  };
  for (const booking of bookings.bookings) {
    const session = handovers.sessions[booking.id];
    if (
      session === undefined ||
      booking.status !== "confirmed" ||
      Date.parse(booking.window.endAt) <= Date.parse(now)
    )
      continue;
    const kitVersions: Record<string, number> = {};
    const demands = session.allocations.flatMap((row) => {
      const demand = forecastReturn(forecast, handovers, booking, row, kitVersions);
      return demand === null ? [] : [demand];
    });
    if (demands.length > 0)
      forecast.returns.set(booking.id, {
        siteId: booking.siteId,
        window: { startAt: now, endAt: booking.window.endAt },
        state: "held",
        demands,
        kitVersions,
      });
  }
  return forecast;
}

export function handoverPhysicalSources({
  assets,
  inspection,
}: Pick<HandoverFixtureState, "assets" | "inspection">): Sources {
  const sources = assetBookingSources(assets);
  const heldUnits = new Set(inspection.map(({ targetId }) => targetId));
  const assetsFree = sources.inventory.assets.filter(({ id }) => !heldUnits.has(id));
  function inspectedQuantity(siteId: string, id: string, locationId: string | null) {
    return inspection.reduce(
      (held, row) =>
        held +
        (row.siteId === siteId && row.targetId === id && row.locationId === locationId
          ? row.quantity
          : 0),
      0,
    );
  }
  const pools = sources.inventory.pools.flatMap((pool) => {
    const quantity = pool.quantity - inspectedQuantity(pool.siteId, pool.id, pool.locationId);
    return quantity > 0 ? [{ ...pool, quantity }] : [];
  });
  const resources = sources.resources.map((resource) => {
    const { kind, resourceId, siteId, locationId, freeNow } = resource;
    if (kind === "model") {
      return {
        ...resource,
        freeNow: assetsFree.filter((unit) => unit.modelId === resourceId && unit.siteId === siteId)
          .length,
      };
    }
    if (kind === "asset") return { ...resource, freeNow: heldUnits.has(resourceId) ? 0 : freeNow };
    if (kind === "returnable_pool") {
      return {
        ...resource,
        freeNow: Math.max(0, freeNow - inspectedQuantity(siteId, resourceId, locationId)),
      };
    }
    return resource;
  });
  return { ...sources, inventory: { ...sources.inventory, assets: assetsFree, pools }, resources };
}

function connectedCommitments(
  handovers: HandoverFixtureState,
  siteId: string,
  commitments: BookingCapacityCommitment[],
  candidateDemands: readonly BookingDemand[] | undefined,
) {
  if (candidateDemands === undefined) return commitments;
  const modelByUnit = new Map(
    handovers.assets.records.flatMap((row) =>
      row.siteId === siteId && row.tracking === "individual" && row.modelId !== null
        ? [[row.id, row.modelId] as const]
        : [],
    ),
  );
  function family({ kind, resourceId, locationId }: BookingDemand) {
    if (kind === "asset") {
      const model = modelByUnit.get(resourceId);
      return model === undefined ? `asset:${resourceId}` : `model:${model}`;
    }
    return kind === "model" || kind === "kit"
      ? `${kind}:${resourceId}`
      : `${kind}:${resourceId}:${locationId}`;
  }
  const families = new Set(candidateDemands.map(family));
  return commitments.flatMap((row) => {
    const demands = row.demands.filter((demand) => families.has(family(demand)));
    return demands.length === 0 ? [] : [{ ...row, demands }];
  });
}

function scheduledCommitments(
  bookings: BookingState,
  handovers: HandoverFixtureState,
  siteId: string,
  exceptBookingId: string | undefined,
) {
  const existing = bookings.bookings.flatMap((booking) => {
    const session = handovers.sessions[booking.id] ?? emptyFixtureSession;
    const remaining = { ...booking, lines: remainingPickup(booking, session) };
    const excludeModelAssetIds = pickedPhysicalIds(session, "asset");
    return bookingCommitments(
      { bookings: [remaining], maintenance: [] },
      siteId,
      exceptBookingId,
    ).map((row) => ({ ...row, excludeModelAssetIds }));
  });
  return [
    ...existing,
    ...bookingCommitments(
      { bookings: [], maintenance: bookings.maintenance },
      siteId,
      exceptBookingId,
    ),
  ];
}

/** Equipment in custody is available only after its scheduled return, excluding overdue stock. */
export function fixtureHandoverCapacity(
  bookings: BookingState,
  handovers: HandoverFixtureState,
  now: string,
) {
  const sources = handoverPhysicalSources(handovers);
  const { inventory, resources, returns } = expectedReturns(bookings, handovers, sources, now);
  return {
    inventory,
    resources,
    locations: sources.locations,
    commitments: (
      siteId: string,
      exceptBookingId?: string,
      candidateDemands?: readonly BookingDemand[],
    ) =>
      connectedCommitments(
        handovers,
        siteId,
        [
          ...scheduledCommitments(bookings, handovers, siteId, exceptBookingId),
          ...[...returns.values()].filter((row) => row.siteId === siteId),
        ],
        candidateDemands,
      ),
  };
}
