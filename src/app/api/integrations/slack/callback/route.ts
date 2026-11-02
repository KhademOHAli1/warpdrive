import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { finishSlackConnection, INTEGRATION_STATE_COOKIE } from "@/features/integrations/service";

export async function GET(request: NextRequest) {
  const target = new URL("/settings/connections", env.BASE_URL);
  target.searchParams.set("tab", "connections");
  target.searchParams.set("result", "failed");
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const cookieState = request.cookies.get(INTEGRATION_STATE_COOKIE)?.value;
  const current = await resolveWorkflowSession(db, request.headers, AbortSignal.timeout(5000), {
    requireFresh: true,
  });
  if (
    state !== null &&
    state.length > 0 &&
    state.length <= 100 &&
    code !== null &&
    code.length > 0 &&
    code.length <= 4096 &&
    cookieState !== undefined &&
    current !== null
  ) {
    try {
      await finishSlackConnection(db, {
        state,
        code,
        cookieState,
        userId: current.user.id,
        sessionId: current.session.id,
      });
      target.searchParams.set("result", "connected");
    } catch {
      /* The redirect exposes no provider response, authorization code, or credentials. */
    }
  }
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(INTEGRATION_STATE_COOKIE, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/slack",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
