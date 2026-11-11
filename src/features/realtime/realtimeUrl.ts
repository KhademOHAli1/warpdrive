type RealtimeLocation = { protocol: string; host: string };

// Resolve only at the browser connection boundary. Keeping location explicit makes this
// module safe to import during SSR and lets one built image run behind different origins.
export function resolveRealtimeUrl(configured: string, location?: RealtimeLocation): string {
  if (configured !== "same-origin") return configured;
  if (location === undefined || location.host === "") return "";
  if (location.protocol === "https:") return `wss://${location.host}/_ws`;
  if (location.protocol === "http:") return `ws://${location.host}/_ws`;
  return "";
}
