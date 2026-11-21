import type { Result } from "@/types/result";

export const projectStatuses = ["todo", "in-progress", "done"] as const;
export const projectTitleMaxLength = 120;
export const projectItemTitleMaxLength = 160;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectPerson = { id: string; name: string };
export type ProjectSummary = { id: string; title: string; owner: ProjectPerson };
export type ProjectIndex = { projects: ProjectSummary[]; canCreate: boolean };
export type ProjectMemberGrant = { role: "editor" | "viewer"; canAssign: boolean };
export type ProjectMembership = ProjectMemberGrant & { person: ProjectPerson };
export type ProjectItem = {
  id: string;
  title: string;
  status: ProjectStatus;
  assigneeId: string | null;
  revision: number;
};

export type ProjectWorkspace = {
  project: ProjectSummary;
  items: ProjectItem[];
  members: ProjectMembership[];
  assignees: ProjectPerson[];
  staff: ProjectPerson[];
  canEdit: boolean;
  canAssign: boolean;
  canManageMembers: boolean;
};

export type ProjectFailure =
  | "project_unavailable"
  | "project_forbidden"
  | "project_conflict"
  | "project_invalid";
export type ProjectResult<T> = Result<T, ProjectFailure>;

export type CreateProjectInput = { id: string; title: string };
export type CreateProjectItemInput = {
  projectId: string;
  id: string;
  title: string;
  status: ProjectStatus;
};
export type UpdateProjectItemInput = {
  projectId: string;
  itemId: string;
  revision: number;
  title?: string;
  status?: ProjectStatus;
  assigneeId?: string | null;
};
export type SetProjectMemberInput = {
  projectId: string;
  userId: string;
  membership: ProjectMemberGrant | null;
};

export interface ProjectCommands {
  createProject(input: CreateProjectInput): Promise<ProjectResult<ProjectSummary>>;
  createItem(input: CreateProjectItemInput): Promise<ProjectResult<ProjectWorkspace>>;
  updateItem(input: UpdateProjectItemInput): Promise<ProjectResult<ProjectWorkspace>>;
  setMember(input: SetProjectMemberInput): Promise<ProjectResult<ProjectWorkspace>>;
}
