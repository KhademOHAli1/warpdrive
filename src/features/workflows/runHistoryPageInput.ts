import { z } from "zod";
import { historyModeFilters, historyStatusFilters } from "./runHistoryTypes";

export const MAX_RUN_HISTORY_CURSOR_LENGTH = 4096;

export const runHistoryPageInputSchema = z.strictObject({
  id: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  status: z.enum(historyStatusFilters).default("all"),
  mode: z.enum(historyModeFilters).default("all"),
  // Only the bounded outer shape is checked before authorization. The private
  // cursor envelope and its query context are interpreted after current access.
  cursor: z.string().min(1).max(MAX_RUN_HISTORY_CURSOR_LENGTH).optional(),
});

export type RunHistoryPageInput = z.input<typeof runHistoryPageInputSchema>;
export type NormalizedRunHistoryPageInput = z.output<typeof runHistoryPageInputSchema>;
