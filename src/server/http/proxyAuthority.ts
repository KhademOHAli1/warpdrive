import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { env } from "@/config/env";

/** A proxy credential carries request provenance, never an actor or permission assertion. */
export function admitFrontendRequest(request: Request): Request | null {
  const token = env.CORE_PROXY_TOKEN;
  const headers = new Headers(request.headers);
  const publicHost = headers.get("x-warpdrive-public-host");
  const clientIp = headers.get("x-warpdrive-client-ip");
  const supplied = headers.get("x-warpdrive-proxy-token") ?? "";
  if (token !== "") {
    const expected = Buffer.from(token);
    const received = Buffer.from(supplied);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    // A configured public origin, or the existing strict loopback development profile only.
    if (publicHost !== null) {
      if (!validPublicHost(publicHost)) return null;
      headers.set("host", publicHost);
    }
    restoreClientIp(headers, clientIp);
  }
  // Legacy standalone Core can retain its original admission when no proxy token is configured.
  // In that profile none of the new proxy-supplied authority is accepted.
  for (const name of [...headers.keys()]) if (name.startsWith("x-warpdrive-")) headers.delete(name);
  return new Request(request, { headers });
}

function validPublicHost(host: string): boolean {
  return (
    host === new URL(env.BASE_URL).host ||
    (env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/u.test(host))
  );
}

function restoreClientIp(headers: Headers, ip: string | null): void {
  for (const name of ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"]) {
    headers.delete(name);
    if (ip !== null && isIP(ip)) headers.set(name, ip);
  }
}
