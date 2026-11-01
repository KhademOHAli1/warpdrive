import { err, ok, type Result } from "@/types/result";
import campaign from "./starters/campaign.v1.json";
import modeling from "./starters/modeling.v1.json";
import shortVideo from "./starters/short-video.v1.json";
import { parseTemplateManifestJson } from "./templateManifest";
import type { TemplateManifest } from "./templateManifestSchemas";

type ManifestFailure = Extract<
  ReturnType<typeof parseTemplateManifestJson>,
  { ok: false }
>["error"];
type StarterFailure = ManifestFailure | "starter_unavailable";
const sources = new Map<string, string>([
  ["modeling_project", JSON.stringify(modeling)],
  ["short_video", JSON.stringify(shortVideo)],
  ["campaign_content", JSON.stringify(campaign)],
]);

function parseSource(id: string, source: string): Result<TemplateManifest, ManifestFailure> {
  const parsed = parseTemplateManifestJson(source);
  if (!parsed.ok) return parsed;
  return parsed.value.templateId === id ? parsed : err("invalid_manifest");
}

// Parse immutable source text for each read so caller edits stay local to that read.
export function readStarterTemplate(templateId: string): Result<TemplateManifest, StarterFailure> {
  const source = sources.get(templateId);
  return source === undefined ? err("starter_unavailable") : parseSource(templateId, source);
}

export function listStarterTemplates(): Result<readonly TemplateManifest[], ManifestFailure> {
  const manifests: TemplateManifest[] = [];
  for (const [id, source] of sources) {
    const parsed = parseSource(id, source);
    if (!parsed.ok) return parsed;
    manifests.push(parsed.value);
  }
  return ok(manifests);
}
