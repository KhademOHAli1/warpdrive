import { describe, expect, it } from "vitest";
import type { TestDb } from "@/test/db";
import { schemaCase } from "./projectPersistence.seeds";

const WORKFLOW_0098_HASH = "ba65deaf21f4f5c38cd7414afd851f91a14b5c2aed3e758bb75b36b56b3a63ef";
const AGENCY_TABLES = [
  "agency_project_history",
  "agency_project_members",
  "agency_project_requests",
  "agency_projects",
];

// Fixture admission only: this does not establish Workflow business behavior, an installed
// upgrade, native Agency authority or Privacy admission. The private overlay is not journaled.
describe("canonical0098 fixture admission", () => {
  it(
    "retains 99 canonical receipts through0098 and exposes the four private Agency tables",
    schemaCase(async (f) => {
      const database: TestDb = f.db;
      f.signal.throwIfAborted();
      const receipts = await database.pool.query<{
        count: string;
        latest_hash: string | null;
      }>(`
        SELECT count(*)::text AS count,
          (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1) AS latest_hash
        FROM drizzle.__drizzle_migrations
      `);
      f.signal.throwIfAborted();
      expect(receipts.rows).toEqual([{ count: "99", latest_hash: WORKFLOW_0098_HASH }]);

      const tables = await database.pool.query<{ table_name: string }>(
        `SELECT relation.relname::text AS table_name
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public' AND relation.relkind='r'
           AND relation.relname::text=ANY($1::text[])
         ORDER BY relation.relname::text COLLATE "C"`,
        [AGENCY_TABLES],
      );
      f.signal.throwIfAborted();
      expect(tables.rows).toEqual(AGENCY_TABLES.map((table_name) => ({ table_name })));
    }),
  );
});
