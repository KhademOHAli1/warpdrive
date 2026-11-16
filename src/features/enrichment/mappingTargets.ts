import { BUILTIN_FIELDS } from "@/constants/builtinFields";
import { ADDRESS_PREFIX, ENTITY_FIELDS } from "@/features/import/importFields";
import type { EnrichEntity } from "./canonical";

// Built-ins enrichment must never write: owner and label are relationship pickers with their own
// authorities, phones has no canonical source and is contact-point shaped, and "address" is
// reached through its dotted leaves rather than as a whole object.
const NON_ENRICHABLE_BUILTINS = new Set(["owner", "label", "phones", "address"]);

function dataFieldsOf(entity: EnrichEntity): string[] {
  return BUILTIN_FIELDS[entity]
    .filter((f) => !NON_ENRICHABLE_BUILTINS.has(f.key))
    .map((f) => f.key);
}

// The only keys a builtin mapping may name. plan.ts turns targetKey straight into an update-patch
// key, so an unvetted string here is a write into an arbitrary column.
export const WRITABLE_BUILTIN_TARGETS: Readonly<Record<EnrichEntity, ReadonlySet<string>>> = {
  organization: new Set([
    ...dataFieldsOf("organization"),
    ...ENTITY_FIELDS.organization
      .filter((f) => f.field.startsWith(ADDRESS_PREFIX))
      .map((f) => f.field),
  ]),
  person: new Set(dataFieldsOf("person")),
};
