import {
  type BookingCapacityCommitment,
  type BookingCapacityInventory,
  planBookingCapacity,
} from "./availability";
import {
  type Booking,
  type BookingAvailabilityInput,
  type BookingAvailabilityResult,
  type BookingCalendarEntry,
  type BookingCommand,
  type BookingDemand,
  type BookingError,
  type BookingEvent,
  type BookingIntent,
  type BookingLine,
  type BookingParticipant,
  type BookingPolicy,
  type BookingRole,
  type BookingSite,
  type BookingsWorkspace,
  type BookingWindow,
  bookingAvailabilityInput,
  bookingCommand,
} from "./contracts";
import { validateBookingWindow } from "./workingHours";

export type BookingState = Omit<BookingsWorkspace, "calendar"> & {
  inventory: BookingCapacityInventory;
};
type Change = { ok: true; state: BookingState; bookingId: string | null };
type Failure = { ok: false; error: BookingError };
type Result = Change | Failure;
type Existing = Extract<BookingIntent, { bookingId: string }>;
type Save = Extract<BookingIntent, { type: "saveBooking" }>;
type Clock = { now: string; makeId: () => string };
type Scope = { state: BookingState; site: BookingSite };
type Context = Clock & Scope;

const fail = (error: BookingError): Failure => ({ ok: false, error });
const done = (state: BookingState, bookingId: string | null): Change => ({
  ok: true,
  state,
  bookingId,
});

function siteBookings({ state, site }: Context) {
  return state.bookings.filter(({ siteId }) => siteId === site.id);
}

function canRead(booking: Booking, site: BookingSite, actorId: string) {
  return (
    site.role === "manager" ||
    ((site.role === "base" || site.role === "self_service") && booking.requesterId === actorId)
  );
}

export function projectBookings(state: BookingState): BookingsWorkspace {
  const { viewer, sites, locations, resources, maintenance } = state;
  const readable = new Map(sites.map((site) => [site.id, site]));
  const bookings = state.bookings.filter((booking) => {
    const site = readable.get(booking.siteId);
    return site !== undefined && canRead(booking, site, viewer.id);
  });
  const visible = new Set(bookings.map(({ id }) => id));
  const calendar = state.bookings.flatMap(
    ({ id, siteId, title, status, window }, index): BookingCalendarEntry[] => {
      if (!readable.has(siteId) || (status !== "confirmed" && status !== "pending")) return [];
      return [
        {
          id: visible.has(id) ? id : `occupied-${siteId}-${index}`,
          siteId,
          window,
          kind: status,
          bookingId: visible.has(id) ? id : null,
          title: visible.has(id) ? title : null,
        },
      ];
    },
  );
  return {
    viewer,
    sites: sites.map((site) => (site.role === "manager" ? site : { ...site, participants: [] })),
    locations: locations.filter(({ siteId }) => readable.has(siteId)),
    resources: resources.filter(({ siteId }) => readable.has(siteId)),
    bookings,
    calendar: [
      ...calendar,
      ...maintenance
        .filter(({ siteId, cancelled }) => readable.has(siteId) && !cancelled)
        .map(({ id, siteId, window, title }) => ({
          id,
          siteId,
          window,
          title: readable.get(siteId)?.role === "manager" ? title : null,
          kind: "maintenance" as const,
          bookingId: null,
        })),
    ],
    maintenance: maintenance.filter(({ siteId }) => readable.get(siteId)?.role === "manager"),
  };
}

function demandKey({ kind, resourceId, locationId }: BookingDemand) {
  return `${kind}:${resourceId}:${locationId ?? ""}`;
}

function linesFor({ state, site }: Scope, demands: BookingDemand[]): BookingLine[] | null {
  const resources = new Map(
    state.resources
      .filter(({ siteId }) => siteId === site.id)
      .map((resource) => [demandKey({ ...resource, quantity: 1 }), resource]),
  );
  const lines: BookingLine[] = [];
  for (const demand of demands) {
    const resource = resources.get(demandKey(demand));
    if (resource === undefined) return null;
    const { name, code, bin, serial, contents, kitDefinitionVersion } = resource;
    lines.push({ ...demand, name, code, bin, serial, contents, kitDefinitionVersion });
  }
  return lines;
}

function participant(ctx: Context, id: string): BookingParticipant | undefined {
  const { state, site } = ctx;
  if (id === state.viewer.id && site.role !== "viewer") return { ...state.viewer, role: site.role };
  return site.role === "manager" ? site.participants.find((person) => person.id === id) : undefined;
}

function withEvent(
  ctx: Context,
  row: Booking,
  kind: BookingEvent["kind"],
  reason: string | null = null,
): Booking {
  const version = row.version + 1;
  return {
    ...row,
    version,
    updatedAt: ctx.now,
    history: [{ version, at: ctx.now, actor: ctx.state.viewer.name, kind, reason }, ...row.history],
  };
}

function replace<T extends { id: string }>(rows: T[], next: T) {
  return [next, ...rows.filter(({ id }) => id !== next.id)];
}

function save(ctx: Context, row: Booking) {
  return done({ ...ctx.state, bookings: replace(ctx.state.bookings, row) }, row.id);
}

function kitVersions(lines: BookingLine[]) {
  return Object.fromEntries(
    lines.flatMap(({ resourceId, kitDefinitionVersion }) =>
      kitDefinitionVersion === null ? [] : [[resourceId, kitDefinitionVersion]],
    ),
  );
}

export function bookingCommitments(state: BookingState, siteId: string, exceptId?: string) {
  const booked = state.bookings.flatMap((booking): BookingCapacityCommitment[] => {
    if (
      booking.siteId !== siteId ||
      booking.id === exceptId ||
      (booking.status !== "pending" && booking.status !== "confirmed")
    )
      return [];
    return [
      {
        siteId,
        window: booking.window,
        demands: booking.lines,
        kitVersions: kitVersions(booking.lines),
        state: booking.status === "pending" ? "pending" : "held",
      },
    ];
  });
  const maintenance = state.maintenance.flatMap((record): BookingCapacityCommitment[] =>
    record.siteId === siteId && record.id !== exceptId && !record.cancelled
      ? [{ siteId, window: record.window, demands: [record.demand], state: "maintenance" }]
      : [],
  );
  return [...booked, ...maintenance];
}

function capacityError(
  { state, site, now }: Scope & Pick<Clock, "now">,
  window: BookingWindow,
  demands: BookingDemand[],
  versions: Record<string, number>,
  id: string,
  capacityState: BookingCapacityCommitment["state"] = "held",
) {
  const plan = planBookingCapacity(state.inventory, bookingCommitments(state, site.id, id), {
    asOf: now,
    request: { siteId: site.id, window, demands, kitVersions: versions, state: capacityState },
  });
  if (plan.ok) return null;
  return plan.error === "invalid" ? "invalid" : "capacity";
}

function reservationError(ctx: Context, booking: Booking, timing: boolean) {
  if (booking.lines.length === 0) return "invalid";
  if (timing) {
    const windowError = validateBookingWindow(
      ctx.site.policy,
      booking.window,
      ctx.site.role,
      ctx.now,
    );
    if (windowError !== null) return windowError;
  } else if (booking.window.endAt <= ctx.now) {
    return "state";
  }
  return capacityError(ctx, booking.window, booking.lines, kitVersions(booking.lines), booking.id);
}

function needsApproval(role: BookingRole, policy: BookingPolicy) {
  return (
    (role === "base" && policy.baseApproval) ||
    (role === "self_service" && policy.selfServiceApproval)
  );
}

function expanded(before: Booking, after: Booking) {
  if (after.window.startAt < before.window.startAt || after.window.endAt > before.window.endAt)
    return true;
  const quantities = new Map(before.lines.map((line) => [demandKey(line), line.quantity]));
  return after.lines.some((line) => line.quantity > (quantities.get(demandKey(line)) ?? 0));
}

function draft(
  ctx: Context,
  fields: Pick<Booking, "title" | "description" | "window" | "lines">,
  requester: BookingParticipant,
  kind: "created" | "duplicated",
) {
  return withEvent(
    ctx,
    {
      ...fields,
      id: ctx.makeId(),
      siteId: ctx.site.id,
      version: 0,
      requesterId: requester.id,
      requesterName: requester.name,
      requesterRole: requester.role,
      status: "draft",
      archived: false,
      updatedAt: ctx.now,
      history: [],
    },
    kind,
  );
}

function updateBooking(ctx: Context, command: Save): Result {
  const before = siteBookings(ctx).find(({ id }) => id === command.bookingId);
  if (
    command.bookingId !== null &&
    (before === undefined || !canRead(before, ctx.site, ctx.state.viewer.id))
  )
    return fail("unavailable");
  if ((before?.version ?? null) !== command.version) return fail("stale");
  if (before?.archived === true || before?.status === "cancelled") return fail("state");
  const requester = participant(ctx, command.requesterId);
  const lines = linesFor(ctx, command.lines);
  if (requester === undefined || lines === null) return fail("unavailable");
  const { title, description, window } = command;
  const fields = { title, description, window, lines };
  if (before === undefined) return save(ctx, draft(ctx, fields, requester, "created"));
  if (before.status !== "draft" && requester.id !== before.requesterId) return fail("state");
  const edited: Booking = {
    ...before,
    ...fields,
    requesterId: requester.id,
    requesterName: requester.name,
    requesterRole: requester.role,
  };
  if (before.status !== "draft") {
    const increases = expanded(before, edited);
    const error = reservationError(ctx, edited, increases);
    if (error !== null) return fail(error);
    if (increases && needsApproval(ctx.site.role, ctx.site.policy)) edited.status = "pending";
  }
  return save(ctx, withEvent(ctx, edited, "edited"));
}

function archiveBooking(ctx: Context, row: Booking, archived: boolean): Result {
  if (
    row.archived === archived ||
    (!["draft", "cancelled"].includes(row.status) && row.window.endAt > ctx.now)
  )
    return fail("state");
  return save(ctx, withEvent(ctx, { ...row, archived }, archived ? "archived" : "restored"));
}

function duplicateBooking(ctx: Context, row: Booking, window: BookingWindow): Result {
  const requester = participant(ctx, row.requesterId);
  const lines = linesFor(ctx, row.lines);
  if (requester === undefined || lines === null) return fail("unavailable");
  const { title, description } = row;
  return save(ctx, draft(ctx, { title, description, window, lines }, requester, "duplicated"));
}

function submitBooking(ctx: Context, row: Booking): Result {
  if (row.status !== "draft") return fail("state");
  if (participant(ctx, row.requesterId) === undefined) return fail("unavailable");
  const lines = linesFor(ctx, row.lines);
  if (lines === null) return fail("unavailable");
  const updated = { ...row, lines };
  const error = reservationError(ctx, updated, true);
  if (error !== null) return fail(error);
  const status = needsApproval(ctx.site.role, ctx.site.policy) ? "pending" : "confirmed";
  return save(ctx, withEvent(ctx, { ...updated, status }, "submitted"));
}

function reviewBooking(
  ctx: Context,
  row: Booking,
  command: Extract<Existing, { type: "reviewBooking" }>,
): Result {
  if (ctx.site.role !== "manager") return fail("unavailable");
  if (row.status !== "pending") return fail("state");
  const { decision, reason } = command;
  if (decision === "approve") {
    const error = reservationError(ctx, row, false);
    if (error !== null) return fail(error);
    return save(ctx, withEvent(ctx, { ...row, status: "confirmed" }, "approved", reason));
  }
  return decision === "request_changes"
    ? save(ctx, withEvent(ctx, { ...row, status: "draft" }, "sent_back", reason))
    : save(ctx, withEvent(ctx, { ...row, status: "cancelled" }, "declined", reason));
}

function existingBooking(ctx: Context, command: Existing): Result {
  const prior = siteBookings(ctx).find(({ id }) => id === command.bookingId);
  if (prior === undefined || !canRead(prior, ctx.site, ctx.state.viewer.id))
    return fail("unavailable");
  if (prior.version !== command.version) return fail("stale");
  if (command.type === "archiveBooking") return archiveBooking(ctx, prior, command.archived);
  if (command.type === "duplicateBooking") return duplicateBooking(ctx, prior, command.window);
  if (prior.archived || prior.status === "cancelled") return fail("state");
  switch (command.type) {
    case "submitBooking":
      return submitBooking(ctx, prior);
    case "reviewBooking":
      return reviewBooking(ctx, prior, command);
    case "cancelBooking":
      return save(
        ctx,
        withEvent(ctx, { ...prior, status: "cancelled" }, "cancelled", command.reason),
      );
  }
}

function updatePolicy(
  ctx: Context,
  command: Extract<BookingIntent, { type: "savePolicy" }>,
): Result {
  if (!ctx.site.canConfigure || ctx.site.role !== "manager") return fail("unavailable");
  if (ctx.site.policyVersion !== command.version) return fail("stale");
  const { policy } = command;
  const site = { ...ctx.site, policy, policyVersion: command.version + 1 };
  const releaseApprovals = !policy.baseApproval && !policy.selfServiceApproval;
  return done(
    {
      ...ctx.state,
      sites: replace(ctx.state.sites, site),
      bookings: ctx.state.bookings.map((booking) =>
        releaseApprovals &&
        booking.siteId === site.id &&
        booking.status === "pending" &&
        !booking.archived &&
        booking.window.endAt > ctx.now
          ? withEvent(ctx, { ...booking, status: "confirmed" }, "approval_disabled")
          : booking,
      ),
    },
    null,
  );
}

function updateMaintenance(
  ctx: Context,
  command: Extract<BookingIntent, { type: "saveMaintenance" | "cancelMaintenance" }>,
): Result {
  if (ctx.site.role !== "manager") return fail("unavailable");
  const prior = ctx.state.maintenance.find(
    ({ id, siteId }) => id === command.maintenanceId && siteId === ctx.site.id,
  );
  if (command.maintenanceId !== null && prior === undefined) return fail("unavailable");
  if ((prior?.version ?? null) !== command.version) return fail("stale");
  if (prior?.cancelled === true) return fail("state");
  if (command.type === "cancelMaintenance") {
    if (prior === undefined) return fail("unavailable");
    return done(
      {
        ...ctx.state,
        maintenance: replace(ctx.state.maintenance, {
          ...prior,
          version: prior.version + 1,
          cancelled: true,
        }),
      },
      null,
    );
  }
  const { title, demand, window } = command;
  if (window.endAt <= ctx.now) return fail("state");
  const lines = linesFor(ctx, [demand]);
  if (lines === null) return fail("unavailable");
  const id = prior?.id ?? ctx.makeId();
  const error = capacityError(ctx, window, [demand], kitVersions(lines), id, "maintenance");
  if (error !== null) return fail(error);
  return done(
    {
      ...ctx.state,
      maintenance: replace(ctx.state.maintenance, {
        id,
        siteId: ctx.site.id,
        version: (prior?.version ?? 0) + 1,
        title,
        demand,
        window,
        cancelled: false,
      }),
    },
    null,
  );
}

export function applyBookingCommand(
  state: BookingState,
  raw: BookingCommand,
  clock: Clock,
): Result {
  const parsed = bookingCommand.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const command = parsed.data;
  const site = state.sites.find(({ id }) => id === command.siteId);
  if (site === undefined || site.role === "viewer") return fail("unavailable");
  const ctx = { state, site, ...clock };
  switch (command.type) {
    case "saveBooking":
      return updateBooking(ctx, command);
    case "savePolicy":
      return updatePolicy(ctx, command);
    case "saveMaintenance":
    case "cancelMaintenance":
      return updateMaintenance(ctx, command);
    case "submitBooking":
    case "reviewBooking":
    case "cancelBooking":
    case "duplicateBooking":
    case "archiveBooking":
      return existingBooking(ctx, command);
  }
}

export function previewBookingAvailability(
  state: BookingState,
  raw: BookingAvailabilityInput,
  now: string,
): BookingAvailabilityResult {
  const parsed = bookingAvailabilityInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { siteId, bookingId, window, lines } = parsed.data;
  const site = state.sites.find(({ id }) => id === siteId);
  if (site === undefined) return fail("unavailable");
  if (bookingId !== null) {
    const booking = state.bookings.find(
      ({ id, siteId: bookingSite }) => id === bookingId && bookingSite === siteId,
    );
    if (booking === undefined || !canRead(booking, site, state.viewer.id))
      return fail("unavailable");
  }
  const ctx = { state, site, now };
  const windowError = validateBookingWindow(site.policy, window, site.role, now);
  if (windowError !== null) return fail(windowError);
  const resolved = linesFor(ctx, lines);
  if (resolved === null) return fail("unavailable");
  const error = capacityError(ctx, window, lines, kitVersions(resolved), bookingId ?? "");
  return error === null ? { ok: true } : fail(error);
}
