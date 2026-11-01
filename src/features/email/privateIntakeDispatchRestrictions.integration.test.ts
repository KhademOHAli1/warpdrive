import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { FakeStorageClient } from "@/features/files/storageFake";
import type { AuthUser } from "@/features/permissions/types";
import { ok } from "@/types/result";
import { FakeGmailClient } from "./gmailFake";
import { runImapThreadOperation } from "./imapThreadOperations";
import type { ImapThreadOperation, ImapThreadOperationDeps } from "./imapThreadOperationsTypes";
import { processSendAttempt } from "./outbox";
import {
  enqueueHeldDispatchBypass,
  heldSmtpDispatchFixture,
  privateDispatchRemoteSnapshot,
  privateDispatchSnapshot,
} from "./privateIntakeDispatchRestrictions.test-helpers";
import { seedPrivateIntake } from "./privateIntakeSchema.test-helpers";
import { runSendJob } from "./worker";

it("fences a prepared ordinary Gmail attempt rebound to a held thread at actual final submission", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const attempt = await enqueueHeldDispatchBypass(db, f.accountId, f.threadId, signal);
    const before = await privateDispatchSnapshot(db, f.accountId, signal);
    const gmail = new FakeGmailClient();
    const result = await processSendAttempt(db, {
      accountId: f.accountId,
      idempotencyKey: attempt.idempotencyKey,
      gmail,
      storage: new FakeStorageClient(),
      signal,
    });
    expect.soft(result).toMatchObject({ ok: false });
    expect.soft(gmail.calls).toEqual([]);
    expect(await privateDispatchSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it("fences legacy ordinary SMTP queued mail rebound to an actual TLS self-delivery held copy", async () => {
  await withTestDb(async (db) => {
    const f = await heldSmtpDispatchFixture(db);
    const append = vi.spyOn(f.runtime.imap, "appendSent");
    try {
      const signal = f.args.signal;
      // A writable Sent target must actually be enabled; an empty crm_only folder
      // would not prove that the bypassed ordinary send is unable to APPEND.
      await db.execute(sql`UPDATE email_accounts SET
        connection_settings='{"sentCopyMode":"append","sentFolderPath":"Sent"}'::jsonb
        WHERE id=${f.accountId}`);
      const attempt = await enqueueHeldDispatchBypass(db, f.accountId, f.threadId, signal);
      const before = await privateDispatchSnapshot(db, f.accountId, signal);
      const remote = privateDispatchRemoteSnapshot(f);
      const result = await runSendJob(
        db,
        {
          accountId: f.accountId,
          idempotencyKey: attempt.idempotencyKey,
          signal,
        },
        f.deps,
      );
      expect.soft(result).toMatchObject({ ok: false });
      expect.soft(f.smtp.received).toHaveLength(1);
      expect.soft(append).not.toHaveBeenCalled();
      expect.soft(privateDispatchRemoteSnapshot(f)).toEqual(remote);
      expect(await privateDispatchSnapshot(db, f.accountId, signal)).toEqual(before);
    } finally {
      append.mockRestore();
      await f.close();
    }
  });
});

const operations: ImapThreadOperation[] = [
  { kind: "read", read: true },
  { kind: "move", destinationPath: "Archiv" },
  { kind: "trash" },
];

it.each(operations)(
  "denies actual IMAP $kind for held intake before resolving credentials or issuing remote commands",
  async (operation) => {
    await withTestDb(async (db) => {
      const f = await heldSmtpDispatchFixture(db);
      try {
        const signal = f.args.signal;
        const actor: AuthUser = {
          id: f.owner.id,
          type: "regular",
          isActive: true,
          groupIds: new Set(),
        };
        const loadConnection = vi.fn<NonNullable<ImapThreadOperationDeps["loadConnection"]>>(() =>
          Promise.resolve(ok(f.runtime)),
        );
        const before = await privateDispatchSnapshot(db, f.accountId, signal);
        const remote = privateDispatchRemoteSnapshot(f);
        const commands = [...f.imap.state.commands];
        const authentications = f.imap.authenticationAttempts();
        const result = await runImapThreadOperation(
          db,
          {
            actor,
            threadId: f.threadId,
            operation,
          },
          signal,
          { loadConnection },
        );
        expect.soft(result).toMatchObject({ ok: false });
        expect.soft(loadConnection).not.toHaveBeenCalled();
        expect.soft(f.imap.authenticationAttempts()).toBe(authentications);
        expect.soft(f.imap.state.commands).toEqual(commands);
        expect.soft(privateDispatchRemoteSnapshot(f)).toEqual(remote);
        expect(await privateDispatchSnapshot(db, f.accountId, signal)).toEqual(before);
      } finally {
        await f.close();
      }
    });
  },
);
