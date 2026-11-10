import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deals } from "@/db/schema/deals";
import { seedUser } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";
import {
  addReadMember,
  listFixture,
  listRequest,
  listSuccess,
  seedListCrm,
  seedListProject,
} from "./projectList.test-support";
import { PROJECT_LIST_STATE_ORDER } from "./projectListInput";
import { createProjectListRepository } from "./projectListRepository";
import { schemaCase } from "./projectPersistence.seeds";

// Real fixture/schema/SQL only; injected authority and Privacy ceilings are synthetic.
describe("private native project-list access and filtering", () => {
  it(
    "fails closed without a production read binding and leaves existing data untouched",
    schemaCase(async (f) => {
      const project = await seedListProject(f);
      expect(await createProjectListRepository().list(listRequest(), f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect(await createProjectListRepository(null).list(listRequest(), f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      const database: TestDb = f.db;
      const stored = await database.db.execute<{ id: string }>(sql`SELECT id FROM agency_projects`);
      expect(stored.rows).toEqual([{ id: project.id }]);
    }),
  );

  it(
    "allows the owner and a read-only member, with no outsider or native-admin local bypass",
    schemaCase(async (f) => {
      const project = await seedListProject(f);
      await addReadMember(f, project.id, f.actorId);
      const outsider = await seedUser(f.db.db);
      const admin = await seedUser(f.db.db, { isAdmin: true });
      for (const actorId of [f.ownerId, f.actorId]) {
        const page = listSuccess(
          await listFixture(f, { actorId, privacyCeiling: sql`TRUE` }).repository.list(
            listRequest(),
            f.signal,
          ),
        );
        expect(page).toEqual({
          items: [
            {
              id: project.id,
              title: project.title,
              ownerUserId: f.ownerId,
              state: "planned",
              revision: 0,
              archivedFrom: null,
              dealId: null,
              personId: null,
              orgId: f.orgId,
              createdAt: "2024-01-01T00:00:00.000000Z",
            },
          ],
          nextCursor: null,
        });
      }
      for (const actorId of [outsider.id, admin.id]) {
        expect(
          listSuccess(
            await listFixture(f, { actorId, privacyCeiling: sql`TRUE` }).repository.list(
              listRequest(),
              f.signal,
            ),
          ),
        ).toEqual({ items: [], nextCursor: null });
      }
    }),
  );

  it(
    "requires every explicit deal, person and organization link independently",
    schemaCase(async (f) => {
      const crm = await seedListCrm(f);
      const project = await seedListProject(f, { dealId: crm.deal.id, personId: crm.person.id });
      const { repository } = listFixture(f, { privacyCeiling: sql`TRUE` });
      expect(
        listSuccess(await repository.list(listRequest(), f.signal)).items.map((item) => item.id),
      ).toEqual([project.id]);
      for (const change of [
        { table: "deals", id: crm.deal.id },
        { table: "persons", id: crm.person.id },
        { table: "organizations", id: f.orgId },
      ]) {
        // Table names are a closed fixture literal set; all row values remain parameters.
        await f.db.pool.query(`UPDATE ${change.table} SET visibility_level='owner' WHERE id=$1`, [
          change.id,
        ]);
        expect(listSuccess(await repository.list(listRequest(), f.signal))).toEqual({
          items: [],
          nextCursor: null,
        });
        await f.db.pool.query(`UPDATE ${change.table} SET visibility_level='all' WHERE id=$1`, [
          change.id,
        ]);
        expect(
          listSuccess(await repository.list(listRequest(), f.signal)).items.map((item) => item.id),
        ).toEqual([project.id]);
      }
    }),
  );

  it(
    "keeps won/lost CRM rows unchanged and excludes deleted or archived CRM contexts",
    schemaCase(async (f) => {
      const won = await seedListCrm(f, "won");
      const lost = await seedListCrm(f, "lost");
      const wonProject = await seedListProject(f, { dealId: won.deal.id, personId: won.person.id });
      const lostProject = await seedListProject(f, {
        dealId: lost.deal.id,
        personId: lost.person.id,
      });
      const archivedAt = new Date("2025-05-18T10:11:12.345Z");
      await f.db.pool.query("UPDATE deals SET archived_at=$2 WHERE id=$1", [
        won.deal.id,
        archivedAt,
      ]);
      const before = await f.db.db.select().from(deals).orderBy(deals.id);
      expect(before.find((deal) => deal.id === won.deal.id)).toMatchObject({
        status: "won",
        wonTime: new Date("2025-05-17T10:11:12.345Z"),
        lostTime: null,
        archivedAt,
      });
      expect(before.find((deal) => deal.id === lost.deal.id)).toMatchObject({
        status: "lost",
        lostTime: new Date("2025-05-17T10:11:12.345Z"),
        wonTime: null,
      });
      const { repository } = listFixture(f, { privacyCeiling: sql`TRUE` });
      const initial = listSuccess(await repository.list(listRequest(), f.signal));
      expect(initial.items.map((item) => item.id).sort()).toEqual(
        [wonProject.id, lostProject.id].sort(),
      );
      expect(await f.db.db.select().from(deals).orderBy(deals.id)).toEqual(before);
      for (const change of [
        {
          set: "UPDATE deals SET deleted_at=now() WHERE id=$1",
          reset: "UPDATE deals SET deleted_at=NULL WHERE id=$1",
          id: won.deal.id,
          remaining: 1,
        },
        {
          set: "UPDATE persons SET deleted_at=now() WHERE id=$1",
          reset: "UPDATE persons SET deleted_at=NULL WHERE id=$1",
          id: won.person.id,
          remaining: 1,
        },
        {
          set: "UPDATE organizations SET deleted_at=now() WHERE id=$1",
          reset: "UPDATE organizations SET deleted_at=NULL WHERE id=$1",
          id: f.orgId,
          remaining: 0,
        },
        {
          set: "UPDATE pipelines SET is_archived=true WHERE id=$1",
          reset: "UPDATE pipelines SET is_archived=false WHERE id=$1",
          id: won.pipeline.id,
          remaining: 1,
        },
      ]) {
        await f.db.pool.query(change.set, [change.id]);
        const beforeRead = await f.db.db.select().from(deals).orderBy(deals.id);
        const page = listSuccess(await repository.list(listRequest(), f.signal));
        expect(await f.db.db.select().from(deals).orderBy(deals.id)).toEqual(beforeRead);
        expect(page.items).toHaveLength(change.remaining);
        expect(page.items.map((item) => item.id)).not.toContain(wonProject.id);
        await f.db.pool.query(change.reset, [change.id]);
      }
      // The fixture's own delete/reset writes advance the current native write-version trigger.
      // Every list call above separately proves that its reads preserve the complete current row.
      const after = await f.db.db.select().from(deals).orderBy(deals.id);
      const businessFields = (rows: typeof before) =>
        rows.map((row) => ({ ...row, writeVersion: null }));
      expect(businessFields(after)).toEqual(businessFields(before));
    }),
  );

  it(
    "applies the injected Privacy ceiling even to owners and rejects incoherent or dead contexts",
    schemaCase(async (f) => {
      const allowed = await seedListProject(f, { title: "Visible synthetic title" });
      await seedListProject(f, { title: "Privacy withheld synthetic title" });
      expect(
        listSuccess(
          await listFixture(f, { privacyCeiling: sql`FALSE` }).repository.list(
            listRequest(),
            f.signal,
          ),
        ),
      ).toEqual({ items: [], nextCursor: null });
      const partial = listFixture(f, {
        privacyCeiling: sql`project.title <> ${"Privacy withheld synthetic title"}`,
      });
      expect(
        listSuccess(await partial.repository.list(listRequest(), f.signal)).items.map(
          (item) => item.id,
        ),
      ).toEqual([allowed.id]);
      for (const visibility of [
        { userId: f.actorId },
        { isActive: false },
        { sessionLive: false },
        { isAdmin: true },
      ]) {
        expect(
          await listFixture(f, { privacyCeiling: sql`TRUE`, visibility }).repository.list(
            listRequest(),
            f.signal,
          ),
        ).toEqual({ ok: false, error: "project_unavailable" });
      }
    }),
  );

  it(
    "combines normalized state, owner and each anchor filter without broadening defaults",
    schemaCase(async (f) => {
      const crm = await seedListCrm(f);
      const seeded = [];
      for (const state of PROJECT_LIST_STATE_ORDER) {
        seeded.push({
          state,
          ...(await seedListProject(f, {
            state,
            dealId: state === "active" ? crm.deal.id : null,
            personId: state === "planned" ? crm.person.id : null,
          })),
        });
      }
      const otherOwner = await seedListProject(f, { ownerUserId: f.actorId, state: "active" });
      await addReadMember(f, otherOwner.id, f.ownerId);
      const { repository } = listFixture(f, { privacyCeiling: sql`TRUE` });
      const defaultPage = listSuccess(await repository.list(listRequest(), f.signal));
      expect(defaultPage.items.map((item) => item.id).sort()).toEqual(
        [
          ...seeded
            .filter((item) => ["planned", "active", "on-hold"].includes(item.state))
            .map((item) => item.id),
          otherOwner.id,
        ].sort(),
      );
      const owned = listSuccess(
        await repository.list(
          listRequest({ schemaVersion: 1, states: ["active"], ownerUserId: f.actorId }),
          f.signal,
        ),
      );
      expect(owned.items.map((item) => item.id)).toEqual([otherOwner.id]);
      for (const [kind, id, state] of [
        ["deal", crm.deal.id, "active"],
        ["person", crm.person.id, "planned"],
      ] as const) {
        const expected: { id: string } | undefined = seeded.find((item) => item.state === state);
        assert(expected);
        const page = listSuccess(
          await repository.list(listRequest({ schemaVersion: 1, anchor: { kind, id } }), f.signal),
        );
        expect(page.items.map((item) => item.id)).toEqual([expected.id]);
      }
      const all = listSuccess(
        await repository.list(
          listRequest({
            schemaVersion: 1,
            states: [...PROJECT_LIST_STATE_ORDER],
            anchor: { kind: "organization", id: f.orgId },
          }),
          f.signal,
        ),
      );
      expect(all.items).toHaveLength(7);
      expect(all.items.find((item) => item.state === "archived")).toMatchObject({
        archivedFrom: "planned",
      });
      const conjunction = listSuccess(
        await repository.list(
          listRequest({
            schemaVersion: 1,
            states: ["active"],
            ownerUserId: f.actorId,
            anchor: { kind: "deal", id: crm.deal.id },
          }),
          f.signal,
        ),
      );
      expect(conjunction).toEqual({ items: [], nextCursor: null });
    }),
  );
});
