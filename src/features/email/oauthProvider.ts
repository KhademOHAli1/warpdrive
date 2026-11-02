import { z } from "zod";
import { env } from "@/config/env";
import { AppError } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import { tokenResponseSchema } from "./gmailSchemas";
import type { GmailCallbackDependencies } from "./oauthCallback";

const identitySchema = z.object({
  email: z.string(),
  email_verified: z.boolean(),
  hd: z.string().nullable().default(null),
});
export const gmailOAuthProvider: Omit<GmailCallbackDependencies, "enqueue"> = {
  async exchangeCode(code, verifier, signal) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: `${env.BASE_URL}/api/gmail/oauth/callback`,
        grant_type: "authorization_code",
      }),
      signal,
    });
    signal.throwIfAborted();
    if (!response.ok) return err(new AppError("E_GMAIL_001", "token exchange failed", {}));
    const token = tokenResponseSchema.safeParse(await response.json());
    if (!token.success || token.data.refresh_token === undefined)
      return err(new AppError("E_GMAIL_001", "invalid token response", {}));
    return ok({
      accessToken: token.data.access_token,
      refreshToken: token.data.refresh_token,
      scopes: (token.data.scope ?? "").split(" ").filter(Boolean),
    });
  },
  async fetchIdentity(token, signal) {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
    signal.throwIfAborted();
    if (!response.ok) return err(new AppError("E_GMAIL_001", "identity request failed", {}));
    const identity = identitySchema.safeParse(await response.json());
    if (!identity.success) return err(new AppError("E_GMAIL_001", "invalid identity response", {}));
    return ok({
      email: identity.data.email,
      emailVerified: identity.data.email_verified,
      hd: identity.data.hd,
    });
  },
};
