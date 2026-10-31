import type { PermissionFlagMap } from "./permissionSetFlags";

export interface PermissionSetRow {
  id: string;
  name: string;
  flags: PermissionFlagMap;
  isDefault?: boolean;
}
