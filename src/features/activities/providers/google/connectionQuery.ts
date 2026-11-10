import { TRPCError } from "@trpc/server";
import { env } from "@/config/env";
import { ERROR_IDS } from "@/constants/errorIds";
import { protectedProcedure } from "@/server/trpc/trpc";
import { listCalendarProviderAccounts } from "./accounts";
import { calendarDeploymentConfig } from "./authorizationDeployment";
import { withCalendarDomainActor } from "./calendarDomainAuthority";

export const googleCalendarAccountsQuery = protectedProcedure.query(async ({ ctx }) => {
  const signal = AbortSignal.timeout(10_000);
  const result = await withCalendarDomainActor(
    ctx.db,
    ctx.session,
    signal,
    (db) => listCalendarProviderAccounts(db, ctx.actor.id, signal),
    { kind: "unauthorized" } as const,
  );
  if (!result.ok)
    throw new TRPCError({ code: "UNAUTHORIZED", message: ERROR_IDS.AUTH_SESSION_DEAD });
  return { configured: calendarDeploymentConfig(env) !== null, accounts: result.value };
});
