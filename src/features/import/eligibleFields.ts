import { isImportFieldHidden } from "@/constants/builtinFields";
import type { ImportSource } from "@/constants/importSources";
import {
  fieldsFor,
  isFieldOfferedInGroup,
  type MappableEntity,
  primaryEntityOf,
  requiredFieldsFor,
  TARGET_ENTITY_GROUPS,
} from "./importFields";
import type { ImportTarget } from "./wizardState";

export type HiddenBuiltinsMap = Partial<Record<MappableEntity, ReadonlySet<string>>>;

export interface EligibleField {
  entity: MappableEntity;
  field: string;
  label: string;
  required: boolean;
}

const EMPTY_HIDDEN: ReadonlySet<string> = new Set();

export function eligibleFields(
  target: ImportTarget,
  source: ImportSource,
  hidden: HiddenBuiltinsMap = {},
): EligibleField[] {
  const primary = primaryEntityOf(target);
  const requiredKeys = new Set(requiredFieldsFor(target, source).map((f) => f.field));
  const out: EligibleField[] = [];
  for (const entity of TARGET_ENTITY_GROUPS[target]) {
    const hiddenForEntity = hidden[entity] ?? EMPTY_HIDDEN;
    for (const field of fieldsFor(entity, source)) {
      if (!isFieldOfferedInGroup(entity, target, field)) continue;
      const required = entity === primary && requiredKeys.has(field.field);
      if (!required && isImportFieldHidden(field.field, hiddenForEntity)) continue;
      out.push({ entity, field: field.field, label: field.label, required });
    }
  }
  return out;
}
