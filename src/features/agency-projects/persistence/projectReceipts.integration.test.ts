import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
// Real DB fixture, kept in the integration lane by the @/test/db marker.
import {
  createHistory,
  insertProject,
  type ProjectSchemaFixture,
  schemaCase,
} from "./projectPersistence.seeds";

async function insertRequest(
  f: ProjectSchemaFixture,
  projectId: string,
  historyId: string,
  intentId: string,
  revision = "0",
) {
  f.signal.throwIfAborted();
  const result = await f.db.pool.query(
    "INSERT INTO agency_project_requests(actor_user_id,operation,intent_id,project_id,result_revision,history_id,payload_state,private_payload,key_id) VALUES($1,'create',$2,$3,$4,$5,'retained',$6,$7)",
    [
      f.actorId,
      intentId,
      projectId,
      revision,
      historyId,
      Buffer.from("synthetic opaque fixture, not production ciphertext"),
      "synthetic-test-key",
    ],
  );
  f.signal.throwIfAborted();
  return result;
}

describe("Agency immutable history and private receipt identity", () => {
  it(
    "stores coherent create/start facts and defaults recorded time",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const created = await createHistory(f, project?.id ?? "");
      expect(created).toHaveLength(1);
      const result = await f.db.pool.query<{ revision: string; recorded_at: Date }>(
        "INSERT INTO agency_project_history(project_id,recorded_by_user_id,operation,policy_version,previous_revision,revision,previous_state,state,previous_archived_from,archived_from) VALUES($1,$2,'start',1,0,1,'planned','active',NULL,NULL) RETURNING revision::text,recorded_at",
        [project?.id, f.actorId],
      );
      expect(result.rows[0]?.revision).toBe("1");
      expect(result.rows[0]?.recorded_at).toBeInstanceOf(Date);
    }),
  );

  it(
    "rejects duplicate history revisions and changes to stored facts",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const [history] = await createHistory(f, project?.id ?? "");
      await expect(createHistory(f, project?.id ?? "")).rejects.toMatchObject({ code: "23505" });
      await expect(
        f.db.pool.query("UPDATE agency_project_history SET recorded_by_user_id=$1 WHERE id=$2", [
          f.ownerId,
          history?.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        f.db.pool.query("DELETE FROM agency_project_history WHERE id=$1", [history?.id]),
      ).rejects.toMatchObject({ code: "23514" });
    }),
  );

  it.each(["unknown", "start-at-zero", "wrong-start-state"])(
    "rejects incoherent history encoding: %s",
    (kind) =>
      schemaCase(async (f) => {
        const [project] = await insertProject(f);
        const operation = kind === "unknown" ? "unknown" : "start";
        const revision = kind === "start-at-zero" ? 0 : 1;
        const state = kind === "wrong-start-state" ? "completed" : "active";
        await expect(
          f.db.pool.query(
            "INSERT INTO agency_project_history(project_id,recorded_by_user_id,operation,policy_version,previous_revision,revision,previous_state,state) VALUES($1,$2,$3,1,0,$4,'planned',$5)",
            [project?.id, f.actorId, operation, revision, state],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      })(),
  );

  it(
    "binds each request to the same project, result revision and history row",
    schemaCase(async (f) => {
      const [first] = await insertProject(f);
      const [second] = await insertProject(f);
      const [history] = await createHistory(f, first?.id ?? "");
      await createHistory(f, second?.id ?? "");
      await expect(
        insertRequest(f, second?.id ?? "", history?.id ?? "", randomUUID()),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        insertRequest(f, first?.id ?? "", history?.id ?? "", randomUUID(), "1"),
      ).rejects.toMatchObject({ code: "23503" });
    }),
  );

  it(
    "binds the request actor to its immutable event recorder",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const [history] = await createHistory(f, project?.id ?? "");
      await expect(
        insertRequest(
          { ...f, actorId: f.ownerId },
          project?.id ?? "",
          history?.id ?? "",
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "23503" });
    }),
  );

  it(
    "binds the request operation to its history operation",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const [history] = await createHistory(f, project?.id ?? "");
      await expect(
        f.db.pool.query(
          "INSERT INTO agency_project_requests(actor_user_id,operation,intent_id,project_id,result_revision,history_id,payload_state,private_payload,key_id) VALUES($1,'start',$2,$3,0,$4,'retained',$5,'synthetic-test-key')",
          [f.actorId, randomUUID(), project?.id, history?.id, Buffer.from("synthetic")],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    }),
  );

  it(
    "scopes a request intent to its native actor and operation",
    schemaCase(async (f) => {
      const [first] = await insertProject(f);
      const [second] = await insertProject(f);
      const [firstHistory] = await createHistory(f, first?.id ?? "");
      const [secondHistory] = await createHistory({ ...f, actorId: f.ownerId }, second?.id ?? "");
      const intent = randomUUID();
      await insertRequest(f, first?.id ?? "", firstHistory?.id ?? "", intent);
      await insertRequest(
        { ...f, actorId: f.ownerId },
        second?.id ?? "",
        secondHistory?.id ?? "",
        intent,
      );
      const started = await f.db.pool.query<{ id: string }>(
        "INSERT INTO agency_project_history(project_id,recorded_by_user_id,operation,policy_version,previous_revision,revision,previous_state,state) VALUES($1,$2,'start',1,0,1,'planned','active') RETURNING id",
        [first?.id, f.actorId],
      );
      await f.db.pool.query(
        "INSERT INTO agency_project_requests(actor_user_id,operation,intent_id,project_id,result_revision,history_id,payload_state,private_payload,key_id) VALUES($1,'start',$2,$3,1,$4,'retained',$5,'synthetic-test-key')",
        [f.actorId, intent, first?.id, started.rows[0]?.id, Buffer.from("synthetic")],
      );
      const result = await f.db.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM agency_project_requests WHERE intent_id=$1",
        [intent],
      );
      expect(result.rows).toEqual([{ count: "3" }]);
    }),
  );

  it.each(["cleared", "unreadable", "disposed"] as const)(
    "preserves the intent tombstone after payload becomes %s",
    (state) =>
      schemaCase(async (f) => {
        const [project] = await insertProject(f);
        const [history] = await createHistory(f, project?.id ?? "");
        const intent = randomUUID();
        await insertRequest(f, project?.id ?? "", history?.id ?? "", intent);
        await f.db.pool.query(
          "UPDATE agency_project_requests SET payload_state=$1,private_payload=NULL WHERE actor_user_id=$2 AND operation='create' AND intent_id=$3",
          [state, f.actorId, intent],
        );
        await expect(
          insertRequest(f, project?.id ?? "", history?.id ?? "", intent),
        ).rejects.toMatchObject({ code: "23505" });
        const row = await f.db.pool.query<{
          payload_state: string;
          private_payload: Buffer | null;
        }>(
          "SELECT payload_state,private_payload FROM agency_project_requests WHERE actor_user_id=$1 AND operation='create' AND intent_id=$2",
          [f.actorId, intent],
        );
        expect(row.rows).toEqual([{ payload_state: state, private_payload: null }]);
        await expect(
          f.db.pool.query(
            "DELETE FROM agency_project_requests WHERE actor_user_id=$1 AND operation='create' AND intent_id=$2",
            [f.actorId, intent],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      })(),
  );

  it(
    "requires private retained bytes/key identity and freezes receipt identity",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const [history] = await createHistory(f, project?.id ?? "");
      const intent = randomUUID();
      await insertRequest(f, project?.id ?? "", history?.id ?? "", intent);
      await expect(
        f.db.pool.query(
          "UPDATE agency_project_requests SET private_payload=NULL WHERE actor_user_id=$1 AND intent_id=$2",
          [f.actorId, intent],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        f.db.pool.query(
          "UPDATE agency_project_requests SET key_id='' WHERE actor_user_id=$1 AND intent_id=$2",
          [f.actorId, intent],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        f.db.pool.query(
          "UPDATE agency_project_requests SET intent_id=$1 WHERE actor_user_id=$2 AND intent_id=$3",
          [randomUUID(), f.actorId, intent],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }),
  );
});
