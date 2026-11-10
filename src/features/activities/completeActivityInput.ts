import { z } from "zod";

export const completeActivityInput = z.strictObject({
  id: z.string().uuid(),
  done: z.boolean(),
  expectedVersion: z.number().int().positive().optional(),
});

export type CompleteActivityInput = z.input<typeof completeActivityInput>;
