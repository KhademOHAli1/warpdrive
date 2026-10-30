import type { ImportSource } from "@/constants/importSources";
import type { CustomFieldDef } from "@/types/customFields";
import type { EligibleField } from "./eligibleFields";
import { primaryEntityOf } from "./importFields";
import { suggestColumns } from "./suggestColumns";
import type { ColumnChoice, ImportTarget } from "./wizardState";

export interface SuggestContext {
  eligible: readonly EligibleField[];
  defs: readonly CustomFieldDef[];
}

export function unmapped(target: ImportTarget): ColumnChoice {
  return { entity: primaryEntityOf(target), field: "", isCustom: false, key: "" };
}

export function reseed(
  headers: readonly string[],
  target: ImportTarget,
  source: ImportSource,
  suggest: SuggestContext | undefined,
): Record<string, ColumnChoice> {
  if (suggest === undefined || headers.length === 0) return {};
  return suggestColumns(headers, target, source, suggest.eligible, suggest.defs);
}

export function seedColumns(
  headers: readonly string[],
  target: ImportTarget,
  source: ImportSource,
  suggest: SuggestContext | undefined,
): Record<string, ColumnChoice> {
  if (suggest === undefined) {
    return Object.fromEntries(headers.map((h) => [h, unmapped(target)]));
  }
  return suggestColumns(headers, target, source, suggest.eligible, suggest.defs);
}
