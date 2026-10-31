import { err, ok } from "@/types/result";
import { registryEntries } from "./registryEntries";
import type { DiscoveredInventoryItem, LifecycleOperation, PrivacyRegistry } from "./registryTypes";

export const privacyRegistry: PrivacyRegistry = { version: 1, entries: registryEntries };
const OPERATIONS: LifecycleOperation[] = [
  "discovery",
  "export",
  "rectification",
  "restriction",
  "erasure",
  "retention",
];

export function checkRegistryCoverage(
  discovered: DiscoveredInventoryItem[],
  registry: PrivacyRegistry,
): {
  ok: boolean;
  missing: string[];
  invalid: string[];
} {
  const known = new Set<string>();
  const invalid: string[] = [];
  if (!Number.isInteger(registry.version) || registry.version < 1) invalid.push("invalid_version");
  for (const entry of registry.entries) {
    const complete =
      entry.ids.length > 0 &&
      entry.categories.length > 0 &&
      entry.categories.every((category) => category.trim().length > 0) &&
      [
        entry.owner,
        entry.subjectRelation,
        entry.purpose,
        entry.disclosure,
        entry.retention,
        entry.externalEffects,
        entry.proof,
      ].every((value) => value.trim().length > 0) &&
      OPERATIONS.every((operation) => {
        const capability = entry.capabilities[operation];
        return capability.reason.trim().length > 0 && capability.task.trim().length > 0;
      });
    if (entry.ids.length === 0) invalid.push("incomplete:entry_without_ids");
    for (const id of entry.ids) {
      if (!complete) invalid.push(`incomplete:${id}`);
      if (known.has(id)) invalid.push(`duplicate:${id}`);
      known.add(id);
    }
  }
  const missing = [
    ...new Set(discovered.filter((item) => !known.has(item.id)).map((item) => item.id)),
  ].sort();
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function requireLifecycleCapability(
  registry: PrivacyRegistry,
  id: string,
  operation: LifecycleOperation,
) {
  const matches = registry.entries.filter((entry) => entry.ids.includes(id));
  const entry = matches[0];
  if (matches.length !== 1 || entry === undefined)
    return err({ code: "unclassified_store" as const, id });
  if (!checkRegistryCoverage([], registry).ok)
    return err({ code: "invalid_registry" as const, id });
  const disposition = entry.capabilities[operation];
  if (disposition.status !== "supported")
    return err({ code: "capability_unavailable" as const, id, operation, ...disposition });
  return ok({ registryVersion: registry.version, owner: entry.owner, ...disposition });
}
