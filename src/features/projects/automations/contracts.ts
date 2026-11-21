import { z } from "zod";
import { projectIdInput } from "../input";

export const defaultProjectAutomationSettings = {
  archiveAfterMonths: 0,
  closeAfterMonths: 0,
  closeStateId: null,
  revision: 0,
};

export const projectAutomationKey = z.strictObject({ projectId: projectIdInput });
const authenticatedWrite = {
  expectedActorId: projectIdInput,
  csrfToken: z.string().max(128).nullable(),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};

const monthDuration = z.number().int().min(0).max(12);
export const saveProjectAutomationInput = projectAutomationKey
  .extend({
    ...authenticatedWrite,
    archiveAfterMonths: monthDuration,
    closeAfterMonths: monthDuration,
    closeStateId: projectIdInput.nullable(),
  })
  .refine(
    ({ closeAfterMonths, closeStateId }) => (closeAfterMonths === 0) === (closeStateId === null),
  );

export const archiveProjectItemInput = projectAutomationKey.extend({
  ...authenticatedWrite,
  itemId: projectIdInput,
  archived: z.boolean(),
});

export type ProjectAutomationSettings = Pick<
  z.infer<typeof saveProjectAutomationInput>,
  "archiveAfterMonths" | "closeAfterMonths" | "closeStateId" | "revision"
>;
export type ArchiveProjectItem = z.infer<typeof archiveProjectItemInput>;
export type SaveProjectAutomation = z.infer<typeof saveProjectAutomationInput>;
