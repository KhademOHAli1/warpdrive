import { err, ok, type Result } from "@/types/result";
import { hasDuplicateJsonKeys } from "./duplicateJsonKeys";
import { TEMPLATE_MANIFEST_MAX_BYTES } from "./templateConstants";
import { type ProcessTemplateManifest, processTemplateManifestSchema } from "./templateSchemas";

export interface TemplateManifestProblem {
  code: "invalid-manifest" | "unsupported-version" | "duplicate-key" | "manifest-too-large";
  paths: readonly (readonly (string | number)[])[];
}

export function readProcessTemplateManifest(
  text: unknown,
): Result<ProcessTemplateManifest, TemplateManifestProblem> {
  if (typeof text !== "string") return err({ code: "invalid-manifest", paths: [] });
  if (
    text.length > TEMPLATE_MANIFEST_MAX_BYTES ||
    new TextEncoder().encode(text).byteLength > TEMPLATE_MANIFEST_MAX_BYTES
  )
    return err({ code: "manifest-too-large", paths: [] });
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return err({ code: "invalid-manifest", paths: [] });
  }
  if (hasDuplicateJsonKeys(text)) return err({ code: "duplicate-key", paths: [] });
  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw && raw.schemaVersion !== 1)
    return err({ code: "unsupported-version", paths: [["schemaVersion"]] });
  const parsed = processTemplateManifestSchema.safeParse(raw);
  if (!parsed.success)
    return err({
      code: "invalid-manifest",
      paths: parsed.error.issues.map((issue) =>
        issue.path.filter((part): part is string | number => typeof part !== "symbol"),
      ),
    });
  return ok(parsed.data);
}
