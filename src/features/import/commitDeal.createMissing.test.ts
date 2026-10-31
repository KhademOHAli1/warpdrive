import { asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import type { ImportSource } from "@/constants/importSources";
import { deals, importRows, pipelines, stages } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { commitRow } from "./commit";
import {
  adminActorFor,
  regularActorFor,
  seedBatchWithRows,
  type TestDb,
} from "./pipedriveImport.testHelpers";

const signal = new AbortController().signal;

const dealRow = (title: string, pipeline: string | null, stage: string | null) => ({
  primary: {
    title,
    value: 1,
    expectedCloseDate: null,
    pipeline,
    stage,
    customFields: {},
  },
});

async function commitAll(
  db: TestDb,
  opts: {
    source?: ImportSource;
    createMissingStages: boolean;
    actor?: "admin" | "regular" | "manager";
    rows: ReturnType<typeof dealRow>[];
  },
) {
  const user = await seedUser(db);
  const actor =
    opts.actor === "regular"
      ? regularActorFor(user.id)
      : opts.actor === "manager"
        ? {
            ...regularActorFor(user.id),
            flags: new Set([
              "pipeline.manage" as const,
              "deal.create" as const,
              "contact.create" as const,
            ]),
          }
        : adminActorFor(user.id);
  const { rowIds } = await seedBatchWithRows(db, user.id, {
    source: opts.source ?? "pipedrive",
    target: "deal",
    rows: opts.rows,
    createMissingStages: opts.createMissingStages,
  });
  for (const rowId of rowIds) await commitRow(db, actor, rowId, "deal", "skip", signal);
  const rows = await db.select().from(importRows).orderBy(asc(importRows.rowNumber));
  return { rows, actor };
}

it("fails an unknown stage when the option is off", async () => {
  await withTestDb(async (db) => {
    const p = await seedPipelineWithStages(db, ["A"]);
    const { rows } = await commitAll(db, {
      createMissingStages: false,
      rows: [dealRow("d", p.pipeline.name, "Brand New")],
    });
    expect(rows[0]?.status).toBe("invalid");
    expect(await db.select().from(stages).where(eq(stages.name, "Brand New"))).toEqual([]);
  });
});

it("creates a missing stage once, appended after the last, when several rows name it", async () => {
  await withTestDb(async (db) => {
    const p = await seedPipelineWithStages(db, ["A", "B"]);
    const { rows } = await commitAll(db, {
      createMissingStages: true,
      rows: [
        dealRow("d1", p.pipeline.name, "Fresh"),
        dealRow("d2", p.pipeline.name, "fresh"),
        dealRow("d3", p.pipeline.name, "Later"),
      ],
    });
    expect(rows.map((r) => r.status)).toEqual(["imported", "imported", "imported"]);
    const all = await db
      .select()
      .from(stages)
      .where(eq(stages.pipelineId, p.pipeline.id))
      .orderBy(asc(stages.order));
    expect(all.map((s) => [s.name, s.order])).toEqual([
      ["A", 0],
      ["B", 1],
      ["Fresh", 2],
      ["Later", 3],
    ]);
    const placed = await db.select().from(deals).orderBy(asc(deals.title));
    expect(placed[0]?.stageId).toBe(placed[1]?.stageId);
  });
});

it("creates a missing pipeline after the last one and its stage", async () => {
  await withTestDb(async (db) => {
    const p = await seedPipelineWithStages(db, ["A"], { order: 4 });
    const { rows } = await commitAll(db, {
      createMissingStages: true,
      rows: [dealRow("d1", "Partners", "Intro"), dealRow("d2", "partners", "Intro")],
    });
    expect(rows.map((r) => r.status)).toEqual(["imported", "imported"]);
    const created = await db.select().from(pipelines).where(eq(pipelines.name, "Partners"));
    expect(created).toHaveLength(1);
    expect(created[0]?.order).toBe(5);
    expect(created[0]?.isArchived).toBe(false);
    expect(p.pipeline.order).toBe(4);
    const newStages = await db
      .select()
      .from(stages)
      .where(eq(stages.pipelineId, created[0]?.id ?? ""));
    expect(newStages.map((s) => [s.name, s.order])).toEqual([["Intro", 0]]);
  });
});

it("keeps the unknown-stage error for an actor without pipeline.manage", async () => {
  await withTestDb(async (db) => {
    const p = await seedPipelineWithStages(db, ["A"]);
    const { rows } = await commitAll(db, {
      createMissingStages: true,
      actor: "regular",
      rows: [dealRow("d", p.pipeline.name, "Brand New")],
    });
    expect(rows[0]?.status).toBe("invalid");
    expect(JSON.stringify(rows[0]?.errors)).toContain("unknown stage");
  });
});

it("creates for an actor holding pipeline.manage", async () => {
  await withTestDb(async (db) => {
    const p = await seedPipelineWithStages(db, ["A"]);
    const { rows } = await commitAll(db, {
      createMissingStages: true,
      actor: "manager",
      rows: [dealRow("d", p.pipeline.name, "Brand New")],
    });
    expect(rows[0]?.status).toBe("imported");
  });
});

it("never creates for a generic csv batch", async () => {
  await withTestDb(async (db) => {
    const p = await seedPipelineWithStages(db, ["A"]);
    const { rows } = await commitAll(db, {
      source: "csv",
      createMissingStages: true,
      rows: [dealRow("d", p.pipeline.name, "Brand New")],
    });
    expect(rows[0]?.status).toBe("invalid");
  });
});
