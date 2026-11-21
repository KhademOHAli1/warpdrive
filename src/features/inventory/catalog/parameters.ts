import {
  type CatalogCategory,
  type CatalogParameterDefinition,
  type CatalogParameterValue,
  type CatalogUnit,
  convertCatalogUnits,
} from "./contracts";

export function catalogCategoryPath(
  categories: ReadonlyMap<string, CatalogCategory>,
  categoryId: string | null,
): CatalogCategory[] | null {
  const lineage: CatalogCategory[] = [];
  const visited = new Set<string>();
  while (categoryId !== null) {
    const parent = categories.get(categoryId);
    if (parent === undefined || visited.has(parent.id)) return null;
    visited.add(parent.id);
    lineage.unshift(parent);
    categoryId = parent.parentId;
  }
  return lineage;
}

export function effectiveCatalogParameters(
  lineage: CatalogCategory[],
): CatalogParameterDefinition[] {
  const definitions = new Map<string, CatalogParameterDefinition>();
  for (const category of lineage) {
    for (const definition of category.parameters) definitions.set(definition.key, definition);
  }
  return [...definitions.values()];
}

export function defaultCatalogUnit(lineage: CatalogCategory[]): CatalogUnit {
  let unit: CatalogUnit = "each";
  for (const category of lineage) {
    if (category.defaultUnit !== null) unit = category.defaultUnit;
  }
  return unit;
}

export function validCatalogParameterDefinitions(definitions: CatalogParameterDefinition[]) {
  return (
    new Set(definitions.map(({ key }) => key)).size === definitions.length &&
    definitions.every(({ kind, unit }) => kind === "number" || unit === null)
  );
}

function normalizeParameter(
  value: CatalogParameterValue,
  definition: CatalogParameterDefinition,
): CatalogParameterValue | null {
  const { kind, unit } = definition;
  if (kind === "text") return typeof value.value === "string" && value.unit === null ? value : null;
  if (kind === "boolean")
    return typeof value.value === "boolean" && value.unit === null ? value : null;
  if (typeof value.value !== "number") return null;
  if (unit === null) return value.unit === null ? value : null;
  const converted = convertCatalogUnits(value.value, value.unit ?? unit, unit);
  return converted !== null && Number.isFinite(converted) && Math.abs(converted) <= 1e12
    ? { ...value, value: converted, unit }
    : null;
}

export function normalizeCatalogParameters(
  values: CatalogParameterValue[],
  definitions: CatalogParameterDefinition[],
): CatalogParameterValue[] | null {
  if (new Set(values.map(({ key }) => key)).size !== values.length) return null;
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const normalized: CatalogParameterValue[] = [];
  for (const value of values) {
    const definition = byKey.get(value.key);
    if (definition === undefined) return null;
    const entry = normalizeParameter(value, definition);
    if (entry === null) return null;
    normalized.push(entry);
  }
  return normalized;
}

export function catalogLinkCycle(
  sourceId: string,
  targetId: string | null,
  next: (id: string) => string | null,
): boolean {
  const visited = new Set([sourceId]);
  while (targetId !== null) {
    if (visited.has(targetId)) return true;
    visited.add(targetId);
    targetId = next(targetId);
  }
  return false;
}
