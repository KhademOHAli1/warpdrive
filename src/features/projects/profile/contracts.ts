import { z } from "zod";
import { canonicalUuidSchema } from "@/features/agency-projects/valueSchemas";
import {
  type ProjectPerson,
  type ProjectPriority,
  type ProjectStatus,
  projectPriorities,
  projectStatuses,
} from "../contracts";
import type { ProjectItemEventKind } from "./schema";

const profileCursor = z.strictObject({
  createdAt: z.iso.datetime({ precision: 6 }),
  id: canonicalUuidSchema,
});

export const profileActivityInput = z.strictObject({ cursor: profileCursor.optional() });

export const profileSubscriptionTarget = z.strictObject({
  projectId: canonicalUuidSchema,
  itemId: canonicalUuidSchema,
});

export const profileSubscriptionInput = profileSubscriptionTarget.extend({
  subscribed: z.boolean(),
  csrfToken: z.string().max(128).nullable(),
});

export const profileItemsInput = z.strictObject({
  status: z.enum(projectStatuses).optional(),
  priority: z.enum(projectPriorities).optional(),
  cursor: profileCursor.optional(),
});

export type ProfileItemsInput = z.infer<typeof profileItemsInput>;
export type ProfileCursor = z.infer<typeof profileCursor>;
export type ProfileSubscriptionTarget = z.infer<typeof profileSubscriptionTarget>;
export type ProfileView = "assigned" | "created" | "subscribed";
export type ProfileTab = "summary" | "activity" | ProfileView;

export type ProjectProfileSummary = {
  member: ProjectPerson;
  counts: Record<ProjectStatus, number>;
  priorityCounts: Record<ProjectPriority, number>;
  createdCount: number;
  subscribedCount: number;
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

export type ProfileActivityPage = {
  member: ProjectPerson;
  events: {
    id: string;
    kind: ProjectItemEventKind;
    recordedAt: string;
    item: Pick<ProfileItem, "id" | "title" | "project">;
  }[];
  nextCursor: ProfileCursor | null;
};
