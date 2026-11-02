import { z } from "zod";
import { privacyCaseStatusSchema } from "./states";

const subjectSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("external"), description: z.string().trim().min(1).max(1000) })
    .strict(),
  z
    .object({
      kind: z.enum(["contact", "user"]),
      referenceId: z.uuid(),
      description: z.string().trim().max(1000).optional(),
    })
    .strict(),
]);
const recipientSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("email"), address: z.email().max(320) }).strict(),
  z.object({ channel: z.literal("in_app"), userId: z.uuid() }).strict(),
  z
    .object({
      channel: z.literal("operator_assisted"),
      description: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export const privacyIntakeSchema = z
  .object({
    intakeKey: z.uuid(),
    kind: z.enum([
      "access",
      "portability",
      "correction",
      "restriction",
      "objection",
      "closure",
      "erasure",
    ]),
    locale: z.enum(["fa", "de", "en"]),
    subject: subjectSchema,
    recipient: recipientSchema,
    summary: z.string().trim().min(1).max(4000),
  })
  .strict();

export const privacyTransitionSchema = z
  .object({
    caseId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    commandId: z.uuid(),
    toStatus: privacyCaseStatusSchema,
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
