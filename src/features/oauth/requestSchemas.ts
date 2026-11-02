import { z } from "zod";
import { env } from "@/config/env";
import { validateMcpResource } from "./resource";

const resourceInput = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const resource = validateMcpResource(env.BASE_URL, value);
    if (!resource.ok) {
      ctx.addIssue({ code: "custom", message: "invalid_target" });
      return z.NEVER;
    }
    return resource.value;
  });

export const authorizationRequestInput = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().min(1),
  scope: z.string().optional(),
  resource: resourceInput,
});

export const authorizationPostQueryInput = authorizationRequestInput.extend({
  csrf_token: z.string().min(1),
});

export const tokenRequestInput = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    resource: resourceInput,
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    resource: resourceInput,
  }),
]);

export type AuthorizationRequest = z.infer<typeof authorizationRequestInput>;
export type TokenRequest = z.infer<typeof tokenRequestInput>;

export function requestInputError(error: z.ZodError): "invalid_request" | "invalid_target" {
  return error.issues.some((issue) => issue.path[0] === "resource")
    ? "invalid_target"
    : "invalid_request";
}
