import { coreOrigin } from "./config";
import { backendHeaders } from "./headers";

const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** Fixed upstream, no replay. Preserve raw signed bodies, redirects, cookies and streaming. */
export async function proxyBackendRequest(request: Request): Promise<Response> {
  const publicUrl = new URL(request.url);
  const destination = new URL(coreOrigin());
  destination.pathname = publicUrl.pathname;
  destination.search = publicUrl.search;
  const headers = backendHeaders(request.headers, true);
  for (const name of HOP_HEADERS) headers.delete(name);
  headers.set("accept-encoding", "identity");
  for (const name of ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip"])
    headers.delete(name);
  const upstream = await fetch(destination, {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    redirect: "manual",
    cache: "no-store",
    // Required by Node's streaming Fetch implementation; Workers ignores this standard extension.
    ...({ duplex: "half" } as RequestInit),
  });
  const responseHeaders = new Headers(upstream.headers);
  for (const name of HOP_HEADERS) responseHeaders.delete(name);
  responseHeaders.set("cache-control", "private, no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
