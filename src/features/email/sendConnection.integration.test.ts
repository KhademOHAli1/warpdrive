import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { ok } from "@/types/result";
import { resolveSendConnection } from "./sendConnection";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("resolves independent and scheduled mail only after live owner and send-capability checks", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      let resolutions = 0;
      const deps = {
        resolveGmail: () => {
          throw new Error("Google credentials must not resolve for independent mail");
        },
        loadMail: () => {
          resolutions += 1;
          return Promise.resolve(ok(f.runtime));
        },
      };
      const args = {
        accountId: f.accountId,
        actorId: f.owner.id,
        idempotencyKey: f.idempotencyKey,
        signal: AbortSignal.timeout(30_000),
      };
      const scheduled = await resolveSendConnection(
        db,
        { ...args, scheduledSendAt: new Date(Date.now() + 60_000) },
        deps,
      );
      expect(scheduled).toEqual(ok({}));
      expect(resolutions).toBe(0);
      const current = await resolveSendConnection(db, args, deps);
      expect(current.ok && current.value.mail?.accountId).toBe(f.accountId);
      expect(resolutions).toBe(1);
      const stranger = await seedUser(db);
      const denied = await resolveSendConnection(db, { ...args, actorId: stranger.id }, deps);
      expect(denied.ok).toBe(false);
      await db.execute(sql`UPDATE email_accounts SET paused=true WHERE id=${f.accountId}`);
      expect((await resolveSendConnection(db, args, deps)).ok).toBe(false);
      await db.execute(
        sql`UPDATE email_accounts SET paused=false,capabilities='{"send":false}'::jsonb WHERE id=${f.accountId}`,
      );
      expect((await resolveSendConnection(db, args, deps)).ok).toBe(false);
      await db.execute(
        sql`UPDATE email_accounts SET capabilities='{"send":true}'::jsonb WHERE id=${f.accountId}`,
      );
      await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
      expect(
        (await resolveSendConnection(db, { ...args, idempotencyKey: randomUUID() }, deps)).ok,
      ).toBe(false);
      expect(resolutions).toBe(1);
    } finally {
      await f.close();
    }
  });
});
