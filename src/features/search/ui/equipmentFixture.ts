import type { AssetsWorkspace } from "@/features/assets/contracts";
import type { Locale } from "@/features/i18n/registry";
import type { SearchResult } from "@/types/search";

export type EquipmentSearchEntry = {
  id: string;
  name: string;
  code: string;
  serial: string | null;
};

export const equipmentSearchHeading: Record<Locale, string> = {
  en: "Equipment",
  de: "Betriebsmittel",
  fa: "تجهیزات",
};

export const equipmentSearchPlaceholder: Record<Locale, string> = {
  en: "Search deals, contacts, leads and equipment…",
  de: "Verkaufschancen, Kontakte, Leads und Betriebsmittel suchen…",
  fa: "جست‌وجوی فرصت‌های فروش، مخاطبان، سرنخ‌ها و تجهیزات…",
};

export function projectFixtureEquipment(workspace: AssetsWorkspace): EquipmentSearchEntry[] {
  const visibleSites = new Set(workspace.sites.map(({ id }) => id));
  return workspace.records.flatMap((asset) =>
    asset.archivedAt !== null || !visibleSites.has(asset.siteId)
      ? []
      : [
          {
            id: asset.id,
            name: asset.name,
            code: asset.code,
            serial: asset.tracking === "individual" ? asset.serial : null,
          },
        ],
  );
}

const EMPTY_EQUIPMENT_RESULTS: SearchResult[] = [];
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

export function searchFixtureEquipment(
  entries: readonly EquipmentSearchEntry[] | undefined,
  query: string,
): SearchResult[] {
  const term = normalize(query.trim());
  if (entries === undefined || term === "") return EMPTY_EQUIPMENT_RESULTS;
  const words = term.split(/\s+/u);
  const matches = entries.filter(({ name, code, serial }) => {
    const text = normalize([name, code, serial].join(" "));
    return words.every((word) => text.includes(word));
  });
  const exact = (entry: EquipmentSearchEntry) =>
    normalize(entry.code) === term || normalize(entry.serial ?? "") === term;
  return matches
    .sort((left, right) => Number(exact(right)) - Number(exact(left)))
    .slice(0, 8)
    .map(({ id, name, code, serial }) => ({
      id,
      primary: name,
      secondary: serial === null ? code : `${code} · ${serial}`,
    }));
}
