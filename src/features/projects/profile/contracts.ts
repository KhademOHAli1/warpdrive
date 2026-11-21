import { z } from "zod";
import { canonicalUuidSchema } from "@/features/agency-projects/valueSchemas";
import {
  type ProjectPerson,
  type ProjectPriority,
  type ProjectStatus,
  projectPriorities,
  projectStatuses,
} from "../contracts";

const profileCursor = z.strictObject({
  createdAt: z.iso.datetime({ precision: 6 }),
  id: canonicalUuidSchema,
});

export const profileItemsInput = z.strictObject({
  status: z.enum(projectStatuses).optional(),
  priority: z.enum(projectPriorities).optional(),
  cursor: profileCursor.optional(),
});

export type ProfileItemsInput = z.infer<typeof profileItemsInput>;
export type ProfileCursor = z.infer<typeof profileCursor>;
export type ProfileView = "assigned" | "created";
export type ProfileTab = "summary" | ProfileView;

export type ProjectProfileSummary = {
  member: ProjectPerson;
  counts: Record<ProjectStatus, number>;
  priorityCounts: Record<ProjectPriority, number>;
  createdCount: number;
};

export type ProfileItem = {
  id: string;
  title: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  project: { id: string; title: string };
};

export type ProfileItemsPage = {
  member: ProjectPerson;
  items: ProfileItem[];
  nextCursor: ProfileCursor | null;
};
