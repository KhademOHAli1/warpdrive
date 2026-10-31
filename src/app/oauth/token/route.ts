import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { OAUTH_REQUEST_TIMEOUT_MS } from "@/constants/oauth";
import { db } from "@/db/client";
import { exchangeMcpGrant, tokenRequestInput } from "@/features/oauth/exchange";
import { checkRateLimit, tooManyRequestsResponse } from "@/server/rateLimitGuard";

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

async function readBody(req: Request, signal: AbortSignal): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  let body: unknown;
  if (contentType.startsWith("application/json")) {
    body = await req.json();
  } else {
    body = Object.fromEntries(await req.formData());
  }
  signal.throwIfAborted();
  return body;
}

export async function POST(req: Request): Promise<Response> {
  if (!env.MCP_ENABLED) return new NextResponse("Not found", { status: 404 });
  // Unauthenticated, and each call does a hash lookup plus writes. Checked before the body is
  // read so a flood costs nothing. Codes and refresh tokens are 256-bit, so this is about the
  // database load, not about making them harder to guess.
  const limit = checkRateLimit("oauthToken", req.headers);
  if (!limit.allowed) return tooManyRequestsResponse(limit);
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)]);
  let raw: unknown;
  try {
    raw = await readBody(req, signal);
  } catch {
    signal.throwIfAborted();
    return json({ error: "invalid_request" }, 400);
  }
  const parsed = tokenRequestInput.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const exchanged = await exchangeMcpGrant(db, parsed.data, signal);
  return exchanged.ok ? json(exchanged.value) : json({ error: "invalid_grant" }, 400);
}
