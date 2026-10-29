import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { Db } from "@/db/client";
import type { AppContext } from "@/server/trpc/context";
import { authenticateMcp } from "./auth";
import { registerMcpTools } from "./server";

export function createAuthenticatedMcpHandler(
  db: Db,
  baseUrl: string,
): (req: Request) => Promise<Response> {
  const requestContexts = new WeakMap<Request, AppContext>();
  const resourceOrigin = baseUrl.replace(/\/$/, "");
  const resourceMetadataUrl = new URL("/.well-known/oauth-protected-resource", baseUrl).toString();

  async function verifyRequest(req: Request): Promise<AuthInfo | undefined> {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]);
    const authenticated = await authenticateMcp(db, req.headers.get("authorization"), signal);
    if (!authenticated.ok) return undefined;
    requestContexts.set(req, authenticated.value.ctx);
    return authenticated.value.authInfo;
  }

  async function handleAuthenticatedRequest(req: Request): Promise<Response> {
    const ctx = requestContexts.get(req);
    if (ctx === undefined) {
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"` },
      });
    }

    const handler = createMcpHandler((server) => registerMcpTools(server, () => ctx, db), {
      serverInfo: { name: "warpdrive", version: "1.0.0" },
    });
    return handler(req);
  }

  return withMcpAuth(handleAuthenticatedRequest, verifyRequest, {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
    resourceUrl: resourceOrigin,
  });
}
