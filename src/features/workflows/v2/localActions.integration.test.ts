import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { activities, notifications } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { BlockOutput, WorkflowV2Node } from "@/features/blocks/contracts";
import { setPreference } from "@/features/notifications/preferences";
import type { PermSetUser } from "@/features/permissions/effective";
import { executeNativeAction, nativeActionReadiness } from "./nativeActions";

const signal = () => AbortSignal.timeout(10_000);
function actor(id: string, admin = true): PermSetUser {
  return {
    id,
    type: admin ? "admin" : "regular",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
}
function node(type: WorkflowV2Node["type"], config: BlockOutput): WorkflowV2Node {
  return { id: "local", name: type, type, config, version: 1 };
}
async function run(
  db: Db,
  who: PermSetUser,
  type: WorkflowV2Node["type"],
  config: BlockOutput,
  effectKey = randomUUID(),
) {
  return db.transaction((tx) =>
    executeNativeAction(tx, {
      actor: who,
      node: node(type, config),
      resolvedConfig: config,
      effectKey,
      signal: signal(),
      nextPickIndex: () => Promise.resolve(0),
    }),
  );
}
async function mailbox(db: Db, userId: string) {
  const result = await db.execute<{ id: string }>(
    sql`INSERT INTO email_accounts(user_id,email_address,status) VALUES(${userId},'workflow@example.com','disconnected') RETURNING id`,
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("mailbox fixture missing");
  return id;
}

it("creates a private sanitized local draft in an owned disconnected mailbox and replays the same creation", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db, { isAdmin: true });
    const who = actor(owner.id);
    const accountId = await mailbox(db, owner.id);
    const config = {
      accountId,
      to: ["contact@example.com"],
      subject: "Review first",
      bodyHtml: '<p>Draft</p><script>alert("x")</script>',
    };
    expect(await nativeActionReadiness(db, who, node("DRAFT_EMAIL", config), signal())).toEqual({
      state: "ready",
    });
    const key = randomUUID();
    const first = await run(db, who, "DRAFT_EMAIL", config, key);
    const replay = await run(db, who, "DRAFT_EMAIL", config, key);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ ok: true, value: { draftId: key, sent: false } });
    const saved = await db.execute<{ body_html: string; visibility: string }>(
      sql`SELECT body_html,visibility FROM email_drafts WHERE id=${key}::uuid`,
    );
    expect(saved.rows[0]?.body_html).not.toContain("<script");
    expect(saved.rows[0]?.visibility).toBe("private");
    const stranger = await seedUser(db, { isAdmin: true });
    expect((await run(db, actor(stranger.id), "DRAFT_EMAIL", config)).ok).toBe(false);
  });
});

it("creates an actual local all-day event with civil dates and refuses unsupported invitations", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    const config = {
      title: "Review",
      startsAt: "2026-11-05T00:00:00+03:30",
      endsAt: "2026-11-05T23:59:00+03:30",
      allDay: true,
      timeZone: "Asia/Tehran",
    };
    const result = await run(db, who, "CREATE_CALENDAR_EVENT", config);
    expect(result).toMatchObject({
      ok: true,
      value: { calendar: "local", invitationsSent: false, conferenceCreated: false },
    });
    if (!result.ok || typeof result.value.eventId !== "string")
      throw new Error("calendar creation failed");
    const [saved] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, result.value.eventId));
    expect(saved).toMatchObject({
      subject: "Review",
      allDay: true,
      dueDate: "2026-11-05",
      endDate: "2026-11-05",
    });
    const invitation = {
      ...config,
      sendInvitations: true,
      attendeeEmails: ["contact@example.com"],
    };
    expect(
      await nativeActionReadiness(db, who, node("CREATE_CALENDAR_EVENT", invitation), signal()),
    ).toMatchObject({ state: "needs_connection" });
    expect(await run(db, who, "CREATE_CALENDAR_EVENT", invitation)).toEqual({
      ok: false,
      error: "workflow_calendar_provider_unavailable",
    });
    expect(await db.select().from(activities)).toHaveLength(1);
  });
});

it("delivers actual in-app workflow messages only to current members and rolls back with the step", async () => {
  await withTestDb(async (db) => {
    const sender = await seedUser(db, { isAdmin: true });
    const recipient = await seedUser(db);
    const who = actor(sender.id);
    const config = {
      recipientId: recipient.id,
      title: "Approval",
      message: "Please review the proposal.",
      requireApproval: true,
    };
    const result = await run(db, who, "SEND_CHAT_MESSAGE", config);
    expect(result).toMatchObject({
      ok: true,
      value: { delivered: true, channel: "in_app", approvalRequired: true },
    });
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, recipient.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "workflow_message",
      actorId: sender.id,
      emailSentAt: null,
      payload: { title: "Approval", message: "Please review the proposal." },
    });
    const inactive = await seedUser(db, { isActive: false });
    expect(
      (await run(db, who, "SEND_CHAT_MESSAGE", { ...config, recipientId: inactive.id })).ok,
    ).toBe(false);
    const noRun = await seedUser(db);
    expect((await run(db, actor(noRun.id, false), "SEND_CHAT_MESSAGE", config)).ok).toBe(false);
    await setPreference(
      db,
      recipient.id,
      "workflow_message",
      { inApp: false, email: false },
      signal(),
    );
    expect(await run(db, who, "SEND_CHAT_MESSAGE", config)).toEqual({
      ok: false,
      error: "workflow_chat_delivery_disabled",
    });
    await setPreference(
      db,
      recipient.id,
      "workflow_message",
      { inApp: true, email: false },
      signal(),
    );
    await expect(
      db.transaction(async (tx) => {
        const created = await executeNativeAction(tx, {
          actor: who,
          node: node("SEND_CHAT_MESSAGE", config),
          resolvedConfig: config,
          effectKey: randomUUID(),
          signal: signal(),
          nextPickIndex: () => Promise.resolve(0),
        });
        expect(created.ok).toBe(true);
        throw new Error("rollback step");
      }),
    ).rejects.toThrow("rollback step");
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, recipient.id)),
    ).toHaveLength(1);
  });
});
