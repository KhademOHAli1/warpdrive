import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { projectAutomationRouter } from "./automations/router";
import { projectIdInput } from "./input";
import { projectIntakeRouter } from "./intake/router";
import { projectPlanningRouter } from "./planning/router";
import { projectProfileRouter } from "./profile/router";
import { listInternalProjects, readInternalProject } from "./service";

export const internalProjectsRouter = router({
  automation: projectAutomationRouter,
  intake: projectIntakeRouter,
  planning: projectPlanningRouter,
  profile: projectProfileRouter,
  index: protectedProcedure.query(({ ctx }) =>
    listInternalProjects(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
  workspace: protectedProcedure
    .input(z.strictObject({ projectId: projectIdInput }))
    .query(({ ctx, input }) =>
      readInternalProject(ctx.db, ctx.session, input.projectId, AbortSignal.timeout(10_000)),
    ),
});
