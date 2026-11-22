import { env } from "@/config/env";
import { readAuthRateLimitIp } from "@/features/auth/better/rateLimit";
import { validateRequestOrigin } from "@/features/auth/csrf";
import { guardCsrf } from "@/features/identity/actions/shared";
import { backendRequest } from "@/server/request";
import { createContext } from "@/server/trpc/context";
import { readRequestCsrf } from "@/server/trpc/request-csrf";
import type { AssetTagContactResult, AssetTagResult, AssetTagScanResult } from "./contracts";
import { resolveAssetTag, runAssetTagCommand, sendAssetTagContact } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

async function tagSession(expectedActorId: string, csrf: string | null) {
  if (!(await guardCsrf(csrf)).ok) return null;
  const { actor, db, session } = await createContext();
  return actor?.id === expectedActorId && session !== null ? { db, session } : null;
}

export async function executeAssetTagAction(
  expectedActorId: string,
  input: unknown,
  csrf: string | null,
): Promise<AssetTagResult> {
  const current = await tagSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : runAssetTagCommand(current.db, current.session, input, AbortSignal.timeout(20_000));
}

export async function resolveAssetTagAction(
  expectedActorId: string,
  input: unknown,
  csrf: string | null,
): Promise<AssetTagScanResult> {
  const current = await tagSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : resolveAssetTag(
        current.db,
        current.session,
        input,
        new URL(env.BASE_URL).origin,
        AbortSignal.timeout(15_000),
      );
}

export async function sendAssetTagContactAction(
  input: unknown,
  proof: unknown,
): Promise<AssetTagContactResult> {
  const request = backendRequest()?.request;
  if (request === undefined || request.method !== "POST") return unavailable;
  const origin = readRequestCsrf(request.headers);
  if (
    origin.origin === null ||
    (origin.secFetchSite !== null && origin.secFetchSite !== "same-origin") ||
    !validateRequestOrigin(origin).ok
  )
    return unavailable;

  const { db } = await createContext();
  const visitor = readAuthRateLimitIp(request.headers, env.AUTH_TRUSTED_PROXY_HEADER);
  return sendAssetTagContact(db, input, proof, visitor, AbortSignal.timeout(15_000));
}
