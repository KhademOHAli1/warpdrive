// Canonical migrated PostgreSQL controls; execution evidence is recorded separately.
// Request context is substituted; database and read-state writes are real.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedMailHttpSession } from "@/features/email/mailConnectionHttp.test-helpers";
import type { AuthUser } from "@/features/permissions/types";
import { assertReadIntentSchema } from "./readIntentConstraints.test-helpers";

const context = vi.hoisted(() => ({
  db: null as Db | null,
  actor: null as AuthUser | null,
  session: null as { userId: string; sessionId: string } | null,
}));
vi.mock("@/db/client", () => ({
  get db() {
    if (context.db === null) throw new Error("read-intent test database is not bound");
    return context.db;
  },
}));
vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: context.actor, session: context.session }),
}));

import { markThreadReadAction, markThreadUnreadAction } from "@/features/email/readActions";

afterEach(() => {
  context.db = null;
  context.actor = null;
  context.session = null;
});

it.each([true, false])(
  "does not silently downgrade an unknown operation UUID to an ordinary read=%s write",
  async (read) => {
    await withTestDb(async (db) => {
      await assertReadIntentSchema(db);
      const native = await seedMailHttpSession(db);
      const owner = native.user;
      const [account] = (
        await db.execute(sql`INSERT INTO email_accounts (user_id,email_address,status,provider)
          VALUES (${owner.id},${`${owner.id}@example.test`},'connected','gmail') RETURNING id`)
      ).rows as { id: string }[];
      if (account === undefined) throw new Error("mailbox fixture missing");
      const [thread] = (
        await db.execute(sql`INSERT INTO email_threads
          (account_id,gmail_thread_id,subject,last_message_at,visibility)
          VALUES (${account.id},'intent-admission','Read intent admission',now(),'private')
          RETURNING id`)
      ).rows as { id: string }[];
      if (thread === undefined) throw new Error("thread fixture missing");
      if (!read)
        await db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
          SELECT id,${owner.id},GREATEST(clock_timestamp(),last_message_at)
          FROM email_threads WHERE id=${thread.id}`);

      const markers = () =>
        db.execute(sql`SELECT read_at::text FROM email_thread_reads
          WHERE thread_id=${thread.id} AND user_id=${owner.id}`);
      const before = (await markers()).rows;
      context.db = db;
      context.actor = {
        id: owner.id,
        type: "regular",
        isActive: true,
        groupIds: new Set(),
      };
      context.session = { userId: owner.id, sessionId: native.context.sessionId };
      const action = read ? markThreadReadAction : markThreadUnreadAction;
      const result = await action("csrf", { threadId: thread.id, operationId: randomUUID() });
      expect.soft(result).toMatchObject({
        ok: false,
        error: { id: ERROR_IDS.GMAIL_THREAD_NOT_FOUND },
      });
      expect((await markers()).rows).toEqual(before);
    });
  },
);
