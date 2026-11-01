import { z } from "zod";
import type { NextActionQueueInput } from "./queueTypes";

export const NEXT_ACTION_QUEUE_DEFAULT_LIMIT = 25;
export const NEXT_ACTION_QUEUE_MAX_LIMIT = 100;
export const NEXT_ACTION_QUEUE_MAX_OFFSET = 1_000_000;

// Clock, account zone and actor are server-owned, not alternate request filters.
export const queueInputSchema = z.strictObject({
  scope: z.enum(["mine", "all-permitted"]).default("mine"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(NEXT_ACTION_QUEUE_MAX_LIMIT)
    .default(NEXT_ACTION_QUEUE_DEFAULT_LIMIT),
  offset: z.number().int().min(0).max(NEXT_ACTION_QUEUE_MAX_OFFSET).default(0),
}) satisfies z.ZodType<NextActionQueueInput>;
