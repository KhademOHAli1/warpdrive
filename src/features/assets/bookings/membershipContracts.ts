import { z } from "zod";

const id = z.uuid().toLowerCase();
export const bookingMembershipRole = z.enum(["base", "self_service"]);
export type BookingMembershipRole = z.infer<typeof bookingMembershipRole>;
export const bookingMembershipCommand = z.strictObject({
  siteId: id,
  userId: id,
  role: bookingMembershipRole.nullable(),
  requestId: id,
});
export type BookingMembershipCommand = z.infer<typeof bookingMembershipCommand>;
export type BookingMembership = Omit<BookingMembershipCommand, "requestId" | "role"> & {
  role: BookingMembershipRole;
};

export type BookingMembershipWorkspace = {
  sites: { id: string; code: string; name: string; archived: boolean }[];
  staff: { id: string; name: string; eligible: boolean }[];
  memberships: BookingMembership[];
};

export type BookingMembershipResult =
  | { ok: true; value: BookingMembershipWorkspace }
  | { ok: false; error: "unavailable" | "invalid" | "conflict" | "freshAuth" };
