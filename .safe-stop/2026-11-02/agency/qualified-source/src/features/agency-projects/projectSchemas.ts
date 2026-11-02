import { z } from "zod";
import type { ProjectCommand, ProjectSnapshot } from "./projectLifecycle";
import { reasonSchema, revisionSchema } from "./valueSchemas";

const unarchivedState = z.enum(["planned", "active", "on-hold", "completed", "canceled"]);
const revision = revisionSchema;

// Ingress only. The pure transition policy consumes already validated snapshots and commands.
export const projectSnapshotSchema = z.union([
  z.strictObject({ state: unarchivedState, revision, archivedFrom: z.null() }),
  z.strictObject({ state: z.literal("archived"), revision, archivedFrom: unarchivedState }),
]) satisfies z.ZodType<ProjectSnapshot>;

export const projectCommandSchema = z.strictObject({
  action: z.enum(["start", "hold", "resume", "complete", "cancel", "archive", "restore", "reopen"]),
  expectedRevision: revision,
  reason: reasonSchema.optional(),
}) satisfies z.ZodType<ProjectCommand>;
