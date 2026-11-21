import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { projectIdInput } from "./input";
import { listInternalProjects, readInternalProject } from "./service";

export const internalProjectsRouter = router({
  index: protectedProcedure.query(({ ctx }) =>
    listInternalProjects(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
  workspace: protectedProcedure
    .input(z.strictObject({ projectId: projectIdInput }))
    .query(({ ctx, input }) =>
      readInternalProject(ctx.db, ctx.session, input.projectId, AbortSignal.timeout(10_000)),
    ),
});
