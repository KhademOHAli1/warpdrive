import { z } from "zod";

const MAX_LEDGER_REVISION = 2_147_483_647;
const reviewDecisionSchema = z.enum(["keep_private", "dismiss", "restore_private"]);

export const privateIntakeReadInputSchema = z.strictObject({
  accountId: z.guid(),
  intakeId: z.guid(),
});

export const privateIntakeReviewInputSchema = privateIntakeReadInputSchema.extend({
  expectedRevision: z
    .number()
    .int()
    .min(0)
    .max(MAX_LEDGER_REVISION - 1),
  decision: reviewDecisionSchema,
});

export const privateIntakeSummarySchema = z.strictObject({
  id: z.guid(),
  revision: z.number().int().min(0).max(MAX_LEDGER_REVISION),
  state: z.enum(["unverified", "confirmed_notification", "conflict"]),
  contentState: z.enum(["retained", "purged"]),
  decision: reviewDecisionSchema.nullable(),
});
