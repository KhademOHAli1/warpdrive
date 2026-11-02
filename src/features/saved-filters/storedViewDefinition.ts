import type { SavedViewDefinition, SavedViewDefinitionAvailability } from "./savedView";
import type { FilterDefinition, SavedFilterTargetEntity } from "./schemas";
import { decodeSavedViewDefinition } from "./viewDefinitionVersion";
import { isFullSavedViewPresentation } from "./viewPresentation";

type DefinitionFor<T extends SavedFilterTargetEntity> = T extends "deal"
  ? FilterDefinition & { combinator: "and" | "or" }
  : SavedViewDefinition;

// Keep raw recovery data in storage. The client receives safe availability, never an executable
// fallback or the unsupported payload's authored values.
export function storedViewDefinition<T extends SavedFilterTargetEntity>(
  targetEntity: T,
  raw: unknown,
): SavedViewDefinitionAvailability<DefinitionFor<T>> {
  const decoded = decodeSavedViewDefinition(targetEntity, raw);
  if (!decoded.ok)
    return {
      availability: "unavailable",
      definition: null,
      problem: { kind: decoded.error.kind, code: decoded.error.code },
    };
  const presentation = decoded.value.envelope.presentation;
  return {
    availability: "available",
    // The shared decoder validated this exact entity's schema at the boundary.
    definition: decoded.value.envelope.definition as DefinitionFor<T>,
    ...(isFullSavedViewPresentation(presentation) ? { presentation } : {}),
  };
}
