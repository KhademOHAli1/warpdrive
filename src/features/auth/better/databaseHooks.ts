import type { BetterAuthOptions } from "better-auth";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authUsers, users } from "@/db/schema";
import { claimInvitedIdentity } from "./admission";
import { hookBody } from "./hookBody";
import { recordNativeProviderLink } from "./securityChanges";

export function authDatabaseHooks(db: Db): NonNullable<BetterAuthOptions["databaseHooks"]> {
  return {
    user: {
      create: {
        before: (user, ctx) => claimInvitedIdentity(db, user, ctx),
        after: async (user) => {
          await db.update(users).set({ invitedAt: null }).where(eq(users.id, user.id));
        },
      },
      update: {
        after: async (user, ctx) => {
          // Native factor/email updates include the full identity, including an old name.
          // Only an explicit profile update may replace the CRM's display name.
          const nameChanged =
            ctx?.path === "/update-user" && typeof hookBody(ctx.body).name === "string";
          if (user.emailVerified)
            await db
              .update(users)
              .set({ email: user.email, ...(nameChanged ? { name: user.name } : {}) })
              .where(eq(users.id, user.id));
        },
      },
    },
    account: {
      create: {
        before: (account) => Promise.resolve({ data: { ...account, idToken: null } }),
        after: (account, ctx) => recordNativeProviderLink(db, account, ctx?.request),
      },
      update: {
        before: (account) =>
          Promise.resolve({
            data: { ...account, ...(typeof account.idToken === "string" ? { idToken: null } : {}) },
          }),
      },
    },
    session: {
      create: {
        before: async (session, ctx) => {
          const [user] = await db
            .select({ active: users.isActive, verified: authUsers.emailVerified })
            .from(users)
            .innerJoin(authUsers, eq(authUsers.id, users.id))
            .where(eq(users.id, session.userId))
            .limit(1);
          if (user === undefined || !user.active || !user.verified) return false;
          const path = ctx?.path ?? "";
          const login =
            path.startsWith("/sign-in/") ||
            path.includes("/callback/") ||
            path.startsWith("/two-factor/verify-") ||
            path === "/passkey/verify-authentication";
          const previous = ctx?.context.session?.session as Record<string, unknown> | undefined;
          const body = hookBody(ctx?.body);
          const provider =
            typeof body.provider === "string"
              ? body.provider
              : (path.split("/").at(-1) ?? "password");
          return {
            data: {
              ...session,
              authMethod: path === "/sign-in/email" ? "password" : provider,
              assurance:
                !login && typeof previous?.assurance === "string" ? previous.assurance : "pending",
              freshAuthenticatedAt:
                !login && previous?.freshAuthenticatedAt instanceof Date
                  ? previous.freshAuthenticatedAt
                  : new Date(),
              lastSeenAt: new Date(),
            },
          };
        },
      },
    },
  };
}
