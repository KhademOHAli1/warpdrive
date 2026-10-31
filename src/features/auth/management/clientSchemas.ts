import { z } from "zod";

const identifier = z.string();
const date = z.string();
const policy = z.object({
  requireMfaForAll: z.boolean(),
  idleMinutes: z.number(),
  absoluteHours: z.number(),
  freshMinutes: z.number(),
});
export const managementSnapshotInput = z.object({
  viewerIsAdmin: z.boolean(),
  total: z.number(),
  page: z.number(),
  pageCount: z.number(),
  policy,
  users: z.array(
    z.object({
      id: identifier,
      name: z.string(),
      email: z.string(),
      isAdmin: z.boolean(),
      isActive: z.boolean(),
      invitedAt: date.nullable(),
      permissionSetId: identifier.nullable(),
      activeSessions: z.number(),
      invitation: z
        .object({
          id: identifier,
          state: z.enum(["pending", "accepted", "revoked", "expired"]),
          expiresAt: date,
          delivery: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  assignees: z.array(z.object({ id: identifier, name: z.string() })).default([]),
  permissionSets: z.array(z.object({ id: identifier, name: z.string() })),
  deliveries: z.array(
    z.object({
      id: identifier,
      recipient: z.string(),
      kind: z.string(),
      status: z.string(),
      attempts: z.number(),
      createdAt: date,
      lastErrorCode: z.string().nullable(),
    }),
  ),
  auditPage: z.number().default(1),
  auditPageCount: z.number().default(1),
  auditTotal: z.number().default(0),
  audit: z.array(
    z.object({
      id: identifier,
      actorId: identifier.nullable(),
      actorName: z.string().nullable().default(null),
      targetUserId: identifier.nullable(),
      targetName: z.string().nullable().default(null),
      action: z.string(),
      outcome: z.string(),
      createdAt: date,
    }),
  ),
  requests: z.array(
    z.object({
      id: identifier,
      userId: identifier,
      name: z.string(),
      email: z.string(),
      kind: z.string(),
      status: z.string(),
      createdAt: date,
      reason: z.string().nullable(),
    }),
  ),
  integrationRevocations: z.array(
    z.object({
      id: identifier,
      userId: identifier,
      provider: z.string(),
      status: z.string(),
      attempts: z.number(),
      createdAt: date,
    }),
  ),
});
export const managementReadResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: managementSnapshotInput }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export const managementWriteResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export const managementBulkResponse = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.object({
      results: z.array(
        z.object({ userId: identifier, ok: z.boolean(), error: z.string().optional() }),
      ),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export const managedUserDetailsInput = z.object({
  userId: z.string(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  passkeyCount: z.number(),
  providers: z.array(z.string()),
  sessions: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      lastSeenAt: z.string(),
      expiresAt: z.string(),
      userAgent: z.string().nullable(),
    }),
  ),
});
export const managedUserDetailsResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: managedUserDetailsInput }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
