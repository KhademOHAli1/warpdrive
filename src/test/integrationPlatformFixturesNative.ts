import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { authUsers, sessions } from "@/db/schema";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { sha256Base64Url } from "@/features/oauth/pkce";
import { fixtureIo } from "./integrationPlatformFixturesIo";
import type {
  IntegrationFixtureCore,
  IntegrationPlatformFixtures,
} from "./integrationPlatformFixturesModels";

export async function seedIntegrationFixtureNativeSessions(
  db: Db,
  actors: IntegrationFixtureCore["users"],
  namespace: string,
  now: Date,
  signal: AbortSignal,
): Promise<IntegrationPlatformFixtures["sessions"]> {
  await fixtureIo(
    () =>
      db.insert(authUsers).values(
        Object.values(actors).map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    signal,
  );
  // These rows exercise native session policy only. They do not simulate completed MFA enrollment.
  const memberToken = sha256Base64Url(`synthetic-native-session:${namespace}:member`);
  const adminToken = sha256Base64Url(`synthetic-native-session:${namespace}:admin`);
  const [member, adminPending] = await fixtureIo(
    () =>
      db
        .insert(sessions)
        .values([
          {
            userId: actors.member.id,
            tokenHash: hashSessionCredential(memberToken),
            expiresAt: new Date(now.getTime() + 3_600_000),
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
            freshAuthenticatedAt: now,
            authMethod: "password",
            assurance: "password",
          },
          {
            userId: actors.admin.id,
            tokenHash: hashSessionCredential(adminToken),
            expiresAt: new Date(now.getTime() + 3_600_000),
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
            freshAuthenticatedAt: now,
            authMethod: "password",
            assurance: "password",
          },
        ])
        .returning({ id: sessions.id }),
    signal,
  );
  if (member === undefined || adminPending === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "fixture native session rows missing");
  return {
    member: { id: member.id, token: memberToken },
    adminPending: { id: adminPending.id, token: adminToken },
  };
}
