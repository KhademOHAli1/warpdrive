import type { SelectOption } from "@/components/ui/Select";
import { DEFAULT_IMPORT_SOURCE, type ImportSource } from "@/constants/importSources";
import { STRINGS } from "@/constants/strings";
import { eligibleFields, type HiddenBuiltinsMap } from "@/features/import/eligibleFields";
import {
  ENTITY_LABELS,
  type MappableEntity,
  primaryEntityOf,
  qualifiedFieldLabel,
} from "@/features/import/importFields";
import type { ColumnChoice, ImportTarget } from "@/features/import/wizardState";
import type { CustomFieldDef } from "@/types/customFields";

const IMP = STRINGS.settings.importer;
const REQUIRED_MARKER = " *";
export const UNMAPPED_SELECT_VALUE = "mapping:unmapped";

export function choiceToValue(choice: ColumnChoice): string {
  if (choice.isCustom && choice.key !== "") return `c:${choice.key}`;
  if (choice.field !== "") return `s:${choice.entity}:${choice.field}`;
  return "";
}

export function valueToChoice(value: string, target: ImportTarget): ColumnChoice {
  const primary = primaryEntityOf(target);
  if (value.startsWith("s:")) {
    const [entity, ...rest] = value.slice(2).split(":");
    return { entity: entity as MappableEntity, field: rest.join(":"), isCustom: false, key: "" };
  }
  if (value.startsWith("c:")) {
    return { entity: primary, field: "", isCustom: true, key: value.slice(2) };
  }
  return { entity: primary, field: "", isCustom: false, key: "" };
}

export function buildColumnOptions(
  target: ImportTarget,
  defs: CustomFieldDef[],
  hidden: HiddenBuiltinsMap = {},
  source: ImportSource = DEFAULT_IMPORT_SOURCE,
): SelectOption[] {
  const options: SelectOption[] = [{ value: UNMAPPED_SELECT_VALUE, label: IMP.unmapped }];
  for (const f of eligibleFields(target, source, hidden)) {
    options.push({
      value: `s:${f.entity}:${f.field}`,
      label: `${qualifiedFieldLabel(f.entity, f.label)}${f.required ? REQUIRED_MARKER : ""}`,
      group: ENTITY_LABELS[f.entity],
    });
  }
  for (const def of defs) {
    options.push({ value: `c:${def.key}`, label: def.name, group: IMP.customGroup });
  }
  return options;
}
