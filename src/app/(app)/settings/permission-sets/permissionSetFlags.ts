import { ALL_PERMISSION_FLAG_KEYS, type PermissionFlagKey } from "@/constants/permissionFlags";

export type PermissionFlagValues = Record<PermissionFlagKey, boolean>;
export type PermissionFlagMap = Partial<PermissionFlagValues>;

export function completePermissionFlags(flags: PermissionFlagMap): PermissionFlagValues {
  return Object.fromEntries(
    ALL_PERMISSION_FLAG_KEYS.map((key) => [key, flags[key] === true]),
  ) as PermissionFlagValues;
}

export function changedPermissionFlags(
  current: PermissionFlagValues,
  saved: PermissionFlagValues,
): PermissionFlagKey[] {
  return ALL_PERMISSION_FLAG_KEYS.filter((key) => current[key] !== saved[key]);
}
