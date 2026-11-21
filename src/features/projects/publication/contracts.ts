import type { ProjectCover, ProjectLogo } from "../brand/contracts";
import type { ProjectPriority } from "../contracts";
import type { ProjectIntakeStatus } from "../intake/contracts";

export type ProjectPublicationLayout = "list" | "board";
export type PublicationOptions = {
  listEnabled: boolean;
  boardEnabled: boolean;
  showWorkItems: boolean;
  showBranding: boolean;
  allowIntake: boolean;
};
export type ProjectPublicationSettings = PublicationOptions & {
  anchor: string | null;
  revision: number;
  intakeEnabled: boolean;
};
export type SaveProjectPublication = PublicationOptions & {
  projectId: string;
  revision: number;
  published: boolean;
};
export type SubmitPublishedIntake = {
  anchor: string;
  intentId: string;
  title: string;
  description: string;
  priority: ProjectPriority;
};
export type PublishedIntakeRequestKey = { anchor: string; requestId: string };
export type WithdrawPublishedIntake = PublishedIntakeRequestKey & { revision: number };
export type UpdatePublishedIntake = WithdrawPublishedIntake &
  Pick<SubmitPublishedIntake, "title" | "description" | "priority">;
export type PublishedIntakeRequest = {
  id: string;
  title: string;
  description: string;
  priority: ProjectPriority;
  status: ProjectIntakeStatus;
  revision: number;
  createdAt: string;
  canEdit: boolean;
};
export type PublishedIntakeRequestSummary = Omit<PublishedIntakeRequest, "description">;
export type MyPublishedIntakeRequests = {
  requests: PublishedIntakeRequestSummary[];
  nextPage: number | null;
};
export type PublicBoardWorkItem = { key: string; title: string; stateId: string };
export type PublicBoardState = { id: string; name: string; color: string };
export type PublicProjectBoard = {
  title: string;
  logo: ProjectLogo | null;
  cover: ProjectCover | null;
  timeZone: string;
  listEnabled: boolean;
  boardEnabled: boolean;
  showWorkItems: boolean;
  showIntake: boolean;
  acceptsRequests: boolean;
  states: PublicBoardState[];
  items: PublicBoardWorkItem[];
  nextPage: number | null;
};

export function projectPublicationPath(anchor: string) {
  return `/published/project/${encodeURIComponent(anchor)}`;
}

export function projectPublicationCoverPath(anchor: string, version: string) {
  return `${projectPublicationPath(anchor)}/cover/${encodeURIComponent(version)}`;
}
