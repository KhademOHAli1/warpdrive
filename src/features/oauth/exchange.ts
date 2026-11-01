import { eq } from "drizzle-orm";
import { env } from "@/config/env";
import { ACCESS_TOKEN_TTL_SECONDS } from "@/constants/oauth";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, ok, type Result } from "@/types/result";
import { consumeAuthCode } from "./authorize";
import { requestInputError, type TokenRequest, tokenRequestInput } from "./requestSchemas";
import { resolveMcpResourceProfile } from "./resource";
import { issueAccessToken, issueRefreshToken, rotateRefreshToken } from "./tokens";

export { tokenRequestInput } from "./requestSchemas";

interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
}

export async function exchangeMcpGrant(
  db: Db,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<TokenPair, "invalid_request" | "invalid_target" | "invalid_grant">> {
  signal.throwIfAborted();
  const profile = resolveMcpResourceProfile(env.BASE_URL);
  if (!profile.ok) return profile;
  const parsed = tokenRequestInput.safeParse(input);
  if (!parsed.success) return err(requestInputError(parsed.error));
  const exchanged = await db.transaction(async (tx) => {
    await lockMcpGrants(tx, signal);
    signal.throwIfAborted();
    return exchangeLockedGrant(tx, parsed.data, signal);
  });
  signal.throwIfAborted();
  return exchanged;
}

async function exchangeLockedGrant(
  db: Db,
  input: TokenRequest,
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
  signal.throwIfAborted();
  if (!owner.ok) return err("invalid_grant");
  const [user] = await db
    .select({ active: users.isActive })
    .from(users)
    .where(eq(users.id, owner.value.userId))
    .limit(1);
  signal.throwIfAborted();
  if (user?.active !== true) return err("invalid_grant");
  const binding = { clientId: input.client_id, userId: owner.value.userId };
  const refresh =
    "refreshToken" in owner.value && typeof owner.value.refreshToken === "string"
      ? owner.value.refreshToken
      : await issueRefreshToken(db, binding, signal);
  signal.throwIfAborted();
  const { token } = await issueAccessToken(db, binding, signal);
  signal.throwIfAborted();
  return ok({
    access_token: token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
  });
}
