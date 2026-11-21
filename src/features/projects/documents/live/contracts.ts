import type { ProjectDocumentKey, ProjectDocumentSummary } from "../contracts";

export const projectDocumentCollaborationFragment = "prosemirror";
export const projectDocumentCollaborationMaxBytes = 1_048_576;
export const projectDocumentStateVectorMaxBytes = 65_536;

export type ProjectDocumentCursorPosition = {
  type: { client: number; clock: number } | null;
  tname: typeof projectDocumentCollaborationFragment | null;
  item: { client: number; clock: number } | null;
  assoc: number;
};

export type ProjectDocumentCursor = {
  anchor: ProjectDocumentCursorPosition;
  head: ProjectDocumentCursorPosition;
};

export type ProjectDocumentPresence = {
  clientId: number;
  cursor: ProjectDocumentCursor | null;
  leave?: boolean;
};

export type ProjectDocumentPeer = ProjectDocumentPresence & { name: string };

export type ProjectDocumentCollaborationInput = ProjectDocumentKey & {
  epoch: number | null;
  revision: number | null;
  stateVector: string | null;
  update: string | null;
  presence?: ProjectDocumentPresence | null;
};

export type ProjectDocumentCollaboration = {
  epoch: number;
  document: ProjectDocumentSummary;
  canEdit: boolean;
  canManage: boolean;
  live: boolean;
  update: string | null;
  previewHtml: string | null;
  peers: ProjectDocumentPeer[];
};
