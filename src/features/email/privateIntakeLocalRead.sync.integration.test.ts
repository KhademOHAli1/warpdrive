import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { runImapSyncJob } from "./imapSync";
import { privateDispatchRemoteSnapshot } from "./privateIntakeDispatchRestrictions.test-helpers";
import { replayPrivateLocalReadPage } from "./privateIntakeLocalRead.sync.test-helpers";
import {
  privateLocalReadFacts,
  privateLocalReadFixture,
  privateLocalReadRows,
} from "./privateIntakeLocalRead.test-helpers";

it.each([true, false])(
  "preserves a held copy's local choice through real IMAP flag delta and raw-page replay (read=%s)",
  async (read) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db);
      try {
        // Seed only the existing local preference, so the independent sync bug is
        // reachable even while the local action route itself still fails RED.
        if (read)
          await db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
            SELECT id,${f.owner.id},GREATEST(clock_timestamp(),last_message_at)
            FROM email_threads WHERE id=${f.threadId}`);
        else
          await db.execute(sql`DELETE FROM email_thread_reads
            WHERE thread_id=${f.threadId} AND user_id=${f.owner.id}`);
        const choice = await privateLocalReadRows(db, f);
        expect(choice).toHaveLength(read ? 1 : 0);
        const message = f.imap.state.folders.get("INBOX")?.messages[0];
        if (message === undefined)
          throw new AppError(ERROR_IDS.DB_INVARIANT, "Actual held INBOX message missing");
        // Flagged guarantees a real metadata delta in both cases. Remote Seen
        // deliberately disagrees with the owner's independent local choice.
        message.flags = read ? ["\\Flagged"] : ["\\Seen", "\\Flagged"];
        const remote = privateDispatchRemoteSnapshot(f);
        const before = await privateLocalReadFacts(db, f);
        const priorCommands = f.imap.state.commands.length;
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: f.args.signal },
            {
              loadConnection: () => Promise.resolve(ok(f.runtime)),
            },
          ),
        ).toMatchObject({ ok: true, value: { applied: 0, stale: false } });
        const locator = await db.execute(sql`SELECT l.flags,l.active FROM mail_message_locators l
          JOIN mail_folders p ON p.id=l.folder_id AND p.account_id=l.account_id
          WHERE l.account_id=${f.accountId} AND p.path='INBOX' AND l.uid=1`);
        expect(locator.rows).toEqual([{ flags: message.flags, active: true }]);
        expect.soft(await privateLocalReadRows(db, f)).toEqual(choice);
        expect.soft(await privateLocalReadFacts(db, f)).toEqual(before);
        await replayPrivateLocalReadPage(db, f);
        expect.soft(await privateLocalReadRows(db, f)).toEqual(choice);
        expect.soft(await privateLocalReadFacts(db, f)).toEqual(before);
        expect(f.imap.state.commands.slice(priorCommands)).not.toContain("STORE");
        expect(f.imap.state.commands.slice(priorCommands)).not.toContain("MOVE");
        expect(f.append).not.toHaveBeenCalled();
        expect(f.smtp.received).toHaveLength(1);
        expect(privateDispatchRemoteSnapshot(f)).toEqual(remote);
      } finally {
        await f.close();
      }
    });
  },
);
