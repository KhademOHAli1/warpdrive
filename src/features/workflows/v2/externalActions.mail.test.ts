import { beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { WorkflowV2Context, WorkflowV2Node } from "@/features/blocks/contracts";
import type * as SendModule from "@/features/email/send";
import { ok } from "@/types/result";
import { executeExternalAction } from "./externalActions";

const seam = vi.hoisted(() => ({
  resolveConnection: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/features/email/sendConnection", () => ({
  resolveSendConnection: seam.resolveConnection,
}));
vi.mock("@/features/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof SendModule>()),
  sendEmail: seam.send,
}));
vi.mock("@/features/files/storage", () => ({ makeStorageClient: () => ({}) }));

const config = {
  accountId: "4e7551bb-4089-432b-9d1b-26d37ff2f87f",
  to: ["recipient@example.invalid"],
  subject: "Fixture message",
  bodyHtml: "<p>Fixture body</p>",
};
const context: WorkflowV2Context = {
  db: {} as Db,
  actor: {
    id: "9aa388d3-115f-43fd-b2d2-4698633e48dc",
    type: "regular",
    isActive: true,
    flags: new Set(["workflow.run"]),
    groupIds: new Set(),
  },
  workflowId: "a006ab84-1bb3-43cd-992d-f6ca28f10c9a",
  runId: "da904957-b0dd-470a-bc50-33888f2bc3fd",
  executionId: "210801ad-22ef-4498-95be-c4676c1f6d6a",
  effectKey: "048abdc5-d6fa-4c92-ab5f-2ad16baef8d5",
  mode: "live",
  signal: new AbortController().signal,
  nextPickIndex: () => Promise.resolve(0),
};
const node: WorkflowV2Node = { id: "send", type: "SEND_EMAIL", version: 1, config, name: "Send" };

beforeEach(() => {
  seam.resolveConnection.mockReset().mockResolvedValue(ok({ gmail: {}, expectedGeneration: 7 }));
  seam.send.mockReset();
});

it("binds the native attempt to the workflow effect, mailbox generation and exact request", async () => {
  seam.send.mockResolvedValue(
    ok({
      status: "needs_review",
      deliveryOutcome: { state: "accepted" },
      attemptId: "receipt-id",
    }),
  );
  expect(await executeExternalAction(context, node, config)).toEqual(
    ok({
      status: "sent",
      attemptId: "receipt-id",
      messageId: null,
    }),
  );
  expect(seam.send).toHaveBeenCalledWith(
    context.db,
    expect.objectContaining({
      input: { ...config, idempotencyKey: context.effectKey, visibility: "private" },
      workflow: {
        request: config,
        purpose: {
          version: 1,
          runId: context.runId,
          executionId: context.executionId,
          actorId: context.actor.id,
          effectKey: context.effectKey,
          generation: 7,
          provider: "gmail",
          requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      },
    }),
  );
});

it.each([
  ["pending", undefined, "E_WORKFLOW_EMAIL_UNKNOWN", "unknown"],
  ["needs_review", "unknown", "E_WORKFLOW_EMAIL_UNKNOWN", "unknown"],
  ["needs_review", "partial", ERROR_IDS.MAIL_WRITE_PARTIAL, undefined],
  ["failed", "rejected", ERROR_IDS.MAIL_SEND_REJECTED, undefined],
] as const)(
  "projects %s with %s receipt without advancing as sent",
  async (status, state, id, outcome) => {
    seam.send.mockResolvedValue(
      ok({ status, ...(state === undefined ? {} : { deliveryOutcome: { state } }) }),
    );
    expect(await executeExternalAction(context, node, config)).toEqual({
      ok: false,
      error: outcome === undefined ? { id } : { id, outcome },
    });
  },
);

it("never opens a mailbox during a safe test", async () => {
  await expect(
    executeExternalAction({ ...context, mode: "test" }, node, config),
  ).resolves.toMatchObject({
    ok: false,
    error: { id: "E_WORKFLOW_EXTERNAL_TEST_FORBIDDEN" },
  });
  expect(seam.resolveConnection).not.toHaveBeenCalled();
  expect(seam.send).not.toHaveBeenCalled();
});
