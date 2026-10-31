import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { AppError } from "@/constants/errorIds";
import { PGBOSS_QUEUE_EMAIL_SEND, PGBOSS_QUEUE_EMAIL_SYNC } from "@/constants/jobNames";
import { makeTestDb } from "@/test/db";
import { err, ok } from "@/types/result";
import { FakeGmailClient } from "./gmailFake";
import { recoverMailJobs } from "./mailJobRecovery";
import { processSendAttempt } from "./outbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";
import { runSendJob } from "./worker";

it("reconciles an uncertain Gmail submission in the background without submitting it again", async () => {
  const h = await makeTestDb();
  const boss = new PgBoss(h.url);
  const f = await smtpOutboxFixture(h.db);
  try {
    await boss.start();
    await boss.createQueue(PGBOSS_QUEUE_EMAIL_SYNC);
    await boss.createQueue(PGBOSS_QUEUE_EMAIL_SEND);
    await h.db.execute(sql`UPDATE email_accounts SET provider='gmail' WHERE id=${f.accountId}`);
    await f.enqueue();
    const gmail = new FakeGmailClient();
    gmail.sendImpl = () =>
      err(new AppError("E_GMAIL_001", "synthetic uncertain response", { status: 503 }));
    await processSendAttempt(h.db, { ...f.args, gmail });
    expect((await recoverMailJobs(h.db, boss, f.args.signal)).sendQueued).toBe(1);
    gmail.searchHits.set(`<${f.attemptId}@mail.test>`, {
      messages: [{ id: "accepted-google", threadId: "google-thread" }],
    });
    gmail.messages.set("accepted-google", {
      id: "accepted-google",
      threadId: "google-thread",
      labelIds: ["SENT"],
    });
    const result = await runSendJob(h.db, f.args, {
      resolveClient: () => Promise.resolve(ok(gmail)),
    });
    expect(result.ok && result.value.status).toBe("sent");
    expect(gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
  } finally {
    await boss.stop();
    await f.close();
    await h.close();
  }
});

it("recovers missing sync and scheduled-send jobs once using actual pg-boss tables", async () => {
  const h = await makeTestDb();
  const boss = new PgBoss(h.url);
  const f = await smtpOutboxFixture(h.db);
  try {
    await boss.start();
    await boss.createQueue(PGBOSS_QUEUE_EMAIL_SYNC);
    await boss.createQueue(PGBOSS_QUEUE_EMAIL_SEND);
    await f.enqueue();
    await h.db.execute(
      sql`UPDATE email_send_attempts SET scheduled_at=now()+interval '1 hour' WHERE id=${f.attemptId}`,
    );
    await Promise.all([
      recoverMailJobs(h.db, boss, f.args.signal),
      recoverMailJobs(h.db, boss, f.args.signal),
    ]);
    const jobs = (
      await h.db.execute(sql`SELECT name,start_after FROM pgboss.job WHERE state='created'`)
    ).rows;
    expect(jobs.filter((job) => job.name === PGBOSS_QUEUE_EMAIL_SYNC)).toHaveLength(1);
    expect(jobs.filter((job) => job.name === PGBOSS_QUEUE_EMAIL_SEND)).toHaveLength(1);
    const scheduled = jobs.find((job) => job.name === PGBOSS_QUEUE_EMAIL_SEND);
    expect(new Date(String(scheduled?.start_after)).getTime()).toBeGreaterThan(
      Date.now() + 3_000_000,
    );
    expect(f.smtp.received).toHaveLength(0);
  } finally {
    await boss.stop();
    await f.close();
    await h.close();
  }
});

it("recovers an interrupted unprepared request and repairs an accepted receipt after disconnect without resending", async () => {
  const h = await makeTestDb();
  const boss = new PgBoss(h.url);
  const f = await smtpOutboxFixture(h.db);
  try {
    await boss.start();
    await boss.createQueue(PGBOSS_QUEUE_EMAIL_SYNC);
    await boss.createQueue(PGBOSS_QUEUE_EMAIL_SEND);
    await f.enqueue({ html: "<p>پیشنهاد · Grüße</p>" });
    await h.db.execute(
      sql`UPDATE email_send_attempts SET payload_prepared=false WHERE id=${f.attemptId}`,
    );
    const args = {
      accountId: f.accountId,
      idempotencyKey: f.idempotencyKey,
      signal: f.args.signal,
    };
    const deps = {
      resolveClient: () => {
        throw new Error("No Google credentials");
      },
      loadMail: () => Promise.resolve(ok(f.runtime)),
      storage: f.storage,
    };
    const sent = await runSendJob(h.db, args, deps);
    expect(sent.ok && sent.value.status).toBe("sent");
    expect(f.smtp.received).toHaveLength(1);
    await h.db.execute(sql`DELETE FROM email_messages WHERE account_id=${f.accountId}`);
    await h.db.execute(
      sql`UPDATE email_accounts SET status='disconnected',credentials_enc=NULL,connection_generation=2 WHERE id=${f.accountId}`,
    );
    expect((await recoverMailJobs(h.db, boss, f.args.signal)).sendQueued).toBe(1);
    const repaired = await runSendJob(h.db, args, {
      resolveClient: deps.resolveClient,
      loadMail: () => {
        throw new Error("Receipt repair must not load credentials");
      },
    });
    expect(repaired.ok && repaired.value.status).toBe("sent");
    expect(
      (await h.db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
    ).toHaveLength(1);
    expect(f.smtp.received).toHaveLength(1);
  } finally {
    await boss.stop();
    await f.close();
    await h.close();
  }
});
