import type { WorkflowDefinition } from "@/features/workflows/schemas";
import { publicationReviewSteps } from "@/features/workflows/ui/publicationReview";
import { createAppTranslator } from "./catalog";

// Compile-only contract: typecheck must generate literal JSON declarations before running tsc.
export function assertTranslationTypes(): void {
  const calendar = createAppTranslator("en", "calendar");
  calendar("showMore", { count: 2 });
  calendar("weekOf", { date: "1 January" });
  // @ts-expect-error unknown message keys must fail compilation
  calendar("missingMessage");
  // @ts-expect-error required ICU interpolation values must be supplied
  calendar("weekOf");
  // @ts-expect-error plural counts must be numeric
  calendar("showMore", { count: "two" });
}

// Compile-only: summary keys retain their catalog literals and need no interpolation.
export function assertWorkflowPublicationTranslationTypes(definition: WorkflowDefinition): void {
  const workflows = createAppTranslator("en", "workflows");
  for (const step of publicationReviewSteps(definition)) {
    workflows(step.labelKey);
    workflows(step.descriptionKey);
  }
}
