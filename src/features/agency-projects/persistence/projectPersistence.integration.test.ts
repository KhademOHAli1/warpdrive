import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
// Real DB fixture, kept in the integration lane by the @/test/db marker.
import { insertProject, schemaCase } from "./projectPersistence.seeds";

describe("Agency project persistence constraints", () => {
  it(
    "stores native UUID anchors with planned/revision0 and server timestamp defaults",
    schemaCase(async (f) => {
      const rows = await insertProject(f);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ revision: "0", state: "planned", archived_from: null });
      expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(rows[0]?.created_at).toBeInstanceOf(Date);
      expect(rows[0]?.updated_at).toBeInstanceOf(Date);
    }),
  );

  it.each([
    "",
    " ",
    " x ",
    "\u00a0x\u00a0",
    "x".repeat(161),
    "😀".repeat(161),
    "x\u0085y",
    "x\u2028y",
    "\u200b\u2060",
    "\u034f\u200d",
  ])("rejects an invalid stored title: %j", (title) =>
    schemaCase(async (f) => {
      await expect(insertProject(f, title)).rejects.toMatchObject({ code: "23514" });
    })(),
  );

  it.each(["😀".repeat(160), "می‌توانیم / Größe", "Studio\u200d Ä"])(
    "keeps valid codepoint-bounded multilingual titles: %j",
    (title) =>
      schemaCase(async (f) => {
        expect(await insertProject(f, title)).toHaveLength(1);
      })(),
  );

  it(
    "requires at least one real CRM anchor",
    schemaCase(async (f) => {
      await expect(
        f.db.pool.query("INSERT INTO agency_projects(title,owner_user_id) VALUES('Unlinked',$1)", [
          f.ownerId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    }),
  );

  it.each(["owner_user_id", "org_id", "person_id", "deal_id"] as const)(
    "rejects a dangling native %s",
    (column) =>
      schemaCase(async (f) => {
        const missing = randomUUID();
        const owner = column === "owner_user_id" ? missing : f.ownerId;
        const org = column === "org_id" ? missing : f.orgId;
        await expect(
          f.db.pool.query(
            `INSERT INTO agency_projects(title,owner_user_id,org_id,person_id,deal_id) VALUES('Linked',$1,$2,$3,$4)`,
            [
              owner,
              org,
              column === "person_id" ? missing : null,
              column === "deal_id" ? missing : null,
            ],
          ),
        ).rejects.toMatchObject({ code: "23503" });
      })(),
  );

  it.each(["-1", "9007199254740992"])("rejects unsafe revision %s", (revision) =>
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      await expect(
        f.db.pool.query("UPDATE agency_projects SET revision=$1 WHERE id=$2", [
          revision,
          project?.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    })(),
  );

  it(
    "retains MAX_SAFE_INTEGER exactly and enforces coherent archive state",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const result = await f.db.pool.query<{ revision: string }>(
        "UPDATE agency_projects SET revision=9007199254740991 WHERE id=$1 RETURNING revision::text",
        [project?.id],
      );
      expect(result.rows).toEqual([{ revision: "9007199254740991" }]);
      await expect(
        f.db.pool.query(
          "UPDATE agency_projects SET state='archived',archived_from=NULL WHERE id=$1",
          [project?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        f.db.pool.query(
          "UPDATE agency_projects SET state='active',archived_from='planned' WHERE id=$1",
          [project?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        f.db.pool.query("UPDATE agency_projects SET state='unknown' WHERE id=$1", [project?.id]),
      ).rejects.toMatchObject({ code: "23514" });
    }),
  );

  it(
    "uses explicit membership with independent default-false write flags",
    schemaCase(async (f) => {
      const [project] = await insertProject(f);
      const result = await f.db.pool.query<{
        project_edit: boolean;
        assignment_coordinate: boolean;
      }>(
        "INSERT INTO agency_project_members(project_id,user_id) VALUES($1,$2) RETURNING project_edit,assignment_coordinate",
        [project?.id, f.actorId],
      );
      expect(result.rows).toEqual([{ project_edit: false, assignment_coordinate: false }]);
      await expect(
        f.db.pool.query("INSERT INTO agency_project_members(project_id,user_id) VALUES($1,$2)", [
          project?.id,
          f.actorId,
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        f.db.pool.query("INSERT INTO agency_project_members(project_id,user_id) VALUES($1,$2)", [
          project?.id,
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: "23503" });
    }),
  );

  it(
    "preserves referenced staff and CRM records on hard-delete attempts",
    schemaCase(async (f) => {
      await insertProject(f);
      // Supported PG versions report this named RESTRICT fence with either SQLSTATE.
      const restrictViolation = expect.stringMatching(/^(?:23001|23503)$/u);
      await expect(
        f.db.pool.query("DELETE FROM organizations WHERE id=$1", [f.orgId]),
      ).rejects.toMatchObject({
        code: restrictViolation,
        constraint: "agency_projects_org_id_fkey",
      });
      expect(
        (await f.db.pool.query("SELECT id FROM organizations WHERE id=$1", [f.orgId])).rows,
      ).toEqual([{ id: f.orgId }]);
      await expect(
        f.db.pool.query("DELETE FROM users WHERE id=$1", [f.ownerId]),
      ).rejects.toMatchObject({
        code: restrictViolation,
        constraint: "agency_projects_owner_user_id_fkey",
      });
      expect((await f.db.pool.query("SELECT id FROM users WHERE id=$1", [f.ownerId])).rows).toEqual(
        [{ id: f.ownerId }],
      );
    }),
  );
});
