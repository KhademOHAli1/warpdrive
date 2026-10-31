import { expect, test, vi } from "vitest";
import { REGULAR_DEFAULT_FLAGS } from "@/constants/permissionFlags";

const mocks = vi.hoisted(() => ({
  fresh: vi.fn(() => Promise.resolve(null)),
  operation: vi.fn(() => Promise.resolve({ ok: true, value: true })),
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("./shared", () => ({
  guardCsrf: () => Promise.resolve({ ok: true }),
  runWithActor: (_actor: unknown, body: (actor: unknown) => Promise<unknown>) =>
    body({ id: "actor", type: "admin" }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: { id: "actor", type: "admin" } }),
}));
vi.mock("@/features/auth/better/sessionPolicy", () => ({ resolveWorkflowSession: mocks.fresh }));
vi.mock("@/features/identity/permission-sets.service", () => ({
  createPermissionSet: mocks.operation,
  updatePermissionSetFlags: mocks.operation,
}));
vi.mock("@/features/identity/teams.service", () => ({
  createTeam: mocks.operation,
  setTeamMembers: mocks.operation,
  updateTeam: mocks.operation,
  deleteTeam: mocks.operation,
}));
vi.mock("@/features/identity/visibility-groups.service", () => ({
  createVisibilityGroup: mocks.operation,
  addGroupMember: mocks.operation,
  removeGroupMember: mocks.operation,
}));

import { addGroupMemberAction, createGroupAction, removeGroupMemberAction } from "./groups";
import { createPermissionSetAction, updateFlagsAction } from "./permission-sets";
import {
  createTeamAction,
  deleteTeamAction,
  setTeamMembersAction,
  updateTeamAction,
} from "./teams";

test("team, permission and visibility actions require fresh authentication before their services run", async () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  const calls = [
    createPermissionSetAction("csrf", { name: "Test", flags: REGULAR_DEFAULT_FLAGS }),
    updateFlagsAction("csrf", { setId: id, flags: REGULAR_DEFAULT_FLAGS }),
    createTeamAction("csrf", { name: "Test", managerId: null }),
    setTeamMembersAction("csrf", { teamId: id, userIds: [] }),
    updateTeamAction("csrf", { teamId: id, name: "Test", managerId: null }),
    deleteTeamAction("csrf", { teamId: id }),
    createGroupAction("csrf", { name: "Test" }),
    addGroupMemberAction("csrf", { groupId: id, userId: id }),
    removeGroupMemberAction("csrf", { groupId: id, userId: id }),
  ];
  for (const result of await Promise.all(calls))
    expect(result).toEqual({ ok: false, error: "fresh_auth_required" });
  expect(mocks.operation).not.toHaveBeenCalled();
});
