import { z } from "zod";
import {
  credentialCandidateSchema,
  httpUrlSchema,
  providerOperationNames,
  providerResourceKinds,
  upstreamScopesSchema,
} from "./models";

export const providerOutputSchemas = {
  authorize: z.strictObject({ authorizationUrl: httpUrlSchema }),
  exchange: z.strictObject({
    account: z.strictObject({
      id: z.string().min(1).max(2048),
      displayName: z.string().min(1).max(1024),
    }),
    credentialCandidate: credentialCandidateSchema,
  }),
  refresh: z.strictObject({ credentialCandidate: credentialCandidateSchema }),
  listResources: z.strictObject({
    resources: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(2048),
          name: z.string().min(1).max(1024),
          kind: z.enum(providerResourceKinds),
          selectable: z.boolean(),
        }),
      )
      .max(100),
    nextCursor: z.string().min(1).max(4096).optional(),
  }),
  check: z.strictObject({
    accountId: z.string().min(1).max(2048),
    checkedAt: z.number().int().nonnegative(),
    grantedScopes: upstreamScopesSchema,
  }),
  disconnect: z.strictObject({ remoteStatus: z.enum(["revoked", "already_invalid"]) }),
  discoverCapabilities: z.strictObject({
    operations: z.array(z.enum(providerOperationNames)).max(providerOperationNames.length),
    resourceKinds: z.array(z.enum(providerResourceKinds)).max(providerResourceKinds.length),
    upstreamScopes: upstreamScopesSchema,
    pagination: z.enum(["none", "cursor"]),
  }),
};
