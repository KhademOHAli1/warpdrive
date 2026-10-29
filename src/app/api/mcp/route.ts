import { env } from "@/config/env";
import { db } from "@/db/client";
import { createAuthenticatedMcpHandler } from "@/features/mcp/http";

export const runtime = "nodejs";

const authenticatedHandler = createAuthenticatedMcpHandler(db, env.BASE_URL);

async function route(req: Request): Promise<Response> {
  if (!env.MCP_ENABLED) return new Response(null, { status: 404 });
  return authenticatedHandler(req);
}

export { route as GET, route as POST };
