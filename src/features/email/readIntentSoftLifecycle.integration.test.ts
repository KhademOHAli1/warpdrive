import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { assertReadIntentSchema } from "./readIntentConstraints.test-helpers";
import { openSoftMailbox } from "./readIntentSoftLifecycleConnection.test-helpers";
import {
  expectSoftPreserved,
  seedSoftData,
  snapshotSoftData,
} from "./readIntentSoftLifecycleData.test-helpers";
import {
  applySoftLifecycle,
  probeRetainedSoftIntent,
} from "./readIntentSoftLifecycleFlows.test-helpers";
import { prepareSoftState, SOFT_READ_STATES } from "./readIntentSoftLifecycleState.test-helpers";

// UNRUN: canonical0103 migration is required. Four real services × six legal receipt states.
// State arrangement is not provider-write/lost-ack evidence. The controlled profile watches
// INBOX only, so successful trash retains inactive remote history and the exact read watermark.
for (const flow of ["disconnect", "deactivate", "reconnect", "trash"] as const) {
  it.each(SOFT_READ_STATES)(`preserves the %s read intent through real ${flow}`, async (state) => {
    await withTestDb(async (db) => {
      await assertReadIntentSchema(db);
      const mailbox = await openSoftMailbox(db);
      try {
        const data = await seedSoftData(db, mailbox);
        const operation = await prepareSoftState(db, mailbox, state);
        const f = { ...mailbox, ...data, ...operation };
        const before = await snapshotSoftData(db, f);
        expect(before.receipts).toHaveLength(1);
        expect(before.content).toMatchObject({
          messages: expect.arrayContaining([expect.objectContaining({ id: f.messageId })]),
          drafts: [
            expect.objectContaining({
              id: f.draftId,
              subject: "Retain this reply · پاسخ",
              to_emails: ["to@example.test"],
              cc_emails: ["cc@example.test"],
              bcc_emails: ["bcc@example.test"],
              attachments: [expect.objectContaining({ fileId: f.fileId })],
            }),
          ],
          attachments: expect.arrayContaining([
            expect.objectContaining({
              provider_locator: expect.objectContaining({ sha256: f.checksum }),
            }),
          ]),
          file: expect.objectContaining({ id: f.fileId, etag: f.checksum }),
        });
        expect(before.marker).toMatchObject({ thread_id: f.threadId, user_id: f.actor.id });
        await applySoftLifecycle(db, f, flow);
        const afterFlow = await snapshotSoftData(db, f);
        expectSoftPreserved(before, afterFlow);
        await probeRetainedSoftIntent(db, f, flow);
        const afterProbe = await snapshotSoftData(db, f);
        expect(afterProbe.content).toEqual(before.content);
        expect(afterProbe.marker).toEqual(before.marker);
        expect(afterProbe.unrelated).toEqual(before.unrelated);
        expect(f.smtp.received).toHaveLength(0);
      } finally {
        await mailbox.close();
      }
    });
  });
}
