import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { listDrafts, saveDraft } from "@/features/email/draftRepo";
import { resolveAttachments } from "@/features/email/sendHelpers";
import type { PermSetUser } from "@/features/permissions/effective";
import { confirmUpload, requestDownload, requestUpload } from "./actions";
import { seedPublicDeal } from "./actions.test-helpers";
import { canActorAccessParent } from "./fileAuthz";
import { FakeStorageClient } from "./storageFake";

type Db = Parameters<Parameters<typeof withTestDb>[0]>[0];
const signal = () => AbortSignal.timeout(8000);
const actorFor = (id: string): PermSetUser => ({
  id,
  type: "regular",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(),
});
const bytes = Buffer.from("Grüße aus Berlin. پیگیری پیشنهاد همکاری.\n");
const input = (accountId: string) => ({
  entityType: "email_mailbox" as const,
  entityId: accountId,
  filename: "پیگیری-Angebot.txt",
  contentType: "text/plain" as const,
  size: bytes.length,
});
async function mailbox(db: Db, ownerId: string, provider = "imap_smtp", status = "connected") {
  const connectionStatus = status === "paused" ? "connected" : status;
  const row = (
    await db.execute(sql`INSERT INTO email_accounts(user_id,email_address,provider,status,paused)
    VALUES(${ownerId},${`${randomUUID()}@mail.test`},${provider},${connectionStatus}::email_account_status,${status === "paused"}) RETURNING id`)
  ).rows[0] as { id: string };
  return row.id;
}
async function ready(db: Db, ownerId: string, accountId: string) {
  const actor = actorFor(ownerId),
    storage = new FakeStorageClient();
  const upload = await requestUpload(db, { actor, storage, input: input(accountId) }, signal());
  if (!upload.ok) throw upload.error;
  const row = (
    await db.execute(sql`SELECT s3_key AS key FROM files WHERE id=${upload.value.fileId}`)
  ).rows[0] as { key: string };
  storage.objectsByKey.set(row.key, {
    size: bytes.length,
    contentType: "text/plain",
    etag: "controlled-etag",
  });
  storage.objectBytes.set(row.key, bytes);
  const confirmed = await confirmUpload(
    db,
    { actor, storage, fileId: upload.value.fileId },
    signal(),
  );
  if (!confirmed.ok) throw confirmed.error;
  return { actor, storage, fileId: upload.value.fileId };
}

for (const provider of ["imap_smtp", "gmail"])
  for (const status of ["connected", "paused", "disconnected"])
    it(`allows the current ${provider}/${status} owner to upload a local composer attachment without an existing message`, async () => {
      await withTestDb(async (db) => {
        const owner = await seedUser(db),
          accountId = await mailbox(db, owner.id, provider, status),
          storage = new FakeStorageClient();
        const result = await requestUpload(
          db,
          { actor: actorFor(owner.id), storage, input: input(accountId) },
          signal(),
        );
        expect(result.ok).toBe(true);
        expect(storage.calls.map((x) => x.method)).toEqual(["presignPost"]);
        expect(
          (await db.execute(sql`SELECT entity_type,entity_id,status FROM files`)).rows,
        ).toEqual([{ entity_type: "email_mailbox", entity_id: accountId, status: "uploading" }]);
        expect((await db.execute(sql`SELECT id FROM email_messages`)).rows).toHaveLength(0);
      });
    });

for (const type of ["regular", "admin"] as const)
  it(`denies a foreign mailbox to a ${type} without row or storage side effects`, async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db),
        other = await seedUser(db, { isAdmin: type === "admin" }),
        accountId = await mailbox(db, owner.id),
        storage = new FakeStorageClient();
      const result = await requestUpload(
        db,
        { actor: { ...actorFor(other.id), type }, storage, input: input(accountId) },
        signal(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Unexpected foreign upload");
      expect(result.error.id).toBe("E_PERM_001");
      expect(storage.calls).toHaveLength(0);
      expect((await db.execute(sql`SELECT id FROM files`)).rows).toHaveLength(0);
    });
  });

it("does not turn actual shared-message visibility into mailbox-file access", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db),
      viewer = await seedUser(db),
      accountId = await mailbox(db, owner.id),
      dealId = await seedPublicDeal(db, owner.id);
    const threadId = randomUUID(),
      messageId = randomUUID(),
      storage = new FakeStorageClient(),
      actor = actorFor(viewer.id);
    await db.execute(
      sql`INSERT INTO email_threads(id,account_id,provider_thread_id,visibility,deal_id) VALUES(${threadId},${accountId},${threadId},'shared',${dealId})`,
    );
    await db.execute(
      sql`INSERT INTO email_messages(id,thread_id,account_id,provider_message_id,direction,from_email) VALUES(${messageId},${threadId},${accountId},${messageId},'inbound','sender@mail.test')`,
    );
    expect(await canActorAccessParent(db, actor, "email_message", messageId, signal())).toBe(true);
    const result = await requestUpload(db, { actor, storage, input: input(accountId) }, signal());
    expect(result.ok).toBe(false);
    expect(storage.calls).toHaveLength(0);
    expect((await db.execute(sql`SELECT id FROM files`)).rows).toHaveLength(0);
  });
});

for (const revoked of ["actor_inactive", "database_inactive", "database_invited"])
  it(`denies local mailbox files for ${revoked} even with stale actor data`, async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db),
        accountId = await mailbox(db, owner.id),
        actor = actorFor(owner.id),
        storage = new FakeStorageClient();
      if (revoked === "actor_inactive") actor.isActive = false;
      if (revoked === "database_inactive")
        await db.execute(sql`UPDATE users SET is_active=false WHERE id=${owner.id}`);
      if (revoked === "database_invited")
        await db.execute(sql`UPDATE users SET invited_at=clock_timestamp() WHERE id=${owner.id}`);
      const result = await requestUpload(db, { actor, storage, input: input(accountId) }, signal());
      expect(result.ok).toBe(false);
      expect(storage.calls).toHaveLength(0);
      expect((await db.execute(sql`SELECT id FROM files`)).rows).toHaveLength(0);
    });
  });

it("gives missing mailbox and the old message-kind/account-id mismatch no upload authority", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db),
      accountId = await mailbox(db, owner.id),
      storage = new FakeStorageClient(),
      actor = actorFor(owner.id);
    for (const value of [
      input(randomUUID()),
      { ...input(accountId), entityType: "email_message" as const },
    ]) {
      const result = await requestUpload(db, { actor, storage, input: value }, signal());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Unexpected missing/mismatched scope");
      expect(result.error.id).toBe("E_PERM_001");
    }
    expect(storage.calls).toHaveLength(0);
    expect((await db.execute(sql`SELECT id FROM files`)).rows).toHaveLength(0);
  });
});

it("rechecks current ownership before confirmation without touching physical storage", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db),
      next = await seedUser(db),
      accountId = await mailbox(db, owner.id),
      storage = new FakeStorageClient(),
      actor = actorFor(owner.id);
    const upload = await requestUpload(db, { actor, storage, input: input(accountId) }, signal());
    if (!upload.ok) throw upload.error;
    await db.execute(sql`UPDATE email_accounts SET user_id=${next.id} WHERE id=${accountId}`);
    storage.calls.length = 0;
    const result = await confirmUpload(
      db,
      { actor, storage, fileId: upload.value.fileId },
      signal(),
    );
    expect(result.ok).toBe(false);
    expect(storage.calls).toHaveLength(0);
    expect(
      (await db.execute(sql`SELECT status FROM files WHERE id=${upload.value.fileId}`)).rows,
    ).toEqual([{ status: "uploading" }]);
  });
});

it("retains a confirmed attachment through a same-owner A-to-B draft copy and resolves it for sending", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db),
      first = await mailbox(db, owner.id),
      second = await mailbox(db, owner.id),
      uploaded = await ready(db, owner.id, first);
    const base = {
      subject: "Grüße پیگیری",
      bodyHtml: "<p>Original retained body</p>",
      toEmails: ["to@mail.test"],
      ccEmails: ["cc@mail.test"],
      bccEmails: ["private@mail.test"],
      attachments: [{ fileId: uploaded.fileId }],
      visibility: "private" as const,
    };
    const original = await saveDraft(
      db,
      { actor: uploaded.actor, draft: { ...base, accountId: first, sendIntentId: randomUUID() } },
      signal(),
    );
    if (!original.ok) throw original.error;
    const copied = await saveDraft(
      db,
      {
        actor: uploaded.actor,
        draft: { ...base, accountId: second, createId: randomUUID(), sendIntentId: randomUUID() },
      },
      signal(),
    );
    if (!copied.ok) throw copied.error;
    const drafts = await listDrafts(db, uploaded.actor, signal());
    expect(drafts).toHaveLength(2);
    for (const draft of drafts)
      expect(draft).toMatchObject({
        subject: base.subject,
        bodyHtml: base.bodyHtml,
        bccEmails: base.bccEmails,
        attachments: [
          { fileId: uploaded.fileId, filename: input(first).filename, size: bytes.length },
        ],
      });
    const resolved = await resolveAttachments(
      db,
      uploaded.actor,
      [{ fileId: uploaded.fileId }],
      signal(),
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok)
      expect(resolved.value[0]).toMatchObject({
        fileId: uploaded.fileId,
        filename: input(first).filename,
        contentType: "text/plain",
      });
    expect(
      (
        await requestDownload(
          db,
          { actor: uploaded.actor, storage: uploaded.storage, fileId: uploaded.fileId },
          signal(),
        )
      ).ok,
    ).toBe(true);
  });
});

it("denies former-owner download/draft/send attachment reuse after ownership changes", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db),
      next = await seedUser(db),
      accountId = await mailbox(db, owner.id),
      uploaded = await ready(db, owner.id, accountId);
    await db.execute(sql`UPDATE email_accounts SET user_id=${next.id} WHERE id=${accountId}`);
    uploaded.storage.calls.length = 0;
    expect(
      (
        await requestDownload(
          db,
          { actor: uploaded.actor, storage: uploaded.storage, fileId: uploaded.fileId },
          signal(),
        )
      ).ok,
    ).toBe(false);
    expect(
      (await resolveAttachments(db, uploaded.actor, [{ fileId: uploaded.fileId }], signal())).ok,
    ).toBe(false);
    const second = await mailbox(db, owner.id);
    const draft = await saveDraft(
      db,
      {
        actor: uploaded.actor,
        draft: {
          accountId: second,
          subject: "No borrowed scope",
          bodyHtml: "",
          toEmails: [],
          ccEmails: [],
          attachments: [{ fileId: uploaded.fileId }],
        },
      },
      signal(),
    );
    expect(draft.ok).toBe(false);
    expect(uploaded.storage.calls).toHaveLength(0);
  });
});
