import { z } from "zod";
import type { ProjectCommand, ProjectSnapshot } from "./projectLifecycle";

const unarchivedState = z.enum(["planned", "active", "on-hold", "completed", "canceled"]);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reason = z
  .string()
  .trim()
  .max(2000)
  .refine((value) =>
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code !== 127 && (code >= 32 || code === 9 || code === 10 || code === 13);
    }),
  );

// Ingress only. The pure transition policy consumes already validated snapshots and commands.
export const projectSnapshotSchema = z.union([
  z.strictObject({ state: unarchivedState, revision, archivedFrom: z.null() }),
  z.strictObject({ state: z.literal("archived"), revision, archivedFrom: unarchivedState }),
]) satisfies z.ZodType<ProjectSnapshot>;

export const projectCommandSchema = z.strictObject({
  action: z.enum(["start", "hold", "resume", "complete", "cancel", "archive", "restore", "reopen"]),
  expectedRevision: revision,
  reason: reason.optional(),
}) satisfies z.ZodType<ProjectCommand>;
