import type { ManualAction, ManualDeclaration } from "./manualCommunicationTypes";

export function sameManualDeclaration(a: ManualDeclaration, b: ManualDeclaration): boolean {
  if (a.channel.kind !== b.channel.kind) return false;
  if (
    a.channel.kind === "other" &&
    b.channel.kind === "other" &&
    a.channel.label !== b.channel.label
  ) {
    return false;
  }
  return (
    a.occurredAt === b.occurredAt &&
    a.note === b.note &&
    a.evidenceReference === b.evidenceReference
  );
}

// Compare the canonical public declaration, not a new server clock or assigned record UUID.
export function sameManualAction(a: ManualAction, b: ManualAction): boolean {
  if (
    a.action !== b.action ||
    a.mutationIntentId !== b.mutationIntentId ||
    a.projectId !== b.projectId ||
    a.personId !== b.personId ||
    !sameManualDeclaration(a.declaration, b.declaration)
  )
    return false;
  if (a.action === "correct" && b.action === "correct") {
    return (
      a.logId === b.logId && a.expectedRevision === b.expectedRevision && a.reason === b.reason
    );
  }
  return true;
}
