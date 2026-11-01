import { hasDuplicateJsonKeys } from "@/features/process-templates/duplicateJsonKeys";
import { err, ok, type Result } from "@/types/result";
import { QUALIFICATION_MAX_BYTES } from "./qualificationConstants";
import {
  type QualificationDefinition,
  qualificationDefinitionSchema,
} from "./qualificationSchemas";

export interface QualificationDefinitionProblem {
  readonly code:
    | "invalid-definition"
    | "unsupported-version"
    | "duplicate-key"
    | "definition-too-large";
  readonly paths: readonly (readonly (string | number)[])[];
}

export function readQualificationDefinition(
  text: unknown,
): Result<QualificationDefinition, QualificationDefinitionProblem> {
  if (typeof text !== "string") return err({ code: "invalid-definition", paths: [] });
  if (
    text.length > QUALIFICATION_MAX_BYTES ||
    new TextEncoder().encode(text).byteLength > QUALIFICATION_MAX_BYTES
  )
    return err({ code: "definition-too-large", paths: [] });
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return err({ code: "invalid-definition", paths: [] });
  }
  if (hasDuplicateJsonKeys(text)) return err({ code: "duplicate-key", paths: [] });
  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw && raw.schemaVersion !== 1)
    return err({ code: "unsupported-version", paths: [["schemaVersion"]] });
  const parsed = qualificationDefinitionSchema.safeParse(raw);
  if (!parsed.success)
    return err({
      code: "invalid-definition",
      paths: parsed.error.issues.map((issue) =>
        issue.path.filter((part): part is string | number => typeof part !== "symbol"),
      ),
    });
  return ok(parsed.data);
}
