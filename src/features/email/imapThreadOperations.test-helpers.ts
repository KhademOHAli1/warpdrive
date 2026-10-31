import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";

export async function imapOperationsFixture(db: Db) {
  const f = await imapSyncFixture(db);
  f.server.state.folders.set("Trash", {
    validity: "789",
    readOnly: false,
    messages: [],
    specialUse: "\\Trash",
  });
  f.server.state.folders.set("Archiv", { validity: "987", readOnly: false, messages: [] });
  const signal = AbortSignal.timeout(30000);
  const imported = await runImapSyncJob(
    db,
    { accountId: f.accountId, now: IMAP_SYNC_NOW, signal },
    f.deps,
  );
  if (!imported.ok) throw imported.error;
  const [thread] = (
    await db.execute(sql`SELECT id FROM email_threads WHERE account_id=${f.accountId}`)
  ).rows;
  if (typeof thread?.id !== "string")
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing thread fixture");
  const actor: AuthUser = { id: f.owner.id, type: "regular", isActive: true, groupIds: new Set() };
  return { ...f, threadId: thread.id, actor, signal };
}
