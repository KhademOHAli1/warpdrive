import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { emailAccounts } from "@/db/schema";
import { assertMailboxOwner } from "@/features/email/mailboxOwnership";
import { makeTestDb } from "@/test/db";
import { createIntegrationPlatformFixtures } from "./integrationPlatformFixtures";

test("fixture owners may add mailboxes while identity, default and ownership boundaries remain enforced", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const seeded = await createIntegrationPlatformFixtures(
      h,
      { namespace: "mailboxes", now: new Date("2026-10-31T12:00:00.000Z") },
      signal,
    );
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const f = seeded.value;
    expect(f.limits.personalMailboxesSeededPerUser).toBe(1);
    await h.db
      .update(emailAccounts)
      .set({ isDefault: true, identityKey: "gmail:fixture-member" })
      .where(eq(emailAccounts.id, f.mailboxes.member.id));
    const [second] = await h.db
      .insert(emailAccounts)
      .values({
        userId: f.users.member.id,
        emailAddress: "second-personal@example.test",
        provider: "imap_smtp",
        identityKey: "imap_smtp:fixture-second",
      })
      .returning();
    expect(second).toMatchObject({
      userId: f.users.member.id,
      provider: "imap_smtp",
      isDefault: false,
    });
    if (second === undefined) return;
    const rows = await h.db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.userId, f.users.member.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isDefault).map((row) => row.id)).toEqual([
      f.mailboxes.member.id,
    ]);
    for (const mailboxId of [f.mailboxes.member.id, second.id]) {
      expect((await assertMailboxOwner(h.db, mailboxId, f.users.member.id, signal)).ok).toBe(true);
      for (const deniedOwner of [f.users.admin.id, f.users.outsider.id]) {
        expect((await assertMailboxOwner(h.db, mailboxId, deniedOwner, signal)).ok).toBe(false);
      }
    }
    const collisions = [
      {
        emailAddress: "SECOND-PERSONAL@EXAMPLE.TEST",
        constraint: "email_accounts_email_address_unique",
      },
      {
        emailAddress: "identity-collision@example.test",
        identityKey: "imap_smtp:fixture-second",
        constraint: "email_accounts_identity_key_unique",
      },
      {
        emailAddress: "default-collision@example.test",
        identityKey: "gmail:fixture-third",
        isDefault: true,
        constraint: "email_accounts_default_owner_uq",
      },
    ];
    for (const { constraint, ...values } of collisions) {
      await expect(
        h.db.insert(emailAccounts).values({ userId: f.users.member.id, ...values }),
      ).rejects.toMatchObject({ cause: { code: "23505", constraint } });
    }
    expect(
      await h.db.select().from(emailAccounts).where(eq(emailAccounts.userId, f.users.member.id)),
    ).toHaveLength(2);
  } finally {
    await h.close();
  }
});
