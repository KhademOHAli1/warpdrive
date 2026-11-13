import { env } from "@/config/env";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { computeStatus } from "./computeStatus";
import { readReleaseStatus } from "./releaseStatus";
import { resolveCurrentWebVersion } from "./webVersion";

// Pure read of the cached release row. The cron job (worker) is what refreshes it; this never
// fetches GitHub itself. The banner is admin-gated at the app-shell mount, so only admins issue it.
export const versionRouter = router({
  get: protectedProcedure.query(async ({ ctx, signal }) => {
    const current = await resolveCurrentWebVersion(ctx.readWebIdentity, signal);
    const row = await readReleaseStatus(ctx.db);
    return computeStatus(current, row, env.DISABLE_UPDATE_CHECK);
  }),
});
