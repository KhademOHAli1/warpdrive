import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { LocalePreferences } from "@/features/i18n/preferences";
import { TemplateInstallPreview } from "./TemplateInstallPreview";
import type {
  TemplateInstallPreviewData,
  TemplateInstallPreviewProps,
} from "./templateInstallPreviewTypes";
import { parseTemplateManifestJson } from "./templateManifest";
import { manifestFixture } from "./templateManifest.test-support";

export const contextKey = "accepted-staff-session:template-preview";
export const projectId = "cdefabcd-3456-4cde-abcd-345678901abc";
export const sharedIdentityId = "abcdefab-1234-4abc-8def-1234567890ab";
export const unusedUserId = "bcdefabc-2345-4bcd-9efa-234567890abc";
export const staffLabel = "Sara رضایی";
export const personLabel = "Studio Ö / همکار";
export const unusedLabel = "Nima Müller";
export const projectStart = "2027-03-21";
export const dueDates = ["2027-03-23", "2027-03-20", "2027-03-21"];

export const englishPreferences: LocalePreferences = {
  locale: "en",
  calendar: "gregory",
  numberingSystem: "latn",
  timeZone: "UTC",
};

function labels(en: string, de: string, fa: string) {
  return { en, de, fa };
}

export function previewManifest() {
  const base = manifestFixture();
  const parsed = parseTemplateManifestJson(
    JSON.stringify({
      ...base,
      label: labels("Model production", "Modellproduktion", "تولید مدل"),
      description: labels(
        "Internal production plan",
        "Interner Produktionsplan",
        "برنامهٔ تولید داخلی",
      ),
      roles: [
        {
          ...base.roles[0],
          label: labels("Internal producer", "Interne Produktion", "مسئول تولید داخلی"),
        },
        {
          ...base.roles[1],
          label: labels("Freelance modeler", "Freie Modellierung", "مدل‌ساز آزاد"),
        },
        {
          id: "unused",
          kind: "internal-producer",
          label: labels(
            "Unused internal role",
            "Unverwendete interne Rolle",
            "نقش داخلی بدون استفاده",
          ),
        },
      ],
      stages: [
        { ...base.stages[0], label: labels("Briefing", "Briefing", "شرح کار") },
        { ...base.stages[1], label: labels("Production", "Produktion", "تولید") },
        {
          id: "approval",
          label: labels("Approval", "Freigabe", "تأیید"),
          dependsOn: ["production"],
        },
      ],
      deliverables: [
        { ...base.deliverables[0], label: labels("Model draft", "Modellentwurf", "پیش‌نویس مدل") },
      ],
      intents: [
        {
          ...base.intents[2],
          label: labels("Review model", "Modell prüfen", "بررسی مدل"),
          stageId: "approval",
          dueOffset: { ...base.intents[2].dueOffset, days: 2 },
        },
        {
          ...base.intents[0],
          label: labels("Follow up briefing", "Briefing nachfassen", "پیگیری شرح کار"),
          dueOffset: { ...base.intents[0].dueOffset, days: -1 },
        },
        {
          ...base.intents[1],
          label: labels("Model assignment", "Modell beauftragen", "واگذاری مدل"),
          dueOffset: { ...base.intents[1].dueOffset, days: 0 },
        },
      ],
    }),
  );
  assert(parsed.ok);
  return parsed.value;
}

export function previewPacket(
  overrides: Partial<TemplateInstallPreviewData> = {},
): TemplateInstallPreviewData {
  const manifest = previewManifest();
  return {
    contextKey,
    target: {
      projectId,
      templateId: manifest.templateId,
      version: manifest.version,
      selectionKey: "draft-selection:1",
    },
    manifest,
    bindings: [
      { roleId: "producer", kind: "internal-user", userId: sharedIdentityId },
      { roleId: "modeler", kind: "external-contact", personId: sharedIdentityId },
      { roleId: "unused", kind: "internal-user", userId: unusedUserId },
    ],
    projectStart,
    userLabels: { [sharedIdentityId]: staffLabel, [unusedUserId]: unusedLabel },
    personLabels: { [sharedIdentityId]: personLabel },
    ...overrides,
  };
}

export function previewView(
  data = previewPacket(),
  preferences: LocalePreferences = englishPreferences,
  overrides: Partial<TemplateInstallPreviewProps> = {},
) {
  return (
    <LocaleProvider {...preferences}>
      <TemplateInstallPreview
        contextKey={contextKey}
        target={data.target}
        data={data}
        canRead={true}
        {...overrides}
      />
    </LocaleProvider>
  );
}

export function renderPreview(
  data = previewPacket(),
  preferences: LocalePreferences = englishPreferences,
) {
  return render(previewView(data, preferences));
}

export function previewRegion(name = "Template contents preview") {
  return screen.getByRole("region", { name });
}

export function namedList(name: string) {
  return within(previewRegion()).getByRole("list", { name });
}

export function rowFor(list: HTMLElement, label: string) {
  const row = within(list).getByText(label, { exact: true }).closest("li");
  assert(row);
  return row;
}

export function detail(row: HTMLElement, label: string) {
  const value = within(row).getByText(label, { selector: "dt", exact: true }).nextElementSibling;
  assert(value);
  return value;
}

export function expectEligibilityUnverified() {
  expect(
    within(previewRegion()).getByText(
      "Planned template contents only. Current mappings and available features still need to be checked before applying this template.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("Ready to install")).not.toBeInTheDocument();
}
