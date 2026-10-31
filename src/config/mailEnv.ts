import { z } from "zod";
import { connectionEndpointSchema } from "@/features/connections/connectionEndpoint";

const internalEndpoints = z
  .array(
    connectionEndpointSchema.strict().extend({
      allowedAddresses: z.array(z.string().min(1).max(64)).max(32).optional(),
      allowLoopback: z.boolean().optional(),
      ca: z.string().min(1).max(65_536).optional(),
    }),
  )
  .max(64);

export const mailEnvShape = {
  MAIL_INTERNAL_ENDPOINTS: z
    .string()
    .default("[]")
    .transform((value, context) => {
      let decoded: unknown;
      try {
        decoded = JSON.parse(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: "MAIL_INTERNAL_ENDPOINTS must be a JSON endpoint array",
        });
        return z.NEVER;
      }
      const parsed = internalEndpoints.safeParse(decoded);
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          message: "MAIL_INTERNAL_ENDPOINTS contains an invalid endpoint grant",
        });
        return z.NEVER;
      }
      return parsed.data;
    }),
};
