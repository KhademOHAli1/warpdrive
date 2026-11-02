import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "@/config/env";
import { AppError, ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import { AUTH_CODE_TTL_MS } from "@/constants/oauth";
import type { Db } from "@/db/client";
import { oauthAuthCodes } from "@/db/schema/oauth";
import { err, ok, type Result } from "@/types/result";
import { sha256Base64Url, verifyPkceS256 } from "./pkce";
import type { AuthorizationRequest } from "./requestSchemas";
import { validateMcpResource } from "./resource";

export {
  type AuthorizationRequest,
  authorizationPostQueryInput,
  authorizationRequestInput,
} from "./requestSchemas";

export function authorizationSearchParams(input: AuthorizationRequest): URLSearchParams {
  const params = new URLSearchParams({
    client_id: input.client_id,
    redirect_uri: input.redirect_uri,
    response_type: input.response_type,
    code_challenge: input.code_challenge,
    code_challenge_method: input.code_challenge_method,
    state: input.state,
    resource: input.resource,
  });
  if (input.scope !== undefined) params.set("scope", input.scope);
  return params;
}

interface AuthCodeBinding {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: unknown;
}

interface ConsumeAuthCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

function authCodeError(id: ErrorId, message: string): AppError {
  return new AppError(id, message, {});
}

export async function issueAuthCode(
  db: Db,
  binding: AuthCodeBinding,
  signal: AbortSignal,
): Promise<Result<string, "invalid_target">> {
  signal.throwIfAborted();
  const resource = validateMcpResource(env.BASE_URL, binding.resource);
  if (!resource.ok) return resource;
  const code = randomBytes(32).toString("base64url");
  await db.insert(oauthAuthCodes).values({
    codeHash: sha256Base64Url(code),
    clientId: binding.clientId,
    userId: binding.userId,
    redirectUri: binding.redirectUri,
    codeChallenge: binding.codeChallenge,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });
  signal.throwIfAborted();
  return ok(code);
}

export async function consumeAuthCode(
  db: Db,
  input: ConsumeAuthCodeInput,
  signal: AbortSignal,
): Promise<Result<{ userId: string }, AppError>> {
  signal.throwIfAborted();
  const codeHash = sha256Base64Url(input.code);
  const [row] = await db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash));
  signal.throwIfAborted();

  if (row === undefined || row.consumedAt !== null) {
    return err(authCodeError(ERROR_IDS.OAUTH_INVALID_GRANT, "authorization code is invalid"));
  }
  if (row.expiresAt <= new Date()) {
    return err(authCodeError(ERROR_IDS.OAUTH_CODE_EXPIRED, "authorization code is expired"));
  }
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) {
    return err(
      authCodeError(ERROR_IDS.OAUTH_INVALID_GRANT, "authorization code binding is invalid"),
    );
  }
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) {
    return err(authCodeError(ERROR_IDS.OAUTH_INVALID_PKCE, "PKCE verifier is invalid"));
  }

  const [consumed] = await db
    .update(oauthAuthCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(oauthAuthCodes.codeHash, codeHash), isNull(oauthAuthCodes.consumedAt)))
    .returning({ userId: oauthAuthCodes.userId });
  signal.throwIfAborted();
  if (consumed === undefined) {
    return err(authCodeError(ERROR_IDS.OAUTH_INVALID_GRANT, "authorization code was consumed"));
  }
  return ok(consumed);
}
