import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { resolveAttachmentDownload } from "./attachmentDownload";
import {
  ATTACHMENT_TEST_BYTES,
  attachmentActor,
  attachmentDownloadFixture,
} from "./attachmentDownload.test-helpers";

it.each(["پیشنهاد.pdf", "Angebot für Sie.pdf"])(
  "lazily downloads the exact MIME part for %s over verified TLS",
  async (filename) => {
    await withTestDb(async (db) => {
      const f = await attachmentDownloadFixture(db, filename);
      try {
        const before = f.server.state.sourceFetches;
        const result = await resolveAttachmentDownload(
          db,
          f.deps,
          { actor: f.actor, attachmentId: f.attachmentId },
          f.signal,
        );
        expect(result).toEqual({
          ok: true,
          value: { filename, mimeType: "application/pdf", bytes: ATTACHMENT_TEST_BYTES },
        });
        expect(f.server.state.sourceFetches).toBe(before + 1);
        expect(f.resolutions()).toEqual({ gmail: 0, imap: 1 });
      } finally {
        await f.server.close();
      }
    });
  },
);

it("denies private attachments before loading any provider or storage even for another administrator", async () => {
  await withTestDb(async (db) => {
    const f = await attachmentDownloadFixture(db);
    try {
      const other = await seedUser(db);
      const result = await resolveAttachmentDownload(
        db,
        f.deps,
        { actor: { ...attachmentActor(other.id), type: "admin" }, attachmentId: f.attachmentId },
        f.signal,
      );
      expect(result).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
      expect(f.resolutions()).toEqual({ gmail: 0, imap: 0 });
      expect(f.storage.calls).toEqual([]);
    } finally {
      await f.server.close();
    }
  });
});

it.each(["epoch", "part", "metadata", "cross_account"] as const)(
  "fails closed for an invalid remote attachment locator (%s)",
  async (change) => {
    await withTestDb(async (db) => {
      const f = await attachmentDownloadFixture(db);
      try {
        if (change === "epoch") {
          const inbox = f.server.state.folders.get("INBOX");
          if (inbox !== undefined) inbox.validity = "999";
        } else if (change === "part")
          await db.execute(
            sql`UPDATE email_message_attachments SET provider_locator=jsonb_set(provider_locator,'{partKey}','"999"'::jsonb) WHERE id=${f.attachmentId}`,
          );
        else if (change === "metadata")
          await db.execute(
            sql`UPDATE email_message_attachments SET size_bytes=1 WHERE id=${f.attachmentId}`,
          );
        else
          await db.execute(
            sql`UPDATE email_message_attachments SET account_id=gen_random_uuid() WHERE id=${f.attachmentId}`,
          );
        const result = await resolveAttachmentDownload(
          db,
          f.deps,
          { actor: f.actor, attachmentId: f.attachmentId },
          f.signal,
        );
        expect(result).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
        expect(f.resolutions().gmail).toBe(0);
      } finally {
        await f.server.close();
      }
    });
  },
);

it.each(["generation", "owner", "actor", "invited"] as const)(
  "does not return fetched bytes after access changes during native I/O (%s)",
  async (change) => {
    await withTestDb(async (db) => {
      const f = await attachmentDownloadFixture(db);
      try {
        const real = f.runtime.imap.getSource.bind(f.runtime.imap);
        f.runtime.imap.getSource = async (args) => {
          const fetched = await real(args);
          if (change === "generation")
            await db.execute(
              sql`UPDATE email_accounts SET connection_generation=2 WHERE id=${f.accountId}`,
            );
          else if (change === "owner")
            await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
          else if (change === "invited")
            await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${f.owner.id}`);
          else
            await db.execute(
              sql`UPDATE email_threads SET visibility='private' WHERE account_id=${f.accountId}`,
            );
          return fetched;
        };
        if (change === "actor") f.actor.isActive = false;
        expect(
          await resolveAttachmentDownload(
            db,
            f.deps,
            { actor: f.actor, attachmentId: f.attachmentId },
            f.signal,
          ),
        ).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
      } finally {
        await f.server.close();
      }
    });
  },
);
