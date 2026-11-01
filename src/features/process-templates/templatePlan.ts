import type { Locale } from "@/features/i18n/registry";
import { err, ok, type Result } from "@/types/result";
import { STAGE_TEMPLATE_CAPABILITIES } from "./templateConstants";
import type { ProcessTemplateManifest } from "./templateSchemas";

interface ProposedStage {
  readonly operation: "create-stage";
  readonly operationKey: string;
  readonly stageKey: string;
  readonly pipelineOperationKey: string;
  readonly name: string;
  readonly description: string;
  readonly order: number;
  readonly rottingDays: number | null;
}

export interface ProcessTemplatePreview {
  readonly kind: "preview-only";
  readonly locale: Locale;
  readonly nativeIds: "unallocated";
  readonly installation: "unavailable";
  readonly template: Readonly<{ key: string; version: number; schemaVersion: 1 }>;
  readonly title: string;
  readonly description: string;
  readonly pipeline: Readonly<{
    operation: "create-pipeline";
    operationKey: string;
    name: string;
  }>;
  readonly stages: readonly Readonly<ProposedStage>[];
}

export interface TemplatePlanProblem {
  readonly code: "unsupported-capability";
  readonly capabilities: readonly string[];
}

// This is a new-pipeline preview. It cannot refer to, reuse or update native IDs.
export function planProcessTemplate(
  manifest: ProcessTemplateManifest,
  locale: Locale,
): Result<ProcessTemplatePreview, TemplatePlanProblem> {
  const supported = new Set<string>(STAGE_TEMPLATE_CAPABILITIES);
  const unavailable = manifest.requires.filter((capability) => !supported.has(capability)).sort();
  if (unavailable.length > 0)
    return err({ code: "unsupported-capability", capabilities: Object.freeze(unavailable) });
  const prefix = `${manifest.templateKey}@${manifest.version}`;
  const pipelineOperationKey = `${prefix}/pipeline`;
  return ok(
    Object.freeze({
      kind: "preview-only",
      locale,
      nativeIds: "unallocated",
      installation: "unavailable",
      template: Object.freeze({
        key: manifest.templateKey,
        version: manifest.version,
        schemaVersion: manifest.schemaVersion,
      }),
      title: manifest.title[locale],
      description: manifest.description[locale],
      pipeline: Object.freeze({
        operation: "create-pipeline",
        operationKey: pipelineOperationKey,
        name: manifest.pipeline.name[locale],
      }),
      stages: Object.freeze(
        manifest.stages.map((stage, order) =>
          Object.freeze({
            operation: "create-stage" as const,
            operationKey: `${prefix}/stages/${stage.key}`,
            stageKey: stage.key,
            pipelineOperationKey,
            name: stage.name[locale],
            description: stage.description[locale],
            order,
            rottingDays: stage.rottingDays,
          }),
        ),
      ),
    }),
  );
}
