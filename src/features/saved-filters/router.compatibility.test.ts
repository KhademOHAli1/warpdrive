import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { savedFilters } from "@/db/schema/savedFilters";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { HydratedActor } from "@/server/hydrateActor";
import { createCaller } from "@/server/trpc/root";

describe("stored saved views remain unavailable without data loss", () => {
  it("retains invalid deal/person rows and their raw DB payload while exposing no executable definition", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const actor: HydratedActor = {
        id: user.id,
        type: "regular",
        isActive: true,
        name: "Ali",
        email: "ali@example.test",
        avatarUrl: null,
        flags: new Set(),
        groupIds: new Set(),
      };
      const caller = createCaller({ db, actor, session: { userId: user.id, sessionId: "test" } });
      for (const targetEntity of ["deal", "person"] as const) {
        const raw = { conditions: [{ field: "unknown", op: "eq", value: "keep-original" }] };
        const [row] = await db
          .insert(savedFilters)
          .values({
            name: "نمای من / Meine Ansicht",
            targetEntity,
            ownerId: user.id,
            definition: raw,
          })
          .returning();
        if (row === undefined) throw new Error("fixture row missing");
        const views =
          targetEntity === "deal"
            ? await caller.deal.savedFilters()
            : await caller.savedFilters.listByTarget({ targetEntity });
        expect(views.find((view) => view.id === row.id)).toMatchObject({
          id: row.id,
          name: row.name,
          isOwn: true,
          availability: "unavailable",
          definition: null,
          problem: { kind: "unsupported", code: "unsupported-field" },
        });
        expect(JSON.stringify(views)).not.toContain("keep-original");
        const [retained] = await db.select().from(savedFilters).where(eq(savedFilters.id, row.id));
        expect(retained?.definition).toEqual(raw);
      }
    });
  });
});
