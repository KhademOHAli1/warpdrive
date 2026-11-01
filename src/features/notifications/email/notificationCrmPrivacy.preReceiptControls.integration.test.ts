import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { err, ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import {
  expectNoGmailAcceptance,
  expectPrivateObservation,
  preparedGmailIntakeFixture,
} from "./notificationCrmPrivacy.preReceipt.test-helpers";
import { NOTIFICATION_PROVIDER_MESSAGE_ID } from "./notificationCrmPrivacy.test-helpers";

it("durably holds a lost-ACK notification while later ordinary mail in the same intake batch continues", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await preparedGmailIntakeFixture(db, signal, "fa");
    const original = await f.originalState();
    const providerSend = f.transport.gmail.sendRaw.bind(f.transport.gmail);
    f.transport.gmail.sendRaw = async (args) => {
      const accepted = await providerSend(args);
      if (!accepted.ok) return accepted;
      // The provider effect and remote message exist, but the ACK is lost.
      return err(
        new AppError(ERROR_IDS.GMAIL_API_EXHAUSTED, "Synthetic lost ACK", { status: 503 }),
      );
    };
    expect(await f.send()).toEqual(ok({ status: "failed" }));
    expect(f.transport.gmail.raw).toHaveLength(1);
    expect(await f.send()).toEqual(ok({ status: "needs_review" }));
    expectNoGmailAcceptance(await f.attempt());
    const ordinaryId = "ordinary-after-private";
    f.transport.gmail.messages.set(ordinaryId, {
      id: ordinaryId,
      threadId: "ordinary-after-private-thread",
      labelIds: ["INBOX"],
      internalDate: String(Date.parse("2026-11-01T11:00:00Z")),
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "Message-ID", value: "<ordinary-after-private@example.test>" },
          { name: "From", value: "customer@example.test" },
          { name: "To", value: f.account.emailAddress },
          { name: "Subject", value: "Ordinary mail continues" },
        ],
        body: { data: Buffer.from("<p>Independent ordinary message</p>").toString("base64url") },
      },
    });
    const ids = [NOTIFICATION_PROVIDER_MESSAGE_ID, ordinaryId];
    const intake = await f.observe(ids);
    expect.soft(intake.result).toMatchObject({ ok: true });
    expect.soft(intake.touchedThreadIds).not.toContain("t1");
    const candidate = await f.observed(NOTIFICATION_PROVIDER_MESSAGE_ID);
    expectPrivateObservation(candidate, f.originalThreadId);
    const ordinary = await f.observed(ordinaryId);
    expect.soft(ordinary).toHaveLength(1);
    expect.soft(ordinary[0]).toMatchObject({
      body_html: "<p>Independent ordinary message</p>",
      direction: "inbound",
    });
    expectNoGmailAcceptance(await f.attempt());
    expect.soft(await f.originalState()).toEqual(original);
    expect(await f.observe(ids)).toMatchObject({ result: { ok: true } });
    expect.soft(await f.observed(NOTIFICATION_PROVIDER_MESSAGE_ID)).toEqual(candidate);
    // Ordinary thread timestamp reconciliation is allowed; its message is stable.
    expect.soft((await f.observed(ordinaryId))[0]?.message).toEqual(ordinary[0]?.message);
    expect(
      await runEmailNotificationJob(
        db,
        { notificationId: f.notificationId },
        signal,
        f.transport.deps,
      ),
    ).toEqual(ok({ sent: false }));
    expectNoGmailAcceptance(await f.attempt());
    expect((await f.attempt())[0]?.status).toBe("needs_review");
    expect.soft(await f.originalState()).toEqual(original);
    expect(f.transport.gmail.raw).toHaveLength(1);
    expect(f.transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
    expect(
      (
        await db.execute(sql`SELECT id FROM email_send_attempts
      WHERE account_id=${f.account.id}`)
      ).rows,
    ).toHaveLength(1);
  });
});

it("keeps a distinct provider message with a copied public hint separate from the actual ACK ID", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await preparedGmailIntakeFixture(db, signal, "de");
    const original = await f.originalState();
    const spoofId = "copied-public-hint";
    let spoofBeforeAck: Awaited<ReturnType<typeof f.observed>> = [];
    const providerSend = f.transport.gmail.sendRaw.bind(f.transport.gmail);
    f.transport.gmail.sendRaw = async (args) => {
      const accepted = await providerSend(args);
      if (!accepted.ok) return accepted;
      const actual = f.transport.gmail.messages.get(accepted.value.id);
      if (actual === undefined)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Provider fixture message missing");
      f.transport.gmail.messages.set(spoofId, {
        ...actual,
        id: spoofId,
        snippet: "Unrelated message copying a public header",
        payload: {
          ...actual.payload,
          body: { data: Buffer.from("<p>Unrelated copied hint</p>").toString("base64url") },
        },
      });
      const intake = await f.observe([spoofId, accepted.value.id]);
      expect.soft(intake.result).toMatchObject({ ok: true });
      expect.soft(intake.touchedThreadIds).not.toContain("t1");
      spoofBeforeAck = await f.observed(spoofId);
      const candidate = await f.observed(accepted.value.id);
      expectPrivateObservation(spoofBeforeAck, f.originalThreadId);
      expectPrivateObservation(candidate, f.originalThreadId);
      expect.soft(spoofBeforeAck[0]?.id).not.toBe(candidate[0]?.id);
      expect.soft(spoofBeforeAck[0]?.thread_id).not.toBe(candidate[0]?.thread_id);
      expectNoGmailAcceptance(await f.attempt());
      expect.soft(await f.originalState()).toEqual(original);
      return accepted;
    };
    expect(await f.send()).toEqual(
      ok({
        status: "sent",
        gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
      }),
    );
    expect
      .soft(
        await runEmailNotificationJob(
          db,
          { notificationId: f.notificationId },
          signal,
          f.transport.deps,
        ),
      )
      .toEqual(ok({ sent: true }));
    const confirmed = await f.observed(NOTIFICATION_PROVIDER_MESSAGE_ID);
    expectPrivateObservation(confirmed, f.originalThreadId);
    expect.soft(confirmed[0]?.direction).toBe("outbound");
    expect.soft(await f.observed(spoofId)).toEqual(spoofBeforeAck);
    expect(await f.attempt()).toMatchObject([
      {
        status: "sent",
        gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        delivery_outcome: {
          evidence: "api_ack",
          providerMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
        },
      },
    ]);
    expect.soft(await f.originalState()).toEqual(original);
    const completed = await f.attempt();
    expect.soft(completed[0]?.email_sent_at).not.toBeNull();
    expect(
      await runEmailNotificationJob(
        db,
        { notificationId: f.notificationId },
        signal,
        f.transport.deps,
      ),
    ).toEqual(ok({ sent: false }));
    expect.soft(await f.observed(spoofId)).toEqual(spoofBeforeAck);
    expect.soft(await f.observed(NOTIFICATION_PROVIDER_MESSAGE_ID)).toEqual(confirmed);
    expect.soft(await f.attempt()).toEqual(completed);
    expect(f.transport.gmail.raw).toHaveLength(1);
    expect(f.transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
  });
});
