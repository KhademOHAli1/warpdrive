import { z } from "zod";
import { projectCreateInputSchema } from "@/features/agency-projects/projectCreationInput";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import { projectItemTitleMaxLength, projectStatuses, projectTitleMaxLength } from "./contracts";

const projectTitle = projectCreateInputSchema.shape.title;
const itemTitle = projectTitle.pipe(z.string().max(projectItemTitleMaxLength));
const status = z.enum(projectStatuses);

export const createProjectInput = z.strictObject({
  id: canonicalUuidSchema,
  title: projectTitle.pipe(z.string().max(projectTitleMaxLength)),
});

export const createProjectItemInput = z.strictObject({
  projectId: canonicalUuidSchema,
  id: canonicalUuidSchema,
  title: itemTitle,
  status,
});

export const updateProjectItemInput = z
  .strictObject({
    projectId: canonicalUuidSchema,
    itemId: canonicalUuidSchema,
    revision: revisionSchema,
    title: itemTitle.optional(),
    status: status.optional(),
    assigneeId: canonicalUuidSchema.nullable().optional(),
  })
  .refine(({ title, status, assigneeId }) =>
    [title, status, assigneeId].some((v) => v !== undefined),
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
