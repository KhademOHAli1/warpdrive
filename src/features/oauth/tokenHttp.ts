import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { OAUTH_REQUEST_TIMEOUT_MS } from "@/constants/oauth";
import type { Db } from "@/db/client";
import { checkRateLimit, tooManyRequestsResponse } from "@/server/rateLimitGuard";
import { exchangeMcpGrant } from "./exchange";
import { readTokenInput } from "./requestIngress";

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export function createTokenHandler(db: Db): (req: Request) => Promise<Response> {
  return async function handlePost(req: Request): Promise<Response> {
    if (!env.MCP_ENABLED) return new NextResponse("Not found", { status: 404 });
    // Unauthenticated, and each call does a hash lookup plus writes. Checked before the body is
    // read so a flood costs nothing. Codes and refresh tokens are 256-bit, so this is about the
    // database load, not about making them harder to guess.
    const limit = checkRateLimit("oauthToken", req.headers);
    if (!limit.allowed) return tooManyRequestsResponse(limit);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)]);
    const raw = await readTokenInput(req, signal);
    signal.throwIfAborted();
    if (!raw.ok) return json({ error: raw.error }, 400);

    const exchanged = await exchangeMcpGrant(db, raw.value, signal);
    signal.throwIfAborted();
    return exchanged.ok ? json(exchanged.value) : json({ error: exchanged.error }, 400);
  };
}
