import type { ProviderId } from "./providers/types";

export const PROVIDER_NAMES: Readonly<Record<ProviderId, string>> = Object.freeze({
  apollo: "Apollo",
  rocketreach: "RocketReach",
  getprospect: "GetProspect",
});

// A Map has no inherited property names: historical/unknown IDs such as "constructor" and
// "__proto__" remain plain data rather than resolving to Object.prototype members.
const names = new Map<string, string>(Object.entries(PROVIDER_NAMES));

export function providerName(id: string): string {
  return names.get(id) ?? id;
}
