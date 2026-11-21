import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, test } from "vitest";
import { agencyProjectMembers, users } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { enableNativeProjects } from "@/features/agency-projects/nativeViews";
import {
  createSession,
  loadLiveSessionById,
  loadLiveSessionByToken,
} from "@/features/auth/session";
import { createContextFromRequest } from "@/server/trpc/context-core";
import { createCaller } from "@/server/trpc/root";
import { makeTestDb } from "@/test/db";
import { err } from "@/types/result";
import { createInternalProject, createInternalProjectItem } from "../service";
import { saveProjectGuestAccess } from "./service";

test("a real Projects-only session reaches its projects and is denied by standard CRM and API-key authorities", async () => {
  const h = await makeTestDb();
  try {
    const signal = AbortSignal.timeout(30_000);
    const owner = await seedUser(h.db, { isAdmin: true });
    const [guest] = await h.db
      .insert(users)
      .values({
        email: `collaborator-${randomUUID()}@example.test`,
        name: "External project guest",
        projectsGuestOnly: true,
      })
      .returning();
    assert(guest !== undefined);
    const [ownerToken, guestToken] = await Promise.all([
      createSession(h.db, owner.id, signal),
      createSession(h.db, guest.id, signal),
    ]);
    assert(ownerToken.ok && guestToken.ok);
    const ownerSession = { userId: owner.id, sessionId: ownerToken.value.sessionId };
    assert((await enableNativeProjects(h.db, ownerSession, true, signal)).ok);
    const own = await createInternalProject(
      h.db,
      ownerSession,
      { id: randomUUID(), title: "Guest project" },
      signal,
    );
    const other = await createInternalProject(
      h.db,
      ownerSession,
      { id: randomUUID(), title: "Unjoined workspace project" },
      signal,
    );
    assert(own.ok && other.ok);
    await h.db.insert(agencyProjectMembers).values({
      projectId: own.value.id,
      userId: guest.id,
      projectGuest: true,
    });
    assert(
      (
        await createInternalProjectItem(
          h.db,
          ownerSession,
          {
            projectId: own.value.id,
            id: randomUUID(),
            title: "Staff-only work before expanding guest access",
          },
          signal,
        )
      ).ok,
    );
    assert(
      (
        await saveProjectGuestAccess(
          h.db,
          ownerSession,
          {
            projectId: other.value.id,
            expectedActorId: owner.id,
            csrfToken: null,
            revision: 0,
            visibility: "workspace",
            guestViewAllFeatures: false,
          },
          signal,
        )
      ).ok,
    );

    const request = new Request(
      "https://application.example.test/api/trpc/internalProjects.index",
      {
        headers: { cookie: `wd_sid=${guestToken.value.sid}` },
      },
    );
    const guestContext = await createContextFromRequest(request, h.db);
    expect(guestContext.actor).toBeNull();
    expect(guestContext.session).toBeNull();
    expect(guestContext.projectGuest?.actor).toMatchObject({
      id: guest.id,
      projectsGuestOnly: true,
    });
    expect(await loadLiveSessionByToken(h.db, guestToken.value.sid, signal)).toEqual(
      err("not_found"),
    );
    expect(await loadLiveSessionById(h.db, guestToken.value.sessionId, signal)).toEqual(
      err("not_found"),
    );
    const rpc = createCaller(guestContext);
    await expect(rpc.frontend.dashboardConfiguration()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(rpc.identity.assignableUsers()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(rpc.internalProjects.integrator.keys()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(await rpc.internalProjects.index()).toMatchObject({
      ok: true,
      value: { canCreate: false, projects: [{ id: own.value.id }] },
    });
    const listing = await rpc.internalProjects.index();
    assert(listing.ok);
    expect(listing.value.discoverableProjects).toBeUndefined();
    expect(await rpc.internalProjects.workspace({ projectId: own.value.id })).toMatchObject({
      ok: true,
      value: { guestAccess: "restricted", canEdit: false, items: [], staff: [] },
    });
    expect(await rpc.internalProjects.workspace({ projectId: other.value.id })).toEqual(
      err("project_unavailable"),
    );
    expect(await rpc.projectDocuments.list({ projectId: own.value.id })).toEqual(
      err("project_unavailable"),
    );
    await h.db.delete(agencyProjectMembers).where(eq(agencyProjectMembers.userId, guest.id));
    expect(await rpc.internalProjects.workspace({ projectId: own.value.id })).toEqual(
      err("project_unavailable"),
    );
  } finally {
    await h.close();
  }
});
