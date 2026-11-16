import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { buildAuthServerMetadata } from "@/features/oauth/metadata";
import { resolveMcpResourceProfile } from "@/features/oauth/resource";

export function GET(): Response {
  if (!env.MCP_ENABLED || !resolveMcpResourceProfile(env.BASE_URL).ok) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.json(
    buildAuthServerMetadata(env.BASE_URL, { registration: env.OAUTH_REGISTRATION }),
  );
}
