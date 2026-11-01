export interface TeamDraft {
  name: string;
  managerId: string | null;
  memberIds: string[];
}
export interface TeamUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
export interface TeamMember {
  userId: string;
  name: string;
}
export function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
export function emptyTeamDraft(): TeamDraft {
  return { name: "", managerId: null, memberIds: [] };
}
