import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { ok } from "@/types/result";
import { FakeGmailClient } from "./gmailFake";
import { seedPrivateIntake } from "./privateIntakeSchema.test-helpers";

export async function privateIntakeAttachmentFixture(
  db: Db,
  signal: AbortSignal,
  locale: "fa" | "de" = "fa",
) {
  const id = `Opaque.Mail/${randomUUID()}`;
  const attachmentId = randomUUID();
  const bytes = Buffer.from("Private attachment / پیوست خصوصی / Privater Anhang");
  const filename = locale === "fa" ? "پیشنهاد.pdf" : "Angebot.pdf";
  const f = await seedPrivateIntake(db, signal, {
    observedId: id,
    remote: {
      id,
      threadId: "shared-provider-thread",
      labelIds: ["INBOX"],
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "sender@example.test" }],
        parts: [
          {
            mimeType: "text/plain",
            body: { data: Buffer.from("Private mail").toString("base64url") },
          },
          {
            mimeType: "application/pdf",
            filename,
            body: { attachmentId: "part-A", size: bytes.length },
          },
        ],
      },
    },
    beforeLedger: async (tx, copy) => {
      await tx.execute(sql`INSERT INTO email_message_attachments
        (id,account_id,message_id,gmail_attachment_id,filename,mime_type,size_bytes)
        VALUES(${attachmentId},${copy.accountId},${copy.messageId},'part-A',
          ${filename},'application/pdf',${bytes.length})`);
      signal.throwIfAborted();
    },
  });
  const gmail = new FakeGmailClient();
  let resolutions = 0;
  let afterFetch: (() => Promise<void>) | undefined;
  gmail.getAttachment = async (args) => {
    gmail.calls.push({ method: "getAttachment", args });
    if (args.messageId !== id || args.attachmentId !== "part-A")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Private attachment fixture identity differs");
    await afterFetch?.();
    signal.throwIfAborted();
    return ok({ dataBase64: bytes.toString("base64url") });
  };
  const actor: AuthUser = { id: f.ownerId, type: "regular", isActive: true, groupIds: new Set() };
  return {
    ...f,
    actor,
    attachmentId,
    bytes,
    filename,
    gmail,
    deps: {
      resolveClient: () => {
        resolutions += 1;
        return Promise.resolve(ok(gmail));
      },
    },
    resolutions: () => resolutions,
    afterFetch: (work: () => Promise<void>) => {
      afterFetch = work;
    },
  };
}
