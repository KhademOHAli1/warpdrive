import { z } from "zod";
import { legalEntityDataSchema } from "../contracts";
export const candidateSchema = z.strictObject({
  lei: z.string().regex(/^[A-Z0-9]{20}$/),
  data: legalEntityDataSchema,
  checkedAt: z.iso.datetime(),
  sourceUrl: z.url(),
});
export const signedCandidateSchema = candidateSchema.extend({ token: z.string().max(30000) });
export const candidatesSchema = z.array(signedCandidateSchema).max(8);
export const vatResultSchema = z.strictObject({
  country: z.string(),
  vatNumber: z.string(),
  valid: z.boolean(),
  name: z.string(),
  address: z.string(),
  checkedAt: z.iso.datetime(),
  requestDate: z.string(),
});
export const lookupCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("search"),
    query: z.string().trim().min(2).max(160),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .or(z.literal("")),
  }),
  z.strictObject({
    action: z.literal("check_vat"),
    country: z.string().regex(/^[A-Z]{2}$/),
    vatNumber: z.string().trim().min(2).max(20),
  }),
  z.strictObject({ action: z.literal("apply"), requestId: z.uuid(), token: z.string().max(30000) }),
]);
export type Candidate = z.infer<typeof candidateSchema>;
export type SignedCandidate = z.infer<typeof signedCandidateSchema>;
export type VatResult = z.infer<typeof vatResultSchema>;
