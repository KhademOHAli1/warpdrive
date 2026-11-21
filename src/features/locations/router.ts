import { protectedProcedure, router } from "@/server/trpc/trpc";
import { readLocationsDirectory } from "./service";

export const locationsRouter = router({
  directory: protectedProcedure.query(({ ctx }) =>
    readLocationsDirectory(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
});
