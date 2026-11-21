import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import {
  createInternalProject,
  createInternalProjectItem,
  readInternalProject,
  setInternalProjectMember,
  updateInternalProjectItem,
} from "../service";
import { setInternalProjectArchived } from "../settings/service";
import type { ProjectEstimatePoint, ProjectLabel } from "./contracts";
import { saveProjectEstimateScale, setProjectEstimateScale } from "./estimates";
import { saveProjectLabels } from "./labels";

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
  if (!result.ok) throw new Error("Expected successful Project command");
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

function label(
  name: string,
  kind: ProjectLabel["kind"] = "label",
  parentId: string | null = null,
): ProjectLabel {
  return { id: randomUUID(), name, description: "", color: "#60646c", kind, parentId, position: 0 };
}

function point(value: string, position: number): ProjectEstimatePoint {
  return { id: randomUUID(), value, description: "", position };
}

test("authorizes project label catalog changes and persistently attaches only project leaf labels", async () => {
  const owner = await session("Labels owner", true);
  const editor = await session("Labels editor");
  const project = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Label hierarchy" },
      signal(),
    ),
  );
  const other = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Other labels" },
      signal(),
    ),
  );
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      {
        projectId: project.id,
        userId: editor.userId,
        membership: { role: "editor", canAssign: false },
      },
      signal(),
    ),
  );
  const group = label("Issue type", "group");
  const defect = label("Defect", "label", group.id);
  const otherLabel = label("Elsewhere");
  expect(
    await saveProjectLabels(
      fixture.db,
      editor,
      { projectId: project.id, revision: 0, labels: [group, defect] },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(
    await saveProjectLabels(
      fixture.db,
      owner,
      { projectId: project.id, revision: 0, labels: [defect] },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  const saved = value(
    await saveProjectLabels(
      fixture.db,
      owner,
      {
        projectId: project.id,
        revision: 0,
        labels: [defect, group],
      },
      signal(),
    ),
  );
  expect(saved.labels).toContainEqual(defect);
  expect(saved.labels).toContainEqual(group);
  value(
    await saveProjectLabels(
      fixture.db,
      owner,
      { projectId: other.id, revision: 0, labels: [otherLabel] },
      signal(),
    ),
  );
  const draft = { projectId: project.id, id: randomUUID(), title: "Check loading gate" };
  for (const labelId of [group.id, otherLabel.id])
    expect(
      await createInternalProjectItem(
        fixture.db,
        editor,
        { ...draft, labelIds: [labelId] },
        signal(),
      ),
    ).toEqual(err("project_invalid"));
  const workspace = value(
    await createInternalProjectItem(
      fixture.db,
      editor,
      { ...draft, labelIds: [defect.id] },
      signal(),
    ),
  );
  const [item] = workspace.items;
  if (item === undefined) throw new Error("Assigned item missing");
  expect(item.labelIds).toEqual([defect.id]);
  expect(
    await saveProjectLabels(
      fixture.db,
      owner,
      { projectId: project.id, revision: 0, labels: [] },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
  value(
    await saveProjectLabels(
      fixture.db,
      owner,
      { projectId: project.id, revision: 1, labels: [] },
      signal(),
    ),
  );
  expect(
    value(await readInternalProject(fixture.db, owner, project.id, signal())).items,
  ).toMatchObject([{ id: item.id, revision: item.revision + 1, labelIds: [] }]);
  expect(
    await updateInternalProjectItem(
      fixture.db,
      editor,
      { projectId: project.id, itemId: item.id, revision: item.revision, title: "Stale update" },
      signal(),
    ),
  ).toEqual(err("project_conflict"));
});

test("assigns active estimates, retains history while disabled, and transfers or clears deleted points atomically", async () => {
  const owner = await session("Estimates owner", true);
  const project = value(
    await createInternalProject(
      fixture.db,
      owner,
      { id: randomUUID(), title: "Estimate project" },
      signal(),
    ),
  );
  const scaleId = randomUUID();
  const first = point("1", 0);
  const second = point("2", 1);
  const third = point("3", 2);
  const scale = { name: "Points", type: "points" as const, points: [first, second, third] };
  value(
    await saveProjectEstimateScale(
      fixture.db,
      owner,
      { projectId: project.id, revision: 0, scaleId, scale },
      signal(),
    ),
  );
  const draft = {
    projectId: project.id,
    id: randomUUID(),
    title: "Estimate delivery",
    estimatePointId: first.id,
  };
  expect(await createInternalProjectItem(fixture.db, owner, draft, signal())).toEqual(
    err("project_invalid"),
  );
  value(
    await setProjectEstimateScale(
      fixture.db,
      owner,
      { projectId: project.id, revision: 1, scaleId },
      signal(),
    ),
  );
  const [item] = value(await createInternalProjectItem(fixture.db, owner, draft, signal())).items;
  if (item === undefined) throw new Error("Estimated item missing");
  expect(item.estimatePointId).toBe(first.id);
  value(
    await setProjectEstimateScale(
      fixture.db,
      owner,
      { projectId: project.id, revision: 2, scaleId: null },
      signal(),
    ),
  );
  const itemTarget = { projectId: project.id, itemId: item.id, revision: item.revision };
  expect(
    await updateInternalProjectItem(
      fixture.db,
      owner,
      { ...itemTarget, estimatePointId: second.id },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  expect(
    value(
      await updateInternalProjectItem(
        fixture.db,
        owner,
        { ...itemTarget, title: "Estimate delivery scope" },
        signal(),
      ),
    ).items,
  ).toMatchObject([{ id: item.id, estimatePointId: first.id, revision: item.revision + 1 }]);
  value(
    await setProjectEstimateScale(
      fixture.db,
      owner,
      { projectId: project.id, revision: 3, scaleId },
      signal(),
    ),
  );
  value(
    await saveProjectEstimateScale(
      fixture.db,
      owner,
      {
        projectId: project.id,
        revision: 4,
        scaleId,
        scale: { ...scale, points: [second, third] },
        replacements: [{ pointId: first.id, replacementPointId: second.id }],
      },
      signal(),
    ),
  );
  expect(
    value(await readInternalProject(fixture.db, owner, project.id, signal())).items,
  ).toMatchObject([{ id: item.id, estimatePointId: second.id, revision: item.revision + 2 }]);
  const empty = value(
    await saveProjectEstimateScale(
      fixture.db,
      owner,
      { projectId: project.id, revision: 5, scaleId, scale: null },
      signal(),
    ),
  );
  expect(empty).toMatchObject({ activeScaleId: null, scales: [], revision: 6 });
  expect(
    value(await readInternalProject(fixture.db, owner, project.id, signal())).items,
  ).toMatchObject([{ id: item.id, estimatePointId: null, revision: item.revision + 3 }]);
  value(
    await setInternalProjectArchived(
      fixture.db,
      owner,
      { projectId: project.id, revision: 0, archived: true },
      signal(),
    ),
  );
  expect(
    await saveProjectEstimateScale(
      fixture.db,
      owner,
      { projectId: project.id, revision: 6, scaleId, scale },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
});
