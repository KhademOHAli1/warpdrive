import type { Result } from "@/types/result";
import type { ProjectBrandChange, ProjectCover, ProjectLogo } from "./brand/contracts";
import type {
  ProjectItemStructure,
  ProjectItemStructurePatch,
  ProjectWorkStructure,
} from "./work-structure/contracts";

export const projectStatuses = ["todo", "in-progress", "done"] as const;
export const projectPriorities = ["urgent", "high", "medium", "low", "none"] as const;
export const projectStateCategories = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
export const projectTitleMaxLength = 120;
export const projectDescriptionMaxLength = 10_000;
export const projectIdentifierMaxLength = 10;
export const projectStateNameMaxLength = 80;
export const projectStatesMaxCount = 50;
export const projectItemTitleMaxLength = 160;
export const projectItemDescriptionMaxLength = 10_000;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectStateCategory = (typeof projectStateCategories)[number];
export type ProjectPriority = (typeof projectPriorities)[number];
export type ProjectPerson = { id: string; name: string };
export type ProjectSummary = {
  id: string;
  title: string;
  identifier: string;
  owner: ProjectPerson;
  createdAt: string;
  archived: boolean;
  timeZone?: string;
  logo?: ProjectLogo | null;
  cover?: ProjectCover | null;
};
export type ProjectVisibility = "private" | "workspace";
export type ProjectGuestAccess = "restricted" | "all";
export type DiscoverableProject = Pick<ProjectSummary, "id" | "title" | "identifier">;
export type ProjectIndex = {
  projects: ProjectSummary[];
  canCreate: boolean;
  discoverableProjects?: DiscoverableProject[];
};
export type ProjectMemberGrant = { role: "editor" | "viewer" | "guest"; canAssign: boolean };
export type ProjectMembership = ProjectMemberGrant & {
  person: ProjectPerson;
  invitationPending?: true;
  projectsGuestOnly?: true;
};
export type ProjectWorkflowState = {
  id: string;
  name: string;
  category: ProjectStateCategory;
  position: number;
  color: string;
  isDefault: boolean;
};

export const defaultProjectWorkflowStates: readonly Omit<ProjectWorkflowState, "id">[] = [
  { name: "To do", category: "unstarted", position: 0, color: "#60646c", isDefault: true },
  { name: "In progress", category: "started", position: 0, color: "#f59e0b", isDefault: false },
  { name: "Done", category: "completed", position: 0, color: "#46a758", isDefault: false },
];

const legacyStatusByStateCategory: Record<ProjectStateCategory, ProjectStatus> = {
  backlog: "todo",
  unstarted: "todo",
  started: "in-progress",
  completed: "done",
  cancelled: "done",
};

export function projectStateLegacyStatus(category: ProjectStateCategory): ProjectStatus {
  return legacyStatusByStateCategory[category];
}

export function projectItemKey(identifier: string, sequenceNumber: number): string {
  return `${identifier}-${sequenceNumber}`;
}

export type ProjectItemContent = {
  title: string;
  status: ProjectStatus;
  assigneeId: string | null;
  priority: ProjectPriority;
  startDate: string | null;
  dueDate: string | null;
  description: string;
};
export type ProjectItem = ProjectItemContent &
  ProjectItemStructure & {
    id: string;
    stateId: string;
    sequenceNumber: number;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    createdBy: string | null;
    revision: number;
    productionReleaseOrderId?: string;
  };

export type ProjectSettings = {
  description: string;
  revision: number;
  leadUserId: string | null;
  defaultAssigneeId: string | null;
  intakeEnabled: boolean;
  visibility?: ProjectVisibility;
  guestViewAllFeatures?: boolean;
  timeZone?: string;
};

export type ProjectWorkspace = {
  project: ProjectSummary;
  states: ProjectWorkflowState[];
  settings: ProjectSettings;
  workStructure: ProjectWorkStructure;
  items: ProjectItem[];
  members: ProjectMembership[];
  assignees: ProjectPerson[];
  staff: ProjectPerson[];
  canEdit: boolean;
  canAssign: boolean;
  canManageMembers: boolean;
  canManageSettings: boolean;
  guestAccess?: ProjectGuestAccess;
};

export type ProjectFailure =
  | "project_unavailable"
  | "project_forbidden"
  | "project_conflict"
  | "project_invalid";
export type ProjectResult<T> = Result<T, ProjectFailure>;

export type CreateProjectInput = { id: string; title: string } & ProjectBrandChange;
export type CreateProjectItemInput = {
  projectId: string;
  id: string;
  stateId?: string;
  title: string;
  planning?: { cycleId?: string; moduleId?: string };
} & Partial<Omit<ProjectItemContent, "title">> &
  ProjectItemStructurePatch;
export type UpdateProjectItemInput = {
  projectId: string;
  itemId: string;
  revision: number;
  stateId?: string;
} & Partial<ProjectItemContent> &
  ProjectItemStructurePatch;
export type SetProjectMemberInput = {
  projectId: string;
  userId: string;
  membership: ProjectMemberGrant | null;
};

export type SaveProjectSettingsInput = {
  projectId: string;
  revision: number;
  title: string;
  description: string;
  identifier?: string;
  leadUserId?: string | null;
  defaultAssigneeId?: string | null;
} & ProjectBrandChange;

export type SetProjectArchivedInput = {
  projectId: string;
  revision: number;
  archived: boolean;
};

export type SaveProjectStatesInput = {
  projectId: string;
  revision: number;
  states: ProjectWorkflowState[];
};

export interface ProjectCommands {
  createProject(input: CreateProjectInput): Promise<ProjectResult<ProjectSummary>>;
  createItem(input: CreateProjectItemInput): Promise<ProjectResult<ProjectWorkspace>>;
  updateItem(input: UpdateProjectItemInput): Promise<ProjectResult<ProjectWorkspace>>;
  setMember(input: SetProjectMemberInput): Promise<ProjectResult<ProjectWorkspace>>;
}
