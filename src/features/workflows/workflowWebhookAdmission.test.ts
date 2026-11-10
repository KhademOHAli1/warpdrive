import { createHmac } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import {
  admitWorkflowWebhookDelivery,
  type WorkflowWebhookAdmissionServices,
} from "./workflowWebhookAdmission";
import { type WorkflowWebhookRequest, workflowWebhookRequestKey } from "./workflowWebhookAuth";
import { workflowWebhookLimits } from "./workflowWebhookContract";

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  parse: vi.fn(),
  executable: vi.fn(),
  validate: vi.fn(),
  visible: vi.fn(),
  humanForm: vi.fn(),
}));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: mocks.hydrate }));
vi.mock("@/features/permissions/referenceCheck", () => ({ assertReferenceVisible: mocks.visible }));
vi.mock("@/features/custom-fields/currentValidation", () => ({
  prepareCurrentCustomFieldValidation: vi.fn(),
}));
vi.mock("./schemas", () => ({ definitionSchema: { safeParse: mocks.parse } }));
vi.mock("./definition", () => ({ validateDefinition: mocks.validate }));
vi.mock("./readiness", () => ({
  executableDefinition: mocks.executable,
  requiresHumanForm: mocks.humanForm,
}));

const workflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const versionId = "52f6b244-2ea8-400a-92c9-b584c9385630";
const eventId = "52f6b244-2ea8-400a-92c9-b584c9385631";
const recordId = "52f6b244-2ea8-400a-92c9-b584c9385632";
const ownerId = "52f6b244-2ea8-400a-92c9-b584c9385633";
const runId = "52f6b244-2ea8-400a-92c9-b584c9385634";
const now = 1_773_000_000_000;
const signingKey = Buffer.alloc(32, 8).toString("base64url");
const key = { ownerId, signingKey };
const payload = { scope: "webhook", httpMethod: "POST", eventId, recordId };
const owner: HydratedActor = {
  id: ownerId,
  name: "Webhook owner",
  email: "webhook-owner@example.invalid",
  avatarUrl: null,
  type: "regular",
  isActive: true,
  flags: new Set(["workflow.run"]),
  groupIds: new Set(),
};

function definition(httpMethod: "GET" | "POST" = "POST") {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.webhook",
        version: 1,
        config: { httpMethod, authentication: "HMAC_SHA256" },
      },
    ],
    edges: [],
  };
}

function signed(
  method: "GET" | "POST" = "POST",
  id = recordId,
  pinnedVersion = versionId,
): WorkflowWebhookRequest {
  const timestamp = String(now / 1000);
  const query = method === "GET" ? `eventId=${eventId}` : "";
  const body =
    method === "POST" ? Buffer.from(JSON.stringify({ eventId, recordId: id })) : Buffer.alloc(0);
  const signature = createHmac("sha256", Buffer.from(signingKey, "base64url"))
    .update(
      ["warpdrive.workflow.webhook.v1", method, workflowId, pinnedVersion, timestamp, ""].join(
        "\n",
      ),
    )
    .update(method === "GET" ? Buffer.from(query) : body)
    .digest("hex");
  return {
    method,
    contentType: method === "POST" ? "application/json" : null,
    publication: { workflowId, versionId: pinnedVersion },
    timestamp,
    signature: `v1=${signature}`,
    rawBody: body,
    rawQuery: query,
  };
}

function database({
  workflow = [{ ownerId, publishedNumber: 3 }],
  publications = [{ definition: definition() }],
  receipts = [],
}: {
  workflow?: unknown[];
  publications?: unknown[];
  receipts?: unknown[];
} = {}) {
  const rows = new Map<object, unknown[]>([
    [workflows, workflow],
    [workflowVersions, publications],
    [workflowRuns, receipts],
  ]);
  const locks = vi.fn<(table: object, mode: string) => void>();
  const filters = new Map<object, SQL>();
  const tx = {
    select: () => ({
      from: (table: object) => ({
        where: (predicate: SQL) => {
          filters.set(table, predicate);
          const selected = Promise.resolve(rows.get(table) ?? []);
          return Object.assign(selected, {
            for: (mode: string) => {
              locks(table, mode);
              return selected;
            },
            limit: () => selected,
          });
        },
      }),
    }),
  };
  const transaction = vi.fn((execute: (value: typeof tx) => Promise<unknown>) => execute(tx));
  const db = { transaction } as unknown as Db;
  const readSigningKey = vi
    .fn<WorkflowWebhookAdmissionServices["readSigningKey"]>()
    .mockResolvedValue(key);
  const insertRun = vi
    .fn<WorkflowWebhookAdmissionServices["insertRun"]>()
    .mockResolvedValue({ id: runId });
  const services = { readSigningKey, insertRun };
  const signal = new AbortController().signal;
  return {
    db,
    tx,
    locks,
    filters,
    transaction,
    services,
    signal,
    readSigningKey,
    insertRun,
    admit: (request: WorkflowWebhookRequest = signed()) =>
      admitWorkflowWebhookDelivery(db, request, services, signal),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  mocks.hydrate.mockResolvedValue(owner);
  mocks.parse.mockImplementation((value: unknown) => ({ success: true, data: value }));
  mocks.executable.mockReturnValue(true);
  mocks.validate.mockReturnValue(ok(definition()));
  mocks.humanForm.mockReturnValue(false);
  mocks.visible.mockResolvedValue(ok(undefined));
});

afterEach(() => vi.restoreAllMocks());

it("authenticates before locking, rechecks the workflow key under lock, and inserts only pinned live data", async () => {
  const test = database();
  await expect(test.admit()).resolves.toEqual(ok({ runId, replayed: false }));
  expect(test.locks).toHaveBeenCalledExactlyOnceWith(workflows, "update");
  expect(test.readSigningKey.mock.calls).toEqual([
    [test.db, workflowId, test.signal],
    [test.tx, workflowId, test.signal],
  ]);
  expect(test.readSigningKey).toHaveBeenCalledBefore(test.locks);
  const publicationFilter = test.filters.get(workflowVersions);
  assert(publicationFilter !== undefined);
  expect(new PgDialect().sqlToQuery(publicationFilter).params).toEqual([versionId, workflowId, 3]);
  expect(mocks.hydrate).toHaveBeenCalledExactlyOnceWith(test.tx, ownerId, test.signal);
  expect(mocks.visible).toHaveBeenCalledExactlyOnceWith(
    test.tx,
    expect.objectContaining({ userId: ownerId }),
    { kind: "deal", id: recordId },
    test.signal,
  );
  expect(test.insertRun).toHaveBeenCalledExactlyOnceWith(test.tx, {
    workflowId,
    versionId,
    actorId: ownerId,
    requestKey: workflowWebhookRequestKey(workflowId, eventId),
    mode: "live",
    trigger: payload,
    nextNodeId: "start",
  });
});

it("admits a signed GET without a Deal and rejects a signed method the trigger did not publish", async () => {
  const test = database({ publications: [{ definition: definition("GET") }] });
  await expect(test.admit(signed("GET"))).resolves.toEqual(ok({ runId, replayed: false }));
  expect(mocks.visible).not.toHaveBeenCalled();
  expect(test.insertRun.mock.calls[0]?.[1].trigger).toEqual({
    scope: "webhook",
    httpMethod: "GET",
    eventId,
  });
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  expect(test.insertRun).toHaveBeenCalledTimes(1);
});

it("avoids the workflow lock and storage for invalid signatures, unknown keys, or over-limit bodies", async () => {
  const test = database();
  const request = signed();
  await expect(
    test.admit({ ...request, rawBody: new Uint8Array(workflowWebhookLimits.bodyBytes + 1) }),
  ).resolves.toEqual(err("invalid-request"));
  expect(test.readSigningKey).not.toHaveBeenCalled();
  await expect(test.admit({ ...request, signature: `v1=${"a".repeat(64)}` })).resolves.toEqual(
    err("unauthorized"),
  );
  test.readSigningKey.mockResolvedValueOnce(null);
  await expect(test.admit()).resolves.toEqual(err("unauthorized"));
  expect(test.transaction).not.toHaveBeenCalled();
  expect(test.insertRun).not.toHaveBeenCalled();
});

it("denies key rotation, owner rotation, and clock expiry while the lock is acquired", async () => {
  const rotated = database();
  rotated.readSigningKey
    .mockResolvedValueOnce(key)
    .mockResolvedValueOnce({ ...key, signingKey: Buffer.alloc(32, 9).toString("base64url") });
  await expect(rotated.admit()).resolves.toEqual(err("unauthorized"));
  expect(rotated.insertRun).not.toHaveBeenCalled();
  const transferred = database({ workflow: [{ ownerId: recordId, publishedNumber: 3 }] });
  await expect(transferred.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
  expect(transferred.insertRun).not.toHaveBeenCalled();
  const late = database();
  late.readSigningKey.mockResolvedValueOnce(key).mockImplementationOnce(() => {
    vi.mocked(Date.now).mockReturnValue(now + workflowWebhookLimits.clockSkewMs + 1);
    return Promise.resolve(key);
  });
  await expect(late.admit()).resolves.toEqual(err("unauthorized"));
  expect(late.insertRun).not.toHaveBeenCalled();
});

it("checks the same bounded request byte snapshot after async key reads", async () => {
  const test = database();
  const request = signed();
  test.readSigningKey.mockImplementationOnce(() => {
    request.rawBody.fill(0);
    request.publication.versionId = recordId;
    return Promise.resolve(key);
  });
  await expect(test.admit(request)).resolves.toEqual(ok({ runId, replayed: false }));
  expect(test.insertRun.mock.calls[0]?.[1]).toMatchObject({ versionId, trigger: payload });
});

it.each([
  { rows: { workflow: [] }, code: ERROR_IDS.WORKFLOW_DENIED },
  { rows: { workflow: [{ ownerId, publishedNumber: null }] }, code: ERROR_IDS.WORKFLOW_DENIED },
  { rows: { publications: [] }, code: ERROR_IDS.WORKFLOW_CONFLICT },
  { rows: { publications: [{ definition: { nodes: [] } }] }, code: ERROR_IDS.WORKFLOW_NOT_READY },
])("rejects inactive, unpublished, wrong or triggerless publication", async ({ rows, code }) => {
  const test = database(rows);
  await expect(test.admit()).resolves.toEqual(err(code));
  expect(test.insertRun).not.toHaveBeenCalled();
});

it("requires current owner run authority, form viewing authority and Deal visibility before replay or insert", async () => {
  const test = database();
  mocks.hydrate.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...owner, flags: new Set() });
  for (let index = 0; index < 2; index++) {
    await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
  }
  mocks.humanForm.mockReturnValueOnce(true);
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
  mocks.visible.mockResolvedValueOnce(err("hidden record"));
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_DENIED));
  expect(test.filters.has(workflowRuns)).toBe(false);
  expect(test.insertRun).not.toHaveBeenCalled();
});

it("returns the existing ID after checking the workflow-wide event key and exact pinned replay data", async () => {
  const existing = { id: runId, actorId: ownerId, versionId, mode: "live", trigger: payload };
  const test = database({ receipts: [existing] });
  await expect(test.admit()).resolves.toEqual(ok({ runId, replayed: true }));
  const filter = test.filters.get(workflowRuns);
  assert(filter !== undefined);
  expect(new PgDialect().sqlToQuery(filter).params).toEqual([
    workflowId,
    workflowWebhookRequestKey(workflowId, eventId),
  ]);
  expect(test.insertRun).not.toHaveBeenCalled();
  expect(mocks.visible).toHaveBeenCalledTimes(1);
});

it.each([
  { versionId: recordId },
  { actorId: recordId },
  { mode: "simulation" },
  { trigger: { ...payload, recordId: runId } },
  { trigger: { scope: "webhook", httpMethod: "GET", eventId } },
  { trigger: { ...payload, signingKey } },
])("conflicts with a prior workflow-wide event recorded for different run data", async (change) => {
  const existing = { id: runId, actorId: ownerId, versionId, mode: "live", trigger: payload };
  const test = database({ receipts: [{ ...existing, ...change }] });
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_CONFLICT));
  expect(test.insertRun).not.toHaveBeenCalled();
});

it("does not start a replayed event under a newly published version", async () => {
  const prior = { id: runId, actorId: ownerId, versionId, mode: "live", trigger: payload };
  const test = database({ receipts: [prior], workflow: [{ ownerId, publishedNumber: 4 }] });
  await expect(test.admit(signed("POST", recordId, runId))).resolves.toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(test.insertRun).not.toHaveBeenCalled();
});

it("validates configuration before writing and returns only a static error when insertion has no receipt", async () => {
  const test = database();
  mocks.validate.mockReturnValueOnce(err("unavailable configuration"));
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  expect(test.insertRun).not.toHaveBeenCalled();
  test.insertRun.mockResolvedValueOnce(undefined);
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_WRITE_FAILED));
});

it("returns a static failure if a private key lookup or durable insert throws", async () => {
  const test = database();
  test.readSigningKey.mockRejectedValueOnce(new Error("Private secret store error"));
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_WRITE_FAILED));
  expect(test.transaction).not.toHaveBeenCalled();
  test.insertRun.mockRejectedValueOnce(new Error("Private database diagnostic"));
  await expect(test.admit()).resolves.toEqual(err(ERROR_IDS.WORKFLOW_WRITE_FAILED));
});
