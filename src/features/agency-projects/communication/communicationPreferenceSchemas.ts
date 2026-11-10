import { z } from "zod";
import { canonicalUuidSchema, referenceSchema } from "../valueSchemas";
import { communicationChannelSchema, plainTextSchema } from "./communicationValueSchemas";

const cadence = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["unspecified", "none"]) }),
  z.strictObject({ kind: z.literal("declared"), text: plainTextSchema(1000, true) }),
]);

export const communicationPreferenceRequestSchema = z.strictObject({
  mutationIntentId: canonicalUuidSchema,
  preference: z.strictObject({
    projectId: canonicalUuidSchema,
    personId: canonicalUuidSchema,
    role: plainTextSchema(160, false),
    channel: communicationChannelSchema,
    cadence,
    conversationReference: referenceSchema.optional(),
  }),
});

export type CommunicationPreferenceRequest = z.infer<typeof communicationPreferenceRequestSchema>;
