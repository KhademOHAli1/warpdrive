import { z } from "zod";
import { canonicalUuidSchema, revisionSchema } from "../valueSchemas";

// Ingress only. Repositories consume this trusted shape; optional reasons are not admitted yet.
export const projectStartInputSchema = z.strictObject({
  projectId: canonicalUuidSchema,
  intentId: canonicalUuidSchema,
  expectedRevision: revisionSchema,
});

export type ProjectStartInput = Readonly<z.infer<typeof projectStartInputSchema>>;
