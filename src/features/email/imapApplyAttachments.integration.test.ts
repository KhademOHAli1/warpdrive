import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";
import { buildMime } from "./mime";

it("preserves stored snapshots with one-to-one matching for identical attachments", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db);
    try {
      const inbox = f.server.state.folders.get("INBOX");
      const sent = f.server.state.folders.get("Sent");
      const reply = inbox?.messages[2];
      if (inbox === undefined || sent === undefined || reply === undefined)
        throw new Error("Missing fixture folders");
      const bytes = Buffer.from("%PDF-1.7 synthetic");
      reply.source = Buffer.from(
        buildMime({
          from: "client@mail.test",
          to: [f.runtime.emailAddress],
          subject: "پیشنهاد / Angebot",
          text: "Vielen Dank",
          html: "<p>Vielen Dank</p>",
          messageId: "<reply@mail.test>",
          attachments: [1, 2].map(() => ({
            filename: "پیشنهاد.pdf",
            contentType: "application/pdf",
            bytes,
          })),
        }),
      );
      expect(
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: AbortSignal.timeout(30000), now: IMAP_SYNC_NOW },
          f.deps,
        ),
      ).toMatchObject({ ok: true });
      const snapshot = {
        kind: "stored",
        objectKey: "synthetic-snapshot",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      await db.execute(
        sql`UPDATE email_message_attachments SET provider_locator=${JSON.stringify(snapshot)}::jsonb WHERE account_id=${f.accountId}`,
      );
      sent.messages = [{ ...reply, uid: 1 }];
      f.runtime.folderPaths = ["Sent"];
      expect(
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: AbortSignal.timeout(30000), now: IMAP_SYNC_NOW },
          f.deps,
        ),
      ).toMatchObject({ ok: true });
      const rows = (
        await db.execute(
          sql`SELECT provider_locator FROM email_message_attachments WHERE account_id=${f.accountId}`,
        )
      ).rows;
      expect(rows).toEqual([{ provider_locator: snapshot }, { provider_locator: snapshot }]);
    } finally {
      await f.server.close();
    }
  });
});

it.each(["missing", "epoch"] as const)(
  "keeps exact-copy attachments available after the preferred copy changes (%s)",
  async (change) => {
    await withTestDb(async (db) => {
      const f = await imapSyncFixture(db, ["INBOX", "Sent"]);
      try {
        const inbox = f.server.state.folders.get("INBOX");
        const sent = f.server.state.folders.get("Sent");
        const reply = inbox?.messages[2];
        if (inbox === undefined || sent === undefined || reply === undefined)
          throw new Error("Missing fixture folders");
        sent.messages = [{ ...reply, uid: 1 }];
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: AbortSignal.timeout(30000), now: IMAP_SYNC_NOW },
            f.deps,
          ),
        ).toMatchObject({ ok: true });
        expect(
          (
            await db.execute(
              sql`SELECT provider_locator->>'folderPath' AS path FROM email_message_attachments WHERE account_id=${f.accountId}`,
            )
          ).rows,
        ).toEqual([{ path: "Sent" }]);
        const fetched = f.server.state.sourceFetches;
        sent.messages = [];
        if (change === "epoch") sent.validity = "789";
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: AbortSignal.timeout(30000), now: IMAP_SYNC_NOW },
            f.deps,
          ),
        ).toMatchObject({ ok: true });
        expect(f.server.state.sourceFetches).toBe(fetched);
        expect(
          (
            await db.execute(
              sql`SELECT provider_locator FROM email_message_attachments WHERE account_id=${f.accountId}`,
            )
          ).rows,
        ).toEqual([
          {
            provider_locator: {
              kind: "imap",
              folderPath: "INBOX",
              uidValidity: "123",
              uid: 3,
              partKey: "2",
            },
          },
        ]);
      } finally {
        await f.server.close();
      }
    });
  },
);
