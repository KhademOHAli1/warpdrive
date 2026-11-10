import { z } from "zod";
export interface CalendarGoogleIdentity {
  subject: string;
  emailAddress: string;
  hostedDomain: string | null;
}
export interface CalendarTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  grantedScopes?: string[];
}
export const codeExchangeSchema = z.object({
  code: z.string().min(1).max(4096),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});
export const refreshInputSchema = z.object({ refreshToken: z.string().min(1).max(16_384) });
export const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(16_384),
    expires_in: z.number().int().positive().max(86_400),
    refresh_token: z.string().min(1).max(16_384).optional(),
    token_type: z.literal("Bearer"),
    scope: z.string().trim().min(1).max(32_768).optional(),
  })
  .transform(
    (value): CalendarTokenResponse => ({
      accessToken: value.access_token,
      expiresIn: value.expires_in,
      ...(value.refresh_token !== undefined ? { refreshToken: value.refresh_token } : {}),
      ...(value.scope !== undefined
        ? { grantedScopes: [...new Set(value.scope.split(/\s+/))] }
        : {}),
    }),
  );
export const googleIdentitySchema = z
  .object({
    sub: z.string().min(1).max(255),
    email: z.email().max(320),
    email_verified: z.literal(true),
    hd: z.string().min(1).max(255).optional(),
  })
  .transform(
    (value): CalendarGoogleIdentity => ({
      subject: value.sub,
      emailAddress: value.email.toLowerCase(),
      hostedDomain: value.hd ?? null,
    }),
  );
