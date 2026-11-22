import { applyCustodyCommand } from "../../custody/transitions";
import { applyKitCommand } from "../../kits/transitions";
import { applyAssetWorkspaceCommand } from "../../registerCommands";
import { planBookingCapacity } from "../availability";
import type { Booking, BookingDemand, BookingError, BookingLine, BookingSite } from "../contracts";
import type { BookingState } from "../transitions";
import {
  type BookingCheckInItem,
  type BookingHandoverCommand,
  type BookingHandoverReceipt,
  type BookingHandoverWrite,
  type BookingKitMember,
  bookingHandoverCommand,
} from "./contracts";
import {
  emptyHandoverSession,
  type HandoverAllocation,
  type HandoverAssetsWorkspace,
  type HandoverInspectionHold,
  type HandoverSession,
  type HandoverState,
  handoverLineKey,
  pickedPhysicalIds,
  pickedQuantity,
  remainingPickup,
} from "./fixtureState";
import { handoverCapacity, handoverPhysicalSources } from "./handoverCapacity";
import {
  handoverBookingScope,
  handoverCustodians,
  handoverPickupOptions,
  pickupWindowOpen,
  projectHandover,
} from "./projection";

type Clock = { now: string; makeId: () => string };
type ReceiptLine = BookingHandoverReceipt["items"][number];
type Failure = { ok: false; error: BookingError };
type Application =
  | { applied: true; physicalEffects: HandoverPhysicalEffect[] }
  | { applied: false; physicalEffects: [] };
type Success = Extract<BookingHandoverWrite, { ok: true }> &
  Application & {
    state: BookingState;
    handovers: HandoverState;
  };
type Result = Success | Failure;
type Context = {
  booking: Booking;
  site: BookingSite;
  state: BookingState;
  handovers: HandoverState;
  session: HandoverSession;
  clock: Clock;
  command: BookingHandoverCommand;
};
type Effect = {
  assets: HandoverAssetsWorkspace;
  booking: Booking;
  session: HandoverSession;
  items: ReceiptLine[];
  changedDemands?: readonly BookingDemand[];
  inspections?: HandoverInspectionHold[];
  physicalEffects?: HandoverPhysicalEffect[];
};
type AssetStep = {
  allocationId: string;
  before: HandoverAssetsWorkspace;
  after: HandoverAssetsWorkspace;
};

export type HandoverPhysicalEffect = AssetStep &
  ({ kind: "asset" | "custody" } | { kind: "kit"; kitId: string });

function physicalEffect(
  allocation: HandoverAllocation,
  before: HandoverAssetsWorkspace,
  after: HandoverAssetsWorkspace,
): HandoverPhysicalEffect {
  const step = { allocationId: allocation.id, before, after };
  switch (allocation.kind) {
    case "kit":
      return { ...step, kind: "kit", kitId: allocation.targetId };
    case "consumable_pool":
      return { ...step, kind: "asset" };
    case "asset":
    case "returnable_pool":
      return { ...step, kind: "custody" };
  }
}

type Pickup = Extract<BookingHandoverCommand, { type: "pickup" }>;

const fail = (error: BookingError): Failure => ({ ok: false, error });

function receiptLine(
  row: Pick<ReceiptLine, "targetId" | "name" | "code" | "serial" | "sourceBin">,
  quantity: number,
  disposition: ReceiptLine["disposition"],
  destinationBin: string | null = null,
): ReceiptLine {
  const { targetId, name, code, serial, sourceBin } = row;
  return { targetId, name, code, serial, sourceBin, quantity, disposition, destinationBin };
}

function remainingReceiptLines(allocations: readonly HandoverAllocation[]) {
  return allocations.flatMap((row) => {
    if (row.outstanding === 0) return [];
    if (row.kind !== "kit") return [receiptLine(row, row.outstanding, "issued")];
    return row.members.flatMap((member) =>
      member.outstanding > 0
        ? [
            {
              ...receiptLine({ ...member, sourceBin: row.sourceBin }, member.outstanding, "issued"),
              kitId: row.targetId,
              kitCode: row.code,
            },
          ]
        : [],
    );
  });
}

function uncollected(lines: readonly BookingLine[]): ReceiptLine[] {
  return lines.map(({ resourceId, name, code, serial, bin, quantity }) =>
    receiptLine(
      { targetId: resourceId, name, code, serial, sourceBin: bin },
      quantity,
      "uncollected",
    ),
  );
}

function frozenMembers(assets: HandoverAssetsWorkspace, checkoutId: string): BookingKitMember[] {
  const checkout = assets.kits.checkouts.find(({ id }) => id === checkoutId);
  return (checkout?.lines ?? []).map((line) => ({
    id: line.id,
    targetId: line.assetId,
    name: line.assetName,
    code: line.assetCode,
    serial: line.serial,
    outstanding: line.quantity - line.returned - line.consumed,
    consumable: line.mode === "consumable_pool",
  }));
}

function issueKit(
  ctx: Context,
  assets: HandoverAssetsWorkspace,
  allocation: HandoverAllocation,
  { custodianId, requestId }: Pickup,
) {
  const { targetId } = allocation;
  const { siteId } = ctx.booking;
  const actor = ctx.state.viewer.name;
  const note = `Booking handover ${ctx.booking.id}`;
  const kit = assets.kits.records.find(({ id }) => id === targetId);
  if (kit === undefined) return fail("unavailable");
  const result = applyKitCommand(
    assets,
    {
      type: "checkoutKit",
      kitId: kit.id,
      siteId,
      requestId,
      version: kit.version,
      custodianId,
      replacements: [],
      note,
    },
    actor,
  );
  if (!result.ok) return fail("capacity");
  const checkout = result.value.kits.checkouts.find(
    (row) => row.kitId === kit.id && row.closedAt === null,
  );
  if (checkout === undefined) return fail("state");
  const after = { ...result.value, custody: assets.custody };
  return {
    assets: after,
    allocation: {
      ...allocation,
      checkoutId: checkout.id,
      members: frozenMembers(after, checkout.id),
    },
  };
}

function issueItem(
  ctx: Context,
  assets: HandoverAssetsWorkspace,
  command: Pickup,
  item: Pickup["items"][number],
  line: BookingLine,
  remaining: number,
  picked: ReadonlySet<string>,
): { assets: HandoverAssetsWorkspace; allocation: HandoverAllocation } | Failure {
  const { siteId } = ctx.booking;
  const { targetId, lineKey, quantity } = item;
  const sources = handoverPhysicalSources({ assets, inspection: ctx.handovers.inspection });
  if (
    !handoverPickupOptions(sources, siteId, line, remaining, picked).some(
      (option) => option.targetId === targetId && option.available >= quantity,
    )
  )
    return fail("capacity");

  const kind = line.kind === "model" ? "asset" : line.kind;
  const origin = sources.resources.find(
    (row) =>
      row.siteId === siteId &&
      row.kind === kind &&
      row.resourceId === targetId &&
      ((kind !== "returnable_pool" && kind !== "consumable_pool") ||
        row.locationId === line.locationId),
  );
  if (origin === undefined) return fail("unavailable");

  const { name, code, serial, bin: sourceBin, locationId: sourceLocationId } = origin;
  const allocation: HandoverAllocation = {
    id: ctx.clock.makeId(),
    lineKey,
    kind,
    targetId,
    name,
    code,
    serial,
    sourceLocationId,
    sourceBin,
    issued: quantity,
    outstanding: quantity,
    members: [],
    holdingId: null,
    checkoutId: null,
  };
  const note = `Booking handover ${ctx.booking.id}`;
  const { requestId, custodianId } = command;
  const actor = ctx.state.viewer.name;
  if (kind === "kit") return issueKit(ctx, assets, allocation, command);

  const asset = assets.records.find(({ id }) => id === targetId);
  if (asset === undefined) return fail("unavailable");
  const common = { assetId: asset.id, version: asset.version, requestId, quantity };
  if (kind === "consumable_pool") {
    if (sourceLocationId === null) return fail("invalid");
    const used = applyAssetWorkspaceCommand(
      assets,
      {
        ...common,
        type: "changePool",
        operation: "consume",
        locationId: sourceLocationId,
        toLocationId: null,
        reason: note,
      },
      actor,
    );
    return used.ok
      ? {
          assets: { ...used.value, custody: assets.custody, kits: assets.kits },
          allocation: { ...allocation, outstanding: 0 },
        }
      : fail("capacity");
  }

  const result = applyCustodyCommand(
    assets,
    {
      ...common,
      type: "assign",
      siteId,
      locationId: sourceLocationId,
      condition: "good",
      note,
      custodianId,
    },
    actor,
  );
  if (!result.ok) return fail("capacity");
  const event = result.value.custody.events[0];
  if (event?.assetId !== asset.id || event.action !== "assign") return fail("state");
  return {
    assets: { ...result.value, kits: assets.kits },
    allocation: { ...allocation, holdingId: event.holdingId },
  };
}

function pickup(ctx: Context, command: Pickup): Effect | Failure {
  const { session, booking, clock } = ctx;
  if (session.pickupClosed || !pickupWindowOpen(booking, clock.now)) return fail("state");
  const custodian = handoverCustodians(ctx.handovers.assets, booking.siteId).find(
    ({ id }) => id === command.custodianId,
  );
  if (
    custodian === undefined ||
    (session.custodian !== null && session.custodian.id !== custodian.id)
  )
    return fail("unavailable");
  let assets = ctx.handovers.assets;
  const next = {
    ...session,
    custodian: session.custodian ?? { id: custodian.id, name: custodian.name },
    allocations: [...session.allocations],
  };
  const items: ReceiptLine[] = [];
  const changedDemands: BookingDemand[] = [];
  const physicalEffects: HandoverPhysicalEffect[] = [];
  const lines = new Map(booking.lines.map((line) => [handoverLineKey(line), line]));
  const alreadyPicked = new Set([
    ...pickedPhysicalIds(session, "asset"),
    ...pickedPhysicalIds(session, "kit"),
  ]);
  for (const item of command.items) {
    const line = lines.get(item.lineKey);
    if (line === undefined) return fail("invalid");
    const remaining = line.quantity - pickedQuantity(next, item.lineKey);
    const result = issueItem(ctx, assets, command, item, line, remaining, alreadyPicked);
    if ("error" in result) return result;
    const { allocation } = result;
    physicalEffects.push(physicalEffect(allocation, assets, result.assets));
    assets = result.assets;
    next.allocations.push(allocation);
    if (allocation.kind === "asset" || allocation.kind === "kit")
      alreadyPicked.add(allocation.targetId);
    items.push(
      receiptLine(
        allocation,
        allocation.issued,
        allocation.kind === "consumable_pool" ? "consumed" : "issued",
      ),
    );
    changedDemands.push(line);
  }
  const pending = remainingPickup(booking, next);
  if (!command.keepPickupOpen) items.push(...uncollected(pending));
  return {
    assets,
    booking,
    items,
    changedDemands,
    physicalEffects,
    session: { ...next, pickupClosed: pending.length === 0 || !command.keepPickupOpen },
  };
}

type CheckInEffect = {
  assets: HandoverAssetsWorkspace;
  allocation: HandoverAllocation;
  items: ReceiptLine[];
  inspection: HandoverInspectionHold | null;
};

function returnKit(
  ctx: Context,
  assets: HandoverAssetsWorkspace,
  allocation: HandoverAllocation,
  item: Extract<BookingCheckInItem, { kind: "kit" }>,
): CheckInEffect | Failure {
  const { targetId, checkoutId } = allocation;
  const kit = assets.kits.records.find(({ id }) => id === targetId);
  const frozen = assets.kits.checkouts.find(({ id }) => id === checkoutId);
  if (kit === undefined || frozen === undefined || checkoutId === null) return fail("state");
  const items: ReceiptLine[] = [];
  for (const entry of item.members) {
    const prior = frozen.lines.find(({ id }) => id === entry.id);
    if (prior === undefined) return fail("invalid");
    const { assetId, assetCode, assetName, serial } = prior;
    const equipment = {
      targetId: assetId,
      code: assetCode,
      name: assetName,
      serial,
      sourceBin: allocation.sourceBin,
    };
    if (entry.returned > 0)
      items.push({
        ...receiptLine(equipment, entry.returned, "returned", allocation.sourceBin),
        kitId: allocation.targetId,
        kitCode: allocation.code,
      });
    if (entry.consumed > 0)
      items.push({
        ...receiptLine(equipment, entry.consumed, "consumed"),
        kitId: allocation.targetId,
        kitCode: allocation.code,
      });
  }
  const result = applyKitCommand(
    assets,
    {
      type: "returnKit",
      kitId: kit.id,
      siteId: kit.siteId,
      requestId: ctx.command.requestId,
      version: kit.version,
      checkoutId,
      lines: item.members.map(({ id: lineId, returned, consumed }) => ({
        lineId,
        returned,
        consumed,
      })),
      condition: "good",
      note: `Booking check-in ${ctx.booking.id}`,
    },
    ctx.state.viewer.name,
  );
  if (!result.ok) return fail(result.error === "invalid" ? "invalid" : "state");
  const after = { ...result.value, custody: assets.custody };
  const members = frozenMembers(after, checkoutId);
  const outstanding = members.some((line) => line.outstanding > 0) ? 1 : 0;
  return {
    assets: after,
    allocation: { ...allocation, members, outstanding },
    items,
    inspection: null,
  };
}

function returnEquipment(
  ctx: Context,
  assets: HandoverAssetsWorkspace,
  allocation: HandoverAllocation,
  item: Extract<BookingCheckInItem, { kind: "equipment" }>,
): CheckInEffect | Failure {
  const { targetId, holdingId, outstanding } = allocation;
  if (holdingId === null || item.quantity > outstanding) return fail("state");
  const asset = assets.records.find(({ id }) => id === targetId);
  const hold = assets.custody.holdings.find(({ id }) => id === holdingId);
  const destination = assets.locations.find(
    (bin) => bin.id === item.locationId && !bin.archived && bin.siteId === ctx.booking.siteId,
  );
  if (asset === undefined || hold === undefined || destination === undefined)
    return fail("unavailable");
  const disposition =
    item.condition === "damaged" || item.condition === "needs_inspection"
      ? item.condition
      : "returned";
  const result = applyCustodyCommand(
    assets,
    {
      type: "return",
      requestId: ctx.command.requestId,
      siteId: ctx.booking.siteId,
      assetId: asset.id,
      version: asset.version,
      holdingId,
      locationId: item.locationId,
      quantity: item.quantity,
      condition: item.condition,
      note: `Booking check-in ${ctx.booking.id}`,
    },
    ctx.state.viewer.name,
  );
  if (!result.ok) return fail("state");
  const inspection: HandoverInspectionHold | null =
    disposition === "returned"
      ? null
      : {
          allocationId: allocation.id,
          siteId: ctx.booking.siteId,
          targetId: asset.id,
          locationId: destination.id,
          quantity: item.quantity,
          condition: disposition,
        };
  return {
    assets: { ...result.value, kits: assets.kits },
    allocation: { ...allocation, outstanding: outstanding - item.quantity },
    items: [receiptLine(allocation, item.quantity, disposition, destination.name)],
    inspection,
  };
}

function checkIn(
  ctx: Context,
  command: Extract<BookingHandoverCommand, { type: "checkIn" }>,
): Effect | Failure {
  let assets = ctx.handovers.assets;
  const allocations = [...ctx.session.allocations];
  const items: ReceiptLine[] = [];
  const inspections: HandoverInspectionHold[] = [];
  const physicalEffects: HandoverPhysicalEffect[] = [];
  for (const item of command.items) {
    const index = allocations.findIndex(({ id }) => id === item.allocationId);
    const allocation = allocations[index];
    if (
      allocation === undefined ||
      allocation.outstanding === 0 ||
      (allocation.kind === "kit") !== (item.kind === "kit")
    )
      return fail("state");
    const result =
      item.kind === "kit"
        ? returnKit(ctx, assets, allocation, item)
        : returnEquipment(ctx, assets, allocation, item);
    if ("error" in result) return result;
    physicalEffects.push(physicalEffect(allocation, assets, result.assets));
    assets = result.assets;
    allocations[index] = result.allocation;
    items.push(...result.items);
    if (result.inspection !== null) inspections.push(result.inspection);
  }
  return {
    assets,
    booking: ctx.booking,
    session: { ...ctx.session, allocations },
    items,
    inspections,
    physicalEffects,
  };
}

function amendDue(ctx: Context, dueAt: string, reason: string): Effect | Failure {
  const { booking, session, clock } = ctx;
  const { endAt, startAt } = booking.window;
  const due = Date.parse(dueAt);
  if (dueAt === endAt || due <= Math.max(Date.parse(startAt), Date.parse(clock.now)))
    return fail("state");
  if (
    remainingPickup(booking, session).length === 0 &&
    session.allocations.every(({ outstanding }) => outstanding === 0)
  )
    return fail("state");
  if (session.allocations.length === 0 && Date.parse(endAt) <= Date.parse(clock.now))
    return fail("state");
  const version = booking.version + 1;
  return {
    booking: {
      ...booking,
      version,
      updatedAt: clock.now,
      window: { startAt, endAt: dueAt },
      history: [
        {
          version,
          at: clock.now,
          actor: ctx.state.viewer.name,
          kind: "edited",
          reason,
        },
        ...booking.history,
      ],
    },
    session:
      Date.parse(endAt) <= Date.parse(clock.now) ? { ...session, pickupClosed: true } : session,
    assets: ctx.handovers.assets,
    changedDemands: booking.lines,
    items: [],
  };
}

function effect(ctx: Context): Effect | Failure {
  const { command, booking, session, handovers, clock } = ctx;
  switch (command.type) {
    case "pickup":
      return pickup(ctx, command);
    case "checkIn":
      return checkIn(ctx, command);
    case "amendDue":
      return amendDue(ctx, command.dueAt, command.reason);
    case "closePickup": {
      if (session.pickupClosed || Date.parse(booking.window.endAt) <= Date.parse(clock.now))
        return fail("state");
      return {
        booking,
        assets: handovers.assets,
        session: { ...session, pickupClosed: true },
        items: uncollected(remainingPickup(booking, session)),
      };
    }
  }
}

function success(
  state: BookingState,
  handovers: HandoverState,
  booking: Booking,
  now: string,
  application: Application,
): Result {
  const projected = projectHandover(state, handovers, booking.id, now);
  return projected.ok
    ? { ok: true, value: projected.value, booking, state, handovers, ...application }
    : projected;
}

export function applyHandover(
  state: BookingState,
  handovers: HandoverState,
  raw: unknown,
  clock: Clock,
): Result {
  const parsed = bookingHandoverCommand.safeParse(raw);
  if (!parsed.success || !Number.isFinite(Date.parse(clock.now))) return fail("invalid");
  const command = parsed.data;
  const scope = handoverBookingScope(state, command.bookingId);
  if (
    scope === null ||
    !scope.canOperate ||
    !handovers.assets.sites.some(({ id, canManage }) => id === scope.site.id && canManage)
  )
    return fail("unavailable");
  const { booking, site } = scope;
  const request = `${state.viewer.id}:${command.requestId}`;
  const fingerprint = JSON.stringify(command);
  const prior = handovers.requests[request];
  if (prior !== undefined) {
    return prior === fingerprint
      ? success(state, handovers, booking, clock.now, { applied: false, physicalEffects: [] })
      : fail("conflict");
  }
  const session = handovers.sessions[booking.id] ?? emptyHandoverSession;
  if (command.bookingVersion !== booking.version || command.handoverVersion !== session.version)
    return fail("stale");
  const next = effect({ booking, site, state, handovers, session, clock, command });
  if ("error" in next) return next;
  const { assets, changedDemands } = next;
  const receipt: BookingHandoverReceipt = {
    id: clock.makeId(),
    kind: command.type,
    at: clock.now,
    actor: state.viewer.name,
    bookingTitle: booking.title,
    siteName: site.name,
    custodianName: next.session.custodian?.name ?? null,
    dueAt: next.booking.window.endAt,
    previousDueAt: command.type === "amendDue" ? booking.window.endAt : null,
    note: "reason" in command ? command.reason : command.note,
    items: next.items,
    remaining: remainingReceiptLines(next.session.allocations),
  };
  const updated: HandoverState = {
    assets,
    inspection: [...handovers.inspection, ...(next.inspections ?? [])],
    sessions: {
      ...handovers.sessions,
      [booking.id]: {
        ...next.session,
        version: session.version + 1,
        receipts: [receipt, ...session.receipts],
      },
    },
    requests: { ...handovers.requests, [request]: fingerprint },
  };
  const nextState = {
    ...state,
    bookings: state.bookings.map((row) => (row.id === booking.id ? next.booking : row)),
  };
  const capacity = handoverCapacity(nextState, updated, clock.now);
  if (
    changedDemands !== undefined &&
    !planBookingCapacity(
      capacity.inventory,
      capacity.commitments(site.id, undefined, changedDemands),
      { asOf: clock.now },
    ).ok
  )
    return fail("capacity");
  return success(
    {
      ...nextState,
      inventory: capacity.inventory,
      resources: capacity.resources,
      locations: capacity.locations,
    },
    updated,
    next.booking,
    clock.now,
    { applied: true, physicalEffects: next.physicalEffects ?? [] },
  );
}

export { applyHandover as applyFixtureHandover };
