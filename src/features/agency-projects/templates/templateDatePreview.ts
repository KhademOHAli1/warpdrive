import { z } from "zod";
import { addCivilDays } from "@/lib/zonedDateTime";
import { err, ok, type Result } from "@/types/result";
import type { TemplateManifest } from "./templateManifestSchemas";

export type TemplateDatePreview = {
  templateId: string;
  version: number;
  projectStart: string;
  intents: {
    intentId: string;
    dueDate: string;
    dueOffset: TemplateManifest["intents"][number]["dueOffset"];
  }[];
};

function isCanonicalCivilDate(value: string): boolean {
  // The exact length also rejects a final line terminator matched by JavaScript's $ anchor.
  if (
    value.length !== 10 ||
    value.startsWith("0000") ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)
  )
    return false;
  try {
    return addCivilDays(value, 0) === value;
  } catch {
    return false;
  }
}

const projectStartSchema = z.string().refine(isCanonicalCivilDate);

// The manifest already crossed its syntax and graph boundary. Only this newly chosen
// project start is ingress; no time zone, display calendar or workweek changes a civil day.
export function previewTemplateDates(
  manifest: TemplateManifest,
  projectStart: unknown,
): Result<TemplateDatePreview, "invalid_date"> {
  const parsed = projectStartSchema.safeParse(projectStart);
  if (!parsed.success) return err("invalid_date");
  const intents: TemplateDatePreview["intents"] = [];
  try {
    for (const intent of manifest.intents) {
      const dueDate = addCivilDays(parsed.data, intent.dueOffset.days);
      if (!isCanonicalCivilDate(dueDate)) return err("invalid_date");
      intents.push({ intentId: intent.id, dueDate, dueOffset: { ...intent.dueOffset } });
    }
  } catch {
    return err("invalid_date");
  }
  return ok({
    templateId: manifest.templateId,
    version: manifest.version,
    projectStart: parsed.data,
    intents,
  });
}
