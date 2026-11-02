import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";
import { runSyncJob } from "./worker";

it("dispatches an independent mailbox job through IMAP without touching Google credentials", async () => {
  await withTestDb(async (db) => {
    const fixture = await imapSyncFixture(db);
    let gmailResolutions = 0;
    try {
      const result = await runSyncJob(
        db,
        { accountId: fixture.accountId, signal: AbortSignal.timeout(30_000), now: IMAP_SYNC_NOW },
        {
          resolveClient: () => {
            gmailResolutions += 1;
            throw new Error("Gmail must not resolve for an independent mailbox");
          },
          imap: fixture.deps,
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.applied).toBe(2);
      expect(gmailResolutions).toBe(0);
    } finally {
      await fixture.server.close();
    }
  });
});
