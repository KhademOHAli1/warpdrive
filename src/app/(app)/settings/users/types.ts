export interface UserRow {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  invitedAt: string | null;
  permissionSetId: string | null;
}

export interface PermissionSetOption {
  id: string;
  name: string;
}
