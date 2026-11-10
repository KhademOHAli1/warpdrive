import { err, ok, type Result } from "@/types/result";
import { decodeProjectListCursor, encodeProjectListCursor } from "./projectListCursor";
import { type ProjectListRequest, projectListFilterKey } from "./projectListInput";
import { queryProjectList } from "./projectListQuery";
import type {
  ProjectListError,
  ProjectListPage,
  ProjectListReadContext,
  ProjectListReadPort,
} from "./projectListTypes";

function captureRequest(request: ProjectListRequest): ProjectListRequest {
  const filter = request.filters;
  return {
    filters: {
      ...filter,
      states: [...filter.states],
      anchor: filter.anchor === null ? null : { ...filter.anchor },
    },
    pageSize: request.pageSize,
    cursor: request.cursor,
  };
}

function coherentContext(context: ProjectListReadContext): boolean {
  const { actor, crmVisibility } = context;
  return (
    actor.isActive &&
    crmVisibility.isActive &&
    crmVisibility.sessionLive &&
    actor.id === crmVisibility.userId &&
    (actor.type === "admin") === crmVisibility.isAdmin
  );
}

export function createProjectListRepository(port: ProjectListReadPort | null = null) {
  return {
    async list(
      request: ProjectListRequest,
      signal: AbortSignal,
    ): Promise<Result<ProjectListPage, ProjectListError>> {
      signal.throwIfAborted();
      // The trusted ingress request is copied, not reparsed, before the binding can yield.
      const captured = captureRequest(request);
      const filterKey = projectListFilterKey(captured.filters);
      const decoded =
        captured.cursor === null ? ok(null) : decodeProjectListCursor(captured.cursor, filterKey);
      if (!decoded.ok) return decoded;
      if (port === null) return err("project_unavailable");
      const after = decoded.value;
      try {
        const result = await port.run<ProjectListPage>(signal, async (context) => {
          signal.throwIfAborted();
          if (!coherentContext(context)) return err("project_unavailable");
          const queried = await queryProjectList(context, captured, after, signal);
          signal.throwIfAborted();
          if (!queried.ok) return queried;
          const items = queried.value.slice(0, captured.pageSize);
          const last = items.at(-1);
          const nextCursor =
            queried.value.length > captured.pageSize && last !== undefined
              ? encodeProjectListCursor({
                  schemaVersion: 1,
                  createdAt: last.createdAt,
                  id: last.id,
                  filterKey,
                })
              : null;
          return ok({ items, nextCursor });
        });
        signal.throwIfAborted();
        return result;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        signal.throwIfAborted();
        return err("unknown");
      }
    },
  };
}
