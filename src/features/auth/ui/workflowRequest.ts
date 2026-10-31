import { z } from "zod";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { AuthProviders, SecurityStatus, WorkflowResponse } from "../better/contracts";

export const providersSchema: z.ZodType<AuthProviders> = z.object({
  providers: z.array(z.object({ id: z.string(), name: z.string() })),
  emailPassword: z.boolean(),
  passkeys: z.boolean(),
});
export const statusSchema: z.ZodType<SecurityStatus> = z.object({
  authenticated: z.literal(true),
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), isAdmin: z.boolean() }),
  emailVerified: z.boolean(),
  hasPassword: z.boolean(),
  twoFactorEnabled: z.boolean(),
  needsMfa: z.boolean(),
  needsEnrollment: z.boolean(),
  fresh: z.boolean(),
  authMethod: z.string(),
  policy: z.object({
    requireMfaForAll: z.boolean(),
    idleMinutes: z.number(),
    absoluteHours: z.number(),
    freshMinutes: z.number(),
  }),
  accounts: z.array(z.object({ id: z.string(), providerId: z.string(), accountId: z.string() })),
  passkeys: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      createdAt: z.string(),
      deviceType: z.string(),
      backedUp: z.boolean(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      current: z.boolean(),
      createdAt: z.string(),
      lastSeenAt: z.string(),
      expiresAt: z.string(),
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
    }),
  ),
  recoveryCodesAvailable: z.boolean(),
  audit: z.array(
    z.object({ id: z.string(), action: z.string(), outcome: z.string(), createdAt: z.string() }),
  ),
});
export const invitationSchema = z.object({
  email: z.string(),
  name: z.string(),
  expiresAt: z.string(),
});
export const mutationSchema = z.unknown();

export async function workflowRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  body?: unknown,
): Promise<WorkflowResponse<T>> {
  const response = await fetch(`/api/auth-workflows/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": readCsrfToken() ?? "" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = z
    .discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), data: schema }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ])
    .safeParse(await response.json());
  if (!parsed.success)
    return { ok: false, error: response.status === 401 ? "SESSION_EXPIRED" : "INVALID_RESPONSE" };
  return parsed.data;
}

export async function workflowAction(body: unknown, signal: AbortSignal) {
  const result = await workflowRequest("security", mutationSchema, signal, body);
  return result.ok ? { data: result.data } : { error: result.error };
}
