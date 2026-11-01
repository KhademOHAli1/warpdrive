import type { QualificationCriterion } from "./qualificationSchemas";

type Copy = readonly [fa: string, de: string, en: string];

function localized([fa, de, en]: Copy) {
  return { fa, de, en };
}

export function criterion(
  key: string,
  label: Copy,
  description: Copy,
  prompt: Copy,
): QualificationCriterion {
  return {
    key,
    label: localized(label),
    description: localized(description),
    prompt: localized(prompt),
  };
}

export function originalDefinition(
  definitionKey: string,
  title: Copy,
  description: Copy,
  referenceName: string,
  referenceUrl: string,
  criteria: readonly QualificationCriterion[],
) {
  return {
    schemaVersion: 1,
    definitionKey,
    version: 1,
    title: localized(title),
    description: localized(description),
    provenance: {
      kind: "original",
      sourceKey: "warpdrive-qualification-catalog",
      revision: 1,
      author: "warpdrive-sales-platform",
      reviewStatus: "pending",
    },
    research: {
      rightsStatus: "pending",
      references: [{ name: referenceName, url: referenceUrl, accessedOn: "2026-11-01" }],
    },
    criteria,
  };
}
