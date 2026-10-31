import type { SelectOption } from "@/components/ui/Select";
import { DEFAULT_IMPORT_SOURCE, type ImportSource } from "@/constants/importSources";
import {
  type SettingsMessages,
  settingsBuiltinLabel,
  settingsMessagesForLocale,
} from "@/features/identity/settingsMessages";
import { eligibleFields, type HiddenBuiltinsMap } from "@/features/import/eligibleFields";
import {
  ENTITY_LABELS,
  type MappableEntity,
  primaryEntityOf,
} from "@/features/import/importFields";
import type { ColumnChoice, ImportTarget } from "@/features/import/wizardState";
import type { CustomFieldDef } from "@/types/customFields";

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
  sourceOrMessages: ImportSource | SettingsMessages = DEFAULT_IMPORT_SOURCE,
  localized: SettingsMessages = settingsMessagesForLocale("en"),
): SelectOption[] {
  const source = typeof sourceOrMessages === "string" ? sourceOrMessages : DEFAULT_IMPORT_SOURCE;
  const messages = typeof sourceOrMessages === "string" ? localized : sourceOrMessages;
  const IMP = messages.importer;
  const options: SelectOption[] = [{ value: UNMAPPED_SELECT_VALUE, label: IMP.unmapped }];
  for (const f of eligibleFields(target, source, hidden)) {
    const entityLabel = settingsBuiltinLabel(messages, ENTITY_LABELS[f.entity]);
    const fieldLabel = settingsBuiltinLabel(messages, f.label);
    const label =
      f.label === ENTITY_LABELS[f.entity] ? entityLabel : `${entityLabel}[${fieldLabel}]`;
    options.push({
      value: `s:${f.entity}:${f.field}`,
      label: `${label}${f.required ? REQUIRED_MARKER : ""}`,
      group: settingsBuiltinLabel(messages, ENTITY_LABELS[f.entity]),
    });
  }
  for (const def of defs) {
    options.push({ value: `c:${def.key}`, label: def.name, group: IMP.customGroup });
  }
  return options;
}
