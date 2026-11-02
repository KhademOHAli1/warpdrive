import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { getThread } from "./emailReads";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";

it.each(["writable", "readonly", "disconnected", "shared"] as const)(
  "projects honest per-viewer mail operation capabilities (%s)",
  async (kind) => {
    await withTestDb(async (db) => {
      const f = await imapOperationsFixture(db);
      try {
        await db.execute(
          sql`UPDATE email_accounts SET capabilities='{"read":true,"send":true,"markRead":true,"move":true,"trash":true}'::jsonb WHERE id=${f.accountId}`,
        );
        if (kind === "readonly")
          await db.execute(
            sql`UPDATE mail_folders SET read_only=true WHERE account_id=${f.accountId}`,
          );
        if (kind === "disconnected")
          await db.execute(
            sql`UPDATE email_accounts SET status='disconnected' WHERE id=${f.accountId}`,
          );
        let actor = f.actor;
        if (kind === "shared") {
          const viewer = await seedUser(db);
          const [person] = (
            await db.execute(
              sql`INSERT INTO persons(name,owner_id,visibility_level)VALUES('Synthetic contact',${f.owner.id},'all')RETURNING id`,
            )
          ).rows;
          if (typeof person?.id !== "string") throw new Error("Missing contact");
          await db.execute(
            sql`UPDATE email_threads SET visibility='shared',person_id=${person.id} WHERE id=${f.threadId}`,
          );
          actor = { ...actor, id: viewer.id };
        }
        const result = await getThread(
          db,
          { actor, threadId: f.threadId, allowRemote: false },
          f.signal,
        );
        expect(result).toMatchObject({
          ok: true,
          value: {
            mailCapabilities: {
              read: true,
              send: kind === "writable" || kind === "readonly",
              markRead: kind === "writable" || kind === "shared",
              move: kind === "writable",
              trash: kind === "writable",
            },
          },
        });
      } finally {
        await f.server.close();
      }
    });
  },
);
