import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as Y from "yjs";
import { sessions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { enableNativeProjects } from "@/features/agency-projects/nativeViews";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { createInternalProject, setInternalProjectMember } from "../service";
import { projectDocumentBodyMaxLength } from "./contracts";
import {
  type ProjectDocumentCursorPosition,
  projectDocumentCollaborationFragment,
} from "./live/contracts";
import { internalProjectDocumentPresence } from "./schema";
import {
  collaborateProjectDocument,
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

test("serializes collaborative updates and rechecks lifecycle, membership, and version authority", async () => {
  const db = fixture.db;
  const [owner, editor, viewer] = await Promise.all([
    staff("Live page owner", true),
    staff("Live page editor"),
    staff("Live page viewer"),
  ]);
  const projectId = await setupProject(owner, "Live collaboration");
  async function setMembership(userId: string, role: "editor" | "viewer" | null) {
    value(
      await setInternalProjectMember(
        db,
        owner,
        {
          projectId,
          userId,
          membership: role === null ? null : { role, canAssign: false },
        },
        signal(),
      ),
    );
  }
  await setMembership(editor.userId, "editor");
  await setMembership(viewer.userId, "viewer");
  const created = value(
    await createProjectDocument(
      db,
      owner,
      {
        projectId,
        id: randomUUID(),
        title: "Live page",
        visibility: "project",
      },
      signal(),
    ),
  );
  const key = { projectId, documentId: created.document.id };
  const connect = { ...key, epoch: null, revision: null, stateVector: null, update: null };
  expect(value(await collaborateProjectDocument(db, viewer, connect, signal()))).toMatchObject({
    live: false,
    canEdit: false,
    previewHtml: "",
  });
  value(
    await saveProjectDocument(
      db,
      owner,
      {
        ...key,
        title: "Live page",
        revision: 0,
        bodyHtml: "<p>center</p>",
      },
      signal(),
    ),
  );
  const [first, second] = await Promise.all([
    collaborateProjectDocument(db, owner, connect, signal()).then(value),
    collaborateProjectDocument(db, editor, connect, signal()).then(value),
  ]);
  expect(first.update).toBe(second.update);
  const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  function edit(update: string | null, position: number, insertion: string) {
    if (update === null) throw new Error("Missing handshake");
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Buffer.from(update, "base64"));
      const baseline = Y.encodeStateVector(doc);
      const paragraph = doc.getXmlFragment(projectDocumentCollaborationFragment).get(0);
      const text = paragraph instanceof Y.XmlElement ? paragraph.get(0) : null;
      if (!(text instanceof Y.XmlText)) throw new Error("Missing editable text");
      text.insert(position, insertion);
      return {
        stateVector: encode(Y.encodeStateVector(doc)),
        update: encode(Y.encodeStateAsUpdate(doc, baseline)),
      };
    } finally {
      doc.destroy();
    }
  }
  const firstEdit = {
    ...connect,
    epoch: first.epoch,
    revision: 1,
    ...edit(first.update, 0, "Left "),
  };
  const secondEdit = {
    ...connect,
    epoch: second.epoch,
    revision: 1,
    ...edit(second.update, 6, " right"),
  };
  expect(await collaborateProjectDocument(db, viewer, firstEdit, signal())).toEqual(
    err("project_forbidden"),
  );
  const patches = await Promise.all([
    collaborateProjectDocument(db, owner, firstEdit, signal()).then(value),
    collaborateProjectDocument(db, editor, secondEdit, signal()).then(value),
  ]);
  expect(patches.map(({ document }) => document.revision).sort()).toEqual([2, 3]);
  const reconnect = value(await collaborateProjectDocument(db, viewer, connect, signal()));
  expect(reconnect).toMatchObject({ live: true, canEdit: false, document: { revision: 3 } });
  expect(value(await readProjectDocument(db, viewer, key, signal())).document.bodyHtml).toBe(
    "<p>Left center right</p>",
  );
  expect(
    value(await collaborateProjectDocument(db, owner, firstEdit, signal())).document.revision,
  ).toBe(3);
  expect(
    await saveProjectDocument(
      db,
      owner,
      {
        ...key,
        title: "Stale",
        revision: 3,
        bodyHtml: "<p>center</p>",
      },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  const checkpoint = value(
    await saveProjectDocument(db, owner, { ...key, title: "Live page", revision: 3 }, signal()),
  );
  expect(checkpoint.versions[0]?.revision).toBe(3);
  const lateEdit = {
    ...connect,
    epoch: reconnect.epoch,
    revision: 3,
    ...edit(reconnect.update, 0, "Late "),
  };
  const lock = (revision: number, action: "lock" | "unlock" | "archive" | "restore") =>
    setProjectDocumentLifecycle(db, owner, { ...key, action, revision }, signal()).then(value);
  await lock(3, "lock");
  const locked = value(await collaborateProjectDocument(db, editor, connect, signal()));
  expect(locked).toMatchObject({ epoch: 4, canEdit: false });
  expect(
    await collaborateProjectDocument(db, editor, { ...lateEdit, epoch: locked.epoch }, signal()),
  ).toEqual(err("project_forbidden"));
  await lock(4, "unlock");
  await lock(5, "archive");
  const archived = value(await collaborateProjectDocument(db, editor, lateEdit, signal()));
  expect(archived).toMatchObject({ epoch: 6, canEdit: false, document: { revision: 6 } });
  await lock(6, "restore");
  const restored = value(
    await restoreProjectDocumentVersion(
      db,
      owner,
      {
        ...key,
        revision: 7,
        versionRevision: 1,
      },
      signal(),
    ),
  );
  expect(restored.document).toMatchObject({ revision: 8, bodyHtml: "<p>center</p>" });
  const reset = value(await collaborateProjectDocument(db, editor, lateEdit, signal()));
  expect(reset).toMatchObject({ epoch: 8, live: false, previewHtml: "<p>center</p>" });
  expect(value(await collaborateProjectDocument(db, editor, connect, signal())).live).toBe(true);

  const personal = value(
    await createProjectDocument(
      db,
      editor,
      {
        projectId,
        id: randomUUID(),
        title: "Private page",
        visibility: "private",
      },
      signal(),
    ),
  ).document;
  const privateConnect = { ...connect, documentId: personal.id };
  expect(value(await collaborateProjectDocument(db, editor, privateConnect, signal())).live).toBe(
    true,
  );
  expect(await collaborateProjectDocument(db, owner, privateConnect, signal())).toEqual(
    err("project_unavailable"),
  );
  await setMembership(editor.userId, null);
  expect(await collaborateProjectDocument(db, editor, privateConnect, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(await collaborateProjectDocument(db, editor, lateEdit, signal())).toEqual(
    err("project_unavailable"),
  );
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

test("discloses expiring presence only to current page readers and cursor positions only for current editors", async () => {
  const db = fixture.db;
  const [owner, editor] = await Promise.all([
    staff("Presence owner", true),
    staff("Presence editor"),
  ]);
  const projectId = await setupProject(owner, "Presence scope");
  async function setRole(role: "editor" | "viewer" | null) {
    value(
      await setInternalProjectMember(
        db,
        owner,
        {
          projectId,
          userId: editor.userId,
          membership: role === null ? null : { role, canAssign: false },
        },
        signal(),
      ),
    );
  }
  await setRole("editor");
  const created = value(
    await createProjectDocument(
      db,
      owner,
      {
        projectId,
        id: randomUUID(),
        title: "Presence page",
        visibility: "project",
      },
      signal(),
    ),
  ).document;
  const key = { projectId, documentId: created.id };
  const connect = { ...key, epoch: null, revision: null, stateVector: null, update: null };
  const initial = value(await collaborateProjectDocument(db, owner, connect, signal()));
  const sync = { ...connect, epoch: initial.epoch, revision: created.revision };
  const point: ProjectDocumentCursorPosition = {
    type: null,
    tname: projectDocumentCollaborationFragment,
    item: null,
    assoc: 0,
  };
  const cursor = { anchor: point, head: point };
  value(
    await collaborateProjectDocument(
      db,
      owner,
      { ...sync, presence: { clientId: 1, cursor } },
      signal(),
    ),
  );
  const joined = value(
    await collaborateProjectDocument(
      db,
      editor,
      {
        ...sync,
        presence: { clientId: 2, cursor },
      },
      signal(),
    ),
  );
  expect(joined.peers).toEqual([
    { clientId: 1, name: "Presence owner", cursor },
    { clientId: 2, name: "Presence editor", cursor },
  ]);
  expect(
    value(
      await collaborateProjectDocument(
        db,
        editor,
        {
          ...sync,
          presence: { clientId: 1, cursor: null, leave: true },
        },
        signal(),
      ),
    ).peers,
  ).toEqual(joined.peers);
  await setRole("viewer");
  expect(value(await collaborateProjectDocument(db, owner, sync, signal())).peers).toEqual([
    { clientId: 1, name: "Presence owner", cursor },
    { clientId: 2, name: "Presence editor", cursor: null },
  ]);
  await setRole(null);
  expect(value(await collaborateProjectDocument(db, owner, sync, signal())).peers).toEqual([
    { clientId: 1, name: "Presence owner", cursor },
  ]);
  expect(await collaborateProjectDocument(db, editor, sync, signal())).toEqual(
    err("project_unavailable"),
  );
  const privateDocument = value(
    await createProjectDocument(
      db,
      owner,
      {
        projectId,
        id: randomUUID(),
        title: "Private presence",
        visibility: "private",
      },
      signal(),
    ),
  ).document;
  await setRole("editor");
  expect(
    await collaborateProjectDocument(
      db,
      editor,
      { ...connect, documentId: privateDocument.id },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
  await db
    .update(internalProjectDocumentPresence)
    .set({
      expiresAt: sql`statement_timestamp() - interval '1 second'`,
    })
    .where(eq(internalProjectDocumentPresence.documentId, key.documentId));
  expect(value(await collaborateProjectDocument(db, owner, sync, signal())).peers).toEqual([]);
  const returned = value(
    await collaborateProjectDocument(
      db,
      owner,
      {
        ...sync,
        presence: { clientId: 3, cursor: null },
      },
      signal(),
    ),
  );
  expect(returned.peers).toEqual([{ clientId: 3, name: "Presence owner", cursor: null }]);
  expect(
    await db
      .select({ clientId: internalProjectDocumentPresence.clientId })
      .from(internalProjectDocumentPresence)
      .where(eq(internalProjectDocumentPresence.documentId, key.documentId)),
  ).toEqual([{ clientId: 3 }]);
});
