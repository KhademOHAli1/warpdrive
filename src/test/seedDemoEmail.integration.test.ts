import { expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import { seedUserEmails } from "../../scripts/seed-demo-email";
import { wipeDemo } from "../../scripts/seed-demo-records";
import { makeDb } from "../../scripts/seed-smoke-phase5-infra";

const DEMO_USER_ID = "00000000-0000-4000-8000-000000000101";
const FOREIGN_USER_ID = "00000000-0000-4000-8000-000000000102";
const DEMO_EMAIL = "seed-demo-owner@example.test";
const FOREIGN_EMAIL = "seed-foreign-owner@example.test";

it("wipes and reseeds only the demo mailbox while preserving an unrelated mailbox", async () => {
  const h = await makeTestDb();
  try {
    const db = makeDb(h.pool);
    await h.pool.query(
      `INSERT INTO users (id, email, name, google_sub)
       VALUES
         ($1, $3, 'Demo seed owner', 'seed-demo-owner-google'),
         ($2, $4, 'Unrelated owner', 'seed-foreign-owner-google')`,
      [DEMO_USER_ID, FOREIGN_USER_ID, DEMO_EMAIL, FOREIGN_EMAIL],
    );
    await h.pool.query(
      `INSERT INTO email_accounts
         (user_id, email_address, provider, identity_key, display_name, is_default,
          connection_generation, credential_version, connection_settings, history_days,
          folder_paths, capabilities, scopes, last_history_id, status)
       VALUES
         ($1, $2, 'imap_smtp', 'foreign-seed-identity', 'Unrelated mailbox', true,
          4, 9, $3::jsonb, 30, $4::jsonb, $5::jsonb, $6::jsonb, 'foreign-history', 'connected')`,
      [
        FOREIGN_USER_ID,
        FOREIGN_EMAIL,
        JSON.stringify({
          imap: { host: "imap.foreign.test", port: 993 },
          smtp: { host: "smtp.foreign.test", port: 465 },
        }),
        JSON.stringify(["INBOX", "Sent"]),
        JSON.stringify({ read: true, send: true, markRead: false, move: true, trash: false }),
        JSON.stringify(["imap.read", "smtp.send"]),
      ],
    );
    const readUnrelatedMailbox = async () =>
      (
        await h.pool.query<{ snapshot: string }>(
          "SELECT to_jsonb(a)::text AS snapshot FROM email_accounts a WHERE user_id = $1",
          [FOREIGN_USER_ID],
        )
      ).rows;
    const foreignBefore = await readUnrelatedMailbox();
    expect(foreignBefore).toHaveLength(1);

    const seedArgs = {
      accountUserId: DEMO_USER_ID,
      userEmail: DEMO_EMAIL,
      rng: () => 0.5,
      personEmails: [],
      personIds: [],
      dealIds: [],
      count: 0,
    };
    expect(await seedUserEmails(db, seedArgs)).toBe(0);

    await wipeDemo(db, [DEMO_USER_ID]);
    expect(
      (await h.pool.query("SELECT id FROM email_accounts WHERE user_id = $1", [DEMO_USER_ID])).rows,
    ).toEqual([]);

    expect(await seedUserEmails(db, seedArgs)).toBe(0);
    const demoAccounts = await h.pool.query<{ email_address: string; status: string }>(
      "SELECT email_address,status FROM email_accounts WHERE user_id = $1",
      [DEMO_USER_ID],
    );
    expect(demoAccounts.rows).toEqual([{ email_address: DEMO_EMAIL, status: "connected" }]);

    expect(await readUnrelatedMailbox()).toEqual(foreignBefore);
  } finally {
    await h.close();
  }
});
