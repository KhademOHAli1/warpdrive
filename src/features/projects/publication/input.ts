import { z } from "zod";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import { projectPriorities } from "../contracts";
import { createProjectItemInput, projectIdInput } from "../input";

export const publicationAnchorInput = canonicalUuidSchema;
export const publicationPageInput = z.coerce.number().int().min(1).max(1000).catch(1);
const writeAuthority = {
  expectedActorId: canonicalUuidSchema,
  csrfToken: z.string().max(128).nullable(),
};

export const publishedBoardInput = z.strictObject({
  anchor: publicationAnchorInput,
  page: z.number().int().min(1).max(1000).default(1),
});
export const publishedCoverInput = z.strictObject({
  anchor: publicationAnchorInput,
  version: canonicalUuidSchema,
});
export const publicationSettingsInput = z.strictObject({ projectId: projectIdInput });
export const saveProjectPublicationInput = publicationSettingsInput
  .extend({
    ...writeAuthority,
    revision: revisionSchema,
    published: z.boolean(),
    listEnabled: z.boolean(),
    boardEnabled: z.boolean(),
    showWorkItems: z.boolean(),
    showBranding: z.boolean(),
    allowIntake: z.boolean(),
  })
  .refine(({ published, listEnabled, boardEnabled }) => !published || listEnabled || boardEnabled);
const publishedRequestFields = {
  title: createProjectItemInput.shape.title,
  description: createProjectItemInput.shape.description.unwrap(),
  priority: z.enum(projectPriorities),
};
export const submitPublishedIntakeInput = z.strictObject({
  ...writeAuthority,
  ...publishedRequestFields,
  anchor: publicationAnchorInput,
  intentId: canonicalUuidSchema,
});
const publishedIntakeKey = { anchor: publicationAnchorInput, requestId: canonicalUuidSchema };
export const myPublishedIntakeRequestsInput = z.strictObject({
  anchor: publicationAnchorInput,
  expectedActorId: canonicalUuidSchema,
  page: z.number().int().min(1).max(1000).default(1),
});
export const publishedIntakeRequestInput = z.strictObject({
  ...publishedIntakeKey,
  expectedActorId: canonicalUuidSchema,
});
export const withdrawPublishedIntakeInput = z.strictObject({
  ...writeAuthority,
  ...publishedIntakeKey,
  revision: revisionSchema,
});
export const updatePublishedIntakeInput = withdrawPublishedIntakeInput.extend({
  ...publishedRequestFields,
});
