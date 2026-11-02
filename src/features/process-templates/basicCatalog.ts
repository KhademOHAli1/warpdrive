import { ok, type Result } from "@/types/result";
import { STAGE_TEMPLATE_CAPABILITIES } from "./templateConstants";
import { readProcessTemplateManifest, type TemplateManifestProblem } from "./templateManifest";
import type { ProcessTemplateManifest } from "./templateSchemas";

const originalProvenance = {
  kind: "original",
  sourceKey: "warpdrive-sales-catalog",
  revision: 1,
};

const basicSales = {
  schemaVersion: 1,
  templateKey: "basic-sales",
  version: 1,
  title: { fa: "فرایند فروش پایه", de: "Einfacher Vertriebsprozess", en: "Basic sales process" },
  description: {
    fa: "ساختاری پیشنهادی برای بررسی نیاز، پیشنهاد و تصمیم مشتری؛ بدون فعال‌سازی خودکارسازی.",
    de: "Ein Vorschlag für Bedarf, Angebot und Kundenentscheidung, ohne Automatisierung zu aktivieren.",
    en: "A starting structure for needs, proposals and customer decisions, without activating automation.",
  },
  provenance: originalProvenance,
  requires: STAGE_TEMPLATE_CAPABILITIES,
  pipeline: { name: { fa: "فروش", de: "Vertrieb", en: "Sales" } },
  stages: [
    {
      key: "initial-review",
      name: { fa: "بررسی اولیه", de: "Erste Prüfung", en: "Initial review" },
      description: {
        fa: "فرصت و گام بعدی را بررسی کنید.",
        de: "Prüfen Sie die Chance und den nächsten Schritt.",
        en: "Review the opportunity and its next step.",
      },
      rottingDays: null,
    },
    {
      key: "needs",
      name: { fa: "شناخت نیاز", de: "Bedarf klären", en: "Understand needs" },
      description: {
        fa: "نیاز مشتری و اطلاعات نامشخص را روشن کنید.",
        de: "Klären Sie den Kundenbedarf und offene Fragen.",
        en: "Clarify the customer's needs and open questions.",
      },
      rottingDays: null,
    },
    {
      key: "proposal",
      name: { fa: "پیشنهاد", de: "Angebot", en: "Proposal" },
      description: {
        fa: "پیشنهاد مناسب و موارد باز را با مشتری بررسی کنید.",
        de: "Besprechen Sie das passende Angebot und offene Punkte.",
        en: "Review the suitable proposal and open points with the customer.",
      },
      rottingDays: null,
    },
    {
      key: "decision",
      name: { fa: "تصمیم‌گیری", de: "Entscheidung", en: "Decision" },
      description: {
        fa: "تصمیم و گام بعدی را ثبت کنید. نام این مرحله نتیجهٔ فرصت را تغییر نمی‌دهد.",
        de: "Halten Sie Entscheidung und nächsten Schritt fest. Der Phasenname ändert den Chancenstatus nicht.",
        en: "Record the decision and next step. The stage name does not change the opportunity status.",
      },
      rottingDays: null,
    },
  ],
  fieldReferences: [],
  rules: [],
  actions: [],
};

const blankPipeline = {
  schemaVersion: 1,
  templateKey: "blank-pipeline",
  version: 1,
  title: { fa: "شروع از یک مرحله", de: "Mit einer Phase beginnen", en: "Start with one stage" },
  description: {
    fa: "یک مرحلهٔ ساده برای طراحی فرایند خودتان؛ بدون قواعد یا خودکارسازی.",
    de: "Eine einzelne Phase für Ihren eigenen Prozess, ohne Regeln oder Automatisierung.",
    en: "One stage for designing your own process, without rules or automation.",
  },
  provenance: originalProvenance,
  requires: STAGE_TEMPLATE_CAPABILITIES,
  pipeline: { name: { fa: "فرایند جدید", de: "Neuer Prozess", en: "New process" } },
  stages: [
    {
      key: "first-stage",
      name: { fa: "مرحلهٔ اول", de: "Erste Phase", en: "First stage" },
      description: {
        fa: "نام و ترتیب مراحل را برای فرایند خود انتخاب کنید.",
        de: "Wählen Sie Namen und Reihenfolge der Phasen für Ihren Prozess.",
        en: "Choose the stage names and order for your process.",
      },
      rottingDays: null,
    },
  ],
  fieldReferences: [],
  rules: [],
  actions: [],
};

export function readBasicProcessTemplateCatalog(): Result<
  readonly ProcessTemplateManifest[],
  TemplateManifestProblem
> {
  const manifests: ProcessTemplateManifest[] = [];
  for (const source of [basicSales, blankPipeline]) {
    const parsed = readProcessTemplateManifest(JSON.stringify(source));
    if (!parsed.ok) return parsed;
    manifests.push(parsed.value);
  }
  return ok(Object.freeze(manifests));
}
