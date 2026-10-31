import { eq } from "drizzle-orm";
import { deals, importExternalIds, importRows, leads, organizations, persons } from "@/db/schema";
import { seedPipelineWithStages } from "@/db/testing/factories";
import { commitRow, type ImportActor } from "./commit";
import { seedBatchWithRows, type TestDb } from "./pipedriveImport.testHelpers";

export async function runActivity(
  db: TestDb,
  actor: ImportActor,
  primary: Record<string, unknown>,
) {
  const { rowIds } = await seedBatchWithRows(db, actor.id, {
    source: "pipedrive",
    target: "activity",
    rows: [{ primary: { subject: "Call Acme", ...primary } }],
  });
  const rowId = rowIds[0] as string;
  const outcome = await commitRow(db, actor, rowId, "activity", "skip", AbortSignal.timeout(20000));
  const [stored] = await db.select().from(importRows).where(eq(importRows.id, rowId));
  return { outcome, errors: stored?.errors ?? [], warnings: stored?.warnings ?? [] };
}

export async function seedDeal(db: TestDb, ownerId: string, title: string) {
  const pipe = await seedPipelineWithStages(db, ["New"]);
  const [deal] = await db
    .insert(deals)
    .values({
      title,
      pipelineId: pipe.pipeline.id,
      stageId: pipe.stages[0]?.id as string,
      ownerId,
      visibilityLevel: "all",
    })
    .returning();
  return deal as typeof deals.$inferSelect;
}

export async function seedLead(db: TestDb, ownerId: string, title: string) {
  const [lead] = await db
    .insert(leads)
    .values({ title, ownerId, visibilityLevel: "all" })
    .returning();
  return lead as typeof leads.$inferSelect;
}

export async function seedPerson(db: TestDb, ownerId: string, name: string) {
  const [person] = await db
    .insert(persons)
    .values({ name, ownerId, visibilityLevel: "all" })
    .returning();
  return person as typeof persons.$inferSelect;
}

export async function seedOrg(db: TestDb, ownerId: string, name: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name, ownerId, visibilityLevel: "all" })
    .returning();
  return org as typeof organizations.$inferSelect;
}

export async function mapExternal(
  db: TestDb,
  userId: string,
  entity: "deal" | "lead" | "person" | "organization",
  externalId: string,
  localId: string,
) {
  const { batchId } = await seedBatchWithRows(db, userId, {
    source: "pipedrive",
    target: entity,
    rows: [],
  });
  await db
    .insert(importExternalIds)
    .values({ source: "pipedrive", entity, externalId, localId, batchId });
}
