import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
// Real PostgreSQL through @/test/db, including the existing native-user reset pattern.
import { createHistory, insertProject, schemaCase } from "./projectPersistence.seeds";

describe("Agency audit immutability and legacy empty-database reset", () => {
  it(
    "allows existing native-user fixture reset while the Agency audit tables are unused",
    schemaCase(async (f) => {
      await expect(
        f.db.pool.query("TRUNCATE users RESTART IDENTITY CASCADE"),
      ).resolves.toMatchObject({ command: "TRUNCATE" });
      const remaining = await f.db.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM users",
      );
      expect(remaining.rows).toEqual([{ count: "0" }]);
    }),
  );

  it(
    "blocks the same cascade once immutable project history exists",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      await createHistory(f, project?.id ?? "");
      await expect(
        f.db.pool.query("TRUNCATE users RESTART IDENTITY CASCADE"),
      ).rejects.toMatchObject({ code: "23514" });
      const remaining = await f.db.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM agency_project_history",
      );
      expect(remaining.rows).toEqual([{ count: "1" }]);
    }),
  );

  it(
    "keeps a disposed receipt identity when its table is targeted directly",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const [history] = await createHistory(f, project?.id ?? "");
      await f.db.pool.query(
        "INSERT INTO agency_project_requests(actor_user_id,operation,intent_id,project_id,result_revision,history_id,payload_state,private_payload,key_id) VALUES($1,'create',$2,$3,0,$4,'disposed',NULL,NULL)",
        [f.actorId, randomUUID(), project?.id, history?.id],
      );
      await expect(f.db.pool.query("TRUNCATE agency_project_requests")).rejects.toMatchObject({
        code: "23514",
      });
      const remaining = await f.db.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM agency_project_requests",
      );
      expect(remaining.rows).toEqual([{ count: "1" }]);
    }),
  );

  it(
    "preserves a receipt committed after an older Repeatable Read snapshot",
    schemaCase(async (f) => {
      const older = await f.db.pool.connect();
      try {
        await older.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await older.query("SET LOCAL statement_timeout='2s'");
        const before = await older.query<{ count: string }>(
          "SELECT count(*)::text FROM agency_project_requests",
        );
        expect(before.rows).toEqual([{ count: "0" }]);
        const [project] = await insertProject(f);
        const [history] = await createHistory(f, project?.id ?? "");
        await f.db.pool.query(
          "INSERT INTO agency_project_requests(actor_user_id,operation,intent_id,project_id,result_revision,history_id,payload_state,private_payload,key_id) VALUES($1,'create',$2,$3,0,$4,'disposed',NULL,NULL)",
          [f.actorId, randomUUID(), project?.id, history?.id],
        );
        const stale = await older.query<{ count: string }>(
          "SELECT count(*)::text FROM agency_project_requests",
        );
        expect(stale.rows).toEqual([{ count: "0" }]);
        await expect(older.query("TRUNCATE agency_project_requests")).rejects.toMatchObject({
          code: "23514",
        });
      } finally {
        try {
          await older.query("ROLLBACK");
        } finally {
          older.release();
        }
      }
      const retained = await f.db.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM agency_project_requests",
      );
      expect(retained.rows).toEqual([{ count: "1" }]);
    }),
  );
});
