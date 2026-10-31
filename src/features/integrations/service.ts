import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import {
  integrationConnections,
  integrationEvents,
  integrationOAuthAttempts,
} from "@/db/schema/integrations";
import { decryptToken, encryptToken } from "@/features/email/crypto";
import { exchangeSlackCode, slackAuthorizeUrl, slackConfiguration, slackRequest } from "./slack";

export const INTEGRATION_STATE_COOKIE = "wd_integration_state";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function requireIntegrationAdmin(db: Db, actorId: string) {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, actorId), eq(users.isActive, true), eq(users.isAdmin, true)))
    .limit(1);
  if (!actor) throw new AppError(ERROR_IDS.INTEGRATION_FORBIDDEN, "integration_forbidden", {});
}

export async function beginSlackConnection(db: Db, userId: string, sessionId: string) {
  await requireIntegrationAdmin(db, userId);
  const config = slackConfiguration();
  if (!config)
    throw new AppError(
      ERROR_IDS.INTEGRATION_NEEDS_CONFIGURATION,
      "integration_needs_configuration",
      {},
    );
  const state = randomBytes(32).toString("base64url");
  await db.insert(integrationOAuthAttempts).values({
    stateHash: digest(state),
    provider: "slack",
    userId,
    sessionId,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return {
    state,
    url: slackAuthorizeUrl(
      config.clientId,
      `${env.BASE_URL}/api/integrations/slack/callback`,
      state,
    ),
  };
}

export async function finishSlackConnection(
  db: Db,
  input: { state: string; cookieState: string; userId: string; sessionId: string; code: string },
) {
  await requireIntegrationAdmin(db, input.userId);
  // Both values must resolve to the same random server-issued attempt. The WHERE consumes it
  // once and binds it to this exact authenticated session, preventing replay and account swapping.
  if (!input.state || digest(input.state) !== digest(input.cookieState))
    throw new AppError(ERROR_IDS.INTEGRATION_STATE_INVALID, "integration_state_invalid", {});
  const [attempt] = await db
    .update(integrationOAuthAttempts)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(integrationOAuthAttempts.stateHash, digest(input.state)),
        eq(integrationOAuthAttempts.provider, "slack"),
        eq(integrationOAuthAttempts.userId, input.userId),
        eq(integrationOAuthAttempts.sessionId, input.sessionId),
        isNull(integrationOAuthAttempts.consumedAt),
        gt(integrationOAuthAttempts.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!attempt)
    throw new AppError(ERROR_IDS.INTEGRATION_STATE_INVALID, "integration_state_invalid", {});
  const config = slackConfiguration();
  if (!config)
    throw new AppError(
      ERROR_IDS.INTEGRATION_NEEDS_CONFIGURATION,
      "integration_needs_configuration",
      {},
    );
  const result = await exchangeSlackCode(
    input.code,
    `${env.BASE_URL}/api/integrations/slack/callback`,
    config,
  );
  const credentials = encryptToken(JSON.stringify({ token: result.token }));
  return db.transaction(async (tx) => {
    // Recheck after the provider round trip: an administrator may have been offboarded meanwhile.
    await requireIntegrationAdmin(tx, input.userId);
    const [connection] = await tx
      .insert(integrationConnections)
      .values({
        provider: "slack",
        accountId: result.team.id,
        accountName: result.team.name,
        ownerId: input.userId,
        credentials,
        scopes: result.scopes,
      })
      .onConflictDoUpdate({
        target: [integrationConnections.provider, integrationConnections.accountId],
        set: {
          credentials,
          status: "connected",
          scopes: result.scopes,
          ownerId: input.userId,
          connectedAt: new Date(),
          lastCheckedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: integrationConnections.id });
    if (!connection)
      throw new AppError(ERROR_IDS.INTEGRATION_SAVE_FAILED, "integration_save_failed", {});
    await tx
      .insert(integrationEvents)
      .values({ connectionId: connection.id, actorId: input.userId, action: "connected" });
    return connection.id;
  });
}

export async function listServiceConnections(db: Db) {
  return db
    .select({
      id: integrationConnections.id,
      provider: integrationConnections.provider,
      accountName: integrationConnections.accountName,
      status: integrationConnections.status,
      settings: integrationConnections.settings,
      connectedAt: integrationConnections.connectedAt,
      lastCheckedAt: integrationConnections.lastCheckedAt,
      ownerName: users.name,
      scopes: integrationConnections.scopes,
    })
    .from(integrationConnections)
    .leftJoin(users, eq(integrationConnections.ownerId, users.id))
    .orderBy(desc(integrationConnections.connectedAt));
}

export async function withSlackConnection<T>(
  db: Db,
  userId: string,
  connectionId: string,
  run: (token: string) => Promise<T>,
  allowPendingRevocation = false,
) {
  await requireIntegrationAdmin(db, userId);
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.provider, "slack"),
        allowPendingRevocation ? undefined : eq(integrationConnections.status, "connected"),
      ),
    )
    .limit(1);
  if (!connection?.credentials)
    throw new AppError(ERROR_IDS.INTEGRATION_NOT_CONNECTED, "integration_not_connected", {});
  const decrypted = decryptToken(connection.credentials);
  if (!decrypted.ok)
    throw new AppError(
      ERROR_IDS.INTEGRATION_CREDENTIALS_UNAVAILABLE,
      "integration_credentials_unavailable",
      {},
    );
  const credentials = z.object({ token: z.string().min(1) }).parse(JSON.parse(decrypted.value));
  return run(credentials.token);
}

export async function disconnectSlack(db: Db, userId: string, connectionId: string) {
  const token = await withSlackConnection(
    db,
    userId,
    connectionId,
    (value) => Promise.resolve(value),
    true,
  );
  // Block every ordinary credential consumer before contacting Slack. A provider outage must
  // never leave a disconnected app usable locally. Retain only encrypted material for a retry.
  await db
    .update(integrationConnections)
    .set({ status: "revocation-pending", updatedAt: new Date() })
    .where(eq(integrationConnections.id, connectionId));
  try {
    await slackRequest("auth.revoke", token);
  } catch {
    return false;
  }
  await db.transaction(async (tx) => {
    await requireIntegrationAdmin(tx, userId);
    await tx
      .update(integrationConnections)
      .set({ status: "disconnected", credentials: null, updatedAt: new Date() })
      .where(eq(integrationConnections.id, connectionId));
    await tx
      .insert(integrationEvents)
      .values({ connectionId, actorId: userId, action: "disconnected" });
  });
  return true;
}
