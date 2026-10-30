import { eq } from "drizzle-orm";
import { importRows } from "@/db/schema";
import { commitRow, type ImportActor } from "./commit";
import { seedBatchWithRows, type TestDb } from "./pipedriveImport.testHelpers";

export async function runNote(db: TestDb, actor: ImportActor, primary: Record<string, unknown>) {
  const { rowIds } = await seedBatchWithRows(db, actor.id, {
    source: "pipedrive",
    target: "note",
    rows: [{ primary: { body: "Called, left voicemail", ...primary } }],
  });
  const rowId = rowIds[0] as string;
  const outcome = await commitRow(db, actor, rowId, "note", "skip", AbortSignal.timeout(20000));
  const [stored] = await db.select().from(importRows).where(eq(importRows.id, rowId));
  return { outcome, errors: stored?.errors ?? [], stored };
}
