import type { ProjectListRequest } from "./persistence/projectListInput";
import type {
  ProjectListError,
  ProjectListItem,
  ProjectListPage,
} from "./persistence/projectListTypes";

export type ProjectListUiItem = Readonly<Pick<ProjectListItem, "id" | "title" | "state">>;
export type ProjectListUiPage = Readonly<{
  items: readonly ProjectListUiItem[];
  nextCursor: ProjectListPage["nextCursor"];
}>;

// Explicit transport/display minimization, not an authorization or linked-record admission.
export function projectListUiPage(page: ProjectListPage): ProjectListUiPage {
  return {
    items: page.items.map(({ id, title, state }) => ({ id, title, state })),
    nextCursor: page.nextCursor,
  };
}

export type ProjectListViewState = Readonly<{
  contextKey: string;
  requestId: string;
  request: ProjectListRequest;
}> &
  (
    | Readonly<{ kind: "loading" }>
    | Readonly<{ kind: "error"; error: ProjectListError }>
    | Readonly<{ kind: "ready"; page: ProjectListUiPage }>
  );

// Client-parent composition only. No requests, durable state, routes or native binding live here.
// The parent changes requestId for EVERY load/retry/filter/page/context attempt (including ABA),
// labels each result with its originally captured requestId/context/request, and ignores or
// aborts superseded I/O. UI provenance keys are not server authorization credentials.
export type ProjectListViewProps = Readonly<{
  canRead: boolean;
  contextKey: string;
  requestId: string;
  request: ProjectListRequest;
  view: ProjectListViewState | null;
  onRequestChange: (request: ProjectListRequest) => void;
  onRetry: (request: ProjectListRequest) => void;
  onOpenProject: (projectId: string) => void;
}>;
