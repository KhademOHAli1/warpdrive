import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { permissionSets, sessions, users } from "@/db/schema";
import { authInvitations, authMailOutbox } from "@/db/schema/authManagement";
import { visibilityGroupMembers } from "@/db/schema/identity";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import {
  consumeInvitation,
  hashInvitationToken,
  validateInvitation,
} from "@/features/auth/management/invitations";
import { decryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import { isProjectItemArchived, readArchivedProjectItems } from "../automations/service";
import { listProjectDocuments } from "../documents/service";
import { createProjectIntake, readProjectIntake, reviewProjectIntake } from "../intake/service";
import { readWorkspacePlanning } from "../planning/assignments";
import { internalProjectItemSubscriptions } from "../profile/schema";
import { readProjectProfileItems } from "../profile/service";
import { readProjectSubscription } from "../profile/subscriptions";
import { internalProjectItems, internalProjectSettings } from "../schema";
import {
  createInternalProjectItem,
  listInternalProjects,
  readInternalProject,
  setInternalProjectMember,
} from "../service";
import { inviteProjectGuest } from "./invitations";
import { joinPublicInternalProject, saveProjectGuestAccess } from "./service";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(10_000);

beforeAll(async () => {
  fixture = await makeTestDb();
  await fixture.pool.query(
    "INSERT INTO agency_project_settings(id,enabled) VALUES (true,true) ON CONFLICT(id) DO UPDATE SET enabled=true",
  );
});

afterAll(async () => {
  await fixture.close();
});

function value<T, E>(result: Result<T, E>): T {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("Expected successful project fixture operation");
  return result.value;
}

async function staff(name: string, canCreate = false) {
  const id = randomUUID();
  const sessionId = randomUUID();
  const permissionSetId = canCreate ? randomUUID() : null;
  if (permissionSetId !== null)
    await fixture.db
      .insert(permissionSets)
      .values({ id: permissionSetId, name: permissionSetId, flags: { "project.create": true } });
  await fixture.db.insert(users).values({ id, name, email: `${id}@example.test`, permissionSetId });
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId: id,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 600_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId: id, sessionId };
}

async function project(ownerUserId: string, title: string) {
  const id = randomUUID();
  await fixture.db.insert(agencyProjects).values({ id, kind: "internal", ownerUserId, title });
  return id;
}

function accessInput(projectId: string, expectedActorId: string) {
  return {
    projectId,
    expectedActorId,
    csrfToken: null,
    revision: 0,
    visibility: "private" as const,
    guestViewAllFeatures: false,
  };
}

test("guest invitation accepts only its recipient, grants one read-only project seat and never adopts existing accounts", async () => {
  const owner = await staff("Inviting owner");
  const existing = await staff("Existing staff");
  const projectId = await project(owner.userId, "Invitation destination");
  const otherId = await project(owner.userId, "Unrelated project");
  const email = `guest+${randomUUID()}@example.test`;
  const input = {
    projectId,
    expectedActorId: owner.userId,
    csrfToken: null,
    email,
    name: "Synthetic guest",
    locale: "en" as const,
  };
  expect(
    await inviteProjectGuest(
      fixture.db,
      existing,
      { ...input, expectedActorId: existing.userId },
      signal(),
    ),
  ).toEqual(err("project_unavailable"));
  expect(
    value(
      await inviteProjectGuest(
        fixture.db,
        owner,
        { ...input, email: `${existing.userId}@example.test` },
        signal(),
      ),
    ),
  ).toEqual({ outcome: "email_unavailable" });
  const invited = value(await inviteProjectGuest(fixture.db, owner, input, signal()));
  expect(invited.outcome).toBe("invited");
  if (invited.outcome !== "invited") throw new Error("Guest invitation was not issued");
  const { userId, invitationId } = invited;
  expect(value(await inviteProjectGuest(fixture.db, owner, input, signal()))).toEqual({
    outcome: "email_unavailable",
  });
  const [account] = await fixture.db.select().from(users).where(eq(users.id, userId));
  expect(account).toMatchObject({
    email,
    projectsGuestOnly: true,
    isAdmin: false,
    permissionSetId: null,
    primaryVisibilityGroupId: null,
    invitedAt: expect.any(Date),
  });
  expect(
    await fixture.db
      .select()
      .from(visibilityGroupMembers)
      .where(eq(visibilityGroupMembers.userId, userId)),
  ).toEqual([]);
  expect(
    await fixture.db
      .select()
      .from(agencyProjectMembers)
      .where(eq(agencyProjectMembers.userId, userId)),
  ).toEqual([
    expect.objectContaining({
      projectId,
      projectGuest: true,
      projectEdit: false,
      assignmentCoordinate: false,
    }),
  ]);
  expect(value(await readInternalProject(fixture.db, owner, projectId, signal())).members).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        person: { id: userId, name: input.name },
        role: "guest",
        projectsGuestOnly: true,
        invitationPending: true,
      }),
    ]),
  );

  const [mail] = await fixture.db
    .select()
    .from(authMailOutbox)
    .where(eq(authMailOutbox.invitationId, invitationId));
  expect(mail).toMatchObject({ kind: "invitation", recipient: email, status: "pending" });
  if (mail === undefined) throw new Error("Guest invitation outbox row is missing");
  const decrypted = value(decryptToken(mail.payloadEnc));
  const link = new URL((JSON.parse(decrypted) as { url: string }).url);
  expect(link.pathname).toBe("/auth/invite");
  const token = link.searchParams.get("token");
  if (token === null) throw new Error("Guest invitation token is missing");
  const [invitation] = await fixture.db
    .select()
    .from(authInvitations)
    .where(eq(authInvitations.id, invitationId));
  expect(invitation?.tokenHash === hashInvitationToken(token)).toBe(true);
  expect(value(await validateInvitation(fixture.db, token, signal()))).toMatchObject({
    userId,
    email,
  });
  expect(await consumeInvitation(fixture.db, token, "other@example.test", signal())).toEqual(
    err("invalid_invitation"),
  );
  expect(value(await consumeInvitation(fixture.db, token, email, signal()))).toEqual({ userId });
  expect(await validateInvitation(fixture.db, token, signal())).toEqual(err("invalid_invitation"));
  const [accepted] = await fixture.db.select().from(users).where(eq(users.id, userId));
  expect(accepted).toMatchObject({
    invitedAt: null,
    projectsGuestOnly: true,
    permissionSetId: null,
  });

  const sessionId = randomUUID();
  const guest = { sessionId, userId };
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 600_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  expect(value(await listInternalProjects(fixture.db, guest, signal()))).toMatchObject({
    canCreate: false,
    projects: [expect.objectContaining({ id: projectId })],
  });
  expect(await readInternalProject(fixture.db, guest, otherId, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(await joinPublicInternalProject(fixture.db, guest, otherId, signal())).toEqual(
    err("project_forbidden"),
  );
});

test("removing a pending Projects-only guest revokes their unused invitation and queues no delivery", async () => {
  const owner = await staff("Pending invitation owner");
  const projectId = await project(owner.userId, "Revoked invitation project");
  const email = `revoked+${randomUUID()}@example.test`;
  const invited = value(
    await inviteProjectGuest(
      fixture.db,
      owner,
      {
        projectId,
        expectedActorId: owner.userId,
        csrfToken: null,
        email,
        name: "Unaccepted guest",
        locale: "en",
      },
      signal(),
    ),
  );
  if (invited.outcome !== "invited") throw new Error("Guest invitation was not issued");
  const { userId, invitationId } = invited;
  const [outbox] = await fixture.db
    .select()
    .from(authMailOutbox)
    .where(eq(authMailOutbox.invitationId, invitationId));
  if (outbox === undefined) throw new Error("Guest invitation outbox row is missing");
  const url = new URL((JSON.parse(value(decryptToken(outbox.payloadEnc))) as { url: string }).url);
  const token = url.searchParams.get("token");
  if (token === null) throw new Error("Guest invitation token is missing");
  expect(value(await validateInvitation(fixture.db, token, signal())).userId).toBe(userId);

  const workspace = value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      {
        projectId,
        userId,
        membership: null,
      },
      signal(),
    ),
  );
  expect(workspace.members.some(({ person }) => person.id === userId)).toBe(false);
  expect(await consumeInvitation(fixture.db, token, email, signal())).toEqual(
    err("invalid_invitation"),
  );
  const [mail] = await fixture.db
    .select()
    .from(authMailOutbox)
    .where(eq(authMailOutbox.invitationId, invitationId));
  expect(mail?.status).toBe("cancelled");
  const [invitation] = await fixture.db
    .select()
    .from(authInvitations)
    .where(eq(authInvitations.id, invitationId));
  expect(invitation?.revokedAt).toBeInstanceOf(Date);
});

test("workspace discovery exposes metadata and self-join establishes only the admitted project role", async () => {
  const owner = await staff("Project owner");
  const regular = await staff("Workspace viewer");
  const editor = await staff("Workspace creator", true);
  const privateId = await project(owner.userId, "Private workspace project");
  const openId = await project(owner.userId, "Discoverable workspace project");
  expect(
    (
      value(await listInternalProjects(fixture.db, regular, signal())).discoverableProjects ?? []
    ).filter(({ id }) => id === openId),
  ).toEqual([]);
  expect(await joinPublicInternalProject(fixture.db, regular, privateId, signal())).toEqual(
    err("project_unavailable"),
  );
  const input = { ...accessInput(openId, owner.userId), visibility: "workspace" as const };
  expect(value(await saveProjectGuestAccess(fixture.db, owner, input, signal())).revision).toBe(1);
  const index = value(await listInternalProjects(fixture.db, regular, signal()));
  const open = index.discoverableProjects?.find(({ id }) => id === openId);
  expect(open).toEqual({
    id: openId,
    title: "Discoverable workspace project",
    identifier: expect.any(String),
  });
  expect(index.discoverableProjects?.some(({ id }) => id === privateId)).toBe(false);
  expect(index.projects.some(({ id }) => id === openId)).toBe(false);
  expect(await readInternalProject(fixture.db, regular, openId, signal())).toEqual(
    err("project_unavailable"),
  );

  value(await joinPublicInternalProject(fixture.db, regular, openId, signal()));
  value(await joinPublicInternalProject(fixture.db, regular, openId, signal()));
  value(await joinPublicInternalProject(fixture.db, editor, openId, signal()));
  const joined = value(await readInternalProject(fixture.db, regular, openId, signal()));
  expect(joined).toMatchObject({ canEdit: false, canManageSettings: false });
  expect(joined.members).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        person: expect.objectContaining({ id: regular.userId }),
        role: "viewer",
        canAssign: false,
      }),
      expect.objectContaining({
        person: expect.objectContaining({ id: editor.userId }),
        role: "editor",
        canAssign: false,
      }),
    ]),
  );
  expect(value(await readInternalProject(fixture.db, editor, openId, signal())).canEdit).toBe(true);
  expect(
    await saveProjectGuestAccess(
      fixture.db,
      regular,
      { ...input, expectedActorId: regular.userId, revision: 1 },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  expect(await saveProjectGuestAccess(fixture.db, owner, input, signal())).toEqual(
    err("project_conflict"),
  );
});

test("restricted guests can see only their authored work, archives and intake until an owner expands access", async () => {
  const owner = await staff("Private project owner");
  const guest = await staff("Invited project guest");
  const projectId = await project(owner.userId, "Guest project");
  expect(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId, userId: guest.userId, membership: { role: "guest", canAssign: true } },
      signal(),
    ),
  ).toEqual(err("project_invalid"));
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId, userId: guest.userId, membership: { role: "guest", canAssign: false } },
      signal(),
    ),
  );
  await fixture.db
    .update(internalProjectSettings)
    .set({ intakeEnabled: true })
    .where(eq(internalProjectSettings.projectId, projectId));
  const authored = randomUUID();
  const hidden = randomUUID();
  const archivedAuthored = randomUUID();
  const archivedHidden = randomUUID();
  await fixture.db.insert(internalProjectItems).values([
    { id: authored, projectId, title: "Guest authored work", createdBy: guest.userId },
    { id: hidden, projectId, title: "Internal team work", createdBy: owner.userId },
    {
      id: archivedAuthored,
      projectId,
      title: "Guest authored archive",
      createdBy: guest.userId,
      archivedAt: new Date(),
    },
    {
      id: archivedHidden,
      projectId,
      title: "Internal team archive",
      createdBy: owner.userId,
      archivedAt: new Date(),
    },
  ]);
  await fixture.db
    .insert(internalProjectItemSubscriptions)
    .values([authored, hidden].map((itemId) => ({ itemId, userId: guest.userId })));
  const original = value(await readInternalProject(fixture.db, guest, projectId, signal()));
  expect(original).toMatchObject({
    guestAccess: "restricted",
    canEdit: false,
    canAssign: false,
    canManageSettings: false,
  });
  expect(original.items.map(({ id }) => id)).toEqual([authored]);
  expect(original.assignees.some(({ id }) => id === guest.userId)).toBe(false);
  expect(
    value(await readArchivedProjectItems(fixture.db, guest, projectId, signal())).map(
      ({ id }) => id,
    ),
  ).toEqual([archivedAuthored]);
  expect(
    value(await isProjectItemArchived(fixture.db, guest, projectId, archivedHidden, signal())),
  ).toBe(false);
  expect(await listProjectDocuments(fixture.db, guest, projectId, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(await readWorkspacePlanning(fixture.db, guest, projectId, signal())).toEqual(
    err("project_unavailable"),
  );
  expect(
    await readProjectSubscription(fixture.db, guest, { projectId, itemId: hidden }, signal()),
  ).toEqual(err("project_unavailable"));
  expect(
    value(await readProjectProfileItems(fixture.db, guest, "subscribed", {}, signal())).items.map(
      ({ id }) => id,
    ),
  ).toEqual([authored]);

  const received = value(
    await createProjectIntake(
      fixture.db,
      guest,
      {
        projectId,
        intentId: randomUUID(),
        title: "Guest intake",
        description: "Request from guest",
        priority: "none",
      },
      signal(),
    ),
  );
  value(
    await createProjectIntake(
      fixture.db,
      owner,
      {
        projectId,
        intentId: randomUUID(),
        title: "Internal intake",
        description: "Request from owner",
        priority: "none",
      },
      signal(),
    ),
  );
  value(
    await reviewProjectIntake(
      fixture.db,
      owner,
      { projectId, requestId: received.id, revision: 0, action: "duplicate", workItemId: hidden },
      signal(),
    ),
  );
  const intakeQuery = { projectId, page: 1, filter: "all" as const, requestId: received.id };
  const intake = value(await readProjectIntake(fixture.db, guest, intakeQuery, signal()));
  expect(intake.requests.map(({ id, workItemId }) => ({ id, workItemId }))).toEqual([
    { id: received.id, workItemId: null },
  ]);
  expect(intake.selected?.workItemId).toBeNull();

  const input = accessInput(projectId, owner.userId);
  value(
    await saveProjectGuestAccess(
      fixture.db,
      owner,
      { ...input, guestViewAllFeatures: true },
      signal(),
    ),
  );
  const expanded = value(await readInternalProject(fixture.db, guest, projectId, signal()));
  expect(expanded).toMatchObject({ guestAccess: "all", canEdit: false });
  expect(expanded.items.map(({ id }) => id)).toEqual(expect.arrayContaining([authored, hidden]));
  expect(value(await listProjectDocuments(fixture.db, guest, projectId, signal())).canCreate).toBe(
    false,
  );
  expect(
    value(await readProjectIntake(fixture.db, guest, intakeQuery, signal())).selected?.workItemId,
  ).toBe(hidden);
  expect(
    await createInternalProjectItem(
      fixture.db,
      guest,
      { projectId, id: randomUUID(), title: "Denied direct work" },
      signal(),
    ),
  ).toEqual(err("project_forbidden"));
  value(await saveProjectGuestAccess(fixture.db, owner, { ...input, revision: 1 }, signal()));
  expect(
    value(await readInternalProject(fixture.db, guest, projectId, signal())).items.map(
      ({ id }) => id,
    ),
  ).toEqual([authored]);
  value(
    await setInternalProjectMember(
      fixture.db,
      owner,
      { projectId, userId: guest.userId, membership: null },
      signal(),
    ),
  );
  expect(await readInternalProject(fixture.db, guest, projectId, signal())).toEqual(
    err("project_unavailable"),
  );
});
