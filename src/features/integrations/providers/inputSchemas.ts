import { z } from "zod";
import { credentialReferenceSchema, httpUrlSchema } from "./models";

const credentialInput = z.strictObject({ credential: credentialReferenceSchema });

export const providerInputSchemas = {
  authorize: z.strictObject({
    attemptId: z.uuid(),
    state: z.string().min(1).max(4096),
    redirectUri: httpUrlSchema,
    requestedScopes: z.array(z.string().min(1).max(256)).max(500).optional(),
  }),
  exchange: z.strictObject({
    attemptId: z.uuid(),
    code: z.string().min(1).max(16_384),
    redirectUri: httpUrlSchema,
    codeVerifier: z.string().min(43).max(128).optional(),
  }),
  refresh: credentialInput,
  listResources: z.strictObject({
    credential: credentialReferenceSchema,
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  check: credentialInput,
  disconnect: credentialInput,
  discoverCapabilities: z.strictObject({ credential: credentialReferenceSchema.optional() }),
};
