import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  csrf: vi.fn(),
  context: vi.fn(),
  visible: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("@/db/client", async () => {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return {
    db: drizzle(new Pool({ connectionString: "postgresql://unused:unused@127.0.0.1:1/unused" })),
  };
});
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: h.csrf }));
vi.mock("@/server/trpc/context", () => ({ createContext: h.context }));
vi.mock("@/features/saved-filters/savedFilterList", () => ({
  listCompatibleSavedFilterViews: h.visible,
}));
vi.mock("./preferencesRepo", () => ({
  setPreferences: h.persist,
  setSidebarSectionsPreference: vi.fn(),
}));

import { db } from "@/db/client";
import { setSavedViewSelectionAction } from "./preferencesActions";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const oldActorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const viewId = "11111111-1111-4111-8111-111111111111";
const actor = { id: actorId, type: "regular", flags: new Set(), isActive: true };
beforeEach(() => {
  h.csrf.mockResolvedValue({ ok: true, value: true });
  h.context.mockResolvedValue({
    db,
    actor,
    session: { userId: actorId, sessionId: "existing-session-context" },
  });
  h.visible.mockResolvedValue([{ id: viewId }]);
  h.persist.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

it("fences a deferred selection when the native actor changed", async () => {
  const result = await setSavedViewSelectionAction(
    { targetEntity: "person", savedViewId: viewId },
    "csrf",
    oldActorId,
  );
  expect(result).toEqual({ ok: false, error: { id: "E_PERM_001" } });
  expect(h.visible).not.toHaveBeenCalled();
  expect(h.persist).not.toHaveBeenCalled();
});

it("requires the native CSRF check before looking up identity or writing preferences", async () => {
  h.csrf.mockResolvedValue({ ok: false, error: "csrf" });
  await expect(
    setSavedViewSelectionAction({ targetEntity: "person", savedViewId: viewId }, "wrong"),
  ).resolves.toEqual({ ok: false, error: { id: "E_AUTH_CSRF" } });
  expect(h.context).not.toHaveBeenCalled();
  expect(h.persist).not.toHaveBeenCalled();
});

it.each([
  { actor: null, session: null },
  { actor, session: null },
])("requires a current native session and actor", async (context) => {
  h.context.mockResolvedValue({ db, ...context });
  await expect(
    setSavedViewSelectionAction({ targetEntity: "person", savedViewId: viewId }, "csrf"),
  ).resolves.toEqual({ ok: false, error: { id: "E_AUTH_003" } });
  expect(h.visible).not.toHaveBeenCalled();
  expect(h.persist).not.toHaveBeenCalled();
});

it.each([
  { targetEntity: "deal", savedViewId: viewId },
  { targetEntity: "person", savedViewId: "bad-id" },
  { targetEntity: "person", savedViewId: viewId, actorId: oldActorId },
  { targetEntity: "person", savedViewId: viewId, columns: ["name"] },
])("rejects an invalid ID-only selection input without throwing", async (input) => {
  await expect(setSavedViewSelectionAction(input, "csrf")).resolves.toEqual({
    ok: false,
    error: { id: "E_PREF_001" },
  });
  expect(h.visible).not.toHaveBeenCalled();
  expect(h.persist).not.toHaveBeenCalled();
});

it.each([
  ["person", "peopleSavedViewSelection"],
  ["organization", "orgsSavedViewSelection"],
  ["lead", "leadsSavedViewSelection"],
])("writes %s selection separately from every personal baseline", async (targetEntity, key) => {
  await expect(
    setSavedViewSelectionAction({ targetEntity, savedViewId: viewId }, "csrf", actorId),
  ).resolves.toEqual({ ok: true });
  expect(h.visible).toHaveBeenCalledWith(expect.objectContaining({ actor }), targetEntity);
  expect(h.persist).toHaveBeenCalledExactlyOnceWith(
    db,
    actorId,
    { ui: { [key]: { version: 1, savedViewId: viewId } } },
    expect.any(AbortSignal),
  );
});

it("refuses an inaccessible ID even for a regular authenticated actor", async () => {
  h.visible.mockResolvedValue([]);
  await expect(
    setSavedViewSelectionAction({ targetEntity: "person", savedViewId: viewId }, "csrf"),
  ).resolves.toEqual({ ok: false, error: { id: "E_PERM_001" } });
  expect(h.persist).not.toHaveBeenCalled();
});

it("permits explicit Clear without looking up the inaccessible old view", async () => {
  await expect(
    setSavedViewSelectionAction({ targetEntity: "lead", savedViewId: null }, "csrf"),
  ).resolves.toEqual({ ok: true });
  expect(h.visible).not.toHaveBeenCalled();
  expect(h.persist).toHaveBeenCalledWith(
    db,
    actorId,
    { ui: { leadsSavedViewSelection: { version: 1, savedViewId: null } } },
    expect.any(AbortSignal),
  );
});

it("returns read and write failures as Results", async () => {
  h.visible.mockRejectedValueOnce(new Error("read offline"));
  await expect(
    setSavedViewSelectionAction({ targetEntity: "lead", savedViewId: viewId }, "csrf"),
  ).resolves.toEqual({ ok: false, error: { id: "E_DB_004" } });
  h.persist.mockRejectedValueOnce(new Error("write offline"));
  await expect(
    setSavedViewSelectionAction({ targetEntity: "lead", savedViewId: null }, "csrf"),
  ).resolves.toEqual({ ok: false, error: { id: "E_DB_003" } });
});
