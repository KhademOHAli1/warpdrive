import { NextRequest } from "next/server";
import { env } from "@/config/env";
import { httpRoutes } from "./routes";

export function acceptsBackendPath(path: string): boolean {
  return (
    path === "/api/trpc" ||
    path.startsWith("/api/trpc/") ||
    httpRoutes.some((route) => route.pattern.test(path))
  );
}

export async function handleBackendHttp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = httpRoutes.find((candidate) => candidate.pattern.test(url.pathname));
  if (!route) return new Response("Not found", { status: 404 });
  const match = route.pattern.exec(url.pathname);
  if (match === null) return new Response("Not found", { status: 404 });
  const params: Record<string, string | string[] | undefined> = {};
  try {
    route.params.forEach((param, index) => {
      const value = match[index + 1];
      params[param.name] =
        value === undefined
          ? undefined
          : "many" in param && param.many === true
            ? value.split("/").map(decodeURIComponent)
            : decodeURIComponent(value);
    });
  } catch {
    return new Response("Invalid route parameters", { status: 400 });
  }
  type Handler = (
    request: NextRequest,
    context: { params: Promise<typeof params> },
  ) => Response | Promise<Response>;
  const handlers = route.handlers as unknown as Record<string, Handler>;
  const method = request.method === "HEAD" && !handlers.HEAD ? "GET" : request.method;
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  if (handler === undefined) {
    const allowed = Object.keys(handlers).filter((name) => /^[A-Z]+$/u.test(name));
    if (allowed.includes("GET") && !allowed.includes("HEAD")) allowed.push("HEAD");
    if (!allowed.includes("OPTIONS")) allowed.push("OPTIONS");
    return new Response(null, {
      status: request.method === "OPTIONS" ? 204 : 405,
      headers: { allow: allowed.join(", ") },
    });
  }
  // Protocol handlers retain the canonical public issuer/callback URLs, not the private Core URL.
  const publicUrl = new URL(`${url.pathname}${url.search}`, env.BASE_URL);
  const native = new NextRequest(new Request(publicUrl, request));
  return handler(native, { params: Promise.resolve(params) });
}
