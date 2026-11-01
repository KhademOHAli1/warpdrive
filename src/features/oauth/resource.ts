import { err, ok, type Result } from "@/types/result";

export interface McpResourceProfile {
  issuer: string;
  resource: string;
}

// This profile accepts URI spellings: literal host or bracketed IPv6, optional
// decimal port, and RFC 3986 path bytes. International names use IDNA ASCII;
// international paths use percent escapes.
// Keep the raw components because URL parsing erases ports and normalizes aliases.
function httpsIdentity(value: string): string | null {
  if (/[\s\p{Cc}\p{Cf}\\]/u.test(value)) return null;
  const raw =
    /^https:\/\/(\[[0-9a-f:.]+\]|[a-z0-9._~!$&'()*+,;=-]+)(:\d+)?(\/[a-z0-9._~!$&'()*+,;=:@/%-]*)?$/i.exec(
      value,
    );
  const host = raw?.[1];
  if (host === undefined) return null;
  const port = raw?.[2] ?? "";
  const path = raw?.[3] ?? "";
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(path)) return null;
  // Escapes encode octets, so validate their syntax without decoding as UTF-8.
  if (/%(?![0-9a-f]{2})/i.test(path)) return null;
  try {
    const parsed = new URL(value);
    if (!host.startsWith("[") && parsed.hostname !== host.toLowerCase()) return null;
    return `https://${host.toLowerCase()}${port}${path}`;
  } catch {
    return null;
  }
}

export function resolveMcpResourceProfile(
  baseUrl: string,
): Result<McpResourceProfile, "invalid_target"> {
  const resource = `${baseUrl.replace(/\/$/, "")}/api/mcp`;
  if (httpsIdentity(baseUrl) === null || httpsIdentity(resource) === null) {
    return err("invalid_target");
  }
  return ok({ issuer: baseUrl, resource });
}

export function validateMcpResource(
  baseUrl: string,
  value: unknown,
): Result<string, "invalid_target"> {
  const profile = resolveMcpResourceProfile(baseUrl);
  if (!profile.ok || typeof value !== "string" || value.length === 0) return err("invalid_target");
  if (httpsIdentity(value) !== httpsIdentity(profile.value.resource)) {
    return err("invalid_target");
  }
  return ok(profile.value.resource);
}
