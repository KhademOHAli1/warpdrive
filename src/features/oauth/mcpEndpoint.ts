import { resolveMcpResourceProfile } from "./resource";

export function resolveMcpEndpoint({
  mcpEnabled,
  baseUrl,
}: {
  mcpEnabled: boolean;
  baseUrl: string;
}): string | null {
  if (!mcpEnabled) return null;
  const profile = resolveMcpResourceProfile(baseUrl);
  return profile.ok ? profile.value.resource : null;
}
