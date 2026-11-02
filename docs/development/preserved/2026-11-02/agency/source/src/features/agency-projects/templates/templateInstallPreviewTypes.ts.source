import type { TemplateManifest } from "./templateManifestSchemas";

export type TemplatePreviewTarget = Readonly<{
  projectId: string;
  templateId: string;
  version: number;
  selectionKey: string;
}>;

export type TemplateInstallPreviewData = Readonly<{
  contextKey: string;
  target: TemplatePreviewTarget;
  manifest: TemplateManifest;
  bindings: unknown;
  projectStart: unknown;
  userLabels: Readonly<Record<string, string>>;
  personLabels: Readonly<Record<string, string>>;
}>;

// The parent rotates selectionKey whenever the draft, template, bindings or start changes.
// One authorized packet binds identity labels and inputs to that exact selection. These
// client presentation gates neither authenticate the actor nor establish install eligibility.
export type TemplateInstallPreviewProps = Readonly<{
  contextKey: string;
  target: TemplatePreviewTarget | null;
  canRead: boolean;
  data: TemplateInstallPreviewData | null;
}>;
