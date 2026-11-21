import {
  type CatalogCategory,
  type CatalogPart,
  type CatalogUnit,
  type CatalogWorkspace,
  catalogUnits,
} from "../contracts";
import type { CatalogWords } from "./catalogMessages";

export const catalogFlagKeys = [
  "assembly",
  "component",
  "purchasable",
  "salable",
  "testable",
  "trackable",
] as const;

export const partTypes = ["stocked", "virtual", "consumable", "template", "variant"] as const;
type PartType = (typeof partTypes)[number];

export function partType(part: CatalogPart): PartType {
  if (part.profile.isTemplate) return "template";
  if (part.profile.templateItemId !== null) return "variant";
  return part.profile.stockMode;
}

const unitSymbols: Partial<Record<CatalogUnit, string>> = {
  um: "µm",
  ohm: "Ω",
  kohm: "kΩ",
  Mohm: "MΩ",
};

export function unitLabel(unit: CatalogUnit, t: CatalogWords) {
  return unit === "each" ? t.each : (unitSymbols[unit] ?? unit);
}

export function unitOptions(t: CatalogWords, units: readonly CatalogUnit[] = catalogUnits) {
  return units.map((unit) => ({ value: unit, label: unitLabel(unit, t) }));
}

export function catalogPartLabel(part: CatalogPart) {
  return `${part.code} · ${part.revision} — ${part.name}`;
}

export function categoryTrail(categories: readonly CatalogCategory[], id: string | null) {
  const trail: CatalogCategory[] = [];
  let next = id;
  while (next !== null && !trail.some((entry) => entry.id === next)) {
    const category = categories.find((entry) => entry.id === next);
    if (!category) break;
    trail.unshift(category);
    next = category.parentId;
  }
  return trail;
}

export function categoryOptions(categories: readonly CatalogCategory[], locale: string) {
  return categories
    .map((entry) => ({
      value: entry.id,
      label: categoryTrail(categories, entry.id)
        .map(({ name }) => name)
        .join(" / "),
    }))
    .sort((first, second) => first.label.localeCompare(second.label, locale));
}

export function applicableParameters(
  categories: readonly CatalogCategory[],
  categoryId: string | null,
) {
  const items: CatalogCategory["parameters"] = [];
  for (const { parameters } of categoryTrail(categories, categoryId)) {
    for (const parameter of parameters) {
      const previous = items.findIndex(({ key }) => key === parameter.key);
      if (previous === -1) items.push(parameter);
      else items[previous] = parameter;
    }
  }
  return items;
}

export function currentState(workspace: CatalogWorkspace, part: CatalogPart) {
  return workspace.states.find((state) => state.id === part.profile.stateId);
}
