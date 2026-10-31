import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { resolveAttachmentDownload } from "./attachmentDownload";
import {
  ATTACHMENT_TEST_BYTES,
  attachmentDownloadFixture,
} from "./attachmentDownload.test-helpers";

it.each(["disconnected", "paused", "corrupted", "oversized", "suspended"] as const)(
  "serves a private stored snapshot only with intact bytes and current access (%s)",
  async (kind) => {
    await withTestDb(async (db) => {
      const f = await attachmentDownloadFixture(db);
      try {
        const objectKey = `private-mail/${f.accountId}/synthetic`;
        const sha256 = createHash("sha256").update(ATTACHMENT_TEST_BYTES).digest("hex");
        await db.execute(
          sql`UPDATE email_message_attachments SET provider_locator=${JSON.stringify({ kind: "stored", objectKey, sha256 })}::jsonb WHERE id=${f.attachmentId}`,
        );
        f.storage.objectsByKey.set(objectKey, {
          size: kind === "oversized" ? 11 * 1024 * 1024 : ATTACHMENT_TEST_BYTES.length,
          contentType: "application/pdf",
        });
        f.storage.objectBytes.set(
          objectKey,
          kind === "corrupted"
            ? Buffer.alloc(ATTACHMENT_TEST_BYTES.length, 42)
            : ATTACHMENT_TEST_BYTES,
        );
        if (kind === "disconnected")
          await db.execute(
            sql`UPDATE email_accounts SET status='disconnected',connection_generation=2 WHERE id=${f.accountId}`,
          );
        if (kind === "paused")
          await db.execute(sql`UPDATE email_accounts SET paused=true WHERE id=${f.accountId}`);
        if (kind === "suspended") {
          const real = f.storage.getObjectBytes.bind(f.storage);
          f.storage.getObjectBytes = async (key, signal) => {
            const result = await real(key, signal);
            await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
            return result;
          };
        }
        const result = await resolveAttachmentDownload(
          db,
          f.deps,
          { actor: f.actor, attachmentId: f.attachmentId },
          f.signal,
        );
        if (kind === "disconnected" || kind === "paused")
          expect(result).toEqual({
            ok: true,
            value: {
              filename: f.filename,
              mimeType: "application/pdf",
              bytes: ATTACHMENT_TEST_BYTES,
            },
          });
        else expect(result).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
        expect(f.resolutions()).toEqual({ gmail: 0, imap: 0 });
        if (kind === "oversized")
          expect(f.storage.calls.some((call) => call.method === "getObjectBytes")).toBe(false);
      } finally {
        await f.server.close();
      }
    });
  },
);
