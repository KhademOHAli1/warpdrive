import { eq } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_TOKEN_TTL_SECONDS } from "@/constants/oauth";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, ok, type Result } from "@/types/result";
import { consumeAuthCode } from "./authorize";
import { issueAccessToken, issueRefreshToken, rotateRefreshToken } from "./tokens";

export const tokenRequestInput = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    resource: z.string().url().optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    resource: z.string().url().optional(),
  }),
]);

interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
}

export async function exchangeMcpGrant(
  db: Db,
  input: z.infer<typeof tokenRequestInput>,
  signal: AbortSignal,
): Promise<Result<TokenPair, "invalid_grant">> {
  return db.transaction(async (tx) => {
    await lockMcpGrants(tx, signal);
    return exchangeLockedGrant(tx, input, signal);
  });
}

async function exchangeLockedGrant(
  db: Db,
  input: z.infer<typeof tokenRequestInput>,
  signal: AbortSignal,
): Promise<Result<TokenPair, "invalid_grant">> {
  const owner =
    input.grant_type === "authorization_code"
      ? await consumeAuthCode(
          db,
          {
            code: input.code,
            clientId: input.client_id,
            redirectUri: input.redirect_uri,
            codeVerifier: input.code_verifier,
          },
          signal,
        )
      : await rotateRefreshToken(db, input.refresh_token, signal, input.client_id);
  if (!owner.ok) return err("invalid_grant");
  const [user] = await db
    .select({ active: users.isActive })
    .from(users)
    .where(eq(users.id, owner.value.userId))
    .limit(1);
  if (user?.active !== true) return err("invalid_grant");
  const binding = { clientId: input.client_id, userId: owner.value.userId };
  const refresh =
    "refreshToken" in owner.value && typeof owner.value.refreshToken === "string"
      ? owner.value.refreshToken
      : await issueRefreshToken(db, binding, signal);
  const { token } = await issueAccessToken(db, binding, signal);
  return ok({
    access_token: token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
  });
}
