import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { savedFilters, userPreferences } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { listCompatibleSavedFilterViews } from "@/features/saved-filters/savedFilterList";
import { resolveSavedViewSelection } from "@/features/saved-filters/savedViewSelection";
import { SAVED_VIEW_SELECTION_KEYS } from "@/features/saved-filters/savedViewSelectionSchema";
import { hydrateActor } from "@/server/hydrateActor";
import { getPreferences, setPreferences } from "./preferencesRepo";

const sig = () => new AbortController().signal;

for (const targetEntity of ["person", "organization", "lead"] as const) {
  const selectionKey = SAVED_VIEW_SELECTION_KEYS[targetEntity];
  it(`${targetEntity} round-trips only its native selected ID and Clear while retaining all personal baselines`, async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const personal = {
        peopleView: ["name", "phone"],
        orgsView: ["name", "address"],
        leadsView: {
          columns: ["title", "createdAt"],
          sort: { field: "createdAt", dir: "desc" as const },
        },
      };
      const [view] = await db
        .insert(savedFilters)
        .values({
          ownerId: user.id,
          targetEntity,
          name: "Native choice",
          definition: {
            conditions: [
              { field: targetEntity === "lead" ? "title" : "name", op: "contains", value: "Acme" },
            ],
          },
        })
        .returning();
      expect(view).toBeDefined();
      if (view === undefined) return;
      await setPreferences(db, user.id, { ui: personal }, sig());
      await setPreferences(
        db,
        user.id,
        { ui: { [selectionKey]: { version: 1, savedViewId: view.id } } },
        sig(),
      );
      const reloaded = await getPreferences(db, user.id, sig());
      expect(reloaded.ui).toMatchObject({
        ...personal,
        [selectionKey]: { version: 1, savedViewId: view.id },
      });
      const [stored] = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, user.id));
      expect(stored?.ui).toMatchObject({ [selectionKey]: { version: 1, savedViewId: view.id } });
      expect(
        Object.keys(
          (stored?.ui as Record<string, object> | undefined)?.[selectionKey] ?? {},
        ).sort(),
      ).toEqual(["savedViewId", "version"]);
      const actor = await hydrateActor(db, user.id, sig());
      expect(actor).not.toBeNull();
      if (actor === null) return;
      const visible = await listCompatibleSavedFilterViews({ db, actor }, targetEntity);
      expect(
        resolveSavedViewSelection(reloaded.ui[selectionKey], visible).initialSavedView?.id,
      ).toBe(view.id);
      await setPreferences(
        db,
        user.id,
        { ui: { [selectionKey]: { version: 1, savedViewId: null } } },
        sig(),
      );
      const cleared = await getPreferences(db, user.id, sig());
      expect(cleared.ui).toMatchObject({
        ...personal,
        [selectionKey]: { version: 1, savedViewId: null },
      });
    });
  });

  it(`${targetEntity} retains a private selected ID as unavailable after a real visibility read`, async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const owner = await seedUser(db);
      const [view] = await db
        .insert(savedFilters)
        .values({
          ownerId: owner.id,
          targetEntity,
          name: "Private metadata",
          definition: {
            conditions: [
              {
                field: targetEntity === "lead" ? "title" : "name",
                op: "contains",
                value: "Private condition",
              },
            ],
          },
        })
        .returning();
      expect(view).toBeDefined();
      if (view === undefined) return;
      await setPreferences(
        db,
        user.id,
        { ui: { [selectionKey]: { version: 1, savedViewId: view.id } } },
        sig(),
      );
      const actor = await hydrateActor(db, user.id, sig());
      expect(actor).not.toBeNull();
      if (actor === null) return;
      const reloaded = await getPreferences(db, user.id, sig());
      const visible = await listCompatibleSavedFilterViews({ db, actor }, targetEntity);
      const resolved = resolveSavedViewSelection(reloaded.ui[selectionKey], visible);
      expect(resolved.initialSavedView).toMatchObject({
        id: view.id,
        availability: "unavailable",
        definition: null,
        name: "",
      });
      expect(JSON.stringify(resolved)).not.toContain("Private metadata");
      expect(JSON.stringify(resolved)).not.toContain("Private condition");
      expect((await getPreferences(db, user.id, sig())).ui[selectionKey]).toEqual({
        version: 1,
        savedViewId: view.id,
      });
    });
  });

  it(`${targetEntity} corrupt JSONB selection blocks on read and preserves sibling preferences`, async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      await db.insert(userPreferences).values({
        userId: user.id,
        ui: {
          [selectionKey]: { version: 1, savedViewId: "corrupt" },
          peopleView: ["name", "phone"],
          winSound: true,
        },
      });
      const reloaded = await getPreferences(db, user.id, sig());
      expect(reloaded.ui[selectionKey]).toMatchObject({ status: "blocked" });
      expect(reloaded.ui.peopleView).toEqual(["name", "phone"]);
      expect(reloaded.ui.winSound).toBe(true);
      expect(resolveSavedViewSelection(reloaded.ui[selectionKey], []).initialSelectionBlocked).toBe(
        true,
      );
    });
  });
}
