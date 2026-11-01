import { type Locale, SELECTABLE_LOCALES } from "@/features/i18n/registry";
import { err, ok, type Result } from "@/types/result";
import { QUALIFICATION_UNAVAILABLE_CAPABILITIES } from "./qualificationConstants";
import type { QualificationDefinition } from "./qualificationSchemas";

export interface QualificationPreview {
  readonly kind: "preview-only";
  readonly locale: Locale;
  readonly nativeIds: "unallocated";
  readonly rightsStatus: "pending";
  readonly definition: Readonly<{ key: string; version: number; schemaVersion: 1 }>;
  readonly capabilities: typeof QUALIFICATION_UNAVAILABLE_CAPABILITIES;
  readonly title: string;
  readonly description: string;
  readonly criteria: readonly Readonly<{
    identity: string;
    key: string;
    label: string;
    description: string;
    prompt: string;
  }>[];
}

export function previewQualificationDefinition(
  definition: QualificationDefinition,
  locale: string,
): Result<QualificationPreview, Readonly<{ code: "unsupported-locale" }>> {
  const selected = SELECTABLE_LOCALES.find((candidate) => candidate === locale);
  if (!selected) return err({ code: "unsupported-locale" });
  const prefix = `${definition.definitionKey}@${definition.version}`;
  return ok(
    Object.freeze({
      kind: "preview-only",
      locale: selected,
      nativeIds: "unallocated",
      rightsStatus: definition.research.rightsStatus,
      definition: Object.freeze({
        key: definition.definitionKey,
        version: definition.version,
        schemaVersion: definition.schemaVersion,
      }),
      capabilities: QUALIFICATION_UNAVAILABLE_CAPABILITIES,
      title: definition.title[selected],
      description: definition.description[selected],
      criteria: Object.freeze(
        definition.criteria.map((criterion) =>
          Object.freeze({
            identity: `${prefix}/criteria/${criterion.key}`,
            key: criterion.key,
            label: criterion.label[selected],
            description: criterion.description[selected],
            prompt: criterion.prompt[selected],
          }),
        ),
      ),
    }),
  );
}
