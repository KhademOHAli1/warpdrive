import { randomUUID } from "node:crypto";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  emailAccounts,
  integrationConnections,
  oauthAccessTokens,
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
} from "@/db/schema";
import { encryptToken } from "@/features/email/crypto";
import { sha256Base64Url } from "@/features/oauth/pkce";
import { fixtureIo } from "./integrationPlatformFixturesIo";
import type {
  IntegrationFixtureGrant,
  IntegrationPlatformFixtures,
} from "./integrationPlatformFixturesModels";
import { seedIntegrationFixtureNativeSessions } from "./integrationPlatformFixturesNative";
import { seedIntegrationFixtureRecords } from "./integrationPlatformFixturesRecords";

export async function seedIntegrationPlatformFixtures(
  db: Db,
  namespace: string,
  now: Date,
  signal: AbortSignal,
): Promise<IntegrationPlatformFixtures> {
  const core = await seedIntegrationFixtureRecords(db, namespace, now, signal);
  const sessions = await seedIntegrationFixtureNativeSessions(
    db,
    core.users,
    namespace,
    now,
    signal,
  );
  // These deliberately unusable synthetic values never authorize a real provider account.
  const credentials = encryptToken(
    JSON.stringify({ token: `synthetic-slack-fixture:${namespace}` }),
  );
  const [first, second] = await fixtureIo(
    () =>
      db
        .insert(integrationConnections)
        .values(
          ["01", "02"].map((suffix) => ({
            provider: "slack",
            accountId: `T${namespace.toUpperCase()}${suffix}`,
            accountName: `Synthetic workspace ${suffix}`,
            ownerId: core.users.admin.id,
            credentials,
            scopes: ["chat:write", "channels:read"],
            settings: { channelId: `CLOCAL${suffix}`, channelName: `fixture-${suffix}` },
            connectedAt: now,
            updatedAt: now,
          })),
        )
        .returning({
          id: integrationConnections.id,
          accountId: integrationConnections.accountId,
          ownerId: integrationConnections.ownerId,
          status: integrationConnections.status,
        }),
    signal,
  );
  const [member, outsider] = await fixtureIo(
    () =>
      db
        .insert(emailAccounts)
        .values(
          [core.users.member, core.users.outsider].map((user) => ({
            userId: user.id,
            emailAddress: user.email,
            refreshTokenEnc: encryptToken(`synthetic-gmail-fixture:${namespace}:${user.id}`),
            scopes: [],
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning({
          id: emailAccounts.id,
          userId: emailAccounts.userId,
          emailAddress: emailAccounts.emailAddress,
        }),
    signal,
  );
  if (first === undefined || second === undefined || member === undefined || outsider === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "fixture account rows missing");
  const clientId = `fixture:${namespace}:client`;
  await fixtureIo(
    () =>
      db.insert(oauthClients).values({
        id: clientId,
        name: "Synthetic OAuth client",
        redirectUris: ["https://client.example.test/callback"],
        createdAt: now,
      }),
    signal,
  );
  const grant = async (
    kind: "valid" | "expired" | "revoked" | "inactiveOwner",
    signal: AbortSignal,
  ): Promise<IntegrationFixtureGrant> => {
    const userId = kind === "inactiveOwner" ? core.users.inactive.id : core.users.member.id;
    const expiresAt = new Date(now.getTime() + (kind === "expired" ? -1 : 3_600_000));
    const revokedAt = kind === "revoked" ? new Date(now.getTime() - 60_000) : null;
    const accessJti = randomUUID();
    const refreshToken = `synthetic-fixture:${namespace}:${kind}:refresh`;
    const refreshTokenHash = sha256Base64Url(refreshToken);
    const codeHash = sha256Base64Url(`synthetic-fixture:${namespace}:${kind}:code`);
    await fixtureIo(
      () =>
        db
          .insert(oauthAccessTokens)
          .values({ jti: accessJti, clientId, userId, expiresAt, revokedAt, issuedAt: now }),
      signal,
    );
    await fixtureIo(
      () =>
        db
          .insert(oauthRefreshTokens)
          .values({ tokenHash: refreshTokenHash, clientId, userId, expiresAt, revokedAt }),
      signal,
    );
    await fixtureIo(
      () =>
        db.insert(oauthAuthCodes).values({
          codeHash,
          clientId,
          userId,
          redirectUri: "https://client.example.test/callback",
          codeChallenge: sha256Base64Url("synthetic-fixture-pkce-verifier".repeat(2)),
          expiresAt,
          consumedAt: revokedAt,
        }),
      signal,
    );
    return { clientId, userId, accessJti, refreshToken, refreshTokenHash, codeHash };
  };
  const valid = await grant("valid", signal);
  const expired = await grant("expired", signal);
  const revoked = await grant("revoked", signal);
  const inactiveOwner = await grant("inactiveOwner", signal);
  return {
    ...core,
    namespace,
    now,
    connections: { first, second },
    mailboxes: { member, outsider },
    grants: { valid, expired, revoked, inactiveOwner },
    sessions,
    limits: {
      oauthCapabilities: "not-persisted-in-current-model",
      personalMailboxesSeededPerUser: 1,
      serviceConnections: "shared-admin-managed",
      evidence: "synthetic-real-postgresql-only",
      authentication: "synthetic-native-model-not-browser-enrollment",
    },
  };
}
