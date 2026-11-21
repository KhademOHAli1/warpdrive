import type { ProjectPerson } from "../contracts";

export const projectDocumentTitleMaxLength = 160;
export const projectDocumentBodyMaxLength = 262_144;
export const projectDocumentVisibilities = ["project", "private"] as const;
export const projectDocumentLifecycleActions = ["archive", "restore", "lock", "unlock"] as const;

export type ProjectDocumentVisibility = (typeof projectDocumentVisibilities)[number];
export type ProjectDocumentLifecycleAction = (typeof projectDocumentLifecycleActions)[number];

export type ProjectDocumentSummary = {
  id: string;
  title: string;
  author: ProjectPerson;
  visibility: ProjectDocumentVisibility;
  locked: boolean;
  archivedAt: string | null;
  updatedAt: string;
  revision: number;
};

export type ProjectDocumentVersionSummary = {
  revision: number;
  title: string;
  recordedAt: string;
};

export type ProjectDocumentVersion = ProjectDocumentVersionSummary & { bodyHtml: string };

export type ProjectDocumentsIndex = { documents: ProjectDocumentSummary[]; canCreate: boolean };

export type ProjectDocumentDetail = {
  document: ProjectDocumentSummary & { bodyHtml: string };
  versions: ProjectDocumentVersionSummary[];
  canEdit: boolean;
  canManage: boolean;
};

export type ProjectDocumentKey = { projectId: string; documentId: string };

export type CreateProjectDocumentInput = {
  projectId: string;
  id: string;
  title: string;
  visibility: ProjectDocumentVisibility;
};

export type SaveProjectDocumentInput = ProjectDocumentKey & {
  revision: number;
  title: string;
  bodyHtml: string;
};

export type SetProjectDocumentLifecycleInput = ProjectDocumentKey & {
  revision: number;
  action: ProjectDocumentLifecycleAction;
};

export type ReadProjectDocumentVersionInput = ProjectDocumentKey & { versionRevision: number };

export type RestoreProjectDocumentVersionInput = ReadProjectDocumentVersionInput & {
  revision: number;
};
