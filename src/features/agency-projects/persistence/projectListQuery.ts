import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { projectCreateInputSchema } from "../projectCreationInput";
import { canonicalUuidSchema, revisionSchema } from "../valueSchemas";
import { type ProjectListCursor, projectListCursorSchema } from "./projectListCursor";
import { PROJECT_LIST_STATE_ORDER, type ProjectListRequest } from "./projectListInput";
import type { ProjectListError, ProjectListItem, ProjectListReadContext } from "./projectListTypes";
import { projectListVisibility } from "./projectListVisibility";

const stateSchema = z.enum(PROJECT_LIST_STATE_ORDER);
const projectListRowSchema = z
  .strictObject({
    id: canonicalUuidSchema,
    title: projectCreateInputSchema.shape.title,
    ownerUserId: canonicalUuidSchema,
    state: stateSchema,
    revision: revisionSchema,
    archivedFrom: stateSchema.exclude(["archived"]).nullable(),
    dealId: canonicalUuidSchema.nullable(),
    personId: canonicalUuidSchema.nullable(),
    orgId: canonicalUuidSchema.nullable(),
    createdAt: projectListCursorSchema.shape.createdAt,
  })
  .refine((row) => (row.state === "archived") === (row.archivedFrom !== null))
  .refine((row) => row.dealId !== null || row.personId !== null || row.orgId !== null);
const projectListRowsSchema = z.array(projectListRowSchema);

function filterClause(request: ProjectListRequest): SQL {
  const filter = request.filters;
  const states = sql.join(
    filter.states.map((state) => sql`${state}`),
    sql`, `,
  );
  const owner =
    filter.ownerUserId === null
      ? sql`TRUE`
      : sql`project.owner_user_id=${filter.ownerUserId}::uuid`;
  let anchor = sql`TRUE`;
  if (filter.anchor !== null) {
    const selected = filter.anchor;
    switch (selected.kind) {
      case "deal":
        anchor = sql`project.deal_id=${selected.id}::uuid`;
        break;
      case "person":
        anchor = sql`project.person_id=${selected.id}::uuid`;
        break;
      case "organization":
        anchor = sql`project.org_id=${selected.id}::uuid`;
    }
  }
  return sql`project.state IN (${states}) AND ${owner} AND ${anchor}`;
}

export async function queryProjectList(
  context: ProjectListReadContext,
  request: ProjectListRequest,
  after: ProjectListCursor | null,
  signal: AbortSignal,
): Promise<Result<readonly ProjectListItem[], ProjectListError>> {
  signal.throwIfAborted();
  const keyset =
    after === null
      ? sql`TRUE`
      : sql`
    (project.created_at,project.id)<(${after.createdAt}::timestamptz,${after.id}::uuid)`;
  const result = await context.db.execute(sql`
    SELECT project.id,project.title,project.owner_user_id AS "ownerUserId",project.state,
      project.revision::float8 AS revision,project.archived_from AS "archivedFrom",
      project.deal_id AS "dealId",project.person_id AS "personId",project.org_id AS "orgId",
      CASE WHEN project.created_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
        AND project.created_at < TIMESTAMPTZ '10000-01-01 00:00:00+00'
      THEN to_char(project.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ELSE NULL END AS "createdAt"
    FROM agency_projects project
    WHERE ${projectListVisibility(context)} AND ${filterClause(request)} AND ${keyset}
    ORDER BY project.created_at DESC,project.id DESC
    LIMIT ${request.pageSize + 1}
  `);
  signal.throwIfAborted();
  // Decode once at the raw DB boundary. A bad row fails the page rather than being postfiltered.
  const decoded = projectListRowsSchema.safeParse(result.rows);
  return decoded.success ? ok(decoded.data) : err("unknown");
}
