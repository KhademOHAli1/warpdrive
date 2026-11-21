import { z } from "zod";
import { projectCreateInputSchema } from "@/features/agency-projects/projectCreationInput";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import {
  type CreateProjectItemInput,
  type ProjectItemContent,
  projectItemDescriptionMaxLength,
  projectItemTitleMaxLength,
  projectPriorities,
  projectStatuses,
  projectTitleMaxLength,
} from "./contracts";

const projectTitle = projectCreateInputSchema.shape.title;
const itemTitle = projectTitle.pipe(z.string().max(projectItemTitleMaxLength));
const status = z.enum(projectStatuses);
const itemDate = z.iso.date().refine((value) => !value.startsWith("0000-"));
const optionalContent = {
  assigneeId: canonicalUuidSchema.nullable().optional(),
  priority: z.enum(projectPriorities).optional(),
  startDate: itemDate.nullable().optional(),
  dueDate: itemDate.nullable().optional(),
  description: z
    .string()
    .max(projectItemDescriptionMaxLength)
    .refine((value) => !value.includes("\0") && !/\p{Cs}/u.test(value))
    .optional(),
};

export function validProjectItemDates(startDate?: string | null, dueDate?: string | null) {
  return startDate == null || dueDate == null || startDate <= dueDate;
}

export function initialProjectItemContent(input: CreateProjectItemInput): ProjectItemContent {
  return {
    title: input.title,
    status: input.status,
    assigneeId: input.assigneeId ?? null,
    priority: input.priority ?? "none",
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    description: input.description ?? "",
  };
}

export function matchesInitialProjectItemContent(
  item: ProjectItemContent,
  intent: ProjectItemContent,
) {
  return (
    item.title === intent.title &&
    item.status === intent.status &&
    item.assigneeId === intent.assigneeId &&
    item.priority === intent.priority &&
    item.startDate === intent.startDate &&
    item.dueDate === intent.dueDate &&
    item.description === intent.description
  );
}

export const createProjectInput = z.strictObject({
  id: canonicalUuidSchema,
  title: projectTitle.pipe(z.string().max(projectTitleMaxLength)),
});

export const createProjectItemInput = z
  .strictObject({
    projectId: canonicalUuidSchema,
    id: canonicalUuidSchema,
    title: itemTitle,
    status,
    ...optionalContent,
  })
  .refine(({ startDate, dueDate }) => validProjectItemDates(startDate, dueDate));

export const updateProjectItemInput = z
  .strictObject({
    projectId: canonicalUuidSchema,
    itemId: canonicalUuidSchema,
    revision: revisionSchema,
    title: itemTitle.optional(),
    status: status.optional(),
    ...optionalContent,
  })
  .refine(({ title, status, assigneeId, priority, startDate, dueDate, description }) =>
    [title, status, assigneeId, priority, startDate, dueDate, description].some(
      (value) => value !== undefined,
    ),
  );

export const setProjectMemberInput = z.strictObject({
  projectId: canonicalUuidSchema,
  userId: canonicalUuidSchema,
  membership: z
    .strictObject({ role: z.enum(["editor", "viewer"]), canAssign: z.boolean() })
    .refine(({ role, canAssign }) => role === "editor" || !canAssign)
    .nullable(),
});

export const projectIdInput = canonicalUuidSchema;
