import type { SQL } from "drizzle-orm";
import type { PermSetUser } from "@/features/permissions/effective";
import type { VisibilityCtx } from "@/features/permissions/sql";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { Result } from "@/types/result";
import type { ProjectSnapshot } from "../projectLifecycle";

export type ProjectListError = "invalid_project_list_input" | "project_unavailable" | "unknown";

export type ProjectListItem = ProjectSnapshot &
  Readonly<{
    id: string;
    title: string;
    ownerUserId: string;
    dealId: string | null;
    personId: string | null;
    orgId: string | null;
    // Exact PostgreSQL UTC projection with six fractional digits, never a JavaScript Date.
    createdAt: string;
  }>;

export type ProjectListPage = Readonly<{
  items: readonly ProjectListItem[];
  nextCursor: string | null;
}>;

export type ProjectListReadContext = Readonly<{
  db: DbOrTx;
  actor: PermSetUser;
  crmVisibility: VisibilityCtx;
  // Trusted SQL for every applicable linked-record Privacy ceiling, using alias `project`.
  // There is deliberately no permissive default and no browser-supplied SQL/permission input.
  privacyCeiling: SQL;
}>;

/**
 * Feature-owned injection contract, not a supplied production authority implementation.
 * The binding derives the current authenticated accepted actor, live session and enabled module,
 * acquires the participating native authority fence and supplies coherent current CRM facts and
 * all required Privacy SQL ceilings. Keep that authority through the read/transaction completion,
 * without session/CRM/Privacy touches. Failed Results roll back; all I/O must remain bounded and
 * signal-aware. Browser IDs, permission booleans and per-row capped postfilters cannot bind this.
 */
export type ProjectListReadPort = {
  run: <T>(
    signal: AbortSignal,
    read: (context: ProjectListReadContext) => Promise<Result<T, ProjectListError>>,
  ) => Promise<Result<T, ProjectListError>>;
};
