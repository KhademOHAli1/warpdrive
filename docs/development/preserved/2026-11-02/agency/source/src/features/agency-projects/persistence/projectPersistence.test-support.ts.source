import { makeTestDb, type TestDb } from "@/test/db";

// Keep the native testPg channel and real clone/pool; never import the application DB singleton.
export async function makeProjectPersistenceDb(signal: AbortSignal): Promise<TestDb> {
  signal.throwIfAborted();
  const database = await makeTestDb();
  if (signal.aborted) {
    await database.close();
    signal.throwIfAborted();
  }
  return database;
}
