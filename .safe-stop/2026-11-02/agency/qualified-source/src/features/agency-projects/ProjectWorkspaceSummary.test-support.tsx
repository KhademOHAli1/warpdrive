import { render } from "@testing-library/react";
import { vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import {
  type ProjectStartOutcome,
  ProjectWorkspaceSummary,
  type ProjectWorkspaceSummaryProps,
} from "./ProjectWorkspaceSummary";

export const workspaceProjectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const workspaceIntentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function workspaceProps(
  overrides: Partial<ProjectWorkspaceSummaryProps> = {},
): ProjectWorkspaceSummaryProps {
  return {
    contextKey: "actor-and-project-1",
    draft: {
      contextKey: "actor-and-project-1",
      input: { projectId: workspaceProjectId, intentId: workspaceIntentId, expectedRevision: 0 },
      attempt: null,
    },
    project: {
      id: workspaceProjectId,
      title: "Private Studio / استودیو",
      ownerUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      dealId: null,
      personId: null,
      orgId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      state: "planned",
      revision: 0,
      archivedFrom: null,
      createdAt: new Date("2026-11-01T08:00:00Z"),
      updatedAt: new Date("2026-11-01T08:00:00Z"),
    },
    ownerLabel: "Sara رضایی",
    contextLabel: "Synthetic CRM client",
    canRead: true,
    canStart: true,
    onDraftChange: vi.fn(),
    start: vi.fn(() => new Promise<ProjectStartOutcome>(() => undefined)),
    refresh: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    onStarted: vi.fn(),
    ...overrides,
  };
}

export function workspaceView(props: ProjectWorkspaceSummaryProps, locale: Locale = "en") {
  return (
    <LocaleProvider locale={locale} numberingSystem="latn" timeZone="UTC">
      <ProjectWorkspaceSummary {...props} />
    </LocaleProvider>
  );
}

export function renderWorkspace(props = workspaceProps(), locale: Locale = "en") {
  return render(workspaceView(props, locale));
}
