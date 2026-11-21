import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { enableNativeProjects } from "@/features/agency-projects/nativeViews";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { internalProjectItemEvents } from "../profile/schema";
import {
  createInternalProject,
  createInternalProjectItem,
  readInternalProject,
  setInternalProjectMember,
} from "../service";
import type { ProjectIntakeFilter } from "./contracts";
import { internalProjectIntakeRequests } from "./schema";
import {
  createProjectIntake,
  findIntakeWorkItems,
  readProjectIntake,
  reviewProjectIntake,
  setProjectIntakeEnabled,
  updateProjectIntake,
  withdrawProjectIntake,
} from "./service";

let fixture: TestDb;
beforeAll(async () => {
  fixture = await makeTestDb();
});
afterAll(async () => {
  await fixture?.close();
});
const signal = () => AbortSignal.timeout(10_000);

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(`Unexpected result: ${String(result.error)}`);
  return result.value;
}

async function staff(name: string, isAdmin = false) {
  const user = await seedUser(fixture.db, { name, isAdmin });
  const sessionId = randomUUID();
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 300_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId: user.id, sessionId };
}

type Staff = Awaited<ReturnType<typeof staff>>;

async function project(owner: Staff, title: string) {
  value(await enableNativeProjects(fixture.db, owner, true, signal()));
  return value(
    await createInternalProject(fixture.db, owner, { id: randomUUID(), title }, signal()),
  ).id;
}

async function member(
  owner: Staff,
  projectId: string,
  who: Staff,
  role: "editor" | "viewer" | null,
) {
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      {
        projectId,
        userId: who.userId,
        membership: role === null ? null : { role, canAssign: false },
      },
      signal(),
    ),
  );
}

function queue(
  who: Staff,
  projectId: string,
  requestId?: string,
  filter: ProjectIntakeFilter = "all",
) {
  return readProjectIntake(fixture.db, who, { projectId, page: 1, filter, requestId }, signal());
}

function draft(projectId: string, title: string) {
  return {
    projectId,
    title,
    description: "Needs review",
    priority: "high" as const,
    intentId: randomUUID(),
  };
}

test("keeps Intake gated and separates owner, editor, author and outsider access", async () => {
  const db = fixture.db;
  const [owner, editor, viewer, unrelatedAdmin] = await Promise.all([
    staff("Intake owner", true),
    staff("Intake editor"),
    staff("Intake viewer"),
    staff("Outside administrator", true),
  ]);
  const projectId = await project(owner, "Review queue");
  await member(owner, projectId, editor, "editor");
  await member(owner, projectId, viewer, "viewer");
  const settings = { projectId, enabled: true, revision: 0 };
  const submission = draft(projectId, "Viewer request");
  expect(value(await queue(owner, projectId))).toMatchObject({ enabled: false, canSubmit: false });
  expect(await createProjectIntake(db, viewer, submission, signal())).toEqual(
    err("project_forbidden"),
  );
  expect(await setProjectIntakeEnabled(db, editor, settings, signal())).toEqual(
    err("project_forbidden"),
  );
  expect(value(await setProjectIntakeEnabled(db, owner, settings, signal()))).toEqual({
    enabled: true,
    revision: 1,
  });
  expect(await setProjectIntakeEnabled(db, owner, settings, signal())).toEqual(
    err("project_conflict"),
  );
  const own = value(await createProjectIntake(db, viewer, submission, signal()));
  const other = value(
    await createProjectIntake(db, editor, draft(projectId, "Editor request"), signal()),
  );
  expect(value(await createProjectIntake(db, viewer, submission, signal()))).toEqual(own);
  expect(value(await readInternalProject(db, owner, projectId, signal())).items).toHaveLength(0);
  expect(value(await queue(owner, projectId)).canReview).toBe(true);
  expect(value(await queue(editor, projectId)).requests).toHaveLength(2);
  expect(value(await queue(viewer, projectId)).requests.map(({ id }) => id)).toEqual([own.id]);
  expect(await queue(viewer, projectId, other.id)).toEqual(err("project_unavailable"));
  expect(await queue(unrelatedAdmin, projectId)).toEqual(err("project_unavailable"));
  const target = { projectId, requestId: own.id, revision: 0 };
  expect(await reviewProjectIntake(db, editor, { ...target, action: "accept" }, signal())).toEqual(
    err("project_forbidden"),
  );
  expect(await findIntakeWorkItems(db, viewer, projectId, "", signal())).toEqual(
    err("project_forbidden"),
  );
  value(
    await updateProjectIntake(
      db,
      viewer,
      {
        ...target,
        title: "Edited by reporter",
        priority: "urgent",
        description: "Updated description",
      },
      signal(),
    ),
  );
  expect(value(await queue(owner, projectId, own.id)).selected).toMatchObject({
    title: "Edited by reporter",
    revision: 1,
  });
  expect(await withdrawProjectIntake(db, viewer, target, signal())).toEqual(
    err("project_conflict"),
  );
  value(await withdrawProjectIntake(db, viewer, { ...target, revision: 1 }, signal()));
  expect(await queue(owner, projectId, own.id)).toEqual(err("project_unavailable"));
  expect(await createProjectIntake(db, viewer, submission, signal())).toEqual(
    err("project_conflict"),
  );
  await member(owner, projectId, viewer, null);
  expect(await queue(viewer, projectId)).toEqual(err("project_unavailable"));
  value(
    await setProjectIntakeEnabled(
      db,
      owner,
      { ...settings, enabled: false, revision: 1 },
      signal(),
    ),
  );
  expect(value(await queue(owner, projectId)).requests).toEqual([]);
  value(await setProjectIntakeEnabled(db, owner, { ...settings, revision: 2 }, signal()));
  expect(value(await queue(owner, projectId)).requests.map(({ id }) => id)).toEqual([other.id]);
});

test("snoozes, accepts exactly once into the native project and keeps duplicate links project-scoped", async () => {
  const db = fixture.db;
  const [owner, requester] = await Promise.all([
    staff("Intake reviewer", true),
    staff("Intake requester"),
  ]);
  const projectId = await project(owner, "Request triage");
  const sibling = await project(owner, "Another intake project");
  await member(owner, projectId, requester, "viewer");
  value(
    await setProjectIntakeEnabled(db, owner, { projectId, enabled: true, revision: 0 }, signal()),
  );
  const item = value(
    await createProjectIntake(db, requester, draft(projectId, "Ready for triage"), signal()),
  );
  const target = { projectId, requestId: item.id, revision: 0 };
  expect(await queue(owner, sibling, item.id)).toMatchObject({
    ok: true,
    value: { enabled: false, selected: null },
  });
  const until = new Date(Date.now() + 86_400_000).toISOString();
  value(await reviewProjectIntake(db, owner, { ...target, action: "snooze", until }, signal()));
  expect(value(await queue(owner, projectId, item.id, "pending")).requests).toEqual([]);
  expect(value(await queue(owner, projectId, item.id, "snoozed")).selected).toMatchObject({
    status: "snoozed",
    snoozedUntil: until,
  });
  await db
    .update(internalProjectIntakeRequests)
    .set({ snoozedUntil: sql`statement_timestamp() - interval '1 second'` })
    .where(eq(internalProjectIntakeRequests.id, item.id));
  expect(value(await queue(owner, projectId, item.id, "pending")).requests).toMatchObject([
    { id: item.id, status: "pending" },
  ]);
  const siblingState = value(await readInternalProject(db, owner, sibling, signal())).states[0];
  const state = value(await readInternalProject(db, owner, projectId, signal())).states[0];
  if (state === undefined || siblingState === undefined)
    throw new Error("Missing project workflow state");
  expect(
    await reviewProjectIntake(
      db,
      owner,
      { ...target, revision: 1, action: "accept", stateId: siblingState.id },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(value(await readInternalProject(db, owner, projectId, signal())).items).toHaveLength(0);
  const ordinary = value(
    await createInternalProjectItem(
      db,
      owner,
      {
        id: item.id,
        projectId,
        title: "Ordinary request ID",
        stateId: state.id,
      },
      signal(),
    ),
  ).items[0];
  const accept = { ...target, revision: 1, action: "accept", stateId: state.id } as const;
  const accepted = await Promise.all([
    reviewProjectIntake(db, owner, accept, signal()),
    reviewProjectIntake(db, owner, accept, signal()),
  ]);
  expect(accepted.filter((result) => result.ok)).toHaveLength(1);
  expect(accepted).toContainEqual(err("project_conflict"));
  const request = value(await queue(owner, projectId, item.id)).selected;
  expect(request).toMatchObject({
    status: "accepted",
    revision: 2,
    requester: { id: requester.userId },
    workItemId: expect.any(String),
  });
  if (request?.workItemId == null) throw new Error("Missing accepted item");
  const acceptedItemId = request.workItemId;
  const workItems = value(await readInternalProject(db, owner, projectId, signal())).items;
  expect(workItems).toHaveLength(2);
  expect(acceptedItemId).not.toBe(ordinary?.id);
  expect(workItems.find(({ id }) => id === acceptedItemId)).toMatchObject({
    title: "Ready for triage",
    description: "Needs review",
    priority: "high",
    stateId: state.id,
    createdBy: requester.userId,
  });
  expect(
    await db
      .select({ actorId: internalProjectItemEvents.actorId, kind: internalProjectItemEvents.kind })
      .from(internalProjectItemEvents)
      .where(eq(internalProjectItemEvents.itemId, acceptedItemId)),
  ).toEqual([{ actorId: owner.userId, kind: "created" }]);
  const foreignItem = value(
    await createInternalProjectItem(
      db,
      owner,
      {
        id: randomUUID(),
        projectId: sibling,
        title: "Other project request",
        stateId: siblingState.id,
      },
      signal(),
    ),
  ).items[0];
  if (foreignItem === undefined || ordinary === undefined) throw new Error("Missing linked item");
  const sourceProject = value(await readInternalProject(db, owner, projectId, signal())).project;
  const matchingKey = `${sourceProject.identifier}-${ordinary.sequenceNumber}`;
  expect(foreignItem.sequenceNumber).toBe(ordinary.sequenceNumber);
  expect(value(await findIntakeWorkItems(db, owner, projectId, matchingKey, signal()))).toEqual([
    { id: ordinary.id, title: ordinary.title, identifier: matchingKey },
  ]);
  const duplicate = value(
    await createProjectIntake(db, owner, draft(projectId, "Duplicate request"), signal()),
  );
  const duplicateTarget = {
    projectId,
    requestId: duplicate.id,
    revision: 0,
    action: "duplicate",
  } as const;
  expect(
    await reviewProjectIntake(
      db,
      owner,
      { ...duplicateTarget, workItemId: foreignItem.id },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  value(
    await reviewProjectIntake(
      db,
      owner,
      { ...duplicateTarget, workItemId: acceptedItemId },
      signal(),
    ),
  );
  expect(value(await queue(owner, projectId, duplicate.id)).selected).toMatchObject({
    status: "duplicate",
    workItemId: acceptedItemId,
  });
  expect(
    value(await findIntakeWorkItems(db, owner, projectId, "ready", signal())).map(({ id }) => id),
  ).toEqual([acceptedItemId]);
  const declined = value(
    await createProjectIntake(db, owner, draft(projectId, "Decline me"), signal()),
  );
  value(
    await reviewProjectIntake(
      db,
      owner,
      { projectId, requestId: declined.id, revision: 0, action: "decline" },
      signal(),
    ),
  );
  expect(value(await queue(owner, projectId, declined.id)).selected).toMatchObject({
    status: "declined",
    workItemId: null,
  });
  expect(value(await readInternalProject(db, owner, projectId, signal())).items).toHaveLength(2);
});
