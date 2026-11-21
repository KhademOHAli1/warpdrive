import { z } from "zod";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import { projectPriorities } from "../contracts";
import { createProjectItemInput, projectIdInput } from "../input";
import { projectIntakeStatuses } from "./contracts";

export const intakeProjectInput = z.strictObject({ projectId: projectIdInput });
const requestId = canonicalUuidSchema;
const requestKey = { projectId: projectIdInput, requestId };
const writeAuthority = {
  expectedActorId: canonicalUuidSchema,
  csrfToken: z.string().max(128).nullable(),
};
const editableFields = {
  title: createProjectItemInput.shape.title,
  description: createProjectItemInput.shape.description.unwrap(),
  priority: z.enum(projectPriorities),
};
const versioned = { ...requestKey, revision: revisionSchema };
export const projectIntakeWorkspaceInput = intakeProjectInput.extend({
  filter: z.enum(["all", ...projectIntakeStatuses]).default("pending"),
  page: z.int().min(1).max(1_000).default(1),
  requestId: requestId.optional(),
});
export const createProjectIntakeInput = intakeProjectInput.extend({
  ...writeAuthority,
  ...editableFields,
  intentId: canonicalUuidSchema,
});
export const updateProjectIntakeInput = z.strictObject({
  ...versioned,
  ...writeAuthority,
  ...editableFields,
});
export const withdrawProjectIntakeInput = z.strictObject({ ...versioned, ...writeAuthority });
const decision = {
  ...versioned,
  ...writeAuthority,
};
export const reviewProjectIntakeInput = z.discriminatedUnion("action", [
  z.strictObject({
    ...decision,
    action: z.literal("accept"),
    stateId: canonicalUuidSchema.optional(),
  }),
  z.strictObject({ ...decision, action: z.literal("decline") }),
  z.strictObject({
    ...decision,
    action: z.literal("snooze"),
    until: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
  }),
  z.strictObject({ ...decision, action: z.literal("unsnooze") }),
  z.strictObject({ ...decision, action: z.literal("duplicate"), workItemId: canonicalUuidSchema }),
]);
export const setProjectIntakeEnabledInput = intakeProjectInput.extend({
  ...writeAuthority,
  enabled: z.boolean(),
  revision: revisionSchema,
});
export const findIntakeWorkItemsInput = intakeProjectInput.extend({
  search: z.string().trim().max(160),
});

type Command<T extends z.ZodType> = Omit<z.output<T>, keyof typeof writeAuthority>;
export type ReadIntakeWorkspaceInput = z.output<typeof projectIntakeWorkspaceInput>;
export type CreateIntakeRequestInput = Command<typeof createProjectIntakeInput>;
export type UpdateIntakeRequestInput = Command<typeof updateProjectIntakeInput>;
export type WithdrawIntakeRequestInput = Command<typeof withdrawProjectIntakeInput>;
type WithoutAuthority<T> = T extends unknown ? Omit<T, keyof typeof writeAuthority> : never;
export type ReviewIntakeRequestInput = WithoutAuthority<z.output<typeof reviewProjectIntakeInput>>;
