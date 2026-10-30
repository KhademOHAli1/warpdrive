import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importExternalIds, leads, organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { commitBatch } from "./batch";
import { commitRow } from "./commit";
import { adminActorFor, seedBatchWithRows } from "./pipedriveImport.testHelpers";

const signal = new AbortController().signal;

const leadRow = (pipedriveId: string, title: string, extra: Record<string, unknown> = {}) => ({
  primary: { title, pipedriveId, value: null, expectedCloseDate: null, customFields: {}, ...extra },
  person: { name: "Lead Contact", pipedriveId: "p1" },
  organization: { name: "Lead Org", pipedriveId: "o1" },
});

it("imports a Pipedrive lead with labels, dates, archive state and linked contacts, once", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const rows = [
      leadRow("L1", "Warm lead", {
        labels: ["Hot", "Q1"],
        createdAt: "2026-01-01T00:00:00.000Z",
        archived: true,
      }),
      leadRow("L2", "Cold lead"),
    ];
    const first = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "lead",
      rows,
    });
    await commitBatch(db, actor, first.batchId, signal);

    const [warm] = await db.select().from(leads).where(eq(leads.title, "Warm lead"));
    const [cold] = await db.select().from(leads).where(eq(leads.title, "Cold lead"));
    const [person] = await db.select().from(persons);
    const [org] = await db.select().from(organizations);
    expect(warm?.labels).toEqual(["Hot", "Q1"]);
    expect(warm?.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(warm?.archivedAt).not.toBeNull();
    expect(warm?.personId).toBe(person?.id);
    expect(warm?.orgId).toBe(org?.id);
    expect(cold?.archivedAt).toBeNull();
    expect(cold?.personId).toBe(person?.id);
    expect(await db.select().from(persons)).toHaveLength(1);
    expect(
      await db.select().from(importExternalIds).where(eq(importExternalIds.entity, "lead")),
    ).toHaveLength(2);

    const again = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "lead",
      rows,
    });
    const outcomes = await Promise.all(
      again.rowIds.map((id) => commitRow(db, actor, id, "lead", "skip", signal)),
    );
    expect(outcomes.map((o) => (o.ok ? o.value.status : "err"))).toEqual([
      "skipped_duplicate",
      "skipped_duplicate",
    ]);
    expect(await db.select().from(leads)).toHaveLength(2);
  });
});

it("links the person of a generic CSV lead row", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const { rowIds } = await seedBatchWithRows(db, user.id, {
      source: "csv",
      target: "lead",
      rows: [
        {
          primary: { title: "CSV lead", customFields: {} },
          person: { name: "Csv Contact" },
        },
      ],
    });
    const rowId = rowIds[0] ?? "";
    const r = await commitRow(db, actor, rowId, "lead", "skip", signal);
    expect(r.ok && r.value.status).toBe("imported");
    const [lead] = await db.select().from(leads);
    const [person] = await db.select().from(persons);
    expect(lead?.personId).toBe(person?.id);
  });
});

it("rolls back the person a lead row created when the lead then fails", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const { rowIds } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "lead",
      rows: [leadRow("L9", "x".repeat(300))],
    });
    const rowId = rowIds[0] ?? "";
    const r = await commitRow(db, actor, rowId, "lead", "skip", signal);
    expect(r.ok && r.value.status).toBe("invalid");
    expect(await db.select().from(persons)).toHaveLength(0);
    expect(await db.select().from(organizations)).toHaveLength(0);
    expect(await db.select().from(leads)).toHaveLength(0);
  });
});
