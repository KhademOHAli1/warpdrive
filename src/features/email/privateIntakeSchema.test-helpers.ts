import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { seedUser } from "@/db/testing/factories";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { GmailMessage } from "./gmailSchemas";
import { parseGmailMessage } from "./mimeParse";

export async function requirePrivateIntakeSchema(db: Db, signal: AbortSignal) {
  const row = (
    await db.execute(sql`SELECT
    to_regclass('public.email_private_intake') IS NOT NULL AS intake,
    to_regclass('public.email_private_intake_reviews') IS NOT NULL AS reviews`)
  ).rows[0];
  signal.throwIfAborted();
  // An absent-table assertion is structural RED, never behavior evidence.
  expect(row).toEqual({ intake: true, reviews: true });
}

// This seeds the agreed transaction order, not native-session authorization.
export async function appendPrivateIntakeSchemaReview(
  db: Db,
  args: {
    intakeId: string;
    accountId: string;
    actorId: string;
    expectedRevision: number;
    decision: "keep_private" | "dismiss" | "restore_private";
    signal: AbortSignal;
  },
) {
  return db.transaction(
    async (tx) => {
      const locked = (
        await tx.execute(sql`SELECT revision FROM email_private_intake
      WHERE id=${args.intakeId} AND account_id=${args.accountId} FOR UPDATE`)
      ).rows[0];
      args.signal.throwIfAborted();
      expect(locked?.revision).toBe(args.expectedRevision);
      const revision = args.expectedRevision + 1;
      const advanced = await tx.execute(sql`UPDATE email_private_intake SET revision=${revision}
      WHERE id=${args.intakeId} AND account_id=${args.accountId}
        AND revision=${args.expectedRevision} RETURNING revision`);
      args.signal.throwIfAborted();
      expect(advanced.rows).toEqual([{ revision }]);
      await tx.execute(sql`INSERT INTO email_private_intake_reviews
      (intake_id,account_id,revision,actor_id,decision)
      VALUES(${args.intakeId},${args.accountId},${revision},${args.actorId},${args.decision})`);
      args.signal.throwIfAborted();
      return revision;
    },
    { isolationLevel: "read committed" },
  );
}

export async function privateIntakeRow(db: Db, id: string, signal: AbortSignal) {
  const result = await db.execute(sql`SELECT * FROM email_private_intake WHERE id=${id}`);
  signal.throwIfAborted();
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

export async function seedPrivateIntake(
  db: Db,
  signal: AbortSignal,
  options: {
    accountId?: string;
    observedId?: string;
    remote?: GmailMessage;
    ownedMessageIdOverride?: string;
    baselineMessageHashOverride?: string;
    observedPayloadHashOverride?: string;
    beforeLedger?: (
      tx: DbOrTx,
      copy: {
        id: string;
        messageId: string;
        threadId: string;
        accountId: string;
      },
    ) => Promise<void>;
  } = {},
) {
  await requirePrivateIntakeSchema(db, signal);
  let accountId = options.accountId;
  if (accountId === undefined) {
    const owner = await seedUser(db);
    accountId = randomUUID();
    await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider)
      VALUES(${accountId},${owner.id},${`${accountId}@mail.test`},'gmail')`);
  }
  const account = (
    await db.execute(sql`SELECT user_id,email_address FROM email_accounts
    WHERE id=${accountId}`)
  ).rows[0];
  signal.throwIfAborted();
  if (typeof account?.user_id !== "string" || typeof account.email_address !== "string")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Private intake fixture mailbox missing");
  const ownerId = account.user_id;
  const stableAccountId = accountId;
  const id = randomUUID();
  const messageId = randomUUID();
  const threadId = randomUUID();
  const observedId = options.observedId ?? `observed:${randomUUID()}`;
  const remote: GmailMessage = options.remote ?? {
    id: observedId,
    threadId: "remote-customer-conversation",
    labelIds: ["SENT"],
    payload: {
      mimeType: "text/html",
      headers: [
        { name: "From", value: account.email_address },
        { name: "To", value: account.email_address },
        { name: "Subject", value: "محتوای خصوصی / Privater Inhalt" },
        { name: "Message-ID", value: `<${id}@public-header.test>` },
      ],
      body: { data: Buffer.from("<p>محتوای خصوصی / Privater Inhalt</p>").toString("base64url") },
    },
  };
  const parsed = parseGmailMessage(remote);
  const providerId = `private-intake:${id}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO email_threads
      (id,account_id,provider_thread_id,subject,visibility)
      VALUES(${threadId},${accountId},${providerId},${parsed.subject},'private')`);
    await tx.execute(sql`INSERT INTO email_messages
      (id,account_id,thread_id,provider_message_id,direction,from_email,to_emails,cc_emails,
       subject,snippet,body_html,body_text,sent_at)
      VALUES(${messageId},${accountId},${threadId},${providerId},'inbound',${parsed.fromEmail},
        ${JSON.stringify(parsed.toEmails)}::jsonb,${JSON.stringify(parsed.ccEmails)}::jsonb,
        ${parsed.subject},${parsed.snippet},${parsed.bodyHtml},${parsed.bodyText},${parsed.sentAt})`);
    await options.beforeLedger?.(tx, { id, messageId, threadId, accountId: stableAccountId });
    signal.throwIfAborted();
    await tx.execute(sql`INSERT INTO email_private_intake
      (id,account_id,provider,observed_provider_id,observed_payload,observed_payload_hash,
       owned_message_id,baseline_thread_id,baseline_message_hash,baseline_thread_hash,
       baseline_attachments_hash,intake_state,content_state,revision)
      SELECT ${id},${accountId},'gmail',${observedId},${JSON.stringify(remote)}::jsonb,
        coalesce(${options.observedPayloadHashOverride ?? null}::text,
          public.private_intake_hash_v1(${JSON.stringify(remote)}::jsonb)),
        ${options.ownedMessageIdOverride ?? messageId},${threadId},
        coalesce(${options.baselineMessageHashOverride ?? null}::text,b.message_hash),
        b.thread_hash,b.attachments_hash,'unverified','retained',0
      FROM public.private_intake_baseline_v1(${accountId}::uuid,${messageId}::uuid) b`);
    signal.throwIfAborted();
  });
  return { id, accountId, ownerId, messageId, threadId, observedId, remote, providerId };
}

export async function expectPrivateIntakePgError(
  work: Promise<unknown>,
  expected: string[],
  signal: AbortSignal,
) {
  let caught: unknown;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  signal.throwIfAborted();
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof caught !== "object" || caught === null) break;
    if ("code" in caught && typeof caught.code === "string") {
      expect(expected).toContain(caught.code);
      return;
    }
    caught = "cause" in caught ? caught.cause : undefined;
  }
  expect.fail("Expected a PostgreSQL constraint or immutable-evidence rejection");
}
