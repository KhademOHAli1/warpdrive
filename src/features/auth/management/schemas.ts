import { z } from "zod";
import { authPolicyInput } from "./domain";

const id = z.string().uuid();
export const managementQueryInput = z.strictObject({
  q: z.string().max(120).default(""),
  status: z.enum(["all", "active", "pending", "inactive"]).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  auditQ: z.string().max(120).default(""),
  auditOutcome: z.enum(["all", "success", "denied", "failure"]).default("all"),
  auditPage: z.coerce.number().int().min(1).max(100000).default(1),
});
export const managementActionInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("invite"),
    email: z.email().max(254),
    name: z.string().trim().min(1).max(120),
    isAdmin: z.boolean(),
    locale: z.enum(["en", "fa", "de"]),
  }),
  z.strictObject({ action: z.literal("resendInvitation"), id }),
  z.strictObject({ action: z.literal("revokeInvitation"), id }),
  z.strictObject({ action: z.literal("setActive"), userId: id, isActive: z.boolean() }),
  z.strictObject({ action: z.literal("setAdmin"), userId: id, isAdmin: z.boolean() }),
  z.strictObject({ action: z.literal("setPermissionSet"), userId: id, setId: id }),
  z.strictObject({ action: z.literal("revokeAccess"), userId: id }),
  z.strictObject({ action: z.literal("revokeManagedSession"), userId: id, sessionId: id }),
  z.strictObject({ action: z.literal("transferOwnership"), fromUserId: id, toUserId: id }),
  z.strictObject({
    action: z.literal("reviewRecovery"),
    id,
    status: z.enum(["approved", "rejected", "resolved"]),
  }),
  z.strictObject({ action: z.literal("updatePolicy"), policy: authPolicyInput }),
  z.strictObject({ action: z.literal("retryDelivery"), id }),
  z.strictObject({
    action: z.literal("bulkActive"),
    userIds: z.array(id).min(1).max(25),
    isActive: z.boolean(),
  }),
]);
export type ManagementAction = z.infer<typeof managementActionInput>;
