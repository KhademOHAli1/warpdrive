import { describe, expect, it } from "vitest";
import { completePermissionFlags } from "@/app/(app)/settings/permission-sets/permissionSetFlags";
import {
  ADMIN_DEFAULT_FLAGS,
  ALL_PERMISSION_FLAG_KEYS,
  GLOBAL_FLAGS,
  HIGH_RISK_FLAGS,
  type PermissionFlagKey,
  REGULAR_DEFAULT_FLAGS,
} from "@/constants/permissionFlags";
import { canGrantFlags } from "@/features/identity/guards";
import { createPermissionSetInput } from "@/features/identity/schemas";
import {
  settingsMessagesForLocale,
  settingsPermissionLabel,
} from "@/features/identity/settingsMessages";
import { isOwnershipScoped, isRecordScoped } from "./actions-meta";
import { can } from "./can";
import type { PermSetUser } from "./effective";
import { permissionFlagsSchema } from "./schemas";

const projectCreate = "project.create";

function actor(
  type: PermSetUser["type"] = "regular",
  flags: PermissionFlagKey[] = [],
  isActive = true,
): PermSetUser {
  return { id: "creator", type, isActive, flags: new Set(flags), groupIds: new Set() };
}

describe("project create registry and ordinary defaults", () => {
  it("registers exactly one global high-risk key with no scoped variants", () => {
    expect(GLOBAL_FLAGS.filter((key) => key === projectCreate)).toHaveLength(1);
    expect(ALL_PERMISSION_FLAG_KEYS.filter((key) => key === projectCreate)).toHaveLength(1);
    expect(HIGH_RISK_FLAGS.filter((key) => key === projectCreate)).toHaveLength(1);
    expect(isOwnershipScoped(projectCreate)).toBe(false);
    expect(isRecordScoped(projectCreate)).toBe(false);
    for (const suffix of ["own", "any", "team"]) {
      expect(ALL_PERMISSION_FLAG_KEYS).not.toContain(`${projectCreate}_${suffix}`);
    }
  });

  it("defaults ordinary creation to false while retaining existing regular defaults", () => {
    expect(REGULAR_DEFAULT_FLAGS[projectCreate]).toBe(false);
    expect(ADMIN_DEFAULT_FLAGS[projectCreate]).toBe(true);
    const enabled = Object.entries(REGULAR_DEFAULT_FLAGS)
      .filter(([, value]) => value)
      .map(([key]) => key);
    expect(new Set(enabled)).toEqual(
      new Set([
        "deal.create",
        "contact.create",
        "activity.create",
        "deal.edit_own",
        "contact.edit_own",
        "activity.edit_own",
        "record.share_own",
      ]),
    );
  });
});

describe("project create global permission check", () => {
  it("denies missing authority and permits an explicitly enabled regular flag", () => {
    expect(can(actor(), projectCreate)).toBe(false);
    expect(can(actor("regular", [projectCreate]), projectCreate)).toBe(true);
  });

  it("keeps an explicitly false editor value out of enabled authority", () => {
    const map = completePermissionFlags({ [projectCreate]: false });
    expect(map[projectCreate]).toBe(false);
    const enabled: PermissionFlagKey[] = map[projectCreate] ? [projectCreate] : [];
    expect(can(actor("regular", enabled), projectCreate)).toBe(false);
  });

  it("denies inactive regular and native administrator actors before flags", () => {
    expect(can(actor("regular", [projectCreate], false), projectCreate)).toBe(false);
    expect(can(actor("admin", [], false), projectCreate)).toBe(false);
  });

  it("retains active native administrator handling with an empty flag set", () => {
    const nativeAdministrator = actor("admin");
    expect(nativeAdministrator.flags.size).toBe(0);
    expect(can(nativeAdministrator, projectCreate)).toBe(true);
  });
});

// These pure guard cases do not exercise native hydration or persisted create/update/assignment.
describe("project create high-risk grant guard", () => {
  it("rejects a delegated manager whenever submitted enabled flags contain project create", () => {
    const manager = actor("regular", ["permissions.manage"]);
    const denied = { ok: false, error: "granting project.create requires admin" };
    expect(canGrantFlags(manager, [projectCreate])).toEqual(denied);
    expect(canGrantFlags(manager, ["deal.create", projectCreate])).toEqual(denied);
    expect(canGrantFlags(manager, [])).toEqual({ ok: true, value: true });
  });

  it("permits the existing native administrator grant path without an explicit manage flag", () => {
    expect(canGrantFlags(actor("admin"), [projectCreate])).toEqual({ ok: true, value: true });
    expect(canGrantFlags(actor(), [projectCreate])).toEqual({
      ok: false,
      error: "permissions.manage required",
    });
  });
});

describe("exhaustive permission write schema and editor defaults", () => {
  it.each([false, true])("accepts the new boolean key in a complete write map: %s", (value) => {
    const flags = { ...completePermissionFlags({}), [projectCreate]: value };
    const result = permissionFlagsSchema.safeParse(flags);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(flags);
  });

  it("rejects unknown keys and nonboolean values without relaxing the exhaustive map", () => {
    const flags = { ...completePermissionFlags({}), [projectCreate]: false };
    expect(permissionFlagsSchema.safeParse({ ...flags, "project.create_any": true }).success).toBe(
      false,
    );
    expect(permissionFlagsSchema.safeParse({ ...flags, unknown: true }).success).toBe(false);
    for (const value of ["true", 1, null, undefined]) {
      expect(permissionFlagsSchema.safeParse({ ...flags, [projectCreate]: value }).success).toBe(
        false,
      );
    }
  });

  it("rejects sparse raw write maps, including a complete map missing the new key", () => {
    expect(permissionFlagsSchema.safeParse({}).success).toBe(false);
    expect(permissionFlagsSchema.safeParse({ [projectCreate]: true }).success).toBe(false);
    const flags = completePermissionFlags({});
    Reflect.deleteProperty(flags, projectCreate);
    expect(permissionFlagsSchema.safeParse(flags).success).toBe(false);
  });

  it("distinguishes the omitted create-property default from an explicitly sparse flags map", () => {
    const omitted = createPermissionSetInput.safeParse({ name: "Project team" });
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data).toEqual({ name: "Project team", flags: {} });
    expect(createPermissionSetInput.safeParse({ name: "Project team", flags: {} }).success).toBe(
      false,
    );
  });

  it("completes omitted editor keys to false without dropping existing true values", () => {
    const flags = completePermissionFlags({ "deal.create": true });
    expect(flags[projectCreate]).toBe(false);
    expect(flags["deal.create"]).toBe(true);
    expect(Object.keys(flags)).toHaveLength(ALL_PERMISSION_FLAG_KEYS.length);
    expect(completePermissionFlags({ [projectCreate]: true })[projectCreate]).toBe(true);
  });
});

describe("project create Settings labels", () => {
  it.each([
    ["fa", "ایجاد پروژه"],
    ["de", "Projekt erstellen"],
    ["en", "Create project"],
  ] as const)("resolves the exact %s label through the adopted lookup", (locale, label) => {
    const messages = settingsMessagesForLocale(locale);
    expect(settingsPermissionLabel(messages, projectCreate)).toBe(label);
  });
});
