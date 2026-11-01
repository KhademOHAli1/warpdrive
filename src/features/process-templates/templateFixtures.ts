interface FixtureStage {
  key: string;
  name: { fa: string; de: string; en: string };
  description: { fa: string; de: string; en: string };
  rottingDays: number | null;
}

export function templateFixture() {
  return {
    schemaVersion: 1,
    templateKey: "standard-sales",
    version: 1,
    title: { fa: "فروش", de: "Vertrieb", en: "Sales" },
    description: {
      fa: "یک فرایند ساده برای بررسی فرصت‌ها",
      de: "Ein einfacher Ablauf zur Prüfung von Verkaufschancen",
      en: "A simple process for reviewing opportunities",
    },
    provenance: { kind: "original", sourceKey: "warpdrive-sales-catalog", revision: 1 },
    requires: ["pipeline.name", "stages.ordered", "stages.name", "stages.rotting-days"],
    pipeline: { name: { fa: "فروش / DACH", de: "Vertrieb / فروش", en: "Sales / فروش" } },
    stages: [
      {
        key: "review",
        name: { fa: "بررسی اولیه", de: "Erste Prüfung", en: "Initial review" },
        description: { fa: "بررسی فرصت", de: "Chance prüfen", en: "Review the opportunity" },
        rottingDays: null,
      },
      {
        key: "proposal",
        name: { fa: "پیشنهاد", de: "Angebot", en: "Proposal" },
        description: { fa: "بررسی پیشنهاد", de: "Angebot prüfen", en: "Review the proposal" },
        rottingDays: 7,
      },
    ] satisfies [FixtureStage, FixtureStage],
    fieldReferences: [],
    rules: [],
    actions: [],
  };
}
