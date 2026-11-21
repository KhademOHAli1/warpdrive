import { z } from "zod";
import { protectedProjectProcedure, router } from "@/server/trpc/trpc";
import { projectAutomationRouter } from "./automations/router";
import { projectGuestRouter } from "./guests/router";
import { projectIdInput } from "./input";
import { projectIntakeRouter } from "./intake/router";
import { projectIntegratorRouter } from "./integrator/router";
import { projectPlanningRouter } from "./planning/router";
import { projectProfileRouter } from "./profile/router";
import { projectPublicationRouter } from "./publication/router";
import { listInternalProjects, readInternalProject } from "./service";

export const internalProjectsRouter = router({
  automation: projectAutomationRouter,
  guests: projectGuestRouter,
  integrator: projectIntegratorRouter,
  intake: projectIntakeRouter,
  planning: projectPlanningRouter,
  profile: projectProfileRouter,
  publication: projectPublicationRouter,
  index: protectedProjectProcedure.query(({ ctx }) =>
    listInternalProjects(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
  workspace: protectedProjectProcedure
    .input(z.strictObject({ projectId: projectIdInput }))
    .query(({ ctx, input }) =>
      readInternalProject(ctx.db, ctx.session, input.projectId, AbortSignal.timeout(10_000)),
    ),
});
