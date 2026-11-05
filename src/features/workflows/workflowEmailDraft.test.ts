import { TransactionRollbackError } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";
import { createWorkflowEmailDraft, type WorkflowEmailDraftScope } from "./workflowEmailDraft";
import { workflowEmailDraftConfig } from "./workflowEmailDraftContract";

const native = vi.hoisted(() => ({ saveDraft: vi.fn(), resolveRunBinding: vi.fn() }));
vi.mock("@/features/email/draftRepo", () => ({ saveDraft: native.saveDraft }));
vi.mock("./runBindings", () => ({ resolveRunBinding: native.resolveRunBinding }));

const accountId = "81f1444b-8d8f-4ce1-a769-6c8bf3a030f3";
const actor: PermSetUser = {
  id: "abf7229b-c3be-4834-9cf9-2f7036b68b46",
  isActive: true,
  type: "regular",
  flags: new Set(["workflow.run"]),
  groupIds: new Set(),
};
const live = { mode: "live", runId: "52f6b244-2ea8-400a-92c9-b584c938562f" } as const;
const literal = (value: string) => ({ kind: "value" as const, value });
const config = { accountId, to: literal("sam@example.test") };
const definition: WorkflowDefinition = { schemaVersion: 1, nodes: [], edges: [] };
const signal = new AbortController().signal;

function fixture() {
  const rollback = vi.fn(() => {
    throw new TransactionRollbackError();
  });
  const savepoint = { rollback } as unknown as Db;
  const transaction = vi.fn(async (work: (tx: Db) => Promise<unknown>) => work(savepoint));
  const db = { transaction, rollback: vi.fn() } as unknown as Db;
  return { db, savepoint, transaction, rollback };
}

function run(
  db: Db,
  settings: object = config,
  scope: WorkflowEmailDraftScope = live,
  id = "draft",
  outputs: RunOutputs = {},
) {
  return createWorkflowEmailDraft(
    db,
    actor,
    { id, version: 1, config: settings },
    outputs,
    definition,
    scope,
    signal,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  native.saveDraft.mockImplementation(async (_db, { draft }) => ok({ id: draft.createId }));
});

describe("workflow email draft contract", () => {
  it("allows only a chosen mailbox and supported compose fields", () => {
    expect(workflowEmailDraftConfig.safeParse(config).success).toBe(true);
    for (const key of ["fromHandle", "attachments", "sendIntentId", "visibility", "threadId"]) {
      expect(workflowEmailDraftConfig.safeParse({ ...config, [key]: "injected" }).success).toBe(
        false,
      );
    }
    expect(
      workflowEmailDraftConfig.safeParse({ ...config, accountId: literal(accountId) }).success,
    ).toBe(false);
  });

  it("rejects invalid recipients and header injection before publication", () => {
    for (const to of [
      "",
      "Sam <sam@example.test>",
      "sam@example.test\nattacker@example.test",
      "sam@example.test,invalid",
      Array.from({ length: 21 }, (_, i) => `a${i}@example.test`).join(","),
    ]) {
      expect(workflowEmailDraftConfig.safeParse({ ...config, to: literal(to) }).success).toBe(
        false,
      );
    }
    expect(
      workflowEmailDraftConfig.safeParse({
        ...config,
        subject: literal("Hi\r\nCc: other@example.test"),
      }).success,
    ).toBe(false);
    expect(
      workflowEmailDraftConfig.safeParse({
        ...config,
        to: literal("سام@example.test, zoe@example.test"),
        cc: literal(""),
      }).success,
    ).toBe(true);
  });
});

describe("workflow email draft execution", () => {
  it("writes a private escaped draft in the caller transaction with a scoped stable UUID", async () => {
    const { db, transaction } = fixture();
    const settings = {
      ...config,
      cc: literal(" editor@example.test "),
      body: literal("<script>x</script>\nHello"),
    };
    const first = await run(db, settings);
    expect(first.ok && z.uuid().safeParse(first.value.id).success).toBe(true);
    expect(await run(db, settings)).toEqual(first);
    expect(await run(db, settings, live, "secondDraft")).not.toEqual(first);
    expect(native.saveDraft).toHaveBeenNthCalledWith(
      1,
      db,
      {
        actor,
        draft: {
          createId: first.ok ? first.value.id : undefined,
          accountId,
          toEmails: ["sam@example.test"],
          ccEmails: ["editor@example.test"],
          bccEmails: [],
          subject: "",
          bodyHtml: "<p>&lt;script&gt;x&lt;/script&gt;<br>Hello</p>",
          visibility: "private",
        },
      },
      signal,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects writes outside a caller transaction and propagates native owner denial", async () => {
    const { db, transaction } = fixture();
    expect(await run({ transaction } as unknown as Db)).toEqual(
      err(ERROR_IDS.WORKFLOW_WRITE_FAILED),
    );
    expect(native.saveDraft).not.toHaveBeenCalled();
    native.saveDraft.mockResolvedValue(
      err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable")),
    );
    expect(await run(db)).toEqual(err(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND));
  });

  it("checks mapped recipients using current workflow context before writing", async () => {
    const { db } = fixture();
    const to = { kind: "reference", nodeId: "read", path: ["title"] };
    const outputs = { read: { title: "invalid address" } };
    native.resolveRunBinding.mockReturnValueOnce({ state: "value", value: "invalid address" });
    expect(await run(db, { ...config, to }, live, "draft", outputs)).toEqual(
      err(ERROR_IDS.WORKFLOW_INVALID),
    );
    expect(native.resolveRunBinding).toHaveBeenCalledWith(to, outputs, {
      definition,
      nodeId: "draft",
      path: ["to"],
    });
    native.resolveRunBinding.mockReturnValueOnce({ state: "missing", reason: "property-absent" });
    expect(await run(db, { ...config, to })).toEqual(err(ERROR_IDS.WORKFLOW_BINDING_MISSING));
    expect(native.saveDraft).not.toHaveBeenCalled();
  });

  it.each([{ ...live, mode: "simulation" as const }, { mode: "draft-simulation" as const }])(
    "rolls back the native draft in $mode",
    async (scope) => {
      const { db, savepoint, rollback } = fixture();
      const result = await run(db, config, scope);
      expect(result).toEqual(ok({ id: expect.any(String) }));
      expect(native.saveDraft).toHaveBeenCalledWith(savepoint, expect.any(Object), signal);
      expect(rollback).toHaveBeenCalledOnce();
    },
  );
});
