import { coreProxyToken, frontendClientIp } from "./config";

/** Only a configured frontend may restore public request facts at the private Core origin. */
export function backendHeaders(incoming: Headers, relay = false): Headers {
  const result = relay ? new Headers(incoming) : new Headers();
  if (!relay)
    for (const name of [
      "cookie",
      "origin",
      "sec-fetch-site",
      "sec-fetch-mode",
      "sec-fetch-dest",
      "accept-language",
      "user-agent",
      "referer",
      "x-request-id",
    ]) {
      const value = incoming.get(name);
      if (value !== null) result.set(name, value);
    }
  for (const name of [...result.keys()])
    if (name.startsWith("x-warpdrive-") || name.startsWith("x-forwarded-") || name === "x-real-ip")
      result.delete(name);
  result.delete("host");
  result.set("x-warpdrive-proxy-token", coreProxyToken());
  const host = incoming.get("host");
  if (host !== null) result.set("x-warpdrive-public-host", host);
  // Trust only the explicitly selected ingress header, which that ingress must overwrite.
  const ip = frontendClientIp(incoming);
  if (ip !== null) result.set("x-warpdrive-client-ip", ip);
  return result;
}
