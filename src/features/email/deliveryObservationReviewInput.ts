import { z } from "zod";
import { DELIVERY_REPORT_LIMITS } from "./deliveryReportTypes";
import { isValidMailRecipient } from "./recipientAddress";

const base = {
  reportId: z.guid(),
  recipientIndex: z
    .number()
    .int()
    .min(0)
    .max(DELIVERY_REPORT_LIMITS.recipientBlocks - 1),
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
  confirmUnverified: z.literal(true),
};

export const deliveryObservationReviewInput = z.discriminatedUnion("decision", [
  z.strictObject({
    ...base,
    decision: z.literal("associate"),
    target: z.strictObject({
      attemptId: z.guid(),
      recipient: z.string().max(254).refine(isValidMailRecipient),
    }),
  }),
  z.strictObject({ ...base, decision: z.literal("dismiss") }),
]);
