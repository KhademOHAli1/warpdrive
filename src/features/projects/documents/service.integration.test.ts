import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { enableNativeProjects } from "@/features/agency-projects/nativeViews";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { createInternalProject, setInternalProjectMember } from "../service";
import { projectDocumentBodyMaxLength } from "./contracts";
import {
  createProjectDocument,
  listProjectDocuments,
  readProjectDocument,
  readProjectDocumentVersion,
  restoreProjectDocumentVersion,
  saveProjectDocument,
  setProjectDocumentLifecycle,
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

async function setupProject(owner: Awaited<ReturnType<typeof staff>>, title: string) {
  value(await enableNativeProjects(fixture.db, owner, true, signal()));
  return value(
    await createInternalProject(fixture.db, owner, { id: randomUUID(), title }, signal()),
  ).id;
}

test("uses an actor-scoped create intent, sanitizes saved HTML, and keeps content history across lifecycle changes", async () => {
  const db = fixture.db;
  const owner = await staff("Lifecycle owner", true);
  const projectId = await setupProject(owner, "Document lifecycle");
  const create = { projectId, id: randomUUID(), title: "Untitled", visibility: "project" as const };
  const initial = value(await createProjectDocument(db, owner, create, signal()));
  const key = { projectId, documentId: initial.document.id };
  expect(initial.versions).toMatchObject([{ revision: 0, title: "Untitled" }]);
  const resaved = value(
    await saveProjectDocument(
      db,
      owner,
      {
        ...key,
        revision: 0,
        title: "Kickoff",
        bodyHtml:
          '<h2>Notes</h2><img src="https://external.invalid/x"><p onclick="x()">Ready <strong>today</strong></p><a href="javascript:bad()">Link</a>',
      },
      signal(),
    ),
  );
  expect(resaved.document).toMatchObject({
    revision: 1,
    title: "Kickoff",
    bodyHtml: "<h2>Notes</h2><p>Ready <strong>today</strong></p><a>Link</a>",
  });
  expect(value(await createProjectDocument(db, owner, create, signal())).document.id).toBe(
    key.documentId,
  );
  expect(
    await createProjectDocument(db, owner, { ...create, title: "Changed intent" }, signal()),
  ).toEqual(err("project_conflict"));
  expect(
    await saveProjectDocument(
      db,
      owner,
      { ...key, revision: 0, title: "Stale", bodyHtml: "" },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  expect(
    await saveProjectDocument(
      db,
      owner,
      {
        ...key,
        revision: 1,
        title: "Oversized",
        bodyHtml: "é".repeat(projectDocumentBodyMaxLength / 2 + 1),
      },
      signal(),
    ),
  ).toEqual(err("project_invalid"));

  const lifecycle = (revision: number, action: "lock" | "unlock" | "archive" | "restore") =>
    setProjectDocumentLifecycle(db, owner, { ...key, revision, action }, signal());
  expect(value(await lifecycle(1, "lock"))).toMatchObject({
    document: { locked: true, revision: 2 },
    canEdit: false,
  });
  expect(
    await saveProjectDocument(
      db,
      owner,
      { ...key, revision: 2, title: "Locked", bodyHtml: "" },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(value(await lifecycle(2, "unlock")).document).toMatchObject({
    locked: false,
    revision: 3,
  });
  expect(value(await lifecycle(3, "archive"))).toMatchObject({
    document: { revision: 4, archivedAt: expect.any(String) },
    canEdit: false,
  });
  expect(value(await lifecycle(4, "restore")).document).toMatchObject({
    archivedAt: null,
    revision: 5,
  });
  const prior = value(
    await readProjectDocumentVersion(db, owner, { ...key, versionRevision: 0 }, signal()),
  );
  expect(prior).toMatchObject({ revision: 0, title: "Untitled", bodyHtml: "" });
  const restored = value(
    await restoreProjectDocumentVersion(
      db,
      owner,
      { ...key, revision: 5, versionRevision: 0 },
      signal(),
    ),
  );
  expect(restored.document).toMatchObject({ revision: 6, title: "Untitled", bodyHtml: "" });
  expect(restored.versions.map(({ revision }) => revision)).toEqual([6, 1, 0]);
});

test("protects private document bodies and versions across project roles and mismatched routes", async () => {
  const db = fixture.db;
  const [owner, author, viewer, admin] = await Promise.all([
    staff("Project owner", true),
    staff("Document author"),
    staff("Project viewer"),
    staff("Unrelated administrator", true),
  ]);
  const projectId = await setupProject(owner, "Project isolation");
  const sibling = await setupProject(owner, "Sibling project");
  value(
    await setInternalProjectMember(
      db,
      owner,
      {
        projectId,
        userId: author.userId,
        membership: { role: "editor", canAssign: false },
      },
      signal(),
    ),
  );
  value(
    await setInternalProjectMember(
      db,
      owner,
      {
        projectId,
        userId: viewer.userId,
        membership: { role: "viewer", canAssign: false },
      },
      signal(),
    ),
  );
  const input = {
    projectId,
    id: randomUUID(),
    title: "Shared manuscript",
    visibility: "project" as const,
  };
  const shared = value(await createProjectDocument(db, author, input, signal())).document;
  const privateDocument = value(
    await createProjectDocument(
      db,
      author,
      {
        ...input,
        id: randomUUID(),
        title: "Private notes",
        visibility: "private",
      },
      signal(),
    ),
  ).document;
  const privateKey = { projectId, documentId: privateDocument.id };
  expect(
    value(await listProjectDocuments(db, owner, projectId, signal())).documents.map(({ id }) => id),
  ).toEqual([shared.id]);
  expect(value(await listProjectDocuments(db, author, projectId, signal())).documents).toHaveLength(
    2,
  );
  expect(await readProjectDocument(db, owner, privateKey, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(
    await readProjectDocumentVersion(db, viewer, { ...privateKey, versionRevision: 0 }, signal()),
  ).toEqual(err("project_unavailable"));
  expect(await listProjectDocuments(db, admin, projectId, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(
    await readProjectDocument(db, owner, { projectId: sibling, documentId: shared.id }, signal()),
  ).toEqual(err("project_unavailable"));
  const sharedKey = { projectId, documentId: shared.id };
  expect(value(await readProjectDocument(db, viewer, sharedKey, signal()))).toMatchObject({
    canEdit: false,
    canManage: false,
  });
  expect(await createProjectDocument(db, viewer, input, signal())).toEqual(
    err("project_forbidden"),
  );
  expect(
    await saveProjectDocument(
      db,
      viewer,
      { ...sharedKey, revision: 0, title: "Denied", bodyHtml: "" },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  value(
    await setInternalProjectMember(
      db,
      owner,
      { projectId, userId: author.userId, membership: null },
      signal(),
    ),
  );
  expect(await readProjectDocument(db, author, privateKey, signal())).toEqual(
    err("project_unavailable"),
  );
});
