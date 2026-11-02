import { randomUUID } from "node:crypto";
import { seedUser } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";
import { makeProjectPersistenceDb } from "./projectPersistence.test-support";

export type ProjectSchemaFixture = {
  db: TestDb;
  actorId: string;
  ownerId: string;
  orgId: string;
  signal: AbortSignal;
};

export function schemaCase(body: (fixture: ProjectSchemaFixture) => Promise<void>) {
  return async () => {
    const controller = new AbortController();
    const db = await makeProjectPersistenceDb(controller.signal);
    try {
      const actor = await seedUser(db.db);
      controller.signal.throwIfAborted();
      const owner = await seedUser(db.db);
      controller.signal.throwIfAborted();
      const orgId = randomUUID();
      await db.pool.query(
        "INSERT INTO organizations(id,name,owner_id,visibility_level) VALUES($1,$2,$3,'all')",
        [orgId, "Synthetic client / آزمایشی", actor.id],
      );
      controller.signal.throwIfAborted();
      await body({ db, actorId: actor.id, ownerId: owner.id, orgId, signal: controller.signal });
    } finally {
      controller.abort();
      await db.close();
    }
  };
}

export async function insertProject(f: ProjectSchemaFixture, title = "Studio Ä / استودیو") {
  f.signal.throwIfAborted();
  const result = await f.db.pool.query<{
    id: string;
    revision: string;
    state: string;
    archived_from: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    "INSERT INTO agency_projects(title,owner_user_id,org_id) VALUES($1,$2,$3) RETURNING id,revision::text,state,archived_from,created_at,updated_at",
    [title, f.ownerId, f.orgId],
  );
  f.signal.throwIfAborted();
  return result.rows;
}

export async function createHistory(f: ProjectSchemaFixture, projectId: string) {
  f.signal.throwIfAborted();
  const result = await f.db.pool.query<{ id: string }>(
    "INSERT INTO agency_project_history(project_id,recorded_by_user_id,operation,policy_version,previous_revision,revision,previous_state,state,previous_archived_from,archived_from) VALUES($1,$2,'create',1,NULL,0,NULL,'planned',NULL,NULL) RETURNING id",
    [projectId, f.actorId],
  );
  f.signal.throwIfAborted();
  return result.rows;
}
