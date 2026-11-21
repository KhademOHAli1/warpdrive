import { z } from "zod";
import { projectCreateInputSchema } from "@/features/agency-projects/projectCreationInput";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import {
  type CreateProjectItemInput,
  type ProjectItemContent,
  projectDescriptionMaxLength,
  projectIdentifierMaxLength,
  projectItemDescriptionMaxLength,
  projectItemTitleMaxLength,
  projectPriorities,
  projectStateCategories,
  projectStateLegacyStatus,
  projectStateNameMaxLength,
  projectStatesMaxCount,
  projectStatuses,
  projectTitleMaxLength,
} from "./contracts";

const projectTitle = projectCreateInputSchema.shape.title;
const itemTitle = projectTitle.pipe(z.string().max(projectItemTitleMaxLength));
const status = z.enum(projectStatuses);
const itemDate = z.iso.date().refine((value) => !value.startsWith("0000-"));
const plainText = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => !value.includes("\0") && !/\p{Cs}/u.test(value));
const optionalContent = {
  assigneeId: canonicalUuidSchema.nullable().optional(),
  priority: z.enum(projectPriorities).optional(),
  startDate: itemDate.nullable().optional(),
  dueDate: itemDate.nullable().optional(),
  description: plainText(projectItemDescriptionMaxLength).optional(),
};

export function validProjectItemDates(startDate?: string | null, dueDate?: string | null) {
  return startDate == null || dueDate == null || startDate <= dueDate;
}

export function initialProjectItemContent(
  input: CreateProjectItemInput & Pick<ProjectItemContent, "status">,
): ProjectItemContent {
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
    status: status.optional(),
    stateId: canonicalUuidSchema.optional(),
    planning: z
      .strictObject({
        cycleId: canonicalUuidSchema.optional(),
        moduleId: canonicalUuidSchema.optional(),
      })
      .refine(({ cycleId, moduleId }) => cycleId !== undefined || moduleId !== undefined)
      .optional(),
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
    stateId: canonicalUuidSchema.optional(),
    ...optionalContent,
  })
  .refine(({ title, status, stateId, assigneeId, priority, startDate, dueDate, description }) =>
    [title, status, stateId, assigneeId, priority, startDate, dueDate, description].some(
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

const settingsTarget = { projectId: projectIdInput, revision: revisionSchema };

export const saveProjectSettingsInput = z.strictObject({
  ...settingsTarget,
  title: projectTitle.pipe(z.string().max(projectTitleMaxLength)),
  description: plainText(projectDescriptionMaxLength),
  identifier: z
    .string()
    .trim()
    .min(1)
    .max(projectIdentifierMaxLength)
    .regex(/^[A-Za-z0-9]+$/u)
    .toUpperCase()
    .optional(),
  leadUserId: canonicalUuidSchema.nullable().optional(),
  defaultAssigneeId: canonicalUuidSchema.nullable().optional(),
});

export const setProjectArchivedInput = z.strictObject({
  ...settingsTarget,
  archived: z.boolean(),
});

const workflowStateInput = z.strictObject({
  id: canonicalUuidSchema,
  name: projectTitle.pipe(z.string().max(projectStateNameMaxLength)),
  category: z.enum(projectStateCategories),
  position: z.number().int().nonnegative().lt(projectStatesMaxCount),
  color: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/u)
    .toLowerCase(),
  isDefault: z.boolean(),
});

export const saveProjectStatesInput = z.strictObject({
  ...settingsTarget,
  states: z
    .array(workflowStateInput)
    .min(projectStatuses.length)
    .max(projectStatesMaxCount)
    .refine((states) => new Set(states.map(({ id }) => id)).size === states.length)
    .refine(
      (states) => new Set(states.map(({ name }) => name.toLowerCase())).size === states.length,
    )
    .refine((states) => states.filter(({ isDefault }) => isDefault).length === 1)
    .refine(
      (states) =>
        new Set(states.map(({ category }) => projectStateLegacyStatus(category))).size ===
        projectStatuses.length,
    ),
});
