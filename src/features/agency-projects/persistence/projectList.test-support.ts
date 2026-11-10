import assert from "node:assert/strict";
import { type SQL, sql } from "drizzle-orm";
import { deals } from "@/db/schema/deals";
import { organizations } from "@/db/schema/organizations";
import { persons } from "@/db/schema/persons";
import { seedPipelineWithStages } from "@/db/testing/factories";
import type { VisibilityCtx } from "@/features/permissions/sql";
import { hydrateActor } from "@/server/hydrateActor";
import type { Result } from "@/types/result";
import { projectListRequestSchema } from "./projectListInput";
import { createProjectListRepository } from "./projectListRepository";
import type {
  ProjectListError,
  ProjectListItem,
  ProjectListReadContext,
  ProjectListReadPort,
} from "./projectListTypes";
import { insertProject, type ProjectSchemaFixture } from "./projectPersistence.seeds";

// Real PostgreSQL business reads with synthetic admissions only. sessionLive and privacyCeiling
// below are explicit fixture inputs, not native credential/module/fence/Privacy authority proof.
export function listFixture(
  f: ProjectSchemaFixture,
  options: {
    actorId?: string;
    privacyCeiling: SQL;
    visibility?: Partial<VisibilityCtx>;
  },
) {
  const calls = { runs: 0 };
  const port: ProjectListReadPort = {
    async run<T>(
      signal: AbortSignal,
      read: (context: ProjectListReadContext) => Promise<Result<T, ProjectListError>>,
    ): Promise<Result<T, ProjectListError>> {
      signal.throwIfAborted();
      calls.runs++;
      return f.db.db.transaction(async (tx) => {
        const actor = await hydrateActor(tx, options.actorId ?? f.ownerId, signal);
        assert(actor, "Expected the seeded active native user");
        const result = await read({
          db: tx,
          actor,
          crmVisibility: {
            userId: actor.id,
            isAdmin: actor.type === "admin",
            isActive: actor.isActive,
            sessionLive: true,
            groupIds: [...actor.groupIds],
            ...options.visibility,
          },
          privacyCeiling: options.privacyCeiling,
        });
        signal.throwIfAborted();
        return result;
      });
    },
  };
  return { repository: createProjectListRepository(port), calls };
}

export function listRequest(
  filters: unknown = { schemaVersion: 1 },
  pageSize = 25,
  cursor: string | null = null,
) {
  return projectListRequestSchema.parse({ filters, pageSize, cursor });
}

export function listSuccess<T>(result: Result<T, unknown>): T {
  assert(result.ok, "Expected a successful project-list result");
  return result.value;
}

export async function seedListProject(
  f: ProjectSchemaFixture,
  options: {
    id?: string;
    title?: string;
    ownerUserId?: string;
    state?: ProjectListItem["state"];
    revision?: number;
    archivedFrom?: ProjectListItem["archivedFrom"];
    dealId?: string | null;
    personId?: string | null;
    orgId?: string | null;
    createdAt?: string;
  } = {},
) {
  const title = options.title ?? "Synthetic project / پروژه Ä";
  const [inserted] = await insertProject(f, title);
  assert(inserted);
  const id = options.id ?? inserted.id;
  const state = options.state ?? "planned";
  const createdAt = options.createdAt ?? "2024-01-01T00:00:00.000000Z";
  await f.db.pool.query(
    "UPDATE agency_projects SET id=$2,owner_user_id=$3,state=$4,revision=$5,archived_from=$6,deal_id=$7,person_id=$8,org_id=$9,created_at=$10::timestamptz,updated_at=$10::timestamptz WHERE id=$1",
    [
      inserted.id,
      id,
      options.ownerUserId ?? f.ownerId,
      state,
      options.revision ?? 0,
      options.archivedFrom ?? (state === "archived" ? "planned" : null),
      options.dealId ?? null,
      options.personId ?? null,
      options.orgId === undefined ? f.orgId : options.orgId,
      createdAt,
    ],
  );
  f.signal.throwIfAborted();
  return { id, title, createdAt };
}

export async function addReadMember(f: ProjectSchemaFixture, projectId: string, userId: string) {
  await f.db.pool.query(
    "INSERT INTO agency_project_members(project_id,user_id,project_edit,assignment_coordinate) VALUES($1,$2,false,false)",
    [projectId, userId],
  );
  f.signal.throwIfAborted();
}

export async function seedListCrm(
  f: ProjectSchemaFixture,
  status: "open" | "won" | "lost" = "open",
) {
  const { pipeline, stages } = await seedPipelineWithStages(f.db.db, ["Qualified"]);
  const stage = stages[0];
  assert(stage);
  const [person] = await f.db.db
    .insert(persons)
    .values({
      name: "Synthetic contact / مخاطب",
      ownerId: f.actorId,
      orgId: f.orgId,
      visibilityLevel: "all",
    })
    .returning();
  assert(person);
  const terminal = new Date("2025-05-17T10:11:12.345Z");
  const [deal] = await f.db.db
    .insert(deals)
    .values({
      title: `Synthetic ${status} deal`,
      status,
      ownerId: f.actorId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      personId: person.id,
      orgId: f.orgId,
      visibilityLevel: "all",
      value: "48750.25",
      currency: "EUR",
      wonTime: status === "won" ? terminal : null,
      lostTime: status === "lost" ? terminal : null,
      lostReason: status === "lost" ? "Synthetic deferral" : null,
    })
    .returning();
  assert(deal);
  f.signal.throwIfAborted();
  return { deal, person, pipeline };
}

export async function seedListOrganization(f: ProjectSchemaFixture, name: string) {
  const [organization] = await f.db.db
    .insert(organizations)
    .values({
      name,
      ownerId: f.actorId,
      visibilityLevel: "all",
    })
    .returning();
  assert(organization);
  f.signal.throwIfAborted();
  return organization;
}

// The existing canonical organization name is deliberately a synthetic mutable test switch.
// This is not a claimed production Privacy policy, restriction store or native Privacy adapter.
export const SYNTHETIC_PRIVACY_CEILING = sql`NOT EXISTS (
  SELECT 1 FROM organizations privacy_fixture_org
  WHERE privacy_fixture_org.id = project.org_id
    AND privacy_fixture_org.name = 'synthetic-privacy-denied'
)`;
