import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { validTemplateManifestGraph } from "./templateManifestGraph";
import { type TemplateManifest, templateManifestSchema } from "./templateManifestSchemas";

const MAX_JSON_BYTES = 131_072;
const sourceSchema = z.string();
type ManifestFailure = "invalid_json" | "manifest_too_large" | "invalid_manifest";

// This boundary accepts data only. It has no installer, registry, identity or effect binding.
export function parseTemplateManifestJson(
  source: unknown,
): Result<TemplateManifest, ManifestFailure> {
  const text = sourceSchema.safeParse(source);
  if (!text.success) return err("invalid_json");
  if (
    text.data.length > MAX_JSON_BYTES ||
    new TextEncoder().encode(text.data).length > MAX_JSON_BYTES
  ) {
    return err("manifest_too_large");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.data);
  } catch {
    return err("invalid_json");
  }
  const parsed = templateManifestSchema.safeParse(decoded);
  if (!parsed.success) return err("invalid_manifest");
  if (!validTemplateManifestGraph(parsed.data)) return err("invalid_manifest");
  return ok(parsed.data);
}
