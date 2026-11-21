import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { enableNativeProjects } from "@/features/agency-projects/nativeViews";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { setProjectIntakeEnabled } from "../intake/service";
import { readInternalProject, setInternalProjectMember } from "../service";
import {
  issueProjectIntegratorKey,
  listProjectIntegratorKeys,
  revokeProjectIntegratorKey,
} from "./management";
import { projectIntegratorRequest } from "./runtime";
import { projectIntegratorKeys } from "./schema";

let fixture: TestDb;
beforeAll(async () => {
  fixture = await makeTestDb();
});
afterAll(async () => {
  await fixture?.close();
});
const signal = () => AbortSignal.timeout(10_000);

function value<T>(result: Result<T, unknown>) {
  if (!result.ok) throw new Error(`Unexpected result: ${String(result.error)}`);
  return result.value;
}

async function staff(name: string, isAdmin = false) {
  const user = await seedUser(fixture.db, { name, isAdmin });
  const id = randomUUID();
  await fixture.db.insert(sessions).values({
    id,
    userId: user.id,
    tokenHash: randomUUID(),
    authMethod: "legacy",
    assurance: "legacy",
    expiresAt: new Date(Date.now() + 300_000),
  });
  return { userId: user.id, sessionId: id };
}

async function request(
  path: string,
  expected: number,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
    intent?: string;
    workspace?: string;
  } = {},
) {
  const { token, method = "GET", body, intent, workspace = "warpdrive" } = options;
  const url = new URL(`http://localhost/api/v1/workspaces/${workspace}/${path}`);
  const headers = new Headers();
  if (token !== undefined) headers.set("x-api-key", token);
  if (intent !== undefined) headers.set("idempotency-key", intent);
  if (body !== undefined) headers.set("content-type", "application/json");
  const input = new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const segments = path.split("?")[0]?.split("/").filter(Boolean) ?? [];
  const response = await projectIntegratorRequest(fixture.db, input, workspace, segments);
  expect(response.status, path).toBe(expected);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response;
}

async function read<T>(response: Response) {
  return (await response.json()) as T;
}

test("uses dedicated token lifecycle and the current native project grants", async () => {
  const db = fixture.db;
  const [owner, editor, outsider] = await Promise.all([
    staff("API owner", true),
    staff("API editor"),
    staff("API outsider", true),
  ]);
  value(await enableNativeProjects(db, owner, true, signal()));
  const a = value(
    await issueProjectIntegratorKey(db, owner, { name: "Main write", access: "write" }, signal()),
  );
  const b = value(
    await issueProjectIntegratorKey(db, editor, { name: "Read only", access: "read" }, signal()),
  );
  const c = value(
    await issueProjectIntegratorKey(
      db,
      outsider,
      { name: "Outsider write", access: "write" },
      signal(),
    ),
  );
  const [stored] = await db
    .select({ hash: projectIntegratorKeys.tokenHash })
    .from(projectIntegratorKeys)
    .where(eq(projectIntegratorKeys.id, a.key.id));
  expect(stored?.hash).toMatch(/^[a-f\d]{64}$/u);
  expect(stored?.hash).not.toBe(a.token);
  expect(JSON.stringify(value(await listProjectIntegratorKeys(db, owner, signal())))).not.toContain(
    a.token,
  );
  await request("projects", 401);
  await request("projects", 404, { token: a.token, workspace: "other-tenant" });
  await request("projects", 403, { token: b.token, method: "POST", body: { name: "Denied" } });
  const project = await read<{ id: string; identifier: string; name: string }>(
    await request("projects", 201, {
      token: a.token,
      method: "POST",
      body: { name: "Integrated Project", identifier: "INTAPI" },
    }),
  );
  expect(project).toMatchObject({ identifier: "INTAPI", name: "Integrated Project" });
  const base = `projects/${project.id}`;
  await request(base, 404, { token: c.token });
  await db
    .update(users)
    .set({
      projectsGuestOnly: true,
      isAdmin: false,
      permissionSetId: null,
      primaryVisibilityGroupId: null,
    })
    .where(eq(users.id, outsider.userId));
  await request("projects", 401, { token: c.token });
  expect(await listProjectIntegratorKeys(db, outsider, signal())).toEqual(err("project_forbidden"));
  expect(
    await issueProjectIntegratorKey(db, outsider, { name: "Denied", access: "read" }, signal()),
  ).toEqual(err("project_forbidden"));
  await db
    .update(users)
    .set({ projectsGuestOnly: false, isAdmin: true })
    .where(eq(users.id, outsider.userId));
  await request(base, 404, { token: b.token });
  value(
    await setInternalProjectMember(
      db,
      owner,
      {
        projectId: project.id,
        userId: editor.userId,
        membership: { role: "editor", canAssign: false },
      },
      signal(),
    ),
  );
  await request(base, 200, { token: b.token });
  const head = await request(base, 200, { token: b.token, method: "HEAD" });
  expect(await head.text()).toBe("");
  await request(base, 403, { token: b.token, method: "PATCH", body: { name: "Unauthorized" } });

  const intent = randomUUID();
  const input = { name: "API work", description_html: "<p>First<br>Second</p>", priority: "high" };
  const job = await read<{ id: string; sequence_id: number; description_stripped: string }>(
    await request(`${base}/work-items`, 201, {
      token: a.token,
      method: "POST",
      body: input,
      intent,
    }),
  );
  expect(job.description_stripped).toBe("First\nSecond");
  const replay = await read<{ id: string }>(
    await request(`${base}/issues`, 201, { token: a.token, method: "POST", body: input, intent }),
  );
  expect(replay.id).toBe(job.id);
  expect(
    await read(await request(`${base}/work-items/${job.id}/activities`, 200, { token: a.token })),
  ).toMatchObject({ results: [{ issue: job.id, actor: owner.userId, verb: "created" }] });
  const found = await read<{ id: string }>(
    await request(`work-items/INTAPI-${job.sequence_id}`, 200, { token: b.token }),
  );
  expect(found.id).toBe(job.id);
  expect(
    await read(await request("work-items/search?search=API%20work", 200, { token: b.token })),
  ).toMatchObject({ issues: [{ id: job.id, name: "API work" }] });
  await request(`${base}/work-items/${job.id}`, 200, {
    token: a.token,
    method: "PATCH",
    body: { name: "Changed in API" },
  });
  expect(value(await readInternalProject(db, owner, project.id, signal())).items).toMatchObject([
    { id: job.id, title: "Changed in API" },
  ]);
  value(
    await setInternalProjectMember(
      db,
      owner,
      { projectId: project.id, userId: editor.userId, membership: null },
      signal(),
    ),
  );
  await request(`${base}/work-items/${job.id}`, 404, { token: b.token });
  expect(
    await read(await request("work-items/search?search=Changed", 200, { token: b.token })),
  ).toEqual({ issues: [] });
  expect(await revokeProjectIntegratorKey(db, outsider, a.key.id, signal())).toEqual(
    err("project_unavailable"),
  );
  value(await revokeProjectIntegratorKey(db, owner, a.key.id, signal()));
  await request(base, 401, { token: a.token });
  await db
    .update(projectIntegratorKeys)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(projectIntegratorKeys.id, b.key.id));
  await request("projects", 401, { token: b.token });
});

test("maps native catalogs, planning and Intake through the same project key", async () => {
  const db = fixture.db;
  const owner = await staff("API catalogs owner", true);
  value(await enableNativeProjects(db, owner, true, signal()));
  const { token } = value(
    await issueProjectIntegratorKey(
      db,
      owner,
      { name: "API catalogs client", access: "write" },
      signal(),
    ),
  );
  const project = await read<{ id: string; revision: number }>(
    await request("projects", 201, {
      token,
      method: "POST",
      body: { name: "API catalogs project", timezone: "Europe/Berlin" },
    }),
  );
  const base = `projects/${project.id}`;
  const states = await read<{ results: { id: string; group: string }[] }>(
    await request(`${base}/states?per_page=2`, 200, { token }),
  );
  expect(states.results).toHaveLength(2);
  const label = await read<{ id: string }>(
    await request(`${base}/labels`, 201, {
      token,
      method: "POST",
      body: { name: "Integration test" },
    }),
  );
  const group = await read<{ id: string }>(
    await request(`${base}/modules`, 201, {
      token,
      method: "POST",
      body: { name: "Integration module" },
    }),
  );
  const item = await read<{ id: string }>(
    await request(`${base}/work-items`, 201, {
      token,
      method: "POST",
      body: { name: "Module work", labels: [label.id] },
    }),
  );
  await request(`${base}/modules/${group.id}/module-issues`, 204, {
    token,
    method: "POST",
    body: { issues: [item.id] },
  });
  expect(
    await read(await request(`${base}/modules/${group.id}/module-issues`, 200, { token })),
  ).toMatchObject({ results: [{ id: item.id, labels: [label.id] }] });
  await request(`${base}/intake-issues`, 404, { token });
  value(
    await setProjectIntakeEnabled(
      db,
      owner,
      { projectId: project.id, revision: project.revision, enabled: true },
      signal(),
    ),
  );
  const capture = await read<{ id: string }>(
    await request(`${base}/intake-issues`, 201, {
      token,
      method: "POST",
      body: { issue: { name: "API Intake request" } },
    }),
  );
  const accepted = await read<{ work_item_id: string; status: number }>(
    await request(`${base}/intake-issues/${capture.id}`, 200, {
      token,
      method: "PATCH",
      body: { status: 1 },
    }),
  );
  expect(accepted.status).toBe(1);
  expect(
    await read(await request(`${base}/work-items/${accepted.work_item_id}`, 200, { token })),
  ).toMatchObject({ name: "API Intake request" });
});
