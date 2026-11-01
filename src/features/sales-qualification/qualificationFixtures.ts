const text = { fa: "بررسی نیاز", de: "Bedarf prüfen", en: "Review need" };

export function qualificationDefinitionSource() {
  return {
    schemaVersion: 1,
    definitionKey: "buying-readiness",
    version: 1,
    title: { ...text },
    description: { ...text },
    provenance: {
      kind: "original",
      sourceKey: "warpdrive-qualification-catalog",
      revision: 1,
      author: "warpdrive-sales-platform",
      reviewStatus: "pending",
    },
    research: {
      rightsStatus: "pending",
      references: [{ name: "BANT", url: "https://example.org/research", accessedOn: "2026-11-01" }],
    },
    criteria: [
      { key: "customer-need", label: { ...text }, description: { ...text }, prompt: { ...text } },
    ],
  };
}
