import { protectedProcedure, router } from "@/server/trpc/trpc";
import { readOperationsScope } from "./scope";
import { readOperationsAccessWorkspace } from "./service";

export const operationsAccessRouter = router({
  workspace: protectedProcedure.query(({ ctx }) =>
    readOperationsAccessWorkspace(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
  scope: protectedProcedure.query(({ ctx }) =>
    readOperationsScope(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
});
