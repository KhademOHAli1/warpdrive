import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { resolveAttachmentDownload } from "./attachmentDownload";
import { privateIntakeAttachmentFixture } from "./privateIntakeAttachments.test-helpers";

for (const locale of ["fa", "de"] as const)
  it(`downloads a held ${locale} attachment using its own ledger identity without claiming Gmail message ownership`, async () => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      const f = await privateIntakeAttachmentFixture(db, signal, locale);
      const result = await resolveAttachmentDownload(
        db,
        f.deps,
        { actor: f.actor, attachmentId: f.attachmentId },
        signal,
      );
      expect(result).toEqual({
        ok: true,
        value: { filename: f.filename, mimeType: "application/pdf", bytes: f.bytes },
      });
      expect(f.resolutions()).toBe(1);
      expect(f.gmail.calls).toMatchObject([
        { method: "getAttachment", args: { messageId: f.observedId, attachmentId: "part-A" } },
      ]);
      expect(
        (
          await db.execute(sql`SELECT gmail_message_id,provider_message_id FROM email_messages
        WHERE id=${f.messageId}`)
        ).rows,
      ).toEqual([{ gmail_message_id: null, provider_message_id: f.providerId }]);
      expect(
        (
          await db.execute(sql`SELECT intake_state,confirmation_snapshot FROM email_private_intake
        WHERE id=${f.id}`)
        ).rows,
      ).toEqual([{ intake_state: "unverified", confirmation_snapshot: null }]);
    });
  });

it("never resolves the provider for a regular stranger or administrator reading private intake", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await privateIntakeAttachmentFixture(db, signal);
    for (const isAdmin of [false, true]) {
      const user = await seedUser(db, { isAdmin });
      const result = await resolveAttachmentDownload(
        db,
        f.deps,
        {
          actor: { ...f.actor, id: user.id, type: isAdmin ? "admin" : "regular" },
          attachmentId: f.attachmentId,
        },
        signal,
      );
      expect(result).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
    }
    expect(f.resolutions()).toBe(0);
    expect(f.gmail.calls).toEqual([]);
  });
});

it("never uses held provenance to fetch attachment metadata absent from the observed payload", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await privateIntakeAttachmentFixture(db, signal);
    await db.execute(sql`UPDATE email_message_attachments SET gmail_attachment_id='unrelated-part'
      WHERE id=${f.attachmentId}`);
    expect(
      await resolveAttachmentDownload(
        db,
        f.deps,
        { actor: f.actor, attachmentId: f.attachmentId },
        signal,
      ),
    ).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
    expect(f.resolutions()).toBe(0);
  });
});

it("denies provider resolution for a paused held mailbox", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await privateIntakeAttachmentFixture(db, signal);
    await db.execute(sql`UPDATE email_accounts SET paused=true WHERE id=${f.accountId}`);
    expect(
      await resolveAttachmentDownload(
        db,
        f.deps,
        { actor: f.actor, attachmentId: f.attachmentId },
        signal,
      ),
    ).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
    expect(f.resolutions()).toBe(0);
  });
});

for (const change of ["generation", "copy_purge", "owner_transfer"] as const)
  it(`denies held attachment bytes if ${change} changes during provider IO`, async () => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      const f = await privateIntakeAttachmentFixture(db, signal);
      f.afterFetch(async () => {
        if (change === "generation")
          await db.execute(sql`UPDATE email_accounts SET connection_generation=connection_generation+1
            WHERE id=${f.accountId}`);
        else if (change === "copy_purge")
          await db.execute(sql`DELETE FROM email_messages WHERE id=${f.messageId}`);
        else {
          const replacement = await seedUser(db);
          await db.execute(
            sql`UPDATE email_accounts SET user_id=${replacement.id} WHERE id=${f.accountId}`,
          );
        }
        signal.throwIfAborted();
      });
      expect(
        await resolveAttachmentDownload(
          db,
          f.deps,
          { actor: f.actor, attachmentId: f.attachmentId },
          signal,
        ),
      ).toMatchObject({ ok: false, error: { id: "E_GMAIL_012" } });
      expect(f.resolutions()).toBe(1);
      expect(f.gmail.calls).toHaveLength(1);
    });
  });
