import { render } from "@testing-library/react";
import { vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { ProjectListView } from "./ProjectListView";
import { projectListRequestSchema } from "./persistence/projectListInput";
import type { ProjectListPage } from "./persistence/projectListTypes";
import { type ProjectListViewProps, projectListUiPage } from "./projectListUiTypes";

export const listProjectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const listOwnerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const listOrgId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const listTitle = "Private Studio / استودیو Ä";
export const listCursor = "opaque-current-continuation";

export const repositoryPage: ProjectListPage = {
  items: [
    {
      id: listProjectId,
      title: listTitle,
      ownerUserId: listOwnerId,
      state: "planned",
      revision: 4,
      archivedFrom: null,
      dealId: null,
      personId: null,
      orgId: listOrgId,
      createdAt: "2026-11-02T08:00:00.000001Z",
    },
  ],
  nextCursor: listCursor,
};

export function listViewProps(overrides: Partial<ProjectListViewProps> = {}): ProjectListViewProps {
  const request =
    overrides.request ?? projectListRequestSchema.parse({ filters: { schemaVersion: 1 } });
  const contextKey = overrides.contextKey ?? "permitted-context-1";
  const requestId = overrides.requestId ?? "request-1";
  return {
    canRead: true,
    contextKey,
    requestId,
    request,
    view: {
      contextKey,
      requestId,
      request,
      kind: "ready",
      page: projectListUiPage(repositoryPage),
    },
    onRequestChange: vi.fn(),
    onRetry: vi.fn(),
    onOpenProject: vi.fn(),
    ...overrides,
  };
}

export function listView(props: ProjectListViewProps, locale: Locale = "en") {
  return (
    <LocaleProvider locale={locale} numberingSystem="latn" timeZone="UTC">
      <ProjectListView {...props} />
    </LocaleProvider>
  );
}

export function renderListView(props = listViewProps(), locale: Locale = "en") {
  return render(listView(props, locale));
}
