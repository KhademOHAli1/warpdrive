import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { actorOf, seedAccount } from "./draft.test-helpers";
import { listDrafts, saveDraft } from "./draftRepo";

it("copies a complete multilingual draft once and never overwrites it on lost-response retry", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const actor = actorOf(owner.id);
    const first = await seedAccount(db, owner.id, "first@mail.test");
    const second = await seedAccount(db, owner.id, "second@mail.test");
    const draft = {
      accountId: first,
      subject: "پیشنهاد همکاری",
      bodyHtml: "<p>Vielen Dank</p>",
      toEmails: ["customer@mail.test"],
      ccEmails: [],
      bccEmails: ["private@mail.test"],
      sendIntentId: randomUUID(),
      visibility: "private" as const,
    };
    const original = await saveDraft(db, { actor, draft }, AbortSignal.timeout(8000));
    if (!original.ok) throw original.error;
    const createId = randomUUID();
    const copied = { ...draft, createId, accountId: second, sendIntentId: randomUUID() };
    const copy = await saveDraft(db, { actor, draft: copied }, AbortSignal.timeout(8000));
    expect(copy).toEqual({ ok: true, value: { id: createId } });
    await saveDraft(
      db,
      { actor, draft: { ...copied, createId: undefined, id: createId, subject: "Updated" } },
      AbortSignal.timeout(8000),
    );
    expect((await saveDraft(db, { actor, draft: copied }, AbortSignal.timeout(8000))).ok).toBe(
      true,
    );
    const rows = await listDrafts(db, actor, AbortSignal.timeout(8000));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === createId)).toMatchObject({
      accountId: second,
      subject: "Updated",
      bccEmails: draft.bccEmails,
      sendIntentId: copied.sendIntentId,
    });
    expect(rows.find((row) => row.id === original.value.id)?.subject).toBe(draft.subject);
    const denied = await saveDraft(
      db,
      { actor, draft: { ...copied, accountId: first } },
      AbortSignal.timeout(8000),
    );
    expect(denied.ok).toBe(false);
  });
});

it("rejects draft writes by a non-owner and never persists unauthorized attachment IDs", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const accountId = await seedAccount(db, owner.id, "owner@mail.test");
    const base = { accountId, subject: "Angebot", bodyHtml: "", toEmails: [], ccEmails: [] };
    const denied = await saveDraft(
      db,
      { actor: actorOf(other.id), draft: base },
      AbortSignal.timeout(8000),
    );
    expect(denied.ok).toBe(false);
    const deniedFile = await saveDraft(
      db,
      { actor: actorOf(owner.id), draft: { ...base, attachments: [{ fileId: randomUUID() }] } },
      AbortSignal.timeout(8000),
    );
    expect(deniedFile.ok).toBe(false);
    expect(
      (await db.execute(sql`SELECT id FROM email_drafts WHERE account_id=${accountId}`)).rows,
    ).toHaveLength(0);
  });
});
