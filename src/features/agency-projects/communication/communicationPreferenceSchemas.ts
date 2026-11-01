import { z } from "zod";
import { canonicalUuidSchema, referenceSchema } from "../valueSchemas";

function plainText(limit: number, multiline: boolean) {
  return z
    .string()
    .min(1)
    .max(limit)
    .refine((value) => value.replace(/\p{Cf}/gu, "").trim().length > 0)
    .refine((value) => {
      const checked = multiline
        ? value.replaceAll("\t", "").replaceAll("\r", "").replaceAll("\n", "")
        : value;
      return !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(checked);
    });
}

const channel = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["email", "phone", "whatsapp", "meeting"]) }),
  z.strictObject({ kind: z.literal("other"), label: plainText(80, false) }),
]);
const cadence = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["unspecified", "none"]) }),
  z.strictObject({ kind: z.literal("declared"), text: plainText(1000, true) }),
]);

export const communicationPreferenceRequestSchema = z.strictObject({
  mutationIntentId: canonicalUuidSchema,
  preference: z.strictObject({
    projectId: canonicalUuidSchema,
    personId: canonicalUuidSchema,
    role: plainText(160, false),
    channel,
    cadence,
    conversationReference: referenceSchema.optional(),
  }),
});

export type CommunicationPreferenceRequest = z.infer<typeof communicationPreferenceRequestSchema>;
