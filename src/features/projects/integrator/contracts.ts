export const projectIntegratorWorkspace = "warpdrive";
export const projectIntegratorAccess = ["read", "write"] as const;
export type ProjectIntegratorAccess = (typeof projectIntegratorAccess)[number];

export type ProjectIntegratorKey = {
  id: string;
  name: string;
  hint: string;
  access: ProjectIntegratorAccess;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  revokedAt: string | null;
};
