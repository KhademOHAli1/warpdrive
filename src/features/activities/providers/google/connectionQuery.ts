import { TRPCError } from "@trpc/server";
import { env } from "@/config/env";
import { ERROR_IDS } from "@/constants/errorIds";
import { protectedProcedure } from "@/server/trpc/trpc";
import { listCalendarProviderAccounts } from "./accounts";
import { calendarDeploymentConfig } from "./authorizationDeployment";

export const googleCalendarAccountsQuery = protectedProcedure.query(async ({ ctx }) => {
  const result = await listCalendarProviderAccounts(
    ctx.db,
    ctx.actor.id,
    AbortSignal.timeout(10_000),
  );
  if (!result.ok)
    throw new TRPCError({ code: "UNAUTHORIZED", message: ERROR_IDS.AUTH_SESSION_DEAD });
  return { configured: calendarDeploymentConfig(env) !== null, accounts: result.value };
});
