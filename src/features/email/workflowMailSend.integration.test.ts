import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { emailAccounts, emailSendAttempts } from "@/db/schema/email";
import {
  workflowsV2,
  workflowV2Effects,
  workflowV2Executions,
  workflowV2Runs,
  workflowV2Versions,
} from "@/db/schema/workflowV2";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { WorkflowV2Definition } from "@/features/blocks/contracts";
import { FakeStorageClient } from "@/features/files/storageFake";
import { err } from "@/types/result";
import { FakeGmailClient } from "./gmailFake";
import { processSendAttempt } from "./outbox";
import { type SendEmailArgs, sendEmail } from "./send";
import { workflowMailRequestDigest } from "./workflowMailFence";

async function fixture(db: Db) {
  const owner = await seedUser(db, { isAdmin: true });
  const accountId = randomUUID();
  const workflowId = randomUUID();
  const versionId = randomUUID();
  const runId = randomUUID();
  const executionId = randomUUID();
  const effectKey = randomUUID();
  const request = {
    accountId,
    to: ["recipient@example.invalid"],
    subject: "Workflow fixture",
    bodyHtml: "<p>Fixture content</p>",
  };
  const definition: WorkflowV2Definition = {
    schemaVersion: 2,
    trigger: { type: "manual", config: { availability: "global" } },
    nodes: [{ id: "send", name: "Send", type: "SEND_EMAIL", version: 1, config: request }],
    edges: [],
    entryNodeIds: ["send"],
  };
  await db.insert(emailAccounts).values({
    id: accountId,
    userId: owner.id,
    emailAddress: `sender-${accountId}@example.invalid`,
    status: "connected",
    provider: "gmail",
    connectionGeneration: 7,
  });
  await db.insert(workflowsV2).values({
    id: workflowId,
    ownerId: owner.id,
    name: "Mail",
    draft: definition,
    publishedNumber: 1,
    active: true,
  });
  await db.insert(workflowV2Versions).values({
    id: versionId,
    workflowId,
    number: 1,
    name: "Mail",
    definition,
    publishedBy: owner.id,
  });
  const visitKey = "send-fixture";
  await db.insert(workflowV2Runs).values({
    id: runId,
    workflowId,
    versionId,
    actorId: owner.id,
    requestKey: randomUUID(),
    mode: "live",
    status: "running",
    state: {
      queue: [{ nodeId: "send", framePath: [], visitKey }],
      outputs: {},
      frames: [],
      stepCount: 0,
    },
    trigger: {},
  });
  await db.insert(workflowV2Executions).values({
    id: executionId,
    runId,
    nodeId: "send",
    visitKey,
    framePath: [],
    status: "running",
  });
  await db.insert(workflowV2Effects).values({
    runId,
    executionId,
    effectKey,
    request,
    status: "claimed",
    leaseUntil: new Date(Date.now() + 60_000),
  });
  const gmail = new FakeGmailClient();
  const storage = new FakeStorageClient();
  const signal = AbortSignal.timeout(15_000);
  const args = {
    actorId: owner.id,
    actorType: "admin",
    actorGroupIds: new Set<string>(),
    gmail,
    storage,
    signal,
    expectedGeneration: 7,
    input: { ...request, idempotencyKey: effectKey, visibility: "private" },
    workflow: {
      request,
      purpose: {
        version: 1,
        runId,
        executionId,
        effectKey,
        actorId: owner.id,
        provider: "gmail",
        generation: 7,
        requestDigest: workflowMailRequestDigest(request),
      },
    },
  } satisfies SendEmailArgs;
  return { args, gmail, runId, accountId, effectKey, storage, signal };
}

it("stores one accepted receipt for the pinned request, separate from ordinary mail", async () => {
  await withTestDb(async (db) => {
    const { args, gmail, accountId, effectKey, storage, signal } = await fixture(db);
    expect(await sendEmail(db, args)).toMatchObject({ ok: true, value: { status: "sent" } });
    expect(await sendEmail(db, args)).toMatchObject({ ok: true, value: { status: "sent" } });

    const changed = { ...args.workflow.request, subject: "Different subject" };
    expect(
      await sendEmail(db, {
        ...args,
        input: { ...args.input, subject: changed.subject },
        workflow: {
          request: changed,
          purpose: { ...args.workflow.purpose, requestDigest: workflowMailRequestDigest(changed) },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await processSendAttempt(db, {
        accountId,
        idempotencyKey: effectKey,
        storage,
        signal,
        gmail,
      }),
    ).toMatchObject({ ok: false });
    expect(gmail.calls.filter(({ method }) => method === "sendRaw")).toHaveLength(1);
  });
});

it("denies provider submission after the run is cancelled and parks ambiguous receipts", async () => {
  await withTestDb(async (db) => {
    const cancelled = await fixture(db);
    await db
      .update(workflowV2Runs)
      .set({ status: "cancelled" })
      .where(eq(workflowV2Runs.id, cancelled.runId));
    expect(await sendEmail(db, cancelled.args)).toMatchObject({
      ok: true,
      value: { deliveryOutcome: { state: "rejected" } },
    });
    expect(cancelled.gmail.calls).toHaveLength(0);

    const uncertain = await fixture(db);
    uncertain.gmail.sendImpl = () =>
      err(
        new AppError(ERROR_IDS.GMAIL_API_EXHAUSTED, "Fixture timeout", {
          status: 408,
        }),
      );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await sendEmail(db, uncertain.args)).toMatchObject({
        ok: true,
        value: { deliveryOutcome: { state: "unknown" } },
      });
    }
    expect(uncertain.gmail.calls.map(({ method }) => method)).toEqual(["sendRaw"]);
    const [stored] = await db
      .select({
        sendStartedAt: emailSendAttempts.sendStartedAt,
        deliveryOutcome: emailSendAttempts.deliveryOutcome,
      })
      .from(emailSendAttempts)
      .where(eq(emailSendAttempts.idempotencyKey, uncertain.effectKey));
    expect(stored?.sendStartedAt).toBeInstanceOf(Date);
    expect(stored?.deliveryOutcome).toEqual({ state: "unknown" });
  });
});
