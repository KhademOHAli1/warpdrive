import { z } from "zod";

export const completeActivityInput = z.strictObject({
  id: z.string().uuid(),
  done: z.boolean(),
});

export type CompleteActivityInput = z.input<typeof completeActivityInput>;
