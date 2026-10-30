import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importBatches, importRows } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { commitBatch, createBatch, setMapping, validateBatch } from "./batch";
import type { ImportActor } from "./commit";
import { adminActorFor, type TestDb } from "./pipedriveImport.testHelpers";
import type { ImportTarget } from "./wizardState";

const signal = new AbortController().signal;

async function runThroughValidationAndCommit(
  db: TestDb,
  actor: ImportActor,
  target: ImportTarget,
  fields: Record<string, string>,
  row: Record<string, string>,
) {
  const created = await createBatch(
    db,
    actor,
    { targetEntity: target, filename: "f.csv", rows: [row] },
    signal,
  );
  if (created.ok === false) throw new Error("createBatch failed");
  const { batchId } = created.value;
  await db.update(importBatches).set({ source: "pipedrive" }).where(eq(importBatches.id, batchId));
  const columns = Object.fromEntries(
    Object.entries(fields).map(([header, field]) => [
      header,
      { entity: target, field, isCustom: false, key: "" },
    ]),
  );
  await setMapping(db, actor, batchId, { dedupMode: "skip", columns }, signal);
  await validateBatch(db, actor, batchId, signal);
  const [validated] = await db.select().from(importRows).where(eq(importRows.batchId, batchId));
  await commitBatch(db, actor, batchId, signal);
  const [committed] = await db.select().from(importRows).where(eq(importRows.batchId, batchId));
  return { validated, committed };
}

it("commits a deal whose labels were normalized to an array by validation", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const p = await seedPipelineWithStages(db, ["Qualified"]);
    const { validated, committed } = await runThroughValidationAndCommit(
      db,
      adminActorFor(user.id),
      "deal",
      { ID: "pipedriveId", Title: "title", Labels: "labels", Pipeline: "pipeline" },
      { ID: "5", Title: "Deal", Labels: "VIP, Customer", Pipeline: p.pipeline.name },
    );
    expect(validated?.status).toBe("valid");
    expect(committed?.errors).toEqual([]);
    expect(committed?.status).toBe("imported");
  });
});

it("commits an activity whose done flag was normalized to a boolean by validation", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { validated, committed } = await runThroughValidationAndCommit(
      db,
      adminActorFor(user.id),
      "activity",
      { ID: "pipedriveId", Subject: "subject", Done: "done" },
      { ID: "8", Subject: "Call", Done: "yes" },
    );
    expect(validated?.status).toBe("valid");
    expect(committed?.errors).toEqual([]);
    expect(committed?.status).toBe("imported");
  });
});
