import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { storeProjectCover } from "../brand/cover";
import {
  createProjectIntake,
  readProjectIntake,
  reviewProjectIntake,
  setProjectIntakeEnabled,
} from "../intake/service";
import { internalProjectSettings } from "../schema";
import {
  createInternalProject,
  createInternalProjectItem,
  readInternalProject,
  setInternalProjectMember,
} from "../service";
import { setInternalProjectArchived } from "../settings/service";
import type { SaveProjectPublication } from "./contracts";
import {
  readMyPublishedIntakeRequests,
  readProjectPublicationSettings,
  readPublishedIntakeRequest,
  readPublishedProjectBoard,
  readPublishedProjectCover,
  saveProjectPublication,
  submitPublishedProjectIntake,
  updatePublishedIntakeRequest,
  withdrawPublishedIntakeRequest,
} from "./service";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(10_000);

beforeAll(async () => {
  fixture = await makeTestDb();
  await fixture.pool.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES (true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
});
afterAll(async () => fixture.close());

function value<T, E>(result: Result<T, E>): T {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("Expected successful project publication command");
  return result.value;
}

async function session(name: string, isAdmin = false) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await fixture.db
    .insert(users)
    .values({ id: userId, name, email: `${userId}@example.test`, isAdmin });
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 300_000),
    assurance: "legacy",
    authMethod: "legacy",
  });
  return { userId, sessionId };
}

function publication(projectId: string): SaveProjectPublication {
  return {
    projectId,
    revision: 0,
    published: true,
    listEnabled: true,
    boardEnabled: true,
    showWorkItems: false,
    showBranding: false,
    allowIntake: true,
  };
}

test("publishes only opted-in data and lets authenticated nonmembers submit to the same Intake queue", async () => {
  const [owner, visitor] = await Promise.all([
    session("Publication owner", true),
    session("Visitor"),
  ]);
  const project = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Warehouse feedback" },
      signal(),
    ),
  );
  const draft = publication(project.id);
  expect(await saveProjectPublication(fixture.db, visitor, draft, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(await saveProjectPublication(fixture.db, owner, draft, signal())).toEqual(
    err("project_invalid"),
  );
  value(
    await setProjectIntakeEnabled(
      fixture.db,
      owner,
      { projectId: project.id, enabled: true, revision: 0 },
      signal(),
    ),
  );
  const receipt = value(await saveProjectPublication(fixture.db, owner, draft, signal()));
  const anchor = receipt.anchor;
  if (anchor === null) throw new Error("Public anchor missing");
  expect(await readProjectPublicationSettings(fixture.db, visitor, project.id, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(value(await readPublishedProjectBoard(fixture.db, anchor, 1, signal()))).toMatchObject({
    title: project.title,
    items: [],
    states: [],
    logo: null,
    cover: null,
    acceptsRequests: true,
  });
  value(
    await createInternalProjectItem(
      fixture.db,
      owner,
      {
        projectId: project.id,
        id: randomUUID(),
        title: "Ship a loading notice",
        description: "Private operational instructions",
      },
      signal(),
    ),
  );
  value(
    await saveProjectPublication(
      fixture.db,
      owner,
      { ...draft, revision: 1, showWorkItems: true },
      signal(),
    ),
  );
  const board = value(await readPublishedProjectBoard(fixture.db, anchor, 1, signal()));
  expect(board.items).toEqual([
    { key: `${project.identifier}-1`, title: "Ship a loading notice", stateId: expect.any(String) },
  ]);
  expect(JSON.stringify(board)).not.toContain("Private operational instructions");

  const request = {
    anchor,
    intentId: randomUUID(),
    title: "Request a loading time",
    description: "Synthetic public request",
    priority: "medium" as const,
  };
  const submitted = value(
    await submitPublishedProjectIntake(fixture.db, visitor, request, signal()),
  );
  expect(value(await submitPublishedProjectIntake(fixture.db, visitor, request, signal()))).toEqual(
    submitted,
  );
  expect(
    await submitPublishedProjectIntake(
      fixture.db,
      visitor,
      { ...request, title: "Different intent data" },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  expect(await readInternalProject(fixture.db, visitor, project.id, signal())).toEqual(
    err("project_unavailable"),
  );
  const queue = value(
    await readProjectIntake(
      fixture.db,
      owner,
      { projectId: project.id, page: 1, filter: "pending" },
      signal(),
    ),
  );
  expect(queue.requests).toMatchObject([
    { id: submitted.id, title: request.title, requester: { id: visitor.userId } },
  ]);
  expect(
    JSON.stringify(value(await readPublishedProjectBoard(fixture.db, anchor, 1, signal()))),
  ).not.toContain(request.title);
  value(
    await setProjectIntakeEnabled(
      fixture.db,
      owner,
      { projectId: project.id, enabled: false, revision: 1 },
      signal(),
    ),
  );
  expect(
    value(await readPublishedProjectBoard(fixture.db, anchor, 1, signal())).acceptsRequests,
  ).toBe(false);
  expect(
    await submitPublishedProjectIntake(
      fixture.db,
      visitor,
      { ...request, intentId: randomUUID() },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  value(
    await saveProjectPublication(
      fixture.db,
      owner,
      { ...draft, revision: 2, published: false },
      signal(),
    ),
  );
  expect(await readPublishedProjectBoard(fixture.db, anchor, 1, signal())).toEqual(
    err("project_unavailable"),
  );
  const republished = value(
    await saveProjectPublication(
      fixture.db,
      owner,
      { ...draft, revision: 3, allowIntake: false },
      signal(),
    ),
  );
  expect(republished.anchor).not.toBe(anchor);
});

test("cover reads require the matching live anchor, opted-in branding, and current cover version", async () => {
  const owner = await session("Brand publisher", true);
  const project = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Published branding" },
      signal(),
    ),
  );
  const bytes = Buffer.from("private normalized image fixture");
  const cover = await storeProjectCover(fixture.db, project.id, bytes);
  await fixture.db
    .update(internalProjectSettings)
    .set({ cover })
    .where(eq(internalProjectSettings.projectId, project.id));
  const draft = { ...publication(project.id), allowIntake: false };
  const settings = value(await saveProjectPublication(fixture.db, owner, draft, signal()));
  const anchor = settings.anchor;
  if (anchor === null) throw new Error("Public anchor missing");
  expect(await readPublishedProjectCover(fixture.db, anchor, cover.value, signal())).toEqual(
    err("project_unavailable"),
  );
  value(
    await saveProjectPublication(
      fixture.db,
      owner,
      { ...draft, revision: 1, showBranding: true },
      signal(),
    ),
  );
  expect(
    value(await readPublishedProjectCover(fixture.db, anchor, cover.value, signal())).data,
  ).toBe(bytes.toString("base64"));
  expect(await readPublishedProjectCover(fixture.db, anchor, randomUUID(), signal())).toEqual(
    err("project_unavailable"),
  );
  expect(await readPublishedProjectCover(fixture.db, randomUUID(), cover.value, signal())).toEqual(
    err("project_unavailable"),
  );
  value(
    await setInternalProjectArchived(
      fixture.db,
      owner,
      { projectId: project.id, revision: 0, archived: true },
      signal(),
    ),
  );
  expect(await readPublishedProjectBoard(fixture.db, anchor, 1, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(await readPublishedProjectCover(fixture.db, anchor, cover.value, signal())).toEqual(
    err("project_unavailable"),
  );
});

test("lists, edits, and withdraws only the actual actor’s requests submitted through this publication", async () => {
  const [owner, first, second] = await Promise.all([
    session("Requester privacy owner", true),
    session("First visitor"),
    session("Second visitor"),
  ]);
  const project = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Visitor requests" },
      signal(),
    ),
  );
  const projectId = project.id;
  value(
    await setProjectIntakeEnabled(
      fixture.db,
      owner,
      { projectId, enabled: true, revision: 0 },
      signal(),
    ),
  );
  const options = publication(projectId);
  const { anchor } = value(await saveProjectPublication(fixture.db, owner, options, signal()));
  if (anchor === null) throw new Error("Public anchor missing");
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      {
        projectId,
        userId: first.userId,
        membership: { role: "viewer", canAssign: false },
      },
      signal(),
    ),
  );
  const internal = {
    intentId: randomUUID(),
    title: "Private native request",
    description: "Workspace-only message",
    priority: "low" as const,
  };
  const privateRow = value(
    await createProjectIntake(fixture.db, first, { projectId, ...internal }, signal()),
  );
  expect(
    await submitPublishedProjectIntake(fixture.db, first, { anchor, ...internal }, signal()),
  ).toEqual(err("project_conflict"));
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId, userId: first.userId, membership: null },
      signal(),
    ),
  );
  const payload = {
    anchor,
    description: "First visitor’s private request body",
    priority: "high" as const,
  };
  const firstRow = value(
    await submitPublishedProjectIntake(
      fixture.db,
      first,
      {
        ...payload,
        intentId: randomUUID(),
        title: "First public request",
      },
      signal(),
    ),
  );
  const secondRow = value(
    await submitPublishedProjectIntake(
      fixture.db,
      second,
      {
        ...payload,
        intentId: randomUUID(),
        title: "Second public request",
      },
      signal(),
    ),
  );
  expect(
    value(await readMyPublishedIntakeRequests(fixture.db, first, anchor, 1, signal())).requests,
  ).toEqual([expect.objectContaining({ id: firstRow.id, status: "pending", canEdit: true })]);
  expect(
    value(await readMyPublishedIntakeRequests(fixture.db, owner, anchor, 1, signal())).requests,
  ).toEqual([]);
  const detail = value(
    await readPublishedIntakeRequest(
      fixture.db,
      first,
      { anchor, requestId: firstRow.id },
      signal(),
    ),
  );
  expect(Object.keys(detail).sort()).toEqual([
    "canEdit",
    "createdAt",
    "description",
    "id",
    "priority",
    "revision",
    "status",
    "title",
  ]);
  const edit = {
    anchor,
    requestId: firstRow.id,
    revision: 0,
    title: "Updated public request",
    description: "Updated body",
    priority: "medium" as const,
  };
  for (const requestId of [secondRow.id, privateRow.id]) {
    expect(
      await readPublishedIntakeRequest(fixture.db, first, { anchor, requestId }, signal()),
    ).toEqual(err("project_unavailable"));
    expect(
      await updatePublishedIntakeRequest(fixture.db, first, { ...edit, requestId }, signal()),
    ).toEqual(err("project_unavailable"));
    expect(
      await withdrawPublishedIntakeRequest(fixture.db, first, { ...edit, requestId }, signal()),
    ).toEqual(err("project_unavailable"));
  }
  value(await updatePublishedIntakeRequest(fixture.db, first, edit, signal()));
  expect(await updatePublishedIntakeRequest(fixture.db, first, edit, signal())).toEqual(
    err("project_conflict"),
  );
  expect(value(await readPublishedIntakeRequest(fixture.db, first, edit, signal()))).toMatchObject({
    title: edit.title,
    description: edit.description,
    priority: edit.priority,
    revision: 1,
  });
  value(
    await reviewProjectIntake(
      fixture.db,
      owner,
      { projectId, requestId: firstRow.id, revision: 1, action: "decline" },
      signal(),
    ),
  );
  const closed = value(await readPublishedIntakeRequest(fixture.db, first, edit, signal()));
  expect(closed).toMatchObject({ status: "declined", canEdit: false, revision: 2 });
  expect(
    await withdrawPublishedIntakeRequest(fixture.db, first, { ...edit, revision: 2 }, signal()),
  ).toEqual(err("project_conflict"));
  value(
    await setProjectIntakeEnabled(
      fixture.db,
      owner,
      { projectId, enabled: false, revision: 1 },
      signal(),
    ),
  );
  expect(
    value(
      await readPublishedIntakeRequest(
        fixture.db,
        second,
        { anchor, requestId: secondRow.id },
        signal(),
      ),
    ).canEdit,
  ).toBe(false);
  expect(
    await withdrawPublishedIntakeRequest(
      fixture.db,
      second,
      { anchor, requestId: secondRow.id, revision: 0 },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  value(
    await setProjectIntakeEnabled(
      fixture.db,
      owner,
      { projectId, enabled: true, revision: 2 },
      signal(),
    ),
  );
  value(
    await withdrawPublishedIntakeRequest(
      fixture.db,
      second,
      { anchor, requestId: secondRow.id, revision: 0 },
      signal(),
    ),
  );
  expect(
    value(await readMyPublishedIntakeRequests(fixture.db, second, anchor, 1, signal())).requests,
  ).toEqual([]);
  expect(
    await readPublishedIntakeRequest(
      fixture.db,
      second,
      { anchor, requestId: secondRow.id },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
  value(
    await saveProjectPublication(
      fixture.db,
      owner,
      { ...options, revision: 1, allowIntake: false },
      signal(),
    ),
  );
  expect(await readMyPublishedIntakeRequests(fixture.db, first, anchor, 1, signal())).toEqual(
    err("project_unavailable"),
  );
});
