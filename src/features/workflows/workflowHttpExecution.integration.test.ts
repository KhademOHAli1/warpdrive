import { PassThrough } from "node:stream";
import { eq } from "drizzle-orm";
import { assert, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { persons, workflowExternalEffects, workflowRuns, workflowSteps } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { EndpointResolver } from "@/features/connections/connectionEndpoint";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { err, ok } from "@/types/result";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";
import { hasWorkflowHttpOperatorGrant } from "./workflowHttpOperatorPolicy";
import type { WorkflowHttpsTransport } from "./workflowHttpRequestTransport";
import {
  claimWorkflowHttpRequest,
  dispatchClaimedWorkflowHttpRequest,
  type WorkflowHttpRequestWorkerServices,
} from "./workflowHttpRequestWorker";

const endpoint = "https://api.example.test/workflow-orders";
const mappedName = "Synthetic HTTP result contact";
const expectedOutput = { status: 201, "result.name": mappedName };
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "trigger.manual", name: "Start", version: 1, config: { scope: "global" } },
    {
      id: "request",
      type: "http.request",
      name: "HTTP Request",
      version: 1,
      config: {
        url: { kind: "value", value: endpoint },
        method: "POST",
        body: {
          kind: "json",
          fields: [{ name: "reference", value: { kind: "value", value: "fixture" } }],
        },
        response: [{ name: "name", type: "text" }],
      },
    },
    {
      id: "contact",
      type: "record.create",
      name: "Create Person",
      version: 1,
      config: {
        entity: "person",
        fields: { name: { kind: "reference", nodeId: "request", path: ["result", "name"] } },
      },
    },
  ],
  edges: [
    { from: "start", to: "request", port: "next" },
    { from: "request", to: "contact", port: "next" },
  ],
};

function fakeHttps(db: Db, attemptId: string) {
  const resolver = vi.fn<EndpointResolver>(async () => {
    const [durable] = await db
      .select({ dispatchAuthorizedAt: workflowExternalEffects.dispatchAuthorizedAt })
      .from(workflowExternalEffects)
      .where(eq(workflowExternalEffects.attemptId, attemptId));
    assert(
      durable?.dispatchAuthorizedAt instanceof Date,
      "dispatch authority must commit before I/O",
    );
    return [{ address: "8.8.8.8", family: 4 }];
  });
  const end = vi.fn<(body?: string) => void>();
  const transport = vi.fn<WorkflowHttpsTransport>((_options, receive) => ({
    once: vi.fn(),
    destroy: vi.fn(),
    end(body) {
      end(body);
      const response = Object.assign(new PassThrough(), {
        statusCode: 201,
        headers: { "content-type": "application/json", "set-cookie": "fixture-private-header" },
      });
      receive(response);
      response.end(JSON.stringify({ name: mappedName, extra: "fixture-private-body" }));
    },
  }));
  return { resolver, transport, end };
}

async function publishAndAdmit(db: Db, actor: PermSetUser, signal: AbortSignal) {
  const created = await createWorkflow(
    db,
    actor,
    { name: "Synthetic HTTP workflow", definition },
    signal,
  );
  assert(created.ok, JSON.stringify(created));
  const { id: workflowId, revision } = created.value;
  assert(
    !hasWorkflowHttpOperatorGrant(workflowId),
    "fixture must use only its injected HTTPS grant",
  );
  const published = await publishWorkflow(db, actor, workflowId, revision, signal);
  assert(published.ok, JSON.stringify(published));
  const input = {
    workflowId,
    requestKey: crypto.randomUUID(),
    reviewedVersionId: published.value.id,
  };
  expect(await admitManualRun(db, actor, { ...input, mode: "simulation" }, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_NOT_READY),
  );
  const admitted = await admitManualRun(db, actor, { ...input, mode: "live" }, signal);
  assert(admitted.ok, JSON.stringify(admitted));
  expect(admitted.value).toMatchObject({
    versionId: published.value.id,
    trigger: { scope: "global" },
  });
  return { workflowId, version: published.value, runId: admitted.value.id };
}

async function acquireAtCursor(
  db: Db,
  actor: PermSetUser,
  runId: string,
  pinned: WorkflowDefinition,
  services: WorkflowHttpRequestWorkerServices,
  signal: AbortSignal,
) {
  const claimed = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .for("update");
    assert(run !== undefined && run.nextNodeId === "request");
    const node = pinned.nodes.find(({ id }) => id === run.nextNodeId);
    assert(node?.type === "http.request");
    return claimWorkflowHttpRequest(
      { tx, run, node, definition: pinned, actor, workflowOwnerId: actor.id },
      services,
      signal,
    );
  });
  assert(claimed.ok && claimed.value.state === "acquired", JSON.stringify(claimed));
  return claimed.value.claim;
}

it("continues a published Global run from one durable HTTP receipt under competing deliveries", async () => {
  const test = await makeTestDb();
  try {
    const signal = new AbortController().signal;
    const user = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, user.id, signal);
    assert(actor !== null);
    const { workflowId, version, runId } = await publishAndAdmit(test.db, actor, signal);
    const services: WorkflowHttpRequestWorkerServices = {
      readGrants: ({ workflowId: candidateId, actorId }) =>
        candidateId === workflowId && actorId === actor.id
          ? [
              {
                url: endpoint,
                methods: ["POST"],
                operatorHeaders: { authorization: "fixture-private-token" },
              },
            ]
          : [],
    };
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("running"));
    const claim = await acquireAtCursor(
      test.db,
      actor,
      runId,
      version.definition,
      services,
      signal,
    );
    const https = fakeHttps(test.db, claim.attemptId);
    const effects = () =>
      test.db
        .select()
        .from(workflowExternalEffects)
        .where(eq(workflowExternalEffects.runId, runId));
    expect(await effects()).toMatchObject([
      {
        attemptId: claim.attemptId,
        nodeId: "request",
        iterationIndex: -1,
        state: "started",
        dispatchAuthorizedAt: null,
        output: null,
      },
    ]);
    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("waiting"));
    expect(await test.db.select().from(persons)).toHaveLength(0);
    expect(https.transport).not.toHaveBeenCalled();

    const dispatch = () =>
      dispatchClaimedWorkflowHttpRequest(test.db, claim, services, signal, https);
    const competing = await Promise.all([dispatch(), dispatch()]);
    expect(competing.every((result) => result.ok)).toBe(true);
    expect(competing.some((result) => result.ok && result.value.state === "complete")).toBe(true);
    const completed = await effects();
    expect(completed).toMatchObject([
      {
        attemptId: claim.attemptId,
        state: "complete",
        dispatchAuthorizedAt: expect.any(Date),
        finishedAt: expect.any(Date),
        output: expectedOutput,
        errorId: null,
      },
    ]);
    expect(JSON.stringify(completed)).not.toContain("fixture-private");
    expect(https.end).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ reference: "fixture" }));

    expect(await advanceWorkflowRun(test.db, runId, signal)).toEqual(ok("running"));
    const finishes = await Promise.all([
      advanceWorkflowRun(test.db, runId, signal),
      advanceWorkflowRun(test.db, runId, signal),
    ]);
    expect(finishes).toEqual([ok("succeeded"), ok("succeeded")]);
    expect(await dispatch()).toMatchObject({
      ok: true,
      value: { state: "complete", output: expectedOutput },
    });
    expect(await effects()).toEqual(completed);
    expect(https.resolver).toHaveBeenCalledTimes(1);
    expect(https.transport).toHaveBeenCalledTimes(1);

    const rows = await test.db.select({ id: persons.id, name: persons.name }).from(persons);
    expect(rows).toMatchObject([{ name: mappedName }]);
    const steps = await test.db
      .select({
        nodeId: workflowSteps.nodeId,
        output: workflowSteps.output,
        simulated: workflowSteps.simulated,
      })
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, runId));
    expect(steps).toHaveLength(3);
    expect(steps).toEqual(
      expect.arrayContaining([
        { nodeId: "start", output: {}, simulated: false },
        { nodeId: "request", output: expectedOutput, simulated: false },
        { nodeId: "contact", output: { id: rows[0]?.id }, simulated: false },
      ]),
    );
  } finally {
    await test.close();
  }
});
