import { z } from "zod";
import { projectCreateInputSchema } from "@/features/agency-projects/projectCreationInput";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import {
  projectDocumentBodyMaxLength,
  projectDocumentLifecycleActions,
  projectDocumentTitleMaxLength,
  projectDocumentVisibilities,
} from "./contracts";

const projectId = canonicalUuidSchema;
const title = projectCreateInputSchema.shape.title.pipe(
  z.string().max(projectDocumentTitleMaxLength),
);
const documentKey = { projectId, documentId: canonicalUuidSchema };

export const listProjectDocumentsInput = z.strictObject({ projectId });
export const readProjectDocumentInput = z.strictObject(documentKey);
export const readProjectDocumentVersionInput = z.strictObject({
  ...documentKey,
  versionRevision: revisionSchema,
});

export const createProjectDocumentInput = z.strictObject({
  projectId,
  id: canonicalUuidSchema,
  title,
  visibility: z.enum(projectDocumentVisibilities),
});

export const saveProjectDocumentInput = z.strictObject({
  ...documentKey,
  revision: revisionSchema,
  title,
  bodyHtml: z.string().max(projectDocumentBodyMaxLength),
});

export const setProjectDocumentLifecycleInput = z.strictObject({
  ...documentKey,
  revision: revisionSchema,
  action: z.enum(projectDocumentLifecycleActions),
});

export const restoreProjectDocumentVersionInput = readProjectDocumentVersionInput.extend({
  revision: revisionSchema,
});
