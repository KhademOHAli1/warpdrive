import {
  type OperationsSearchFixtureEntry,
  type OperationsSearchResult,
  operationsSearchResultsPerKind,
} from "./operationsContracts";

const emptyOperations: OperationsSearchResult[] = [];
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

export function searchOperationsFixture(
  entries: readonly OperationsSearchFixtureEntry[] | undefined,
  query: string,
): OperationsSearchResult[] {
  const term = normalize(query.trim());
  if (entries === undefined || term === "" || term.includes("\u0000")) return emptyOperations;
  const words = term.split(/\s+/u);
  const matches = entries.filter(({ primary, secondary }) => {
    const text = normalize(`${primary} ${secondary ?? ""}`);
    return words.every((word) => text.includes(word));
  });
  const exact = (item: OperationsSearchResult) => normalize(item.primary) === term;
  const groups = new Map<OperationsSearchResult["kind"], number>();
  return matches
    .sort((left, right) => Number(exact(right)) - Number(exact(left)))
    .filter(({ kind }) => {
      const used = groups.get(kind) ?? 0;
      if (used >= operationsSearchResultsPerKind) return false;
      groups.set(kind, used + 1);
      return true;
    });
}
