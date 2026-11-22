import { z } from "zod";
import { isTimeZone } from "@/features/i18n/preferences";

const id = z.uuid().toLowerCase();
const version = z.number().int().positive();
const exactQuantity = z.number().int().min(1).max(1_000_000);
const instant = z.iso.datetime().transform((value) => new Date(value).toISOString());
const shortText = (limit: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .refine((value) => !value.includes("\u0000"));
const reason = shortText(500).nullable();

export const bookingRoles = ["viewer", "base", "self_service", "manager"] as const;
export type BookingRole = (typeof bookingRoles)[number];

export const bookingKinds = [
  "asset",
  "model",
  "kit",
  "returnable_pool",
  "consumable_pool",
] as const;
export const bookingDemand = z
  .strictObject({
    kind: z.enum(bookingKinds),
    resourceId: id,
    locationId: id.nullable(),
    quantity: exactQuantity,
  })
  .superRefine((line, ctx) => {
    if ((line.kind === "asset" || line.kind === "kit") && line.quantity !== 1)
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Book one exact unit" });
    if (
      (line.kind === "returnable_pool" || line.kind === "consumable_pool") &&
      line.locationId === null
    )
      ctx.addIssue({ code: "custom", path: ["locationId"], message: "Select a source bin" });
  });
export type BookingDemand = z.infer<typeof bookingDemand>;
export type BookingKind = BookingDemand["kind"];

export const bookingWindow = z
  .strictObject({ startAt: instant, endAt: instant })
  .refine(({ startAt, endAt }) => startAt < endAt, {
    path: ["endAt"],
    message: "Return must follow pickup",
  });
export type BookingWindow = z.infer<typeof bookingWindow>;

const minute = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const slot = z
  .strictObject({ opensAt: minute, closesAt: minute })
  .refine(({ opensAt, closesAt }) => opensAt < closesAt);
const weekDay = z.strictObject({ weekday: z.number().int().min(1).max(7), hours: slot.nullable() });
const override = z.strictObject({ date: z.iso.date(), hours: slot.nullable(), reason });

function distinct<T>(rows: T[], key: (row: T) => string | number) {
  return new Set(rows.map(key)).size === rows.length;
}

const workingHours = z.strictObject({
  enabled: z.boolean(),
  weekly: z
    .array(weekDay)
    .length(7)
    .refine((rows) => distinct(rows, ({ weekday }) => weekday)),
  overrides: z
    .array(override)
    .max(366)
    .refine((rows) => distinct(rows, ({ date }) => date)),
});

export const bookingPolicy = z.strictObject({
  timeZone: z.string().max(80).refine(isTimeZone),
  baseApproval: z.boolean(),
  selfServiceApproval: z.boolean(),
  minNoticeMinutes: z.number().int().min(0).max(43_200),
  maxDurationMinutes: z.number().int().positive().max(525_600).nullable(),
  skipClosedDays: z.boolean(),
  workingHours,
});
export type BookingPolicy = z.infer<typeof bookingPolicy>;

export const bookingStatuses = ["draft", "pending", "confirmed", "cancelled"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

const context = { siteId: id, requestId: id };
const existing = { ...context, bookingId: id, version };
const demandList = z
  .array(bookingDemand)
  .max(60)
  .refine((lines) =>
    distinct(
      lines,
      ({ kind, resourceId, locationId }) => `${kind}:${resourceId}:${locationId ?? ""}`,
    ),
  );

export const bookingCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveBooking"),
    ...context,
    bookingId: id.nullable(),
    version: version.nullable(),
    title: shortText(120),
    description: shortText(1_500).nullable(),
    requesterId: id,
    window: bookingWindow,
    lines: demandList,
  }),
  z.strictObject({ type: z.literal("duplicateBooking"), ...existing, window: bookingWindow }),
  z.strictObject({ type: z.literal("submitBooking"), ...existing }),
  z.strictObject({
    type: z.literal("reviewBooking"),
    ...existing,
    decision: z.enum(["approve", "request_changes", "decline"]),
    reason,
  }),
  z.strictObject({ type: z.literal("cancelBooking"), ...existing, reason }),
  z.strictObject({ type: z.literal("archiveBooking"), ...existing, archived: z.boolean() }),
  z.strictObject({
    type: z.literal("savePolicy"),
    ...context,
    version: z.number().int().nonnegative(),
    policy: bookingPolicy,
  }),
  z.strictObject({
    type: z.literal("saveMaintenance"),
    ...context,
    maintenanceId: id.nullable(),
    version: version.nullable(),
    title: shortText(120),
    window: bookingWindow,
    demand: bookingDemand,
  }),
  z.strictObject({
    type: z.literal("cancelMaintenance"),
    ...context,
    maintenanceId: id,
    version,
  }),
]);
export type BookingCommand = z.infer<typeof bookingCommand>;
type WithoutRequestId<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type BookingIntent = WithoutRequestId<BookingCommand>;

export type BookingLocation = { id: string; siteId: string; name: string; parentId: string | null };
export type BookingParticipant = { id: string; name: string; role: Exclude<BookingRole, "viewer"> };
export type BookingSite = {
  id: string;
  code: string;
  name: string;
  role: BookingRole;
  canConfigure: boolean;
  archived?: boolean;
  policyVersion: number;
  policy: BookingPolicy;
  participants: BookingParticipant[];
};

export type PullListItem = {
  name: string;
  code: string;
  bin: string | null;
  quantity: number;
};

export type BookingLine = BookingDemand &
  PullListItem & {
    serial: string | null;
    contents: PullListItem[];
    kitDefinitionVersion: number | null;
  };

export type BookingResource = {
  siteId: string;
  kind: BookingKind;
  resourceId: string;
  locationId: string | null;
  name: string;
  code: string;
  bin: string | null;
  serial: string | null;
  freeNow: number;
  contents: PullListItem[];
  kitDefinitionVersion: number | null;
};

export type BookingEvent = {
  version: number;
  at: string;
  actor: string;
  kind:
    | "created"
    | "edited"
    | "duplicated"
    | "submitted"
    | "approved"
    | "sent_back"
    | "declined"
    | "cancelled"
    | "archived"
    | "restored"
    | "approval_disabled";
  reason: string | null;
};

export type Booking = {
  id: string;
  siteId: string;
  version: number;
  title: string;
  description: string | null;
  requesterId: string | null;
  requesterName: string;
  requesterRole: Exclude<BookingRole, "viewer">;
  window: BookingWindow;
  status: BookingStatus;
  archived: boolean;
  updatedAt: string;
  lines: BookingLine[];
  history: BookingEvent[];
};

export type BookingMaintenance = {
  id: string;
  siteId: string;
  version: number;
  title: string;
  window: BookingWindow;
  demand: BookingDemand;
  cancelled: boolean;
};

export type BookingCalendarEntry = {
  id: string;
  bookingId: string | null;
  siteId: string;
  title: string | null;
  kind: "pending" | "confirmed" | "maintenance";
  window: BookingWindow;
};

export type BookingsWorkspace = {
  viewer: { id: string; name: string };
  sites: BookingSite[];
  locations: BookingLocation[];
  resources: BookingResource[];
  bookings: Booking[];
  calendar: BookingCalendarEntry[];
  maintenance: BookingMaintenance[];
};

export type BookingError =
  | "invalid"
  | "unavailable"
  | "stale"
  | "conflict"
  | "state"
  | "capacity"
  | "closed_hours"
  | "insufficient_notice"
  | "duration";
export type BookingResult =
  | { ok: true; value: BookingsWorkspace; bookingId: string | null }
  | { ok: false; error: BookingError };

export function validBookingIntent(intent: BookingIntent) {
  return bookingCommand.safeParse({ ...intent, requestId: "00000000-0000-4000-8000-000000000000" })
    .success;
}

export const bookingAvailabilityInput = z.strictObject({
  siteId: id,
  bookingId: id.nullable(),
  window: bookingWindow,
  lines: demandList.refine((lines) => lines.length > 0),
});
export type BookingAvailabilityInput = z.infer<typeof bookingAvailabilityInput>;
export type BookingAvailabilityResult = { ok: true } | { ok: false; error: BookingError };
