import { z } from "zod";
import type { LocationDirectory, LocationError } from "./directory";

const id = z.uuid().toLowerCase();
const grantRole = z.enum(["viewer", "manager"]);
const text = z.object({
  name: z
    .string()
    .max(1024)
    .trim()
    .refine((value) => !value.includes("\0")),
  code: z.string().max(1024).trim().toUpperCase(),
}).shape;

export const locationsCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("saveSite"),
    requestId: id,
    id: id.nullable(),
    ...text,
  }),
  z.strictObject({
    type: z.literal("saveLocation"),
    requestId: id,
    id: id.nullable(),
    siteId: id,
    parentId: id.nullable(),
    ...text,
  }),
  z.strictObject({
    type: z.literal("setSiteArchived"),
    requestId: id,
    id,
    archived: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("setLocationArchived"),
    requestId: id,
    id,
    archived: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("setGrant"),
    requestId: id,
    siteId: id,
    userId: id,
    role: grantRole.nullable(),
  }),
]);

export type LocationsCommand = z.infer<typeof locationsCommand>;
type WithoutRequestId<C> = C extends { requestId: string } ? Omit<C, "requestId"> : never;
export type LocationsIntent = WithoutRequestId<LocationsCommand>;
export type LocationSiteRole = z.infer<typeof grantRole>;

export interface LocationSiteGrant {
  siteId: string;
  userId: string;
  role: LocationSiteRole;
}

export interface LocationsWorkspace {
  directory: LocationDirectory;
  canManageSites: boolean;
  managedSiteIds: string[];
  grants: LocationSiteGrant[];
  eligibleUsers: { id: string; name: string; email: string }[];
}

export type LocationsError =
  | LocationError
  | "unavailable"
  | "requestConflict"
  | "invalidCommand"
  | "warehouseStock"
  | "invalidGrant";

export type LocationsResult =
  | {
      ok: true;
      value: LocationsWorkspace;
      siteId?: string | null;
      locationId?: string | null;
    }
  | { ok: false; error: LocationsError };
