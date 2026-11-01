import type { ScopeDraftContext, ScopeDraftInput } from "./scopeDraftSchemas";

export const compareScopeStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// All callers pass parsed, closed metadata. Property order must not depend on locale or insertion.
export function canonicalScopeJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalScopeJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareScopeStrings(a, b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalScopeJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

type ProvenanceRecord = Pick<
  ScopeDraftInput["categories"][number]["records"][number],
  "provenance"
>;
export function canonicalProvenance(record: ProvenanceRecord) {
  return [...record.provenance].sort((a, b) =>
    compareScopeStrings(canonicalScopeJson(a), canonicalScopeJson(b)),
  );
}

export function scopeRecordSignature(
  record:
    | ScopeDraftContext["categories"][number]["records"][number]
    | ScopeDraftInput["categories"][number]["records"][number],
) {
  return canonicalScopeJson({
    recordRef: record.recordRef,
    locator: record.locator,
    sourceFingerprint: record.sourceFingerprint,
    provenance: canonicalProvenance(record),
  });
}

export function canonicalScopeCategories(input: ScopeDraftInput, context: ScopeDraftContext) {
  const expected = new Map(context.categories.map((category) => [category.store, category]));
  return [...input.categories]
    .sort((a, b) => compareScopeStrings(a.store, b.store))
    .map((category) => {
      const source = expected.get(category.store);
      const records = new Map(source?.records.map((record) => [record.recordRef, record]));
      return {
        ...category,
        capability: source?.capability,
        enumeration: source?.enumeration,
        records: [...category.records]
          .sort((a, b) => compareScopeStrings(a.recordRef, b.recordRef))
          .map((record) => ({
            ...record,
            provenance: canonicalProvenance(record),
            fields: [...(records.get(record.recordRef)?.fields ?? [])].sort(compareScopeStrings),
            decisions: [...record.decisions].sort((a, b) => compareScopeStrings(a.field, b.field)),
          })),
      };
    });
}
