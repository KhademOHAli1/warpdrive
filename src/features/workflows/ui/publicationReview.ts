import type { AppMessages } from "@/features/i18n/catalog";
import { findPaletteEntry, type PaletteCatalogEntry } from "../paletteCatalog";
import { executableNode } from "../readiness";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";

export interface PublicationReviewSource {
  name: string;
  definition: WorkflowDefinition;
  revision: number;
  dirty: boolean;
  active: boolean;
  number: number | null;
  archivedAt: Date | null;
  available: boolean;
  capabilities: { edit: boolean; publish: boolean };
}
export interface PublicationReviewSnapshot extends PublicationReviewSource {
  cut: string;
}
function publicationCut(source: PublicationReviewSource): string {
  return JSON.stringify({
    name: source.name,
    definition: source.definition,
    revision: source.revision,
    dirty: source.dirty,
    active: source.active,
    number: source.number,
    archivedAt: source.archivedAt,
    available: source.available,
    edit: source.capabilities.edit,
    publish: source.capabilities.publish,
  });
}
export function capturePublicationReview(
  source: PublicationReviewSource,
): PublicationReviewSnapshot {
  return {
    name: source.name,
    definition: source.definition,
    revision: source.revision,
    dirty: source.dirty,
    active: source.active,
    number: source.number,
    archivedAt: source.archivedAt,
    available: source.available,
    capabilities: { edit: source.capabilities.edit, publish: source.capabilities.publish },
    cut: publicationCut(source),
  };
}
export function publicationReviewCurrent(
  snapshot: PublicationReviewSnapshot,
  source: PublicationReviewSource,
): boolean {
  // This is a local review-consistency check. Existing publication and run services
  // remain responsible for current authority and execution readiness.
  return snapshot.cut === publicationCut(source);
}
const descriptions = {
  "trigger.manual": "publicationManualStep",
  "trigger.record": "publicationUnavailableStep",
  "record.read": "publicationReadStep",
  "activity.create": "publicationTaskStep",
  condition: "publicationConditionStep",
  delay: "publicationWaitStep",
  notification: "publicationUnavailableStep",
} satisfies Record<WorkflowNode["type"], keyof AppMessages["workflows"]>;
export interface PublicationReviewStep {
  id: WorkflowNode["id"];
  name: WorkflowNode["name"];
  labelKey: PaletteCatalogEntry["labelKey"] | "notReady";
  descriptionKey: (typeof descriptions)[WorkflowNode["type"]];
  ready: boolean;
}
export function publicationReviewSteps(definition: WorkflowDefinition) {
  return definition.nodes.map((node): PublicationReviewStep => {
    const ready = executableNode(node);
    return {
      id: node.id,
      name: node.name,
      labelKey: findPaletteEntry(node.type, node.version)?.labelKey ?? "notReady",
      descriptionKey: ready ? descriptions[node.type] : "publicationUnavailableStep",
      ready,
    };
  });
}
