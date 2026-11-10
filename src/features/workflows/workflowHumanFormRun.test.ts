import { expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { validateDefinition } from "./definition";
import { mappingOutputForReference } from "./mappingCatalog";
import { draftExecutableDefinition, executableDefinition } from "./readiness";
import type { WorkflowDefinition } from "./schemas";
import { pendingWorkflowHumanForm } from "./workflowHumanFormPending";
import { advanceWorkflowHumanForm } from "./workflowHumanFormWait";

const now = new Date("2026-11-05T12:00:00Z");
const id = "339b9077-665c-4d51-9803-c1fc3a1d88f4";
const actorId = "71026503-08f6-46a8-97da-6d7df2aba026";
const fieldId = "c002097a-39ad-4a66-afce-5d0485b40750";
const path = ["answers", fieldId];
const reference = { kind: "reference", nodeId: "collect", path } as const;

const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "trigger.manual", version: 1, name: "Manual", config: {} },
    {
      id: "collect",
      type: "human.form",
      version: 1,
      name: "Confirmation",
      config: { fields: [{ id: fieldId, label: "Company name", type: "text", required: true }] },
    },
    {
      id: "make",
      type: "record.create",
      version: 1,
      name: "Create organization",
      config: { entity: "organization", fields: { name: reference } },
    },
  ],
  edges: [
    { from: "start", to: "collect", port: "next" },
    { from: "collect", to: "make", port: "next" },
  ],
};

it("exposes the form's declared output to a downstream record while excluding preview admission", () => {
  expect(validateDefinition(definition).ok).toBe(true);
  expect(executableDefinition(definition)).toBe(true);
  expect(draftExecutableDefinition(definition)).toBe(false);
  expect(mappingOutputForReference(definition, reference)).toMatchObject({
    path,
    label: "Company name",
    contract: { kind: "text", nullable: false },
  });
  expect(
    mappingOutputForReference(definition, { ...reference, path: ["answers", "other"] }),
  ).toBeUndefined();
});

it("arms one deadline and fails on expiry without fabricating or exposing an answer", async () => {
  const set = vi.fn(() => ({ where: () => Promise.resolve() }));
  const db = { update: () => ({ set }) } as unknown as Db;
  const run = { id, mode: "live", status: "running", resumeAt: null } as const;
  const deadline = new Date("2026-11-12T12:00:00Z");
  const signal = new AbortController().signal;
  expect(await advanceWorkflowHumanForm(db, run, now, signal)).toEqual({
    ok: true,
    value: { status: "waiting", armedDeadline: deadline },
  });
  expect(set).toHaveBeenCalledExactlyOnceWith({
    status: "waiting",
    updatedAt: now,
    resumeAt: deadline,
  });
  const waiting = {
    ...run,
    status: "waiting",
    resumeAt: deadline,
    nextNodeId: "collect",
    actorId,
  } as const;
  expect(await advanceWorkflowHumanForm(db, waiting, now, signal)).toEqual({
    ok: true,
    value: { status: "waiting" },
  });
  expect(await advanceWorkflowHumanForm(db, waiting, deadline, signal)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_FORM_EXPIRED,
  });
  expect(set).toHaveBeenCalledOnce();
  expect(pendingWorkflowHumanForm(waiting, definition, actorId, true)).toMatchObject({
    nodeId: "collect",
    deadline,
  });
  expect(pendingWorkflowHumanForm(waiting, definition, id, true)).toBeUndefined();
  expect(pendingWorkflowHumanForm(waiting, definition, actorId, false)).toBeUndefined();
});
