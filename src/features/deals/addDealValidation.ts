import {
  customFieldCreateError,
  firstMissingImportantField,
} from "@/features/custom-fields/CustomFieldCreateFields";
import type { Locale } from "@/features/i18n/registry";
import type { CustomFieldDef } from "@/types/customFields";
import type { AddDealState } from "./addDealState";

interface CustomFieldGroups {
  dealFields: CustomFieldDef[];
  personFields: CustomFieldDef[];
  orgFields: CustomFieldDef[];
}

// Validate every visible entity before creating the first linked contact. Required-field errors
// keep their existing priority over malformed numeric/date drafts in any of the three entities.
export function addDealCustomFieldError(
  state: AddDealState,
  { dealFields, personFields, orgFields }: CustomFieldGroups,
  locale: Locale,
  requiredField: (name: string) => string,
): string | null {
  const groups = [{ defs: dealFields, values: state.dealCustomFields }];
  if (state.orgMode === "new") groups.push({ defs: orgFields, values: state.orgCustomFields });
  if (state.personMode === "new")
    groups.push({ defs: personFields, values: state.personCustomFields });
  for (const { defs, values } of groups) {
    const missing = firstMissingImportantField(defs, values);
    if (missing !== null) return requiredField(missing.name);
  }
  for (const { defs, values } of groups) {
    const invalid = customFieldCreateError(defs, values, locale);
    if (invalid !== null) return invalid;
  }
  return null;
}
