import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { TestDb } from "@/test/db";
import {
  addReadMember,
  listFixture,
  listRequest,
  listSuccess,
  SYNTHETIC_PRIVACY_CEILING,
  seedListCrm,
  seedListOrganization,
  seedListProject,
} from "./projectList.test-support";
import { decodeProjectListCursor } from "./projectListCursor";
import { projectListFilterKey } from "./projectListInput";
import { schemaCase } from "./projectPersistence.seeds";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "11111111-1111-4111-8111-111111111112";
const ID3 = "11111111-1111-4111-8111-111111111113";
const ID4 = "11111111-1111-4111-8111-111111111114";

// Actual PostgreSQL paging, distinct from the pure cursor codec cases. Admissions remain synthetic.
describe("private native project-list continuation", () => {
  it(
    "orders PostgreSQL microsecond neighbors and equal-time UUID ties without skips",
    schemaCase(async (f) => {
      await seedListProject(f, { id: ID1, createdAt: "2024-01-01T00:00:00.000001Z" });
      await seedListProject(f, { id: ID2, createdAt: "2024-01-01T00:00:00.000001Z" });
      await seedListProject(f, { id: ID3, createdAt: "2024-01-01T00:00:00.000002Z" });
      await seedListProject(f, { id: ID4, createdAt: "2024-01-01T00:00:00.000000Z" });
      const database: TestDb = f.db;
      const nativeTimes = await database.db.execute<{ id: string; created_at: string }>(sql`
      SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM agency_projects ORDER BY created_at DESC,id DESC
    `);
      expect(nativeTimes.rows).toEqual([
        { id: ID3, created_at: "2024-01-01T00:00:00.000002Z" },
        { id: ID2, created_at: "2024-01-01T00:00:00.000001Z" },
        { id: ID1, created_at: "2024-01-01T00:00:00.000001Z" },
        { id: ID4, created_at: "2024-01-01T00:00:00.000000Z" },
      ]);
      const { repository } = listFixture(f, { privacyCeiling: sql`TRUE` });
      const request = listRequest({ schemaVersion: 1 }, 2);
      const first = listSuccess(await repository.list(request, f.signal));
      expect(first.items.map((item) => [item.id, item.createdAt])).toEqual([
        [ID3, "2024-01-01T00:00:00.000002Z"],
        [ID2, "2024-01-01T00:00:00.000001Z"],
      ]);
      assert(typeof first.nextCursor === "string" && first.nextCursor.length > 0);
      expect(
        decodeProjectListCursor(first.nextCursor, projectListFilterKey(request.filters)),
      ).toEqual({
        ok: true,
        value: {
          schemaVersion: 1,
          id: ID2,
          createdAt: "2024-01-01T00:00:00.000001Z",
          filterKey: projectListFilterKey(request.filters),
        },
      });
      const second = listSuccess(
        await repository.list({ ...request, cursor: first.nextCursor }, f.signal),
      );
      expect(second.items.map((item) => [item.id, item.createdAt])).toEqual([
        [ID1, "2024-01-01T00:00:00.000001Z"],
        [ID4, "2024-01-01T00:00:00.000000Z"],
      ]);
      expect(second.nextCursor).toBeNull();
    }),
  );

  it(
    "filters hidden rows before LIMIT and cursors from the last emitted row rather than lookahead",
    schemaCase(async (f) => {
      await seedListProject(f, {
        ownerUserId: f.actorId,
        createdAt: "2024-01-11T00:00:00.000000Z",
      });
      const a = await seedListProject(f, { createdAt: "2024-01-10T00:00:00.000000Z" });
      const crm = await seedListCrm(f);
      await f.db.pool.query("UPDATE persons SET visibility_level='owner' WHERE id=$1", [
        crm.person.id,
      ]);
      await seedListProject(f, {
        personId: crm.person.id,
        createdAt: "2024-01-09T00:00:00.000000Z",
      });
      const b = await seedListProject(f, { createdAt: "2024-01-08T00:00:00.000000Z" });
      await seedListProject(f, {
        title: "Synthetic denied",
        createdAt: "2024-01-07T00:00:00.000000Z",
      });
      const c = await seedListProject(f, { createdAt: "2024-01-06T00:00:00.000000Z" });
      const { repository } = listFixture(f, {
        privacyCeiling: sql`project.title <> ${"Synthetic denied"}`,
      });
      const request = listRequest({ schemaVersion: 1 }, 2);
      const first = listSuccess(await repository.list(request, f.signal));
      expect(first.items.map((item) => item.id)).toEqual([a.id, b.id]);
      assert(typeof first.nextCursor === "string" && first.nextCursor.length > 0);
      const decoded = listSuccess(
        decodeProjectListCursor(first.nextCursor, projectListFilterKey(request.filters)),
      );
      expect(decoded).toMatchObject({ id: b.id, createdAt: b.createdAt });
      const second = listSuccess(
        await repository.list({ ...request, cursor: first.nextCursor }, f.signal),
      );
      expect(second).toMatchObject({ items: [{ id: c.id }], nextCursor: null });
    }),
  );

  it(
    "reapplies current membership, CRM visibility and the database-backed synthetic Privacy ceiling on page two",
    schemaCase(async (f) => {
      const head = await seedListProject(f, { createdAt: "2024-01-10T00:00:00.000000Z" });
      const member = await seedListProject(f, {
        ownerUserId: f.actorId,
        createdAt: "2024-01-09T00:00:00.000000Z",
      });
      await addReadMember(f, member.id, f.ownerId);
      const crm = await seedListCrm(f);
      await seedListProject(f, {
        personId: crm.person.id,
        createdAt: "2024-01-08T00:00:00.000000Z",
      });
      const privateOrg = await seedListOrganization(f, "synthetic-privacy-allowed");
      await seedListProject(f, { orgId: privateOrg.id, createdAt: "2024-01-07T00:00:00.000000Z" });
      const tail = await seedListProject(f, { createdAt: "2024-01-06T00:00:00.000000Z" });
      const { repository } = listFixture(f, { privacyCeiling: SYNTHETIC_PRIVACY_CEILING });
      const first = listSuccess(
        await repository.list(listRequest({ schemaVersion: 1 }, 1), f.signal),
      );
      expect(first.items.map((item) => item.id)).toEqual([head.id]);
      assert(typeof first.nextCursor === "string" && first.nextCursor.length > 0);
      await f.db.pool.query(
        "DELETE FROM agency_project_members WHERE project_id=$1 AND user_id=$2",
        [member.id, f.ownerId],
      );
      await f.db.pool.query("UPDATE persons SET visibility_level='owner' WHERE id=$1", [
        crm.person.id,
      ]);
      await f.db.pool.query(
        "UPDATE organizations SET name='synthetic-privacy-denied' WHERE id=$1",
        [privateOrg.id],
      );
      const second = listSuccess(
        await repository.list(listRequest({ schemaVersion: 1 }, 10, first.nextCursor), f.signal),
      );
      expect(second).toMatchObject({ items: [{ id: tail.id }], nextCursor: null });
      const stored = await f.db.pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM agency_projects",
      );
      expect(stored.rows).toEqual([{ count: "5" }]);
    }),
  );

  it(
    "retains createdAt ordering after edits and excludes a newer insert from an existing continuation",
    schemaCase(async (f) => {
      const firstProject = await seedListProject(f, { createdAt: "2024-01-03T00:00:00.000003Z" });
      const middle = await seedListProject(f, { createdAt: "2024-01-02T00:00:00.000002Z" });
      const last = await seedListProject(f, { createdAt: "2024-01-01T00:00:00.000001Z" });
      const { repository } = listFixture(f, { privacyCeiling: sql`TRUE` });
      const first = listSuccess(
        await repository.list(listRequest({ schemaVersion: 1 }, 1), f.signal),
      );
      expect(first.items.map((item) => item.id)).toEqual([firstProject.id]);
      assert(typeof first.nextCursor === "string" && first.nextCursor.length > 0);
      await f.db.pool.query(
        "UPDATE agency_projects SET title='Edited synthetic project',state='active',revision=1,updated_at=now() WHERE id=$1",
        [firstProject.id],
      );
      const newer = await seedListProject(f, { createdAt: "2025-01-01T00:00:00.000001Z" });
      const second = listSuccess(
        await repository.list(listRequest({ schemaVersion: 1 }, 2, first.nextCursor), f.signal),
      );
      expect(second.items.map((item) => item.id)).toEqual([middle.id, last.id]);
      expect(second.nextCursor).toBeNull();
      const fresh = listSuccess(
        await repository.list(listRequest({ schemaVersion: 1 }, 10), f.signal),
      );
      expect(fresh.items.map((item) => item.id)).toEqual([
        newer.id,
        firstProject.id,
        middle.id,
        last.id,
      ]);
      expect(fresh.items.find((item) => item.id === firstProject.id)).toMatchObject({
        title: "Edited synthetic project",
        state: "active",
        revision: 1,
        createdAt: firstProject.createdAt,
      });
    }),
  );

  it(
    "fails the whole page for PostgreSQL BC or five-digit years rather than reinterpreting or skipping them",
    schemaCase(async (f) => {
      const invalid = await seedListProject(f);
      await seedListProject(f, { createdAt: "2024-01-02T00:00:00.000001Z" });
      const { repository } = listFixture(f, { privacyCeiling: sql`TRUE` });
      for (const [timestamp, year] of [
        ["0001-01-01 00:00:00 BC", "-1"],
        ["10000-01-01 00:00:00", "10000"],
      ]) {
        await f.db.pool.query(
          "UPDATE agency_projects SET created_at=($1::timestamp AT TIME ZONE 'UTC') WHERE id=$2",
          [timestamp, invalid.id],
        );
        const native = await f.db.pool.query<{ year: string }>(
          "SELECT EXTRACT(YEAR FROM created_at AT TIME ZONE 'UTC')::text AS year FROM agency_projects WHERE id=$1",
          [invalid.id],
        );
        expect(native.rows).toEqual([{ year }]);
        expect(await repository.list(listRequest(), f.signal)).toEqual({
          ok: false,
          error: "unknown",
        });
      }
    }),
  );

  it(
    "rejects a valid continuation under changed filters and rejects malformed native-list cursors",
    schemaCase(async (f) => {
      await seedListProject(f, { createdAt: "2024-01-02T00:00:00.000000Z" });
      await seedListProject(f, { createdAt: "2024-01-01T00:00:00.000000Z" });
      const { repository } = listFixture(f, { privacyCeiling: sql`TRUE` });
      const first = listSuccess(
        await repository.list(listRequest({ schemaVersion: 1 }, 1), f.signal),
      );
      assert(typeof first.nextCursor === "string" && first.nextCursor.length > 0);
      expect(
        await repository.list(
          listRequest({ schemaVersion: 1, ownerUserId: f.ownerId }, 1, first.nextCursor),
          f.signal,
        ),
      ).toEqual({ ok: false, error: "invalid_project_list_input" });
      expect(
        await repository.list(listRequest({ schemaVersion: 1 }, 1, "not-a-valid-cursor"), f.signal),
      ).toEqual({ ok: false, error: "invalid_project_list_input" });
    }),
  );
});
