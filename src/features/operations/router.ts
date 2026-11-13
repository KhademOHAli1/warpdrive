import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import {
  readOperationsCurrent,
  readOperationsEvents,
  readOperationsIncidents,
  readOperationsSources,
  withOperationsAdminRead,
} from "./reads";

const id = z.uuid().regex(/^[0-9a-f-]+$/);
const historyCursor = z.strictObject({ at: z.iso.datetime(), id });
const currentCursor = z.strictObject({
  sourceId: id,
  observationKey: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9_.:-]+$/),
});

// Read-only installation administration. There is deliberately no enrollment,
// ingestion, deployment or runtime-control endpoint in this router.
export const operationsRouter = router({
  observations: protectedProcedure
    .input(z.strictObject({ cursor: currentCursor.optional() }))
    .query(({ ctx, input, signal }) =>
      withOperationsAdminRead(ctx, signal, (tx, installationId, bounded) =>
        readOperationsCurrent(tx, installationId, bounded, input.cursor),
      ),
    ),
  sources: protectedProcedure
    .input(z.strictObject({ cursor: id.optional() }))
    .query(({ ctx, input, signal }) =>
      withOperationsAdminRead(ctx, signal, (tx, installationId, bounded) =>
        readOperationsSources(tx, installationId, bounded, input.cursor),
      ),
    ),
  incidents: protectedProcedure
    .input(
      z.strictObject({ cursor: historyCursor.optional(), openOnly: z.boolean().default(true) }),
    )
    .query(({ ctx, input, signal }) =>
      withOperationsAdminRead(ctx, signal, (tx, installationId, bounded) =>
        readOperationsIncidents(tx, installationId, bounded, input.openOnly, input.cursor),
      ),
    ),
  bell: protectedProcedure.query(({ ctx, signal }) =>
    withOperationsAdminRead(ctx, signal, async (tx, installationId, bounded) => {
      const { items } = await readOperationsIncidents(
        tx,
        installationId,
        bounded,
        true,
        undefined,
        1,
      );
      return { hasOpenIncidents: items.length > 0 };
    }),
  ),
  events: protectedProcedure
    .input(z.strictObject({ cursor: historyCursor.optional() }))
    .query(({ ctx, input, signal }) =>
      withOperationsAdminRead(ctx, signal, (tx, installationId, bounded) =>
        readOperationsEvents(tx, installationId, bounded, input.cursor),
      ),
    ),
});
