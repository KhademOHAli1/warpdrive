import { describe, expect, it } from "vitest";
import { permissionSets } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { type EntityCreateSession, resolveOwnerId, resolveVisibilityGroup } from "./entityCreate";

function session(over: Partial<EntityCreateSession> = {}): EntityCreateSession {
  return {
    userId: "creator",
    isAdmin: false,
    isActive: true,
    sessionLive: true,
    visibilityGroupIds: [],
    primaryVisibilityGroupId: null,
    flags: {},
    ...over,
  };
}

const sig = () => new AbortController().signal;

describe("resolveVisibilityGroup", () => {
  it("honors a client group hint when the actor is a member", () => {
    const r = resolveVisibilityGroup(session({ visibilityGroupIds: ["g1"] }), "g1");
    expect(r.ok && r.value).toBe("g1");
  });

  it("ignores a non-member hint and falls back to the primary group", () => {
    const r = resolveVisibilityGroup(
      session({ visibilityGroupIds: ["g1"], primaryVisibilityGroupId: "gp" }),
      "g-not-mine",
    );
    expect(r.ok && r.value).toBe("gp");
  });

  it("errors when neither a member hint nor a primary group is available", () => {
    const r = resolveVisibilityGroup(session(), undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.id).toBe("E_PERM_003");
  });
});

describe("resolveOwnerId", () => {
  it("returns the creator when no override is requested", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const r = await resolveOwnerId(db, session({ userId: u.id }), undefined, sig());
      expect(r.ok && r.value).toBe(u.id);
    });
  });

  it("ignores an override without a changeOwner flag", async () => {
    await withTestDb(async (db) => {
      const creator = await seedUser(db);
      const target = await seedUser(db);
      const r = await resolveOwnerId(db, session({ userId: creator.id }), target.id, sig());
      expect(r.ok && r.value).toBe(creator.id);
    });
  });

  it("rejects an override to a non-existent user", async () => {
    await withTestDb(async (db) => {
      const creator = await seedUser(db);
      const r = await resolveOwnerId(
        db,
        session({ userId: creator.id, isAdmin: true }),
        "00000000-0000-0000-0000-000000000000",
        sig(),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.id).toBe("E_USER_001");
    });
  });
});

describe("resolveOwnerId with hydrated scoped changeOwner flags", () => {
  async function hydratedSession(
    db: Parameters<typeof hydrateActor>[0],
    flags: Record<string, boolean>,
  ) {
    const [set] = await db
      .insert(permissionSets)
      .values({ name: `ps-${Math.random().toString(36).slice(2)}`, flags })
      .returning();
    const user = await seedUser(db, { permissionSetId: set?.id });
    const actor = await hydrateActor(db, user.id, sig());
    if (actor === null) throw new Error("hydrate failed");
    const flagMap: Record<string, boolean> = {};
    for (const f of actor.flags) flagMap[f] = true;
    return session({ userId: user.id, flags: flagMap });
  }

  it("honors the requested owner for a set holding deal.changeOwner_any", async () => {
    await withTestDb(async (db) => {
      const target = await seedUser(db);
      const s = await hydratedSession(db, { "deal.changeOwner_any": true });
      const r = await resolveOwnerId(db, s, target.id, sig());
      expect(r.ok && r.value).toBe(target.id);
    });
  });

  it("honors the requested owner for a set holding deal.changeOwner_own", async () => {
    await withTestDb(async (db) => {
      const target = await seedUser(db);
      const s = await hydratedSession(db, { "deal.changeOwner_own": true });
      const r = await resolveOwnerId(db, s, target.id, sig());
      expect(r.ok && r.value).toBe(target.id);
    });
  });

  it("keeps the creator for a set with neither changeOwner flag", async () => {
    await withTestDb(async (db) => {
      const target = await seedUser(db);
      const s = await hydratedSession(db, { "deal.create": true });
      const r = await resolveOwnerId(db, s, target.id, sig());
      expect(r.ok && r.value).toBe(s.userId);
    });
  });
});
