import { z } from "zod";
import { type AssetsWorkspace, assetTrackingMethods } from "../contracts";
import {
  type AssetRegisterSettings,
  assetRegisterColumns,
  assetRegisterSortableColumns,
  maxAssetRegisterSortColumns,
  maxAssetRegisterViewName,
} from "./contracts";

const id = z.uuid().refine((value) => value === value.toLowerCase());
const version = z.number().int().positive();
const directions = z.enum(["asc", "desc"]);

export const maxAssetRegisterSearchLength = 200;

const filtersSchema = z
  .strictObject({
    site: id,
    search: z
      .string()
      .max(maxAssetRegisterSearchLength)
      .refine((value) => !value.includes("\0")),
    category: z.union([z.literal(""), id]),
    tracking: z.union([z.literal(""), z.enum(assetTrackingMethods)]),
    status: z.enum(["active", "archived"]),
    location: z.union([z.literal(""), z.literal("unassigned"), id]),
    includeSublocations: z.boolean(),
  })
  .refine(
    ({ location, includeSublocations }) =>
      !includeSublocations || (location !== "" && location !== "unassigned"),
  );

export const assetRegisterSettingsSchema = z.strictObject({
  filters: filtersSchema,
  columns: z
    .array(z.enum(assetRegisterColumns))
    .min(1)
    .max(assetRegisterColumns.length)
    .refine((columns) => columns[0] === "name" && new Set(columns).size === columns.length),
  sort: z
    .array(z.strictObject({ column: z.enum(assetRegisterSortableColumns), direction: directions }))
    .max(maxAssetRegisterSortColumns)
    .refine((sort) => new Set(sort.map(({ column }) => column)).size === sort.length),
});

export const assetRegisterViewSaveSchema = z
  .strictObject({
    id: id.nullable(),
    version: version.nullable(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(maxAssetRegisterViewName)
      .refine((value) => !/[\0\r\n]/.test(value)),
    settings: assetRegisterSettingsSchema,
    requestId: id,
  })
  .refine(({ id, version }) => (id === null) === (version === null));

export const assetRegisterViewRemoveSchema = z.strictObject({ id, version, requestId: id });

type RegisterScope = Pick<AssetsWorkspace, "sites" | "categories" | "locations">;

export function assetRegisterSettingsAvailable(
  workspace: RegisterScope,
  settings: AssetRegisterSettings,
) {
  const parsed = assetRegisterSettingsSchema.safeParse(settings);
  if (!parsed.success) return false;
  const { site, location, category } = parsed.data.filters;
  return (
    workspace.sites.some(({ id }) => id === site) &&
    (category === "" ||
      workspace.categories.some(({ id, siteId }) => id === category && siteId === site)) &&
    (location === "" ||
      location === "unassigned" ||
      workspace.locations.some(({ id, siteId }) => id === location && siteId === site))
  );
}
