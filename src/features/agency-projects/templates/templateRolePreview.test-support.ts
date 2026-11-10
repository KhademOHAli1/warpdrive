import { expect } from "vitest";
import { readStarterTemplate } from "./starterTemplates";
import { parseTemplateManifestJson } from "./templateManifest";
import type { TemplateManifest } from "./templateManifestSchemas";

export const userId = "abcdefab-1234-4abc-8def-1234567890ab";
export const otherUserId = "bcdefabc-2345-4bcd-9efa-234567890abc";
export const personId = "cdefabcd-3456-4cde-abcd-345678901abc";
const otherPersonId = "defabcde-4567-4def-bcde-456789012abc";
export const invalid = { ok: false, error: "invalid_template_bindings" };
export const offset = (days: number) => ({ basis: "calendar-days", anchor: "project-start", days });

export function withManifest(
  run: (manifest: TemplateManifest) => void,
  change?: (manifest: TemplateManifest) => void,
) {
  return () => {
    const starter = readStarterTemplate("campaign_content");
    expect(starter.ok).toBe(true);
    if (!starter.ok) return;
    const source = starter.value;
    source.templateId = "role_preview";
    source.version = 7;
    source.roles.push(
      {
        id: "reviewer",
        kind: "internal-producer",
        label: { fa: "بازبین", de: "Prüfung", en: "Reviewer" },
      },
      {
        id: "unused",
        kind: "internal-producer",
        label: { fa: "نقش آزاد", de: "Freie Rolle", en: "Unused role" },
      },
    );
    for (const intent of source.intents) {
      if (intent.id === "brief_followup") intent.dueOffset.days = -1;
      if (intent.kind === "review" && intent.id === "design_review")
        intent.assigneeRoleId = "reviewer";
    }
    change?.(source);
    const parsed = parseTemplateManifestJson(JSON.stringify(source));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    run(parsed.value);
  };
}

export function mappings() {
  return [
    { roleId: "editor", kind: "external-contact", personId: otherPersonId },
    { roleId: "reviewer", kind: "internal-user", userId: otherUserId },
    { roleId: "designer", kind: "external-contact", personId: personId.toUpperCase() },
    { roleId: "producer", kind: "internal-user", userId: userId.toUpperCase() },
  ];
}

export const expectedUses = {
  producer: [
    {
      kind: "deliverable",
      deliverableId: "campaign_design",
      stageId: "production",
      field: "responsibleRoleId",
    },
    {
      kind: "deliverable",
      deliverableId: "campaign_cut",
      stageId: "production",
      field: "responsibleRoleId",
    },
    {
      kind: "follow-up",
      intentId: "brief_followup",
      stageId: "briefing",
      field: "assigneeRoleId",
    },
    {
      kind: "assignment",
      intentId: "design_assignment",
      stageId: "production",
      deliverableId: "campaign_design",
      field: "internalProducerRoleId",
    },
    {
      kind: "assignment",
      intentId: "video_assignment",
      stageId: "production",
      deliverableId: "campaign_cut",
      field: "internalProducerRoleId",
    },
    {
      kind: "follow-up",
      intentId: "client_update_followup",
      stageId: "production",
      field: "assigneeRoleId",
    },
    {
      kind: "review",
      intentId: "video_review",
      stageId: "internal_review",
      deliverableId: "campaign_cut",
      field: "assigneeRoleId",
    },
  ],
  designer: [
    {
      kind: "assignment",
      intentId: "design_assignment",
      stageId: "production",
      deliverableId: "campaign_design",
      field: "freelancerRoleId",
    },
  ],
  editor: [
    {
      kind: "assignment",
      intentId: "video_assignment",
      stageId: "production",
      deliverableId: "campaign_cut",
      field: "freelancerRoleId",
    },
  ],
  reviewer: [
    {
      kind: "review",
      intentId: "design_review",
      stageId: "internal_review",
      deliverableId: "campaign_design",
      field: "assigneeRoleId",
    },
  ],
  unused: [],
};

export const expectedUnmappedRoles = [
  { roleId: "producer", roleKind: "internal-producer", binding: null, uses: expectedUses.producer },
  {
    roleId: "designer",
    roleKind: "freelancer-contact",
    binding: null,
    uses: expectedUses.designer,
  },
  { roleId: "editor", roleKind: "freelancer-contact", binding: null, uses: expectedUses.editor },
  { roleId: "reviewer", roleKind: "internal-producer", binding: null, uses: expectedUses.reviewer },
  { roleId: "unused", roleKind: "internal-producer", binding: null, uses: [] },
];
export const expectedMappedBindings = [
  { roleId: "producer", binding: { kind: "internal-user", userId } },
  { roleId: "designer", binding: { kind: "external-contact", personId } },
  { roleId: "editor", binding: { kind: "external-contact", personId: otherPersonId } },
  { roleId: "reviewer", binding: { kind: "internal-user", userId: otherUserId } },
  { roleId: "unused", binding: null },
];
export const expectedOffsets = [
  { intentId: "brief_followup", dueOffset: offset(-1) },
  { intentId: "design_assignment", dueOffset: offset(4) },
  { intentId: "video_assignment", dueOffset: offset(5) },
  { intentId: "client_update_followup", dueOffset: offset(3) },
  { intentId: "design_review", dueOffset: offset(6) },
  { intentId: "video_review", dueOffset: offset(6) },
];

export function invalidRoleSelections() {
  const one = { roleId: "producer", kind: "internal-user", userId };
  return [
    [one, one],
    [one, { ...one, userId: otherUserId }],
    [{ ...one, roleId: "missing" }],
    [{ ...one, roleId: "Producer" }],
    [{ roleId: "producer", kind: "external-contact", personId }],
    [{ roleId: "designer", kind: "internal-user", userId }],
  ];
}

export function malformedBindings() {
  const one = { roleId: "producer", kind: "internal-user", userId };
  return [
    null,
    undefined,
    {},
    "producer",
    { bindings: [] },
    [null],
    [{ ...one, userId: "same-name" }],
    [{ ...one, userId: undefined }],
    [{ roleId: "designer", kind: "external-contact", personId: "shared@example.invalid" }],
    [{ ...one, kind: "freelancer-contact" }],
    [{ ...one, personId }],
    [{ ...one, authorized: true }],
    [{ ...one, canInstall: true }],
    [{ ...one, action: "activate" }],
    [{ ...one, displayName: "Same name" }],
  ];
}

export function objectsIn(value: unknown): object[] {
  if (value === null || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(objectsIn)];
}
