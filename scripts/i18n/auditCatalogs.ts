import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";

export interface CatalogIssue {
  locale: string;
  key: string;
  code:
    | "invalid-key"
    | "invalid-value"
    | "icu"
    | "missing-key"
    | "extra-key"
    | "arguments"
    | "untranslated";
  message: string;
}

function flatten(
  value: unknown,
  locale: string,
  issues: CatalogIssue[],
  path = "",
): Map<string, string> {
  const entries = new Map<string, string>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({
      locale,
      key: path,
      code: "invalid-value",
      message: "Catalog namespaces must be objects.",
    });
    return entries;
  }
  for (const [key, child] of Object.entries(value)) {
    const full = path === "" ? key : `${path}.${key}`;
    if (key.includes(".") || key.trim() === "") {
      issues.push({
        locale,
        key: full,
        code: "invalid-key",
        message: "Message keys cannot be empty or contain dots.",
      });
      continue;
    }
    if (typeof child === "string") {
      entries.set(full, child);
      if (child.trim() === "")
        issues.push({
          locale,
          key: full,
          code: "invalid-value",
          message: "Messages cannot be empty.",
        });
    } else
      for (const [nestedKey, text] of flatten(child, locale, issues, full))
        entries.set(nestedKey, text);
  }
  return entries;
}

function argumentContract(elements: MessageFormatElement[], result = new Set<string>()): string {
  for (const element of elements) {
    if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
    result.add(`${element.value}:${element.type}`);
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      const selectors = Object.keys(element.options)
        .filter((key) => element.type === TYPE.select || key.startsWith("="))
        .sort();
      result.add(`${element.value}:selectors:${selectors.join(",")}`);
      if (element.type === TYPE.plural)
        result.add(`${element.value}:offset:${element.offset}:${element.pluralType}`);
      for (const option of Object.values(element.options)) argumentContract(option.value, result);
    } else if (element.type === TYPE.tag) argumentContract(element.children, result);
  }
  return [...result].sort().join("|");
}

function parseContracts(
  catalog: Map<string, string>,
  locale: string,
  issues: CatalogIssue[],
): Map<string, string> {
  const contracts = new Map<string, string>();
  for (const [key, text] of catalog) {
    try {
      contracts.set(key, argumentContract(parse(text)));
    } catch (error) {
      issues.push({
        locale,
        key,
        code: "icu",
        message: error instanceof Error ? error.message : "Invalid ICU message.",
      });
    }
  }
  return contracts;
}

function compareCatalog(
  source: Map<string, string>,
  catalog: Map<string, string>,
  sourceContracts: Map<string, string>,
  contracts: Map<string, string>,
  locale: string,
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const key of source.keys()) {
    if (!catalog.has(key)) {
      issues.push({ locale, key, code: "missing-key", message: "Translation is missing." });
      continue;
    }
    const expected = sourceContracts.get(key);
    const actual = contracts.get(key);
    if (expected !== undefined && actual !== undefined && expected !== actual) {
      issues.push({
        locale,
        key,
        code: "arguments",
        message: `ICU argument contract differs: ${expected} vs ${actual}.`,
      });
    }
  }
  for (const key of catalog.keys()) {
    if (!source.has(key))
      issues.push({
        locale,
        key,
        code: "extra-key",
        message: "No source message exists for this key.",
      });
  }
  return issues;
}

function containsLatinCopy(elements: MessageFormatElement[]): boolean {
  return elements.some((element) => {
    if (element.type === TYPE.literal) return /[a-z]/i.test(element.value);
    if (element.type === TYPE.tag) return containsLatinCopy(element.children);
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      return Object.values(element.options).some((option) => containsLatinCopy(option.value));
    }
    return false;
  });
}

function untranslatedIssues(
  source: Map<string, string>,
  catalog: Map<string, string>,
  sourceContracts: Map<string, string>,
  locale: string,
  reviewed: ReadonlySet<string>,
): CatalogIssue[] {
  return [...source].flatMap(([key, text]) => {
    if (reviewed.has(key) || !sourceContracts.has(key) || text !== catalog.get(key)) return [];
    return containsLatinCopy(parse(text))
      ? [
          {
            locale,
            key,
            code: "untranslated" as const,
            message:
              "Translation copies source-language text; translate it or record a reviewed invariant-name exception.",
          },
        ]
      : [];
  });
}

export function auditCatalogs(
  catalogs: Record<string, unknown>,
  sourceLocale = "en",
  reviewedIdentical: Record<string, ReadonlySet<string>> = {},
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (!(sourceLocale in catalogs))
    issues.push({
      locale: sourceLocale,
      key: "",
      code: "invalid-value",
      message: "Source catalog is missing.",
    });
  const flat = new Map(
    Object.entries(catalogs).map(([locale, catalog]) => [locale, flatten(catalog, locale, issues)]),
  );
  const source = flat.get(sourceLocale) ?? new Map<string, string>();
  const contracts = new Map(
    [...flat].map(([locale, catalog]) => [locale, parseContracts(catalog, locale, issues)]),
  );
  const sourceContracts = contracts.get(sourceLocale) ?? new Map<string, string>();
  for (const [locale, catalog] of flat) {
    if (locale === sourceLocale) continue;
    issues.push(
      ...compareCatalog(
        source,
        catalog,
        sourceContracts,
        contracts.get(locale) ?? new Map<string, string>(),
        locale,
      ),
      ...untranslatedIssues(
        source,
        catalog,
        sourceContracts,
        locale,
        reviewedIdentical[locale] ?? new Set<string>(),
      ),
    );
  }
  return issues;
}
