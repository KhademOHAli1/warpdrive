import { Client } from "pg";
import { expect, it, vi } from "vitest";
import { wsChannel } from "@/constants/wsChannels";
import { makeTestDb } from "@/test/db";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";
import { buildMime } from "./mime";

it("refreshes historical imports without new-mail notifications, then announces new inbound mail", async () => {
  const h = await makeTestDb();
  const f = await imapSyncFixture(h.db);
  const listener = new Client({ connectionString: h.url });
  try {
    await listener.connect();
    const types: string[] = [];
    listener.on("notification", (event) => {
      const payload = JSON.parse(event.payload ?? "{}") as { type?: string };
      if (payload.type !== undefined) types.push(payload.type);
    });
    const channel = wsChannel.user(f.owner.id);
    await listener.query(`LISTEN "${channel.replaceAll('"', '""')}"`);
    const args = {
      accountId: f.accountId,
      signal: AbortSignal.timeout(30_000),
      now: IMAP_SYNC_NOW,
    };
    expect((await runImapSyncJob(h.db, args, f.deps)).ok).toBe(true);
    await vi.waitFor(() => expect(types.length).toBeGreaterThan(0));
    expect(types).toContain("email_mailbox_changed");
    expect(types).not.toContain("email_arrived");
    f.server.state.folders.get("INBOX")?.messages.push({
      uid: 4,
      flags: [],
      date: new Date(Date.now() + 60_000),
      source: Buffer.from(
        buildMime({
          from: "client@mail.test",
          to: [f.runtime.emailAddress],
          subject: "پیام تازه",
          html: "<p>Nachricht</p>",
          messageId: "<new-arrival@mail.test>",
        }),
      ),
    });
    expect((await runImapSyncJob(h.db, args, f.deps)).ok).toBe(true);
    await vi.waitFor(() =>
      expect(types.filter((type) => type === "email_arrived")).toHaveLength(1),
    );
  } finally {
    await listener.end();
    await f.server.close();
    await h.close();
  }
});
