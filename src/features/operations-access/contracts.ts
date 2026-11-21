import { z } from "zod";

export const operationsRoles = [
  "warehouse_viewer",
  "warehouse_manager",
  "asset_viewer",
  "asset_manager",
  "buyer",
  "cost_viewer",
] as const;
export type OperationsRole = (typeof operationsRoles)[number];

const id = z.uuid().toLowerCase();
export const operationsAccessCommand = z.strictObject({
  requestId: id,
  siteId: id,
  userId: id,
  role: z.enum(operationsRoles),
  enabled: z.boolean(),
});
export type OperationsAccessCommand = z.infer<typeof operationsAccessCommand>;

export type OperationsGrant = Pick<OperationsAccessCommand, "siteId" | "userId" | "role">;

export type OperationsAccessWorkspace = {
  sites: { id: string; code: string; name: string; archived: boolean }[];
  staff: { id: string; name: string; email: string; eligible: boolean }[];
  grants: OperationsGrant[];
};

export type OperationsAccessError = "unavailable" | "invalid" | "conflict" | "freshAuth";
export type OperationsAccessResult =
  | { ok: true; value: OperationsAccessWorkspace }
  | { ok: false; error: OperationsAccessError };
